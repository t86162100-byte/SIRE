import type { UniversalBar } from './universalMarketData';

const MAP:Record<string,string>={'1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','45m':'45m','1h':'1h','2h':'2h','4h':'4h','6h':'6h','8h':'8h','12h':'12h','1d':'1d','1w':'1w','1M':'1M'};
const SEC:Record<string,number>={'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'45m':2700,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'1w':604800,'1M':2592000};
type Instrument={symbol:string;provider?:string;exchange?:string;marketType?:string;category?:string};

async function readJson(response:Response){
  const raw=await response.text();
  if(!raw) throw new Error('CCXT endpoint returned an empty response (HTTP '+response.status+').');
  try{return JSON.parse(raw);}catch{throw new Error('CCXT endpoint returned non-JSON data (HTTP '+response.status+').');}
}

export function createCcxtMarketDataFeed(instrument:Instrument,onQuote?:(q:any)=>void,onDiagnostic?:(e:any)=>void){
  const exchange=String(instrument.exchange||'').trim().toLowerCase(); const base='/api/sire/ccxt';
  if(!exchange) throw new Error('SIRE CCXT chart adapter requires an exchange id.');
  let stopped=false; let timer:number|undefined; let last:any=null;

  const getBars=async({symbol,interval,countBack=500,from,to}:{symbol:string;interval:string;countBack?:number;from?:number;to?:number})=>{
    const timeframe=MAP[interval]; if(!timeframe) throw new Error('CCXT chart feed does not support '+interval+'.');
    const limit=Math.min(1000,Math.max(100,Number(countBack)||500)); const q=new URLSearchParams({exchange,symbol,timeframe,limit:String(limit)});
    if(Number.isFinite(Number(from))) q.set('since',String(Math.floor(Number(from))*1000));
    if(Number.isFinite(Number(to))) q.set('until',String(Math.floor(Number(to))*1000));
    let lastError:any=null;
    for(let attempt=1;attempt<=2;attempt++){
      try{
        const r=await fetch(base+'/history?'+q,{cache:'no-store'}); const p:any=await readJson(r);
        if(!r.ok||!p?.ok) throw new Error(p?.error||'CCXT history request failed.');
        const bars=(p.bars||[]) as UniversalBar[]; if(!bars.length) throw new Error('No CCXT candles returned for '+exchange+' '+symbol+'.');
        onDiagnostic?.({level:'info',code:'CCXT_HISTORY_LOADED',message:'Loaded '+bars.length+' candles from '+exchange+'.'}); return bars;
      }catch(e){ lastError=e; if(attempt<2) await new Promise(resolve=>setTimeout(resolve,700)); }
    }
    throw lastError instanceof Error?lastError:new Error(String(lastError||'CCXT history request failed.'));
  };

  return {
    getBars,
    subscribeBars({symbol,interval}:{symbol:string;interval:string},onBar:(bar:UniversalBar)=>void,options?:{seedFrom?:UniversalBar}){
      stopped=false; let current=options?.seedFrom?{...options.seedFrom}:null; const seconds=SEC[interval]||60;
      const run=async()=>{
        try{
          const r=await fetch(base+'/quote?'+new URLSearchParams({exchange,symbol}),{cache:'no-store'}); const p:any=await readJson(r);
          if(!r.ok||!p?.ok) throw new Error(p?.error||'CCXT quote request failed.');
          const q=p.quote; const epoch=Number(q.epoch),price=Number(q.price); if(!Number.isFinite(epoch)||!Number.isFinite(price)) throw new Error('CCXT returned invalid quote.');
          const serverCandle=q.candle;
          if(serverCandle&&Number.isFinite(Number(serverCandle.time))){
            current={time:Number(serverCandle.time),open:Number(serverCandle.open),high:Number(serverCandle.high),low:Number(serverCandle.low),close:Number(serverCandle.close),volume:Number(serverCandle.volume)||0};
          } else {
            const t=Math.floor(epoch/seconds)*seconds;
            if(!current||t>current.time) current={time:t,open:price,high:price,low:price,close:price,volume:0};
            else if(t===current.time) current={...current,high:Math.max(current.high,price),low:Math.min(current.low,price),close:price};
            else current={...current,close:price,high:Math.max(current.high,price),low:Math.min(current.low,price)};
          }
          last={symbol,price,epoch,bid:q.bid,ask:q.ask,source:q.source}; onQuote?.(last); onBar({...current});
        }catch(e){ onDiagnostic?.({level:'warning',code:'CCXT_LIVE_PRICE_NOT_RECEIVED',message:'Live CCXT price request failed for '+exchange+' '+symbol+'.',detail:e instanceof Error?e.message:String(e)}); }
        if(!stopped) timer=window.setTimeout(run,2500);
      };
      void run(); return ()=>{stopped=true;if(timer)window.clearTimeout(timer);timer=undefined;};
    },
    getLiveState(){return last?{connectionStatus:'polling',subscriptionStatus:stopped?'stopped':'active',latestTick:{...last},dataTimestamp:last.epoch,dataAgeMs:Math.max(0,Date.now()-last.epoch*1000),stale:Date.now()-last.epoch*1000>15000,staleThresholdMs:15000,checkedAt:Date.now()}:{connectionStatus:'idle',subscriptionStatus:'idle',latestTick:null,dataTimestamp:null,dataAgeMs:null,stale:false,staleThresholdMs:15000,checkedAt:Date.now()};},
    close(){stopped=true;if(timer)window.clearTimeout(timer);timer=undefined;}
  };
}