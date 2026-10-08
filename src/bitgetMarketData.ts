export type BitgetInstrument = {
  symbol:string;
  name:string;
  provider:'BITGET';
  exchange:'BITGET';
  marketGroup:string;
  marketType:string;
  category:string;
  marketSubcategory:string;
  marketSubSubcategory?:string;
  marketFilters:string[];
  marketFilter?:string;
  instrumentType:string;
  instrumentSubtype?:string;
  quote?:string;
  quoteAsset?:string;
  baseAsset?:string;
  settlement?:string;
  status?:string;
  pipSize?:number;
  onboardDate?:number;
  newListing?:boolean;
  margin?:boolean;
  marginEnabled?:boolean;
  isRwa?:boolean;
  isReality?:boolean;
  price?:number;
  bid?:number;
  ask?:number;
  priceChangePercent?:number;
  change24h?:number;
  volume24h?:number;
  quoteVolume?:number;
  high24h?:number;
  low24h?:number;
  open24h?:number;
  marketCap?:number;
  markPrice?:number;
  indexPrice?:number;
  fundingRate?:number;
  nextFundingTime?:number;
  openInterest?:number;
};

type Bar = {time:number;open:number;high:number;low:number;close:number;volume?:number};
type Diagnostic = {level:'info'|'warning'|'error';code:string;message:string;detail?:string};

const asNumber=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:NaN};
const categoryFor=(instrument:any)=>{
  const type=String(instrument?.marketType||'').toLowerCase();
  const sub=String(instrument?.marketSubcategory||'').toLowerCase();
  if(type.includes('margin')) return 'MARGIN';
  if(sub.includes('usdc')) return 'USDC-FUTURES';
  if(sub.includes('coin')) return 'COIN-FUTURES';
  if(type.includes('future')) return 'USDT-FUTURES';
  return 'SPOT';
};
const instTypeFor=(category:string)=>({SPOT:'spot',MARGIN:'spot', 'USDT-FUTURES':'usdt-futures','COIN-FUTURES':'coin-futures','USDC-FUTURES':'usdc-futures'} as Record<string,string>)[category]||'spot';
const intervalMap:Record<string,string>={'1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','2h':'2H','4h':'4H','6h':'6H','8h':'8H','12h':'12H','1d':'1D','3d':'3D','1w':'1W','1M':'1M'};

export async function fetchBitgetInstruments():Promise<BitgetInstrument[]>{
  const response=await fetch('/api/sire/bitget/catalog?source=market-tab&t='+Date.now(),{cache:'no-store',headers:{Accept:'application/json'}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload?.ok||!Array.isArray(payload?.instruments)) throw new Error(payload?.error||'Bitget native catalog is unavailable.');
  return payload.instruments as BitgetInstrument[];
}

async function getBars(instrument:any,symbol:string,interval:string,end?:number,limit=1000,onDiagnostic?:(e:Diagnostic)=>void):Promise<Bar[]>{
  const category=categoryFor(instrument);
  const native=intervalMap[interval]||'1m';
  const params=new URLSearchParams({category,symbol:String(symbol).toUpperCase(),interval:native,limit:String(Math.max(1,Math.min(1000,Math.floor(limit))))});
  if(Number.isFinite(end)) params.set('endTime',String(Math.floor(Number(end)*1000)));
  const response=await fetch('https://api.bitget.com/api/v3/market/candles?'+params.toString(),{cache:'no-store',headers:{Accept:'application/json'}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||payload?.code!=='00000') throw new Error(String(payload?.msg||'Bitget candle request failed.'));
  const rows=Array.isArray(payload?.data)?payload.data:[];
  const bars=rows.map((r:any)=>({time:Math.floor(Number(r?.[0])/1000),open:Number(r?.[1]),high:Number(r?.[2]),low:Number(r?.[3]),close:Number(r?.[4]),volume:Number(r?.[5])||0})).filter((b:Bar)=>Number.isFinite(b.time)&&[b.open,b.high,b.low,b.close].every(Number.isFinite));
  onDiagnostic?.({level:bars.length?'info':'warning',code:'BITGET_HISTORY_LOADED',message:'Loaded '+bars.length+' Bitget candles for '+symbol+'.'});
  return bars.sort((a,b)=>a.time-b.time);
}

function socketFeed(instrument:any,symbol:string,interval:string,onQuote:(q:any)=>void,onBar:(b:Bar)=>void,onDiagnostic?:(e:Diagnostic)=>void){
  let socket:WebSocket|null=null, stopped=false, timer:number|undefined, current:Bar|null=null;
  const connect=()=>{
    if(stopped)return;
    try{socket=new WebSocket('wss://ws.bitget.com/v3/ws/public');}catch(e){onDiagnostic?.({level:'error',code:'BITGET_WS_CREATE_FAILED',message:String(e)});return;}
    socket.onopen=()=>{
      const category=categoryFor(instrument), arg={instType:instTypeFor(category),topic:'kline',symbol:String(symbol).toUpperCase(),interval:intervalMap[interval]||'1m'};
      socket?.send(JSON.stringify({op:'subscribe',args:[arg]}));
      onDiagnostic?.({level:'info',code:'BITGET_WS_CONNECTED',message:'Bitget live candle stream connected.',detail:JSON.stringify(arg)});
    };
    socket.onmessage=event=>{
      const raw=String(event.data);
      if(raw==='pong')return;
      try{
        const msg=JSON.parse(raw);
        if(msg?.event==='error'){onDiagnostic?.({level:'error',code:'BITGET_WS_SUBSCRIBE_ERROR',message:String(msg?.msg||'Bitget subscription error.')});return;}
        const rows=Array.isArray(msg?.data)?msg.data:[];
        for(const r of rows){
          const b:Bar={time:Math.floor(Number(r?.[0])/1000),open:Number(r?.[1]),high:Number(r?.[2]),low:Number(r?.[3]),close:Number(r?.[4]),volume:Number(r?.[5])||0};
          if(!Number.isFinite(b.time)||![b.open,b.high,b.low,b.close].every(Number.isFinite))continue;
          current=b; onBar({...b}); onQuote({provider:'BITGET',symbol:String(symbol).toUpperCase(),price:b.close,epoch:Date.now()/1000,open:b.open,high:b.high,low:b.low,volume:b.volume});
        }
      }catch{}
    };
    socket.onclose=()=>{if(!stopped){timer=window.setTimeout(()=>{timer=undefined;connect()},1500)}};
  };
  connect();
  const heartbeat=window.setInterval(()=>{try{if(socket?.readyState===WebSocket.OPEN)socket.send('ping')}catch{}},30000);
  return {close:()=>{stopped=true;window.clearInterval(heartbeat);if(timer!==undefined)window.clearTimeout(timer);try{socket?.close()}catch{}},getCurrentBar:()=>current?{...current}:null};
}

export function createBitgetDataFeed(instrument:any,onQuote?:(quote:{symbol:string;price:number;epoch:number;bid?:number;ask?:number})=>void,onDiagnostic?:(event:Diagnostic)=>void){
  let currentInstrument=instrument;
  let live:any=null;
  return {
    async getBars({symbol,interval,countBack}:{symbol:string;interval:string;from?:number;to?:number;countBack?:number}){
      const wanted=Math.max(1,Math.min(5000,Math.floor(Number(countBack)||500)));
      const page=await getBars(currentInstrument,symbol,interval,undefined,Math.min(1000,wanted),onDiagnostic);
      return page.slice(-wanted);
    },
    async getBarsPage({symbol,interval,before,countBack}:{symbol:string;interval:string;before:number;countBack:number}){
      const page=await getBars(currentInstrument,symbol,interval,before-1,Math.min(1000,countBack),onDiagnostic);
      const older=page.filter(b=>b.time<before);
      return {bars:older,hasMore:older.length>0,nextBefore:older[0]?.time};
    },
    subscribeBars({symbol,interval}:{symbol:string;interval:string},onBar:(bar:Bar)=>void,options?:{seedFrom?:Bar}){
      live?.close(); let stopped=false; let current=options?.seedFrom?{...options.seedFrom}:null;
      const stream=socketFeed(currentInstrument,symbol,interval,q=>onQuote?.(q),bar=>{
        if(stopped)return;
        if(current&&bar.time<current.time)return;
        current=current&&bar.time===current.time?{...current,high:Math.max(current.high,bar.high),low:Math.min(current.low,bar.low),close:bar.close,volume:bar.volume}:bar;
        onBar({...current});
      },onDiagnostic);
      live=stream;
      return ()=>{stopped=true;if(live===stream)live=null;stream.close()};
    },
    setInstrument(next:any){currentInstrument=next},
    getLiveState(){return {connectionStatus:live?'connected':'disconnected',subscriptionStatus:live?'active':'idle',latestTick:null,dataTimestamp:null,dataAgeMs:null,stale:false,staleThresholdMs:30000,checkedAt:Date.now()}},
    close(){live?.close();live=null}
  };
}
