import pg from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { ws } from '@appdeploy/sdk';

const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: Math.max(4, Math.min(30, Number(process.env.SIRE_SPOT_DB_POOL || 12))),
  idleTimeoutMillis: 30000,
}) : null;

const ORDERS = 'sire_spot_orders_v1';
const BALANCES = 'sire_spot_balances_v1';
const TRADES = 'sire_spot_trades_v1';
const LEDGER = 'sire_spot_ledger_v1';
const ACCOUNTS = 'sire_spot_accounts_v1';
const FEE_BPS = Math.max(0, Math.min(100, Number(process.env.SIRE_SPOT_FEE_BPS || 10)));
const spotConnections = new Map<string, Set<string>>();

function db(){ if(!pool) throw new Error('DATABASE_URL is not configured.'); return pool; }
function normWallet(v:string){ const s=String(v||'').trim(); if(!/^0x[a-fA-F0-9]{40}$/.test(s)) throw new Error('A valid SIRE Wallet address is required.'); return s.toLowerCase(); }
function normSymbol(v:string){ const s=String(v||'').trim().toUpperCase(); if(!/^[A-Z0-9]{4,30}$/.test(s)) throw new Error('Invalid Spot symbol.'); return s; }
function positive(v:any,name:string){ const n=Number(v); if(!Number.isFinite(n)||n<=0) throw new Error(`Invalid ${name}.`); return n; }
function quoteOf(symbol:string){ if(!symbol.endsWith('USDT')) throw new Error('Only USDT Spot pairs are enabled in the SIRE Spot engine right now.'); return 'USDT'; }
function baseOf(symbol:string){ return symbol.slice(0,-4); }
function advisoryKey(text:string){ return createHash('sha256').update(text).digest().readInt32BE(0); }
function feeOnQuote(gross:number){ return gross * FEE_BPS / 10000; }

export async function ensureSireSpotTables(){
  const p=db();
  await p.query(`CREATE TABLE IF NOT EXISTS ${ACCOUNTS} (wallet text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`);
  await p.query(`CREATE TABLE IF NOT EXISTS ${BALANCES} (wallet text NOT NULL, asset text NOT NULL, available numeric(78,30) NOT NULL DEFAULT 0, locked numeric(78,30) NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(wallet,asset))`);
  await p.query(`CREATE TABLE IF NOT EXISTS ${ORDERS} (id uuid PRIMARY KEY, client_order_id text NOT NULL, wallet text NOT NULL, symbol text NOT NULL, base_asset text NOT NULL, quote_asset text NOT NULL, side text NOT NULL CHECK(side IN ('BUY','SELL')), type text NOT NULL CHECK(type IN ('LIMIT','MARKET')), price numeric(78,30), quantity numeric(78,30) NOT NULL, remaining numeric(78,30) NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(wallet,client_order_id))`);
  await p.query(`CREATE INDEX IF NOT EXISTS sire_spot_orders_book_idx ON ${ORDERS}(symbol,side,status,price,created_at)`);
  await p.query(`CREATE INDEX IF NOT EXISTS sire_spot_orders_wallet_idx ON ${ORDERS}(wallet,created_at DESC)`);
  await p.query(`CREATE TABLE IF NOT EXISTS ${TRADES} (id uuid PRIMARY KEY, symbol text NOT NULL, maker_order_id uuid NOT NULL, taker_order_id uuid NOT NULL, price numeric(78,30) NOT NULL, quantity numeric(78,30) NOT NULL, buyer_wallet text NOT NULL, seller_wallet text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  await p.query(`CREATE INDEX IF NOT EXISTS sire_spot_trades_symbol_idx ON ${TRADES}(symbol,created_at DESC)`);
  await p.query(`CREATE TABLE IF NOT EXISTS ${LEDGER} (id uuid PRIMARY KEY, wallet text NOT NULL, asset text NOT NULL, available_delta numeric(78,30) NOT NULL, locked_delta numeric(78,30) NOT NULL, reason text NOT NULL, ref_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  await p.query(`CREATE INDEX IF NOT EXISTS sire_spot_ledger_wallet_idx ON ${LEDGER}(wallet,created_at DESC)`);
}

async function ensureBalance(c:any,wallet:string,asset:string){
  await c.query(`INSERT INTO ${BALANCES}(wallet,asset) VALUES($1,$2) ON CONFLICT DO NOTHING`,[wallet,asset]);
  const r=await c.query(`SELECT available,locked FROM ${BALANCES} WHERE wallet=$1 AND asset=$2 FOR UPDATE`,[wallet,asset]);
  return {available:Number(r.rows[0].available),locked:Number(r.rows[0].locked)};
}
async function delta(c:any,wallet:string,asset:string,availableDelta:number,lockedDelta:number,reason:string,ref:string){
  await ensureBalance(c,wallet,asset);
  const before=await c.query(`SELECT available,locked FROM ${BALANCES} WHERE wallet=$1 AND asset=$2 FOR UPDATE`,[wallet,asset]);
  const a=Number(before.rows[0].available)+availableDelta, l=Number(before.rows[0].locked)+lockedDelta;
  if(a < -1e-12 || l < -1e-12) throw new Error(`Insufficient ${asset} balance.`);
  await c.query(`UPDATE ${BALANCES} SET available=$3,locked=$4,updated_at=now() WHERE wallet=$1 AND asset=$2`,[wallet,asset,String(a),String(l)]);
  await c.query(`INSERT INTO ${LEDGER}(id,wallet,asset,available_delta,locked_delta,reason,ref_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,[randomUUID(),wallet,asset,String(availableDelta),String(lockedDelta),reason,ref]);
}

function serializeOrder(r:any){
  return {
    id:String(r.id), clientOrderId:String(r.client_order_id), wallet:String(r.wallet),
    symbol:String(r.symbol), side:String(r.side), type:String(r.type),
    price:r.price==null?null:Number(r.price), quantity:Number(r.quantity),
    remaining:Number(r.remaining), filledQuantity:Number(r.quantity)-Number(r.remaining),
    status:String(r.status), createdAt:new Date(r.created_at||Date.now()).getTime(),
    updatedAt:new Date(r.updated_at||Date.now()).getTime()
  };
}

export function spotSubscribe(symbolInput:string,connectionId:string){ const symbol=normSymbol(symbolInput); const id=String(connectionId||'').trim(); if(!id) throw new Error('connection_id is required.'); let set=spotConnections.get(symbol); if(!set){set=new Set();spotConnections.set(symbol,set);} set.add(id); return {ok:true,symbol}; }
export function spotUnsubscribe(symbolInput:string,connectionId:string){ const symbol=normSymbol(symbolInput),set=spotConnections.get(symbol); if(set){set.delete(String(connectionId||''));if(!set.size)spotConnections.delete(symbol);} return {ok:true,symbol}; }
export function spotDisconnect(connectionId:string){ const id=String(connectionId||''); for(const [symbol,set] of spotConnections){set.delete(id);if(!set.size)spotConnections.delete(symbol);} }
async function publishSpot(symbol:string,trade:any=null){ const set=spotConnections.get(symbol); if(!set?.size)return; const book=await getSpotBook(symbol,25); await ws.send([...set],{v:1,type:'spot.update',payload:{symbol,book,trade}}); }

export async function getSpotBook(symbolInput:string,depth=20){
  await ensureSireSpotTables();
  const symbol=normSymbol(symbolInput), n=Math.max(1,Math.min(100,Math.floor(Number(depth)||20))),p=db();
  const [asks,bids,last]=await Promise.all([
    p.query(`SELECT price::text,SUM(remaining)::text AS quantity,COUNT(*)::int AS orders FROM ${ORDERS} WHERE symbol=$1 AND side='SELL' AND status='OPEN' GROUP BY price ORDER BY price ASC LIMIT $2`,[symbol,n]),
    p.query(`SELECT price::text,SUM(remaining)::text AS quantity,COUNT(*)::int AS orders FROM ${ORDERS} WHERE symbol=$1 AND side='BUY' AND status='OPEN' GROUP BY price ORDER BY price DESC LIMIT $2`,[symbol,n]),
    p.query(`SELECT price::text,quantity::text,created_at FROM ${TRADES} WHERE symbol=$1 ORDER BY created_at DESC LIMIT 1`,[symbol])
  ]);
  return {
    ok:true,symbol,baseAsset:baseOf(symbol),quoteAsset:quoteOf(symbol),source:'SIRE_MATCHING_ENGINE',feeBps:FEE_BPS,
    asks:asks.rows.map(x=>({price:Number(x.price),quantity:Number(x.quantity),orders:x.orders})),
    bids:bids.rows.map(x=>({price:Number(x.price),quantity:Number(x.quantity),orders:x.orders})),
    lastTrade:last.rows[0]?{price:Number(last.rows[0].price),quantity:Number(last.rows[0].quantity),time:new Date(last.rows[0].created_at).getTime()}:null
  };
}

export async function placeSpotOrder(input:any){
  await ensureSireSpotTables();
  const wallet=normWallet(input.wallet), symbol=normSymbol(input.symbol), quote=quoteOf(symbol), base=baseOf(symbol);
  const side=String(input.side||'').toUpperCase(), type=String(input.type||'').toUpperCase();
  if(side!=='BUY'&&side!=='SELL') throw new Error('Side must be Buy or Sell.');
  if(type!=='LIMIT'&&type!=='MARKET') throw new Error('Only Market and Limit orders are executable.');
  const quantity=positive(input.quantity,'quantity');
  const price=type==='LIMIT'?positive(input.price,'price'):null;
  const clientOrderId=String(input.clientOrderId||randomUUID()).trim().slice(0,100);
  const p=db(),c=await p.connect();
  try{
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock($1)',[advisoryKey(`sire-spot:${symbol}`)]);
    await c.query(`INSERT INTO ${ACCOUNTS}(wallet) VALUES($1) ON CONFLICT DO NOTHING`,[wallet]);
    const duplicate=await c.query(`SELECT * FROM ${ORDERS} WHERE wallet=$1 AND client_order_id=$2`,[wallet,clientOrderId]);
    if(duplicate.rows[0]){ await c.query('COMMIT'); return serializeOrder(duplicate.rows[0]); }

    const orderId=randomUUID();
    let reserveQuote=0;
    if(side==='SELL'){
      const bal=await ensureBalance(c,wallet,base);
      if(bal.available+1e-12<quantity) throw new Error(`Insufficient ${base} balance.`);
      await delta(c,wallet,base,-quantity,quantity,'ORDER_LOCK',orderId);
    }else{
      if(type==='LIMIT') reserveQuote=quantity*(price as number)+feeOnQuote(quantity*(price as number));
      else{
        const asks=await c.query(`SELECT price,remaining FROM ${ORDERS} WHERE symbol=$1 AND side='SELL' AND status='OPEN' AND remaining>0 ORDER BY price ASC,created_at ASC LIMIT 1000`,[symbol]);
        let left=quantity;
        for(const row of asks.rows){const take=Math.min(left,Number(row.remaining));const gross=take*Number(row.price);reserveQuote+=gross+feeOnQuote(gross);left-=take;if(left<=1e-12)break;}
        if(left>1e-12) throw new Error('Insufficient SIRE Spot liquidity for this market buy.');
      }
      const bal=await ensureBalance(c,wallet,quote);
      if(bal.available+1e-12<reserveQuote) throw new Error(`Insufficient ${quote} balance.`);
      await delta(c,wallet,quote,-reserveQuote,reserveQuote,'ORDER_LOCK',orderId);
    }

    await c.query(`INSERT INTO ${ORDERS}(id,client_order_id,wallet,symbol,base_asset,quote_asset,side,type,price,quantity,remaining,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,'OPEN')`,[orderId,clientOrderId,wallet,symbol,base,quote,side,type,price,quantity]);

    let remaining=quantity,filled=0,avgNumerator=0;
    const matchSql=side==='BUY'
      ? `SELECT * FROM ${ORDERS} WHERE symbol=$1 AND side='SELL' AND status='OPEN' AND remaining>0 AND ($2='MARKET' OR price<=$3) ORDER BY price ASC,created_at ASC FOR UPDATE`
      : `SELECT * FROM ${ORDERS} WHERE symbol=$1 AND side='BUY' AND status='OPEN' AND remaining>0 AND ($2='MARKET' OR price>=$3) ORDER BY price DESC,created_at ASC FOR UPDATE`;
    const matches=await c.query(matchSql,[symbol,type,price||0]);
    for(const maker of matches.rows){
      if(remaining<=1e-12) break;
      const take=Math.min(remaining,Number(maker.remaining));
      if(take<=0) continue;
      const tradePrice=Number(maker.price),gross=take*tradePrice,tradeId=randomUUID();
      const buyer=side==='BUY'?wallet:maker.wallet,seller=side==='SELL'?wallet:maker.wallet;
      if(side==='BUY'){
        await delta(c,wallet,quote,0,-(gross+feeOnQuote(gross)),'TRADE_BUY_QUOTE_SPENT',tradeId);
        await delta(c,wallet,base,take,0,'TRADE_BASE_CREDIT',tradeId);
        await delta(c,maker.wallet,base,0,-take,'TRADE_SELL_BASE_SPENT',tradeId);
        await delta(c,maker.wallet,quote,gross-feeOnQuote(gross),0,'TRADE_SELL_QUOTE_CREDIT',tradeId);
      }else{
        await delta(c,wallet,base,0,-take,'TRADE_SELL_BASE_SPENT',tradeId);
        await delta(c,wallet,quote,gross-feeOnQuote(gross),0,'TRADE_SELL_QUOTE_CREDIT',tradeId);
        await delta(c,maker.wallet,quote,0,-(gross+feeOnQuote(gross)),'TRADE_BUY_QUOTE_SPENT',tradeId);
        await delta(c,maker.wallet,base,take,0,'TRADE_BASE_CREDIT',tradeId);
      }
      await c.query(`INSERT INTO ${TRADES}(id,symbol,maker_order_id,taker_order_id,price,quantity,buyer_wallet,seller_wallet) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[tradeId,symbol,maker.id,orderId,String(tradePrice),String(take),buyer,seller]);
      const makerRemaining=Math.max(0,Number(maker.remaining)-take);
      await c.query(`UPDATE ${ORDERS} SET remaining=$2,status=$3,updated_at=now() WHERE id=$1`,[maker.id,String(makerRemaining),makerRemaining<=1e-12?'FILLED':'OPEN']);
      remaining-=take;filled+=take;avgNumerator+=take*tradePrice;
    }

    if(side==='BUY'){
      const filledGrossResult=await c.query(`SELECT COALESCE(SUM(quantity*price),0)::text AS gross FROM ${TRADES} WHERE taker_order_id=$1`,[orderId]);
      const gross=Number(filledGrossResult.rows[0].gross||0),spent=gross+feeOnQuote(gross);
      const release=Math.max(0,reserveQuote-spent);
      if(release>0) await delta(c,wallet,quote,release,-release,'ORDER_UNLOCK_REMAINDER',orderId);
    }else if(type==='MARKET'&&remaining>1e-12){
      await delta(c,wallet,base,remaining,-remaining,'ORDER_UNLOCK_REMAINDER',orderId);
    }

    let status:string;
    if(remaining<=1e-12) status='FILLED';
    else if(type==='MARKET'){ status='CANCELED'; }
    else status='OPEN';
    await c.query(`UPDATE ${ORDERS} SET remaining=$2,status=$3,updated_at=now() WHERE id=$1`,[orderId,String(Math.max(0,remaining)),status]);
    await c.query('COMMIT');
    await publishSpot(symbol, filled ? {symbol, quantity:filled, price:avgNumerator/filled, time:Date.now()} : null);
    return {...serializeOrder({id:orderId,client_order_id:clientOrderId,wallet,symbol,side,type,price,quantity,remaining:Math.max(0,remaining),status}),filledQuantity:filled,averagePrice:filled?avgNumerator/filled:null};
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}

export async function cancelSpotOrder(input:any){
  await ensureSireSpotTables();
  const wallet=normWallet(input.wallet),id=String(input.orderId||'').trim();if(!id)throw new Error('orderId is required.');
  const p=db(),c=await p.connect();
  try{
    await c.query('BEGIN');
    const r=await c.query(`SELECT * FROM ${ORDERS} WHERE id=$1 AND wallet=$2 FOR UPDATE`,[id,wallet]);
    if(!r.rows[0]) throw new Error('Spot order not found.');
    const o=r.rows[0];if(o.status!=='OPEN')throw new Error('Spot order is no longer open.');
    const rem=Number(o.remaining);
    if(o.side==='SELL')await delta(c,wallet,o.base_asset,rem,-rem,'ORDER_CANCEL_UNLOCK',id);
    else{const unlock=rem*Number(o.price)+feeOnQuote(rem*Number(o.price));await delta(c,wallet,o.quote_asset,unlock,-unlock,'ORDER_CANCEL_UNLOCK',id);}
    await c.query(`UPDATE ${ORDERS} SET status='CANCELED',updated_at=now() WHERE id=$1`,[id]);
    await c.query('COMMIT');
    await publishSpot(String(o.symbol));
    return {ok:true,order:serializeOrder({...o,status:'CANCELED',remaining:rem})};
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}

export async function getSpotAccount(walletInput:string){
  await ensureSireSpotTables();const wallet=normWallet(walletInput),p=db();
  const r=await p.query(`SELECT asset,available::text,locked::text FROM ${BALANCES} WHERE wallet=$1 ORDER BY asset`,[wallet]);
  return {ok:true,wallet,balances:r.rows.map(x=>({asset:x.asset,available:Number(x.available),locked:Number(x.locked)}))};
}
export async function getSpotOrders(walletInput:string,limit=100){
  await ensureSireSpotTables();const wallet=normWallet(walletInput),p=db();
  const r=await p.query(`SELECT * FROM ${ORDERS} WHERE wallet=$1 ORDER BY created_at DESC LIMIT $2`,[wallet,Math.max(1,Math.min(100,Number(limit)||100))]);
  return {ok:true,orders:r.rows.map(serializeOrder)};
}
export async function getSpotTrades(symbolInput:string,limit=100){
  await ensureSireSpotTables();const symbol=normSymbol(symbolInput),p=db();
  const r=await p.query(`SELECT id,price::text,quantity::text,buyer_wallet,seller_wallet,created_at FROM ${TRADES} WHERE symbol=$1 ORDER BY created_at DESC LIMIT $2`,[symbol,Math.max(1,Math.min(500,Number(limit)||100))]);
  return {ok:true,symbol,trades:r.rows.map(x=>({id:x.id,price:Number(x.price),quantity:Number(x.quantity),time:new Date(x.created_at).getTime()}))};
}
export async function spotEngineStatus(){
  if(!pool)return {ok:false,enabled:false,error:'DATABASE_URL is not configured.'};
  try{
    await ensureSireSpotTables();
    const r=await pool.query(`SELECT (SELECT count(*) FROM ${ORDERS})::int AS orders,(SELECT count(*) FROM ${TRADES})::int AS trades,(SELECT count(*) FROM ${LEDGER})::int AS ledger`);
    return {ok:true,enabled:true,orders:r.rows[0].orders,trades:r.rows[0].trades,ledger:r.rows[0].ledger,feeBps:FEE_BPS};
  }catch(e){return {ok:false,enabled:true,error:e instanceof Error?e.message:String(e)};}
}
