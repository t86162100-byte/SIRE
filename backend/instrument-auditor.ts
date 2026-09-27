import ccxt from 'ccxt';
import { loadFullGlobalCryptoUniverse } from './ccxt-universe-loader.ts';

type AuditRow = {
  id:string; provider:string; exchange?:string; symbol:string; name?:string;
  capabilities:'PASS'|'FAIL'; history:'PASS'|'FAIL'|'UNTESTED'; livePrice:'PASS'|'FAIL'|'UNTESTED';
  priceChanged:'PASS'|'FAIL'|'UNCHANGED'|'UNTESTED'; backwardHistory:'PASS'|'FAIL'|'UNTESTED';
  errors:string[]; checkedAt:string;
};

type AuditState = {
  running:boolean; startedAt:string; finishedAt?:string; cursor:number; total:number;
  pass:number; fail:number; rows:AuditRow[]; error?:string;
};

let state:AuditState|null=null;
let runPromise:Promise<void>|null=null;
const exchangeCache=new Map<string,any>();
const exchangeLoads=new Map<string,Promise<any>>();

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function err(e:unknown){return e instanceof Error?e.message:String(e);}
async function exchange(id:string){
  const key=String(id||'').toLowerCase();
  if(exchangeCache.has(key)) return exchangeCache.get(key);
  if(exchangeLoads.has(key)) return exchangeLoads.get(key);
  const C=(ccxt as any)[key];
  if(!C) throw new Error('CCXT exchange "'+key+'" is not available.');
  const p=(async()=>{const ex=new C({enableRateLimit:true,timeout:20000}); await ex.loadMarkets(); exchangeCache.set(key,ex); return ex;})();
  exchangeLoads.set(key,p);
  try{return await p;} finally{exchangeLoads.delete(key);}
}

async function auditOne(m:any):Promise<AuditRow>{
  const started=new Date().toISOString();
  const errors:string[]=[];
  let capabilities:'PASS'|'FAIL'='FAIL', history:'PASS'|'FAIL'|'UNTESTED'='UNTESTED';
  let livePrice:'PASS'|'FAIL'|'UNTESTED'='UNTESTED', priceChanged:'PASS'|'FAIL'|'UNTESTED'='UNTESTED';
  let backwardHistory:'PASS'|'FAIL'|'UNTESTED'='UNTESTED';
  try {
    const ex=await exchange(m.exchange);
    const market=ex.market(m.symbol);
    if(!market) throw new Error('Market was not found after loadMarkets.');
    const hasOHLCV=Boolean(ex.has?.fetchOHLCV);
    const hasTicker=Boolean(ex.has?.fetchTicker);
    if(!hasOHLCV && !hasTicker) throw new Error('Exchange exposes neither fetchOHLCV nor fetchTicker for this market.');
    capabilities='PASS';

    if(hasOHLCV) {
      try {
        const tf=ex.timeframes?.['1m']?'1m':Object.keys(ex.timeframes||{})[0];
        if(!tf) throw new Error('No candle timeframe is exposed by the exchange.');
        const bars=await ex.fetchOHLCV(m.symbol,tf,undefined,5);
        if(!Array.isArray(bars)||bars.length<2) throw new Error('Returned fewer than 2 candles.');
        const clean=bars.filter((r:any[])=>Array.isArray(r)&&Number.isFinite(Number(r[0]))&&Number.isFinite(Number(r[4])));
        if(clean.length<2) throw new Error('Returned candles contain invalid timestamps/prices.');
        history='PASS';
        const oldest=Number(clean[0][0]);
        const older=await ex.fetchOHLCV(m.symbol,tf,Math.max(0,oldest-(ex.parseTimeframe?.(tf)||60)*1000*5),5);
        if(Array.isArray(older)&&older.some((r:any[])=>Number(r?.[0])<oldest)) backwardHistory='PASS';
        else backwardHistory='FAIL';
      } catch(e){ history='FAIL'; backwardHistory='FAIL'; errors.push('history: '+err(e)); }
    }

    if(hasTicker) {
      try {
        const a=await ex.fetchTicker(m.symbol);
        const p1=Number(a?.last??a?.close??a?.bid??a?.ask);
        if(!Number.isFinite(p1)) throw new Error('Ticker returned no valid price.');
        livePrice='PASS';
        await sleep(1200);
        const b=await ex.fetchTicker(m.symbol);
        const p2=Number(b?.last??b?.close??b?.bid??b?.ask);
        if(!Number.isFinite(p2)) throw new Error('Second ticker returned no valid price.');
        priceChanged=p2!==p1?'PASS':'UNCHANGED';
        if(priceChanged==='UNCHANGED') errors.push('live-price: price was unchanged across the 1.2s observation window; this is inconclusive for inactive/low-volume markets.');
      } catch(e){ livePrice='FAIL'; priceChanged='FAIL'; errors.push('quote: '+err(e)); }
    } else if(hasOHLCV) {
      try {
        const tf=ex.timeframes?.['1m']?'1m':'1m';
        const a=await ex.fetchOHLCV(m.symbol,tf,undefined,2); const p1=Number(a?.at(-1)?.[4]);
        await sleep(1200);
        const b=await ex.fetchOHLCV(m.symbol,tf,undefined,2); const p2=Number(b?.at(-1)?.[4]);
        if(!Number.isFinite(p1)||!Number.isFinite(p2)) throw new Error('OHLCV fallback returned no valid current price.');
        livePrice='PASS'; priceChanged=p2!==p1?'PASS':'UNCHANGED';
        if(priceChanged==='UNCHANGED') errors.push('live-price: latest OHLCV close was unchanged across the 1.2s observation window.');
      } catch(e){ livePrice='FAIL'; priceChanged='FAIL'; errors.push('quote/ohlcv fallback: '+err(e)); }
    }
  } catch(e){ errors.push('capabilities: '+err(e)); }
  const failed=capabilities==='FAIL'||history==='FAIL'||livePrice==='FAIL'||backwardHistory==='FAIL';
  return {id:String(m.id||('CCXT:'+m.exchange+':'+m.symbol)),provider:'CCXT',exchange:String(m.exchange||''),symbol:String(m.symbol||''),name:String(m.exchangeName||m.symbol||''),capabilities,history,livePrice,priceChanged,backwardHistory,errors,checkedAt:started};
}

export function getInstrumentAuditStatus(){
  return state ? {
    ...state,
    rows: state.rows.slice(-500),
    retainedRows: state.rows.length,
    running:Boolean(runPromise)
  } : {running:false,startedAt:null,cursor:0,total:0,pass:0,fail:0,retainedRows:0,rows:[]};
}

export function getInstrumentAuditResults(filter?:{failedOnly?:boolean;exchange?:string}){
  const rows=state?.rows||[];
  return rows.filter(r=>filter?.failedOnly ? (r.capabilities==='FAIL'||r.history==='FAIL'||r.livePrice==='FAIL'||r.backwardHistory==='FAIL') : true)
    .filter(r=>filter?.exchange ? r.exchange===filter.exchange : true);
}

async function runAudit(){
  const markets=await loadFullGlobalCryptoUniverse();
  const list=markets.filter((m:any)=>m.active!==false);
  state={running:true,startedAt:new Date().toISOString(),cursor:0,total:list.length,pass:0,fail:0,rows:[]};
  for(let i=0;i<list.length;i++){
    if(!state) break;
    const row=await auditOne(list[i]);
    state.rows.push(row); state.cursor=i+1;
    const failed=row.capabilities==='FAIL'||row.history==='FAIL'||row.livePrice==='FAIL'||row.backwardHistory==='FAIL';
    if(failed) state.fail++; else state.pass++;
    if((i+1)%25===0) console.info('[SIRE INSTRUMENT AUDIT]',JSON.stringify({cursor:i+1,total:list.length,pass:state.pass,fail:state.fail}));
  }
  if(state){state.running=false;state.finishedAt=new Date().toISOString();}
}

export function startInstrumentAudit(){
  if(runPromise) return getInstrumentAuditStatus();
  runPromise=runAudit().catch(e=>{
    if(state){state.running=false;state.error=err(e);state.finishedAt=new Date().toISOString();}
    console.error('[SIRE INSTRUMENT AUDIT] fatal:',e);
  }).finally(()=>{runPromise=null;});
  return getInstrumentAuditStatus();
}
