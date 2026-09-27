import ccxt from 'ccxt';

type Quote = {
  exchange:string; exchangeName:string; symbol:string; price:number; epoch:number;
  bid?:number; ask?:number; volume?:number;
  source:'trade'|'ticker'|'ohlcv';
};

type StreamState = {
  key:string; exchangeId:string; symbol:string; exchange:any;
  quote:Quote|null; candle:any|null; stopped:boolean; lastAccess:number; lastUpdate:number;
  timer?:ReturnType<typeof setTimeout>; error?:string;
};

const streams=new Map<string,StreamState>();
const POLL_MS=2500;
const EXCHANGE_IDLE_MS=15*60*1000;

function getExchange(id:string){
  const key=String(id||'').trim().toLowerCase();
  const Exchange=(ccxt as any)[key];
  if(!Exchange) throw new Error('CCXT exchange "'+key+'" is not available in this build.');
  return new Exchange({enableRateLimit:true,timeout:20000});
}

async function ready(state:StreamState){
  if(!state.exchange.markets) await state.exchange.loadMarkets();
  const market=state.exchange.market(state.symbol);
  if(!market) throw new Error('Market "'+state.symbol+'" was not found on '+state.exchange.name+'.');
}

function number(v:any){const n=Number(v);return Number.isFinite(n)?n:undefined;}

function applyTrade(state:StreamState,trade:any){
  const price=number(trade?.price), ts=number(trade?.timestamp);
  if(price===undefined||price<=0) return null;
  const epoch=(ts&&ts>0?ts:Date.now())/1000;
  const bucket=Math.floor(epoch/60)*60;
  const amount=number(trade?.amount)||0;
  const old=state.candle;
  if(!old||bucket>old.time) state.candle={time:bucket,open:price,high:price,low:price,close:price,volume:amount};
  else if(bucket===old.time) state.candle={...old,high:Math.max(old.high,price),low:Math.min(old.low,price),close:price,volume:(old.volume||0)+amount};
  return {exchange:state.exchange.id,exchangeName:state.exchange.name||state.exchange.id,symbol:state.symbol,price,epoch,volume:amount,source:'trade' as const};
}

async function readLive(state:StreamState){
  await ready(state);
  if(state.exchange.has?.fetchTrades){
    try{
      const trades=await state.exchange.fetchTrades(state.symbol,undefined,50);
      const valid=(Array.isArray(trades)?trades:[]).filter((t:any)=>number(t?.price)!==undefined&&number(t?.timestamp)!==undefined);
      const latest=valid.length?valid[valid.length-1]:null;
      if(latest){
        // Rebuild the current minute from the exchange's recent trades so the
        // browser receives a real trade-derived candle, not a 24h ticker volume.
        state.candle=null;
        const now=Date.now();
        for(const trade of valid){
          const ts=number(trade?.timestamp);
          if(ts!==undefined&&ts>=now-60_000) applyTrade(state,trade);
        }
        const q=latest ? applyTrade(state,latest) : null;
        if(q) return q;
      }
    }catch(error){ state.error='trades: '+(error instanceof Error?error.message:String(error)); }
  }
  if(state.exchange.has?.fetchTicker){
    try{
      const t=await state.exchange.fetchTicker(state.symbol);
      const price=number(t?.last??t?.close??t?.bid??t?.ask), ts=number(t?.timestamp);
      if(price!==undefined&&price>0){
        const epoch=(ts&&ts>0?ts:Date.now())/1000, bucket=Math.floor(epoch/60)*60;
        const old=state.candle;
        if(!old||bucket>old.time) state.candle={time:bucket,open:price,high:price,low:price,close:price,volume:0};
        else if(bucket===old.time) state.candle={...old,high:Math.max(old.high,price),low:Math.min(old.low,price),close:price};
        return {exchange:state.exchange.id,exchangeName:state.exchange.name||state.exchange.id,symbol:state.symbol,price,epoch,bid:number(t?.bid),ask:number(t?.ask),volume:number(t?.baseVolume),source:'ticker' as const};
      }
    }catch(error){ state.error='ticker: '+(error instanceof Error?error.message:String(error)); }
  }
  if(state.exchange.has?.fetchOHLCV){
    const rows=await state.exchange.fetchOHLCV(state.symbol,'1m',undefined,2);
    const row=Array.isArray(rows)&&rows.length?rows[rows.length-1]:null;
    const price=number(row?.[4]), ts=number(row?.[0]);
    if(price!==undefined&&ts!==undefined) return {exchange:state.exchange.id,exchangeName:state.exchange.name||state.exchange.id,symbol:state.symbol,price,epoch:ts/1000,volume:number(row?.[5]),source:'ohlcv' as const};
  }
  throw new Error(state.error||state.exchange.name+' exposes no usable public trades, ticker, or OHLCV endpoint for '+state.symbol+'.');
}

async function loop(state:StreamState){
  if(state.stopped) return;
  try{
    state.quote=await readLive(state);
    state.lastUpdate=Date.now();
    state.error=undefined;
  }catch(error){state.error=error instanceof Error?error.message:String(error);}
  if(!state.stopped) state.timer=setTimeout(()=>void loop(state),POLL_MS);
}

function ensure(exchangeId:string,symbol:string){
  const key=String(exchangeId).toLowerCase()+':'+symbol;
  let state=streams.get(key);
  if(state){state.lastAccess=Date.now();return state;}
  state={key,exchangeId:String(exchangeId).toLowerCase(),symbol,exchange:getExchange(exchangeId),quote:null,candle:null,stopped:false,lastAccess:Date.now(),lastUpdate:0};
  streams.set(key,state);
  void loop(state);
  return state;
}

export async function getCcxtLiveQuote(exchangeId:string,symbol:string){
  const state=ensure(exchangeId,symbol); state.lastAccess=Date.now();
  if(!state.quote){
    await ready(state);
    try{state.quote=await readLive(state);state.lastUpdate=Date.now();}catch(error){state.error=error instanceof Error?error.message:String(error);}
  }
  if(!state.quote) throw new Error(state.error||'No live market data received for '+exchangeId+' '+symbol+'.');
  return {...state.quote,candle:state.candle,stream:{status:state.lastUpdate?'polling':'starting',lastUpdate:state.lastUpdate,dataAgeMs:Math.max(0,Date.now()-state.quote.epoch*1000),stale:Date.now()-state.quote.epoch*1000>15000,websocket:false,error:state.error||null}};
}

export function getCcxtLiveStatus(exchangeId?:string,symbol?:string){
  const rows=[...streams.values()].filter(s=>!exchangeId||s.exchangeId===exchangeId.toLowerCase()).filter(s=>!symbol||s.symbol===symbol).map(s=>({exchange:s.exchangeId,symbol:s.symbol,status:s.lastUpdate?'polling':'starting',source:s.quote?.source||null,lastUpdate:s.lastUpdate||null,dataAgeMs:s.quote?Math.max(0,Date.now()-s.quote.epoch*1000):null,stale:s.quote?Date.now()-s.quote.epoch*1000>15000:true,error:s.error||null}));
  return {count:rows.length,streams:rows};
}

export function stopCcxtLiveStream(exchangeId:string,symbol:string){
  const key=String(exchangeId).toLowerCase()+':'+symbol, state=streams.get(key);
  if(!state) return false;
  state.stopped=true; if(state.timer) clearTimeout(state.timer);
  try{state.exchange.close?.();}catch{}
  streams.delete(key); return true;
}

setInterval(()=>{
  const cutoff=Date.now()-EXCHANGE_IDLE_MS;
  for(const [key,state] of streams){
    if(state.lastAccess<cutoff){state.stopped=true;if(state.timer)clearTimeout(state.timer);try{state.exchange.close?.();}catch{};streams.delete(key);}
  }
},60000).unref?.();
