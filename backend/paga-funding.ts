import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const TABLE_DEPOSITS = 'sire_fiat_deposits_v1';
const TABLE_BALANCES = 'sire_fiat_balances_v1';

function databaseUrl() {
  const value = String(process.env.DATABASE_URL || '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!parsed.hostname || parsed.hostname.toLowerCase() === 'base') return null;
    return value;
  } catch { return null; }
}

const url = databaseUrl();
const pool = url ? new Pool({
  connectionString: url,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: 4,
}) : null;

let schemaPromise: Promise<void> | null = null;
function requirePool() {
  if (!pool) throw new Error('DATABASE_URL is not configured for SIRE fiat funding.');
  return pool;
}
async function ensureSchema() {
  if (!schemaPromise) schemaPromise = (async () => {
    const db = requirePool();
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_DEPOSITS} (
        reference text PRIMARY KEY,
        user_id text NOT NULL,
        customer_email text NOT NULL,
        amount numeric(20,2) NOT NULL CHECK (amount > 0),
        currency text NOT NULL DEFAULT 'NGN',
        provider text NOT NULL DEFAULT 'PAGA',
        status text NOT NULL DEFAULT 'pending',
        provider_reference text,
        provider_payload jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        paid_at timestamptz
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_BALANCES} (
        user_id text NOT NULL,
        currency text NOT NULL,
        balance numeric(20,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, currency)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS sire_fiat_deposits_user_created_idx ON ${TABLE_DEPOSITS}(user_id, created_at DESC)`);
  })().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}

function pagaConfig() {
  const environment = String(process.env.PAGA_ENV || 'test').trim().toLowerCase();
  const live = environment === 'live';
  if (!['test', 'live'].includes(environment)) throw new Error('PAGA_ENV must be test or live.');
  if (live && String(process.env.PAGA_LIVE_ENABLED || '').trim().toLowerCase() !== 'true') {
    throw new Error('Live Paga funding is locked. Set PAGA_LIVE_ENABLED=true only after confirming SIRE is approved for live account funding.');
  }
  const publicKey = String(process.env.PAGA_PUBLIC_KEY || '').trim();
  const secretKey = String(process.env.PAGA_SECRET_KEY || '').trim();
  const hashKey = String(process.env.PAGA_HASH_KEY || '').trim();
  if (!publicKey || !secretKey || !hashKey) {
    throw new Error('Configure PAGA_PUBLIC_KEY, PAGA_SECRET_KEY, and PAGA_HASH_KEY in the Render environment. Never put these values in frontend code or GitHub.');
  }
  return {
    environment,
    live,
    publicKey,
    secretKey,
    hashKey,
    checkoutScript: live ? 'https://checkout.paga.com/checkout/?w=220&h=48' : 'https://beta-checkout.paga.com/checkout/?w=220&h=48',
    verifyUrl: live ? 'https://checkout.paga.com/checkout/transaction/verify' : 'https://beta-checkout.paga.com/checkout/transaction/verify',
  };
}

function sha512(value: string) {
  return createHash('sha512').update(value, 'utf8').digest('hex');
}
function safeHexEqual(left: string, right: string) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length || left.length % 2 !== 0) return false;
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
function amountToCents(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) return null;
  return Math.round(n * 100);
}
function moneyFromCents(cents: number) { return (cents / 100).toFixed(2); }

export async function createPagaDeposit(user: any, input: any, baseUrl: string) {
  if (!user?.id || !user?.email) throw new Error('Sign in to fund your SIRE account.');
  const config = pagaConfig();
  await ensureSchema();
  const cents = amountToCents(input?.amount);
  if (cents === null) throw new Error('Enter a valid NGN deposit amount greater than zero.');
  const amount = moneyFromCents(cents);
  const reference = 'SIRE-' + randomUUID().replace(/-/g, '').toUpperCase();
  await requirePool().query(
    `INSERT INTO ${TABLE_DEPOSITS}(reference,user_id,customer_email,amount,currency,status) VALUES($1,$2,$3,$4,'NGN','pending')`,
    [reference, String(user.id), String(user.email).trim().toLowerCase(), amount]
  );
  return {
    ok: true,
    provider: 'PAGA',
    environment: config.environment,
    reference,
    amount,
    currency: 'NGN',
    publicKey: config.publicKey,
    checkoutScript: config.checkoutScript,
    callbackUrl: baseUrl.replace(/\/$/, '') + '/api/sire/paga/callback',
    chargeUrl: baseUrl.replace(/\/$/, '') + '/?paga_payment=returned&reference=' + encodeURIComponent(reference),
    email: String(user.email).trim().toLowerCase(),
    fundingSources: String(process.env.PAGA_FUNDING_SOURCES || 'TRANSFER,CARD,PAGA,USSD').trim(),
  };
}

async function verifyCharge(config: ReturnType<typeof pagaConfig>, reference: string, amount: string) {
  const response = await fetch(config.verifyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(config.publicKey + ':' + config.secretKey).toString('base64'),
    },
    body: JSON.stringify({ paymentReference: reference, publicKey: config.publicKey, amount: Number(amount), currency: 'NGN' }),
    signal: AbortSignal.timeout(12000),
  });
  const raw = await response.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('Paga verification returned an unreadable response.'); }
  if (!response.ok || String(data?.status_code) !== '0' || !/success/i.test(String(data?.status_message || ''))) {
    throw new Error('Paga did not confirm the deposit as successful.');
  }
  if (String(data?.currency || 'NGN').toUpperCase() !== 'NGN' || amountToCents(data?.amount) !== amountToCents(amount)) {
    throw new Error('Paga verification amount or currency did not match the expected deposit.');
  }
  return data;
}

export async function handlePagaCallback(payload: any) {
  const config = pagaConfig();
  await ensureSchema();
  const reference = String(payload?.paymentReference || '').trim();
  const amount = String(payload?.amount ?? '').trim();
  const timestamp = String(payload?.timeStamp || '').trim();
  const signature = String(payload?.hash || '').trim().toLowerCase();
  if (!reference || !amount || !timestamp || !signature) throw new Error('Paga callback is missing required verification fields.');
  const expected = sha512(amount + timestamp + reference + config.hashKey);
  if (!safeHexEqual(signature, expected)) throw new Error('Paga callback signature verification failed.');
  if (String(payload?.statusCode) !== '0' || String(payload?.currency || 'NGN').toUpperCase() !== 'NGN') {
    return { ok: true, accepted: false, status: 'not_paid', reference };
  }
  const cents = amountToCents(amount);
  if (cents === null) throw new Error('Paga callback amount is invalid.');
  const db = requirePool();
  const found = await db.query(`SELECT reference, user_id, amount, currency, status FROM ${TABLE_DEPOSITS} WHERE reference=$1`, [reference]);
  const deposit = found.rows[0];
  if (!deposit) throw new Error('No SIRE deposit matches this Paga payment reference.');
  if (amountToCents(deposit.amount) !== cents || String(deposit.currency).toUpperCase() !== 'NGN') {
    throw new Error('Paga callback amount does not match the SIRE deposit request.');
  }
  if (deposit.status === 'paid') return { ok: true, accepted: true, status: 'paid', reference, duplicate: true };

  const verification = await verifyCharge(config, reference, String(deposit.amount));
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(`SELECT reference,user_id,amount,currency,status FROM ${TABLE_DEPOSITS} WHERE reference=$1 FOR UPDATE`, [reference]);
    const current = locked.rows[0];
    if (!current) throw new Error('SIRE deposit record disappeared during confirmation.');
    if (current.status !== 'paid') {
      await client.query(
        `UPDATE ${TABLE_DEPOSITS} SET status='paid',provider_reference=$2,provider_payload=$3::jsonb,paid_at=now(),updated_at=now() WHERE reference=$1`,
        [reference, String(verification.chargeId || reference), JSON.stringify({ callback: payload, verification })]
      );
      await client.query(
        `INSERT INTO ${TABLE_BALANCES}(user_id,currency,balance) VALUES($1,'NGN',$2) ON CONFLICT(user_id,currency) DO UPDATE SET balance=${TABLE_BALANCES}.balance + EXCLUDED.balance,updated_at=now()`,
        [String(current.user_id), String(current.amount)]
      );
    }
    await client.query('COMMIT');
    return { ok: true, accepted: true, status: 'paid', reference };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function getPagaAccount(user: any) {
  if (!user?.id) throw new Error('Sign in to view your SIRE funding account.');
  await ensureSchema();
  const db = requirePool();
  const [balance, deposits] = await Promise.all([
    db.query(`SELECT balance FROM ${TABLE_BALANCES} WHERE user_id=$1 AND currency='NGN'`, [String(user.id)]),
    db.query(`SELECT reference,amount,currency,status,created_at,paid_at FROM ${TABLE_DEPOSITS} WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`, [String(user.id)]),
  ]);
  return {
    ok: true,
    currency: 'NGN',
    balance: String(balance.rows[0]?.balance ?? '0.00'),
    deposits: deposits.rows.map((row: any) => ({
      reference: row.reference,
      amount: String(row.amount),
      currency: row.currency,
      status: row.status,
      createdAt: row.created_at,
      paidAt: row.paid_at,
    })),
  };
}
