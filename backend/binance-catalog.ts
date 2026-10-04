type Json = Record<string, any>;

const SPOT_HOSTS = ['https://data-api.binance.vision/api/v3','https://api.binance.com/api/v3','https://api-gcp.binance.com/api/v3','https://api1.binance.com/api/v3','https://api2.binance.com/api/v3','https://api3.binance.com/api/v3','https://api4.binance.com/api/v3'];
const UM_HOSTS = ['https://fapi.binance.com/fapi/v1','https://fapi1.binance.com/fapi/v1','https://fapi2.binance.com/fapi/v1','https://fapi3.binance.com/fapi/v1','https://fapi4.binance.com/fapi/v1','https://www.binance.com/fapi/v1'];
const CM_HOSTS = ['https://dapi.binance.com/dapi/v1','https://www.binance.com/dapi/v1'];
const OPTIONS_HOSTS = ['https://eapi.binance.com/eapi/v1'];
const MARGIN_HOSTS = ['https://api.binance.com/sapi/v1/margin','https://api-gcp.binance.com/sapi/v1/margin'];
const MARGIN_ISOLATED_HOSTS = ['https://api.binance.com/sapi/v1/margin/isolated','https://api-gcp.binance.com/sapi/v1/margin/isolated'];
const EQUITY = 'https://api.binance.com/sapi/v1/equity/market';
const ALPHA = 'https://www.binance.com/bapi/defi/v1/public';

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

function spotInstrument(raw: Json, margin = false): Json | null {
  const symbol = s(raw?.symbol);
  if (!symbol || !['TRADING','PENDING_TRADING'].includes(s(raw?.status))) return null;
  const quote = s(raw?.quoteAsset).toUpperCase();
  const base = s(raw?.baseAsset).toUpperCase();
  const bucket = quoteBucket(quote);
  return {
    symbol, name: base + '/' + quote, provider:'BINANCE', exchange:'BINANCE',
    marketGroup:'CRYPTO', marketType:margin?'Margin':'Spot', category:margin?'Margin':'Spot',
    marketSubcategory:margin?'Margin':'Spot',
    marketSubSubcategory:margin ? base || 'All' : bucket,
    marketFilters:uniq([bucket, 'Spot', ...(margin ? ['Margin'] : [])]),
    marketFilter:margin ? base : bucket,
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
    category:tradfi?'TradFi Futures':'Futures', marketSubcategory:kind,
    marketSubSubcategory:tradfi ? (tags[0] || 'Stocks') : kind,
    marketFilters:uniq([...derived, kind, ct==='PERPETUAL'?'Perpetual':'Expiring', quote]),
    marketFilter:tags[0] || kind, instrumentType:tradfi?'TradFi Futures':'Crypto Futures',
    instrumentSubtype:tags.join(', '), quote, baseAsset:base, settlement:kind,
    status:s(raw?.status || raw?.contractStatus), pipSize:tickSize(raw),
    onboardDate:onboard, expiry:n(raw?.deliveryDate), newListing:isNew
  };
}

function isEtfFromBinance(raw: Json) {
  if (raw?.isETF === true || raw?.isEtf === true) return true;
  const text = [
    raw?.assetType, raw?.instrumentType, raw?.securityType, raw?.productType,
    raw?.symbolType, raw?.securityCategory
  ].map(s).join(' ').toLowerCase();
  return /(^|\W)etf($|\W)|exchange.traded.fund/.test(text);
}

function equityInstrument(raw: Json): Json | null {
  const symbol=s(raw?.symbol).toUpperCase();
  if(!symbol || s(raw?.tradability)==='NONE') return null;
  const isEtf=isEtfFromBinance(raw);
  return {
    symbol, name:s(raw?.name || symbol), provider:'BINANCE', exchange:'BINANCE',
    marketGroup:'TRADE FI', marketType:'Stocks', category:'Stocks',
    marketSubcategory:'Stocks', marketSubSubcategory:isEtf?'ETFs':'U.S. stock',
    marketFilters:uniq([isEtf?'ETFs':'U.S. stock','Stocks']),
    marketFilter:isEtf?'ETFs':'U.S. stock',
    instrumentType:isEtf?'ETF':'U.S. stock', instrumentSubtype:s(raw?.assetType || raw?.securityType),
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
    underlyingEquitySymbol:s(raw?.underlyingEquitySymbol),
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
    {name:'stocks', urls:[EQUITY+'/exchangeInfo'], apiKey:true},
    {name:'tokenized', urls:[EQUITY+'/tokenized-assets'], apiKey:true},
    {name:'alphaExchange', urls:[ALPHA+'/alpha-trade/get-exchange-info'], apiKey:false},
    {name:'alphaTokens', urls:[ALPHA+'/wallet-direct/buw/wallet/cex/alpha/all/token/list'], apiKey:false}
  ];

  const settled = await Promise.allSettled(sources.map(async source => {
    const errors:string[]=[];
    for(const url of source.urls) {
      try {
        const data=await getJson(url, source.apiKey ? apiKey : '');
        if ((source.name==='usdtm' || source.name==='coinm' || source.name==='spot') && !Array.isArray(data?.symbols)) {
          throw new Error('Binance returned no symbols array from '+url);
        }
        if (source.name==='options' && !Array.isArray(data?.optionSymbols)) {
          throw new Error('Binance returned no optionSymbols array from '+url);
        }
        if ((source.name==='margin' || source.name==='marginIsolated') && !Array.isArray(data)) {
          throw new Error('Binance returned no Margin pair array from '+url);
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

  const out: Json[]=[];
  const spotRows=Array.isArray(raw.spot?.symbols)?raw.spot.symbols:[];
  for(const row of spotRows) {
    const spotItem=spotInstrument(row,false);
    if(spotItem) out.push(spotItem);
  }

  // Binance's Spot exchangeInfo carries the authoritative per-symbol Margin permission.
  // Use it as a public fallback when /sapi/v1/margin/allPairs or isolated/allPairs is unavailable.
  // This keeps the Margin filter populated even when the API key lacks Margin account access.
  for(const row of spotRows) {
    const marginItem=marginInstrument(row);
    if(marginItem) out.push(marginItem);
  }

  for(const row of (Array.isArray(raw.usdtm?.symbols)?raw.usdtm.symbols:[])) {
    const item=futureInstrument(row,'USDT-M',now); if(item) out.push(item);
  }
  for(const row of (Array.isArray(raw.coinm?.symbols)?raw.coinm.symbols:[])) {
    const item=futureInstrument(row,'COIN-M',now); if(item) out.push(item);
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

  for(const row of (Array.isArray(raw.stocks?.symbols)?raw.stocks.symbols:[])) {
    const item=equityInstrument(row); if(item) out.push(item);
  }

  const tokenRows=Array.isArray(raw.tokenized)?raw.tokenized:Array.isArray(raw.tokenized?.data)?raw.tokenized.data:[];
  for(const row of tokenRows) {
    const item=tokenizedInstrument(row); if(item) out.push(item);
  }

  const alphaSymbols=Array.isArray(raw.alphaExchange?.data?.symbols)?raw.alphaExchange.data.symbols:[];
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

  diagnostics.instrumentCount=instruments.length;
  diagnostics.counts={
    spot:instruments.filter(x=>x.marketType==='Spot' && x.marketGroup==='CRYPTO').length,
    margin:instruments.filter(x=>x.marketType==='Margin').length,
    usdtm:instruments.filter(x=>x.marketSubcategory==='USDT-M').length,
    coinm:instruments.filter(x=>x.marketSubcategory==='COIN-M').length,
    options:instruments.filter(x=>x.marketType==='Options').length,
    stocks:instruments.filter(x=>x.marketGroup==='TRADE FI' && x.marketType==='Stocks').length,
    tokenized:instruments.filter(x=>x.instrumentSubtype==='Tokenized Securities').length,
    alpha:instruments.filter(x=>x.marketGroup==='ALPHA').length
  };

  return {instruments, diagnostics};
}
