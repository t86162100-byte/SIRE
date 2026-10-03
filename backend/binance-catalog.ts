type Json = Record<string, any>;

const SPOT = 'https://api.binance.com/api/v3';
const UM = 'https://fapi.binance.com/fapi/v1';
const CM = 'https://dapi.binance.com/dapi/v1';
const EQUITY = 'https://api.binance.com/sapi/v1/equity/market';
const ALPHA = 'https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list';

const s = (v: unknown) => String(v ?? '').trim();
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : undefined; };
const uniq = (values: string[]) => [...new Set(values.map(s).filter(Boolean))];
const norm = (v: unknown) => s(v).toLowerCase().replace(/[\\s_-]+/g, '');

const SPOT_QUOTES = new Set(['USDT','USDC','U','USD','BNB','BTC','BTCC','ETH']);
const FIAT_QUOTES = new Set(['EUR','GBP','AUD','BRL','TRY','RUB','ZAR','NGN','JPY','PLN','RON','UAH','CHF','CAD','HKD','SGD','MXN','ARS']);
const MARGIN_ASSETS = new Set(['ETH','XAU','BTC','XAG','SOL','XRP','DOGE']);

const FUTURE_LABELS: Record<string,string> = {
  crypto:'Crypto', defi:'DeFi', metavers:'Metavers', metaverse:'Metavers',
  payment:'Payment', pow:'PoW', storage:'Storage', nft:'NFT', tradfi:'TradFi',
  index:'Index', preipo:'Pre-IPO', usdc:'USDC', chinese:'Chinese', alpha:'Alpha',
  ai:'AI', layer1:'Layer-1', layer2:'Layer-2', rwa:'RWA', gaming:'Gaming',
  meme:'Meme', infrastructure:'Infrastructure', new:'New'
};

function quoteBucket(quote: string) {
  const q = quote.toUpperCase();
  if (SPOT_QUOTES.has(q)) return q;
  if (FIAT_QUOTES.has(q)) return 'FIAT';
  return 'ALTs';
}

function normalizeFutureTags(values: unknown) {
  const tags = Array.isArray(values) ? values.map(s).filter(Boolean) : [];
  return uniq(tags.map(tag => FUTURE_LABELS[norm(tag)] || tag));
}

function tickSize(raw: Json) {
  return n(raw?.filters?.find?.((f: Json) => f?.filterType === 'PRICE_FILTER')?.tickSize);
}

function spotInstrument(raw: Json, margin = false): Json | null {
  const symbol = s(raw?.symbol);
  if (!symbol || !['TRADING','PENDING_TRADING'].includes(s(raw?.status))) return null;
  const quote = s(raw?.quoteAsset).toUpperCase();
  const base = s(raw?.baseAsset).toUpperCase();
  const bucket = quoteBucket(quote);
  const filters = uniq([bucket, 'Spot', ...(margin ? ['Margin'] : [])]);
  return {
    symbol, name: base + '/' + quote, provider:'BINANCE', exchange:'BINANCE',
    marketGroup:'CRYPTO', marketType:margin?'Margin':'Spot', category:margin?'Margin':'Spot',
    marketSubcategory:margin?'Margin':'Spot', marketSubSubcategory:margin?(MARGIN_ASSETS.has(base)?base:'All'):bucket,
    marketFilters:filters, marketFilter:margin?base:bucket,
    instrumentType:margin?'Crypto Margin':'Crypto Spot', instrumentSubtype:margin?'Margin':'Spot',
    quote, baseAsset:base, status:s(raw?.status), pipSize:tickSize(raw), margin,
    onboardDate:n(raw?.onboardDate), newListing:false
  };
}

function futureInstrument(raw: Json, kind: 'USDT-M'|'COIN-M', now:number): Json | null {
  const symbol=s(raw?.symbol);
  if(!symbol || !['TRADING','PENDING_TRADING'].includes(s(raw?.status || raw?.contractStatus))) return null;
  const base=s(raw?.baseAsset).toUpperCase();
  const quote=s(raw?.quoteAsset).toUpperCase();
  const tags=normalizeFutureTags(raw?.underlyingSubType);
  const tradfi=tags.includes('TradFi');
  const onboard=n(raw?.onboardDate);
  const isNew=Number.isFinite(onboard) ? now-Number(onboard)<30*86400000 : false;
  const ct=s(raw?.contractType);
  const derived=[...tags];
  if (!tradfi) derived.unshift('Crypto');
  if (isNew) derived.unshift('New');
  if (quote==='USDC') derived.push('USDC');
  return {
    symbol,
    name:base+(quote?'/'+quote:'')+(ct==='PERPETUAL'?' Perpetual':' '+ct),
    provider:'BINANCE', exchange:'BINANCE',
    marketGroup:tradfi?'TRADE FI':'CRYPTO', marketType:'Futures',
    category:tradfi?'TradFi Futures':'Futures',
    marketSubcategory:kind,
    marketSubSubcategory:tradfi ? (tags[0] || 'Stocks') : kind,
    marketFilters:uniq([...derived, kind, ct==='PERPETUAL'?'Perpetual':'Expiring', quote]),
    marketFilter:tags[0] || kind,
    instrumentType:tradfi?'TradFi Futures':'Crypto Futures',
    instrumentSubtype:tags.join(', '), quote, baseAsset:base, settlement:kind,
    status:s(raw?.status || raw?.contractStatus), pipSize:tickSize(raw),
    onboardDate:onboard, expiry:n(raw?.deliveryDate), newListing:isNew
  };
}

function equityInstrument(raw: Json, etfSymbols: Set<string>): Json | null {
  const symbol=s(raw?.symbol).toUpperCase();
  if(!symbol || s(raw?.tradability)==='NONE') return null;
  const isEtf=etfSymbols.has(symbol);
  return {
    symbol, name:symbol, provider:'BINANCE', exchange:'BINANCE',
    marketGroup:'TRADE FI', marketType:'Stocks', category:'Stocks',
    marketSubcategory:'Stocks', marketSubSubcategory:isEtf?'ETFs':'U.S. stock',
    marketFilters:uniq([isEtf?'ETFs':'U.S. stock','Stocks']),
    marketFilter:isEtf?'ETFs':'U.S. stock', instrumentType:isEtf?'ETF':'U.S. stock',
    quote:'USD', baseAsset:symbol, status:s(raw?.tradability),
    listedAt:n(raw?.listingTime), onboardDate:n(raw?.listingTime)
  };
}

function tokenizedInstrument(raw: Json): Json | null {
  const symbol=s(raw?.assetCode).toUpperCase();
  if(!symbol) return null;
  const name=s(raw?.assetName || symbol);
  const commodity=/gold|silver|oil|commodity|copper|platinum|palladium/i.test(name);
  return {
    symbol, name, provider:'BINANCE', exchange:'BINANCE',
    marketGroup:'TRADE FI', marketType:'Spot', category:'Spot',
    marketSubcategory:'Spot', marketSubSubcategory:commodity?'tCommodities':'bStocks',
    marketFilters:[commodity?'tCommodities':'bStocks','Spot'],
    marketFilter:commodity?'tCommodities':'bStocks',
    instrumentType:commodity?'Tokenized Commodity':'Tokenized Stock',
    instrumentSubtype:'Tokenized Securities', baseAsset:symbol, quote:'USD',
    status:'TRADING'
  };
}

function alphaInstrument(raw: Json): Json | null {
  const id=s(raw?.alphaId || raw?.tokenId || raw?.id);
  const symbol=s(raw?.tradingPair || ((id && /^ALPHA_/i.test(id)) ? id + s(raw?.quoteAsset || 'USDT').toUpperCase() : ''));
  if(!symbol) return null;
  const chain=s(raw?.chainName || raw?.chain || raw?.network);
  const chainLabels: Record<string,string> = {
    bsc:'BSC', ethereum:'Ethereum', eth:'Ethereum', solana:'Solana', sol:'Solana',
    base:'Base', arbitrum:'Arbitrum', sonic:'Sonic', sui:'Sui', tron:'TRON'
  };
  const tags=uniq([
    'Alpha',
    chainLabels[norm(chain)] || chain,
    raw?.stockState ? 'Tokenized Securities' : '',
    /robinhood/i.test(s(raw?.cexCoinName)) ? 'Robinhood' : '',
    /point/i.test(s(raw?.cexCoinName)) ? 'Point+' : ''
  ]);
  return {
    symbol, name:s(raw?.name || raw?.symbol || symbol), provider:'BINANCE', exchange:'BINANCE',
    marketGroup:'ALPHA', marketType:'Alpha', category:'Alpha',
    marketSubcategory:'Alpha', marketSubSubcategory:chainLabels[norm(chain)] || chain || 'Alpha',
    marketFilters:tags, marketFilter:chainLabels[norm(chain)] || chain || 'Alpha',
    instrumentType:'Alpha', instrumentSubtype:chain, quote:s(raw?.quoteAsset || 'USDT').toUpperCase(),
    baseAsset:s(raw?.symbol || id), status:raw?.offline?'BREAK':'TRADING',
    price:n(raw?.price), priceChangePercent:n(raw?.percentChange24h),
    volume24h:n(raw?.volume24h), marketCap:n(raw?.marketCap), fdv:n(raw?.fdv),
    liquidity:n(raw?.liquidity), holders:n(raw?.holders), listedAt:n(raw?.listingTime),
    newListing:Number.isFinite(n(raw?.listingTime)) ? Date.now()-Number(raw.listingTime)<30*86400000 : false
  };
}

async function getJson(url:string, apiKey='') {
  const headers: Record<string,string> = {Accept:'application/json'};
  if(apiKey) headers['X-MBX-APIKEY']=apiKey;
  const response=await fetch(url,{cache:'no-store',headers});
  const text=await response.text();
  let data:any={};
  try { data=text?JSON.parse(text):{}; } catch { throw new Error('Binance returned invalid JSON from '+url); }
  if(!response.ok) throw new Error('Binance '+response.status+': '+s(data?.msg || data?.message || text).slice(0,300));
  return data;
}

export async function fetchBinanceCatalogServer() {
  const apiKey=s(process.env.BINANCE_API_KEY || process.env.BINANCE_KEY || process.env.BINANCE_APIKEY);
  const now=Date.now();
  const requests=[
    getJson(SPOT+'/exchangeInfo'),
    getJson(SPOT+'/exchangeInfo?permissions=MARGIN'),
    getJson(UM+'/exchangeInfo'),
    getJson(CM+'/exchangeInfo'),
    apiKey ? getJson(EQUITY+'/exchangeInfo',apiKey) : Promise.resolve({symbols:[]}),
    apiKey ? getJson(EQUITY+'/tokenized-assets',apiKey) : Promise.resolve([]),
    getJson(ALPHA).catch(()=>null)
  ];
  const [spot,margin,um,cm,equity,tokenized,alpha]=await Promise.all(requests);
  const out: Json[]=[];
  for(const raw of (spot?.symbols||[])){ const i=spotInstrument(raw,false); if(i) out.push(i); }
  for(const raw of (margin?.symbols||[])){
    const base=s(raw?.baseAsset).toUpperCase(), quote=s(raw?.quoteAsset).toUpperCase();
    if(MARGIN_ASSETS.has(base)||MARGIN_ASSETS.has(quote)){ const i=spotInstrument(raw,true); if(i) out.push(i); }
  }
  for(const raw of (um?.symbols||[])){const i=futureInstrument(raw,'USDT-M',now);if(i)out.push(i);}
  for(const raw of (cm?.symbols||[])){const i=futureInstrument(raw,'COIN-M',now);if(i)out.push(i);}
  const etfSymbols=new Set(['SPY','QQQ','IWM','DIA','TLT','GLD','SLV','USO','UNG','EEM','EWJ','EWY','FXI','XLE','XLK','XLF','XLV','XLI','XLP','XLU','ARKK']);
  for(const raw of (equity?.symbols||[])){const i=equityInstrument(raw,etfSymbols);if(i)out.push(i);}
  const tokenRows=Array.isArray(tokenized)?tokenized:Array.isArray(tokenized?.data)?tokenized.data:[];
  for(const raw of tokenRows){const i=tokenizedInstrument(raw);if(i)out.push(i);}
  const alphaRows=Array.isArray(alpha?.data)?alpha.data:Array.isArray(alpha?.data?.tokens)?alpha.data.tokens:Array.isArray(alpha?.tokens)?alpha.tokens:[];
  for(const raw of alphaRows){const i=alphaInstrument(raw);if(i)out.push(i);}
  const map=new Map<string,Json>();
  for(const item of out){
    const key=item.marketType+':'+item.symbol;
    if(!map.has(key)) map.set(key,item);
  }
  return [...map.values()].sort((a,b)=>String(a.marketGroup).localeCompare(String(b.marketGroup))||String(a.marketType).localeCompare(String(b.marketType))||String(a.symbol).localeCompare(String(b.symbol)));
}
