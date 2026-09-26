export type MarketProvider = 'DERIV' | 'BINANCE' | 'BITGET' | 'BYBIT' | 'OKX';

export interface UnifiedInstrument {
  id: string;
  provider: MarketProvider;
  providerLabel: string;
  marketType: string;
  category: string;
  symbol: string;
  displaySymbol: string;
  name: string;
  base?: string;
  quote?: string;
  price?: number;
  bid?: number;
  ask?: number;
  exchangeOpen?: number;
  status?: string;
  logoUrl: string;
  providerLogoUrl: string;
}

const CACHE_MS = 5 * 60 * 1000;
let cached: { at: number; instruments: UnifiedInstrument[] } | null = null;
let loading: Promise<UnifiedInstrument[]> | null = null;

const providerLogo = (name: string) => {
  const value = String(name || '').trim().toLowerCase();
  if (value === 'deriv') return 'https://deriv.com/favicon.ico';
  return 'https://cdn.simpleicons.org/' + value;
};
const assetLogo = (base?: string) => {
  const value = String(base || '').trim().toLowerCase();
  // Primary source: stable PNG crypto icon set. Keep the older SVG set as the
  // browser-side fallback when a symbol is missing from the primary set.
  return value ? 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + encodeURIComponent(value) + '.png' : '';
};


async function getJson(url: string, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getJsonAny(urls: string[], timeoutMs = 10000) {
  let last: unknown;
  for (const url of urls) {
    try { return await getJson(url, timeoutMs); } catch (error) { last = error; }
  }
  throw last || new Error('All market endpoints failed');
}

function cryptoItem(provider: MarketProvider, marketType: string, category: string, raw: any, price?: any): UnifiedInstrument | null {
  const symbol = String(raw?.symbol || raw?.instId || '').trim();
  if (!symbol) return null;
  const base = String(raw?.baseCoin || raw?.baseAsset || raw?.baseCcy || '').trim() || undefined;
  const quote = String(raw?.quoteCoin || raw?.quoteAsset || raw?.quoteCcy || '').trim() || undefined;
  const display = symbol;
  const name = String(raw?.fullName || raw?.displayName || (base ? base + (quote ? ' / ' + quote : '') : symbol));
  const p = Number(price?.last ?? price?.lastPrice ?? price?.close ?? price?.price);
  const bid = Number(price?.bidPrice ?? price?.bidPx ?? price?.bid1Price);
  const ask = Number(price?.askPrice ?? price?.askPx ?? price?.ask1Price);
  return {
    id: provider + ':' + marketType + ':' + symbol,
    provider,
    providerLabel: provider[0] + provider.slice(1).toLowerCase(),
    marketType,
    category,
    symbol,
    displaySymbol: display,
    name,
    base,
    quote,
    price: Number.isFinite(p) ? p : undefined,
    bid: Number.isFinite(bid) ? bid : undefined,
    ask: Number.isFinite(ask) ? ask : undefined,
    exchangeOpen: 1,
    status: String(raw?.status || raw?.state || 'online'),
    logoUrl: assetLogo(base) || providerLogo(provider),
    providerLogoUrl: providerLogo(provider),
  };
}

async function binance(): Promise<UnifiedInstrument[]> {
  const [spot, futures] = await Promise.all([
    getJsonAny(['https://api.binance.com/api/v3/exchangeInfo','https://api1.binance.com/api/v3/exchangeInfo','https://api2.binance.com/api/v3/exchangeInfo']),
    getJsonAny(['https://fapi.binance.com/fapi/v1/exchangeInfo','https://fapi1.binance.com/fapi/v1/exchangeInfo','https://fapi2.binance.com/fapi/v1/exchangeInfo']),
  ]);
  // Quote cards no longer display prices, so do not download thousands of 24h ticker rows.
  // This keeps catalogue startup light and leaves live quotes to the market-data layer.
  return [
    ...(spot?.symbols || []).filter((x: any) => x.status === 'TRADING').map((x: any) => cryptoItem('BINANCE', 'Spot', 'Crypto', x)).filter(Boolean),
    ...(futures?.symbols || []).filter((x: any) => x.status === 'TRADING').map((x: any) => cryptoItem('BINANCE', 'Futures', 'Crypto', x)).filter(Boolean),
  ] as UnifiedInstrument[];
}

async function bitget(): Promise<UnifiedInstrument[]> {
  const categories = ['SPOT', 'USDT-FUTURES', 'COIN-FUTURES', 'USDC-FUTURES'];
  const responses = await Promise.all(categories.map(category => getJsonAny([
    'https://api.bitget.com/api/v3/market/instruments?category=' + category,
    'https://api.bitget.com/api/v2/spot/public/symbols'
  ])));
  const out: UnifiedInstrument[] = [];
  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    const items = Array.isArray(responses[i]?.data) ? responses[i].data : [];
    for (const raw of items) {
      if (String(raw.status || '').toLowerCase() !== 'online') continue;
      const item = cryptoItem('BITGET', category === 'SPOT' ? 'Spot' : category.replace('-FUTURES', ' Futures'), 'Crypto', raw);
      if (item) out.push(item);
    }
  }
  return out;
}

async function bybit(): Promise<UnifiedInstrument[]> {
  const categories = ['spot', 'linear', 'inverse', 'option'];
  const out: UnifiedInstrument[] = [];
  for (const category of categories) {
    let cursor = '';
    for (let page = 0; page < 12; page++) {
      const url = 'https://api.bybit.com/v5/market/instruments-info?category=' + category + '&limit=1000' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const response = await getJsonAny([url, url.replace('https://api.bybit.com/', 'https://api.bytick.com/')]);
      const items = Array.isArray(response?.result?.list) ? response.result.list : [];
      for (const raw of items) {
        if (String(raw.status || '').toLowerCase() !== 'trading') continue;
        const item = cryptoItem('BYBIT', category === 'spot' ? 'Spot' : category === 'linear' ? 'Perpetuals' : category === 'inverse' ? 'Inverse Futures' : 'Options', 'Crypto', raw);
        if (item) out.push(item);
      }
      cursor = String(response?.result?.nextPageCursor || '');
      if (!cursor || !items.length || category === 'spot') break;
    }
  }
  return out;
}

async function okx(): Promise<UnifiedInstrument[]> {
  const types = ['SPOT', 'SWAP', 'FUTURES', 'OPTION'];
  const out: UnifiedInstrument[] = [];
  for (const instType of types) {
    const response = await getJsonAny([
      'https://www.okx.com/api/v5/public/instruments?instType=' + instType,
      'https://www.okx.com/api/v5/public/instruments?instType=' + instType + '&instFamily=USDT'
    ]);
    const items = Array.isArray(response?.data) ? response.data : [];
    for (const raw of items) {
      if (String(raw.state || '').toLowerCase() !== 'live') continue;
      const marketType = instType === 'SPOT' ? 'Spot' : instType === 'SWAP' ? 'Perpetuals' : instType === 'FUTURES' ? 'Futures' : 'Options';
      const item = cryptoItem('OKX', marketType, raw.instCategory === '3' ? 'Stocks' : raw.instCategory === '4' ? 'Metals' : raw.instCategory === '5' ? 'Commodities' : raw.instCategory === '6' ? 'Forex' : 'Crypto', raw);
      if (item) out.push(item);
    }
  }
  return out;
}

function derivItem(raw: any): UnifiedInstrument | null {
  const symbol = String(raw?.symbol || '').trim();
  if (!symbol) return null;
  const name = String(raw?.display_name || raw?.name || symbol);
  return {
    id: 'DERIV:Market:' + symbol,
    provider: 'DERIV',
    providerLabel: 'Deriv',
    marketType: 'Market',
    category: String(raw?.market || raw?.market_display_name || 'Deriv'),
    symbol,
    displaySymbol: symbol,
    name,
    base: undefined,
    quote: undefined,
    price: undefined,
    bid: undefined,
    ask: undefined,
    exchangeOpen: Number(raw?.exchangeOpen ?? raw?.exchange_open ?? 1),
    status: Number(raw?.tradingSuspended ?? raw?.trading_suspended ?? 0) === 1 ? 'suspended' : 'online',
    logoUrl: providerLogo('deriv'),
    providerLogoUrl: providerLogo('deriv'),
  };
}

export async function getUnifiedMarketCatalogue(fetchDeriv: () => Promise<any[]>): Promise<UnifiedInstrument[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.instruments;
  if (loading) return loading;
  loading = (async () => {
    const providers: Array<[MarketProvider, Promise<UnifiedInstrument[]>]> = [
      ['DERIV', fetchDeriv().then(items => items.map(derivItem).filter(Boolean) as UnifiedInstrument[])],
      ['BINANCE', binance()],
      ['BITGET', bitget()],
      ['BYBIT', bybit()],
      ['OKX', okx()],
    ];
    const results = await Promise.allSettled(providers.map(([, promise]) => promise));
    results.forEach((result, index) => {
      if (result.status === 'rejected') console.warn('[SIRE MARKET CATALOG] provider failed:', providers[index][0], result.reason);
    });
    const instruments = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    const seen = new Set<string>();
    const unique = instruments.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    // Deliberately mix providers/market types. The UI is one TradingView-style
    // searchable catalogue rather than provider/category sections.
    unique.sort((a, b) => (a.name + a.symbol).localeCompare(b.name + b.symbol));
    cached = { at: Date.now(), instruments: unique };
    return unique;
  })().finally(() => { loading = null; });
  return loading;
}
