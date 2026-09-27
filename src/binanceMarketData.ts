import type { SireMarketQuote } from './marketDataRouter';

type Instrument={symbol:string;provider?:string;marketType?:string};
const SEC:Record<string,number>={'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'1w':604800,'1M':2592000};
const INTERVAL:Record<string,string>={'1m':'1min','3m':'3min','5m':'5min','15m':'15min','30m':'30min','1h':'1h','2h':'2h','4h':'4h','6h':'6h','8h':'8h','12h':'12h','1d':'1day','1w':'1week','1M':'1month'};

const SPOT_BASES=['https://api.binance.com','https://api-gcp.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com','https://api4.binance.com'];
async function directJson(urls:string[],params:Record<string,string>={}){
  let last:any;
  for(const base of urls){
    try{const u=new URL(base);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);const response=await fetch(u.toString(),{cache:'no-store'});const raw=await response.text();let data:any={};try{data=raw?JSON.parse(raw):{};}catch{}if(!response.ok)throw new Error('HTTP '+response.status+': '+String(data?.msg||raw.slice(0,200)));if(data?.code&&Number(data.code)<0)throw new Error('Binance '+data.code+': '+String(data.msg||'request failed'));return data;}catch(e){last=e;}
  }
  throw last||new Error('Binance browser market-data request failed.');
}
function browserItem(raw:any,marketType:string):any|null{
  const symbol=String(raw?.symbol||'').trim();if(!symbol)return null;
  const base=String(raw?.baseAsset||raw?.baseCoin||'').trim()||undefined;
  const quote=String(raw?.quoteAsset||raw?.quoteCoin||'').trim()||undefined;
  const status=String(raw?.status||raw?.contractStatus||'TRADING').toUpperCase();if(!['TRADING','PENDING_TRADING'].includes(status))return null;
  return {id:'BINANCE:'+marketType+':'+symbol,provider:'BINANCE',providerLabel:'Binance',marketType,category:'Crypto',symbol,displaySymbol:symbol,name:base&&quote?base+' / '+quote:symbol,base,quote,exchangeOpen:1,status:'online',logoUrl:base?'https://cdn.jsdelivr.net/gh/vadimmalykhin/binance-icons/crypto/'+encodeURIComponent(base.toLowerCase())+'.svg':'https://www.binance.com/favicon.ico',providerLogoUrl:'https://www.binance.com/favicon.ico',instrumentType:marketType,contractType:raw?.contractType||undefined,settlement:raw?.marginAsset||raw?.settleAsset||raw?.settleCoin||undefined,expiry:Number.isFinite(Number(raw?.deliveryDate??raw?.expiryDate))?Number(raw?.deliveryDate??raw?.expiryDate):undefined,strike:Number.isFinite(Number(raw?.strikePrice))?Number(raw.strikePrice):undefined,optionType:['CALL','PUT'].includes(String(raw?.side||'').toUpperCase())?String(raw.side).toUpperCase():undefined};
}
export async function fetchBinanceBrowserCatalogue():Promise<any[]>{
  const out:any[]=[];
  const add=(rows:any[],mt:string)=>{for(const r of rows||[]){const x=browserItem(r,mt);if(x)out.push(x)}};
  const spot=await directJson(SPOT_BASES.map(x=>x+'/api/v3/exchangeInfo'));add(spot?.symbols,'Spot');
  try{const usd=await directJson(['https://fapi.binance.com/fapi/v1/exchangeInfo']);for(const r of usd?.symbols||[]){const x=browserItem(r,String(r?.contractType||'')==='PERPETUAL'?'Perpetuals':'Futures');if(x)out.push(x)}}catch(e){console.warn('[SIRE BINANCE BROWSER] USD-M unavailable:',e)}
  try{const coin=await directJson(['https://dapi.binance.com/dapi/v1/exchangeInfo']);for(const r of coin?.symbols||[]){const x=browserItem(r,String(r?.contractType||'')==='PERPETUAL'?'Perpetuals':'Futures');if(x){x.id='BINANCE:COIN-M:'+x.marketType+':'+x.symbol;x.name=(x.base&&x.quote)?x.base+' / '+x.quote+' (COIN-M)':x.symbol;out.push(x)}}}catch(e){console.warn('[SIRE BINANCE BROWSER] COIN-M unavailable:',e)}
  try{const options=await directJson(['https://eapi.binance.com/eapi/v1/exchangeInfo']);for(const r of options?.optionSymbols||[]){const x=browserItem(r,'Options');if(x){x.name=String(r?.symbol||x.symbol);x.base=String(r?.underlying||'').replace(/USDT$|USDC$|BUSD$/,'')||x.base;x.quote=String(r?.quoteAsset||'').trim()||x.quote;x.optionType=String(r?.side||'').toUpperCase();out.push(x)}}}catch(e){console.warn('[SIRE BINANCE BROWSER] Options unavailable:',e)}
  const seen=new Set<string>();return out.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true});
}

export function createBinanceDataFeed(instrument:Instrument,onQuote?:(q:SireMarketQuote)=>void,onDiagnostic?:(e:any)=>void){
  let stopped=false,timer:any,last:any=null,current:any=null;
  const request=async(path:string,params:Record<string,string>)=>{try{const u=new URL(path,window.location.origin);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);const r=await fetch(u.toString(),{cache:'no-store'});const p=await r.json();if(r.ok&&p?.ok)return p;}catch{} const mt=String(params.marketType||'Spot');const symbol=String(params.symbol||''); if(path.includes('/history')){const iv=String(params.interval||'1min'),limit=String(params.count||'500');let base='https://api.binance.com';let endpoint='/api/v3/klines';if(mt==='Options'){base='https://eapi.binance.com';endpoint='/eapi/v1/klines';}else if(mt==='Perpetuals'||mt==='Futures'){if(symbol.includes('_')){base='https://dapi.binance.com';endpoint='/dapi/v1/klines';}else{base='https://fapi.binance.com';endpoint='/fapi/v1/klines';}}const p=await directJson([base+endpoint],{symbol,interval:iv,limit,...(params.from?{startTime:String(Math.floor(Number(params.from)*1000))}:{}),...(params.to?{endTime:String(Math.floor(Number(params.to)*1000))}: {})});return {ok:true,bars:(p||[]).map((r:any[])=>({time:Number(r[0])/1000,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])||0}))};}if(path.includes('/quote')){let base='https://api.binance.com',endpoint='/api/v3/ticker/24hr';if(mt==='Options'){base='https://eapi.binance.com';endpoint='/eapi/v1/mark';}else if(mt==='Perpetuals'||mt==='Futures'){base=symbol.includes('_')?'https://dapi.binance.com':'https://fapi.binance.com';endpoint=(symbol.includes('_')?'/dapi/v1/ticker/price':'/fapi/v1/ticker/price');}const p=await directJson([base+endpoint],{symbol});const row=Array.isArray(p)?(p[0]||{}):p;const price=Number(row?.lastPrice??row?.price??row?.markPrice);return {ok:true,quote:{symbol,epoch:Number(row?.closeTime||row?.time||Date.now())/1000,price,bid:Number(row?.bidPrice),ask:Number(row?.askPrice),volume:Number(row?.volume)||0}};}throw new Error('Unsupported Binance browser request.');};
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
      stopped=false;current=options?.seedFrom?{...options.seedFrom}:null;
      const seconds=SEC[interval]||60;
      let socket:any=null;
      let reconnect:any=null;
      const emit=(epoch:number,price:number,volume=0)=>{
        if(!Number.isFinite(epoch)||!Number.isFinite(price))return;
        const t=Math.floor(epoch/seconds)*seconds;
        if(!current||t>current.time)current={time:t,open:price,high:price,low:price,close:price,volume};
        else if(t===current.time)current={...current,high:Math.max(current.high,price),low:Math.min(current.low,price),close:price,volume:volume||current.volume||0};
        last={symbol,price,epoch};
        onQuote?.(last);onBar({...current});
      };
      const useSocket=mt=>{
        const s=symbol.toLowerCase();
        if(mt==='Spot'||mt==='Margin')return 'wss://stream.binance.com:9443/ws/'+s+'@aggTrade';
        if(mt==='Perpetuals'||mt==='Futures')return s.includes('_')?'wss://dstream.binance.com/ws/'+s+'@aggTrade':'wss://fstream.binance.com/ws/'+s+'@aggTrade';
        return '';
      };
      const connect=()=>{
        if(stopped)return;
        const mt=String(instrument.marketType||'Spot');
        const url=useSocket(mt);
        if(!url){void poll();return;}
        try{
          socket=new WebSocket(url);
          socket.onopen=()=>onDiagnostic?.({level:'info',code:'LIVE_STREAM_CONNECTED',message:'Binance WebSocket live stream connected for '+symbol+'.'});
          socket.onmessage=(event:any)=>{
            try{const m=JSON.parse(String(event.data));const price=Number(m?.p);const epoch=Number(m?.T??m?.E??Date.now())/1000;const volume=Number(m?.q)||0;if(Number.isFinite(price))emit(epoch,price,volume);}catch{}
          };
          socket.onerror=()=>onDiagnostic?.({level:'warning',code:'LIVE_STREAM_ERROR',message:'Binance WebSocket live stream error for '+symbol+'.'});
          socket.onclose=()=>{if(!stopped){onDiagnostic?.({level:'warning',code:'LIVE_STREAM_RECONNECTING',message:'Binance WebSocket disconnected; reconnecting '+symbol+'.'});reconnect=setTimeout(connect,1000);}};
        }catch{reconnect=setTimeout(connect,1000);}
      };
      const poll=async()=>{
        if(stopped)return;
        try{const p=await request('/api/sire/binance/quote',{symbol,marketType:String(instrument.marketType||'Spot')});const q=p.quote;emit(Number(q.epoch),Number(q.price),Number(q.volume));}
        catch(e){onDiagnostic?.({level:'warning',code:'LIVE_PRICE_NOT_RECEIVED',message:'Binance live price request failed for '+symbol+'.',detail:e instanceof Error?e.message:String(e)});}
        if(!stopped)timer=window.setTimeout(poll,1500);
      };
      connect();
      return()=>{stopped=true;if(timer)clearTimeout(timer);if(reconnect)clearTimeout(reconnect);try{socket?.close();}catch{}socket=null;timer=undefined;};
    },
    getLiveState(){return last?{connectionStatus:'polling',subscriptionStatus:stopped?'stopped':'active',latestTick:{...last},dataTimestamp:last.epoch,dataAgeMs:Math.max(0,Date.now()-last.epoch*1000),stale:Date.now()-last.epoch*1000>10000,staleThresholdMs:10000,checkedAt:Date.now()}:{connectionStatus:'idle',subscriptionStatus:'idle',latestTick:null,dataTimestamp:null,dataAgeMs:null,stale:false,staleThresholdMs:10000,checkedAt:Date.now()};},
    close(){stopped=true;if(timer)clearTimeout(timer);timer=undefined;}
  };
}
