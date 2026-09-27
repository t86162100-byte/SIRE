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
  const families: Array<[string, string[]]> = [
    ['Spot', ['https://data-api.binance.vision/api/v3/exchangeInfo','https://api.binance.com/api/v3/exchangeInfo','https://api-gcp.binance.com/api/v3/exchangeInfo','https://api1.binance.com/api/v3/exchangeInfo','https://api2.binance.com/api/v3/exchangeInfo']],
    ['USD-M Futures', ['https://fapi.binance.com/fapi/v1/exchangeInfo','https://fapi1.binance.com/fapi/v1/exchangeInfo','https://fapi2.binance.com/fapi/v1/exchangeInfo']],
    ['COIN-M Futures', ['https://dapi.binance.com/dapi/v1/exchangeInfo']],
    ['Options', ['https://eapi.binance.com/eapi/v1/exchangeInfo']]
  ];
  const out: UnifiedInstrument[] = [];
  for (const [family, urls] of families) {
    try {
      const response = await getJsonAny(urls);
      const rows = family === 'Options' ? (Array.isArray(response?.optionSymbols) ? response.optionSymbols : []) : (Array.isArray(response?.symbols) ? response.symbols : []);
      for (const raw of rows) {
        if (String(raw?.status || raw?.contractStatus || '').toUpperCase() !== 'TRADING') continue;
        const normalized = family === 'Options'
          ? { ...raw, baseAsset: String(raw?.underlying || '').replace(/USDT$|USDC$|USD$/i, ''), quoteAsset: raw?.quoteAsset || 'USDT' }
          : raw;
        const item = cryptoItem('BINANCE', family, 'Crypto', normalized);
        if (item) out.push(item);
      }
      console.log('[SIRE BINANCE] ' + family + ': ' + out.filter(x => x.marketType === family).length);
    } catch (error) {
      console.warn('[SIRE BINANCE] ' + family + ' failed:', error);
    }
  }
  return out;
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
      const query = '?category=' + category + '&limit=1000' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      // Bybit documents api.bybit.com as the mainnet endpoint, but US-hosted
      // server IPs receive HTTP 403. Try the documented regional mainnet
      // endpoints as fallbacks so a Render US instance can still build the
      // public instrument catalogue without authentication.
      const response = await getJsonAny([
        'https://api.bybit.com/v5/market/instruments-info' + query,
        'https://api.bybit.tr/v5/market/instruments-info' + query,
        'https://api.bybit.ae/v5/market/instruments-info' + query,
        'https://api.bybit.eu/v5/market/instruments-info' + query,
        'https://api.bybit.kz/v5/market/instruments-info' + query,
        'https://api.bybitgeorgia.ge/v5/market/instruments-info' + query,
        'https://api.bybit.id/v5/market/instruments-info' + query,
        'https://api.spark-fintech.com/v5/market/instruments-info' + query,
        'https://api.bytick.com/v5/market/instruments-info' + query
      ]);
      if (Number(response?.retCode) !== 0) throw new Error(String(response?.retMsg || 'Bybit API error'));
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
      'https://app.okx.com/api/v5/public/instruments?instType=' + instType,
      'https://my.okx.com/api/v5/public/instruments?instType=' + instType
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
  const symbol = String(raw?.symbol || raw?.underlying_symbol || '').trim();
  if (!symbol) return null;
  const name = String(raw?.display_name || raw?.underlying_symbol_name || raw?.name || symbol);
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
    exchangeOpen: Number(raw?.exchangeOpen ?? raw?.exchange_open ?? raw?.exchange_is_open ?? 1),
    status: Number(raw?.tradingSuspended ?? raw?.trading_suspended ?? raw?.is_trading_suspended ?? 0) === 1 ? 'suspended' : 'online',
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
    const counts = unique.reduce<Record<string, number>>((acc, item) => { acc[item.provider] = (acc[item.provider] || 0) + 1; return acc; }, {});
    console.log('[SIRE MARKET CATALOG] provider counts:', JSON.stringify(counts));
    cached = { at: Date.now(), instruments: unique };
    return unique;
  })().finally(() => { loading = null; });
  return loading;
}
