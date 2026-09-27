export type BinanceInstrument = {
  id:string; provider:'BINANCE'; providerLabel:'Binance'; marketType:string; category:'Crypto';
  symbol:string; displaySymbol:string; name:string; base?:string; quote?:string;
  exchangeOpen:number; status:string; logoUrl:string; providerLogoUrl:string;
  instrumentType:string; contractType?:string; settlement?:string; expiry?:number; strike?:number; optionType?:string;
};

async function getJson(url:string){
  const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'SIRE-Binance-MarketData/1.0'},signal:AbortSignal.timeout(15000)});
  const raw=await response.text(); let data:any={}; try{data=raw?JSON.parse(raw):{};}catch{}
  if(!response.ok) throw new Error('Binance HTTP '+response.status+': '+String(data?.msg||raw.slice(0,300)));
  if(data?.code && Number(data.code)<0) throw new Error('Binance API '+data.code+': '+String(data.msg||'request failed'));
  return data;
}
const assetLogo=(base?:string)=>{const v=String(base||'').toLowerCase();return v?'https://cdn.jsdelivr.net/gh/vadimmalykhin/binance-icons/crypto/'+encodeURIComponent(v)+'.svg':''};
const providerLogo='https://www.binance.com/favicon.ico';

function item(raw:any,marketType:string):BinanceInstrument|null{
  const symbol=String(raw?.symbol||'').trim(); if(!symbol)return null;
  const base=String(raw?.baseAsset||raw?.baseCoin||raw?.base||'').trim()||undefined;
  const quote=String(raw?.quoteAsset||raw?.quoteCoin||raw?.quoteCurrency||raw?.quote||'').trim()||undefined;
  const status=String(raw?.status||raw?.contractStatus||'TRADING').toUpperCase();
  if(!['TRADING','PENDING_TRADING'].includes(status))return null;
  const contractType=String(raw?.contractType||'').trim()||undefined;
  const expiry=Number(raw?.deliveryDate??raw?.expiryDate);
  const strike=Number(raw?.strikePrice);
  const optionType=String(raw?.side||'').toUpperCase();
  const mt=marketType;
  return {id:'BINANCE:'+mt+':'+symbol,provider:'BINANCE',providerLabel:'Binance',marketType:mt,category:'Crypto',symbol,displaySymbol:symbol,name:base&&quote?base+' / '+quote:symbol,base,quote,exchangeOpen:1,status:'online',logoUrl:assetLogo(base)||providerLogo,providerLogoUrl:providerLogo,instrumentType:mt,contractType,settlement:String(raw?.marginAsset||raw?.settleAsset||raw?.settleCoin||'').trim()||undefined,expiry:Number.isFinite(expiry)?expiry:undefined,strike:Number.isFinite(strike)?strike:undefined,optionType:optionType==='CALL'||optionType==='PUT'?optionType:undefined};
}

export async function getBinanceCatalogue():Promise<BinanceInstrument[]>{
  const out:BinanceInstrument[]=[];
  const add=(rows:any[],mt:string)=>{for(const r of rows||[]){const x=item(r,mt);if(x)out.push(x)}};
  const spot=await getJson('https://api.binance.com/api/v3/exchangeInfo');
  add(spot?.symbols,'Spot');
  try{const margin=await getJson('https://api.binance.com/sapi/v1/margin/allPairs');add(margin,'Margin')}catch(e){console.warn('[SIRE BINANCE] Cross Margin catalogue unavailable:',e)}
  try{const isolated=await getJson('https://api.binance.com/sapi/v1/margin/isolated/allPairs');add(isolated,'Isolated Margin')}catch(e){console.warn('[SIRE BINANCE] Isolated Margin catalogue unavailable:',e)}
  // USD-M futures: PERPETUAL and dated delivery contracts are both exposed by the
  // official exchangeInfo endpoint and must remain distinct in SIRE.
  const usd=await getJson('https://fapi.binance.com/fapi/v1/exchangeInfo');
  for(const r of usd?.symbols||[]){const ct=String(r?.contractType||''); const x=item(r,ct==='PERPETUAL'?'Perpetuals':'Futures'); if(x)out.push(x)}
  // COIN-M futures likewise contains perpetual and dated contracts.
  const coin=await getJson('https://dapi.binance.com/dapi/v1/exchangeInfo');
  for(const r of coin?.symbols||[]){const ct=String(r?.contractType||''); const x=item(r,ct==='PERPETUAL'?'Perpetuals':'Futures'); if(x){x.id='BINANCE:COIN-M:'+x.marketType+':'+x.symbol;x.name=(x.base&&x.quote)?x.base+' / '+x.quote+' (COIN-M)':x.symbol;out.push(x)}}
  const options=await getJson('https://eapi.binance.com/eapi/v1/exchangeInfo');
  for(const r of options?.optionSymbols||[]){const x=item(r,'Options');if(x){x.name=String(r?.symbol||x.symbol);x.base=String(r?.underlying||'').replace(/USDT$|USDC$|BUSD$/,'')||x.base;x.quote=String(r?.quoteAsset||'').trim()||x.quote;x.optionType=String(r?.side||'').toUpperCase();out.push(x)}}
  const seen=new Set<string>();
  return out.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true}).sort((a,b)=>(a.marketType+a.symbol).localeCompare(b.marketType+b.symbol));
}

const SPOT_INTERVAL:Record<string,string>={'1min':'1m','3min':'3m','5min':'5m','15min':'15m','30min':'30m','1h':'1h','2h':'2h','4h':'4h','6h':'6h','8h':'8h','12h':'12h','1day':'1d','3day':'3d','1week':'1w','1month':'1M'};
const FUT_INTERVAL=SPOT_INTERVAL;
function interval(v:string){const x=String(v||'1min');return SPOT_INTERVAL[x]||x;}

export async function binanceHistory({symbol,marketType,interval:iv,count,from,to}:{symbol:string;marketType:string;interval:string;count:number;from?:number;to?:number}){
  const mt=String(marketType||'Spot');
  const q=new URLSearchParams({symbol,interval:interval(iv),limit:String(Math.min(1500,Math.max(2,Number(count)||500)))});
  if(Number.isFinite(Number(from)))q.set('startTime',String(Math.floor(Number(from)*1000)));
  if(Number.isFinite(Number(to)))q.set('endTime',String(Math.floor(Number(to)*1000)));
  let base:string;
  if(mt==='Spot'||mt==='Margin')base='https://api.binance.com/api/v3/klines';
  else if(mt==='Options')base='https://eapi.binance.com/eapi/v1/klines';
  else if(String(symbol).includes('_')||mt==='Futures')base='https://dapi.binance.com/dapi/v1/klines';
  else base='https://fapi.binance.com/fapi/v1/klines';
  const rows=await getJson(base+'?'+q.toString());
  return (rows||[]).map((r:any[])=>({time:Number(r[0])/1000,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])||0})).filter((x:any)=>[x.time,x.open,x.high,x.low,x.close].every(Number.isFinite));
}

export async function binanceQuote({symbol,marketType}:{symbol:string;marketType:string}){
  const mt=String(marketType||'Spot');
  let url:string;
  if(mt==='Spot'||mt==='Margin')url='https://api.binance.com/api/v3/ticker/24hr?symbol='+encodeURIComponent(symbol);
  else if(mt==='Options')url='https://eapi.binance.com/eapi/v1/ticker?symbol='+encodeURIComponent(symbol);
  else if(String(symbol).includes('_')||mt==='Futures')url='https://dapi.binance.com/dapi/v1/ticker/price?symbol='+encodeURIComponent(symbol);
  else url='https://fapi.binance.com/fapi/v1/ticker/price?symbol='+encodeURIComponent(symbol);
  const r=await getJson(url);
  const row=Array.isArray(r)?(r[0]||{}):r;
  const price=Number(row?.lastPrice??row?.price??row?.markPrice);
  if(!Number.isFinite(price))throw new Error('Binance returned no live price for '+symbol);
  const epoch=Number(row?.closeTime||row?.time||Date.now())/1000;
  return {symbol,epoch,price,bid:Number(row?.bidPrice),ask:Number(row?.askPrice),volume:Number(row?.volume)||0};
}
