type Json = Record<string, any>;

const SPOT_HOSTS = ['https://api.binance.com/api/v3','https://api-gcp.binance.com/api/v3','https://data-api.binance.vision/api/v3','https://api1.binance.com/api/v3','https://api2.binance.com/api/v3','https://api3.binance.com/api/v3','https://api4.binance.com/api/v3'];
const UM_HOSTS = ['https://fapi.binance.com/fapi/v1','https://fapi1.binance.com/fapi/v1','https://fapi2.binance.com/fapi/v1','https://fapi3.binance.com/fapi/v1','https://fapi4.binance.com/fapi/v1','https://www.binance.com/fapi/v1'];
const CM_HOSTS = ['https://dapi.binance.com/dapi/v1','https://www.binance.com/dapi/v1'];
const OPTIONS_HOSTS = ['https://eapi.binance.com/eapi/v1'];
const MARGIN_HOSTS = ['https://api.binance.com/sapi/v1/margin','https://api-gcp.binance.com/sapi/v1/margin'];
const MARGIN_ISOLATED_HOSTS = ['https://api.binance.com/sapi/v1/margin/isolated','https://api-gcp.binance.com/sapi/v1/margin/isolated'];
const EQUITY_HOSTS = ['https://api.binance.com/sapi/v1/equity/market','https://www.binance.com/sapi/v1/equity/market'];
// Binance's public Equity BAPI exposes the same tradable-stock universe without
// the authenticated SAPI path. Use it as the primary catalog source so the
// catalog still works from Render regions where the SAPI equity endpoint is
// geo-restricted (HTTP 451).
const EQUITY_PUBLIC_HOSTS = [
  'https://www.binance.com/bapi/equity/v2/public/equity/symbol/get-exchange-info',
  'https://www.binance.com/bapi/equity/v1/public/equity/symbol/get-symbols',
  'https://www.binance.com/bapi/equity/v1/public/equity/symbol/get-symbols-static',
  'https://www.binance.com/bapi/equity/v1/public/equity/symbol/get-symbols-dynamic'
];
const ALPHA = 'https://www.binance.com/bapi/defi/v1/public';
// Binance's public asset service exposes tokenised-asset metadata used by the
// Markets UI. This is distinct from the Web3 RWA feed (which can contain Ondo
// and other on-chain assets that are not Binance bStocks/tCommodities).
const TOKENIZED_PUBLIC_HOSTS = [
  'https://www.binance.com/bapi/asset/v2/public/asset/asset/get-tokenised-asset'
];

const s = (v: unknown) => String(v ?? '').trim();
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : undefined; };
const uniq = (values: string[]) => [...new Set(values.map(s).filter(Boolean))];
const norm = (v: unknown) => s(v).toLowerCase().replace(/[\s_-]+/g, '');

const SPOT_QUOTES = new Set(['USDT','USDC','U','USD','BNB','BTC','BTCC','ETH']);
const FIAT_QUOTES = new Set(['EUR','GBP','AUD','BRL','TRY','RUB','ZAR','NGN','JPY','PLN','RON','UAH','CHF','CAD','HKD','SGD','MXN','ARS']);

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

function spotInstrument(raw: Json, margin = false, bStockSymbols?: Set<string>, commoditySymbols?: Set<string>): Json | null {
  const symbol = s(raw?.symbol);
  const status=s(raw?.status).toUpperCase();
  const permissions=Array.isArray(raw?.permissions) ? raw.permissions.map(s).map(v=>v.toUpperCase()) : [];
  if (!symbol || !status || (permissions.length && !permissions.includes('SPOT'))) return null;
  const quote = s(raw?.quoteAsset).toUpperCase();
  const base = s(raw?.baseAsset).toUpperCase();
  const bucket = quoteBucket(quote);
  const isBStock = !margin && base.endsWith('B') && (Boolean(bStockSymbols?.has(base)) || /^[A-Z]{2,8}B$/.test(base));
  const isTCommodity = !margin && !isBStock && Boolean(commoditySymbols?.has(base));
  return {
    symbol, name: base + '/' + quote, provider:'BINANCE', exchange:'BINANCE',
    marketGroup:margin ? 'CRYPTO' : ((isBStock || isTCommodity) ? 'TRADE FI' : 'CRYPTO'), marketType:margin?'Margin':'Spot', category:margin?'Margin':'Spot',
    marketSubcategory:margin?'Margin':'Spot',
    marketSubSubcategory:margin ? base || 'All' : (isBStock ? 'bStocks' : (isTCommodity ? 'tCommodities' : bucket)),
    marketFilters:uniq([isBStock ? 'bStocks' : (isTCommodity ? 'tCommodities' : bucket), 'Spot', ...(margin ? ['Margin'] : [])]),
    marketFilter:margin ? base : (isBStock ? 'bStocks' : (isTCommodity ? 'tCommodities' : bucket)),
    instrumentType:margin?'Crypto Margin':'Crypto Spot',
    instrumentSubtype:margin?'Margin':'Spot',
    quote, baseAsset:base, status:s(raw?.status), pipSize:tickSize(raw),
    margin, marginEnabled:Boolean(raw?.isMarginTradingAllowed || raw?.permissions?.includes?.('MARGIN')),
    onboardDate:n(raw?.onboardDate), newListing:false
  };
}

function marginInstrument(raw: Json): Json | null {
  const symbol=s(raw?.symbol).toUpperCase();
  if(!symbol) return null;
  const base=s(raw?.base || raw?.baseAsset).toUpperCase();
  const quote=s(raw?.quote || raw?.quoteAsset).toUpperCase();
  const status=s(raw?.status || (raw?.isMarginTrade === true ? 'TRADING' : ''));
  if(raw?.isMarginTrade === false) return null;
  const explicitlyMargin = raw?.isMarginTradingAllowed === true ||
    (Array.isArray(raw?.permissions) && raw.permissions.some((x:any) => /MARGIN/i.test(s(x)))) ||
    (Array.isArray(raw?.permissionSets) && raw.permissionSets.some((set:any) => Array.isArray(set) && set.some((x:any) => /MARGIN/i.test(s(x)))));
  if (raw?.isMarginTrade !== true && raw?.isMarginTradingAllowed !== true && !explicitlyMargin) return null;
  return {
    symbol, name:base && quote ? base+'/'+quote : symbol,
    provider:'BINANCE', exchange:'BINANCE',
    marketGroup:'CRYPTO', marketType:'Margin', category:'Margin',
    marketSubcategory:'Margin', marketSubSubcategory:'All',
    marketFilters:uniq(['Margin','All',base,quote].filter(Boolean)),
    marketFilter:base || quote || 'Margin',
    instrumentType:'Crypto Margin', instrumentSubtype:'Margin',
    quote, baseAsset:base, status:status || 'TRADING',
    margin:true, marginEnabled:true
  };
}

function optionInstrument(raw: Json): Json | null {
  const symbol=s(raw?.symbol).toUpperCase();
  if(!symbol || s(raw?.status) !== 'TRADING') return null;
  const underlying=s(raw?.underlying).toUpperCase();
  const quote=s(raw?.quoteAsset).toUpperCase();
  const side=s(raw?.side).toUpperCase();
  const underlyingType=s(raw?.underlyingType).toUpperCase();
  const contractType=s(raw?.contractType).toUpperCase();
  const expiry=n(raw?.expiryDate);
  return {
    symbol, name:symbol, provider:'BINANCE', exchange:'BINANCE',
    marketGroup:'CRYPTO', marketType:'Options', category:'Options',
    marketSubcategory:'Options', marketSubSubcategory:underlyingType || 'Crypto',
    marketFilters:uniq(['Options',underlyingType || 'Crypto',side,contractType].filter(Boolean)),
    marketFilter:side || 'Options', instrumentType:'Crypto Options',
    instrumentSubtype:[contractType,side].filter(Boolean).join(', '),
    underlying, quote, baseAsset:underlying.replace(/USDT$|USDC$|BUSD$/,''),
    settleAsset:s(raw?.settleAsset || quote), side,
    contractType, underlyingType, strikePrice:s(raw?.strikePrice),
    expiryDate:expiry, expiry, status:s(raw?.status),
    onboardDate:undefined, newListing:false
  };
}

function classifyFutureTradeFi(raw: Json, tags: string[], etfSymbols?: Set<string>) {
  const normalized = tags.map(norm);
  const contractType = norm(raw?.contractType);
  const underlyingType = norm(raw?.underlyingType);

  // Binance's exchangeInfo explicitly identifies TradFi perpetuals with
  // contractType=TRADIFI_PERPETUAL. Do not depend on a subtype tag to detect them.
  const isTradFiContract = contractType === 'tradifiperpetual' || normalized.includes('tradfi') ||
    ['equity','hkequity','krequity','commodity','commodities','fx','forex','premarket','preipo','stock','stocks'].includes(underlyingType);
  if (!isTradFiContract) return undefined;

  // Binance's underlyingType is the authoritative family for these contracts.
  if (underlyingType === 'commodity' || underlyingType === 'commodities' ||
      normalized.includes('commodity') || normalized.includes('commodities')) return 'Commodities';
  if (underlyingType === 'fx' || underlyingType === 'forex' ||
      normalized.includes('fx') || normalized.includes('forex') ||
      normalized.includes('foreignexchange') || normalized.includes('currency')) return 'Fx';
  if (underlyingType === 'premarket' || underlyingType === 'preipo' ||
      normalized.includes('preipo')) return 'Pre-IPO';
  const baseSymbol=s(raw?.baseAsset || raw?.pair || raw?.symbol || raw?.ticker).toUpperCase().replace(/(USDT|USDC|BUSD)$/,'');
  if (normalized.includes('etf') || normalized.includes('etfs') || etfSymbols?.has(baseSymbol)) return 'ETFs';
  if (underlyingType === 'equity' || underlyingType === 'hkequity' ||
      underlyingType === 'krequity' || underlyingType === 'stock' ||
      normalized.includes('stock') || normalized.includes('stocks') ||
      normalized.includes('equity') || normalized.includes('equities')) return 'Stocks';

  return 'TradFi';
}

function futureInstrument(raw: Json, kind: 'USDT-M'|'COIN-M', now:number, etfSymbols?: Set<string>): Json | null {
  const symbol=s(raw?.symbol);
  if(!symbol || !['TRADING','PENDING_TRADING'].includes(s(raw?.status || raw?.contractStatus))) return null;
  const base=s(raw?.baseAsset).toUpperCase();
  const quote=s(raw?.quoteAsset).toUpperCase();
  const tags=normalizeFutureTags(raw?.underlyingSubType);
  const tradeFiSubtype=classifyFutureTradeFi(raw, tags, etfSymbols);
  const tradfi=Boolean(tradeFiSubtype);
  const onboard=n(raw?.onboardDate);
  const isNew=Number.isFinite(onboard) ? now-Number(onboard)<30*86400000 : false;
  const ct=s(raw?.contractType);
  const derived=[...tags];
  if (!tradfi) derived.unshift('Crypto');
  if (isNew) derived.unshift('New');
  if (quote==='USDC') derived.push('USDC');
  if (tradeFiSubtype) derived.push(tradeFiSubtype);
  return {
    symbol,
    name:base+(quote?'/'+quote:'')+(ct==='PERPETUAL'?' Perpetual':' '+ct),
    provider:'BINANCE', exchange:'BINANCE',
    marketGroup:tradfi?'TRADE FI':'CRYPTO', marketType:'Futures',
    category:tradfi?'TradFi Futures':'Futures', marketSubcategory:kind,
    marketSubSubcategory:tradfi ? tradeFiSubtype : kind,
    marketFilters:uniq([...derived, kind, ct==='PERPETUAL'?'Perpetual':'Expiring', quote]),
    marketFilter:tradeFiSubtype || tags[0] || kind, instrumentType:tradfi?'TradFi Futures':'Crypto Futures',
    instrumentSubtype:tags.join(', '), quote, baseAsset:base, settlement:kind,
    contractType:ct, underlyingType:s(raw?.underlyingType), underlyingSubType:raw?.underlyingSubType,
    status:s(raw?.status || raw?.contractStatus), pipSize:tickSize(raw),
    onboardDate:onboard, expiry:n(raw?.deliveryDate), newListing:isNew
  };
}

function isEtfFromBinance(raw: Json) {
  if (raw?.isETF === true || raw?.isEtf === true) return true;
  const text = [
    raw?.assetType, raw?.instrumentType, raw?.securityType, raw?.productType,
    raw?.symbolType, raw?.securityCategory, raw?.type, raw?.subtype, raw?.securityTypeName,
    raw?.name, raw?.n, raw?.description, raw?.desc, raw?.sec, raw?.t
  ].map(s).join(' ').toLowerCase();
  return raw?.etf === true || raw?.isETF === true || raw?.isEtf === true ||
    /(^|\W)etf($|\W)|exchange[ ._-]?traded[ ._-]?fund/.test(text);
}

function equityInstrument(raw: Json): Json | null {
  const symbol=s(raw?.symbol || raw?.ticker || raw?.code || raw?.assetSymbol || raw?.s).toUpperCase();
  if(!symbol) return null;
  const tradability=s(raw?.tradability || raw?.tradabilityStatus || raw?.status || raw?.st || 'TRADING').toUpperCase();
  if(tradability==='NONE' || tradability==='DELISTED' || raw?.dlt===true) return null;
  const isEtf=isEtfFromBinance(raw);
  return {
    symbol, name:s(raw?.name || raw?.n || raw?.description || raw?.desc || symbol), provider:'BINANCE', exchange:'BINANCE',
    marketGroup:'TRADE FI', marketType:'Stocks', category:'Stocks',
    marketSubcategory:'Stocks', marketSubSubcategory:isEtf?'ETFs':'U.S. stock',
    marketFilters:uniq([isEtf?'ETFs':'U.S. stock','Stocks']),
    marketFilter:isEtf?'ETFs':'U.S. stock',
    instrumentType:isEtf?'ETF':'U.S. stock', instrumentSubtype:s(raw?.assetType || raw?.securityType),
    quote:'USD', baseAsset:symbol, status:tradability,
    listedAt:n(raw?.listingTime || raw?.lt), onboardDate:n(raw?.listingTime || raw?.lt)
  };
}

function tokenizedInstrument(raw: Json): Json | null {
  // Official SAPI rows use assetCode/assetName. Binance's public asset service
  // may expose the same assets with tokenCode/tokenName or symbol/name fields.
  // Only accept rows that carry tokenised-asset semantics; never treat a generic
  // Web3 RWA row as a bStock merely because it has a ticker.
  const symbol=s(raw?.assetCode || raw?.tokenCode || raw?.tokenSymbol).toUpperCase();
  if(!symbol) return null;
  const name=s(raw?.assetName || raw?.tokenName || raw?.name || symbol);
  const kind=s(raw?.assetType || raw?.type || raw?.category || raw?.subtype).toLowerCase();
  const commodity=/gold|silver|oil|commodity|copper|platinum|palladium|tcommodit/.test((name+' '+kind).toLowerCase());
  return {
    symbol, name, provider:'BINANCE', exchange:'BINANCE',
    marketGroup:'TRADE FI', marketType:'Spot', category:'Spot',
    marketSubcategory:'Spot', marketSubSubcategory:commodity?'tCommodities':'bStocks',
    marketFilters:[commodity?'tCommodities':'bStocks','Spot'],
    marketFilter:commodity?'tCommodities':'bStocks',
    instrumentType:commodity?'Tokenized Commodity':'Tokenized Stock',
    instrumentSubtype:'Tokenized Securities', baseAsset:symbol, quote:'USD',
    underlyingEquitySymbol:s(raw?.underlyingEquitySymbol || raw?.ticker),
    multiplier:s(raw?.multiplier), multiplierValid:Boolean(raw?.multiplierValid),
    status:'TRADING'
  };
}

const CHAIN_LABELS: Record<string,string> = {
  bsc:'BSC', ethereum:'Ethereum', eth:'Ethereum', solana:'Solana', sol:'Solana',
  base:'Base', arbitrum:'Arbitrum', sonic:'Sonic', sui:'Sui', tron:'TRON'
};

function alphaInstrument(exchangeSymbol: Json, token: Json | undefined, now:number): Json | null {
  const symbol=s(exchangeSymbol?.symbol);
  if(!symbol || s(exchangeSymbol?.status) !== 'TRADING') return null;
  const base=s(exchangeSymbol?.baseAsset);
  const quote=s(exchangeSymbol?.quoteAsset);
  const chain=CHAIN_LABELS[norm(token?.chainName)] || s(token?.chainName);
  const listingTime=n(token?.listingTime);
  // Binance describes Points+ as the new-coin bonus/leaderboard for qualifying
  // new Alpha launches; use only Binance token-list fields, never an external list.
  const pointPlus=Boolean(chain==='BSC' && Number.isFinite(listingTime) && now-Number(listingTime)<30*86400000);
  const tags=uniq([
    'Alpha', chain,
    token?.stockState ? 'Tokenized Securities' : '',
    /robinhood/i.test(s(token?.cexCoinName)) ? 'Robinhood' : '',
    pointPlus ? 'Point+' : ''
  ]);
  return {
    symbol,
    name:s(token?.name || token?.symbol || base || symbol),
    provider:'BINANCE', exchange:'BINANCE',
    marketGroup:'ALPHA', marketType:'Alpha', category:'Alpha',
    marketSubcategory:'Alpha', marketSubSubcategory:chain || 'Alpha',
    marketFilters:tags, marketFilter:chain || 'Alpha',
    instrumentType:'Alpha', instrumentSubtype:chain,
    quote, baseAsset:base, status:s(exchangeSymbol?.status),
    price:n(token?.price), priceChangePercent:n(token?.percentChange24h),
    volume24h:n(token?.volume24h), marketCap:n(token?.marketCap), fdv:n(token?.fdv),
    liquidity:n(token?.liquidity), holders:n(token?.holders),
    high24h:n(token?.priceHigh24h), low24h:n(token?.priceLow24h),
    listedAt:listingTime, newListing:pointPlus,
    chainId:s(token?.chainId), contractAddress:s(token?.contractAddress),
    iconUrl:s(token?.iconUrl), alphaId:s(token?.alphaId || base)
  };
}

async function getText(url:string, apiKey='') {
  const headers: Record<string,string> = {Accept:'text/html,application/json','User-Agent':'SIRE-Binance-Catalog/1.0'};
  if(apiKey) headers['X-MBX-APIKEY']=apiKey;
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15000);
  let response:Response; try { response=await fetch(url,{cache:'no-store',headers,signal:controller.signal}); } finally { clearTimeout(timer); }
  const text=await response.text();
  if(!response.ok) throw new Error('Binance '+response.status+' from '+url);
  return text;
}

async function getJson(url:string, apiKey='') {
  const headers: Record<string,string> = {Accept:'application/json','User-Agent':'SIRE-Binance-Catalog/1.0'};
  if(apiKey) headers['X-MBX-APIKEY']=apiKey;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try { response=await fetch(url,{cache:'no-store',headers,signal:controller.signal}); }
  finally { clearTimeout(timer); }
  const text=await response.text();
  let data:any={};
  try { data=text?JSON.parse(text):{}; } catch { throw new Error('Binance returned invalid JSON from '+url); }
  if(!response.ok) throw new Error('Binance '+response.status+': '+s(data?.msg || data?.message || text).slice(0,300));
  return data;
}

function shapeOf(data:any) {
  return {
    topLevel:Array.isArray(data)?'array':data && typeof data==='object'?'object':typeof data,
    keys:data && typeof data==='object' && !Array.isArray(data) ? Object.keys(data).slice(0,30) : [],
    count:Array.isArray(data)?data.length:
      Array.isArray(data?.symbols)?data.symbols.length:
      Array.isArray(data?.data)?data.data.length:
      undefined,
    sampleKeys:Array.isArray(data?.symbols) && data.symbols[0] ? Object.keys(data.symbols[0]) :
      Array.isArray(data?.data) && data.data[0] ? Object.keys(data.data[0]) : []
  };
}


type BinanceMarketSnapshot = {
  symbol:string; market:string; price?:number; bid?:number; ask?:number;
  priceChangePercent?:number; change24h?:number; volume24h?:number; quoteVolume?:number;
  high24h?:number; low24h?:number; open24h?:number; marketCap?:number;
  updatedAt:number;
};

let marketSnapshotCache:{at:number; data:Record<string,BinanceMarketSnapshot>}|null=null;
let marketSnapshotPromise:Promise<Record<string,BinanceMarketSnapshot>>|null=null;

function snapshotRows(value:any):any[] {
  if(Array.isArray(value)) return value;
  if(Array.isArray(value?.data)) return value.data;
  if(Array.isArray(value?.symbols)) return value.symbols;
  if(Array.isArray(value?.data?.data)) return value.data.data;
  if(Array.isArray(value?.data?.symbols)) return value.data.symbols;
  if(Array.isArray(value?.data?.list)) return value.data.list;
  if(Array.isArray(value?.list)) return value.list;
  if(Array.isArray(value?.rows)) return value.rows;
  if(Array.isArray(value?.klines)) return value.klines;
  return [];
}
function putSnapshot(map:Record<string,BinanceMarketSnapshot>, market:string, row:any, fallbackSymbol='') {
  const symbol=s(row?.symbol || row?.s || row?.ticker || row?.code || fallbackSymbol).toUpperCase();
  if(!symbol) return;
  const price=n(row?.lastPrice ?? row?.price ?? row?.last ?? row?.c ?? row?.close ?? row?.latestPrice);
  const change=n(row?.priceChangePercent ?? row?.percentChange24h ?? row?.changePercent ?? row?.pc);
  const volume=n(row?.volume ?? row?.baseVolume ?? row?.volume24h ?? row?.v24 ?? row?.v);
  const quoteVolume=n(row?.quoteVolume ?? row?.quote_volume ?? row?.volumeUSD ?? row?.qv24 ?? row?.qv);
  const marketCap=n(row?.marketCap ?? row?.market_cap ?? row?.mktCap ?? row?.marketCapitalization ?? row?.mc);
  const key=market+':'+symbol;
  map[key]={symbol,market,...(price!==undefined?{price}:{}),...(n(row?.bidPrice ?? row?.bid)!==undefined?{bid:n(row?.bidPrice ?? row?.bid)}:{}),...(n(row?.askPrice ?? row?.ask)!==undefined?{ask:n(row?.askPrice ?? row?.ask)}:{}),...(change!==undefined?{priceChangePercent:change,change24h:change}:{}),...(volume!==undefined?{volume24h:volume}:{}),...(quoteVolume!==undefined?{quoteVolume}:{}),...(n(row?.highPrice ?? row?.high ?? row?.h)!==undefined?{high24h:n(row?.highPrice ?? row?.high ?? row?.h)}:{}),...(n(row?.lowPrice ?? row?.low ?? row?.l)!==undefined?{low24h:n(row?.lowPrice ?? row?.low ?? row?.l)}:{}),...(n(row?.openPrice ?? row?.open ?? row?.o)!==undefined?{open24h:n(row?.openPrice ?? row?.open ?? row?.o)}:{}),...(marketCap!==undefined?{marketCap}:{}),updatedAt:Date.now()};
}

async function fetchBinanceMarketSnapshotFresh():Promise<Record<string,BinanceMarketSnapshot>> {
  const map:Record<string,BinanceMarketSnapshot>={};
  const jobs:[string,string][]=[
    ['SPOT','https://data-api.binance.vision/api/v3/ticker/24hr'],
    ['USDT-M','https://fapi.binance.com/fapi/v1/ticker/24hr'],
    ['COIN-M','https://dapi.binance.com/dapi/v1/ticker/24hr'],
    ['OPTIONS','https://eapi.binance.com/eapi/v1/ticker'],
    ['EQUITY','https://www.binance.com/bapi/equity/v1/public/equity/ticker/get']
  ];
  const results=await Promise.allSettled(jobs.map(async ([market,url])=>({market,data:await getJson(url)})));
  for(const result of results) if(result.status==='fulfilled') for(const row of snapshotRows(result.value.data)) putSnapshot(map,result.value.market,row);

  // Binance Alpha token list is the public bulk source for the current Alpha
  // price, 24h change, volume and market-cap fields. Alpha-specific ticker and
  // kline APIs remain the chart/live stream source when an instrument is opened.
  try {
    const alpha=await getJson(ALPHA+'/wallet-direct/buw/wallet/cex/alpha/all/token/list');
    for(const row of snapshotRows(alpha)) {
      const alphaId=s(row?.alphaId).toUpperCase();
      if(!alphaId) continue;
      putSnapshot(map,'ALPHA',{
        symbol:alphaId+'USDT', price:row?.price, priceChangePercent:row?.percentChange24h,
        volume24h:row?.volume24h, marketCap:row?.marketCap, highPrice:row?.priceHigh24h,
        lowPrice:row?.priceLow24h
      });
    }
  } catch {}

  // Binance's public Markets product feed supplies circulating supply for many
  // Spot assets. Derivatives can inherit the corresponding Spot asset market
  // cap, which is the meaningful capitalization measure for the underlying.
  try {
    const products=await getJson('https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=true');
    const spotCapByBase=new Map<string,number>();
    for(const row of snapshotRows(products)) {
      const symbol=s(row?.s || row?.symbol).toUpperCase();
      const base=s(row?.b || row?.baseAsset).toUpperCase();
      const quote=s(row?.q || row?.quoteAsset).toUpperCase();
      const price=n(row?.c || row?.lastPrice || row?.price);
      const supply=n(row?.cs || row?.circulatingSupply || row?.circulating_supply);
      if(base && price!==undefined && supply!==undefined && supply>=0) spotCapByBase.set(base,price*supply);
      if(symbol && quote) {
        const key='SPOT:'+symbol;
        if(map[key] && map[key].marketCap===undefined && base && spotCapByBase.has(base)) map[key].marketCap=spotCapByBase.get(base);
      }
    }
    for(const snap of Object.values(map)) {
      const base=snap.symbol.replace(/USDT$|USDC$|BUSD$/,'').toUpperCase();
      const cap=spotCapByBase.get(base);
      if(cap!==undefined && (snap.marketCap===undefined || snap.market!=='EQUITY')) snap.marketCap=cap;
    }
  } catch {}
  return map;
}

export async function fetchBinanceMarketSnapshotServer() {
  const now=Date.now();
  if(marketSnapshotCache && now-marketSnapshotCache.at<1000) return marketSnapshotCache.data;
  if(!marketSnapshotPromise) marketSnapshotPromise=fetchBinanceMarketSnapshotFresh().then(data=>{marketSnapshotCache={at:Date.now(),data}; return data;}).finally(()=>{marketSnapshotPromise=null;});
  return marketSnapshotPromise;
}

export async function fetchBinanceHistoryServer(input:{market:string;symbol:string;interval:string;from?:number;to?:number;limit?:number}) {
  const market=s(input.market).toUpperCase(), symbol=s(input.symbol).toUpperCase(), interval=s(input.interval)||'1m';
  if(!symbol) throw new Error('Binance history requires symbol.');
  const limit=Math.max(1,Math.min(1500,Math.floor(input.limit||500)));
  const q=new URLSearchParams({symbol,interval,limit:String(limit)});
  if(input.from!==undefined) q.set('startTime',String(Math.floor(input.from*1000)));
  if(input.to!==undefined) q.set('endTime',String(Math.floor(input.to*1000)));
  let urls:string[]=[];
  if(market==='SPOT' || market==='MARGIN' || market==='TRADE FI SPOT') {
    urls=SPOT_HOSTS.map(host=>host+'/klines?'+q);
  } else if(market==='USDT-M' || market==='TRADE FI FUTURES') {
    urls=UM_HOSTS.map(host=>host+'/klines?'+q);
  } else if(market==='COIN-M') {
    urls=CM_HOSTS.map(host=>host+'/klines?'+q);
  } else if(market==='OPTIONS') {
    urls=OPTIONS_HOSTS.map(host=>host+'/klines?'+q);
  } else if(market==='ALPHA') {
    urls=['https://www.binance.com/bapi/defi/v1/public/alpha-trade/klines?'+q];
  } else if(market==='EQUITY') {
    const eq=new URLSearchParams({symbol,interval,limit:String(Math.min(500,limit))});
    if(input.from!==undefined) eq.set('startTime',String(Math.floor(input.from*1000)));
    if(input.to!==undefined) eq.set('endTime',String(Math.floor(input.to*1000)));
    urls=['https://www.binance.com/bapi/equity/v1/public/equity/kline/query?'+eq];
  } else throw new Error('Unsupported Binance market history venue: '+market);

  let data:any=null;
  const errors:string[]=[];
  for (const [index,url] of urls.entries()) {
    try {
      console.log('[BINANCE HISTORY] Upstream attempt', {market,symbol,interval,attempt:index+1,total:urls.length,url});
      data=await getJson(url);
      console.log('[BINANCE HISTORY] Upstream success', {market,symbol,interval,attempt:index+1,url});
      break;
    } catch (error) {
      const message=error instanceof Error ? error.message : String(error);
      errors.push(message);
      console.warn('[BINANCE HISTORY] Upstream failed', {market,symbol,interval,attempt:index+1,url,error:message});
    }
  }
  if (!data) {
    console.error('[BINANCE HISTORY] All upstream hosts failed', {market,symbol,interval,limit,errors});
    throw new Error('All Binance '+market+' history hosts failed for '+symbol+': '+errors.join(' | '));
  }
  const rows=snapshotRows(data);
  const bars=rows.map((r:any)=>({time:Math.floor(Number(r?.[0] ?? r?.openTime ?? r?.t)/1000),open:Number(r?.[1] ?? r?.open ?? r?.o),high:Number(r?.[2] ?? r?.high ?? r?.h),low:Number(r?.[3] ?? r?.low ?? r?.l),close:Number(r?.[4] ?? r?.close ?? r?.c),volume:Number(r?.[5] ?? r?.volume ?? r?.v)||0})).filter((b:any)=>Number.isFinite(b.time)&&[b.open,b.high,b.low,b.close].every(Number.isFinite));
  if(!bars.length) throw new Error('Binance returned no historical candles for '+symbol+' on '+market+'.');
  return bars.sort((a:any,b:any)=>a.time-b.time);
}

export async function fetchBinanceCatalogServer() {
  const apiKey=s(process.env.BINANCE_API_KEY);
  const apiSecretConfigured=Boolean(s(process.env.BINANCE_API_SECRET));
  const now=Date.now();

  const sources = [
    {name:'spot', urls:SPOT_HOSTS.map(host=>host+'/exchangeInfo'), apiKey:false},
    {name:'usdtm', urls:UM_HOSTS.map(host=>host+'/exchangeInfo'), apiKey:false},
    {name:'coinm', urls:CM_HOSTS.map(host=>host+'/exchangeInfo'), apiKey:false},
    {name:'options', urls:OPTIONS_HOSTS.map(host=>host+'/exchangeInfo'), apiKey:false},
    {name:'margin', urls:MARGIN_HOSTS.map(host=>host+'/allPairs'), apiKey:true},
    {name:'marginIsolated', urls:MARGIN_ISOLATED_HOSTS.map(host=>host+'/allPairs'), apiKey:true},
    {name:'stocks', urls:[...EQUITY_PUBLIC_HOSTS, ...EQUITY_HOSTS.map(host=>host+'/exchangeInfo')], apiKey:false},
    {name:'tokenized', urls:[...EQUITY_HOSTS.map(host=>host+'/tokenized-assets'), ...TOKENIZED_PUBLIC_HOSTS, 'https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai'], apiKey:true},
    {name:'rwa', urls:['https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai'], apiKey:false},
    {name:'tCommoditiesPage', urls:['https://www.binance.com/en/markets/coinInfo-tCommodities'], apiKey:false},
    {name:'alphaExchange', urls:[ALPHA+'/alpha-trade/get-exchange-info'], apiKey:false},
    {name:'alphaTokens', urls:[ALPHA+'/wallet-direct/buw/wallet/cex/alpha/all/token/list'], apiKey:false}
  ];

  const settled = await Promise.allSettled(sources.map(async source => {
    const errors:string[]=[];
    for(const url of source.urls) {
      try {
        const data=source.name==='tCommoditiesPage' ? await getText(url, source.apiKey ? apiKey : '') : await getJson(url, source.apiKey ? apiKey : '');
        if ((source.name==='usdtm' || source.name==='coinm' || source.name==='spot') && !Array.isArray(data?.symbols)) {
          throw new Error('Binance returned no symbols array from '+url);
        }
        // Binance can occasionally return a truncated/abnormal public exchangeInfo
        // response from one edge. Never accept that as the catalogue: try the next
        // Binance edge instead. A real Spot catalogue is far larger than this.
        if (source.name === 'spot' && Array.isArray(data?.symbols) && data.symbols.length < 1000) {
          throw new Error('Binance returned an unexpectedly small Spot catalogue ('+data.symbols.length+') from '+url);
        }
        if (source.name === 'usdtm' && Array.isArray(data?.symbols) && data.symbols.length < 100) {
          throw new Error('Binance returned an unexpectedly small USDT-M catalogue ('+data.symbols.length+') from '+url);
        }
        if (source.name==='options' && !Array.isArray(data?.optionSymbols)) {
          throw new Error('Binance returned no optionSymbols array from '+url);
        }
        if ((source.name==='margin' || source.name==='marginIsolated') && !Array.isArray(data)) {
          throw new Error('Binance returned no Margin pair array from '+url);
        }
        if ((source.name==='stocks' || source.name==='tokenized' || source.name==='rwa') && !Array.isArray(data?.symbols) && !Array.isArray(data?.data) && !Array.isArray(data?.data?.symbols)) {
          throw new Error('Binance returned no symbol data from '+source.name+' endpoint '+url);
        }
        return {data,url};
      }
      catch(error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    throw new Error(errors.join(' | '));
  }));

  const raw: Record<string, any> = {};
  const diagnostics: Record<string, any> = {
    apiKeyConfigured:Boolean(apiKey),
    apiSecretConfigured,
    signingRequiredForCatalog:false,
    sources:{}
  };

  settled.forEach((result,index)=>{
    const source=sources[index];
    if(result.status==='fulfilled') {
      raw[source.name]=result.value.data;
      diagnostics.sources[source.name]={ok:true,url:result.value.url,shape:shapeOf(result.value.data)};
    } else {
      const message=result.reason instanceof Error ? result.reason.message : String(result.reason);
      diagnostics.sources[source.name]={ok:false,urls:source.urls,error:message};
    }
  });

  // Spot exchangeInfo is public, but Binance can return a partial/truncated
  // symbol list from an individual edge. The first successful edge is therefore
  // not necessarily the complete catalogue. Probe every public Spot edge and
  // retain the largest valid symbol set; this prevents a 2-row/partial response
  // from replacing the full Spot universe.
  const initialSpotRows = Array.isArray(raw.spot?.symbols) ? raw.spot.symbols : [];
  if (initialSpotRows.length < 2500) {
    const spotAttempts = await Promise.allSettled(SPOT_HOSTS.map(async host => {
      const data = await getJson(host + '/exchangeInfo');
      const rows = Array.isArray(data?.symbols) ? data.symbols : [];
      if (rows.length < 1000) throw new Error('partial Spot catalogue: ' + rows.length);
      return { data, rows, host };
    }));
    let best: { data: any; rows: Json[]; host: string } | undefined;
    for (const attempt of spotAttempts) {
      if (attempt.status === 'fulfilled' && (!best || attempt.value.rows.length > best.rows.length)) best = attempt.value;
    }
    if (best && best.rows.length > initialSpotRows.length) {
      raw.spot = best.data;
      diagnostics.sources.spot = {
        ...(diagnostics.sources.spot || {}),
        ok: true,
        url: best.host + '/exchangeInfo',
        shape: shapeOf(best.data),
        selectedLargestSpotEdge: true,
        initialRowCount: initialSpotRows.length,
        selectedRowCount: best.rows.length
      };
    }
  }

  // If every exchangeInfo edge is unavailable/partial, Binance's public 24h
  // ticker still exposes the complete currently-traded Spot symbol universe.
  // Reconstruct the catalogue rows from those symbols as a last-resort public
  // fallback. ExchangeInfo remains authoritative whenever it is available.
  let spotRows=Array.isArray(raw.spot?.symbols)?raw.spot.symbols:[];
  if (spotRows.length < 1000) {
    const tickerAttempts = await Promise.allSettled(SPOT_HOSTS.map(async host => {
      const data = await getJson(host + '/ticker/24hr');
      const rows = Array.isArray(data) ? data : [];
      if (rows.length < 1000) throw new Error('partial Spot ticker catalogue: ' + rows.length);
      return { rows, host };
    }));
    let bestTicker: { rows: Json[]; host: string } | undefined;
    for (const attempt of tickerAttempts) {
      if (attempt.status === 'fulfilled' && (!bestTicker || attempt.value.rows.length > bestTicker.rows.length)) bestTicker = attempt.value;
    }
    if (bestTicker && bestTicker.rows.length > spotRows.length) {
      const quoteAssets = ['USDT','USDC','FDUSD','TUSD','USDP','DAI','BUSD','U','USD','BNB','BTC','ETH','BTCC','EUR','GBP','AUD','BRL','TRY','RUB','ZAR','NGN','JPY','PLN','RON','UAH','CHF','CAD','HKD','SGD','MXN','ARS','IDR','THB'];
      const suffixes = [...quoteAssets].sort((a,b)=>b.length-a.length);
      const reconstructed = bestTicker.rows.map(ticker => {
        const symbol=s(ticker?.symbol).toUpperCase();
        const quote=suffixes.find(q=>symbol.endsWith(q));
        const base=quote ? symbol.slice(0,-quote.length) : '';
        return quote && base ? {symbol,status:'TRADING',baseAsset:base,quoteAsset:quote,permissions:['SPOT']} : null;
      }).filter(Boolean) as Json[];
      if (reconstructed.length > spotRows.length) {
        spotRows = reconstructed;
        raw.spot = { ...(raw.spot || {}), symbols: spotRows };
        diagnostics.sources.spot = {
          ...(diagnostics.sources.spot || {}),
          ok: true,
          selectedTickerFallback: true,
          tickerHost: bestTicker.host,
          initialRowCount: spotRows.length,
          reconstructedRowCount: reconstructed.length
        };
      }
    }
  }

  // Binance's web Markets UI exposes a public product catalogue. Use it as the
  // next public fallback when every API exchangeInfo/ticker edge is incomplete.
  // This is still Binance-owned catalogue data; it prevents a transient Render
  // edge response containing only a couple of Spot symbols from becoming the
  // application's complete catalogue.
  if (spotRows.length < 1000) {
    try {
      const productData = await getJson('https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=true');
      const products = extractRows(productData);
      const reconstructed = products.map((product:any) => {
        const symbol=s(product?.s || product?.symbol).toUpperCase();
        const base=s(product?.b || product?.baseAsset).toUpperCase();
        const quote=s(product?.q || product?.quoteAsset).toUpperCase();
        const status=s(product?.st || product?.status || 'TRADING').toUpperCase();
        return symbol && base && quote ? {
          symbol, status, baseAsset:base, quoteAsset:quote,
          permissions:['SPOT'], filters:[],
          // Preserve Binance product metadata for downstream classification.
          tags:product?.tags, etf:product?.etf,
          productType:product?.productType, assetType:product?.assetType,
          name:product?.n, description:product?.description
        } : null;
      }).filter((row:any) => row && row.symbol && row.baseAsset && row.quoteAsset &&
        !['DELISTED','BREAK','HALT'].includes(row.status));
      if (reconstructed.length > spotRows.length) {
        spotRows = reconstructed;
        raw.spot = { ...(raw.spot || {}), symbols: spotRows };
        diagnostics.sources.spot = {
          ...(diagnostics.sources.spot || {}),
          ok:true,
          selectedWebsiteProductFallback:true,
          websiteProductRowCount:reconstructed.length
        };
      }
    } catch (error) {
      diagnostics.sources.spot = {
        ...(diagnostics.sources.spot || {}),
        websiteProductFallbackError:error instanceof Error ? error.message : String(error)
      };
    }
  }

  const out: Json[]=[];
  diagnostics.sources.spot = diagnostics.sources.spot || {ok:Boolean(raw.spot)};
  diagnostics.sources.spot.rawSymbolRows = spotRows.length;
  diagnostics.sources.spot.acceptedSymbolRows = 0;
  function extractRows(value:any): Json[] {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.symbols)) return value.symbols;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.data?.symbols)) return value.data.symbols;
    if (Array.isArray(value?.data?.data)) return value.data.data;
    return [];
  }
  const stockRows = extractRows(raw.stocks);
  const commoditySymbols=new Set<string>();
  const tokenRows=extractRows(raw.tokenized);
  const rwaRows=extractRows(raw.rwa);
  const stockSymbols=new Set<string>();
  // Use explicit Binance tCommodities assets here. The market page also contains
  // the wider Spot catalogue, so scraping generic symbol/baseAsset fields can
  // misclassify ordinary crypto Spot rows as commodities.
  for(const symbol of ['XAUT','PAXG']) commoditySymbols.add(symbol);

  const etfSymbols=new Set<string>();
  for(const row of stockRows) {
    const symbol=s(row?.symbol || row?.s || row?.ticker || row?.code).toUpperCase();
    const text=[row?.assetType,row?.instrumentType,row?.securityType,row?.productType,row?.symbolType,row?.securityCategory,row?.type,row?.subtype,row?.securityTypeName,row?.name,row?.n,row?.description,row?.desc,row?.sec,row?.t].map(s).join(' ').toLowerCase();
    if(symbol) {
      stockSymbols.add(symbol);
      stockSymbols.add(symbol.replace(/^EQ_/,''));
    }
    if(symbol && (row?.etf===true || row?.isETF===true || row?.isEtf===true || row?.et===true || /(^|\W)etf($|\W)|exchange[ ._-]?traded[ ._-]?fund/.test(text))) etfSymbols.add(symbol);
  }
  const bStockSymbols=new Set<string>();
  for(const row of tokenRows) {
    const tokenSymbol=s(row?.assetCode || row?.tokenCode || row?.tokenSymbol || row?.symbol).toUpperCase();
    const tokenText=([row?.assetName,row?.tokenName,row?.name,row?.description,row?.type,row?.assetType,row?.category,row?.subtype].map(s).join(' ')).toLowerCase();
    if(tokenSymbol && !/gold|silver|oil|commodity|commodit|copper|platinum|palladium|tcommodit/.test(tokenText)) {
      const base=tokenSymbol.replace(/USDT$/,'');
      bStockSymbols.add(base.endsWith('B') ? base : base+'B');
    }
  }
  for(const row of [...tokenRows, ...rwaRows]) {
    const commodityText=([row?.assetName,row?.tokenName,row?.name,row?.description,row?.type,row?.assetType,row?.category,row?.subtype,row?.tags,row?.tokenName,row?.underlyingName].map(s).join(' ')+' '+JSON.stringify(row)).toLowerCase();
    const commoditySymbol=s(row?.symbol || row?.ticker || row?.assetCode || row?.tokenCode || row?.tokenSymbol || row?.underlyingTicker).toUpperCase();
    if(commoditySymbol && /gold|silver|oil|commodity|commodit|copper|platinum|palladium/.test(commodityText)) commoditySymbols.add(commoditySymbol.replace(/USDT$/,''));
  }
  for(const row of spotRows) {
    const spotItem=spotInstrument(row,false,bStockSymbols,commoditySymbols);
    if(spotItem) { out.push(spotItem); diagnostics.sources.spot.acceptedSymbolRows++; }
  }
  for(const symbol of ['XAUTUSDT','PAXGUSDT']) {
    if(!out.some(item=>item.marketType==='Spot' && item.symbol===symbol)) {
      const base=symbol.replace(/USDT$/,'');
      out.push({symbol,name:base+'/USDT',provider:'BINANCE',exchange:'BINANCE',marketGroup:'CRYPTO',marketType:'Spot',category:'Spot',marketSubcategory:'Spot',marketSubSubcategory:'tCommodities',marketFilters:['tCommodities','Spot'],marketFilter:'tCommodities',instrumentType:'Crypto Spot',instrumentSubtype:'Tokenized Commodity',quote:'USDT',baseAsset:base,status:'TRADING',margin:false,marginEnabled:false});
    }
  }

  // Binance's Spot exchangeInfo carries the authoritative per-symbol Margin permission.
  // Use it as a public fallback when /sapi/v1/margin/allPairs or isolated/allPairs is unavailable.
  // This keeps the Margin filter populated even when the API key lacks Margin account access.
  for(const row of spotRows) {
    const marginItem=marginInstrument(row);
    if(marginItem) out.push(marginItem);
  }

  for(const row of (Array.isArray(raw.usdtm?.symbols)?raw.usdtm.symbols:[])) {
    const item=futureInstrument(row,'USDT-M',now,etfSymbols); if(item) out.push(item);
  }
  for(const row of (Array.isArray(raw.coinm?.symbols)?raw.coinm.symbols:[])) {
    const item=futureInstrument(row,'COIN-M',now,etfSymbols); if(item) out.push(item);
  }

  for(const row of (Array.isArray(raw.options?.optionSymbols)?raw.options.optionSymbols:[])) {
    const item=optionInstrument(row); if(item) out.push(item);
  }

  for(const row of [
    ...(Array.isArray(raw.margin)?raw.margin:[]),
    ...(Array.isArray(raw.marginIsolated)?raw.marginIsolated:[])
  ]) {
    const item=marginInstrument(row); if(item) out.push(item);
  }

  for(const row of stockRows) {
    const item=equityInstrument(row); if(item) out.push(item);
  }

  for(const row of tokenRows) {
    const item=tokenizedInstrument(row); if(item) out.push(item);
  }

  diagnostics.sources.rwa = diagnostics.sources.rwa || {ok:Boolean(raw.rwa)};
  diagnostics.sources.rwa.recordCount = rwaRows.length;
  diagnostics.sources.rwa.commodityMatches = rwaRows.filter(row => /gold|silver|oil|commodity|commodit|copper|platinum|palladium/i.test(JSON.stringify(row))).slice(0,10);

  const alphaSymbols=Array.isArray(raw.alphaExchange?.data?.symbols)?raw.alphaExchange.data.symbols:Array.isArray(raw.alphaExchange?.symbols)?raw.alphaExchange.symbols:[];
  const alphaTokens=Array.isArray(raw.alphaTokens?.data)?raw.alphaTokens.data:[];
  const tokenByAlphaId=new Map<string,Json>();
  for(const token of alphaTokens) {
    const id=s(token?.alphaId);
    if(id) tokenByAlphaId.set(id,token);
  }
  for(const row of alphaSymbols) {
    const token=tokenByAlphaId.get(s(row?.baseAsset));
    const item=alphaInstrument(row,token,now);
    if(item) out.push(item);
  }

  const map=new Map<string,Json>();
  for(const item of out) {
    const key=item.marketType+':'+item.symbol;
    if(!map.has(key)) map.set(key,item);
  }

  const instruments=[...map.values()].sort((a,b)=>
    String(a.marketGroup).localeCompare(String(b.marketGroup)) ||
    String(a.marketType).localeCompare(String(b.marketType)) ||
    String(a.symbol).localeCompare(String(b.symbol))
  );

  // Futures audit: preserve raw Binance row counts/statuses so we can distinguish\n  // active-trading coverage from rows discarded by our normalizer.\n  for (const [sourceName, kind] of [['usdtm','USDT-M'], ['coinm','COIN-M']] as const) {\n    const rows = Array.isArray(raw[sourceName]?.symbols) ? raw[sourceName].symbols : [];\n    const statusField = sourceName === 'coinm' ? 'contractStatus' : 'status';\n    const statusCounts: Record<string, number> = {};\n    const rejectedSamples: Array<{symbol:string,status:string,contractType:string}> = [];\n    let accepted = 0;\n    for (const row of rows) {\n      const status = s(row?.[statusField]);\n      statusCounts[status || '(missing)'] = (statusCounts[status || '(missing)'] || 0) + 1;\n      const item = futureInstrument(row, kind, now, etfSymbols);\n      if (item) accepted++;\n      else if (rejectedSamples.length < 100) {\n        rejectedSamples.push({ symbol:s(row?.symbol), status, contractType:s(row?.contractType) });\n      }\n    }\n    diagnostics.sources[sourceName].audit = {\n      rawSymbolRows: rows.length,\n      acceptedByNormalizer: accepted,\n      rejectedByNormalizer: rows.length - accepted,\n      statusCounts,\n      rejectedSamples\n    };\n  }\n\n  diagnostics.instrumentCount=instruments.length;
  diagnostics.counts={
    spot:instruments.filter(x=>x.marketType==='Spot' && x.marketGroup==='CRYPTO').length,
    margin:instruments.filter(x=>x.marketType==='Margin').length,
    usdtm:instruments.filter(x=>x.marketSubcategory==='USDT-M').length,
    coinm:instruments.filter(x=>x.marketSubcategory==='COIN-M').length,
    options:instruments.filter(x=>x.marketType==='Options').length,
    stocks:instruments.filter(x=>x.marketGroup==='TRADE FI' && x.marketType==='Stocks').length,
    tokenized:instruments.filter(x=>x.instrumentSubtype==='Tokenized Securities').length,
    alpha:instruments.filter(x=>x.marketGroup==='ALPHA').length,
    tradeFiFutures:{
      Stocks:instruments.filter(x=>x.marketGroup==='TRADE FI' && x.marketType==='Futures' && x.marketSubSubcategory==='Stocks').length,
      ETFs:instruments.filter(x=>x.marketGroup==='TRADE FI' && x.marketType==='Futures' && x.marketSubSubcategory==='ETFs').length,
      Commodities:instruments.filter(x=>x.marketGroup==='TRADE FI' && x.marketType==='Futures' && x.marketSubSubcategory==='Commodities').length,
      Fx:instruments.filter(x=>x.marketGroup==='TRADE FI' && x.marketType==='Futures' && x.marketSubSubcategory==='Fx').length,
      'Pre-IPO':instruments.filter(x=>x.marketGroup==='TRADE FI' && x.marketType==='Futures' && x.marketSubSubcategory==='Pre-IPO').length
    },
    tradeFiSpot:{
      bStocks:instruments.filter(x=>x.marketGroup==='TRADE FI' && x.marketType==='Spot' && x.marketSubSubcategory==='bStocks').length,
      tCommodities:instruments.filter(x=>x.marketGroup==='TRADE FI' && x.marketType==='Spot' && x.marketSubSubcategory==='tCommodities').length
    }
  };

  return {instruments, diagnostics};
}

