export type FxcmBar={time:number;open:number;high:number;low:number;close:number;volume:number};
const FXCM_PERIODS:Record<string,string>={'1m':'m1','5m':'m5','15m':'m15','30m':'m30','1h':'H1','2h':'H2','3h':'H3','4h':'H4','6h':'H6','8h':'H8','1d':'D1','1w':'W1'};
const FXCM_SECONDS:Record<string,number>={'1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'3h':10800,'4h':14400,'6h':21600,'8h':28800,'1d':86400,'1w':604800};
type Handler=(q:{symbol:string;price:number;epoch:number})=>void;
export function createFxcmDataFeed(onQuote?:Handler,onDiagnostic?:(e:any)=>void){
  let stopped=false; let timer:number|undefined; let last:any=null;
  const getBars=async({symbol,interval,countBack=500}:{symbol:string;interval:string;from?:number;to?:number;countBack?:number})=>{
    const period=FXCM_PERIODS[interval]; if(!period) throw new Error('FXCM does not provide '+interval+' candles.');
    const response=await fetch('/api/sire/fxcm/candles?symbol='+encodeURIComponent(symbol)+'&period='+period+'&count='+Math.min(10000,Math.max(1,countBack)),{cache:'no-store'});
    const payload=await response.json(); if(!response.ok||!payload?.ok) throw new Error(payload?.error||'FXCM candle request failed.');
    const bars=(payload.candles||[]).map((r:any)=>{const t=Number(r[0]),bo=Number(r[1]),bc=Number(r[2]),bh=Number(r[3]),bl=Number(r[4]),ao=Number(r[5]),ac=Number(r[6]),ah=Number(r[7]),al=Number(r[8]),v=Number(r[9])||0;return {time:t,open:(bo+ao)/2,high:(bh+ah)/2,low:(bl+al)/2,close:(bc+ac)/2,volume:v};}).filter((b:FxcmBar)=>[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)).sort((a:FxcmBar,b:FxcmBar)=>a.time-b.time);
    if(!bars.length) throw new Error('FXCM returned no historical candles for '+symbol+'.');
    onDiagnostic?.({level:'info',code:'HISTORY_LOADED',message:'Loaded '+bars.length+' FXCM candles for '+symbol+' '+interval+'.'});
    return bars;
  };
  return {
    getBars,
    async getBarsPage({symbol,interval,before,countBack}:{symbol:string;interval:string;before:number;countBack:number}){return getBars({symbol,interval,countBack});},
    subscribeBars({symbol,interval}:{symbol:string;interval:string},onBar:(bar:FxcmBar)=>void,options?:{seedFrom?:FxcmBar}){
      stopped=false; let current=options?.seedFrom?{...options.seedFrom}:null;
      const seconds=FXCM_SECONDS[interval]||60;
      const run=async()=>{try{const r=await fetch('/api/sire/fxcm/quote?symbol='+encodeURIComponent(symbol),{cache:'no-store'});const p=await r.json();if(!r.ok||!p?.ok)throw new Error(p?.error||'FXCM quote failed');const q=p.quote;const epoch=Number(q.epoch),price=Number(q.price);if(!Number.isFinite(epoch)||!Number.isFinite(price))throw new Error('FXCM quote contains invalid price/time');const t=Math.floor(epoch/seconds)*seconds;
          if(!current||t>current.time) current={time:t,open:price,high:price,low:price,close:price,volume:0};
          else if(t===current.time) current={...current,high:Math.max(current.high,price),low:Math.min(current.low,price),close:price};
          last={symbol,price,epoch};onQuote?.(last);onBar({...current});
        }catch(e){onDiagnostic?.({level:'warning',code:'LIVE_PRICE_NOT_RECEIVED',message:'FXCM live price request failed.',detail:e instanceof Error?e.message:String(e)});}
        if(!stopped) timer=window.setTimeout(run,2000);};
      void run(); return ()=>{stopped=true;if(timer)window.clearTimeout(timer);timer=undefined;};
    },
    getLiveState(){return last?{connectionStatus:'polling',subscriptionStatus:stopped?'stopped':'active',latestTick:{...last},dataTimestamp:last.epoch,dataAgeMs:Math.max(0,Date.now()-last.epoch*1000),stale:Date.now()-last.epoch*1000>10000,staleThresholdMs:10000,checkedAt:Date.now()}: {connectionStatus:'idle',subscriptionStatus:'idle',latestTick:null,dataTimestamp:null,dataAgeMs:null,stale:false,staleThresholdMs:10000,checkedAt:Date.now()};},
    close(){stopped=true;if(timer)window.clearTimeout(timer);timer=undefined;}
  };
}
