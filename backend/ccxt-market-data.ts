import ccxt from 'ccxt';

const exchangeCache = new Map<string, any>();
function getExchange(id: string) {
  const key = String(id || '').trim().toLowerCase();
  if (!key) throw new Error('CCXT exchange id is required.');
  const Exchange = (ccxt as any)[key];
  if (!Exchange) throw new Error('CCXT exchange "' + key + '" is not available in this build.');
  let exchange = exchangeCache.get(key);
  if (!exchange) { exchange = new Exchange({ enableRateLimit: true, timeout: 20000 }); exchangeCache.set(key, exchange); }
  return exchange;
}
async function readyExchange(id: string) { const exchange=getExchange(id); if(!exchange.markets) await exchange.loadMarkets(); return exchange; }
function timeframeMs(exchange:any,timeframe:string) {
  try { const seconds=Number(exchange.parseTimeframe?.(timeframe)); if(Number.isFinite(seconds)&&seconds>0) return seconds*1000; } catch {}
  const fallback:Record<string,number>={'1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,'45m':2700000,'1h':3600000,'2h':7200000,'4h':14400000,'6h':21600000,'8h':28800000,'12h':43200000,'1d':86400000,'1w':604800000,'1M':2592000000};
  return fallback[timeframe]||60000;
}
export async function ccxtMarketCapabilities(exchangeId:string,symbol:string) {
  const exchange=await readyExchange(exchangeId); const market=exchange.market(symbol);
  if(!market) throw new Error('CCXT market "'+symbol+'" was not found on '+exchange.id+'.');
  return {exchange:exchange.id,exchangeName:exchange.name||exchange.id,symbol:market.symbol,marketId:market.id,type:market.type,active:market.active!==false,fetchOHLCV:Boolean(exchange.has?.fetchOHLCV),fetchTicker:Boolean(exchange.has?.fetchTicker),watchOHLCV:Boolean(exchange.has?.watchOHLCV),watchTicker:Boolean(exchange.has?.watchTicker),fetchTrades:Boolean(exchange.has?.fetchTrades),timeframes:exchange.timeframes||{}};
}
export async function ccxtMarketHistory(input:{exchangeId:string;symbol:string;timeframe:string;limit?:number;since?:number;until?:number}) {
  const exchange=await readyExchange(input.exchangeId); const symbol=String(input.symbol||'').trim(); const market=exchange.market(symbol);
  if(!market) throw new Error('CCXT market "'+symbol+'" was not found on '+exchange.id+'.');
  const canOHLCV=Boolean(exchange.has?.fetchOHLCV);
  const canTrades=Boolean(exchange.has?.fetchTrades);
  if(!canOHLCV && !canTrades) throw new Error(exchange.name+' exposes neither fetchOHLCV nor fetchTrades for '+symbol+'.');
  const timeframe=String(input.timeframe||'1m');
  if(canOHLCV && exchange.timeframes&&!exchange.timeframes[timeframe]) throw new Error(exchange.name+' does not support the '+timeframe+' candle timeframe for '+symbol+'.');
  const limit=Math.max(2,Math.min(1000,Math.floor(Number(input.limit)||500))); const intervalMs=timeframeMs(exchange,timeframe);
  let since=Number.isFinite(Number(input.since))?Math.floor(Number(input.since)):undefined;
  const until=Number.isFinite(Number(input.until))?Math.floor(Number(input.until)):undefined;
  if(until!==undefined&&since===undefined) since=Math.max(0,until-intervalMs*Math.max(limit,2));
  let rows:any[]=[];
  if(canOHLCV){
    rows=await exchange.fetchOHLCV(symbol,timeframe,since,limit);
  } else {
    const tradeSince=since===undefined?undefined:Math.max(0,since-intervalMs);
    const trades=await exchange.fetchTrades(symbol,tradeSince,Math.min(1000,Math.max(100,limit*4)));
    const buckets=new Map<number,any>();
    for(const t of Array.isArray(trades)?trades:[]){
      const ts=Number(t?.timestamp), price=Number(t?.price), amount=Number(t?.amount)||0;
      if(!Number.isFinite(ts)||!Number.isFinite(price)||price<=0) continue;
      const bucket=Math.floor(ts/intervalMs)*intervalMs;
      if(since!==undefined&&bucket<since) continue;
      if(until!==undefined&&bucket>=until) continue;
      const old=buckets.get(bucket);
      if(!old) buckets.set(bucket,{0:bucket,1:price,2:price,3:price,4:price,5:amount});
      else {old[2]=Math.max(old[2],price);old[3]=Math.min(old[3],price);old[4]=price;old[5]+=amount;}
    }
    rows=[...buckets.values()].sort((a,b)=>a[0]-b[0]).slice(-limit);
  }
  const bars=(Array.isArray(rows)?rows:[]).map((r:any[])=>({time:Number(r?.[0])/1000,open:Number(r?.[1]),high:Number(r?.[2]),low:Number(r?.[3]),close:Number(r?.[4]),volume:Number(r?.[5])||0}))
    .filter((b:any)=>[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite))
    .filter((b:any)=>since===undefined||b.time*1000>=since).filter((b:any)=>until===undefined||b.time*1000<until).sort((a:any,b:any)=>a.time-b.time);
  const unique=new Map<number,any>(); for(const bar of bars) unique.set(bar.time,bar); const cleanBars=[...unique.values()].sort((a,b)=>a.time-b.time);
  if(!cleanBars.length) throw new Error('CCXT returned no candles for '+exchange.name+' '+symbol+' '+timeframe+' in the requested history range.');
  return {exchange:exchange.id,exchangeName:exchange.name||exchange.id,symbol,timeframe,bars:cleanBars,requested:{limit,since:since??null,until:until??null},source:canOHLCV?'ohlcv':'trade-aggregation'};
}
export async function ccxtMarketQuote(exchangeId:string,symbol:string) {
  const exchange=await readyExchange(exchangeId); const market=exchange.market(symbol);
  if(!market) throw new Error('CCXT market "'+symbol+'" was not found on '+exchange.id+'.');
  let ticker:any=null; let tickerError='';
  if(exchange.has?.fetchTicker) { try { ticker=await exchange.fetchTicker(symbol); } catch(error) { tickerError=error instanceof Error?error.message:String(error); } }
  if(!ticker) {
    if(!exchange.has?.fetchOHLCV) throw new Error(tickerError||exchange.name+' does not expose a public live quote method through CCXT.');
    try {
      const rows=await exchange.fetchOHLCV(symbol,'1m',undefined,2); const row:any=Array.isArray(rows)&&rows.length?rows[rows.length-1]:null;
      const price=Number(row?.[4]); const epoch=Number(row?.[0])/1000;
      if(!Number.isFinite(price)||!Number.isFinite(epoch)) throw new Error('latest OHLCV did not contain a valid price');
      return {exchange:exchange.id,exchangeName:exchange.name||exchange.id,symbol,price,epoch,bid:undefined,ask:undefined,volume:Number.isFinite(Number(row?.[5]))?Number(row[5]):undefined,source:'ohlcv-fallback',tickerError:tickerError||undefined};
    } catch(fallbackError) { throw new Error('CCXT live quote failed for '+exchange.name+' '+symbol+': '+(tickerError||String(fallbackError))); }
  }
  const price=Number(ticker?.last??ticker?.close??ticker?.bid??ticker?.ask); const epoch=Number(ticker?.timestamp||Date.now())/1000;
  if(!Number.isFinite(price)||!Number.isFinite(epoch)) throw new Error('CCXT returned an invalid live quote for '+exchange.name+' '+symbol+'.');
  return {exchange:exchange.id,exchangeName:exchange.name||exchange.id,symbol,price,epoch,bid:Number.isFinite(Number(ticker?.bid))?Number(ticker.bid):undefined,ask:Number.isFinite(Number(ticker?.ask))?Number(ticker.ask):undefined,volume:Number.isFinite(Number(ticker?.baseVolume))?Number(ticker.baseVolume):undefined,source:'ticker'};
}