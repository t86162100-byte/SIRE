type Json = Record<string, any>;

const API_BASE = 'https://api.bitget.com';
const CATEGORIES = ['SPOT', 'MARGIN', 'USDT-FUTURES', 'COIN-FUTURES', 'USDC-FUTURES'] as const;
const CACHE_TTL_MS = 60_000;
let cache: { at: number; data: Json } | null = null;
let inflight: Promise<Json> | null = null;

const s = (v: unknown) => String(v ?? '').trim();
const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};
const upper = (v: unknown) => s(v).toUpperCase();

async function getJson(url: string) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json', 'User-Agent': 'SIRE-Bitget-Catalog/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  if (!response.ok || payload?.code !== '00000') {
    throw new Error('Bitget instruments request failed: ' + s(payload?.msg || raw || response.statusText).slice(0, 300));
  }
  return Array.isArray(payload?.data) ? payload.data : [];
}

function quoteBucket(quote: string) {
  const q = upper(quote);
  if (['USDT','USDC','U','USD','BNB','BTC','BTCC','ETH'].includes(q)) return q;
  if (['EUR','GBP','AUD','BRL','TRY','RUB','ZAR','NGN','JPY','PLN','RON','UAH','CHF','CAD','HKD','SGD','MXN','ARS','IDR','THB'].includes(q)) return 'FIAT';
  return 'ALTs';
}

function tickSize(row: Json) {
  return n(row?.pricePrecision !== undefined ? undefined : row?.tickSize);
}

function normalize(row: Json, requestedCategory: string): Json | null {
  const symbol = upper(row?.symbol);
  const category = upper(row?.category || requestedCategory);
  const status = s(row?.status).toLowerCase();
  if (!symbol || !['online', 'listed'].includes(status)) return null;

  const base = upper(row?.baseCoin || row?.baseAsset);
  const quote = upper(row?.quoteCoin || row?.quoteAsset);
  const reality = s(row?.isReality).toLowerCase() === 'yes';
  const rwa = s(row?.isRwa).toLowerCase() === 'yes';
  const launchTime = n(row?.launchTime);
  const isNew = Number.isFinite(launchTime) ? Date.now() - Number(launchTime) < 30 * 86400000 : false;

  if (category === 'SPOT') {
    const filters = [quoteBucket(quote), 'Spot'];
    if (rwa) filters.push('RWA');
    if (reality) filters.push('Reality');
    return {
      symbol, name: base && quote ? base + '/' + quote : symbol,
      provider:'BITGET', exchange:'BITGET', marketGroup:'CRYPTO',
      marketType:'Spot', category:'Spot', marketSubcategory:'Spot',
      marketSubSubcategory:quoteBucket(quote), marketFilter:quoteBucket(quote),
      marketFilters:[...new Set(filters)], instrumentType:reality ? 'Reality Stock' : rwa ? 'RWA Spot' : 'Crypto Spot',
      instrumentSubtype:reality ? 'Reality' : rwa ? 'RWA' : 'Spot',
      quote, quoteAsset:quote, baseAsset:base, status:'TRADING',
      margin:false, marginEnabled:false, isRwa:rwa, isReality:reality,
      pipSize:tickSize(row), pricePrecision:n(row?.pricePrecision),
      quantityPrecision:n(row?.quantityPrecision), quotePrecision:n(row?.quotePrecision),
      minOrderQty:n(row?.minOrderQty), minOrderAmount:n(row?.minOrderAmount),
      maxOrderQty:n(row?.maxOrderQty), onboardDate:launchTime, newListing:isNew
    };
  }

  if (category === 'MARGIN') {
    const filters = ['Margin'];
    if (base) filters.push(base);
    if (quote) filters.push(quote);
    return {
      symbol, name: base && quote ? base + '/' + quote : symbol,
      provider:'BITGET', exchange:'BITGET', marketGroup:'CRYPTO',
      marketType:'Margin', category:'Margin', marketSubcategory:'Margin',
      marketSubSubcategory:'Margin', marketFilter:base || quote || 'Margin',
      marketFilters:[...new Set(filters)], instrumentType:'Crypto Margin',
      instrumentSubtype:'Margin', quote, quoteAsset:quote, baseAsset:base,
      status:'TRADING', margin:true, marginEnabled:true,
      maxCrossedLeverage:n(row?.maxCrossedLeverage),
      maxIsolatedLeverage:n(row?.maxIsolatedLeverage),
      userMinBorrow:n(row?.userMinBorrow),
      pipSize:tickSize(row), pricePrecision:n(row?.pricePrecision),
      quantityPrecision:n(row?.quantityPrecision), quotePrecision:n(row?.quotePrecision)
    };
  }

  const isUSDT = category === 'USDT-FUTURES';
  const isUSDC = category === 'USDC-FUTURES';
  const marketSubcategory = isUSDT ? 'USDT-M' : isUSDC ? 'USDC-M' : 'COIN-M';
  const contractType = s(row?.type).toLowerCase();
  const subtype = contractType === 'perpetual' ? 'Perpetual' : contractType === 'delivery' ? 'Delivery' : contractType || 'Futures';
  const filters = [marketSubcategory, subtype];
  if (isNew) filters.push('New');
  if (quote) filters.push(quote);

  return {
    symbol, name: base + (quote ? '/' + quote : '') + ' ' + subtype,
    provider:'BITGET', exchange:'BITGET', marketGroup:'CRYPTO',
    marketType:'Futures', category:'Futures', marketSubcategory,
    marketSubSubcategory:marketSubcategory, marketFilter:marketSubcategory,
    marketFilters:[...new Set(filters)], instrumentType:'Crypto Futures',
    instrumentSubtype:subtype, quote, quoteAsset:quote, baseAsset:base,
    settlement:marketSubcategory, contractType:subtype, status:'TRADING',
    margin:false, marginEnabled:false, onboardDate:launchTime, newListing:isNew,
    pipSize:tickSize(row), pricePrecision:n(row?.pricePrecision),
    quantityPrecision:n(row?.quantityPrecision), quotePrecision:n(row?.quotePrecision),
    minOrderQty:n(row?.minOrderQty), minOrderAmount:n(row?.minOrderAmount)
  };
}

async function loadCatalog(): Promise<Json> {
  const settled = await Promise.all(CATEGORIES.map(async category => {
    const rows = await getJson(API_BASE + '/api/v3/public/instruments?category=' + encodeURIComponent(category));
    return { category, rows };
  }));

  const instruments: Json[] = [];
  const seen = new Set<string>();
  const counts: Record<string, number> = {};

  for (const { category, rows } of settled) {
    let accepted = 0;
    for (const row of rows) {
      const item = normalize(row, category);
      if (!item) continue;
      const key = category + ':' + item.symbol;
      if (seen.has(key)) continue;
      seen.add(key);
      instruments.push(item);
      accepted++;
    }
    counts[category] = accepted;
  }

  return {
    ok:true,
    provider:'BITGET',
    source:'Bitget UTA /api/v3/public/instruments',
    generatedAt:Date.now(),
    count:instruments.length,
    counts,
    categories:[...CATEGORIES],
    instruments
  };
}

export async function fetchBitgetCatalogServer(force = false): Promise<Json> {
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = loadCatalog()
    .then(data => {
      cache = { at:Date.now(), data };
      return data;
    })
    .finally(() => { inflight = null; });

  return inflight;
}

export function bitgetCatalogStatus() {
  return {
    ok:Boolean(cache?.data),
    provider:'BITGET',
    cachedAt:cache?.at || null,
    count:cache?.data?.count || 0,
    counts:cache?.data?.counts || {},
    ttlMs:CACHE_TTL_MS,
    refreshInFlight:Boolean(inflight)
  };
}
