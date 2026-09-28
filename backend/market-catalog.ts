export type MarketProvider = 'BITRUE' | 'ASCENDEX' | 'COINW' | 'BINGX' | 'BINANCE' | 'FXCM' | 'YFINANCE' | 'SP' | 'DERIV' | 'BITGET' | 'BYBIT' | 'OKX' | 'KRAKEN' | 'COINBASE' | 'GATEIO' | 'KUCOIN' | 'GEMINI' | 'BITSO' | 'BITFINEX' | 'BITVAVO' | 'COINEX' | 'LBANK' | 'WOOX' | 'CRYPTOCOM' | 'HTX' | 'BITKUB' | 'UPBIT' | 'PIONEX' | 'POLONIEX' | 'BITHUMB' | 'MEXC' | 'PHEMEX' | 'WHITEBIT' | 'TWELVEDATA' | 'NASDAQTRADER' | 'CME' | 'CBOT' | 'NYMEX' | 'COMEX' | 'NYSEAMERICAN' | 'XETR' | 'HKEX' | 'BSE' | 'TSE' | 'XFRA' | 'EUREX' | 'ASX' | 'TWSE' | 'PSX' | 'IDX' | 'NSE' | 'BITSTAMP' | 'OANDA' | 'TRADINGVIEW' | 'FOREXCOM' | 'INTERACTIVEBROKERS' | 'TRADESTATION' | 'WEBULL' | 'MOOMOO' | 'NINJATRADER' | 'TRADOVATE' | 'AMPFUTURES' | 'TASTYTRADE' | 'TASTYFX' | 'CRYPTOCOMEXCHANGE' | 'COINBASEADVANCED' | 'ALPACA' | 'TRADIERBROKERAGE' | 'TRADEZERO' | 'COBRATRADING' | 'CLEARSTREET' | 'INVESTRADE' | 'PUBLIC' | 'PLUS500US' | 'OPTIMUSFUTURES' | 'EDGECLEAR' | 'IRONBEAM' | 'STONEX' | 'DORMANTRADING' | 'TRADIERFUTURES' | 'BITTREX' | 'BITMART' | 'BLANK';

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
  instrumentType?: string;
  contractType?: string;
  settlement?: string;
  expiry?: string | number;
  strike?: number;
  optionType?: string;
  supportsMargin?: boolean;
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const CACHE_MS = 5 * 60 * 1000;
let cached: { at: number; instruments: UnifiedInstrument[] } | null = null;
let loading: Promise<UnifiedInstrument[]> | null = null;

const providerLogo = (name: string) => {
  const value = String(name || '').trim().toLowerCase();
  if (value === 'deriv') return 'https://deriv.com/favicon.ico';
  if (value === 'nasdaq' || value === 'nasdaqtrader') return 'https://cdn.simpleicons.org/nasdaq';
  return 'https://cdn.simpleicons.org/' + value;
};
const assetLogo = (base?: string) => {
  const value = String(base || '').trim().toLowerCase();
  // Primary source: stable PNG crypto icon set. Keep the older SVG set as the
  // browser-side fallback when a symbol is missing from the primary set.
  return value ? 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + encodeURIComponent(value) + '.png' : '';
};


async function getText(url: string, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/csv,text/plain,*/*', 'User-Agent': 'SIRE-market-catalog/1.0' }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

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
    providerLabel: provider === 'NASDAQTRADER' ? 'Nasdaq' : provider[0] + provider.slice(1).toLowerCase(),
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
    instrumentType: marketType,
    contractType: raw?.contractType || raw?.contract_type || raw?.type || undefined,
    settlement: raw?.settleCoin || raw?.settleCcy || raw?.settleCurrency || raw?.settle_currency || undefined,
    expiry: raw?.deliveryTime || raw?.delivery_time || raw?.expireDate || raw?.expirationTime || raw?.expiration_time || undefined,
    strike: Number.isFinite(Number(raw?.strikePrice ?? raw?.strike_price ?? raw?.strike)) ? Number(raw?.strikePrice ?? raw?.strike_price ?? raw?.strike) : undefined,
    optionType: raw?.optionsType || raw?.optionType || (raw?.is_call === true ? 'Call' : raw?.is_call === false ? 'Put' : undefined),
    supportsMargin: Boolean(raw?.isMarginEnabled || raw?.marginEnabled || raw?.margin),
  };
}

async function coinbase(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

  const add = (raw: any, marketType: string, category: string, idOverride?: string) => {
    const productId = String(idOverride || raw?.product_id || raw?.id || '').trim();
    if (!productId || seen.has(productId)) return;
    const base = String(raw?.base_currency_id || raw?.baseAsset || raw?.base_currency || '').trim();
    const quote = String(raw?.quote_currency_id || raw?.quoteAsset || raw?.quote_currency || '').trim();
    const item = cryptoItem('COINBASE', marketType, category, {
      ...raw,
      symbol: productId,
      baseAsset: base,
      quoteAsset: quote,
      fullName: raw?.display_name || raw?.name || productId,
      status: raw?.status || raw?.state || 'online',
      type: marketType,
      contractType: raw?.future_product_details?.contract_expiry_type || raw?.contractType || undefined,
      settleCoin: raw?.future_product_details?.contract_root_unit || raw?.settle_currency || undefined,
      deliveryTime: raw?.future_product_details?.contract_expiry || undefined,
    });
    if (!item) return;
    item.id = 'COINBASE:' + marketType + ':' + productId;
    item.providerLabel = 'Coinbase';
    item.marketType = marketType;
    item.category = category;
    item.instrumentType = marketType;
    seen.add(productId);
    out.push(item);
  };

  // Coinbase Exchange's public products endpoint supplies the full spot product
  // universe. Do not discard non-online rows: they are still Coinbase products
  // and the Quote catalogue must not silently lose them.
  try {
    const response = await getJson('https://api.exchange.coinbase.com/products', 15000);
    const rows = Array.isArray(response) ? response : [];
    for (const raw of rows) add(raw, 'Spot', 'Crypto', raw?.id);
    console.log('[SIRE COINBASE] Exchange products: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE COINBASE] Exchange products failed:', error);
  }

  // Coinbase Advanced public product catalogue includes derivative products.
  // Walk every cursor page and also issue explicit product-type queries so a
  // filtered endpoint response can never hide a product from the unified list.
  const advancedQueries: Array<Record<string, string>> = [
    {},
    { product_type: 'SPOT' },
    { product_type: 'FUTURE' },
    { product_type: 'FUTURE', contract_expiry_type: 'PERPETUAL' },
  ];

  const fetchAdvanced = async (params: Record<string, string>) => {
    const rows: any[] = [];
    let cursor = '';
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ limit: '1000', ...params });
      if (cursor) query.set('cursor', cursor);
      const response = await getJson(
        'https://api.coinbase.com/api/v3/brokerage/market/products?' + query.toString(),
        20000,
      );
      const pageRows = Array.isArray(response?.products) ? response.products : [];
      rows.push(...pageRows);
      const next = String(response?.pagination?.next_cursor || '').trim();
      if (!next || next === cursor) break;
      cursor = next;
    }
    return rows;
  };

  for (const params of advancedQueries) {
    try {
      const rows = await fetchAdvanced(params);
      for (const raw of rows) {
        const productType = String(raw?.product_type || '').toUpperCase();
        const expiryType = String(raw?.future_product_details?.contract_expiry_type || '').toUpperCase();
        const display = String(
          (raw?.display_name || '') + ' ' +
          (raw?.product_id || '') + ' ' +
          (raw?.future_product_details?.contract_display_name || '')
        ).toLowerCase();

        let marketType = 'Other';
        let category = 'Crypto';
        if (productType === 'SPOT') marketType = 'Spot';
        else if (productType === 'FUTURE' && expiryType === 'PERPETUAL') marketType = 'Perpetual Futures';
        else if (productType === 'FUTURE' || expiryType === 'EXPIRING') marketType = 'Futures';
        else if (display.includes('perpetual') || /(^|[-_])perp([-_]|$)/i.test(display)) marketType = 'Perpetual Futures';

        add(raw, marketType, category, raw?.product_id);
      }
      console.log('[SIRE COINBASE] Advanced products', JSON.stringify({ params, count: rows.length }));
    } catch (error) {
      console.warn('[SIRE COINBASE] Advanced query failed:', params, error);
    }
  }

  console.log('[SIRE COINBASE] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(item => item.marketType === 'Spot').length,
    perpetuals: out.filter(item => item.marketType === 'Perpetual Futures').length,
    futures: out.filter(item => item.marketType === 'Futures').length,
    other: out.filter(item => item.marketType === 'Other').length,
  }));

  return out;
}

async function binance(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];

  const loadSymbols = async (label: string, urls: string[], marketTypeForRow: (raw: any) => string) => {
    try {
      const response = await getJsonAny(urls, 12000);
      const rows = Array.isArray(response?.symbols) ? response.symbols : [];
      for (const raw of rows) {
        const status = String(raw?.status || raw?.contractStatus || '').toUpperCase();
        if (status && status !== 'TRADING') continue;
        const marketType = marketTypeForRow(raw);
        const item = cryptoItem('BINANCE', marketType, 'Crypto', raw);
        if (item) out.push(item);
      }
      console.log('[SIRE BINANCE] ' + label + ': ' + rows.length);
    } catch (error) {
      console.warn('[SIRE BINANCE] ' + label + ' failed:', error);
    }
  };

  await loadSymbols('Spot', [
    'https://data-api.binance.vision/api/v3/exchangeInfo?symbolStatus=TRADING',
    'https://api.binance.com/api/v3/exchangeInfo?symbolStatus=TRADING',
    'https://api1.binance.com/api/v3/exchangeInfo?symbolStatus=TRADING',
    'https://api2.binance.com/api/v3/exchangeInfo?symbolStatus=TRADING'
  ], () => 'Spot');

  // Margin availability is published on Spot exchangeInfo. We do not invent
  // Cross/Isolated distinctions when the public response does not expose them.
  try {
    const response = await getJsonAny([
      'https://data-api.binance.vision/api/v3/exchangeInfo?symbolStatus=TRADING',
      'https://api.binance.com/api/v3/exchangeInfo?symbolStatus=TRADING'
    ], 12000);
    const rows = Array.isArray(response?.symbols) ? response.symbols : [];
    for (const raw of rows.filter((item: any) => item?.isMarginTradingAllowed === true)) {
      const item = cryptoItem('BINANCE', 'Margin', 'Crypto', raw);
      if (item) out.push(item);
    }
    console.log('[SIRE BINANCE] Margin: ' + out.filter(item => item.marketType === 'Margin').length);
  } catch (error) {
    console.warn('[SIRE BINANCE] Margin failed:', error);
  }

  await loadSymbols('USD-M', ['https://fapi.binance.com/fapi/v1/exchangeInfo'], raw =>
    String(raw?.contractType || '').toUpperCase() === 'PERPETUAL' ? 'USD-M Perpetuals' : 'USD-M Futures'
  );

  await loadSymbols('COIN-M', ['https://dapi.binance.com/dapi/v1/exchangeInfo'], raw =>
    String(raw?.contractType || '').toUpperCase() === 'PERPETUAL' ? 'COIN-M Perpetuals' : 'COIN-M Futures'
  );

  try {
    const response = await getJsonAny(['https://eapi.binance.com/eapi/v1/exchangeInfo'], 12000);
    const rows = Array.isArray(response?.optionSymbols) ? response.optionSymbols : [];
    for (const raw of rows) {
      if (String(raw?.status || '').toUpperCase() !== 'TRADING') continue;
      const normalized = {
        ...raw,
        baseAsset: String(raw?.underlying || '').replace(/USDT$|USDC$|USD$/i, ''),
        quoteAsset: raw?.quoteAsset || 'USDT'
      };
      const item = cryptoItem('BINANCE', 'Options', 'Crypto', normalized);
      if (item) out.push(item);
    }
    console.log('[SIRE BINANCE] Options: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE BINANCE] Options failed:', error);
  }

  const seen = new Set<string>();
  return out.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function gateio(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();
  const add = (raw: any, marketType: string, symbol: string, base?: string, quote?: string, extra: any = {}) => {
    const normalized = { ...raw, symbol, baseAsset: base, quoteAsset: quote, status: raw?.trade_status || raw?.status || 'online', ...extra };
    const item = cryptoItem('GATEIO', marketType, 'Crypto', normalized);
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  };

  try {
    const rows = await getJson('https://api.gateio.ws/api/v4/spot/currency_pairs', 15000);
    for (const raw of Array.isArray(rows) ? rows : []) {
      add(raw, 'Spot', String(raw?.id || ''), raw?.base, raw?.quote);
    }
    console.log('[SIRE GATEIO] Spot: ' + out.filter(x => x.marketType === 'Spot').length);
  } catch (e) { console.warn('[SIRE GATEIO] Spot failed:', e); }

  for (const settle of ['usdt', 'usd1', 'btc']) {
    try {
      const rows = await getJson('https://api.gateio.ws/api/v4/futures/' + settle + '/contracts', 15000);
      for (const raw of Array.isArray(rows) ? rows : []) {
        const name = String(raw?.name || '');
        const underlying = String(raw?.underlying || name).split('_')[0];
        add(raw, 'Perpetuals', name, underlying, settle.toUpperCase(), {
          contractType: 'perpetual',
          settlement: settle.toUpperCase(),
          expiry: raw?.expire_time || raw?.expiry_time || undefined,
        });
      }
    } catch (e) { console.warn('[SIRE GATEIO] Perpetual/' + settle + ' failed:', e); }
  }

  for (const settle of ['usdt']) {
    try {
      const rows = await getJson('https://api.gateio.ws/api/v4/delivery/' + settle + '/contracts', 15000);
      for (const raw of Array.isArray(rows) ? rows : []) {
        const name = String(raw?.name || '');
        const underlying = String(raw?.underlying || name).split('_')[0];
        add(raw, 'Futures', name, underlying, settle.toUpperCase(), {
          contractType: 'delivery',
          settlement: settle.toUpperCase(),
          expiry: raw?.expire_time || raw?.expiry_time || undefined,
        });
      }
    } catch (e) { console.warn('[SIRE GATEIO] Delivery/' + settle + ' failed:', e); }
  }

  try {
    const underlyings = await getJson('https://api.gateio.ws/api/v4/options/underlyings', 15000);
    for (const u of Array.isArray(underlyings) ? underlyings : []) {
      const underlying = String(u?.name || '');
      if (!underlying) continue;
      try {
        const rows = await getJson('https://api.gateio.ws/api/v4/options/contracts?underlying=' + encodeURIComponent(underlying), 15000);
        for (const raw of Array.isArray(rows) ? rows : []) {
          const parts = underlying.split('_');
          add(raw, 'Options', String(raw?.name || ''), parts[0], parts[1] || 'USDT', {
            expiry: raw?.expiration_time || raw?.expire_time || undefined,
            strike: raw?.strike_price,
            optionType: raw?.put_call || raw?.option_type || undefined,
          });
        }
      } catch (e) { console.warn('[SIRE GATEIO] Options underlying failed:', underlying, e); }
    }
  } catch (e) { console.warn('[SIRE GATEIO] Options failed:', e); }

  console.log('[SIRE GATEIO] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(x => x.marketType === 'Spot').length,
    perpetuals: out.filter(x => x.marketType === 'Perpetuals').length,
    futures: out.filter(x => x.marketType === 'Futures').length,
    options: out.filter(x => x.marketType === 'Options').length,
  }));
  return out;
}
async function kucoin(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

  const add = (raw: any, marketType: string, category = 'Crypto', symbolOverride?: string) => {
    const symbol = String(symbolOverride || raw?.symbol || raw?.name || '').trim();
    if (!symbol) return;
    const item = cryptoItem('KUCOIN', marketType, category, {
      ...raw,
      symbol,
      baseAsset: raw?.baseCurrency || raw?.baseAsset,
      quoteAsset: raw?.quoteCurrency || raw?.quoteAsset,
      status: raw?.status || raw?.tradingStatus || (raw?.enableTrading === false ? 'offline' : 'online'),
      settleCoin: raw?.settleCurrency || raw?.settleCoin,
      deliveryTime: raw?.expireDate || undefined,
      contractType: raw?.expireDate ? 'delivery' : (raw?.type || 'perpetual'),
    });
    if (!item) return;
    const key = item.id;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  // KuCoin's public Spot symbol master is the source of truth for the complete
  // spot universe. Keep disabled/call-auction rows instead of silently losing
  // products from the Quote catalogue.
  try {
    const payload = await getJson('https://api.kucoin.com/api/v2/symbols', 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    for (const raw of rows) add(raw, 'Spot');
    console.log('[SIRE KUCOIN] Spot: ' + rows.length);
  } catch (e) {
    console.warn('[SIRE KUCOIN] Spot failed:', e);
  }

  // KuCoin exposes the actual margin trading universe separately through the
  // public mark-price list. This avoids guessing margin support from spot flags.
  try {
    const payload = await getJson('https://api.kucoin.com/api/v3/mark-price/all-symbols', 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    for (const raw of rows) {
      const symbol = String(raw?.symbol || '').trim();
      if (!symbol) continue;
      const parts = symbol.split('-');
      const knownQuotes = new Set(['USDT','USDC','USD','BTC','ETH','KCS','EUR','GBP','AUD','CAD','BRL','TRY']);
      const first = String(parts[0] || '').toUpperCase();
      const second = String(parts[1] || '').toUpperCase();
      const baseAsset = knownQuotes.has(first) && !knownQuotes.has(second) ? second : first;
      const quoteAsset = knownQuotes.has(first) && !knownQuotes.has(second) ? first : second;
      add({ ...raw, baseCurrency: baseAsset, quoteCurrency: quoteAsset, isMarginEnabled: true }, 'Margin', 'Crypto', symbol);
      const item = out.find(candidate => candidate.id === 'KUCOIN:Margin:' + symbol);
      if (item) item.supportsMargin = true;
    }
    console.log('[SIRE KUCOIN] Margin: ' + rows.length);
  } catch (e) {
    console.warn('[SIRE KUCOIN] Margin failed:', e);
  }

  // Futures has its own public contract master. expireDate distinguishes
  // delivery contracts from perpetual contracts; do not collapse them.
  try {
    const payload = await getJson('https://api-futures.kucoin.com/api/v1/contracts/active', 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    for (const raw of rows) {
      const expireDate = raw?.expireDate ?? raw?.settleDate;
      const marketType = expireDate ? 'Futures' : 'Perpetuals';
      add(raw, marketType, 'Crypto');
    }
    console.log('[SIRE KUCOIN] Futures contracts: ' + rows.length);
  } catch (e) {
    console.warn('[SIRE KUCOIN] Futures failed:', e);
  }

  console.log('[SIRE KUCOIN] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(x => x.marketType === 'Spot').length,
    margin: out.filter(x => x.marketType === 'Margin').length,
    perpetuals: out.filter(x => x.marketType === 'Perpetuals').length,
    futures: out.filter(x => x.marketType === 'Futures').length,
  }));
  return out;
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
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();
  const add = (raw: any, marketType: string, category = 'Crypto') => {
    const symbol = String(raw?.market || '').trim().toUpperCase();
    if (!symbol) return;
    const item = cryptoItem('COINEX', marketType, category, {
      ...raw,
      symbol,
      baseAsset: raw?.base_ccy,
      quoteAsset: raw?.quote_ccy,
      fullName: symbol,
      status: raw?.status || 'online',
      contractType: raw?.contract_type || undefined,
      settleCoin: raw?.quote_ccy || undefined,
    });
    if (!item || seen.has(item.id)) return;
    item.providerLabel = 'CoinEx';
    item.marketType = marketType;
    item.category = category;
    item.instrumentType = marketType;
    item.contractType = String(raw?.contract_type || '').trim() || item.contractType;
    seen.add(item.id);
    out.push(item);
  };

  try {
    const payload = await getJson('https://api.coinex.com/v2/spot/market', 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    for (const raw of rows) add(raw, 'Spot');
    // CoinEx exposes margin availability on the spot market master. Keep Margin
    // as its own instrument class rather than silently merging it into Spot.
    for (const raw of rows) if (raw?.is_margin_available === true) add(raw, 'Margin');
    console.log('[SIRE COINEX] Spot/Margin:', out.length);
  } catch (error) {
    console.warn('[SIRE COINEX] Spot/Margin failed:', error);
  }

  try {
    const payload = await getJson('https://api.coinex.com/v2/futures/market', 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    for (const raw of rows) add(raw, 'Perpetuals');
    console.log('[SIRE COINEX] Perpetuals:', out.filter(item => item.marketType === 'Perpetuals').length);
  } catch (error) {
    console.warn('[SIRE COINEX] Futures failed:', error);
  }

  console.log('[SIRE COINEX] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(x => x.marketType === 'Spot').length,
    margin: out.filter(x => x.marketType === 'Margin').length,
    perpetuals: out.filter(x => x.marketType === 'Perpetuals').length,
  }));
  return out;
}

async function bingx(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

  const add = (raw: any, marketType: string, category = 'Crypto') => {
    const symbol = String(raw?.symbol || raw?.symbolName || raw?.contractName || raw?.instId || raw?.name || '').trim().toUpperCase();
    if (!symbol) return;

    const key = marketType + ':' + symbol;
    if (seen.has(key)) return;

    const base = String(raw?.baseAsset || raw?.baseCoin || raw?.baseCurrency || raw?.base || '').trim().toUpperCase() || undefined;
    const quote = String(raw?.quoteAsset || raw?.quoteCoin || raw?.quoteCurrency || raw?.quote || '').trim().toUpperCase() || undefined;
    const settlement = String(raw?.currency || raw?.settleCoin || raw?.settleCurrency || raw?.marginAsset || '').trim().toUpperCase() || quote;
    const status = raw?.status ?? raw?.state ?? raw?.contractStatus ?? 'online';

    const item = cryptoItem('BINGX', marketType, category, {
      ...raw,
      symbol,
      baseAsset: base,
      quoteAsset: quote,
      fullName: raw?.symbolName || raw?.contractName || symbol,
      status,
      type: raw?.contractType || raw?.type || marketType,
      contractType: raw?.contractType || raw?.type || marketType,
      settleCoin: settlement,
      deliveryTime: raw?.deliveryDate || raw?.expiryTime || raw?.deliveryTime || raw?.expireTime,
    });
    if (!item) return;

    item.id = 'BINGX:' + marketType + ':' + symbol;
    item.providerLabel = 'BingX';
    item.marketType = marketType;
    item.category = category;
    item.instrumentType = marketType;
    item.contractType = String(raw?.contractType || raw?.type || marketType).trim();
    item.settlement = settlement;
    item.expiry = raw?.deliveryDate || raw?.expiryTime || raw?.deliveryTime || raw?.expireTime || undefined;
    seen.add(key);
    out.push(item);
  };

  // BingX Spot symbol master: this is the authoritative public Spot catalogue.
  try {
    const payload = await getJsonAny([
      'https://open-api.bingx.com/openApi/spot/v1/common/symbols',
      'https://open-api.bingx.pro/openApi/spot/v1/common/symbols',
      'https://api.bingx.com/openApi/spot/v1/common/symbols',
    ], 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    for (const raw of rows) add(raw, 'Spot');
    console.log('[SIRE BINGX] Spot', JSON.stringify({ published: rows.length, loaded: out.filter(x => x.marketType === 'Spot').length }));
  } catch (error) {
    console.warn('[SIRE BINGX] Spot failed:', error);
  }

  // BingX's documented swap contract endpoint returns USDT-M perpetual swap
  // specifications. Do not guess delivery futures from missing expiry fields:
  // every row from this endpoint is explicitly a perpetual contract.
  try {
    const payload = await getJsonAny([
      'https://open-api.bingx.com/openApi/swap/v2/quote/contracts',
      'https://open-api.bingx.pro/openApi/swap/v2/quote/contracts',
      'https://api.bingx.com/openApi/swap/v2/quote/contracts',
    ], 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    for (const raw of rows) add(raw, 'Perpetuals');
    console.log('[SIRE BINGX] USDT-M perpetuals', JSON.stringify({ published: rows.length, loaded: out.filter(x => x.marketType === 'Perpetuals').length }));
  } catch (error) {
    console.warn('[SIRE BINGX] USDT-M perpetuals failed:', error);
  }

  // BingX also exposes a separate Coin-M perpetual market API. Enumerate it
  // independently so Coin-M contracts are not lost inside the USDT-M catalogue.
  try {
    const payload = await getJsonAny([
      'https://open-api.bingx.com/openApi/cswap/v1/market/contracts',
      'https://open-api.bingx.pro/openApi/cswap/v1/market/contracts',
      'https://api.bingx.com/openApi/cswap/v1/market/contracts',
    ], 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    for (const raw of rows) add(raw, 'Perpetuals', 'Crypto');
    console.log('[SIRE BINGX] Coin-M perpetuals', JSON.stringify({ published: rows.length, loaded: out.filter(x => x.marketType === 'Perpetuals').length }));
  } catch (error) {
    console.warn('[SIRE BINGX] Coin-M perpetuals failed:', error);
  }

  // Standard Futures are a separate BingX product. BingX's public standard
  // contract documentation exposes authenticated trading/account operations,
  // but does not publish a public unauthenticated instrument-master endpoint.
  // Therefore SIRE deliberately does NOT fabricate a Standard Futures list.
  // This keeps the catalogue sourced only from authoritative live endpoints.

  const unique = out.filter((item, index, all) =>
    all.findIndex(other => other.id === item.id) === index
  );

  console.log('[SIRE BINGX] COMPLETE', JSON.stringify({
    total: unique.length,
    spot: unique.filter(x => x.marketType === 'Spot').length,
    perpetuals: unique.filter(x => x.marketType === 'Perpetuals').length,
    futures: unique.filter(x => x.marketType === 'Futures').length,
    options: unique.filter(x => x.marketType === 'Options').length,
    standardFutures: unique.filter(x => x.marketType === 'Standard Futures').length,
  }));

  return unique;
}

async function lbank(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

  const add = (raw: any, marketType: string, instrumentType: string, symbolOverride?: string) => {
    const symbol = String(symbolOverride || raw?.symbol || raw?.instId || raw?.name || '').trim().toUpperCase();
    if (!symbol) return;
    const key = marketType + ':' + symbol;
    if (seen.has(key)) return;

    const base = String(raw?.baseCurrency || raw?.baseAsset || raw?.baseCoin || '').trim().toUpperCase();
    const quote = String(raw?.priceCurrency || raw?.quoteCurrency || raw?.quoteAsset || raw?.quoteCoin || '').trim().toUpperCase();
    const item = cryptoItem('LBANK', marketType, 'Crypto', {
      ...raw,
      symbol,
      baseAsset: base,
      quoteAsset: quote,
      fullName: raw?.symbolName || raw?.displayName || symbol,
      status: raw?.status || raw?.state || 'online',
      type: instrumentType,
      contractType: raw?.contractType || raw?.contract_type || instrumentType,
      settleCoin: raw?.clearCurrency || raw?.settleCoin || raw?.settleCurrency || quote,
    });
    if (!item) return;

    item.id = 'LBANK:' + marketType + ':' + symbol;
    item.providerLabel = 'LBank';
    item.marketType = marketType;
    item.category = 'Crypto';
    item.instrumentType = instrumentType;
    item.contractType = String(raw?.contractType || raw?.contract_type || instrumentType);
    item.settlement = String(raw?.clearCurrency || raw?.settleCoin || raw?.settleCurrency || '').trim() || item.settlement;
    item.supportsMargin = marketType === 'Margin' || Boolean(raw?.marginAvailable || raw?.isMargin);
    seen.add(key);
    out.push(item);
  };

  // LBank's current public V2 API is authoritative for the complete spot pair universe.
  try {
    const payload = await getJsonAny([
      'https://api.lbank.info/v2/currencyPairs.do',
      'https://api.lbkex.com/v2/currencyPairs.do',
    ], 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    for (const raw of rows) {
      const symbol = String(raw || '').trim().toUpperCase();
      const parts = symbol.split('_');
      add({ symbol, baseCurrency: parts[0], priceCurrency: parts[1], symbolName: symbol }, 'Spot', 'SPOT', symbol);
    }
    console.log('[SIRE LBANK] Spot: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE LBANK] Spot failed:', error);
  }

  // LBank contract market data is public and exposes the current contract instrument master.
  try {
    const payload = await getJsonAny([
      'https://lbkperp.lbank.com/cfd/openApi/v1/pub/instrument?productGroup=SwapU',
      'https://lbkperp.lbank.com/cfd/openApi/v1/pub/instrument?productGroup=Swap',
    ], 15000);
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.result) ? payload.result : [];
    for (const raw of rows) add(raw, 'Perpetuals', 'SWAP', raw?.symbol || raw?.instId);
    console.log('[SIRE LBANK] Perpetuals: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE LBANK] Perpetuals failed:', error);
  }

  console.log('[SIRE LBANK] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(x => x.marketType === 'Spot').length,
    perpetuals: out.filter(x => x.marketType === 'Perpetuals').length,
    futures: out.filter(x => x.marketType === 'Futures').length,
    margin: out.filter(x => x.marketType === 'Margin').length,
  }));
  return out;
}

async function phemex(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

  const add = (raw: any, marketType: string) => {
    const symbol = String(raw?.symbol || raw?.symbolName || raw?.instId || raw?.name || '').trim().toUpperCase();
    if (!symbol || !marketType) return;
    const key = marketType + ':' + symbol;
    if (seen.has(key)) return;

    const base = String(raw?.baseCurrency || raw?.baseCcy || raw?.baseCoin || raw?.baseAsset || '').trim().toUpperCase();
    const quote = String(raw?.quoteCurrency || raw?.quoteCcy || raw?.quoteCoin || raw?.quoteAsset || '').trim().toUpperCase();
    const type = String(raw?.type || raw?.productType || raw?.instrumentType || raw?.contractType || '').trim();

    const item = cryptoItem('PHEMEX', marketType, 'Crypto', {
      ...raw,
      symbol,
      baseAsset: base,
      quoteAsset: quote,
      fullName: raw?.displayName || raw?.symbolName || symbol,
      status: raw?.status || raw?.state || 'online',
      type,
      contractType: raw?.contractType || raw?.type || raw?.productType,
      settleCoin: raw?.settleCurrency || raw?.settleCcy || raw?.settleCoin || raw?.quoteCurrency,
      deliveryTime: raw?.expiryTime || raw?.endTimestamp || raw?.deliveryTime || raw?.deliveryTimeNs,
    });
    if (!item) return;

    item.id = 'PHEMEX:' + marketType + ':' + symbol;
    item.providerLabel = 'Phemex';
    item.marketType = marketType;
    item.category = 'Crypto';
    item.instrumentType = type || marketType;
    item.contractType = String(raw?.contractType || raw?.type || raw?.productType || '').trim() || item.contractType;
    item.settlement = String(raw?.settleCurrency || raw?.settleCcy || raw?.settleCoin || '').trim() || item.settlement;
    item.expiry = raw?.expiryTime || raw?.endTimestamp || raw?.deliveryTime || item.expiry;
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  };

  const classify = (raw: any, familyHint = ''): string => {
    const text = [
      raw?.type, raw?.productType, raw?.instrumentType, raw?.contractType,
      raw?.symbolType, raw?.contractStatus, familyHint, raw?.symbol
    ].map(v => String(v || '').toLowerCase()).join(' ');
    if (text.includes('option')) return 'Options';
    if (text.includes('spot')) return 'Spot';
    if (text.includes('perpetual') || text.includes('perp') || text.includes('swap')) return 'Perpetuals';
    if (text.includes('future') || text.includes('delivery') || raw?.expiryTime || raw?.deliveryTime) return 'Futures';
    return '';
  };

  const walk = (value: any, familyHint = '') => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const row of value) walk(row, familyHint);
      return;
    }
    if (typeof value !== 'object') return;

    // Phemex uses several product-family arrays whose names are more reliable
    // than the individual row type when the API omits type metadata.
    const keys = ['spotProducts','spotProductsV2','perpProducts','perpProductsV2','products','futureProducts','futuresProducts','optionProducts','optionsProducts'];
    const handled = new Set<string>();

    // Phemex responses commonly wrap the product-family arrays under data/result
    // before reaching the named family keys. Descend through those wrappers so
    // the standalone provider does not report zero merely because the payload is
    // nested one or more levels deep.
    for (const key of keys) {
      if (value[key] !== undefined) {
        handled.add(key);
        walk(value[key], key);
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (handled.has(key)) continue;
      if (child && typeof child === 'object') {
        walk(child, familyHint || key);
      }
    }

    if (value.symbol || value.symbolName || value.instId || value.name) {
      const marketType = classify(value, familyHint);
      if (marketType) add(value, marketType);
    }
  };

  const endpoints = [
    'https://api.phemex.com/exchange/public/cfg/v2/products',
    'https://api.phemex.com/exchange/public/products',
    'https://api.phemex.com/v1/exchange/public/products',
    'https://api.phemex.com/public/products-plus',
    'https://api.phemex.com/public/products',
  ];

  for (const endpoint of endpoints) {
    try {
      const payload = await getJson(endpoint, 20000);
      walk(payload);
      console.log('[SIRE PHEMEX] ' + endpoint.replace('https://api.phemex.com/','') + ': catalogue scanned');
    } catch (error) {
      console.warn('[SIRE PHEMEX] ' + endpoint + ' failed:', error);
    }
  }

  console.log('[SIRE PHEMEX] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(x => x.marketType === 'Spot').length,
    perpetuals: out.filter(x => x.marketType === 'Perpetuals').length,
    futures: out.filter(x => x.marketType === 'Futures').length,
    options: out.filter(x => x.marketType === 'Options').length,
  }));
  return out;
}
async function blank(): Promise<UnifiedInstrument[]> {
  // "Blank" is not an exchange/provider currently present in SIRE's provider
  // registry and no public instrument API could be identified. Do not fabricate
  // symbols. This provider stays isolated until the exact venue is identified.
  console.warn('[SIRE BLANK] No verified public exchange catalogue identified.');
  return [];
}

async function whitebit(): Promise<UnifiedInstrument[]> {
  const out:UnifiedInstrument[]=[]; const seen=new Set<string>(); let collateral=new Set<string>();
  try{const rows=await getJson('https://whitebit.com/api/v4/public/collateral/markets',12000);if(Array.isArray(rows))collateral=new Set(rows.map((x:any)=>String(x||'').trim()));}catch(e){console.warn('[SIRE WHITEBIT] Collateral markets failed:',e);}
  const add=(raw:any,marketType:string,symbol:string,base?:string,quote?:string,extra:any={})=>{
    const item=cryptoItem('WHITEBIT',marketType,'Crypto',{...raw,symbol,baseAsset:base||raw?.stock||raw?.stock_currency,quoteAsset:quote||raw?.money||raw?.money_currency,status:raw?.tradesEnabled===false?'offline':'online',...extra});
    if(!item||seen.has(item.id))return;seen.add(item.id);out.push(item);
  };
  try{
    const rows=await getJson('https://whitebit.com/api/v4/public/markets',15000);
    for(const raw of Array.isArray(rows)?rows:[]){const symbol=String(raw?.name||'').trim();if(!symbol)continue;const type=String(raw?.type||'').toLowerCase();const base=String(raw?.stock||'').trim()||undefined;const quote=String(raw?.money||'').trim()||undefined;if(type==='spot')add(raw,'Spot',symbol,base,quote,{supportsMargin:collateral.has(symbol)});else if(type==='futures'){const perp=/(?:^|[_-])PERP(?:$|[_-])/i.test(symbol);add(raw,perp?'Perpetuals':'Futures',symbol,base,quote,{contractType:perp?'perpetual':'delivery',supportsMargin:true});}}
    console.log('[SIRE WHITEBIT] Market info: '+(Array.isArray(rows)?rows.length:0));
  }catch(e){console.warn('[SIRE WHITEBIT] Market info failed:',e);}
  try{
    const payload=await getJson('https://whitebit.com/api/v4/public/futures',15000);const rows=Array.isArray(payload?.result)?payload.result:[];
    for(const raw of rows){const symbol=String(raw?.ticker_id||'').trim();if(!symbol)continue;const product=String(raw?.product_type||'').toLowerCase();const mt=product==='perpetual'||/(?:^|[_-])PERP(?:$|[_-])/i.test(symbol)?'Perpetuals':product==='option'||product==='options'?'Options':'Futures';add(raw,mt,symbol,raw?.stock_currency,raw?.money_currency,{contractType:product||undefined,settlement:raw?.money_currency||undefined});}
    console.log('[SIRE WHITEBIT] Futures: '+rows.length);
  }catch(e){console.warn('[SIRE WHITEBIT] Futures failed:',e);}
  console.log('[SIRE WHITEBIT] COMPLETE',JSON.stringify({total:out.length,spot:out.filter(x=>x.marketType==='Spot').length,perpetuals:out.filter(x=>x.marketType==='Perpetuals').length,futures:out.filter(x=>x.marketType==='Futures').length,options:out.filter(x=>x.marketType==='Options').length,margin:out.filter(x=>x.supportsMargin).length}));
  return out;
}

async function coinw(): Promise<UnifiedInstrument[]> {
  const out:UnifiedInstrument[]=[];const seen=new Set<string>();
  const add=(raw:any,marketType:string,symbol:string,base?:string,quote?:string,extra:any={})=>{const item=cryptoItem('COINW',marketType,'Crypto',{...raw,symbol,baseAsset:base||raw?.baseAsset,quoteAsset:quote||raw?.quoteAsset,status:raw?.state===2?'offline':'online',...extra});if(!item||seen.has(item.id))return;seen.add(item.id);out.push(item);};
  try{const payload=await getJson('https://api.coinw.com/api/v1/public?command=returnSymbol',15000);const rows=Array.isArray(payload?.data)?payload.data:Array.isArray(payload)?payload:[];for(const raw of rows){const symbol=String(raw?.currencyPair||raw?.symbol||'').trim();if(symbol)add(raw,'Spot',symbol,raw?.currencyBase,raw?.currencyQuote);}console.log('[SIRE COINW] Spot: '+rows.length);}catch(e){console.warn('[SIRE COINW] Spot failed:',e);}
  try{const payload=await getJson('https://api.coinw.com/v1/perpum/instruments',15000);const rows=Array.isArray(payload?.data)?payload.data:Array.isArray(payload)?payload:[];for(const raw of rows){const base=String(raw?.base||raw?.baseCurrency||'').trim();if(!base)continue;const quote=String(raw?.quote||raw?.quoteCurrency||raw?.settleCurrency||'USDT').trim();const symbol=String(raw?.name||raw?.instrument||raw?.symbol||(quote==='USDT'?base+'USDT':base+'_'+quote)).trim();add(raw,'Perpetuals',symbol,base,quote,{contractType:'perpetual',settlement:raw?.settleCurrency||quote});}console.log('[SIRE COINW] Perpetuals: '+rows.length);}catch(e){console.warn('[SIRE COINW] Perpetuals failed:',e);}
  console.log('[SIRE COINW] COMPLETE',JSON.stringify({total:out.length,spot:out.filter(x=>x.marketType==='Spot').length,perpetuals:out.filter(x=>x.marketType==='Perpetuals').length}));
  return out;
}

async function bitrue(): Promise<UnifiedInstrument[]> {
 const out: UnifiedInstrument[]=[]; const seen=new Set<string>();
 const add=(raw:any,mt:string,symbol:string,base?:string,quote?:string)=>{const item=cryptoItem('BITRUE',mt,'Crypto',{...raw,symbol,baseAsset:base||raw?.baseAsset,quoteAsset:quote||raw?.quoteAsset});if(item&&!seen.has(item.id)){seen.add(item.id);out.push(item);}};
 try{const p=await getJson('https://api.bitrue.com/api/v1/exchangeInfo',15000);const rows=Array.isArray(p?.symbols)?p.symbols:[];for(const r of rows){const z=String(r?.symbol||'').trim();if(z)add(r,'Spot',z,r?.baseAsset,r?.quoteAsset);}console.log('[SIRE BITRUE] Spot: '+rows.length);}catch(e){console.warn('[SIRE BITRUE] Spot failed:',e);}
 for(const [label,url] of [['USDT-M','https://fapi.bitrue.com/fapi/v1/contracts'],['COIN-M','https://fapi.bitrue.com/dapi/v1/contracts']] as const){try{const p=await getJson(url,15000);const rows=Array.isArray(p)?p:Array.isArray(p?.data)?p.data:[];for(const r of rows){const z=String(r?.symbol||r?.contractName||'').trim();if(!z)continue;const typ=String(r?.contractType||r?.type||'').toLowerCase();const exp=r?.deliveryTime??r?.expireTime??r?.expiryTime;const mt=exp||typ.includes('delivery')||typ==='future'||typ==='futures'?'Futures':'Perpetuals';add(r,mt,z,r?.baseAsset||r?.baseCoin,r?.quoteAsset||r?.quoteCoin||r?.settleCoin,{contractType:typ||mt.toLowerCase(),settlement:r?.settleCoin||r?.marginCoin||r?.settlementAsset,expiry:exp});}console.log('[SIRE BITRUE] '+label+': '+rows.length);}catch(e){console.warn('[SIRE BITRUE] '+label+' failed:',e);}}
 console.log('[SIRE BITRUE] COMPLETE',JSON.stringify({total:out.length,spot:out.filter(x=>x.marketType==='Spot').length,perpetuals:out.filter(x=>x.marketType==='Perpetuals').length,futures:out.filter(x=>x.marketType==='Futures').length})); return out;
}
async function ascendex(): Promise<UnifiedInstrument[]> {
 const out: UnifiedInstrument[]=[]; const seen=new Set<string>();
 const add=(raw:any,mt:string,symbol:string,base?:string,quote?:string)=>{const item=cryptoItem('ASCENDEX',mt,'Crypto',{...raw,symbol,baseAsset:base||raw?.baseAsset,quoteAsset:quote||raw?.quoteAsset});if(item&&!seen.has(item.id)){seen.add(item.id);out.push(item);}};
 for(const [account,mt] of [['cash','Spot'],['margin','Margin']] as const){try{const p=await getJson('https://ascendex.com/api/pro/v1/'+account+'/products',15000);const rows=Array.isArray(p?.data)?p.data:[];for(const r of rows){const z=String(r?.symbol||r?.displayName||'').trim();if(z){const q=z.split('/');add(r,mt,z,r?.baseAsset||q[0],r?.quoteAsset||q[1]);}}console.log('[SIRE ASCENDEX] '+mt+': '+rows.length);}catch(e){console.warn('[SIRE ASCENDEX] '+mt+' failed:',e);}}
 try{const p=await getJson('https://ascendex.com/api/pro/v2/futures/contract',15000);const rows=Array.isArray(p?.data)?p.data:[];for(const r of rows){const z=String(r?.symbol||r?.displayName||'').trim();if(!z)continue;const typ=String(r?.contractType||'').toLowerCase();const exp=r?.deliveryTime??r?.expireTime??r?.expiryTime;const perp=!exp&&(z.includes('PERP')||typ.includes('perpetual'));add(r,perp?'Perpetuals':'Futures',z,r?.baseAsset,r?.quoteAsset||r?.settlementAsset,{contractType:perp?'perpetual':'delivery',expiry:exp});}console.log('[SIRE ASCENDEX] Futures: '+rows.length);}catch(e){console.warn('[SIRE ASCENDEX] Futures failed:',e);}
 console.log('[SIRE ASCENDEX] COMPLETE',JSON.stringify({total:out.length,spot:out.filter(x=>x.marketType==='Spot').length,margin:out.filter(x=>x.marketType==='Margin').length,perpetuals:out.filter(x=>x.marketType==='Perpetuals').length,futures:out.filter(x=>x.marketType==='Futures').length}));return out;
}

export async function getStandaloneMarketProviderCatalogue(
  provider: MarketProvider,
  fetchDeriv: () => Promise<any[]>,
): Promise<UnifiedInstrument[]> {
  switch (provider) {
    case 'DERIV': {
      const items = await fetchDeriv();
      return items.map(derivItem).filter(Boolean) as UnifiedInstrument[];
    }
    case 'BINGX': return bingx();
    case 'BITRUE': return bitrue();
    case 'ASCENDEX': return ascendex();
    case 'WHITEBIT': return whitebit();
    case 'COINW': return coinw();
    case 'BINANCE': return binance();
    case 'COINBASE': return coinbase();
    case 'KRAKEN': return kraken();
    case 'BYBIT': return bybit();
    case 'OKX': return okx();
    case 'BITGET': return bitget();
    case 'GATEIO': return gateio();
    case 'KUCOIN': return kucoin();
    case 'CRYPTOCOM': return cryptocom();
    case 'BITFINEX': return bitfinex();
    case 'GEMINI': return gemini();
    case 'BITSTAMP': return bitstamp();
    case 'COINEX': return coinex();
    case 'HTX': return htx();
    case 'BITTREX': return bittrex();
    case 'BITMART': return bitmart();
    case 'BLANK': return blank();
    case 'PHEMEX': return phemex();
    case 'LBANK': return lbank();
    case 'MEXC': return mexc();
    default: return [];
  }
}

export async function getUnifiedMarketCatalogue(fetchDeriv: () => Promise<any[]>): Promise<UnifiedInstrument[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.instruments;
  if (loading) return loading;
  loading = (async () => {
    // Keep the startup catalogue small and deterministic. Large exchange master files
    // (ASX/XETR/Nasdaq/HKEX/BSE/TSE/etc.) are not allowed to compete with the
    // core live-market venues during the initial request. The quote UI can then
    // reliably receive DERIV + the major crypto venues instead of whichever
    // public file happens to finish first.
    const providers: Array<[MarketProvider, Promise<UnifiedInstrument[]>]> = [
      ['BINGX', bingx()],
      ['BITRUE', bitrue()],
      ['ASCENDEX', ascendex()],
      ['WHITEBIT', whitebit()],
      ['COINW', coinw()],
      // Deriv remains on its dedicated implementation and is intentionally untouched.
      ['DERIV', fetchDeriv().then(items => items.map(derivItem).filter(Boolean) as UnifiedInstrument[])],
      ['BINANCE', binance()],
      ['COINBASE', coinbase()],
      ['KRAKEN', kraken()],
      // Bybit public instrument catalogue: Spot, perpetuals, futures, options and Event Contracts.
      ['BYBIT', bybit()],
      // OKX public instruments: Spot, Margin, Perpetuals, Futures/X-Perps,
      // Options and Event Contracts.
      ['OKX', okx()],
      // Bitget is independent: Spot, Margin, USDT-M, Coin-M and USDC-M.
      ['BITGET', bitget()],
      ['GATEIO', gateio()],
      ['KUCOIN', kucoin()],
      ['MEXC', mexc()],
      ['CRYPTOCOM', cryptocom()],
      ['BITFINEX', bitfinex()],
      ['GEMINI', gemini()],
      ['BITSTAMP', bitstamp()],
      ['LBANK', lbank()],
      ['BITMART', bitmart()],
      ['PHEMEX', phemex()],
      ['FXCM', fxcm()],
      // Nasdaq Trader supplies the public instrument master for Nasdaq-listed,
      // other U.S.-listed, bonds, NOM options, mutual funds and additional
      // Nasdaq-published derivatives directories.
      ['YFINANCE', yfinance()],
      ['SP', sp()],
      ['NASDAQTRADER', nasdaqTrader()],
      // NYSE American (formerly NYSE Amex) is a separate exchange universe.
      ['NYSEAMERICAN', nyseAmerican()],
      // CME Group's official public product catalogue.
      ['CME', cme()],
      // Crypto market discovery is owned exclusively by the CCXT global universe.
      ['OANDA', oanda()],
    ];
    const results = await Promise.allSettled(
      providers.map(([provider, promise]) =>
        withProviderTimeout(provider, promise, provider === 'DERIV' ? 10000 : provider === 'CME' || provider === 'NYSEAMERICAN' || provider === 'GEMINI' || provider === 'CRYPTOCOM' || provider === 'BITFINEX' || provider === 'BITSTAMP' ? 120000 : 20000)
      )
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