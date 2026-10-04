import { DERIV_INTERVAL_SECONDS, tickToBar, type DerivBar, type DerivFeedDiagnostic } from './derivMarketData';

export type BinanceInstrument = {
  symbol: string; name: string; provider: 'BINANCE'; exchange: string;
  marketGroup: 'CRYPTO' | 'TRADE FI'; marketType: string; category: string;
  marketSubcategory: string; marketSubSubcategory?: string; marketFilters: string[];
  marketFilter?: string; instrumentType: string; instrumentSubtype?: string;
  quote?: string; baseAsset?: string; settlement?: string; status?: string;
  pipSize?: number; onboardDate?: number; expiry?: number; newListing?: boolean; margin?: boolean; price?: number; priceChangePercent?: number; change24h?: number; volume24h?: number; high24h?: number; low24h?: number; marketCap?: number; fdv?: number; liquidity?: number; holders?: number; listedAt?: number;
};
export type BinanceTick = {
  provider: 'BINANCE'; symbol: string; price: number; epoch: number;
  open?: number; high?: number; low?: number; volume?: number; quoteVolume?: number;
  bid?: number; ask?: number; percent?: number; marketCap?: number;
};
const SPOT='https://api.binance.com', UM='https://fapi.binance.com', CM='https://dapi.binance.com';
const ALPHA='https://www.binance.com', ALPHA_WS='wss://nbstream.binance.com/w3w/wsa/stream';
const n=(v:unknown)=>{const x=Number(v);return Number.isFinite(x)?x:undefined;};
const s=(v:unknown)=>String(v??'').trim();
const uniq=(a:string[])=>[...new Set(a.map(s).filter(Boolean))];
const isTradFi=(a:string[])=>a.some(v=>v.toLowerCase()==='tradfi');
function quoteBucket(q:string){q=q.toUpperCase();if(['USDT','USDC','U','USD1','USD','BNB','BTC','ETH','BTCC'].includes(q))return q;if(['EUR','GBP','AUD','BRL','TRY','RUB','ZAR','NGN','JPY','PLN','RON','UAH','CHF','CAD','HKD','SGD','MXN','ARS'].includes(q))return 'FIAT';return 'ALTs';}

function spot(raw:any):BinanceInstrument|null{
  const symbol=s(raw?.symbol); if(!symbol)return null;
  const quote=s(raw?.quoteAsset), base=s(raw?.baseAsset), margin=Boolean(raw?.isMarginTradingAllowed), qb=quoteBucket(quote);
  const tick=n(raw?.filters?.find?.((f:any)=>f?.filterType==='PRICE_FILTER')?.tickSize);
  return {symbol,name:base+'/'+quote,provider:'BINANCE',exchange:'BINANCE',marketGroup:'CRYPTO',
    marketType:'Spot',category:'Spot',marketSubcategory:qb,marketSubSubcategory:qb,
    marketFilters:uniq([qb,'Spot',...(margin?['Margin']:[])]),marketFilter:qb,instrumentType:'Crypto Spot',
    quote,baseAsset:base,status:s(raw?.status),pipSize:tick,margin};
}
function tradfiClass(base:string, subs:string[]) {
  if (subs.some(v=>v.toLowerCase()==='pre-ipo')) return 'Pre-IPO';
  const b=base.toUpperCase();
  if (/^(EURUSD|GBPUSD|USDJPY|USDCHF|AUDUSD|USDCAD|NZDUSD|EURGBP|EURJPY|GBPJPY)$/.test(b)) return 'Fx';
  if (['XAU','XAG','XPT','XPD','COPPER','CL','BZ','NG','HO','RB','GOLD','SILVER'].includes(b)) return 'Commodities';
  if (['SPY','QQQ','IWM','DIA','TLT','GLD','SLV','USO','UNG','EEM','EWJ','EWY','FXI','XLE','XLK','XLF','XLV','XLI','XLP','XLU','ARKK'].includes(b)) return 'ETFs';
  return 'Stocks';
}
function future(raw:any,kind:'USDT-M'|'COIN-M',now:number):BinanceInstrument|null{
  const symbol=s(raw?.symbol);if(!symbol)return null;
  const subs=uniq(Array.isArray(raw?.underlyingSubType)?raw.underlyingSubType:[]), tradfi=isTradFi(subs);
  const base=s(raw?.baseAsset),quote=s(raw?.quoteAsset),ct=s(raw?.contractType),onboard=n(raw?.onboardDate),expiry=n(raw?.deliveryDate),tradfiKind=tradfi?tradfiClass(base,subs):undefined;
  return {symbol,name:base+(quote?'/'+quote:'')+(ct==='PERPETUAL'?' Perpetual':' '+ct),provider:'BINANCE',exchange:'BINANCE',
    marketGroup:tradfi?'TRADE FI':'CRYPTO',marketType:'Futures',category:tradfi?'TradFi Futures':'Futures',
    marketSubcategory:kind,marketSubSubcategory:tradfiKind||subs[0]||'All',
    marketFilters:uniq([...subs,...(tradfiKind?[tradfiKind]:[]),kind,ct==='PERPETUAL'?'Perpetual':'Expiring',quote]),marketFilter:tradfiKind||subs[0]||kind,
    instrumentType:tradfi?'TradFi Futures':'Crypto Futures',instrumentSubtype:subs.join(', '),quote,baseAsset:base,
    settlement:kind,status:s(raw?.status||raw?.contractStatus),pipSize:n(raw?.filters?.find?.((f:any)=>f?.filterType==='PRICE_FILTER')?.tickSize),
    onboardDate:onboard,expiry,newListing:Number.isFinite(onboard)?now-Number(onboard)<30*86400000:false};
}
async function json(url:string){const r=await fetch(url,{cache:'no-store',headers:{Accept:'application/json'}});const t=await r.text();let d:any={};try{d=t?JSON.parse(t):{};}catch{throw new Error('Binance returned invalid JSON.');}if(!r.ok)throw new Error('Binance HTTP '+r.status+': '+s(d?.msg||d?.message||t).slice(0,300));return d;}

export async function fetchBinanceInstruments():Promise<BinanceInstrument[]> {
  const response = await fetch('/api/sire/binance/catalog', { cache:'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok || !Array.isArray(payload.instruments)) {
    throw new Error(payload?.error || 'Binance native catalog is unavailable.');
  }
  return payload.instruments as BinanceInstrument[];
}

type Handler=(tick:BinanceTick)=>void;
type Bus={socket:WebSocket|null;handlers:Map<string,Set<Handler>>;url:string;timer?:number;connecting?:boolean};
type FastBus=Bus&{symbols:Set<string>;subscribeTimer?:number;requestId:number;latest:Map<string,BinanceTick>;lastTradeAt:Map<string,number>;lastMarkAt:Map<string,number>};
const buses=new Map<string,Bus>();
const fastBuses=new Map<string,FastBus>();

function venue(item:any){const t=s(item?.marketType).toUpperCase();if(t==='ALPHA')return 'ALPHA';if(t==='FUTURES')return s(item?.marketSubcategory).toUpperCase()==='COIN-M'?'COIN':'UM';return 'SPOT';}

function url(v:string){
  if(v==='SPOT') return 'wss://stream.binance.com:9443/ws/!miniTicker@arr';
  if(v==='UM') return 'wss://fstream.binance.com/market/stream?streams=!miniTicker@arr';
  if(v==='COIN') return 'wss://dstream.binance.com/stream?streams=!miniTicker@arr';
  return ALPHA_WS+'?streams=!miniTicker@arr';
}

function fastUrl(v:string){
  if(v==='SPOT') return 'wss://stream.binance.com:9443/stream';
  if(v==='UM') return 'wss://fstream.binance.com/market/stream';
  if(v==='COIN') return 'wss://dstream.binance.com/stream';
  if(v==='ALPHA') return ALPHA_WS;
  return '';
}

function parse(raw:any):BinanceTick|null{
  const d=raw?.data&&typeof raw.data==='object'?raw.data:raw;
  const symbol=s(d?.s), event=s(d?.e);
  const tradePrice=event==='aggTrade'?n(d?.p):n(d?.c);
  if(!symbol||tradePrice===undefined)return null;
  const open=n(d?.o),epoch=n(d?.E)||Date.now();
  const percent=n(d?.P) ?? (open && open!==0 ? ((tradePrice-open)/open)*100 : undefined);
  return {
    provider:'BINANCE', symbol, price:tradePrice, epoch:Math.floor(epoch/1000), open,
    high:n(d?.h), low:n(d?.l), volume:n(d?.v), quoteVolume:n(d?.q), percent,
  };
}

function emitBusMessage(b:Bus, raw:any){
  const p=raw?.data&&typeof raw.data==='object' ? raw.data : raw;
  const t=parse(p);
  if(!t)return;
  const hs=b.handlers.get(t.symbol);
  if(hs)for(const h of hs)h(t);
}

function bus(v:string){
  let b=buses.get(v);if(b?.socket?.readyState===WebSocket.OPEN||b?.connecting)return b!;
  b=b||{socket:null,handlers:new Map(),url:url(v)};b.connecting=true;buses.set(v,b);
  const ws=new WebSocket(b.url);b.socket=ws;
  const retry=()=>{b!.connecting=false;b!.timer=window.setTimeout(()=>bus(v),1500);};
  ws.onopen=()=>{b!.connecting=false;};
  ws.onmessage=e=>{try{const p=JSON.parse(String(e.data));const a=Array.isArray(p)?p:Array.isArray(p?.data)?p.data:[p];for(const raw of a)emitBusMessage(b!,raw);}catch{}};
  ws.onerror=()=>{};ws.onclose=retry;return b;
}

function fastBus(v:string){
  let b=fastBuses.get(v);
  if(b?.socket?.readyState===WebSocket.OPEN||b?.connecting)return b!;
  b=b||{socket:null,handlers:new Map(),url:fastUrl(v),symbols:new Set(),requestId:0,latest:new Map(),lastTradeAt:new Map(),lastMarkAt:new Map()};
  b.connecting=true;buses.delete(v);fastBuses.set(v,b);
  const ws=new WebSocket(b.url);b.socket=ws;
  const queueSubscribe=()=>{
    if(!b?.symbols.size||b.subscribeTimer!==undefined)return;
    b.subscribeTimer=window.setTimeout(()=>{
      b!.subscribeTimer=undefined;
      if(b!.socket?.readyState!==WebSocket.OPEN||!b!.symbols.size)return;
      const bootstrap=v==='ALPHA' ? ['!ticker@arr'] : ['!miniTicker@arr'];
      const params=bootstrap.concat([...b!.symbols].flatMap(symbol=>v==='COIN' ? [symbol.toLowerCase()+'@ticker',symbol.toLowerCase()+'@trade',symbol.toLowerCase()+'@markPrice@1s'] : [symbol.toLowerCase()+'@ticker',symbol.toLowerCase()+'@trade']));
      b!.socket.send(JSON.stringify({method:'SUBSCRIBE',params,id:++b!.requestId}));
    },100);
  };
  ws.onopen=()=>{b!.connecting=false;queueSubscribe();};
  ws.onmessage=e=>{try{const p=JSON.parse(String(e.data));if(p?.id||p?.result!==undefined)return;const payload=p?.data&&typeof p.data==='object'?p.data:p;const messages=Array.isArray(payload)?payload:[payload];for(const d of messages){const symbol=s(d?.s),event=s(d?.e);if(!symbol)continue;if(event==='24hrMiniTicker'){const px=n(d?.c);if(px===undefined)continue;const now=Date.now();const prev=b!.latest.get(symbol);const recentTrade=now-(b!.lastTradeAt.get(symbol)||0)<5000;const recentMark=v==='COIN'&&now-(b!.lastMarkAt.get(symbol)||0)<2000;const t:BinanceTick={...(prev||{provider:'BINANCE',symbol,price:px,epoch:Math.floor(now/1000)}),provider:'BINANCE',symbol,price:(recentTrade||recentMark)&&prev?prev.price:px,epoch:Math.floor((n(d?.E)||now)/1000),high:n(d?.h),low:n(d?.l),volume:n(d?.v),quoteVolume:n(d?.q)};b!.latest.set(symbol,t);const hs=b!.handlers.get(symbol);if(hs)for(const h of hs)h(t);continue;}if(event==='trade'||event==='aggTrade'){const px=n(d?.p);if(px===undefined)continue;const now=Date.now();b!.lastTradeAt.set(symbol,now);const prev=b!.latest.get(symbol);const t:BinanceTick={...(prev||{provider:'BINANCE',symbol,price:px,epoch:Math.floor(now/1000)}),provider:'BINANCE',symbol,price:px,epoch:Math.floor((n(d?.E)||now)/1000)};b!.latest.set(symbol,t);const hs=b!.handlers.get(symbol);if(hs)for(const h of hs)h(t);continue;}if(event==='markPriceUpdate'&&v==='COIN'){const px=n(d?.p);if(px===undefined)continue;const now=Date.now();if(now-(b!.lastTradeAt.get(symbol)||0)<5000)continue;const prev=b!.latest.get(symbol);const t:BinanceTick={...(prev||{provider:'BINANCE',symbol,price:px,epoch:Math.floor(now/1000)}),provider:'BINANCE',symbol,price:px,epoch:Math.floor((n(d?.E)||now)/1000)};b!.lastMarkAt.set(symbol,now);b!.latest.set(symbol,t);const hs=b!.handlers.get(symbol);if(hs)for(const h of hs)h(t);continue;}const t=parse(d);if(!t)continue;const prev=b!.latest.get(t.symbol);const recentTrade=Date.now()-(b!.lastTradeAt.get(t.symbol)||0)<5000;const recentMark=v==='COIN'&&Date.now()-(b!.lastMarkAt.get(t.symbol)||0)<2000;if((recentTrade||recentMark)&&prev)t.price=prev.price;b!.latest.set(t.symbol,t);const hs=b!.handlers.get(t.symbol);if(hs)for(const h of hs)h(t);}}catch{}};
  ws.onerror=()=>{};
  ws.onclose=()=>{
    b!.connecting=false;
    b!.socket=null;
    if(b!.subscribeTimer!==undefined){window.clearTimeout(b!.subscribeTimer);b!.subscribeTimer=undefined;}
    if(b!.symbols.size)b!.timer=window.setTimeout(()=>fastBus(v),1000);
  };
  queueSubscribe();
  return b;
}

export function subscribeBinanceTick(item:any,handler:Handler){
  const v=venue(item),symbol=s(item?.symbol);if(!symbol)return()=>{};
  // Binance's per-symbol 24h ticker stream is real-time and carries the
  // authoritative rolling 24h percent/volume fields as well as last price.
  // Use one persistent exchange-native stream per venue. Ticker supplies the
  // authoritative 24h fields; trade supplies the immediate last-price path.
  // This mirrors the common exchange-client pattern of merging fast trades
  // into a cached ticker snapshot instead of waiting for the slower ticker tick.
  if(v==='SPOT'||v==='UM'||v==='COIN'||v==='ALPHA'){
    const b=fastBus(v);let set=b.handlers.get(symbol);
    if(!set){set=new Set();b.handlers.set(symbol,set);b.symbols.add(symbol);}
    set.add(handler);
    if(b.socket?.readyState===WebSocket.OPEN){
      const params=v==='COIN' ? [symbol.toLowerCase()+'@ticker',symbol.toLowerCase()+'@trade',symbol.toLowerCase()+'@markPrice@1s'] : [symbol.toLowerCase()+'@ticker',symbol.toLowerCase()+'@trade'];
      try{b.socket.send(JSON.stringify({method:'SUBSCRIBE',params,id:++b.requestId}));}catch{}
    }
    return()=>{
      set!.delete(handler);
      if(!set!.size){
        b!.handlers.delete(symbol);
        b!.symbols.delete(symbol);
        if(b!.socket?.readyState===WebSocket.OPEN){
          try{const params=v==='COIN' ? [symbol.toLowerCase()+'@ticker',symbol.toLowerCase()+'@trade',symbol.toLowerCase()+'@markPrice@1s'] : [symbol.toLowerCase()+'@ticker',symbol.toLowerCase()+'@trade'];b!.socket.send(JSON.stringify({method:'UNSUBSCRIBE',params,id:++b!.requestId}));}catch{}
        }
      }
    };
  }
  const b=bus(v);let set=b.handlers.get(symbol);
  if(!set){set=new Set();b.handlers.set(symbol,set);}set.add(handler);
  return()=>{set!.delete(handler);if(!set!.size)b!.handlers.delete(symbol);};
}
function aggregate(bars:DerivBar[],sec:number){if(sec<=60)return bars;const out:DerivBar[]=[];for(const x of bars){const t=Math.floor(x.time/sec)*sec,p=out[out.length-1];if(!p||p.time!==t)out.push({...x,time:t});else{p.high=Math.max(p.high,x.high);p.low=Math.min(p.low,x.low);p.close=x.close;p.volume+=x.volume;}}return out;}
function native(i:string){return new Set(['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M']).has(i)?i:'1m';}
function base(item:any){const t=s(item?.marketType).toUpperCase();if(t==='ALPHA')return ALPHA+'/bapi/defi/v1/public/alpha-trade';if(t==='FUTURES'&&s(item?.marketSubcategory).toUpperCase()==='COIN-M')return CM+'/dapi/v1';if(t==='FUTURES')return UM+'/fapi/v1';return SPOT+'/api/v3';}
async function bars(item:any,interval:string,from?:number,to?:number,count=500){
  const sec=intervalSeconds[interval]||60,ni=native(interval),mult=ni==='1m'&&sec>60?Math.ceil(sec/60):1;
  const q=new URLSearchParams({symbol:s(item.symbol),interval:ni,limit:String(Math.min(1500,Math.max(2,count*mult)))});
  if(Number.isFinite(from))q.set('startTime',String(Math.floor(Number(from)*1000)));if(Number.isFinite(to))q.set('endTime',String(Math.floor(Number(to)*1000)));
  const d=await json(base(item)+'/klines?'+q),rows=Array.isArray(d)?d:Array.isArray(d?.data)?d.data:[];
  return aggregate(rows.map((r:any)=>({time:Math.floor(Number(r[0])/1000),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])||0})).filter((x:DerivBar)=>Number.isFinite(x.time)&&[x.open,x.high,x.low,x.close].every(Number.isFinite)),sec).sort((a,b)=>a.time-b.time);
}

export function createBinanceDataFeed(instrument:any,onQuote?:(q:BinanceTick)=>void,onDiagnostic?:(e:DerivFeedDiagnostic)=>void){
  let stopped=false,off:(()=>void)|null=null,latest:BinanceTick|null=null;let subscriptionStatus:'idle'|'connecting'|'active'|'error'|'stopped'='idle';
  const emit=(level:any,code:string,message:string,detail?:string)=>onDiagnostic?.({level,code,message,detail});
  return {
    async getBars({symbol,interval,from,to,countBack}:any){emit('info','HISTORY_REQUEST_STARTED','OpenAlgo requested '+interval+' history for '+symbol+' from Binance.');try{const x=await bars({...instrument,symbol},interval,from,to,countBack||500);if(!x.length)throw new Error('Binance returned no historical candles for '+symbol+'.');emit('info','HISTORY_LOADED','Loaded '+x.length+' candles for '+symbol+' '+interval+' from Binance.');return x;}catch(e){emit('error','HISTORY_LOAD_FAILED','Binance historical candles failed: '+(e instanceof Error?e.message:String(e)));throw e;}},
    async getBarsPage({symbol,interval,before,countBack}:any){const x=await bars({...instrument,symbol},interval,undefined,before,countBack||500),older=x.filter(z=>z.time<before);return{bars:older,hasMore:older.length>0,nextBefore:older[0]?.time};},
    subscribeBars({symbol,interval}:any,onBar:(bar:DerivBar)=>void,options?:{seedFrom?:DerivBar}){subscriptionStatus='connecting';let current=options?.seedFrom?{...options.seedFrom}:null;off?.();off=subscribeBinanceTick({...instrument,symbol},tick=>{if(stopped)return;latest=tick;subscriptionStatus='active';current=tickToBar(current,tick.epoch,tick.price,intervalSeconds[interval]||60);onQuote?.(tick);onBar({...current});});return()=>{subscriptionStatus='stopped';off?.();off=null;};},
    getLiveState(){const age=latest?.epoch?Math.max(0,Date.now()-latest.epoch*1000):null;return{connectionStatus:latest?'connected':'connecting',subscriptionStatus,latestTick:latest,dataTimestamp:latest?.epoch??null,dataAgeMs:age,stale:age!==null?age>30000:false,staleThresholdMs:30000,checkedAt:Date.now()};},
    close(){stopped=true;off?.();off=null;}
  };
}
