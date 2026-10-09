import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { bitgetOwnerPlaceOrder, bitgetOwnerOrderInfo, bitgetOwnerCancelOrder, bitgetMarketOrderBook } from './sire-provider-execution.ts';

const pool = process.env.DATABASE_URL ? new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false},max:4}) : null;
const TABLE='sire_futures_algo_jobs_v1';
const CHILD='sire_futures_algo_children_v1';
const CATEGORIES=new Set(['USDT-FUTURES','COIN-FUTURES','USDC-FUTURES']);
const STATES=new Set(['running','paused','cancel_requested','completed','cancelled','failed']);
const now=()=>Date.now();
function requirePool(){if(!pool)throw new Error('DATABASE_URL is required for durable Futures schedules.');return pool;}
function num(v,n){const x=Number(v);if(!Number.isFinite(x)||x<=0)throw new Error(n+' must be greater than zero.');return x;}
function clampInt(v,min,max,n){const x=Number(v);if(!Number.isInteger(x)||x<min||x>max)throw new Error(n+' must be between '+min+' and '+max+'.');return x;}
async function ensure(){
 const db=requirePool();
 await db.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(
 id uuid PRIMARY KEY, owner_email text NOT NULL, kind text NOT NULL, state text NOT NULL,
 spec jsonb NOT NULL, total_slices integer NOT NULL, completed_slices integer NOT NULL DEFAULT 0,
 next_run_at timestamptz NOT NULL, started_at timestamptz, finished_at timestamptz,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
 await db.query(`CREATE INDEX IF NOT EXISTS sire_futures_algo_due_idx ON ${TABLE}(state,next_run_at)`);
 await db.query(`CREATE TABLE IF NOT EXISTS ${CHILD}(
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES ${TABLE}(id) ON DELETE CASCADE,
 slice_no integer NOT NULL, client_oid text NOT NULL UNIQUE, order_id text,
 state text NOT NULL, qty numeric NOT NULL, response jsonb, error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(job_id,slice_no))`);
}
function normalize(input:any,ownerEmail:string){
 const kind=String(input?.kind||'').toLowerCase();
 const category=String(input?.category||'').toUpperCase();
 const symbol=String(input?.symbol||'').toUpperCase().trim();
 const side=String(input?.side||'').toLowerCase();
 const posSide=String(input?.posSide||'').toLowerCase();
 const orderType=String(input?.orderType||'market').toLowerCase();
 const totalQty=num(input?.totalQty,'Total quantity');
 if(!['twap','iceberg','split'].includes(kind))throw new Error('Schedule kind must be TWAP, Iceberg or Split.');
 if(!CATEGORIES.has(category))throw new Error('Only Bitget futures contracts are supported by these schedules.');
 if(!/^[A-Z0-9_]{3,32}$/.test(symbol))throw new Error('Invalid futures symbol.');
 if(!['buy','sell'].includes(side)||!['long','short'].includes(posSide))throw new Error('Invalid order side or position side.');
 if(!['market','limit'].includes(orderType))throw new Error('Scheduled order type must be market or limit.');
 const perOrderQty=num(input?.perOrderQty,'Quantity per order');
 if(perOrderQty>totalQty)throw new Error('Quantity per order cannot exceed total quantity.');
 let intervalSeconds=clampInt(input?.intervalSeconds??30,5,3600,'Frequency');
 let totalSlices;
 let durationSeconds;
 if(kind==='twap'){
   durationSeconds=clampInt(input?.durationSeconds,60,86400,'TWAP duration');
   intervalSeconds=clampInt(input?.intervalSeconds??30,5,60,'TWAP frequency');
   totalSlices=Math.min(10000,Math.max(1,Math.ceil(durationSeconds/intervalSeconds)));
 } else {
   totalSlices=kind==='iceberg'?Math.ceil(totalQty/perOrderQty):clampInt(input?.sliceCount,2,1000,'Split count');
   if(kind==='split'&&totalQty/totalSlices>perOrderQty)throw new Error('Split count is too small for the selected per-order quantity.');
   intervalSeconds=clampInt(input?.intervalSeconds??5,1,3600,'Slice interval');
 }
 if(kind==='twap' && totalQty/perOrderQty > totalSlices*1.00000001) throw new Error('Per-order quantity is too small for the TWAP schedule.');
 const preference=String(input?.preference||'Faster execution');
 const price=input?.price==null||input.price===''?undefined:num(input.price,preference==='Fixed distance'?'Price distance':'Limit price');
 if(orderType==='limit'&&!price)throw new Error('Limit orders require a price or distance.');
 if(kind==='iceberg'&&preference==='Fixed distance'&&(!price||price>5))throw new Error('Fixed distance must be greater than 0 and at most 5%.');
 const marginMode=String(input?.marginMode||'crossed').toLowerCase();
 if(!['crossed','isolated'].includes(marginMode))throw new Error('Invalid margin mode.');
 const childQty=(kind==='twap'||kind==='split')?totalQty/totalSlices:perOrderQty;
 const spec={category,symbol,side,posSide,orderType,price,marginMode,reduceOnly:input?.reduceOnly?'yes':'no',timeInForce:String(input?.timeInForce||'gtc').toLowerCase(),totalQty,perOrderQty,intervalSeconds,durationSeconds:durationSeconds||null,childQty,preference,queueType:String(input?.queueType||'Queue 1'),priceLimitEnabled:Boolean(input?.priceLimitEnabled),ownerEmail};
 if(!['gtc','ioc','fok','post_only'].includes(spec.timeInForce))throw new Error('Unsupported time in force.');
 return {kind,category,symbol,totalQty,totalSlices,intervalSeconds,spec};
}
export async function createFuturesSchedule(input:any,ownerEmail:string){
 await ensure();
 const email=String(ownerEmail||'').trim().toLowerCase();if(!email)throw new Error('Authenticated owner identity is required.');
 const n=normalize(input,email);const id=randomUUID();
 const result=await requirePool().query(`INSERT INTO ${TABLE}(id,owner_email,kind,state,spec,total_slices,next_run_at,started_at) VALUES($1,$2,$3,'running',$4::jsonb,$5,now(),now()) RETURNING *`,[id,email,n.kind,JSON.stringify(n.spec),n.totalSlices]);
 return publicJob(result.rows[0]);
}
function publicJob(row:any){return {id:row.id,kind:row.kind,state:row.state,spec:row.spec,totalSlices:Number(row.total_slices),completedSlices:Number(row.completed_slices),nextRunAt:row.next_run_at,startedAt:row.started_at,finishedAt:row.finished_at,lastError:row.last_error,createdAt:row.created_at};}
export async function listFuturesSchedules(ownerEmail:string){
 await ensure();const r=await requirePool().query(`SELECT * FROM ${TABLE} WHERE owner_email=$1 ORDER BY created_at DESC LIMIT 20`,[String(ownerEmail).toLowerCase()]);
 return {ok:true,jobs:r.rows.map(publicJob)};
}
export async function controlFuturesSchedule(id:string,action:string,ownerEmail:string){
 await ensure();const db=requirePool();const email=String(ownerEmail).toLowerCase();
 const found=await db.query(`SELECT * FROM ${TABLE} WHERE id=$1 AND owner_email=$2`,[id,email]);const job=found.rows[0];if(!job)throw new Error('Schedule not found.');
 if(action==='pause'){
  if(job.state!=='running')throw new Error('Only running schedules can be paused.');
  await db.query(`UPDATE ${TABLE} SET state='paused',updated_at=now() WHERE id=$1`,[id]);
 }else if(action==='resume'){
  if(job.state!=='paused')throw new Error('Only paused schedules can be resumed.');
  await db.query(`UPDATE ${TABLE} SET state='running',next_run_at=now(),last_error=NULL,updated_at=now() WHERE id=$1`,[id]);
 }else if(action==='cancel'){
  if(!['running','paused','cancel_requested'].includes(job.state))throw new Error('This schedule is already terminal.');
  await db.query(`UPDATE ${TABLE} SET state='cancel_requested',next_run_at=now(),updated_at=now() WHERE id=$1`,[id]);
 }else throw new Error('Action must be pause, resume or cancel.');
 return {ok:true,job:(await listFuturesSchedules(email)).jobs.find((x:any)=>x.id===id)};
}
async function reconcileOrPlace(child:any,spec:any){
 // Always reconcile the deterministic clientOid before retrying a child after a restart or timeout.
 try{
  const existing=await bitgetOwnerOrderInfo(child.client_oid);
  if(existing?.orderId||existing?.data?.orderId||existing?.orderStatus||existing?.data?.orderStatus)return {ok:true,reconciled:true,data:existing?.data||existing};
 }catch(e){
  const message=e instanceof Error?e.message:String(e);
  if(!/not found|no order|order does not exist|400172|43025/i.test(message))throw e;
 }
 const order=await bitgetOwnerPlaceOrder({category:spec.category,symbol:spec.symbol,side:spec.side,orderType:spec.orderType,qty:String(child.qty),price:spec.price,clientOid:child.client_oid,posSide:spec.posSide,marginMode:spec.marginMode,reduceOnly:spec.reduceOnly,timeInForce:spec.timeInForce});
 return {ok:true,data:order};
}
export async function runFuturesScheduleBatch(){
 if(!pool)return {enabled:false,processed:0};
 await ensure();const db=await pool.connect();let locked=false;let processed=0;
 try{
  const lock=await db.query('SELECT pg_try_advisory_lock($1) AS locked',[0x53495246]);locked=Boolean(lock.rows[0]?.locked);if(!locked)return {enabled:true,leader:false,processed:0};
  const due=await db.query(`SELECT * FROM ${TABLE} WHERE state IN ('running','cancel_requested') AND next_run_at<=now() ORDER BY next_run_at LIMIT 10`);
  for(const job of due.rows){
   try{
    if(job.state==='cancel_requested'){
      const open=await db.query(`SELECT * FROM ${CHILD} WHERE job_id=$1 AND state IN ('accepted','submitting') AND order_id IS NOT NULL`,[job.id]);
      for(const child of open.rows){try{await bitgetOwnerCancelOrder({category:job.spec.category,orderId:child.order_id});}catch(e){console.warn('[FUTURES SCHEDULE] cancel child',child.id,e instanceof Error?e.message:String(e));}}
      await db.query(`UPDATE ${TABLE} SET state='cancelled',finished_at=now(),updated_at=now() WHERE id=$1 AND state='cancel_requested'`,[job.id]);processed++;continue;
    }
    const sliceNo=Number(job.completed_slices)+1;
    if(sliceNo>Number(job.total_slices)){await db.query(`UPDATE ${TABLE} SET state='completed',finished_at=now(),updated_at=now() WHERE id=$1`,[job.id]);processed++;continue;}
    let spec=job.spec;const already=await db.query(`SELECT * FROM ${CHILD} WHERE job_id=$1 AND slice_no=$2`,[job.id,sliceNo]);
    const clientOid=('SIRE'+String(job.id).replace(/-/g,'').slice(0,12)+'_'+sliceNo).slice(0,32);
    const qty=Math.min(Number(spec.childQty),Math.max(0,Number(spec.totalQty)-Number(job.completed_slices)*Number(spec.childQty)));
    if(qty<=0){await db.query(`UPDATE ${TABLE} SET state='completed',finished_at=now(),updated_at=now() WHERE id=$1`,[job.id]);processed++;continue;}
    let child=already.rows[0];
    if(!child){
      const created=await db.query(`INSERT INTO ${CHILD}(id,job_id,slice_no,client_oid,state,qty) VALUES($1,$2,$3,$4,'submitting',$5) ON CONFLICT(job_id,slice_no) DO UPDATE SET updated_at=now() RETURNING *`,[randomUUID(),job.id,sliceNo,clientOid,qty]);
      child=created.rows[0];
    }
    let result:any;
    if(job.kind==='iceberg'&&spec.orderType==='limit'&&spec.preference==='Fixed distance'){
      const book=await bitgetMarketOrderBook(spec.category,spec.symbol,5);const bid=Number(book.bids?.[0]?.price||0);const ask=Number(book.asks?.[0]?.price||0);const distance=Number(spec.price)/100;
      if(!(bid>0&&ask>0&&distance>0))throw new Error('Could not calculate a live Fixed distance price from Bitget order book.');
      const anchor=spec.side==='buy'?(spec.queueType==='Queue 1'?bid:ask):(spec.queueType==='Queue 1'?ask:bid);
      spec={...spec,price:spec.side==='buy'?anchor*(1-distance):anchor*(1+distance)};
    }
    try{result=await reconcileOrPlace(child,spec);}
    catch(e){
      const msg=e instanceof Error?e.message:String(e);
      await db.query(`UPDATE ${CHILD} SET state='failed',error=$2,updated_at=now() WHERE id=$1`,[child.id,msg]);
      await db.query(`UPDATE ${TABLE} SET state='failed',last_error=$2,finished_at=now(),updated_at=now() WHERE id=$1`,[job.id,msg]);
      processed++;continue;
    }
    const order=result?.data||result;const orderId=String(order?.orderId||order?.data?.orderId||'');
    await db.query(`UPDATE ${CHILD} SET state='accepted',order_id=NULLIF($2,''),response=$3::jsonb,error=NULL,updated_at=now() WHERE id=$1`,[child.id,orderId,JSON.stringify(result)]);
    const complete=sliceNo>=Number(job.total_slices)||Number(job.completed_slices)+1>=Number(job.total_slices)||Number(job.completed_slices+1)*Number(spec.perOrderQty)>=Number(spec.totalQty)-1e-12;
    await db.query(`UPDATE ${TABLE} SET completed_slices=completed_slices+1,state=$2,next_run_at=now()+($3::text||' seconds')::interval,finished_at=CASE WHEN $2='completed' THEN now() ELSE finished_at END,updated_at=now() WHERE id=$1`,[job.id,complete?'completed':'running',Number(spec.intervalSeconds)]);
    processed++;
   }catch(e){const msg=e instanceof Error?e.message:String(e);await db.query(`UPDATE ${TABLE} SET last_error=$2,next_run_at=now()+interval '10 seconds',updated_at=now() WHERE id=$1 AND state='running'`,[job.id,msg]);}
  }
  return {enabled:true,processed};
 }finally{if(locked)try{await db.query('SELECT pg_advisory_unlock($1)',[0x53495246]);}catch{}db.release();}
}
