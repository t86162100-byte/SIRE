export type MarketProvider = 'DERIV' | 'BINANCE' | 'BITGET' | 'BYBIT' | 'OKX' | 'KRAKEN' | 'COINBASE' | 'GATEIO' | 'KUCOIN' | 'GEMINI' | 'BITSO' | 'BITFINEX' | 'BITVAVO' | 'COINEX' | 'LBANK' | 'WOOX' | 'CRYPTOCOM' | 'HTX' | 'BITKUB' | 'UPBIT' | 'PIONEX' | 'POLONIEX' | 'BITHUMB' | 'MEXC' | 'PHEMEX' | 'WHITEBIT' | 'TWELVEDATA' | 'NASDAQTRADER' | 'NSE' | 'BITSTAMP' | 'OANDA' | 'TRADINGVIEW' | 'FOREXCOM' | 'INTERACTIVEBROKERS' | 'TRADESTATION' | 'WEBULL' | 'MOOMOO' | 'NINJATRADER' | 'TRADOVATE' | 'AMPFUTURES' | 'TASTYTRADE' | 'TASTYFX' | 'CRYPTOCOMEXCHANGE' | 'COINBASEADVANCED' | 'ALPACA' | 'TRADIERBROKERAGE' | 'TRADEZERO' | 'COBRATRADING' | 'CLEARSTREET' | 'INVESTRADE' | 'PUBLIC' | 'PLUS500US' | 'OPTIMUSFUTURES' | 'EDGECLEAR' | 'IRONBEAM' | 'STONEX' | 'DORMANTRADING' | 'TRADIERFUTURES';

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

async function withProviderTimeout<T>(provider: string, promise: Promise<T>, timeoutMs = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(provider + ' catalogue timed out after ' + timeoutMs + 'ms')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

async function coinbase(): Promise<UnifiedInstrument[]> {
  try {
    const response = await getJson('https://api.exchange.coinbase.com/products', 15000);
    const rows = Array.isArray(response) ? response : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      const id = String(raw?.id || '').trim();
      const status = String(raw?.status || '').toLowerCase();
      if (!id || (status && !['online', 'active'].includes(status))) continue;
      const [base, quote] = id.split('-');
      const item = cryptoItem('COINBASE', 'Spot', 'Crypto', {
        symbol: id,
        baseAsset: base,
        quoteAsset: quote,
        fullName: String(raw?.display_name || raw?.name || id),
        status: raw?.status || 'online'
      });
      if (item) out.push(item);
    }
    console.log('[SIRE COINBASE] Spot: ' + out.length);
    return out;
  } catch (error) {
    console.warn('[SIRE COINBASE] failed:', error);
    return [];
  }
}
async function gateio(): Promise<UnifiedInstrument[]> {
  try {
    const rows = await getJson('https://api.gateio.ws/api/v4/spot/currency_pairs', 15000);
    const out: UnifiedInstrument[] = [];
    for (const raw of Array.isArray(rows) ? rows : []) {
      if (String(raw?.trade_status || '').toLowerCase() !== 'tradable') continue;
      const item = cryptoItem('GATEIO', 'Spot', 'Crypto', {
        symbol: String(raw?.id || ''),
        baseAsset: String(raw?.base || ''),
        quoteAsset: String(raw?.quote || ''),
        fullName: String(raw?.base_name || raw?.id || ''),
        status: raw?.trade_status || 'tradable'
      });
      if (item) out.push(item);
    }
    console.log('[SIRE GATEIO] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE GATEIO] failed:', error); return []; }
}

async function kucoin(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://api.kucoin.com/api/v2/symbols', 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      if (raw?.enableTrading === false) continue;
      const item = cryptoItem('KUCOIN', 'Spot', 'Crypto', {
        symbol: String(raw?.symbol || ''),
        baseAsset: String(raw?.baseCurrency || ''),
        quoteAsset: String(raw?.quoteCurrency || ''),
        fullName: String(raw?.symbol || ''),
        status: raw?.enableTrading === false ? 'offline' : 'online'
      });
      if (item) out.push(item);
    }
    console.log('[SIRE KUCOIN] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE KUCOIN] failed:', error); return []; }
}

async function gemini(): Promise<UnifiedInstrument[]> {
  try {
    const rows = await getJson('https://api.gemini.com/v1/symbols', 15000);
    const out: UnifiedInstrument[] = [];
    for (const symbolRaw of Array.isArray(rows) ? rows : []) {
      const symbol = String(symbolRaw || '').trim().toUpperCase();
      if (!symbol) continue;
      const knownQuotes = ['USDT','USDC','GUSD','USD','EUR','GBP','SGD','BTC','ETH'];
      const quote = knownQuotes.find(q => symbol.endsWith(q));
      const base = quote ? symbol.slice(0, -quote.length) : undefined;
      const item = cryptoItem('GEMINI', 'Spot', 'Crypto', {
        symbol,
        baseAsset: base,
        quoteAsset: quote,
        fullName: symbol
      });
      if (item) out.push(item);
    }
    console.log('[SIRE GEMINI] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE GEMINI] failed:', error); return []; }
}

async function bitso(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://api.bitso.com/api/v3/available_books', 15000);
    const rows = Array.isArray(payload?.payload) ? payload.payload : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      const symbol = String(raw?.book || '').trim().toUpperCase();
      if (!symbol) continue;
      const parts = symbol.split('_');
      const item = cryptoItem('BITSO', 'Spot', 'Crypto', {
        symbol,
        baseAsset: parts[0] || '',
        quoteAsset: parts[1] || '',
        fullName: symbol
      });
      if (item) out.push(item);
    }
    console.log('[SIRE BITSO] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE BITSO] failed:', error); return []; }
}

async function bitfinex(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://api-pub.bitfinex.com/v2/conf/pub:list:pair:exchange', 15000);
    const rows = Array.isArray(payload) ? payload : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      const symbol = String(raw || '').trim().toUpperCase();
      if (!symbol) continue;
      const item = cryptoItem('BITFINEX', 'Spot', 'Crypto', { symbol, fullName: symbol });
      if (item) out.push(item);
    }
    console.log('[SIRE BITFINEX] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE BITFINEX] failed:', error); return []; }
}

async function bitvavo(): Promise<UnifiedInstrument[]> {
  try {
    const rows = await getJson('https://api.bitvavo.com/v2/markets', 15000);
    const out: UnifiedInstrument[] = [];
    for (const raw of Array.isArray(rows) ? rows : []) {
      if (String(raw?.status || '').toLowerCase() !== 'trading') continue;
      const item = cryptoItem('BITVAVO', 'Spot', 'Crypto', {
        symbol: String(raw?.market || ''),
        baseAsset: String(raw?.base || ''),
        quoteAsset: String(raw?.quote || ''),
        fullName: String(raw?.market || ''),
        status: raw?.status || 'trading'
      });
      if (item) out.push(item);
    }
    console.log('[SIRE BITVAVO] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE BITVAVO] failed:', error); return []; }
}

async function coinex(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://api.coinex.com/v2/spot/market', 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      const item = cryptoItem('COINEX', 'Spot', 'Crypto', {
        symbol: String(raw?.market || ''),
        baseAsset: String(raw?.base_ccy || ''),
        quoteAsset: String(raw?.quote_ccy || ''),
        fullName: String(raw?.market || ''),
        status: raw?.status || 'online'
      });
      if (item) out.push(item);
    }
    console.log('[SIRE COINEX] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE COINEX] failed:', error); return []; }
}

async function lbank(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://api.lbank.info/v2/currencyPairs.do', 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      const symbol = String(raw || '').trim().toUpperCase();
      const parts = symbol.split('_');
      const item = cryptoItem('LBANK', 'Spot', 'Crypto', {
        symbol,
        baseAsset: parts[0] || '',
        quoteAsset: parts[1] || '',
        fullName: symbol
      });
      if (item) out.push(item);
    }
    console.log('[SIRE LBANK] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE LBANK] failed:', error); return []; }
}

async function woox(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://api-pub.woox.io/v1/public/info', 15000);
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      if (raw?.is_trading === 0) continue;
      const symbol = String(raw?.symbol || '').trim();
      const parts = symbol.split('_');
      const base = parts.length >= 3 ? parts[1] : '';
      const quote = parts.length >= 3 ? parts[2] : '';
      const marketType = String(parts[0] || 'SPOT');
      const item = cryptoItem('WOOX', marketType, 'Crypto', {
        symbol,
        baseAsset: base,
        quoteAsset: quote,
        fullName: symbol,
        status: raw?.is_trading ? 'online' : 'offline'
      });
      if (item) out.push(item);
    }
    console.log('[SIRE WOOX] Markets: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE WOOX] failed:', error); return []; }
}

async function cryptocom(): Promise<UnifiedInstrument[]> {
  try {
    const response = await fetch('https://api.crypto.com/exchange/v1/public/get-instruments', {
      method: 'GET', headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const payload = await response.json();
    const rows = Array.isArray(payload?.result?.data) ? payload.result.data : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      if (raw?.tradable === false) continue;
      const item = cryptoItem('CRYPTOCOM', String(raw?.inst_type || 'Market'), 'Crypto', {
        symbol: String(raw?.symbol || ''),
        baseAsset: String(raw?.base_ccy || ''),
        quoteAsset: String(raw?.quote_ccy || ''),
        fullName: String(raw?.display_name || raw?.symbol || ''),
        status: raw?.tradable === false ? 'offline' : 'online'
      });
      if (item) out.push(item);
    }
    console.log('[SIRE CRYPTOCOM] Instruments: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE CRYPTOCOM] failed:', error); return []; }
}

async function htx(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://api.huobi.pro/v1/common/symbols', 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      if (String(raw?.state || '').toLowerCase() !== 'online') continue;
      const item = cryptoItem('HTX', 'Spot', 'Crypto', {
        symbol: String(raw?.symbol || ''),
        baseAsset: String(raw?.['base-currency'] || ''),
        quoteAsset: String(raw?.['quote-currency'] || ''),
        fullName: String(raw?.symbol || ''),
        status: raw?.state || 'online'
      });
      if (item) out.push(item);
    }
    console.log('[SIRE HTX] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE HTX] failed:', error); return []; }
}

async function bitkub(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://api.bitkub.com/api/v3/market/symbols', 15000);
    const rows = Array.isArray(payload?.result) ? payload.result : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      if (String(raw?.status || '').toLowerCase() !== 'active') continue;
      const item = cryptoItem('BITKUB', 'Spot', 'Crypto', {
        symbol: String(raw?.symbol || ''),
        baseAsset: String(raw?.base_asset || ''),
        quoteAsset: String(raw?.quote_asset || ''),
        fullName: String(raw?.name || raw?.symbol || ''),
        status: raw?.status || 'active'
      });
      if (item) out.push(item);
    }
    console.log('[SIRE BITKUB] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE BITKUB] failed:', error); return []; }
}

async function upbit(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://sg-api.upbit.com/v1/market/all', 15000);
    const rows = Array.isArray(payload) ? payload : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      const symbol = String(raw?.market || '').trim();
      const parts = symbol.split('-');
      const item = cryptoItem('UPBIT', 'Spot', 'Crypto', {
        symbol,
        baseAsset: parts[1] || '',
        quoteAsset: parts[0] || '',
        fullName: String(raw?.english_name || symbol)
      });
      if (item) out.push(item);
    }
    console.log('[SIRE UPBIT] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE UPBIT] failed:', error); return []; }
}

async function pionex(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://api.pionex.com/api/v1/common/symbols', 15000);
    const rows = Array.isArray(payload?.data?.symbols) ? payload.data.symbols : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      if (raw?.enable === false) continue;
      const item = cryptoItem('PIONEX', String(raw?.type || 'SPOT'), 'Crypto', {
        symbol: String(raw?.symbol || ''),
        baseAsset: String(raw?.baseCurrency || ''),
        quoteAsset: String(raw?.quoteCurrency || ''),
        fullName: String(raw?.name || raw?.symbol || '')
      });
      if (item) out.push(item);
    }
    console.log('[SIRE PIONEX] Markets: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE PIONEX] failed:', error); return []; }
}

async function poloniex(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://api.poloniex.com/markets', 15000);
    const rows = Array.isArray(payload) ? payload : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      const symbol = String(raw?.symbol || raw?.id || '').trim().toUpperCase();
      if (!symbol) continue;
      const parts = symbol.split('_');
      const item = cryptoItem('POLONIEX', 'Spot', 'Crypto', {
        symbol,
        baseAsset: parts[0] || '',
        quoteAsset: parts[1] || '',
        fullName: symbol
      });
      if (item) out.push(item);
    }
    console.log('[SIRE POLONIEX] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE POLONIEX] failed:', error); return []; }
}

async function bithumb(): Promise<UnifiedInstrument[]> {
  try {
    const rows = await getJson('https://api.bithumb.com/v1/market/all?isDetails=false', 15000);
    const out: UnifiedInstrument[] = [];
    for (const raw of Array.isArray(rows) ? rows : []) {
      const symbol = String(raw?.market || '').trim();
      const parts = symbol.split('-');
      const item = cryptoItem('BITHUMB', 'Spot', 'Crypto', {
        symbol,
        baseAsset: parts[1] || '',
        quoteAsset: parts[0] || '',
        fullName: String(raw?.english_name || raw?.market || '')
      });
      if (item) out.push(item);
    }
    console.log('[SIRE BITHUMB] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE BITHUMB] failed:', error); return []; }
}

async function mexc(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://api.mexc.com/api/v3/exchangeInfo', 15000);
    const rows = Array.isArray(payload?.symbols) ? payload.symbols : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      if (String(raw?.status || '').toUpperCase() !== 'ENABLED') continue;
      const item = cryptoItem('MEXC', 'Spot', 'Crypto', {
        symbol: String(raw?.symbol || ''),
        baseAsset: String(raw?.baseAsset || ''),
        quoteAsset: String(raw?.quoteAsset || ''),
        fullName: String(raw?.symbol || ''),
        status: raw?.status || 'ENABLED'
      });
      if (item) out.push(item);
    }
    console.log('[SIRE MEXC] Spot: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE MEXC] failed:', error); return []; }
}

async function phemex(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://api.phemex.com/public/products', 15000);
    const rows = Array.isArray(payload?.result?.products) ? payload.result.products : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      const symbol = String(raw?.symbol || '').trim();
      if (!symbol) continue;
      const type = String(raw?.type || '').toLowerCase();
      const marketType = type === 'spot' ? 'Spot' : 'Perpetual';
      const item = cryptoItem('PHEMEX', marketType, 'Crypto', {
        symbol,
        baseAsset: String(raw?.baseCurrency || raw?.baseCcy || ''),
        quoteAsset: String(raw?.quoteCurrency || raw?.quoteCcy || ''),
        fullName: symbol,
        status: String(raw?.status || 'online')
      });
      if (item) out.push(item);
    }
    console.log('[SIRE PHEMEX] Markets: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE PHEMEX] failed:', error); return []; }
}

async function whitebit(): Promise<UnifiedInstrument[]> {
  try {
    const rows = await getJson('https://whitebit.com/api/v4/public/markets', 15000);
    const out: UnifiedInstrument[] = [];
    for (const raw of Array.isArray(rows) ? rows : []) {
      if (raw?.tradesEnabled === false) continue;
      const item = cryptoItem('WHITEBIT', String(raw?.type || 'spot'), 'Crypto', {
        symbol: String(raw?.name || ''),
        baseAsset: String(raw?.stock || ''),
        quoteAsset: String(raw?.money || ''),
        fullName: String(raw?.name || ''),
        status: raw?.tradesEnabled === false ? 'offline' : 'online'
      });
      if (item) out.push(item);
    }
    console.log('[SIRE WHITEBIT] Markets: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE WHITEBIT] failed:', error); return []; }
}



/**
 * TradingView is a licensed market-data aggregator, not a single public
 * symbol API. Its catalogue contains exchange/broker feeds spanning stocks,
 * funds/ETFs, futures, forex, crypto, indices, bonds, options and economics.
 *
 * Keep a first-class provider record for the feed registry, but do not invent
 * symbols or scrape TradingView. Individual feeds are populated only from
 * their real/public APIs or configured licensed credentials.
 */
async function tradingviewFeedRegistry(): Promise<UnifiedInstrument[]> {
  // TradingView aggregates hundreds of licensed exchange/broker feeds. SIRE does
  // not scrape TradingView or invent tickers: each registry URL must be an
  // authorized/public catalogue supplied by the operator.
  const urls = String(process.env.TRADINGVIEW_FEED_REGISTRY_URLS || process.env.TRADINGVIEW_FEED_REGISTRY_URL || '')
    .split(/[,\\n]/)
    .map(value => value.trim())
    .filter(Boolean);
  if (!urls.length) {
    console.warn('[SIRE TRADINGVIEW] No licensed/public feed registries configured; no synthetic symbols created.');
    return [];
  }

  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();
  for (const configured of urls) {
    try {
      const payload = await getJson(configured, 20000);
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.instruments)
          ? payload.instruments
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
      for (const raw of rows) {
        const symbol = String(raw?.symbol || raw?.ticker || raw?.displaySymbol || '').trim();
        if (!symbol) continue;
        const exchange = String(raw?.exchange || raw?.source || '').trim();
        const category = String(raw?.category || raw?.type || raw?.assetType || 'Other').trim();
        const marketType = String(raw?.marketType || exchange || 'Feed').trim();
        const key = exchange + ':' + marketType + ':' + symbol;
        if (seen.has(key)) continue;
        const item = cryptoItem('TRADINGVIEW', marketType, category, {
          symbol,
          baseAsset: raw?.base || raw?.baseAsset || raw?.currency_base,
          quoteAsset: raw?.quote || raw?.quoteAsset || raw?.currency_quote,
          fullName: raw?.name || raw?.description || raw?.fullName || symbol,
          status: raw?.status || raw?.state || 'online'
        });
        if (!item) continue;
        item.name = String(raw?.name || raw?.description || raw?.fullName || symbol);
        item.category = category;
        item.marketType = marketType;
        item.logoUrl = String(raw?.logoUrl || raw?.logo || providerLogo('TRADINGVIEW'));
        item.providerLogoUrl = providerLogo('TRADINGVIEW');
        seen.add(key);
        out.push(item);
      }
      console.log('[SIRE TRADINGVIEW] registry loaded: ' + configured + ' (' + rows.length + ')');
    } catch (error) {
      console.warn('[SIRE TRADINGVIEW] registry failed: ' + configured, error);
    }
  }
  console.log('[SIRE TRADINGVIEW] Authorized/public feed registries total: ' + out.length);
  return out;
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

async function kraken(): Promise<UnifiedInstrument[]> {
  const response = await getJsonAny([
    'https://api.kraken.com/0/public/AssetPairs'
  ]);
  if (Array.isArray(response?.error) && response.error.length) {
    throw new Error(response.error.join(', '));
  }
  const rows = response?.result && typeof response.result === 'object' ? Object.entries(response.result) : [];
  const out: UnifiedInstrument[] = [];
  for (const [pairKey, rawValue] of rows) {
    const raw: any = rawValue;
    const status = String(raw?.status || 'online').toLowerCase();
    if (status && !['online','trading'].includes(status)) continue;
    const symbol = String(raw?.wsname || raw?.altname || pairKey).trim();
    if (!symbol) continue;
    const base = String(raw?.base || '').replace(/^X|^Z/, '').trim() || undefined;
    const quote = String(raw?.quote || '').replace(/^X|^Z/, '').trim() || undefined;
    const item = cryptoItem('KRAKEN', 'Spot', 'Crypto', {
      symbol,
      baseAsset: base,
      quoteAsset: quote,
      status: 'online'
    });
    if (item) out.push(item);
  }
  console.log('[SIRE KRAKEN] Spot: ' + out.length);
  return out;
}

async function getJsonAuth(url: string, headers: Record<string, string>, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', ...headers } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function oanda(): Promise<UnifiedInstrument[]> {
  const token = String(process.env.OANDA_API_TOKEN || '').trim();
  const accountId = String(process.env.OANDA_ACCOUNT_ID || '').trim();

  // When OANDA credentials are configured, use the account-specific v3
  // instrument catalogue. This is the authoritative list for that account
  // and can vary by OANDA division/country.
  if (token && accountId) {
    const hosts = [
      'https://api-fxtrade.oanda.com',
      'https://api-fxpractice.oanda.com'
    ];
    let response: any;
    let last: unknown;
    for (const host of hosts) {
      try {
        response = await getJsonAuth(
          host + '/v3/accounts/' + encodeURIComponent(accountId) + '/instruments',
          { Authorization: 'Bearer ' + token },
          15000
        );
        break;
      } catch (error) { last = error; }
    }
    if (!response) throw last || new Error('OANDA instruments request failed');

    const rows = Array.isArray(response?.instruments) ? response.instruments : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      const symbol = String(raw?.name || '').trim();
      if (!symbol) continue;
      const type = String(raw?.type || '').toUpperCase();
      const category = type === 'CURRENCY' ? 'Forex' : type === 'METAL' ? 'Metals' : 'CFD';
      const marketType = type === 'CURRENCY' ? 'FX' : type === 'METAL' ? 'Metals' : 'CFD';
      const item = cryptoItem('OANDA', marketType, category, {
        symbol,
        fullName: String(raw?.displayName || symbol),
        status: 'tradeable'
      });
      if (item) {
        item.name = String(raw?.displayName || symbol);
        item.category = category;
        item.marketType = marketType;
        item.logoUrl = providerLogo('OANDA');
        item.providerLogoUrl = providerLogo('OANDA');
        out.push(item);
      }
    }
    console.log('[SIRE OANDA] Account catalogue: ' + out.length);
    return out;
  }

  // No credentials: build the public OANDA Forex catalogue from OANDA's
  // current public US margin-rate page. We do not manufacture pairs.
  const publicUrl = 'https://www.oanda.com/us-en/legal/margin-rates/';
  const currencyCode = /^[A-Z]{3}$/;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(publicUrl, {
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml' }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const html = await response.text();
      const pairs = Array.from(new Set(
        Array.from(html.matchAll(/\b([A-Z]{3})\s*\/\s*([A-Z]{3})\b/g))
          .map(match => match[1] + '/' + match[2])
          .filter(pair => {
            const [base, quote] = pair.split('/');
            return currencyCode.test(base) && currencyCode.test(quote) && base !== quote;
          })
      ));

      const out: UnifiedInstrument[] = pairs.map(symbol => {
        const [base, quote] = symbol.split('/');
        return {
          id: 'OANDA:FX:' + symbol.replace('/', '_'),
          provider: 'OANDA',
          providerLabel: 'OANDA',
          marketType: 'FX',
          category: 'Forex',
          symbol,
          displaySymbol: symbol,
          name: symbol,
          base,
          quote,
          exchangeOpen: 1,
          status: 'online',
          logoUrl: providerLogo('OANDA'),
          providerLogoUrl: providerLogo('OANDA')
        };
      });

      if (out.length >= 20) {
        console.log('[SIRE OANDA] Public Forex catalogue: ' + out.length);
        return out;
      }
      console.warn('[SIRE OANDA] Public page returned too few parsable pairs: ' + out.length);
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.warn('[SIRE OANDA] Public catalogue fetch failed:', error);
  }

  // Safety fallback: these are pairs explicitly published in OANDA's current
  // US forex margin table. This fallback is only used if the public page is
  // temporarily unavailable; it is not used to invent additional instruments.
  const fallbackPairs = [
    'SGD/JPY','EUR/GBP','USD/HUF','AUD/HKD','GBP/CHF','USD/THB','CAD/JPY',
    'SGD/CHF','AUD/CHF','AUD/USD','USD/CNH','EUR/HKD','EUR/NZD','GBP/HKD',
    'NZD/HKD','NZD/USD','EUR/CHF','CHF/ZAR','USD/PLN','GBP/AUD','EUR/ZAR',
    'AUD/JPY','EUR/PLN','EUR/HUF','EUR/TRY','USD/JPY','GBP/NZD','NZD/CAD',
    'AUD/CAD','USD/CAD','GBP/CAD','HKD/JPY','AUD/SGD','USD/HKD','GBP/JPY',
    'USD/TRY','USD/MXN','GBP/USD','EUR/CAD','NZD/CHF','USD/CZK','EUR/CZK',
    'GBP/PLN','USD/SEK','GBP/SGD','EUR/SGD','USD/NOK','EUR/JPY','USD/ZAR',
    'EUR/AUD','EUR/DKK','USD/DKK','USD/CHF','ZAR/JPY','EUR/USD','GBP/ZAR',
    'CAD/SGD','NZD/JPY','AUD/NZD','CHF/HKD','CHF/JPY','NZD/SGD','TRY/JPY',
    'CAD/CHF','EUR/NOK','EUR/SEK','USD/SGD'
  ];
  const out = fallbackPairs.map(symbol => {
    const [base, quote] = symbol.split('/');
    return {
      id: 'OANDA:FX:' + symbol.replace('/', '_'),
      provider: 'OANDA' as MarketProvider,
      providerLabel: 'OANDA',
      marketType: 'FX',
      category: 'Forex',
      symbol,
      displaySymbol: symbol,
      name: symbol,
      base,
      quote,
      exchangeOpen: 1,
      status: 'online',
      logoUrl: providerLogo('OANDA'),
      providerLogoUrl: providerLogo('OANDA')
    };
  });
  console.log('[SIRE OANDA] Public Forex fallback catalogue: ' + out.length);
  return out;
}


// TradingView's broker directory is a broker/execution integration directory,
// not a universal public symbol feed. These broker adapters therefore never
// manufacture symbols. A broker is populated only from its documented API
// when the required credentials are configured.
const BROKER_REQUIREMENTS: Record<string, string> = {
  FOREXCOM: 'FOREXCOM_API credentials',
  INTERACTIVEBROKERS: 'IBKR Client Portal API credentials/session',
  TRADESTATION: 'TRADESTATION API OAuth credentials',
  WEBULL: 'WEBULL OpenAPI credentials',
  MOOMOO: 'MOOMOO OpenAPI credentials',
  NINJATRADER: 'NINJATRADER Trader API credentials',
  TRADOVATE: 'TRADOVATE API credentials',
  AMPFUTURES: 'AMP/CQG or supported market-data credentials',
  TASTYTRADE: 'TASTYTRADE OAuth access token',
  TASTYFX: 'TASTYFX API credentials',
  CRYPTOCOMEXCHANGE: 'No API key for public exchange instrument discovery',
  COINBASEADVANCED: 'No API key for public exchange product discovery',
  ALPACA: 'ALPACA API key + secret',
  TRADIERBROKERAGE: 'TRADIER API token',
  TRADEZERO: 'TRADEZERO API key + secret',
  COBRATRADING: 'COBRA/partner market-data credentials',
  CLEARSTREET: 'CLEAR STREET OAuth access token',
  INVESTRADE: 'Broker/market-data credentials',
  PUBLIC: 'PUBLIC API credentials',
  PLUS500US: 'PLUS500US broker data access',
  OPTIMUSFUTURES: 'Optimus/CQG or supported market-data credentials',
  EDGECLEAR: 'EdgeClear/CQG or supported market-data credentials',
  IRONBEAM: 'Ironbeam/CQG or supported market-data credentials',
  STONEX: 'StoneX broker/API credentials',
  DORMANTRADING: 'Dorman/clearing market-data credentials',
  TRADIERFUTURES: 'Tradier Futures market-data credentials',
};

function brokerUnavailable(provider: MarketProvider): UnifiedInstrument[] {
  console.warn('[SIRE ' + provider + '] Exact broker instrument catalogue requires the broker API/data entitlement; no symbols guessed.');
  return [];
}

function remapBrokerItems(items: UnifiedInstrument[], provider: MarketProvider, label: string): UnifiedInstrument[] {
  return items.map(item => ({
    ...item,
    id: provider + ':' + item.marketType + ':' + item.symbol,
    provider,
    providerLabel: label,
    logoUrl: providerLogo(provider),
    providerLogoUrl: providerLogo(provider)
  }));
}

async function brokerCatalogue(provider: MarketProvider): Promise<UnifiedInstrument[]> {
  // Public exchange brokers whose instrument universe is itself the exchange
  // universe can be sourced without inventing broker-specific symbols.
  if (provider === 'CRYPTOCOMEXCHANGE') return remapBrokerItems(await cryptocom(), provider, 'Crypto.com Exchange');
  if (provider === 'COINBASEADVANCED') return remapBrokerItems(await coinbase(), provider, 'Coinbase Advanced');
  return brokerUnavailable(provider);
}

async function alpaca(): Promise<UnifiedInstrument[]> {
  const key = String(process.env.ALPACA_API_KEY || '').trim();
  const secret = String(process.env.ALPACA_API_SECRET || '').trim();
  if (!key || !secret) return brokerUnavailable('ALPACA');
  const out: UnifiedInstrument[] = [];
  for (const assetClass of ['us_equity', 'crypto']) {
    try {
      const payload = await getJsonAuth(
        'https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=' + assetClass,
        { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
        15000
      );
      for (const raw of Array.isArray(payload) ? payload : []) {
        const symbol = String(raw?.symbol || '').trim();
        if (!symbol) continue;
        const category = assetClass === 'crypto' ? 'Crypto' : raw?.class === 'us_option' ? 'Options' : raw?.attributes?.includes?.('has_options') ? 'Stocks' : 'Stocks';
        out.push({
          id: 'ALPACA:' + assetClass + ':' + symbol,
          provider: 'ALPACA',
          providerLabel: 'Alpaca',
          marketType: assetClass === 'crypto' ? 'Crypto' : 'US Equities',
          category,
          symbol,
          displaySymbol: symbol,
          name: String(raw?.name || symbol),
          base: String(raw?.base_currency || '') || undefined,
          quote: String(raw?.quote_currency || '') || undefined,
          status: String(raw?.status || 'active'),
          logoUrl: providerLogo('ALPACA'),
          providerLogoUrl: providerLogo('ALPACA')
        });
      }
    } catch (error) { console.warn('[SIRE ALPACA] ' + assetClass + ' failed:', error); }
  }
  console.log('[SIRE ALPACA] Total catalogue: ' + out.length);
  return out;
}

async function twelveData(): Promise<UnifiedInstrument[]> {
  const apiKey = String(process.env.TWELVE_DATA_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[SIRE TWELVEDATA] TWELVE_DATA_API_KEY not configured; skipping optional multi-asset catalogue.');
    return [];
  }

  // Twelve Data documents reference catalogues for equities, ETFs, funds,
  // mutual funds, FX, commodities, indices, bonds and cryptocurrencies.
  // Keep every returned instrument under TWELVEDATA; never merge it into
  // another provider or manufacture symbols locally.
  const sources: Array<{
    endpoint: string;
    category: string;
    marketType: string;
    rows: (payload: any) => any[];
  }> = [
    { endpoint: '/stocks', category: 'Stocks', marketType: 'Equities', rows: p => Array.isArray(p?.data) ? p.data : [] },
    { endpoint: '/etfs', category: 'Funds', marketType: 'ETF', rows: p => Array.isArray(p?.data) ? p.data : [] },
    { endpoint: '/funds', category: 'Funds', marketType: 'Funds', rows: p => Array.isArray(p?.data) ? p.data : [] },
    { endpoint: '/mutual_funds/list', category: 'Funds', marketType: 'Mutual Funds', rows: p => Array.isArray(p?.data) ? p.data : [] },
    { endpoint: '/forex_pairs', category: 'Forex', marketType: 'Spot FX', rows: p => Array.isArray(p?.data) ? p.data : [] },
    { endpoint: '/commodities', category: 'Commodities', marketType: 'Commodities', rows: p => Array.isArray(p?.data) ? p.data : [] },
    { endpoint: '/indices', category: 'Indices', marketType: 'Indices', rows: p => Array.isArray(p?.data) ? p.data : [] },
    { endpoint: '/bonds', category: 'Bonds', marketType: 'Bonds', rows: p => Array.isArray(p?.data) ? p.data : [] },
    { endpoint: '/cryptocurrencies', category: 'Crypto', marketType: 'Aggregated Crypto', rows: p => Array.isArray(p?.data) ? p.data : [] },
  ];

  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    try {
      const allRows: any[] = [];
      for (let page = 1; page <= 200; page++) {
        const response = await getJson(
          'https://api.twelvedata.com' + source.endpoint +
          '?apikey=' + encodeURIComponent(apiKey) + '&page=' + page,
          15000
        );
        if (String(response?.status || '').toLowerCase() === 'error') {
          throw new Error(String(response?.message || 'Twelve Data API error'));
        }
        const pageRows = source.rows(response);
        allRows.push(...pageRows);
        if (pageRows.length === 0 || pageRows.length < 5000) break;
      }

      for (const raw of allRows) {
        const symbol = String(raw?.symbol || raw?.ticker || '').trim();
        if (!symbol) continue;

        const exchange = String(raw?.exchange || raw?.mic_code || '').trim();
        const country = String(raw?.country || '').trim();
        const key = source.category + ':' + (exchange || country) + ':' + symbol;
        if (seen.has(key)) continue;
        seen.add(key);

        const item = cryptoItem('TWELVEDATA', source.marketType, source.category, {
          symbol,
          baseAsset: raw?.currency_base || raw?.base_currency || raw?.base,
          quoteAsset: raw?.currency_quote || raw?.quote_currency || raw?.quote,
          fullName: raw?.name || raw?.description || symbol,
          status: raw?.status || 'online'
        });
        if (!item) continue;

        item.name = String(raw?.name || raw?.description || symbol);
        item.category = source.category;
        item.marketType = exchange || source.marketType;
        item.logoUrl = providerLogo('TWELVEDATA');
        item.providerLogoUrl = providerLogo('TWELVEDATA');
        out.push(item);
      }

      console.log('[SIRE TWELVEDATA] ' + source.endpoint + ': ' + allRows.length);
    } catch (error) {
      console.warn('[SIRE TWELVEDATA] ' + source.endpoint + ' failed:', error);
    }
  }

  console.log('[SIRE TWELVEDATA] Total multi-asset catalogue: ' + out.length);
  return out;
}

async function bitstamp(): Promise<UnifiedInstrument[]> {
  try {
    const payload = await getJson('https://www.bitstamp.net/api/v2/markets/', 15000);
    const rows = Array.isArray(payload) ? payload : [];
    const out: UnifiedInstrument[] = [];
    for (const raw of rows) {
      const symbol = String(raw?.market_symbol || raw?.name || '').trim().toUpperCase();
      if (!symbol) continue;
      const base = String(raw?.base_currency || '').trim().toUpperCase() || undefined;
      const quote = String(raw?.quote_currency || '').trim().toUpperCase() || undefined;
      const status = String(raw?.market_type || raw?.trading || 'online');
      const item = cryptoItem('BITSTAMP', 'Spot', 'Crypto', {
        symbol,
        baseAsset: base,
        quoteAsset: quote,
        fullName: String(raw?.name || symbol),
        status
      });
      if (item) out.push(item);
    }
    console.log('[SIRE BITSTAMP] Spot: ' + out.length);
    return out;
  } catch (error) {
    console.warn('[SIRE BITSTAMP] failed:', error);
    return [];
  }
}

async function nseIndia(): Promise<UnifiedInstrument[]> {
  const sources = [
    { url: 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv', category: 'Stocks', marketType: 'NSE Equity' },
    { url: 'https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv', category: 'Stocks', marketType: 'NSE SME' },
    { url: 'https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv', category: 'Funds', marketType: 'NSE ETF' },
    { url: 'https://nsearchives.nseindia.com/content/equities/DEBT.csv', category: 'Bonds', marketType: 'NSE Debt' },
  ];
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'text/csv,text/plain,*/*', 'User-Agent': 'SIRE-market-catalog/1.0' }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const text = await response.text();
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (!lines.length) continue;
      const delimiter = lines[0].includes('|') ? '|' : ',';
      const headers = lines[0].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
      for (const line of lines.slice(1)) {
        const values = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
        const raw: Record<string,string> = {};
        headers.forEach((header, index) => { raw[header] = values[index] ?? ''; });
        const symbol = String(raw['SYMBOL'] || raw['Symbol'] || raw['Security Symbol'] || raw['SYMBOL_NAME'] || raw['Scrip Code'] || '').trim();
        const name = String(raw['NAME OF COMPANY'] || raw['NAME'] || raw['Company Name'] || raw['Security Name'] || raw['DESCRIPTION'] || symbol).trim();
        if (!symbol || !name) continue;
        const key = source.marketType + ':' + symbol;
        if (seen.has(key)) continue;
        seen.add(key);
        const item = cryptoItem('NSE', source.marketType, source.category, {
          symbol,
          fullName: name,
          status: 'online'
        });
        if (!item) continue;
        item.name = name;
        item.category = source.category;
        item.marketType = source.marketType;
        item.logoUrl = providerLogo('NSE');
        item.providerLogoUrl = providerLogo('NSE');
        out.push(item);
      }
      console.log('[SIRE NSE] ' + source.marketType + ': ' + (lines.length - 1));
    } catch (error) {
      console.warn('[SIRE NSE] ' + source.marketType + ' failed:', error);
    }
  }
  console.log('[SIRE NSE] Total catalogue: ' + out.length);
  return out;
}

async function nasdaqTrader(): Promise<UnifiedInstrument[]> {
  const sources = [
    { file: 'nasdaqlisted.txt', category: 'Stocks', marketType: 'NASDAQ' },
    { file: 'otherlisted.txt', category: 'Stocks', marketType: 'US Other Exchanges' },
    { file: 'bondslist.txt', category: 'Bonds', marketType: 'US Bonds' },
    { file: 'options.txt', category: 'Options', marketType: 'US Options' },
    { file: 'mfundslist.txt', category: 'Funds', marketType: 'US Mutual Funds' },
  ];

  const parseSource = async (source: typeof sources[number]): Promise<UnifiedInstrument[]> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch('https://www.nasdaqtrader.com/dynamic/SymDir/' + source.file, {
        signal: controller.signal,
        headers: { Accept: 'text/plain,text/csv,*/*' }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const text = await response.text();
      const rows = text.split(/\r?\n/).filter(Boolean);
      if (!rows.length) return [];
      const headers = rows[0].split('|').map(v => v.trim());
      const out: UnifiedInstrument[] = [];
      const seen = new Set<string>();

      for (const line of rows.slice(1)) {
        if (!line || line.startsWith('File Creation Time')) continue;
        const values = line.split('|');
        const raw: Record<string,string> = {};
        headers.forEach((header, index) => { raw[header] = String(values[index] ?? '').trim(); });
        const symbol = String(raw['Symbol'] || raw['ACT Symbol'] || raw['Option Symbol'] || raw['Underlying'] || '').trim();
        const name = String(raw['Security Name'] || raw['Company Name'] || raw['Underlying Security Name'] || symbol).trim();
        if (!symbol || !name) continue;

        let category = source.category;
        if (source.file === 'nasdaqlisted.txt' || source.file === 'otherlisted.txt') {
          const isEtf = String(raw['ETF'] || '').toUpperCase() === 'Y' || /\bETF\b|EXCHANGE[- ]TRADED FUND/i.test(name);
          category = isEtf ? 'Funds' : 'Stocks';
        }

        const exchange = String(raw['Exchange'] || raw['Market Category'] || source.marketType).trim();
        const key = 'NASDAQTRADER:' + source.file + ':' + exchange + ':' + symbol;
        if (seen.has(key)) continue;
        seen.add(key);

        const item = cryptoItem('NASDAQTRADER', source.marketType, category, { symbol, fullName: name, status: 'online' });
        if (!item) continue;
        item.name = name;
        item.category = category;
        item.marketType = exchange || source.marketType;
        item.logoUrl = providerLogo('NASDAQTRADER');
        item.providerLogoUrl = providerLogo('NASDAQTRADER');
        out.push(item);
      }

      console.log('[SIRE NASDAQTRADER] ' + source.file + ': ' + rows.length);
      return out;
    } finally {
      clearTimeout(timer);
    }
  };

  const results = await Promise.allSettled(sources.map(parseSource));
  const out = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn('[SIRE NASDAQTRADER] ' + sources[index].file + ' failed:', result.reason);
    return [];
  });

  console.log('[SIRE NASDAQTRADER] Total catalogue: ' + out.length);
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
    category: (() => { const m = String(raw?.market || raw?.market_display_name || '').toLowerCase(); if (m.includes('forex') || m.includes('currency')) return 'Forex'; if (m.includes('commod')) return 'Commodities'; if (m.includes('stock') || m.includes('equities')) return 'Stocks'; if (m.includes('index') || m.includes('indices')) return 'Indices'; if (m.includes('crypto')) return 'Crypto'; if (m.includes('synthetic')) return 'Synthetic Indices'; if (m.includes('basket')) return 'Baskets'; return String(raw?.market_display_name || raw?.market || 'Deriv'); })(),
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
      ['TRADINGVIEW', tradingviewFeedRegistry()],
      ['BINANCE', binance()],
      ['GATEIO', gateio()],
      ['KUCOIN', kucoin()],
      ['GEMINI', gemini()],
      ['BITSO', bitso()],
      ['BITFINEX', bitfinex()],
      ['BITVAVO', bitvavo()],
      ['COINEX', coinex()],
      ['LBANK', lbank()],
      ['WOOX', woox()],
      ['CRYPTOCOM', cryptocom()],
      ['HTX', htx()],
      ['BITKUB', bitkub()],
      ['UPBIT', upbit()],
      ['PIONEX', pionex()],
      ['POLONIEX', poloniex()],
      ['BITHUMB', bithumb()],
      ['MEXC', mexc()],
      ['PHEMEX', phemex()],
      ['WHITEBIT', whitebit()],
      ['COINBASE', coinbase()],
      ['BITGET', bitget()],
      ['BYBIT', bybit()],
      ['OKX', okx()],
      ['KRAKEN', kraken()],
      ['TWELVEDATA', twelveData()],
      ['NASDAQTRADER', nasdaqTrader()],
      ['NSE', nseIndia()],
      ['BITSTAMP', bitstamp()],
      ['FOREXCOM', brokerCatalogue('FOREXCOM')],
      ['INTERACTIVEBROKERS', brokerCatalogue('INTERACTIVEBROKERS')],
      ['TRADESTATION', brokerCatalogue('TRADESTATION')],
      ['WEBULL', brokerCatalogue('WEBULL')],
      ['MOOMOO', brokerCatalogue('MOOMOO')],
      ['NINJATRADER', brokerCatalogue('NINJATRADER')],
      ['TRADOVATE', brokerCatalogue('TRADOVATE')],
      ['AMPFUTURES', brokerCatalogue('AMPFUTURES')],
      ['TASTYTRADE', brokerCatalogue('TASTYTRADE')],
      ['TASTYFX', brokerCatalogue('TASTYFX')],
      ['CRYPTOCOMEXCHANGE', brokerCatalogue('CRYPTOCOMEXCHANGE')],
      ['COINBASEADVANCED', brokerCatalogue('COINBASEADVANCED')],
      ['ALPACA', alpaca()],
      ['TRADIERBROKERAGE', brokerCatalogue('TRADIERBROKERAGE')],
      ['TRADEZERO', brokerCatalogue('TRADEZERO')],
      ['COBRATRADING', brokerCatalogue('COBRATRADING')],
      ['CLEARSTREET', brokerCatalogue('CLEARSTREET')],
      ['INVESTRADE', brokerCatalogue('INVESTRADE')],
      ['PUBLIC', brokerCatalogue('PUBLIC')],
      ['PLUS500US', brokerCatalogue('PLUS500US')],
      ['OPTIMUSFUTURES', brokerCatalogue('OPTIMUSFUTURES')],
      ['EDGECLEAR', brokerCatalogue('EDGECLEAR')],
      ['IRONBEAM', brokerCatalogue('IRONBEAM')],
      ['STONEX', brokerCatalogue('STONEX')],
      ['DORMANTRADING', brokerCatalogue('DORMANTRADING')],
      ['TRADIERFUTURES', brokerCatalogue('TRADIERFUTURES')],
      ['OANDA', oanda()],
    ];
    const results = await Promise.allSettled(
      providers.map(([provider, promise]) => withProviderTimeout(provider, promise, provider === 'DERIV' || provider === 'NASDAQTRADER' ? 8000 : 7000))
    );
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
