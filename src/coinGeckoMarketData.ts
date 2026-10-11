export type CoinGeckoTick = { provider:'COINGECKO'; symbol:string; price:number; epoch:number; };
type Bar = { time:number; open:number; high:number; low:number; close:number; volume?:number; };
type Diagnostic = { level:'info'|'warning'|'error'; code:string; message:string; detail?:string };
const INTERVAL_SECONDS:Record<string,number>={ '1m':60,'2m':120,'3m':180,'5m':300,'10m':600,'15m':900,'20m':1200,'30m':1800,'45m':2700,'1h':3600,'2h':7200,'3h':10800,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'1w':604800 };
const emit=(sink:((e:Diagnostic)=>void)|undefined,e:Diagnostic)=>sink?.(e);
const assetId=(instrument:any)=>String(instrument?.sourceAssetId||'').trim();
async function history(instrument:any,interval:string,countBack:number,onDiagnostic?:(e:Diagnostic)=>void):Promise<Bar[]>{
  const id=assetId(instrument); if(!id) throw new Error('CoinGecko instrument is missing sourceAssetId.');
  const response=await fetch('/api/sire/spot/history?asset='+encodeURIComponent(id)+'&interval='+encodeURIComponent(interval)+'&countBack='+String(countBack),{cache:'no-store',headers:{Accept:'application/json'}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload?.ok||!Array.isArray(payload?.bars)) throw new Error(String(payload?.error||'SIRE CoinGecko history endpoint is unavailable.'));
  emit(onDiagnostic,{level:'info',code:'HISTORY_LOADED',message:'Loaded '+payload.bars.length+' CoinGecko reference candles for '+String(instrument.symbol)+' '+interval+'.',detail:'SIRE is charting CoinGecko market-price history; these are reference candles, not exchange execution liquidity.'});
  return payload.bars as Bar[];
}
export function createCoinGeckoDataFeed(instrument:any,onQuote?:(q:CoinGeckoTick)=>void,onDiagnostic?:(e:Diagnostic)=>void){
  let timer:number|undefined; let stopped=false; let latest:CoinGeckoTick|null=null; let status:'idle'|'active'|'error'|'stopped'='idle';
  const start=(symbol:string,onBar?:(bar:Bar)=>void,interval='1m')=>{ const poll=async()=>{ if(stopped)return; try{
    const bars=await history(instrument,interval,2,onDiagnostic); const bar=bars[bars.length-1]; if(bar){
      const quote={provider:'COINGECKO' as const,symbol,price:Number(bar.close),epoch:Number(bar.time)};
      if(Number.isFinite(quote.price)){latest=quote;status='active';onQuote?.(quote);onBar?.(bar);}
    }
  }catch(error){status='error';emit(onDiagnostic,{level:'warning',code:'LIVE_PRICE_NOT_RECEIVED',message:'CoinGecko live reference price update failed.',detail:error instanceof Error?error.message:String(error)});}
  timer=window.setTimeout(poll,15000);}; void poll();};
  return {
    async getBars({interval,countBack=500}:{symbol:string;interval:string;from?:number;to?:number;countBack?:number}){ if(!INTERVAL_SECONDS[interval])throw new Error('Unsupported CoinGecko chart interval: '+interval); return history(instrument,interval,Math.min(1000,Math.max(20,Number(countBack)||500)),onDiagnostic); },
    async getBarsPage({interval,before,countBack}:{symbol:string;interval:string;before:number;countBack:number}){ const bars=await history(instrument,interval,Math.min(1000,Math.max(20,Number(countBack)||500)),onDiagnostic); const older=bars.filter(b=>b.time<before); return {bars:older,hasMore:false,nextBefore:older[0]?.time}; },
    subscribeBars({symbol,interval}:{symbol:string;interval:string},onBar:(bar:Bar)=>void,options?:{seedFrom?:Bar}){
      if(!INTERVAL_SECONDS[interval])throw new Error('Unsupported CoinGecko chart interval: '+interval);
      stopped=false; status='idle'; let current=options?.seedFrom?{...options.seedFrom}:null;
      const push=(bar:Bar)=>{current=current&&current.time===bar.time?{...current,high:Math.max(current.high,bar.high),low:Math.min(current.low,bar.low),close:bar.close}:{...bar};onBar({...current});};
      start(symbol,push,interval);
      return ()=>{stopped=true;status='stopped';if(timer!==undefined)window.clearTimeout(timer);};
    },
    getLiveState(){const ageMs=latest?.epoch?Math.max(0,Date.now()-latest.epoch*1000):null;return {connectionStatus:status==='active'?'connected':'disconnected',subscriptionStatus:status,latestTick:latest,dataTimestamp:latest?.epoch??null,dataAgeMs:ageMs,stale:ageMs!==null?ageMs>60000:false,staleThresholdMs:60000,checkedAt:Date.now()};},
    close(){stopped=true;if(timer!==undefined)window.clearTimeout(timer);timer=undefined;}
  };
}
