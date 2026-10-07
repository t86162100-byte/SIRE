import pg from 'pg';
import { randomUUID } from 'node:crypto';

const { Pool } = pg;
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: Math.max(2, Math.min(10, Number(process.env.SIRE_LIMIT_DB_POOL || 6))),
    })
  : null;

const TABLE = 'sire_limit_orders_v1';
const LOCK_KEY = 0x53495245;
const SUPPORTED_CHAINS = new Set([1, 56, 137, 8453, 42161, 43114]);
const OPEN = 'Open';

function requirePool() {
  if (!pool) throw new Error('DATABASE_URL is not configured.');
  return pool;
}

async function ensureTable() {
  const db = requirePool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id uuid PRIMARY KEY,
      order_hash text UNIQUE NOT NULL,
      maker text NOT NULL,
      chain_id integer NOT NULL,
      status text NOT NULL,
      expiry bigint NOT NULL,
      record jsonb NOT NULL,
      last_checked_at timestamptz,
      next_check_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS sire_limit_orders_status_due_idx ON ${TABLE}(status, next_check_at)`);
  await db.query(`CREATE INDEX IF NOT EXISTS sire_limit_orders_maker_chain_idx ON ${TABLE}(lower(maker), chain_id)`);
}

function normalizeRecord(input: any) {
  const record = { ...(input || {}) };
  record.orderHash = String(record.orderHash || '').trim();
  record.maker = String(record.maker || record.order?.maker || '').trim();
  record.chainId = Number(record.chainId || record.order?.chainId || 0);
  record.status = String(record.status || OPEN);
  record.expiry = Number(record.order?.expiry || record.expiry || 0);
  return record;
}

function assertRecord(record: any) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(record.orderHash)) throw new Error('Invalid limit intent id.');
  if (!/^0x[a-fA-F0-9]{40}$/.test(record.maker)) throw new Error('Invalid limit maker address.');
  if (!SUPPORTED_CHAINS.has(record.chainId)) throw new Error('0x Limit monitoring is not enabled for this network.');
  if (!Number.isFinite(record.expiry) || record.expiry <= Math.floor(Date.now() / 1000)) throw new Error('Limit order has already expired.');
  if (!record.makerAsset || !record.takerAsset || !/^0x[a-fA-F0-9]{40}$/.test(String(record.makerAsset)) || !/^0x[a-fA-F0-9]{40}$/.test(String(record.takerAsset))) {
    throw new Error('Limit order is missing valid token addresses.');
  }
  if (!/^\d+$/.test(String(record.makingAmount || '')) || !/^\d+$/.test(String(record.takingAmount || ''))) {
    throw new Error('Limit order is missing valid token amounts.');
  }
}

export async function saveLimitOrder(input: any) {
  await ensureTable();
  const record = normalizeRecord(input);
  assertRecord(record);
  const db = requirePool();
  await db.query(
    `INSERT INTO ${TABLE}
      (id, order_hash, maker, chain_id, status, expiry, record, next_check_at, updated_at)
     VALUES ($1, $2, lower($3), $4, $5, $6, $7::jsonb, now(), now())
     ON CONFLICT (order_hash) DO UPDATE SET
       maker = EXCLUDED.maker,
       chain_id = EXCLUDED.chain_id,
       status = CASE WHEN ${TABLE}.status = 'Canceled' THEN ${TABLE}.status ELSE EXCLUDED.status END,
       expiry = EXCLUDED.expiry,
       record = EXCLUDED.record,
       next_check_at = CASE WHEN ${TABLE}.status = 'Canceled' THEN ${TABLE}.next_check_at ELSE now() END,
       updated_at = now()`,
    [randomUUID(), record.orderHash, record.maker, record.chainId, record.status, Math.floor(record.expiry), JSON.stringify(record)]
  );
  return record;
}

export async function listLimitOrders({ chainId, maker }: { chainId?: number; maker?: string } = {}) {
  await ensureTable();
  const db = requirePool();
  const values: any[] = [];
  const where: string[] = [];
  if (Number.isFinite(Number(chainId)) && Number(chainId) > 0) {
    values.push(Number(chainId));
    where.push(`chain_id = $${values.length}`);
  }
  if (maker) {
    values.push(String(maker).toLowerCase());
    where.push(`lower(maker) = $${values.length}`);
  }
  const query = `SELECT record, status FROM ${TABLE}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT 100`;
  const result = await db.query(query, values);
  return result.rows.map(row => ({ ...(row.record || {}), status: row.status }));
}

export async function cancelLimitOrder(orderHash: string, maker: string) {
  await ensureTable();
  const db = requirePool();
  const result = await db.query(
    `UPDATE ${TABLE} SET status='Canceled', record=jsonb_set(record, '{status}', '"Canceled"'::jsonb, true), next_check_at='infinity', updated_at=now()
     WHERE order_hash=$1 AND lower(maker)=lower($2) AND status IN ('Open','Target reached')
     RETURNING record`,
    [String(orderHash), String(maker)]
  );
  return result.rows[0]?.record || null;
}

async function markExpired(db: pg.PoolClient | any) {
  await db.query(
    `UPDATE ${TABLE}
       SET status='Expired',
           record=jsonb_set(record, '{status}', '"Expired"'::jsonb, true),
           updated_at=now()
     WHERE status='Open' AND expiry <= extract(epoch from now())::bigint`
  );
}

async function checkOrder(db: pg.PoolClient | any, row: any, apiKey: string) {
  const record = row.record || {};
  const side = String(record.side || '').toLowerCase();
  const isBuy = side === 'buy';
  const isSell = side === 'sell';
  if (!isBuy && !isSell) {
    await db.query(
      'UPDATE ' + TABLE + ` SET status='Rejected',
             record=jsonb_set(record, '{status}', '"Rejected"'::jsonb, true),
             updated_at=now()
       WHERE order_hash=$1`,
      [row.order_hash]
    );
    return { ok: false, rejected: true, error: 'Limit order is missing a valid Buy/Sell side.' };
  }

  // Buy: fixed payment -> minimum maker tokens received.
  // Sell: fixed maker tokens sold -> minimum taker tokens received.
  const sellToken = isBuy ? record.takerAsset : record.makerAsset;
  const buyToken = isBuy ? record.makerAsset : record.takerAsset;
  const sellAmount = isBuy ? record.takingAmount : record.makingAmount;
  const targetAmount = isBuy ? record.makingAmount : record.takingAmount;
  const params = new URLSearchParams({
    chainId: String(row.chain_id),
    sellToken: String(sellToken),
    buyToken: String(buyToken),
    sellAmount: String(sellAmount),
    taker: String(row.maker),
  });
  try {
    const response = await fetch('https://api.0x.org/swap/allowance-holder/price?' + params.toString(), {
      headers: { '0x-api-key': apiKey, '0x-version': 'v2', Accept: 'application/json' },
    });
    const raw = await response.text();
    let quote: any = {};
    try { quote = raw ? JSON.parse(raw) : {}; } catch { quote = {}; }
    if (!response.ok) {
      const nextMs = response.status === 429 ? 60000 : 30000;
      await db.query(`UPDATE ${TABLE} SET last_checked_at=now(), next_check_at=now()+($2 || ' milliseconds')::interval, updated_at=now() WHERE order_hash=$1`, [row.order_hash, nextMs]);
      return { ok: false, status: response.status };
    }

    const buyAmount = BigInt(String(quote?.buyAmount || '0'));
    const target = BigInt(String(targetAmount || '0'));
    if (buyAmount >= target) {
      const next = {
        ...record,
        status: 'Target reached',
        targetQuote: quote,
        targetReachedAt: Date.now(),
        triggeredSellToken: sellToken,
        triggeredBuyToken: buyToken,
        triggeredSellAmount: String(sellAmount),
        triggeredBuyAmount: String(buyAmount),
      };
      await db.query(
        `UPDATE ${TABLE} SET status='Target reached', record=$2::jsonb, last_checked_at=now(), next_check_at='infinity', updated_at=now() WHERE order_hash=$1`,
        [row.order_hash, JSON.stringify(next)]
      );
      return { ok: true, reached: true };
    }

    await db.query(
      `UPDATE ${TABLE} SET last_checked_at=now(), next_check_at=now()+interval '15 seconds', updated_at=now() WHERE order_hash=$1`,
      [row.order_hash]
    );
    return { ok: true, reached: false };
  } catch (error) {
    await db.query(
      `UPDATE ${TABLE} SET last_checked_at=now(), next_check_at=now()+interval '30 seconds', updated_at=now() WHERE order_hash=$1`,
      [row.order_hash]
    );
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runLimitOrderMonitorBatch(maxOrders = 20) {
  if (!pool || !process.env.ZEROX_API_KEY) return { enabled: false, checked: 0, reached: 0 };
  await ensureTable();
  const db = await pool.connect();
  let locked = false;
  try {
    const lock = await db.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return { enabled: true, leader: false, checked: 0, reached: 0 };

    await markExpired(db);
    const result = await db.query(
      `SELECT order_hash, maker, chain_id, record
         FROM ${TABLE}
        WHERE status='Open'
          AND expiry > extract(epoch from now())::bigint
          AND next_check_at <= now()
        ORDER BY next_check_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [Math.max(1, Math.min(100, Number(maxOrders) || 20))]
    );

    let checked = 0;
    let reached = 0;
    for (const row of result.rows) {
      const outcome = await checkOrder(db, row, String(process.env.ZEROX_API_KEY));
      checked += 1;
      if (outcome.reached) reached += 1;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return { enabled: true, leader: true, checked, reached };
  } finally {
    if (locked) {
      try { await db.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch {}
    }
    db.release();
  }
}

export async function limitOrderStoreStatus() {
  if (!pool) return { enabled: false, table: TABLE };
  try {
    await ensureTable();
    const db = requirePool();
    const result = await db.query(`SELECT status, count(*)::int AS count FROM ${TABLE} GROUP BY status ORDER BY status`);
    return { enabled: true, table: TABLE, counts: result.rows };
  } catch (error) {
    return { enabled: true, table: TABLE, error: error instanceof Error ? error.message : String(error) };
  }
}
