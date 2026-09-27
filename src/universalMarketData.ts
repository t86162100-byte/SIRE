export type UniversalBar = { time:number; open:number; high:number; low:number; close:number; volume:number };

const INTERVALS:Record<string,string>={
  '1m':'1min','3m':'3min','5m':'5min','15m':'15min','30m':'30min','45m':'45min',
  '1h':'1h','2h':'2h','4h':'4h','8h':'8h','1d':'1day','1w':'1week','1M':'1month'
};
const SECONDS:Record<string,number>={
  '1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'45m':2700,
  '1h':3600,'2h':7200,'4h':14400,'8h':28800,'1d':86400,'1w':604800,'1M':2592000
};

type Instrument={symbol:string;provider?:string;marketType?:string;name?:string;category?:string};

async function request(path:string, params:Record<string,string>) {
  const query=new URLSearchParams(params);
  const response=await fetch(path+'?'+query.toString(),{cache:'no-store'});
  const payload=await response.json();
  if(!response.ok||!payload?.ok) throw new Error(payload?.error||'SIRE market-data request failed.');
  return payload;
}

export function createUniversalMarketDataFeed(
  instrument:Instrument,
  onQuote?:(q:{symbol:string;price:number;epoch:number;bid?:number;ask?:number})=>void,
  onDiagnostic?:(e:any)=>void,
){
  let stopped=false;
  let timer:number|undefined;
  let last:any=null;

  const getBars=async({symbol,interval,countBack=500,from,to}:{symbol:string;interval:string;countBack?:number;from?:number;to?:number})=>{
    if(!INTERVALS[interval]) throw new Error('SIRE market feed does not support '+interval);
    const payload=await request('/api/sire/market-data/history',{
      provider:String(instrument.provider||''),
      symbol,
      marketType:String(instrument.marketType||''),
      category:String(instrument.category||''),
      interval:INTERVALS[interval],
      count:String(Math.min(5000,Math.max(2,countBack))),
      ...(Number.isFinite(from)?{from:String(Math.floor(Number(from)))}:{}),
      ...(Number.isFinite(to)?{to:String(Math.floor(Number(to)))}:{})
    });
    const bars=(payload.bars||[]).map((r:any)=>({
      time:Number(r.time),open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number(r.volume)||0
    })).filter((b:UniversalBar)=>[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)).sort((a:UniversalBar,b:UniversalBar)=>a.time-b.time);
    if(!bars.length) throw new Error('No historical candles returned for '+symbol+'.');
    onDiagnostic?.({level:'info',code:'HISTORY_LOADED',message:'Loaded '+bars.length+' candles for '+symbol+' '+interval+'.'});
    return bars;
  };

  return {
    getBars,
    async getBarsPage({symbol,interval,before,countBack}:{symbol:string;interval:string;before:number;countBack:number}){
      const bars=await getBars({symbol,interval,countBack,to:before-1});
      const older=bars.filter((b:UniversalBar)=>b.time<before);
      return {bars:older,hasMore:older.length>0,nextBefore:older[0]?.time};
    },
    subscribeBars({symbol,interval}:{symbol:string;interval:string},onBar:(bar:UniversalBar)=>void,options?:{seedFrom?:UniversalBar}){
      stopped=false;
      let current=options?.seedFrom?{...options.seedFrom}:null;
      const seconds=SECONDS[interval]||60;
      const run=async()=>{
        try{
          const payload=await request('/api/sire/market-data/quote',{
            provider:String(instrument.provider||''),symbol,marketType:String(instrument.marketType||''),category:String(instrument.category||'')
          });
          const q=payload.quote;
          const epoch=Number(q.epoch),price=Number(q.price);
          if(!Number.isFinite(epoch)||!Number.isFinite(price)) throw new Error('Quote returned invalid price/time.');
          const t=Math.floor(epoch/seconds)*seconds;
          if(!current||t>current.time) current={time:t,open:price,high:price,low:price,close:price,volume:Number(q.volume)||0};
          else if(t===current.time) current={...current,high:Math.max(current.high,price),low:Math.min(current.low,price),close:price,volume:Number(q.volume)||current.volume||0};
          last={symbol,price,epoch,bid:Number(q.bid),ask:Number(q.ask)};
          onQuote?.(last);
          onBar({...current});
        }catch(e){
          onDiagnostic?.({level:'warning',code:'LIVE_PRICE_NOT_RECEIVED',message:'Live price request failed for '+symbol+'.',detail:e instanceof Error?e.message:String(e)});
        }
        if(!stopped) timer=window.setTimeout(run,2500);
      };
      void run();
      return ()=>{stopped=true;if(timer)window.clearTimeout(timer);timer=undefined;};
    },
    getLiveState(){return last?{connectionStatus:'polling',subscriptionStatus:stopped?'stopped':'active',latestTick:{...last},dataTimestamp:last.epoch,dataAgeMs:Math.max(0,Date.now()-last.epoch*1000),stale:Date.now()-last.epoch*1000>15000,staleThresholdMs:15000,checkedAt:Date.now()}:{connectionStatus:'idle',subscriptionStatus:'idle',latestTick:null,dataTimestamp:null,dataAgeMs:null,stale:false,staleThresholdMs:15000,checkedAt:Date.now()};},
    close(){stopped=true;if(timer)window.clearTimeout(timer);timer=undefined;}
  };
}
