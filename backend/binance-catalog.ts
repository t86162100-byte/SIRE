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

const CANONICAL_ASSET_CHAINS: Record<string,string> = {
  BTC:'bitcoin', ETH:'ethereum', BNB:'bnb', SOL:'solana', XRP:'xrp',
  ADA:'cardano', DOGE:'dogecoin', AVAX:'avalanche', DOT:'polkadot',
  LINK:'ethereum', UNI:'ethereum', ATOM:'cosmos', TRX:'tron',
  TON:'ton', SUI:'sui', APT:'aptos', NEAR:'near', ARB:'arbitrum',
  OP:'optimism', MATIC:'polygon', POL:'polygon', PEPE:'ethereum',
  USDT:'ethereum', USDC:'ethereum', DAI:'ethereum', WBTC:'ethereum',
  SHIB:'ethereum', AAVE:'ethereum', MKR:'ethereum', CRV:'ethereum',
  COMP:'ethereum', LDO:'ethereum', SNX:'ethereum', INJ:'injective',
  TIA:'cosmos', SEI:'sei', FIL:'filecoin', ICP:'internet-computer',
  HBAR:'hedera', ALGO:'algorand', XLM:'stellar', ETC:'ethereum-classic',
  BCH:'bitcoincash', LTC:'litecoin', XMR:'monero', KAS:'kaspa',
  KAVA:'kava', EGLD:'multiversx', FLOW:'flow', EOS:'eos',
  NEO:'neo', VET:'vechain', THETA:'theta', GRT:'ethereum',
  SAND:'ethereum', MANA:'ethereum', ENJ:'ethereum', RENDER:'solana',
  JUP:'solana', WIF:'solana', BONK:'solana', RAY:'solana',
  JTO:'solana', PYTH:'solana', TWT:'bsc', CAKE:'bsc'
};

function enrichChainMetadata(item: Json): Json {
  const explicit = s(item?.chain || item?.chainName || item?.network || item?.networkName || item?.blockchain || item?.blockchainName);
  const base = s(item?.baseAsset || item?.base || '').toUpperCase();
  const chain = explicit || CANONICAL_ASSET_CHAINS[base] || '';
  if (!chain) {
    return {
      ...item,
      chain: '',
      chainSymbol: '',
      chainSource: 'none'
    };
  }
  const chainKey = norm(chain);
  const chainSymbols: Record<string,string> = {
    bitcoin:'BTC', ethereum:'ETH', eth:'ETH', bnb:'BNB', bsc:'BSC',
    solana:'SOL', sol:'SOL', xrp:'XRP', cardano:'ADA', dogecoin:'DOGE',
    avalanche:'AVAX', polkadot:'DOT', cosmos:'ATOM', tron:'TRX', ton:'TON',
    sui:'SUI', aptos:'APT', near:'NEAR', arbitrum:'ARB', optimism:'OP',
    polygon:'POL', matic:'MATIC', base:'BASE', sonic:'SONIC', injective:'INJ',
    sei:'SEI', filecoin:'FIL', 'internetcomputer':'ICP', hedera:'HBAR',
    algorand:'ALGO', stellar:'XLM', 'ethereumclassic':'ETC', bitcoincash:'BCH',
    litecoin:'LTC', monero:'XMR', kaspa:'KAS', kava:'KAVA', multiversx:'EGLD',
    flow:'FLOW', eos:'EOS', neo:'NEO', vechain:'VET', theta:'THETA'
  };
  return {
    ...item,
    chain,
    chainSymbol: s(item?.chainSymbol || item?.networkSymbol || item?.blockchainSymbol) || chainSymbols[chainKey] || chain.toUpperCase().slice(0,6),
    chainSource: explicit ? 'binance' : 'canonical-asset'
  };
}
