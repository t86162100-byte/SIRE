import type { SireMarketQuote } from './marketDataRouter';

type Instrument={symbol:string;provider?:string;marketType?:string};
const SEC:Record<string,number>={'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'1w':604800,'1M':2592000};
const INTERVAL:Record<string,string>={'1m':'1min','3m':'3min','5m':'5min','15m':'15min','30m':'30min','1h':'1h','2h':'2h','4h':'4h','6h':'6h','8h':'8h','12h':'12h','1d':'1day','1w':'1week','1M':'1month'};
export function createBinanceDataFeed(instrument:Instrument,onQuote?:(q:SireMarketQuote)=>void,onDiagnostic?:(e:any)=>void){
  let stopped=false,timer:any,last:any=null,current:any=null;
  const request=async(path:string,params:Record<string,string>)=>{const u=new URL(path,window.location.origin);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);const r=await fetch(u.toString(),{cache:'no-store'});const p=await r.json();if(!r.ok||!p?.ok)throw new Error(p?.error||'Binance market-data request failed.');return p;};
  const getBars=async({symbol,interval,countBack=500,from,to}:{symbol:string;interval:string;countBack?:number;from?:number;to?:number})=>{
    const params:Record<string,string>={symbol,marketType:String(instrument.marketType||'Spot'),interval:INTERVAL[interval]||interval,count:String(Math.min(1500,Math.max(2,countBack)))};
    if(Number.isFinite(from)) params.from=String(from);
    if(Number.isFinite(to)) params.to=String(to);
    const p=await request('/api/sire/binance/history',params);
    const bars=(p.bars||[]).filter((b:any)=>[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)).sort((a:any,b:any)=>a.time-b.time);
    if(!bars.length)throw new Error('No Binance historical candles returned for '+symbol+'.'); return bars;
  };
  return {
    getBars,
    async getBarsPage({symbol,interval,before,countBack}:{symbol:string;interval:string;before:number;countBack:number}){const bars=await getBars({symbol,interval,countBack,to:before-1});return {bars:bars.filter((b:any)=>b.time<before),hasMore:bars.length>0,nextBefore:bars[0]?.time};},
    subscribeBars({symbol,interval}:{symbol:string;interval:string},onBar:(bar:any)=>void,options?:{seedFrom?:any}){
      stopped=false;current=options?.seedFrom?{...options.seedFrom}:null;const seconds=SEC[interval]||60;
      const run=async()=>{try{const p=await request('/api/sire/binance/quote',{symbol,marketType:String(instrument.marketType||'Spot')});const q=p.quote;const epoch=Number(q.epoch),price=Number(q.price),t=Math.floor(epoch/seconds)*seconds;if(!current||t>current.time)current={time:t,open:price,high:price,low:price,close:price,volume:Number(q.volume)||0};else if(t===current.time)current={...current,high:Math.max(current.high,price),low:Math.min(current.low,price),close:price,volume:Number(q.volume)||current.volume||0};last={...q,epoch,price};onQuote?.(last);onBar({...current});onDiagnostic?.({level:'info',code:'LIVE_PRICE_RECEIVED',message:'Binance live price received for '+symbol+'.'});}catch(e){onDiagnostic?.({level:'warning',code:'LIVE_PRICE_NOT_RECEIVED',message:'Binance live price request failed for '+symbol+'.',detail:e instanceof Error?e.message:String(e)});}if(!stopped)timer=window.setTimeout(run,1500);};void run();return()=>{stopped=true;if(timer)clearTimeout(timer);timer=undefined;};
    },
    getLiveState(){return last?{connectionStatus:'polling',subscriptionStatus:stopped?'stopped':'active',latestTick:{...last},dataTimestamp:last.epoch,dataAgeMs:Math.max(0,Date.now()-last.epoch*1000),stale:Date.now()-last.epoch*1000>10000,staleThresholdMs:10000,checkedAt:Date.now()}:{connectionStatus:'idle',subscriptionStatus:'idle',latestTick:null,dataTimestamp:null,dataAgeMs:null,stale:false,staleThresholdMs:10000,checkedAt:Date.now()};},
    close(){stopped=true;if(timer)clearTimeout(timer);timer=undefined;}
  };
}
