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

const providerLogo = (name: string) => name === 'deriv' ? 'https://deriv.com/favicon.ico' : 'https://cdn.simpleicons.org/' + name.toLowerCase();
const assetLogo = (base?: string) => {
  const value = String(base || '').trim().toLowerCase();
  return value ? 'https://cdn.jsdelivr.net/gh/vadimmalykhin/binance-icons/crypto/' + encodeURIComponent(value) + '.svg' : '';
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

function cryptoItem(provider: MarketProvider, marketType: string, category: string, raw: any, price?: any): UnifiedInstrument | null {
  const symbol = String(raw?.symbol || raw?.instId || '').trim();
  if (!symbol) return null;
  const base = String(raw?.baseCoin || raw?.baseAsset || raw?.baseCcy || '').trim() || undefined;
  const quote = String(raw?.quoteCoin || raw?.quoteAsset || raw?.quoteCcy || '').trim() || undefined;
  const clean = symbol.replace(/[-_]/g, '');
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
    getJson('https://api.binance.com/api/v3/exchangeInfo'),
    getJson('https://fapi.binance.com/fapi/v1/exchangeInfo'),
  ]);
  const [spotTickers, futureTickers] = await Promise.all([
    getJson('https://api.binance.com/api/v3/ticker/24hr'),
    getJson('https://fapi.binance.com/fapi/v1/ticker/24hr'),
  ]);
  const sm = new Map((Array.isArray(spotTickers) ? spotTickers : []).map((x: any) => [String(x.symbol), x]));
  const fm = new Map((Array.isArray(futureTickers) ? futureTickers : []).map((x: any) => [String(x.symbol), x]));
  return [
    ...(spot?.symbols || []).filter((x: any) => x.status === 'TRADING').map((x: any) => cryptoItem('BINANCE', 'Spot', 'Crypto', x, sm.get(x.symbol))).filter(Boolean),
    ...(futures?.symbols || []).filter((x: any) => x.status === 'TRADING').map((x: any) => cryptoItem('BINANCE', 'Futures', 'Crypto', x, fm.get(x.symbol))).filter(Boolean),
  ] as UnifiedInstrument[];
}

async function bitget(): Promise<UnifiedInstrument[]> {
  const categories = ['SPOT', 'USDT-FUTURES', 'COIN-FUTURES', 'USDC-FUTURES'];
  const responses = await Promise.all(categories.map(category => getJson('https://api.bitget.com/api/v3/market/instruments?category=' + category)));
  const out: UnifiedInstrument[] = [];
  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    const items = Array.isArray(responses[i]?.data) ? responses[i].data : [];
    let tickers: any[] = [];
    try {
      const ticker = await getJson('https://api.bitget.com/api/v3/market/tickers?category=' + category);
      tickers = Array.isArray(ticker?.data) ? ticker.data : [];
    } catch {}
    const tm = new Map(tickers.map(x => [String(x.symbol), x]));
    for (const raw of items) {
      if (String(raw.status || '').toLowerCase() !== 'online') continue;
      const item = cryptoItem('BITGET', category === 'SPOT' ? 'Spot' : category.replace('-FUTURES', ' Futures'), 'Crypto', raw, tm.get(raw.symbol));
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
      const response = await getJson(url);
      const items = Array.isArray(response?.result?.list) ? response.result.list : [];
      let tickers: any[] = [];
      try {
        const ticker = await getJson('https://api.bybit.com/v5/market/tickers?category=' + category);
        tickers = Array.isArray(ticker?.result?.list) ? ticker.result.list : [];
      } catch {}
      const tm = new Map(tickers.map(x => [String(x.symbol), x]));
      for (const raw of items) {
        if (String(raw.status || '').toLowerCase() !== 'trading') continue;
        const item = cryptoItem('BYBIT', category === 'spot' ? 'Spot' : category === 'linear' ? 'Perpetuals' : category === 'inverse' ? 'Inverse Futures' : 'Options', 'Crypto', raw, tm.get(raw.symbol));
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
    const response = await getJson('https://www.okx.com/api/v5/public/instruments?instType=' + instType);
    const items = Array.isArray(response?.data) ? response.data : [];
    let tickerData: any[] = [];
    try {
      const tickers = await getJson('https://www.okx.com/api/v5/market/tickers?instType=' + instType);
      tickerData = Array.isArray(tickers?.data) ? tickers.data : [];
    } catch {}
    const tm = new Map(tickerData.map(x => [String(x.instId), x]));
    for (const raw of items) {
      if (String(raw.state || '').toLowerCase() !== 'live') continue;
      const marketType = instType === 'SPOT' ? 'Spot' : instType === 'SWAP' ? 'Perpetuals' : instType === 'FUTURES' ? 'Futures' : 'Options';
      const item = cryptoItem('OKX', marketType, raw.instCategory === '3' ? 'Stocks' : raw.instCategory === '4' ? 'Metals' : raw.instCategory === '5' ? 'Commodities' : raw.instCategory === '6' ? 'Forex' : 'Crypto', raw, tm.get(raw.instId));
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
    const results = await Promise.allSettled([
      fetchDeriv().then(items => items.map(derivItem).filter(Boolean) as UnifiedInstrument[]),
      binance(),
      bitget(),
      bybit(),
      okx(),
    ]);
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
