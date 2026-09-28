export type MarketProvider = 'BITRUE' | 'ASCENDEX' | 'COINW' | 'BINGX' | 'BINANCE' | 'FXCM' | 'YFINANCE' | 'SP' | 'DERIV' | 'BITGET' | 'BYBIT' | 'OKX' | 'KRAKEN' | 'COINBASE' | 'GATEIO' | 'KUCOIN' | 'GEMINI' | 'BITSO' | 'BITFINEX' | 'BITVAVO' | 'COINEX' | 'LBANK' | 'WOOX' | 'CRYPTOCOM' | 'HTX' | 'BITKUB' | 'UPBIT' | 'PIONEX' | 'POLONIEX' | 'BITHUMB' | 'MEXC' | 'PHEMEX' | 'WHITEBIT' | 'TWELVEDATA' | 'NASDAQTRADER' | 'CME' | 'CBOT' | 'NYMEX' | 'COMEX' | 'NYSEAMERICAN' | 'XETR' | 'HKEX' | 'BSE' | 'TSE' | 'XFRA' | 'EUREX' | 'ASX' | 'TWSE' | 'PSX' | 'IDX' | 'NSE' | 'BITSTAMP' | 'OANDA' | 'TRADINGVIEW' | 'FOREXCOM' | 'INTERACTIVEBROKERS' | 'TRADESTATION' | 'WEBULL' | 'MOOMOO' | 'NINJATRADER' | 'TRADOVATE' | 'AMPFUTURES' | 'TASTYTRADE' | 'TASTYFX' | 'CRYPTOCOMEXCHANGE' | 'COINBASEADVANCED' | 'ALPACA' | 'TRADIERBROKERAGE' | 'TRADEZERO' | 'COBRATRADING' | 'CLEARSTREET' | 'INVESTRADE' | 'PUBLIC' | 'PLUS500US' | 'OPTIMUSFUTURES' | 'EDGECLEAR' | 'IRONBEAM' | 'STONEX' | 'DORMANTRADING' | 'TRADIERFUTURES' | 'BITTREX' | 'BITMART' | 'BLANK' | 'XT' | 'DEEPCOIN' | 'TOOBIT' | 'WEEX' | 'BITUNIX' | 'BLOFIN' | 'COINCATCH' | 'ZOOMEX' | 'BTCC' | 'DIGIFINEX' | 'COINSTORE' | 'PROBIT' | 'POLONIEX' | 'COINDCX' | 'POLYMARKET' | 'KALSHI' | 'OPINION' | 'UNISWAP';

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
  if (value === 'xt') return 'https://www.xt.com/favicon.ico';
  if (value === 'deepcoin') return 'https://www.deepcoin.com/favicon.ico';
  if (value === 'coinstore') return 'https://www.coinstore.com/favicon.ico';
  if (value === 'probit') return 'https://www.probit.com/favicon.ico';
  if (value === 'poloniex') return 'https://poloniex.com/favicon.ico';
  if (value === 'coindcx') return 'https://coindcx.com/favicon.ico';
  if (value === 'polymarket') return 'https://polymarket.com/favicon.ico';
  if (value === 'kalshi') return 'https://kalshi.com/favicon.ico';
  if (value === 'opinion') return 'https://opinion.trade/favicon.ico';
  if (value === 'uniswap') return 'https://app.uniswap.org/favicon.ico';
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

async function getJsonWithHeaders(url: string, headers: Record<string,string>, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', ...headers } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } finally { clearTimeout(timer); }
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

async function postJson(url: string, body: any, timeoutMs = 12000) {
  const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try { const response=await fetch(url,{method:'POST',signal:controller.signal,headers:{Accept:'application/json','Content-Type':'application/json','User-Agent':'SIRE-market-catalog/1.0'},body:JSON.stringify(body)}); if(!response.ok) throw new Error('HTTP '+response.status); return await response.json(); }
  finally { clearTimeout(timer); }
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

async function kraken(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

  const add = (raw: any, marketType: string, category: string, symbolOverride?: string) => {
    const symbol = String(symbolOverride || raw?.symbol || raw?.wsname || raw?.altname || raw?.id || raw?.instrumentName || '').trim();
    if (!symbol) return;
    const key = marketType + ':' + symbol;
    if (seen.has(key)) return;

    const base = String(raw?.baseAsset || raw?.base_currency || raw?.base || raw?.underlyingAsset || raw?.underlying || raw?.underlying_symbol || '').trim();
    const quote = String(raw?.quoteAsset || raw?.quote_currency || raw?.quote || raw?.quoteCurrency || raw?.settleCurrency || '').trim();

    const item = cryptoItem('KRAKEN', marketType, category, {
      ...raw,
      symbol,
      baseAsset: base,
      quoteAsset: quote,
      fullName: raw?.displayName || raw?.display_name || raw?.name || symbol,
      status: raw?.status || raw?.state || (raw?.tradeable === false ? 'offline' : 'online'),
      contractType: raw?.contractType || raw?.contract_type || raw?.type,
      settleCoin: raw?.settleCurrency || raw?.settle_currency || raw?.settleCoin,
      deliveryTime: raw?.expiry || raw?.expiration || raw?.expiryTime,
      strikePrice: raw?.strikePrice || raw?.strike_price,
      optionType: raw?.optionType || raw?.option_type,
    });
    if (!item) return;

    item.id = 'KRAKEN:' + marketType + ':' + symbol;
    item.providerLabel = 'Kraken';
    item.marketType = marketType;
    item.category = category;
    item.instrumentType = marketType;
    seen.add(key);
    out.push(item);
  };

  try {
    const response = await getJson('https://api.kraken.com/0/public/AssetPairs', 15000);
    const rows = response?.result && typeof response.result === 'object' ? Object.entries(response.result) : [];
    for (const [id, raw] of rows) {
      add({ ...(raw as any), id, symbol: (raw as any)?.wsname || (raw as any)?.altname || id }, 'Spot', 'Crypto', id);
    }
    console.log('[SIRE KRAKEN] Spot AssetPairs: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE KRAKEN] Spot AssetPairs failed:', error);
  }

  try {
    const response = await getJson('https://futures.kraken.com/derivatives/api/v3/instruments', 20000);
    const rows = Array.isArray(response?.instruments) ? response.instruments : Array.isArray(response?.result) ? response.result : [];

    for (const raw of rows) {
      const type = String(raw?.type || raw?.instrumentType || raw?.contractType || '').toLowerCase();
      const symbol = String(raw?.symbol || raw?.instrumentName || raw?.instrument || raw?.id || '').trim();
      const display = String(raw?.displayName || raw?.display_name || raw?.name || symbol).toLowerCase();
      const expiry = String(raw?.expiry || raw?.expiration || raw?.expiryTime || '').trim();

      let marketType = 'Other Derivatives';
      if (type.includes('perpetual') || type === 'perpetual_swap' || display.includes('perpetual') || symbol.startsWith('PF_') || symbol.startsWith('PI_')) {
        marketType = 'Perpetual Futures';
      } else if (type.includes('option') || display.includes('option')) {
        marketType = 'Options';
      } else if (type.includes('future') || type.includes('futures') || expiry || symbol.startsWith('FI_')) {
        marketType = 'Futures';
      }

      add(raw, marketType, 'Crypto', symbol);
    }
    console.log('[SIRE KRAKEN] Derivatives instruments: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE KRAKEN] Derivatives instruments failed:', error);
  }

  const counts = out.reduce<Record<string, number>>((acc, item) => {
    acc[item.marketType] = (acc[item.marketType] || 0) + 1;
    return acc;
  }, {});
  console.log('[SIRE KRAKEN] COMPLETE', JSON.stringify({ total: out.length, ...counts }));
  return out;
}

async function bybit(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();
  // Render's default US runtime can be rejected by Bybit's API edge. The
  // Frankfurt relay is the primary path; direct Bybit endpoints remain a
  // fallback for deployments whose source region is accepted by Bybit.
  const relay = String(process.env.SIRE_BYBIT_RELAY_URL || '').replace(/\/+$/, '');
  const bybitEndpoints = (pathAndQuery: string) => [
    ...(relay ? [relay + pathAndQuery] : []),
    'https://api.bybit.com' + pathAndQuery,
    'https://api.bytick.com' + pathAndQuery,
  ];

  const add = (raw: any, marketType: string, category: string, instrumentType?: string) => {
    const symbol = String(raw?.symbol || '').trim();
    if (!symbol) return;
    const key = category + ':' + symbol;
    if (seen.has(key)) return;

    const item = cryptoItem('BYBIT', marketType, category, {
      ...raw,
      symbol,
      baseCoin: raw?.baseCoin,
      quoteCoin: raw?.quoteCoin,
      fullName: raw?.fullName || raw?.displayName || symbol,
      status: raw?.status || 'online',
      contractType: raw?.contractType || raw?.eventContractType,
      settleCoin: raw?.settleCoin,
      deliveryTime: raw?.deliveryTime,
      strikePrice: raw?.strikePrice,
      optionsType: raw?.optionsType,
      isMarginEnabled: raw?.marginTrading && raw.marginTrading !== 'none',
    });
    if (!item) return;

    item.id = 'BYBIT:' + category + ':' + symbol;
    item.providerLabel = 'Bybit';
    item.marketType = marketType;
    item.category = category;
    item.instrumentType = instrumentType || marketType;
    item.contractType = String(raw?.contractType || raw?.eventContractType || '').trim() || item.contractType;
    item.settlement = String(raw?.settleCoin || '').trim() || item.settlement;
    item.expiry = String(raw?.deliveryTime || '').trim() || item.expiry;
    item.strike = Number.isFinite(Number(raw?.strikePrice)) ? Number(raw.strikePrice) : item.strike;
    item.optionType = String(raw?.optionsType || '').trim() || item.optionType;
    item.supportsMargin = Boolean(raw?.marginTrading && raw.marginTrading !== 'none');
    (item as any).symbolType = raw?.symbolType;
    (item as any).marketRegion = raw?.marketRegion;
    (item as any).underlyingTicker = raw?.underlyingTicker;
    (item as any).isPreListing = Boolean(raw?.isPreListing);
    seen.add(key);
    out.push(item);
  };

  const categoryFor = (raw: any, fallback = 'Crypto'): string => {
    const symbolType = String(raw?.symbolType || '').trim();
    if (symbolType === 'stock' || symbolType === 'xstocks' || symbolType === 'mstocks') return 'Stocks';
    if (symbolType === 'ETF') return 'ETF';
    if (symbolType === 'commodity') return 'Commodities';
    if (symbolType === 'forex') return 'Forex';
    return fallback;
  };

  const fetchPaged = async (category: string, params: Record<string, string>, handler: (raw: any) => void, paginated = true) => {
    let cursor = '';
    for (let page = 0; page < 1000; page += 1) {
      const query = new URLSearchParams({ category, ...params });
      if (paginated) {
        query.set('limit', '1000');
        if (cursor) query.set('cursor', cursor);
      }

      const response = await getJsonAny(bybitEndpoints('/v5/market/instruments-info?' + query.toString()), 15000);

      if (Number(response?.retCode) !== 0) {
        throw new Error(String(response?.retMsg || 'Bybit API error'));
      }

      const rows = Array.isArray(response?.result?.list) ? response.result.list : [];
      for (const raw of rows) handler(raw);

      const next = String(response?.result?.nextPageCursor || '');
      console.log('[SIRE BYBIT] ' + category + ' page ' + (page + 1) + ': ' + rows.length);
      if (!paginated || !next || next === cursor || rows.length === 0) break;
      cursor = next;
    }
  };

  try {
    // Spot has no pagination according to Bybit's API and returns its complete
    // online spot universe in one response.
    await fetchPaged('spot', {}, raw => {
      add(raw, 'Spot', categoryFor(raw), 'Spot');
    }, false);
  } catch (error) {
    console.warn('[SIRE BYBIT] spot failed:', error);
  }

  try {
    // Linear contains USDT/USDC perpetuals and delivery futures. Keep the
    // contractType supplied by Bybit so the UI can distinguish them exactly.
    await fetchPaged('linear', {}, raw => {
      const contractType = String(raw?.contractType || '').toLowerCase();
      const marketType = contractType.includes('perpetual') ? 'Perpetuals' : 'Futures';
      add(raw, marketType, categoryFor(raw), marketType);
    });
  } catch (error) {
    console.warn('[SIRE BYBIT] linear failed:', error);
  }

  try {
    // Inverse contains both inverse perpetuals and inverse delivery futures.
    await fetchPaged('inverse', {}, raw => {
      const contractType = String(raw?.contractType || '').toLowerCase();
      const marketType = contractType.includes('perpetual') ? 'Perpetuals' : 'Futures';
      add(raw, marketType, categoryFor(raw), marketType);
    });
  } catch (error) {
    console.warn('[SIRE BYBIT] inverse failed:', error);
  }

  const optionBaseTypes = new Map<string, string>();
  try {
    const response = await getJsonAny(bybitEndpoints('/v5/market/option-base-coins'), 15000);
    for (const raw of Array.isArray(response?.result?.list) ? response.result.list : []) {
      optionBaseTypes.set(String(raw?.baseCoin || '').toUpperCase(), String(raw?.underlyingType || '0'));
    }
  } catch (error) {
    console.warn('[SIRE BYBIT] option base-coin discovery failed:', error);
  }

  try {
    // Passing baseCoin=All is required to enumerate the complete option
    // universe rather than Bybit's default BTC-only option set.
    await fetchPaged('option', { baseCoin: 'All' }, raw => {
      const underlyingType = optionBaseTypes.get(String(raw?.baseCoin || '').toUpperCase()) || '0';
      const category =
        underlyingType === '1' ? 'Commodities' :
        underlyingType === '2' ? 'Stocks' :
        underlyingType === '3' ? 'Forex' :
        underlyingType === '4' ? 'Oil' :
        'Crypto';
      add(raw, 'Options', category, 'Options');
    });
  } catch (error) {
    console.warn('[SIRE BYBIT] option failed:', error);
  }

  try {
    // Bybit Event Contracts are exposed through a separate API, not through
    // /v5/market/instruments-info. Include every non-Closed event instrument.
    let cursor = '';
    for (let page = 0; page < 1000; page += 1) {
      const query = new URLSearchParams({ limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const response = await getJsonAny(bybitEndpoints('/v5/event/instruments-info?' + query.toString()), 15000);
      if (Number(response?.retCode) !== 0) {
        throw new Error(String(response?.retMsg || 'Bybit event API error'));
      }

      const rows = Array.isArray(response?.result?.list) ? response.result.list : [];
      for (const raw of rows) {
        if (String(raw?.status || '').toLowerCase() === 'closed') continue;
        add(raw, 'Event Contracts', 'Crypto', 'Event Contracts');
      }

      const next = String(response?.result?.nextPageCursor || '');
      console.log('[SIRE BYBIT] events page ' + (page + 1) + ': ' + rows.length);
      if (!next || next === cursor || rows.length === 0) break;
      cursor = next;
    }
  } catch (error) {
    console.warn('[SIRE BYBIT] events failed:', error);
  }

  console.log('[SIRE BYBIT] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(i => i.marketType === 'Spot').length,
    perpetuals: out.filter(i => i.marketType === 'Perpetuals').length,
    futures: out.filter(i => i.marketType === 'Futures').length,
    options: out.filter(i => i.marketType === 'Options').length,
    events: out.filter(i => i.marketType === 'Event Contracts').length,
  }));

  return out;
}

async function okx(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const endpointTypes = ['SPOT', 'MARGIN', 'SWAP', 'FUTURES'] as const;

  const categoryFromInstCategory = (raw: any): string => {
    const key = String(raw?.instCategory || '').trim();
    if (key === '1') return 'Crypto';
    if (key === '3') return 'Stocks';
    if (key === '4') return 'Commodities';
    if (key === '5') return 'Forex';
    if (key === '6') return 'Bonds';
    if (String(raw?.instType || '').toUpperCase() === 'EVENTS') return 'Event Contracts';
    return 'Crypto';
  };

  const marketTypeFor = (instType: string, raw: any): string => {
    switch (instType) {
      case 'SPOT': return 'Spot';
      case 'MARGIN': return 'Margin';
      case 'SWAP': return 'Perpetuals';
      case 'OPTION': return 'Options';
      case 'EVENTS': return 'Event Contracts';
      case 'FUTURES': {
        // OKX X-Perps are returned as FUTURES and identified by ruleType.
        // Pre-market X-Perps use ruleType=pre_market until conversion.
        const ruleType = String(raw?.ruleType || '').toLowerCase();
        if (ruleType === 'xperp' || ruleType === 'pre_market') return 'Perpetuals';
        return 'Futures';
      }
      default: return instType;
    }
  };

  const normalize = (instType: string, raw: any): UnifiedInstrument | null => {
    const marketType = marketTypeFor(instType, raw);
    const category = categoryFromInstCategory(raw);
    const item = cryptoItem('OKX', marketType, category, {
      ...raw,
      symbol: raw?.instId,
      baseCcy: raw?.baseCcy || raw?.uly || raw?.instFamily,
      quoteCcy: raw?.quoteCcy || raw?.settleCcy,
      fullName: raw?.instId,
      status: raw?.state || 'live',
      type: marketType,
      contractType: raw?.ctType || raw?.ruleType || undefined,
      settleCcy: raw?.settleCcy,
      deliveryTime: raw?.expTime || raw?.contTdSwTime || undefined,
      strikePrice: raw?.stk,
      optionsType: raw?.optType,
    });
    if (!item) return null;

    item.id = 'OKX:' + instType + ':' + String(raw?.instId || item.symbol);
    item.providerLabel = 'OKX';
    item.marketType = marketType;
    item.category = category;
    item.instrumentType = instType;
    item.contractType = String(raw?.ruleType || raw?.ctType || '').trim() || item.contractType;
    item.settlement = String(raw?.settleCcy || '').trim() || item.settlement;
    item.expiry = String(raw?.expTime || '').trim() || item.expiry;
    item.strike = Number.isFinite(Number(raw?.stk)) ? Number(raw.stk) : item.strike;
    item.optionType = String(raw?.optType || '').trim() || item.optionType;
    item.supportsMargin = instType === 'MARGIN' || Boolean(raw?.lever);
    return item;
  };

  for (const instType of endpointTypes) {
    try {
      const response = await getJsonAny([
        'https://www.okx.com/api/v5/public/instruments?instType=' + instType,
        'https://app.okx.com/api/v5/public/instruments?instType=' + instType,
      ], 15000);

      const rows = Array.isArray(response?.data) ? response.data : [];
      for (const raw of rows) {
        // The public catalogue contains suspended/rebase rows too. The Quote
        // catalogue is intended to expose instruments OKX currently offers for
        // trading, so keep only live instruments while retaining every live ID.
        if (String(raw?.state || '').toLowerCase() !== 'live') continue;
        const item = normalize(instType, raw);
        if (item) out.push(item);
      }

      console.log('[SIRE OKX] ' + instType + ': ' + rows.length + ' published / ' +
        out.filter(item => item.instrumentType === instType).length + ' live');
    } catch (error) {
      console.warn('[SIRE OKX] ' + instType + ' failed:', error);
    }
  }

  // OKX requires an underlying (uly) or instrument family when querying
  // OPTION instruments. Discover every option underlying first, then query each
  // family so the catalog does not silently return zero options.
  try {
    const underlyingResponse = await getJsonAny([
      'https://www.okx.com/api/v5/public/underlying?instType=OPTION',
      'https://app.okx.com/api/v5/public/underlying?instType=OPTION',
    ], 15000);
    const families = new Set<string>();
    for (const row of Array.isArray(underlyingResponse?.data) ? underlyingResponse.data : []) {
      const values = Array.isArray(row?.uly) ? row.uly : [];
      for (const value of values) {
        const family = String(value || '').trim();
        if (family) families.add(family);
      }
    }

    for (const family of families) {
      try {
        const response = await getJsonAny([
          'https://www.okx.com/api/v5/public/instruments?instType=OPTION&uly=' + encodeURIComponent(family),
          'https://app.okx.com/api/v5/public/instruments?instType=OPTION&uly=' + encodeURIComponent(family),
        ], 15000);
        const rows = Array.isArray(response?.data) ? response.data : [];
        for (const raw of rows) {
          if (String(raw?.state || '').toLowerCase() !== 'live') continue;
          const item = normalize('OPTION', raw);
          if (item) out.push(item);
        }
      } catch (error) {
        console.warn('[SIRE OKX] OPTION family ' + family + ' failed:', error);
      }
    }
    console.log('[SIRE OKX] OPTION families: ' + families.size + ' / live instruments: ' +
      out.filter(item => item.instrumentType === 'OPTION').length);
  } catch (error) {
    console.warn('[SIRE OKX] OPTION underlying discovery failed:', error);
  }

  const seen = new Set<string>();
  const unique = out.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  console.log('[SIRE OKX] COMPLETE', JSON.stringify({
    total: unique.length,
    spot: unique.filter(item => item.instrumentType === 'SPOT').length,
    margin: unique.filter(item => item.instrumentType === 'MARGIN').length,
    perpetuals: unique.filter(item => item.marketType === 'Perpetuals').length,
    futures: unique.filter(item => item.instrumentType === 'FUTURES' && item.marketType === 'Futures').length,
    options: unique.filter(item => item.instrumentType === 'OPTION').length,
  }));

  return unique;
}


function derivItem(raw: any): UnifiedInstrument | null {
  const symbol = String(raw?.underlying_symbol ?? raw?.symbol ?? '').trim();
  if (!symbol) return null;

  const market = String(raw?.market ?? '').trim().toLowerCase();
  const symbolType = String(raw?.underlying_symbol_type ?? raw?.symbol_type ?? '').trim().toLowerCase();
  const explicitCategory = String(raw?.category ?? '').trim().toLowerCase();
  const categoryKey = explicitCategory || symbolType || market;

  const categoryMap: Record<string,string> = {
    synthetic: 'Synthetic Indices',
    synthetic_indices: 'Synthetic Indices',
    syntheticindex: 'Synthetic Indices',
    forex: 'Forex',
    currency: 'Forex',
    commodities: 'Commodities',
    commodity: 'Commodities',
    indices: 'Indices',
    index: 'Indices',
    stocks: 'Stocks',
    stock: 'Stocks',
    shares: 'Stocks',
    crypto: 'Crypto',
    cryptocurrency: 'Crypto',
    other: 'Other',
  };

  const category =
    categoryMap[categoryKey] ||
    (market.includes('synthetic') || symbolType.includes('synthetic') ? 'Synthetic Indices' :
      market.includes('forex') || symbolType.includes('forex') ? 'Forex' :
      market.includes('commodit') || symbolType.includes('commodit') ? 'Commodities' :
      market.includes('index') || symbolType.includes('index') ? 'Indices' :
      market.includes('stock') || symbolType.includes('stock') ? 'Stocks' :
      market.includes('crypto') || symbolType.includes('crypto') ? 'Crypto' :
      'Other');

  const marketType = category === 'Synthetic Indices' ? 'Synthetic Indices' : category;
  const base = String(raw?.base ?? '').trim() || undefined;
  const quote = String(raw?.quote ?? '').trim() || undefined;
  const displayName = String(raw?.underlying_symbol_name ?? raw?.display_name ?? raw?.name ?? symbol).trim() || symbol;
  const suspended = Number(raw?.is_trading_suspended ?? raw?.tradingSuspended);

  return {
    id: 'DERIV:' + symbol,
    provider: 'DERIV',
    providerLabel: 'Deriv',
    marketType,
    category,
    symbol,
    displaySymbol: displayName || symbol,
    name: displayName,
    base,
    quote,
    exchangeOpen: Number.isFinite(Number(raw?.exchange_is_open ?? raw?.exchangeOpen)) ? Number(raw?.exchange_is_open ?? raw?.exchangeOpen) : undefined,
    status: suspended === 1 ? 'suspended' : 'online',
    logoUrl: assetLogo(base) || providerLogo('DERIV'),
    providerLogoUrl: providerLogo('DERIV'),
    instrumentType: String(raw?.underlying_symbol_type ?? raw?.symbol_type ?? marketType),
  };
}

async function bitget(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();
  const categories = ['SPOT', 'MARGIN', 'USDT-FUTURES', 'COIN-FUTURES', 'USDC-FUTURES'] as const;

  const assetCategory = (raw: any): string => {
    const type = String(raw?.symbolType || '').toLowerCase();
    if (type === 'stock' || type === 'stocks') return 'Stocks';
    if (type === 'metal' || type === 'precious_metal' || type === 'commodity' || type === 'commodities') return 'Commodities';
    return 'Crypto';
  };

  const add = (raw: any, requestedCategory: string) => {
    const symbol = String(raw?.symbol || '').trim();
    const category = String(raw?.category || requestedCategory).toUpperCase();
    if (!symbol || !categories.includes(category as any)) return;
    const type = String(raw?.type || raw?.symbolType || '').toLowerCase();
    const marketType =
      category === 'SPOT' ? 'Spot' :
      category === 'MARGIN' ? 'Margin' :
      type === 'perpetual' ? 'Perpetuals' :
      'Futures';
    const key = category + ':' + symbol;
    if (seen.has(key)) return;

    const item = cryptoItem('BITGET', marketType, assetCategory(raw), {
      ...raw,
      symbol,
      baseCoin: raw?.baseCoin || raw?.baseAsset,
      quoteCoin: raw?.quoteCoin || raw?.quoteAsset,
      fullName: raw?.displayName || symbol,
      status: raw?.status || 'online',
      contractType: raw?.type,
      settleCoin: raw?.settleCoin || raw?.settleCcy || raw?.quoteCoin,
      deliveryTime: raw?.deliveryTime,
      isMarginEnabled: category === 'MARGIN',
    });
    if (!item) return;

    item.id = 'BITGET:' + category + ':' + symbol;
    item.providerLabel = 'Bitget';
    item.marketType = marketType;
    item.category = assetCategory(raw);
    item.instrumentType = category;
    item.contractType = String(raw?.type || '').trim() || item.contractType;
    item.settlement = String(raw?.settleCoin || raw?.settleCcy || '').trim() || item.settlement;
    item.expiry = String(raw?.deliveryTime || '').trim() || item.expiry;
    item.supportsMargin = category === 'MARGIN' || Boolean(raw?.maxLeverage || raw?.maxCrossedLeverage || raw?.maxIsolatedLeverage);
    (item as any).bitgetCategory = category;
    (item as any).symbolType = raw?.symbolType;
    (item as any).deliveryPeriod = raw?.deliveryPeriod;
    (item as any).isRwa = String(raw?.isRwa || '').toUpperCase() === 'YES';
    (item as any).isReality = String(raw?.isReality || '').toLowerCase() === 'yes';

    seen.add(key);
    out.push(item);
  };

  // Bitget's public UTA v3 catalogue covers every public trading product line.
  // Query each category independently so one failed category never suppresses
  // the others. We retain all returned instrument states instead of silently
  // dropping non-online rows.
  for (const category of categories) {
    try {
      const response = await getJsonAny([
        'https://api.bitget.com/api/v3/market/instruments?category=' + encodeURIComponent(category),
        'https://api.bitget.com/api/v3/public/instruments?category=' + encodeURIComponent(category),
      ], 15000);
      if (String(response?.code || '00000') !== '00000') throw new Error(String(response?.msg || 'Bitget instruments request failed'));
      const rows = Array.isArray(response?.data) ? response.data : [];
      for (const raw of rows) add(raw, category);
      console.log('[SIRE BITGET] v3 ' + category + ': ' + rows.length);
    } catch (error) {
      console.warn('[SIRE BITGET] v3 ' + category + ' failed:', error);
    }
  }

  // Independent v2 contract fallback. It is additive and deduplicated, so
  // Render can still populate futures/perpetuals if v3 is temporarily blocked.
  for (const productType of ['USDT-FUTURES', 'COIN-FUTURES', 'USDC-FUTURES']) {
    try {
      const response = await getJson('https://api.bitget.com/api/v2/mix/market/contracts?productType=' + productType, 15000);
      if (String(response?.code || '00000') !== '00000') throw new Error(String(response?.msg || 'Bitget futures contract request failed'));
      const rows = Array.isArray(response?.data) ? response.data : [];
      for (const raw of rows) add({
        ...raw,
        category: productType,
        type: String(raw?.symbolType || '').toLowerCase() === 'perpetual' ? 'perpetual' : 'delivery',
        settleCoin: raw?.supportMarginCoins?.[0] || raw?.marginCoin,
      }, productType);
      console.log('[SIRE BITGET] v2 ' + productType + ': ' + rows.length);
    } catch (error) {
      console.warn('[SIRE BITGET] v2 ' + productType + ' failed:', error);
    }
  }

  const unique = out.filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
  console.log('[SIRE BITGET] COMPLETE', JSON.stringify({
    total: unique.length,
    spot: unique.filter(i => i.instrumentType === 'SPOT').length,
    margin: unique.filter(i => i.instrumentType === 'MARGIN').length,
    perpetuals: unique.filter(i => i.marketType === 'Perpetuals').length,
    futures: unique.filter(i => i.marketType === 'Futures').length,
  }));
  return unique;
}

async function mexc(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

  const add = (raw: any, marketType: string, category = 'Crypto', symbolOverride?: string) => {
    const symbol = String(symbolOverride || raw?.symbol || '').trim();
    if (!symbol) return;
    const item = cryptoItem('MEXC', marketType, category, {
      ...raw,
      symbol,
      baseAsset: raw?.baseCoin || raw?.baseAsset,
      quoteAsset: raw?.quoteCoin || raw?.quoteAsset,
      status: raw?.status || raw?.state || (raw?.enableTrading === false ? 'offline' : 'online'),
      settleCoin: raw?.settleCoin || raw?.settleCurrency,
      deliveryTime: raw?.deliveryTime || raw?.expireDate || undefined,
      contractType: raw?.futureType === 2 ? 'delivery' : (raw?.futureType === 1 ? 'perpetual' : raw?.contractType),
    });
    if (!item) return;
    if (seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  };

  // MEXC Spot exchangeInfo is the complete public symbol master. Keep every
  // returned row so paused/offline products are not silently omitted.
  try {
    const payload = await getJson('https://api.mexc.com/api/v3/exchangeInfo', 20000);
    const rows = Array.isArray(payload?.symbols) ? payload.symbols : [];
    for (const raw of rows) add(raw, 'Spot');
    console.log('[SIRE MEXC] Spot: ' + rows.length);

    // MEXC publishes margin eligibility on each spot symbol. Represent those
    // pairs as separate Margin instruments so Spot and Margin remain distinct.
    for (const raw of rows) {
      if (raw?.isMarginTradingAllowed !== true) continue;
      add(raw, 'Margin', 'Crypto');
    }
    console.log('[SIRE MEXC] Margin: ' + out.filter(x => x.marketType === 'Margin').length);
  } catch (e) {
    console.warn('[SIRE MEXC] Spot/Margin failed:', e);
  }

  // MEXC Futures exposes futureType: 1 = perpetual, 2 = delivery.
  // Use the public contract-detail master and retain both contract classes.
  try {
    const payload = await getJsonAny([
      'https://api.mexc.com/api/v1/contract/detail',
      'https://www.mexc.co/api/v1/contract/detail',
      'https://api.mexc.com/api/v1/contract/detail/country',
    ], 20000);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    for (const raw of rows) {
      const marketType = Number(raw?.futureType) === 2 ? 'Futures' : 'Perpetuals';
      add(raw, marketType, 'Crypto');
    }
    console.log('[SIRE MEXC] Futures contracts: ' + rows.length);
  } catch (e) {
    console.warn('[SIRE MEXC] Futures failed:', e);
  }

  console.log('[SIRE MEXC] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(x => x.marketType === 'Spot').length,
    margin: out.filter(x => x.marketType === 'Margin').length,
    perpetuals: out.filter(x => x.marketType === 'Perpetuals').length,
    futures: out.filter(x => x.marketType === 'Futures').length,
  }));
  return out;
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

async function bitstamp(): Promise<UnifiedInstrument[]> {
  const out:UnifiedInstrument[]=[]; const seen=new Set<string>();
  try{const p=await getJson('https://www.bitstamp.net/api/v2/trading-pairs-info/',15000);const rows=Array.isArray(p)?p:[];for(const r of rows){const symbol=String(r?.name||r?.url_symbol||'').toUpperCase();const item=cryptoItem('BITSTAMP','Spot','Crypto',{...r,symbol,baseAsset:r?.base_decimals!=null?String(r?.base_currency||'').toUpperCase():String(symbol).slice(0,3),quoteAsset:String(r?.counter_currency||'').toUpperCase(),status:r?.trading?'online':'offline'});if(item&&!seen.has(item.id)){seen.add(item.id);out.push(item);}}}catch(e){console.warn('[SIRE BITSTAMP] pairs failed:',e);}
  console.log('[SIRE BITSTAMP] COMPLETE',JSON.stringify({total:out.length,spot:out.length}));
  return out;
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

async function bittrex(): Promise<UnifiedInstrument[]> {
  console.warn('[SIRE BITTREX] Trading is unavailable; no live instruments are published.');
  return [];
}

async function xt(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

  const add = (raw: any, marketType: string, marketKind: string) => {
    const symbol = String(raw?.symbol || raw?.pair || '').trim().toLowerCase();
    if (!symbol) return;
    const base = String(raw?.baseCurrency || raw?.baseCoin || '').trim().toUpperCase() || undefined;
    const quote = String(raw?.quoteCurrency || raw?.quoteCoin || '').trim().toUpperCase() || undefined;
    const normalizedSymbol = symbol.replace(/_/g, '');
    const key = marketKind + ':' + symbol;
    if (seen.has(key)) return;

    const item = cryptoItem('XT', marketType, 'Crypto', {
      ...raw,
      symbol: normalizedSymbol,
      baseAsset: base,
      quoteAsset: quote,
      fullName: raw?.enName || raw?.name || raw?.symbol || normalizedSymbol,
      status: raw?.state || (raw?.tradingEnabled === false || raw?.tradeSwitch === false ? 'offline' : 'online'),
      contractType: raw?.contractType || raw?.productType,
      settleCoin: raw?.settleCoin || (String(raw?.underlyingType || '').toUpperCase() === 'COIN_BASED' ? base : quote),
      deliveryTime: raw?.deliveryDate,
    });
    if (!item) return;
    item.id = 'XT:' + marketKind + ':' + symbol;
    item.providerLabel = 'XT';
    item.marketType = marketType;
    item.category = 'Crypto';
    item.instrumentType = marketKind;
    item.contractType = String(raw?.contractType || raw?.productType || '').trim() || undefined;
    item.settlement = String(raw?.settleCoin || (String(raw?.underlyingType || '').toUpperCase() === 'COIN_BASED' ? base : quote) || '').trim() || undefined;
    item.expiry = raw?.deliveryDate || undefined;
    (item as any).underlyingType = raw?.underlyingType;
    (item as any).contractSize = raw?.contractSize;
    seen.add(key);
    out.push(item);
  };

  // XT spot market master.
  try {
    const response = await getJson('https://sapi.xt.com/v4/public/symbol', 20000);
    const rows = Array.isArray(response?.result?.symbols) ? response.result.symbols : [];
    for (const raw of rows) add(raw, 'Spot', 'SPOT');
    console.log('[SIRE XT] Spot: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE XT] Spot failed:', error);
  }

  // XT USDT-M contracts: perpetuals and delivery futures.
  try {
    const response = await getJson('https://fapi.xt.com/future/market/v1/public/symbol/list', 20000);
    const rows = Array.isArray(response?.result) ? response.result : [];
    for (const raw of rows) {
      const productType = String(raw?.productType || '').toLowerCase();
      add(raw, productType === 'perpetual' ? 'Perpetuals' : 'Futures', 'USDT-M');
    }
    console.log('[SIRE XT] USDT-M: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE XT] USDT-M failed:', error);
  }

  // XT COIN-M contracts: keep this independent from USDT-M.
  try {
    const response = await getJson('https://dapi.xt.com/future/market/v1/public/symbol/list', 20000);
    const rows = Array.isArray(response?.result) ? response.result : [];
    for (const raw of rows) {
      const productType = String(raw?.productType || '').toLowerCase();
      add(raw, productType === 'perpetual' ? 'Perpetuals' : 'Futures', 'COIN-M');
    }
    console.log('[SIRE XT] COIN-M: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE XT] COIN-M failed:', error);
  }

  console.log('[SIRE XT] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(x => x.marketType === 'Spot').length,
    perpetuals: out.filter(x => x.marketType === 'Perpetuals').length,
    futures: out.filter(x => x.marketType === 'Futures').length,
  }));
  return out;
}

async function deepcoin(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

  const add = (raw: any, requestedType: 'Spot' | 'Perpetuals') => {
    const instType = String(raw?.instType || '').toUpperCase();
    const instId = String(raw?.instId || '').trim();
    if (!instId || (instType !== 'SPOT' && instType !== 'SWAP')) return;

    const marketType = requestedType;
    const base = String(raw?.baseCcy || '').trim().toUpperCase() || undefined;
    const quote = String(raw?.quoteCcy || '').trim().toUpperCase() || undefined;
    const key = marketType + ':' + instId;
    if (seen.has(key)) return;

    const item = cryptoItem('DEEPCOIN', marketType, 'Crypto', {
      ...raw,
      symbol: instId,
      baseAsset: base,
      quoteAsset: quote,
      fullName: instId,
      status: raw?.state || 'online',
      contractType: instType === 'SWAP' ? 'perpetual' : undefined,
      settleCoin: instType === 'SWAP' ? (quote === 'USD' ? base : quote) : undefined,
    });
    if (!item) return;
    item.id = 'DEEPCOIN:' + marketType + ':' + instId;
    item.providerLabel = 'DeepCoin';
    item.marketType = marketType;
    item.category = 'Crypto';
    item.instrumentType = instType;
    item.contractType = instType === 'SWAP' ? 'perpetual' : undefined;
    item.settlement = instType === 'SWAP' ? (quote === 'USD' ? base : quote) : undefined;
    item.supportsMargin = instType === 'SPOT' && Number(raw?.lever || 1) > 1;
    (item as any).maxLeverage = raw?.lever;
    (item as any).contractSize = raw?.ctVal;
    seen.add(key);
    out.push(item);
  };

  for (const instType of ['SPOT', 'SWAP'] as const) {
    try {
      const response = await getJson('https://api.deepcoin.com/deepcoin/market/instruments?instType=' + instType, 20000);
      const rows = Array.isArray(response?.data) ? response.data : [];
      for (const raw of rows) add(raw, instType === 'SPOT' ? 'Spot' : 'Perpetuals');
      console.log('[SIRE DEEPCOIN] ' + instType + ': ' + rows.length);
    } catch (error) {
      console.warn('[SIRE DEEPCOIN] ' + instType + ' failed:', error);
    }
  }

  console.log('[SIRE DEEPCOIN] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(x => x.marketType === 'Spot').length,
    perpetuals: out.filter(x => x.marketType === 'Perpetuals').length,
  }));
  return out;
}


async function toobit(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();
  const add = (raw: any, marketType: string, symbolOverride?: string) => {
    const symbol = String(symbolOverride || raw?.symbol || raw?.symbolId || raw?.contractName || '').trim();
    if (!symbol) return;
    const base = String(raw?.baseAsset || raw?.baseCoin || raw?.baseCurrency || raw?.base || '').trim();
    const quote = String(raw?.quoteAsset || raw?.quoteCoin || raw?.quoteCurrency || raw?.quote || '').trim();
    const rawCategories = Array.isArray(raw?.categories) ? raw.categories.join(' ') : String(raw?.category || '');
    const lower = rawCategories.toLowerCase();
    const category = lower.includes('forex') ? 'Forex' : lower.includes('stock') ? 'Stocks' : lower.includes('commodity') ? 'Commodities' : 'Crypto';
    const item = cryptoItem('TOOBIT', marketType, category, {
      ...raw,
      symbol,
      baseAsset: base,
      quoteAsset: quote,
      fullName: raw?.displayName || raw?.display_name || symbol,
      status: raw?.status || raw?.symbolStatus || raw?.state || 'online',
      contractType: raw?.contractType || raw?.contract_type || (marketType === 'Perpetuals' ? 'perpetual' : undefined),
      settleCoin: raw?.settleCoin || raw?.settleCurrency || raw?.settleAsset || quote,
      deliveryTime: raw?.deliveryTime || raw?.expireTime || raw?.expiryTime || undefined,
    });
    if (!item || seen.has(item.id)) return;
    item.providerLabel = 'Toobit';
    item.marketType = marketType;
    item.category = category;
    item.instrumentType = marketType;
    seen.add(item.id);
    out.push(item);
  };

  try {
    const response = await getJson('https://api.toobit.com/api/v1/exchangeInfo', 20000);
    const symbols = Array.isArray(response?.symbols) ? response.symbols : [];
    for (const raw of symbols) add(raw, 'Spot');
    const contracts = Array.isArray(response?.contracts) ? response.contracts : [];
    for (const raw of contracts) {
      const contractType = String(raw?.contractType || raw?.type || '').toUpperCase();
      const symbol = String(raw?.symbol || raw?.symbolId || '').trim();
      const marketType = contractType.includes('PERPETUAL') || /SWAP|PERP/i.test(symbol) ? 'Perpetuals' : 'Futures';
      add(raw, marketType, symbol);
    }
    console.log('[SIRE TOOBIT] exchangeInfo', JSON.stringify({ spot: symbols.length, contracts: contracts.length }));
  } catch (error) {
    console.warn('[SIRE TOOBIT] exchangeInfo failed:', error);
  }

  console.log('[SIRE TOOBIT] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(x => x.marketType === 'Spot').length,
    perpetuals: out.filter(x => x.marketType === 'Perpetuals').length,
    futures: out.filter(x => x.marketType === 'Futures').length,
  }));
  return out;
}

async function weex(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();
  const add = (raw: any, marketType: string, providerSymbol?: string) => {
    const symbol = String(providerSymbol || raw?.symbol || raw?.symbolName || '').trim();
    if (!symbol) return;
    const base = String(raw?.baseCoin || raw?.baseAsset || raw?.baseCurrency || raw?.base || '').trim();
    const quote = String(raw?.quoteCoin || raw?.quoteAsset || raw?.quoteCurrency || raw?.quote || '').trim();
    const item = cryptoItem('WEEX', marketType, 'Crypto', {
      ...raw,
      symbol,
      baseAsset: base,
      quoteAsset: quote,
      fullName: raw?.displayName || raw?.display_name || symbol,
      status: raw?.status || raw?.state || 'online',
      contractType: raw?.contractType || raw?.contract_type || (marketType === 'Perpetuals' ? 'perpetual' : undefined),
      settleCoin: raw?.settleCoin || raw?.settleCurrency || raw?.marginCoin || quote,
      deliveryTime: raw?.expireTime || raw?.deliveryTime || undefined,
    });
    if (!item || seen.has(item.id)) return;
    item.providerLabel = 'WEEX';
    item.marketType = marketType;
    item.category = 'Crypto';
    item.instrumentType = marketType;
    seen.add(item.id);
    out.push(item);
  };

  try {
    const response = await getJson('https://api-spot.weex.com/api/v3/exchangeInfo', 20000);
    const rows = Array.isArray(response?.symbols) ? response.symbols : [];
    for (const raw of rows) add(raw, 'Spot');
    console.log('[SIRE WEEX] Spot: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE WEEX] Spot failed:', error);
  }

  try {
    const response = await getJson('https://api-contract.weex.com/capi/v3/market/exchangeInfo', 20000);
    const rows = Array.isArray(response?.symbols) ? response.symbols : [];
    for (const raw of rows) {
      const contractType = String(raw?.contractType || raw?.type || '').toUpperCase();
      add(raw, contractType.includes('PERPETUAL') || !contractType ? 'Perpetuals' : 'Futures');
    }
    console.log('[SIRE WEEX] Futures: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE WEEX] Futures failed:', error);
  }

  console.log('[SIRE WEEX] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(x => x.marketType === 'Spot').length,
    perpetuals: out.filter(x => x.marketType === 'Perpetuals').length,
    futures: out.filter(x => x.marketType === 'Futures').length,
  }));
  return out;
}

async function bitunix(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();
  const add = (raw: any, marketType: string) => {
    const symbol = String(raw?.symbol || raw?.symbolName || raw?.instId || '').trim();
    if (!symbol) return;
    const base = String(raw?.base || raw?.baseCoin || raw?.baseAsset || '').trim();
    const quote = String(raw?.quote || raw?.quoteCoin || raw?.quoteAsset || '').trim();
    const item = cryptoItem('BITUNIX', marketType, 'Crypto', {
      ...raw,
      symbol,
      baseAsset: base,
      quoteAsset: quote,
      fullName: raw?.displayName || symbol,
      status: raw?.symbolStatus || raw?.status || raw?.state || 'online',
      contractType: marketType === 'Perpetuals' ? 'perpetual' : undefined,
      settleCoin: raw?.settleCoin || raw?.settlementCoin || quote,
      deliveryTime: raw?.delistTime || raw?.expireTime || undefined,
    });
    if (!item || seen.has(item.id)) return;
    item.providerLabel = 'Bitunix';
    item.marketType = marketType;
    item.category = 'Crypto';
    item.instrumentType = marketType;
    seen.add(item.id);
    out.push(item);
  };

  try {
    const rows = await getJsonAny([
      'https://api.bitunix.com/api/v1/spot/market/trading_pairs',
      'https://api.bitunix.com/api/v1/spot/market/symbols',
      'https://api.bitunix.com/api/v1/spot/market/instruments',
    ], 15000);
    const data = Array.isArray(rows?.data) ? rows.data : Array.isArray(rows) ? rows : [];
    for (const raw of data) add(raw, 'Spot');
    console.log('[SIRE BITUNIX] Spot: ' + data.length);
  } catch (error) {
    console.warn('[SIRE BITUNIX] Spot discovery failed:', error);
  }

  try {
    const response = await getJson('https://fapi.bitunix.com/api/v1/futures/market/trading_pairs', 15000);
    const rows = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
    for (const raw of rows) add(raw, 'Perpetuals');
    console.log('[SIRE BITUNIX] Futures: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE BITUNIX] Futures failed:', error);
  }

  console.log('[SIRE BITUNIX] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(x => x.marketType === 'Spot').length,
    perpetuals: out.filter(x => x.marketType === 'Perpetuals').length,
  }));
  return out;
}

async function blofin(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();
  const add = (raw: any, marketType: string) => {
    const symbol = String(raw?.instId || raw?.symbol || '').trim();
    if (!symbol) return;
    const base = String(raw?.baseCurrency || raw?.baseCoin || raw?.baseAsset || '').trim();
    const quote = String(raw?.quoteCurrency || raw?.quoteCoin || raw?.quoteAsset || '').trim();
    const item = cryptoItem('BLOFIN', marketType, 'Crypto', {
      ...raw,
      symbol,
      baseAsset: base,
      quoteAsset: quote,
      fullName: symbol,
      status: raw?.state || raw?.status || 'online',
      contractType: raw?.contractType || (marketType === 'Perpetuals' ? 'perpetual' : undefined),
      settleCoin: raw?.settleCurrency || raw?.settleCoin || quote,
      deliveryTime: raw?.expireTime || raw?.offTime || undefined,
    });
    if (!item || seen.has(item.id)) return;
    item.providerLabel = 'BloFin';
    item.marketType = marketType;
    item.category = 'Crypto';
    item.instrumentType = marketType;
    seen.add(item.id);
    out.push(item);
  };

  try {
    const response = await getJson('https://openapi.blofin.com/api/v1/spot/market/instruments?instType=SPOT', 20000);
    const rows = Array.isArray(response?.data) ? response.data : [];
    for (const raw of rows) if (String(raw?.state || '').toLowerCase() === 'live' || !raw?.state) add(raw, 'Spot');
    console.log('[SIRE BLOFIN] Spot: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE BLOFIN] Spot failed:', error);
  }

  try {
    const response = await getJson('https://openapi.blofin.com/api/v1/market/instruments', 20000);
    const rows = Array.isArray(response?.data) ? response.data : [];
    for (const raw of rows) if (String(raw?.state || '').toLowerCase() === 'live' || !raw?.state) add(raw, 'Perpetuals');
    console.log('[SIRE BLOFIN] Perpetuals: ' + rows.length);
  } catch (error) {
    console.warn('[SIRE BLOFIN] Perpetuals failed:', error);
  }

  console.log('[SIRE BLOFIN] COMPLETE', JSON.stringify({
    total: out.length,
    spot: out.filter(x => x.marketType === 'Spot').length,
    perpetuals: out.filter(x => x.marketType === 'Perpetuals').length,
  }));
  return out;
}


async function coincatch(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = []; const seen = new Set<string>();
  const add = (raw: any, marketType: string) => {
    const symbol = String(raw?.symbol || raw?.symbolName || raw?.symbolDisplayName || '').trim(); if (!symbol) return;
    const base = String(raw?.baseCoin || raw?.baseAsset || '').trim().toUpperCase();
    const quote = String(raw?.quoteCoin || raw?.quoteAsset || '').trim().toUpperCase();
    const item = cryptoItem('COINCATCH', marketType, 'Crypto', {...raw, symbol, baseAsset:base, quoteAsset:quote, fullName:raw?.symbolDisplayName || raw?.symbolName || symbol, status:raw?.status || raw?.symbolStatus || 'online', contractType:raw?.symbolType || (marketType==='Perpetuals'?'perpetual':undefined), settleCoin:raw?.supportMarginCoins?.[0] || raw?.marginCoin || quote});
    if (!item || seen.has(item.id)) return; item.providerLabel='CoinCatch'; item.marketType=marketType; item.instrumentType=marketType; seen.add(item.id); out.push(item);
  };
  try { const r=await getJson('https://api.coincatch.com/api/spot/v1/public/products',20000); const rows=Array.isArray(r?.data)?r.data:[]; for(const raw of rows)add(raw,'Spot'); console.log('[SIRE COINCATCH] Spot:',rows.length); } catch(e){console.warn('[SIRE COINCATCH] Spot failed:',e);}
  for(const productType of ['umcbl','dmcbl','cmcbl']) {
    try { const r=await getJson('https://api.coincatch.com/api/mix/v1/market/contracts?productType='+productType,20000); const rows=Array.isArray(r?.data)?r.data:[]; for(const raw of rows)add(raw,String(raw?.symbolType||'').toLowerCase()==='delivery'?'Futures':'Perpetuals'); console.log('[SIRE COINCATCH]',productType,rows.length); } catch(e){console.warn('[SIRE COINCATCH]',productType,'failed:',e);}
  }
  console.log('[SIRE COINCATCH] COMPLETE',JSON.stringify({total:out.length,spot:out.filter(x=>x.marketType==='Spot').length,perpetuals:out.filter(x=>x.marketType==='Perpetuals').length,futures:out.filter(x=>x.marketType==='Futures').length})); return out;
}

async function zoomex(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = []; const seen = new Set<string>();
  const add=(raw:any,marketType:string)=>{
    const symbol=String(raw?.symbol||raw?.symbolName||'').trim(); if(!symbol)return;
    const base=String(raw?.baseCoin||raw?.baseCurrency||'').trim().toUpperCase(); const quote=String(raw?.quoteCoin||raw?.quoteCurrency||'').trim().toUpperCase();
    const item=cryptoItem('ZOOMEX',marketType,'Crypto',{...raw,symbol,baseAsset:base,quoteAsset:quote,fullName:raw?.displayName||raw?.symbolName||symbol,status:raw?.status||'online',contractType:raw?.contractType||(marketType==='Perpetuals'?'perpetual':undefined),settleCoin:raw?.settleCoin||raw?.settleCurrency||quote});
    if(!item||seen.has(item.id))return; item.providerLabel='Zoomex'; item.marketType=marketType; item.instrumentType=marketType; seen.add(item.id); out.push(item);
  };
  for(const [category,marketType] of [['spot','Spot'],['linear','Perpetuals'],['inverse','Perpetuals']] as const){
    try { const r=await getJsonAny(['https://openapi.zoomex.com/cloud/trade/v3/market/instruments-info?category='+category,'https://openapi.zoomex.com/v5/market/instruments-info?category='+category],20000); const rows=Array.isArray(r?.result?.list)?r.result.list:Array.isArray(r?.data)?r.data:[]; for(const raw of rows){const s=String(raw?.status||'').toUpperCase(); if(s&&!['TRADING','ONLINE','1'].includes(s))continue; add(raw,marketType);} console.log('[SIRE ZOOMEX]',category,rows.length); } catch(e){console.warn('[SIRE ZOOMEX]',category,'failed:',e);}
  }
  console.log('[SIRE ZOOMEX] COMPLETE',JSON.stringify({total:out.length,spot:out.filter(x=>x.marketType==='Spot').length,perpetuals:out.filter(x=>x.marketType==='Perpetuals').length})); return out;
}

async function btcc(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

  const add = (raw: any, marketType: string, category = 'Crypto') => {
    const symbol = String(
      raw?.symbol || raw?.symbolName || raw?.instId || raw?.instrumentId ||
      raw?.productId || raw?.contract || raw?.market || raw?.code || ''
    ).trim();
    if (!symbol) return;

    const normalizedType = String(raw?.marketType || raw?.productType || raw?.type || raw?.product || '').toLowerCase();
    const normalizedCategory = String(raw?.category || raw?.assetClass || raw?.assetType || category).trim();

    let resolvedType = marketType;
    let resolvedCategory = normalizedCategory || category;
    if (/tradfi|forex|stock|equity|metal|commodity|index|oil/i.test(resolvedCategory + ' ' + normalizedType)) {
      resolvedCategory = /forex/i.test(resolvedCategory + ' ' + normalizedType) ? 'Forex'
        : /stock|equity/i.test(resolvedCategory + ' ' + normalizedType) ? 'Stocks'
        : /metal|commodity|oil/i.test(resolvedCategory + ' ' + normalizedType) ? 'Commodities'
        : 'Indices';
      resolvedType = 'TradFi';
    } else if (/spot/i.test(resolvedCategory + ' ' + normalizedType)) {
      resolvedType = 'Spot';
      resolvedCategory = 'Crypto';
    } else if (/coin.?m/i.test(resolvedCategory + ' ' + normalizedType)) {
      resolvedType = 'Coin-M Perpetuals';
      resolvedCategory = 'Crypto';
    } else if (/usdc.?m/i.test(resolvedCategory + ' ' + normalizedType)) {
      resolvedType = 'USDC-M Perpetuals';
      resolvedCategory = 'Crypto';
    } else if (/usdt.?m|perpetual|future|swap/i.test(resolvedCategory + ' ' + normalizedType)) {
      resolvedType = 'USDT-M Perpetuals';
      resolvedCategory = 'Crypto';
    }

    const base = String(raw?.baseCoin || raw?.baseAsset || raw?.base_currency || raw?.base || '').trim().toUpperCase();
    const quote = String(raw?.quoteCoin || raw?.quoteAsset || raw?.quote_currency || raw?.quote || '').trim().toUpperCase();
    const item = cryptoItem('BTCC', resolvedType, resolvedCategory, {
      ...raw,
      symbol,
      baseAsset: base || symbol.replace(/[\\/_-]/g, '').replace(/USDT|USDC|USD$/i, ''),
      quoteAsset: quote || (/USDC/i.test(symbol) ? 'USDC' : /USDT/i.test(symbol) ? 'USDT' : 'USD'),
      fullName: raw?.displayName || raw?.name || raw?.title || symbol,
      status: raw?.status || raw?.state || 'online',
      contractType: raw?.contractType || raw?.contract_type || (/perpetual/i.test(resolvedType) ? 'perpetual' : undefined),
      settleCoin: raw?.settleCoin || raw?.settlement || raw?.settleCurrency || quote || 'USDT',
    });
    if (!item) return;
    const key = item.id;
    if (seen.has(key)) return;
    seen.add(key);
    item.providerLabel = 'BTCC';
    item.marketType = resolvedType;
    item.instrumentType = resolvedType;
    out.push(item);
  };

  // BTCC suspended its public Futures API in February 2026. The web terminal
  // remains operational, so use the live market page as the public catalogue
  // source instead of retired pro-data/api endpoints.
  const pages = [
    'https://www.btcc.com/en-US/markets',
    'https://www.btcc.com/en-US/markets?type=usdt',
    'https://www.btcc.com/en-US/markets?type=usdc',
    'https://www.btcc.com/en-US/markets?type=coin',
    'https://www.btcc.com/en-US/markets?type=tradfi',
  ];

  const collect = (value: any, context = '') => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry, context);
      return;
    }
    if (typeof value !== 'object') return;

    const typeContext = [
      context,
      value?.marketType, value?.productType, value?.product,
      value?.category, value?.assetClass, value?.assetType,
      value?.tab, value?.name, value?.title
    ].filter(Boolean).join(' ');

    const symbol = value?.symbol || value?.symbolName || value?.instId ||
      value?.instrumentId || value?.productId || value?.contract ||
      value?.market || value?.code;
    if (symbol) {
      const text = String(symbol);
      if (/^[A-Za-z0-9._/-]{2,40}$/.test(text) &&
          (/[A-Za-z]/.test(text)) &&
          !/^(all|product|price|markets|favorites)$/i.test(text)) {
        add(value, /tradfi|forex|stock|equity|metal|commodity|index|oil/i.test(typeContext)
          ? 'TradFi'
          : /spot/i.test(typeContext) ? 'Spot'
          : /coin.?m/i.test(typeContext) ? 'Coin-M Perpetuals'
          : /usdc.?m/i.test(typeContext) ? 'USDC-M Perpetuals'
          : 'USDT-M Perpetuals',
          /forex/i.test(typeContext) ? 'Forex'
          : /stock|equity/i.test(typeContext) ? 'Stocks'
          : /metal|commodity|oil/i.test(typeContext) ? 'Commodities'
          : /index/i.test(typeContext) ? 'Indices'
          : 'Crypto');
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'children' || key === 'props' || key === 'data' || key === 'state' ||
          key === 'markets' || key === 'products' || key === 'instruments' ||
          key === 'symbols' || key === 'items' || key === 'list' || key === 'rows') {
        collect(child, typeContext);
      } else if (child && typeof child === 'object') {
        collect(child, typeContext);
      }
    }
  };

  for (const url of pages) {
    try {
      const html = await getText(url, 20000);
      let parsed = false;

      // Next.js/React data blobs, if present.
      const scriptPattern = /<script[^>]*>([\\s\\S]*?)<\/script>/gi;
      let match: RegExpExecArray | null;
      while ((match = scriptPattern.exec(html))) {
        const body = match[1].trim();
        if (!body || body.length < 2 || body.length > 8_000_000) continue;
        if (!(body.startsWith('{') || body.startsWith('['))) continue;
        try {
          collect(JSON.parse(body), url);
          parsed = true;
        } catch {
          // Ignore unrelated JavaScript; the raw HTML fallback below still runs.
        }
      }

      // Raw HTML fallback for server-rendered market rows.
      const symbolPattern = /(?:symbol|symbolName|instId|instrumentId|productId|contract|code)["'\\s:=]+["']([A-Za-z0-9._/-]{2,40})["']/gi;
      while ((match = symbolPattern.exec(html))) {
        const symbol = match[1];
        if (/^(all|product|price|markets|favorites)$/i.test(symbol)) continue;
        add({ symbol }, /tradfi|forex|stock|equity|metal|commodity|index|oil/i.test(url)
          ? 'TradFi' : /spot/i.test(url) ? 'Spot' : 'USDT-M Perpetuals',
          /tradfi|forex|stock|equity|metal|commodity|index|oil/i.test(url) ? 'TradFi' : 'Crypto');
      }

      console.log('[SIRE BTCC] web market page', url, JSON.stringify({ bytes: html.length, parsed, total: out.length }));
    } catch (error) {
      console.warn('[SIRE BTCC] web market page failed:', url, error);
    }
  }

  // BTCC's current web catalogue explicitly exposes these TradFi products.
  // Keep them as a verified fallback only when the web payload omits them.
  const tradfiFallback = [
    ['XAUUSD','Commodities'], ['XAGUSD','Commodities'], ['XPTUSD','Commodities'],
    ['XPDUSD','Commodities'], ['XALUSD','Commodities'], ['UKOIL','Commodities'],
    ['USOIL','Commodities'], ['DJ30','Indices'], ['TECH100','Indices'],
    ['SP500','Indices'], ['GER30','Indices'], ['UK100','Indices'],
    ['GBPUSD','Forex'], ['EURUSD','Forex'], ['AUDUSD','Forex'], ['NZDUSD','Forex'],
    ['META','Stocks'], ['TSLA','Stocks'], ['MSFT','Stocks'], ['GOOG','Stocks'],
    ['AAPL','Stocks'], ['AMD','Stocks'], ['AMZN','Stocks'], ['NVIDIA','Stocks'],
    ['ORCL','Stocks'], ['NFLX','Stocks'], ['INTEL','Stocks'],
  ] as const;
  for (const [symbol, category] of tradfiFallback) {
    if (!out.some(item => item.symbol === symbol && item.marketType === 'TradFi')) {
      add({ symbol, name: symbol }, 'TradFi', category);
    }
  }

  console.log('[SIRE BTCC] COMPLETE', JSON.stringify({
    total: out.length,
    usdtm: out.filter(item => item.marketType === 'USDT-M Perpetuals').length,
    usdcm: out.filter(item => item.marketType === 'USDC-M Perpetuals').length,
    coinm: out.filter(item => item.marketType === 'Coin-M Perpetuals').length,
    spot: out.filter(item => item.marketType === 'Spot').length,
    tradfi: out.filter(item => item.marketType === 'TradFi').length,
  }));
  return out;
}

async function digifinex(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[]=[]; const seen=new Set<string>();
  const add=(raw:any,marketType:string)=>{
    const symbol=String(raw?.symbol||raw?.market||raw?.instrument_id||'').trim(); if(!symbol)return;
    const base=String(raw?.base_asset||raw?.baseCurrency||raw?.baseCoin||'').trim().toUpperCase(); const quote=String(raw?.quote_asset||raw?.quoteCurrency||raw?.quoteCoin||'').trim().toUpperCase();
    const item=cryptoItem('DIGIFINEX',marketType,'Crypto',{...raw,symbol,baseAsset:base,quoteAsset:quote,fullName:raw?.symbol_name||raw?.instrument_name||symbol,status:raw?.status||raw?.state||'online',contractType:raw?.contract_type||(marketType==='Perpetuals'?'perpetual':undefined),settleCoin:raw?.clear_currency||raw?.settleCurrency||quote,deliveryTime:raw?.delivery_time||raw?.deliveryTime});
    if(!item||seen.has(item.id))return; item.providerLabel='DigiFinex'; item.marketType=marketType; item.instrumentType=marketType; seen.add(item.id); out.push(item);
  };
  try { const r=await getJson('https://openapi.digifinex.com/v3/spot/symbols',20000); const rows=Array.isArray(r?.symbol_list)?r.symbol_list:[]; for(const raw of rows)add(raw,'Spot'); console.log('[SIRE DIGIFINEX] Spot:',rows.length); } catch(e){console.warn('[SIRE DIGIFINEX] Spot failed:',e);}
  try { const r=await getJson('https://openapi.digifinex.com/swap/v2/public/instruments',20000); const rows=Array.isArray(r?.data)?r.data:[]; for(const raw of rows)add(raw,String(raw?.contract_type||'').toUpperCase()==='PERPETUAL'?'Perpetuals':'Futures'); console.log('[SIRE DIGIFINEX] Swap:',rows.length); } catch(e){console.warn('[SIRE DIGIFINEX] Swap failed:',e);}
  console.log('[SIRE DIGIFINEX] COMPLETE',JSON.stringify({total:out.length,spot:out.filter(x=>x.marketType==='Spot').length,perpetuals:out.filter(x=>x.marketType==='Perpetuals').length,futures:out.filter(x=>x.marketType==='Futures').length})); return out;
}



async function coindcx(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();
  const add = (r: any, type: string) => {
    const symbol = String(r?.pair || r?.symbol || r?.instrument || '').trim();
    if (!symbol) return;
    const p = symbol.replace(/^B-/, '').split('_');
    const base = String(r?.base_currency_short_name || r?.base_currency || r?.position_currency_short_name || p[0] || '').toUpperCase();
    const quote = String(r?.quote_currency_short_name || r?.quote_currency || r?.settle_currency_short_name || p[1] || '').toUpperCase();
    const x = cryptoItem('COINDCX', type, 'Crypto', {
      ...r, symbol, baseAsset: base, quoteAsset: quote,
      fullName: r?.display_name || symbol, status: r?.status || 'active',
      contractType: r?.kind || (type === 'Perpetuals' ? 'perpetual' : undefined),
      settleCoin: r?.settle_currency_short_name || quote
    });
    if (!x || seen.has(x.id)) return;
    x.providerLabel = 'CoinDCX'; seen.add(x.id); out.push(x);
  };
  try {
    const r = await getJson('https://api.coindcx.com/exchange/v1/markets', 20000);
    (Array.isArray(r) ? r : []).forEach(x => add(x, 'Spot'));
  } catch (e) { console.warn('[SIRE COINDCX] Spot failed:', e); }
  for (const m of ['USDT', 'INR']) {
    try {
      const r = await getJson('https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=' + m, 20000);
      const rows = Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [];
      rows.forEach(x => add(x, 'Perpetuals'));
    } catch (e) { console.warn('[SIRE COINDCX] Futures ' + m + ' failed:', e); }
  }
  return out;
}

async function bithumb(): Promise<UnifiedInstrument[]> {
  try {
    const markets = await getJson('https://api.bithumb.com/v1/market/all?isDetails=true');
    const rows = Array.isArray(markets) ? markets : [];
    const symbols = rows.map((m: any) => String(m?.market || '')).filter(Boolean);
    const tickers = symbols.length
      ? await getJson('https://api.bithumb.com/v1/ticker?markets=' + encodeURIComponent(symbols.join(',')))
      : [];
    const prices = new Map((Array.isArray(tickers) ? tickers : []).map((t: any) => [String(t?.market || ''), t]));
    return rows.map((m: any) => {
      const symbol = String(m?.market || '');
      const [quote, base] = symbol.split('-');
      return cryptoItem('BITHUMB', 'Spot', 'Crypto', {
        symbol, baseAsset: base, quoteAsset: quote,
        fullName: m?.english_name || m?.korean_name || base,
        status: m?.market_warning === 'CAUTION' ? 'caution' : 'online'
      }, prices.get(symbol));
    }).filter(Boolean) as UnifiedInstrument[];
  } catch (e) {
    console.warn('[SIRE BITHUMB] failed', e);
    return [];
  }
}

async function upbit(): Promise<UnifiedInstrument[]> {
  try {
    const base = 'https://sg-api.upbit.com';
    const markets = await getJson(base + '/v1/market/all?isDetails=true');
    const rows = Array.isArray(markets) ? markets : [];
    const symbols = rows.map((m: any) => String(m?.market || '')).filter(Boolean);
    const tickers = symbols.length
      ? await getJson(base + '/v1/ticker?markets=' + encodeURIComponent(symbols.join(',')))
      : [];
    const prices = new Map((Array.isArray(tickers) ? tickers : []).map((t: any) => [String(t?.market || ''), t]));
    return rows.map((m: any) => {
      const symbol = String(m?.market || '');
      const [quote, baseAsset] = symbol.split('-');
      return cryptoItem('UPBIT', 'Spot', 'Crypto', {
        symbol, baseAsset, quoteAsset: quote,
        fullName: m?.english_name || baseAsset,
        status: m?.market_warning === 'CAUTION' ? 'caution' : 'online'
      }, prices.get(symbol));
    }).filter(Boolean) as UnifiedInstrument[];
  } catch (e) {
    console.warn('[SIRE UPBIT] failed', e);
    return [];
  }
}

async function pionex(): Promise<UnifiedInstrument[]> {
  try {
    const [spot, perp] = await Promise.all([
      getJson('https://api.pionex.com/api/v1/market/tickers?type=SPOT'),
      getJson('https://api.pionex.com/api/v1/market/tickers?type=PERP')
    ]);
    const out: UnifiedInstrument[] = [];
    for (const [payload, type] of [[spot, 'Spot'], [perp, 'Perpetuals']] as const) {
      const rows = Array.isArray(payload?.data?.tickers) ? payload.data.tickers : [];
      for (const t of rows) {
        const symbol = String(t?.symbol || '');
        if (!symbol) continue;
        const clean = symbol.replace(/_PERP$/, '');
        const [base, quote] = clean.split('_');
        const item = cryptoItem('PIONEX', type, 'Crypto', {
          symbol, baseAsset: base, quoteAsset: quote, fullName: clean, status: 'online'
        }, { last: t?.close });
        if (item) out.push(item);
      }
    }
    return out;
  } catch (e) {
    console.warn('[SIRE PIONEX] failed', e);
    return [];
  }
}

async function polymarket(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  let offset = 0;
  const limit = 500;
  for (let page = 0; page < 100; page++) {
    try {
      const rows = await getJson('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=' + limit + '&offset=' + offset, 20000);
      if (!Array.isArray(rows) || !rows.length) break;
      for (const m of rows) {
        const marketId = String(m?.id || m?.conditionId || '').trim();
        const question = String(m?.question || m?.title || '').trim();
        if (!marketId || !question) continue;
        let outcomes: any[] = [];
        let tokenIds: any[] = [];
        try { outcomes = Array.isArray(m?.outcomes) ? m.outcomes : JSON.parse(String(m?.outcomes || '[]')); } catch {}
        try { tokenIds = Array.isArray(m?.clobTokenIds) ? m.clobTokenIds : JSON.parse(String(m?.clobTokenIds || '[]')); } catch {}
        let prices: any[] = [];
        try { prices = Array.isArray(m?.outcomePrices) ? m.outcomePrices : JSON.parse(String(m?.outcomePrices || '[]')); } catch {}
        for (let i = 0; i < Math.max(outcomes.length, tokenIds.length); i++) {
          const outcome = String(outcomes[i] || (i === 0 ? 'YES' : i === 1 ? 'NO' : 'Outcome ' + (i + 1))).trim();
          const tokenId = String(tokenIds[i] || '').trim();
          if (!tokenId) continue;
          const price = Number(prices[i]);
          const symbol = 'PM-' + marketId + '-' + outcome.replace(/[^A-Za-z0-9]+/g, '-').toUpperCase();
          const item = cryptoItem('POLYMARKET', 'Prediction', 'Prediction Markets', {
            symbol, baseAsset: outcome, quoteAsset: 'USD',
            fullName: question + ' · ' + outcome,
            status: m?.active && !m?.closed ? 'online' : 'closed'
          }, Number.isFinite(price) ? { last: price } : undefined);
          if (item) {
            item.id = 'POLYMARKET:Prediction:' + tokenId;
            item.providerLabel = 'Polymarket';
            item.instrumentType = 'Prediction';
            item.contractType = 'binary';
            item.settlement = 'USD';
            out.push(item);
          }
        }
      }
      offset += rows.length;
      if (rows.length < limit) break;
    } catch (e) {
      console.warn('[SIRE POLYMARKET] page failed:', e);
      break;
    }
  }
  console.log('[SIRE POLYMARKET] COMPLETE', JSON.stringify({ total: out.length }));
  return out;
}

async function kalshi(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  // Kalshi's public market-data API is available without authentication.
  // Prefer the current production market-data host, with the legacy host as a fallback.
  const hosts = [
    'https://api.elections.kalshi.com/trade-api/v2/markets',
    'https://external-api.kalshi.com/trade-api/v2/markets'
  ];
  for (const baseUrl of hosts) {
    let cursor = '';
    let hostWorked = false;
    for (let page = 0; page < 100; page++) {
      try {
        const query = cursor ? '&cursor=' + encodeURIComponent(cursor) : '';
        const response = await getJson(baseUrl + '?limit=100&status=open' + query, 20000);
        const rows = Array.isArray(response?.markets) ? response.markets : [];
        if (rows.length) hostWorked = true;
        for (const m of rows) {
          const ticker = String(m?.ticker || '').trim();
          const title = String(m?.title || m?.subtitle || ticker).trim();
          if (!ticker) continue;

          // Current Kalshi responses expose *_dollars fields; older responses may
          // expose integer-cent fields. Support both without double-converting.
          const toUsd = (raw: unknown, dollarRaw: unknown): number | undefined => {
            const dollars = Number(dollarRaw);
            if (Number.isFinite(dollars)) return dollars;
            const cents = Number(raw);
            return Number.isFinite(cents) ? cents / 100 : undefined;
          };
          const lastUsd = toUsd(m?.last_price, m?.last_price_dollars);
          const yesUsd = toUsd(m?.yes_bid, m?.yes_bid_dollars) ?? toUsd(m?.yes_ask, m?.yes_ask_dollars) ?? lastUsd;
          const noUsd = toUsd(m?.no_bid, m?.no_bid_dollars) ?? toUsd(m?.no_ask, m?.no_ask_dollars)
            ?? (lastUsd !== undefined ? 1 - lastUsd : undefined);
          const outcomes = [['YES', yesUsd], ['NO', noUsd]] as const;

          for (const [side, price] of outcomes) {
            const item = cryptoItem('KALSHI', 'Prediction', 'Prediction Markets', {
              symbol: ticker + '-' + side, baseAsset: side, quoteAsset: 'USD',
              fullName: title + ' · ' + side,
              status: m?.status || 'open'
            }, price !== undefined ? { last: price } : undefined);
            if (item) {
              item.id = 'KALSHI:Prediction:' + ticker + ':' + side;
              item.providerLabel = 'Kalshi';
              item.instrumentType = 'Prediction';
              item.contractType = 'binary';
              item.settlement = 'USD';
              out.push(item);
            }
          }
        }
        cursor = String(response?.cursor || '').trim();
        if (!cursor || !rows.length) break;
      } catch (e) {
        console.warn('[SIRE KALSHI] page failed on ' + baseUrl + ':', e);
        break;
      }
    }
    if (hostWorked && out.length) break;
  }
  console.log('[SIRE KALSHI] COMPLETE', JSON.stringify({ total: out.length }));
  return out;
}

async function opinion(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const apiKey = String(process.env.OPINION_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[SIRE OPINION] OPINION_API_KEY is not configured; public Opinion OpenAPI requires an API key.');
    return out;
  }
  for (let page = 1; page <= 500; page++) {
    try {
      const url = 'https://openapi.opinion.trade/openapi/market?page=' + page + '&limit=20&status=activated&marketType=2&sortBy=3';
      const response = await getJsonWithHeaders(url, { apikey: apiKey }, 20000);
      const rows = Array.isArray(response?.result?.list) ? response.result.list : [];
      for (const m of rows) {
        const marketId = String(m?.marketId || '').trim();
        const title = String(m?.marketTitle || m?.title || '').trim();
        if (!marketId || !title) continue;
        const children = Array.isArray(m?.childMarkets) && m.childMarkets.length ? m.childMarkets : [m];
        for (const child of children) {
          const childId = String(child?.marketId || marketId);
          for (const [side, token] of [['YES', child?.yesTokenId], ['NO', child?.noTokenId]] as const) {
            const tokenId = String(token || '').trim();
            if (!tokenId) continue;
            const item = cryptoItem('OPINION', 'Prediction', 'Prediction Markets', {
              symbol: 'OP-' + childId + '-' + side, baseAsset: side, quoteAsset: 'USD',
              fullName: String(child?.marketTitle || title) + ' · ' + side,
              status: child?.statusEnum || m?.statusEnum || 'Activated'
            });
            if (item) {
              item.id = 'OPINION:Prediction:' + tokenId;
              item.providerLabel = 'Opinion';
              item.instrumentType = 'Prediction';
              item.contractType = Number(m?.marketType) === 1 ? 'categorical' : 'binary';
              item.settlement = String(child?.quoteToken || m?.quoteToken || 'USD');
              out.push(item);
            }
          }
        }
      }
      if (rows.length < 20) break;
    } catch (e) {
      console.warn('[SIRE OPINION] page failed:', e);
      break;
    }
  }
  console.log('[SIRE OPINION] COMPLETE', JSON.stringify({ total: out.length }));
  return out;
}

async function uniswap(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const apiKey = String(process.env.THE_GRAPH_API_KEY || process.env.UNISWAP_GRAPH_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[SIRE UNISWAP] THE_GRAPH_API_KEY/UNISWAP_GRAPH_API_KEY is not configured; Uniswap official subgraph gateway requires a Graph API key.');
    return out;
  }

  const deployments = [
    {
      version: 'V2',
      id: 'A3Np3RQbaBA6oKJgiwDJeo5T3zrYfGHPWFYayMwtNDum',
      entity: 'pairs',
      query: `query($skip:Int!){pairs(first:1000,skip:$skip,orderBy:reserveUSD,orderDirection:desc){id token0{id symbol name decimals} token1{id symbol name decimals} reserve0 reserve1 reserveUSD token0Price token1Price volumeUSD txCount}}`
    },
    {
      version: 'V3',
      id: '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV',
      entity: 'pools',
      query: `query($skip:Int!){pools(first:1000,skip:$skip,orderBy:totalValueLockedUSD,orderDirection:desc){id token0{id symbol name decimals} token1{id symbol name decimals} feeTier liquidity sqrtPrice tick token0Price token1Price totalValueLockedUSD volumeUSD txCount}}`
    },
    {
      version: 'V4',
      id: 'DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G',
      entity: 'pools',
      query: `query($skip:Int!){pools(first:1000,skip:$skip,orderBy:totalValueLockedUSD,orderDirection:desc){id token0{id symbol name decimals} token1{id symbol name decimals} feeTier tickSpacing hooks liquidity sqrtPrice tick token0Price token1Price totalValueLockedUSD volumeUSD txCount}}`
    }
  ];

  const graphPost = async (endpoint:string, query:string, variables:Record<string,unknown>) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(endpoint, {
        method:'POST',
        signal:controller.signal,
        headers:{
          'Content-Type':'application/json',
          'Accept':'application/json',
          'Authorization':'Bearer ' + apiKey,
          'User-Agent':'SIRE-market-catalog/1.0'
        },
        body:JSON.stringify({query,variables})
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      if (Array.isArray(payload?.errors) && payload.errors.length) throw new Error(String(payload.errors[0]?.message || 'GraphQL error'));
      return payload?.data || {};
    } finally { clearTimeout(timer); }
  };

  for (const deployment of deployments) {
    const endpoint = 'https://gateway.thegraph.com/api/' + encodeURIComponent(apiKey) + '/subgraphs/id/' + deployment.id;
    let total = 0;
    for (let skip = 0; skip < 100000; skip += 1000) {
      try {
        const data = await graphPost(endpoint, deployment.query, {skip});
        const rows = Array.isArray(data?.[deployment.entity]) ? data[deployment.entity] : [];
        for (const raw of rows) {
          const token0 = raw?.token0 || {};
          const token1 = raw?.token1 || {};
          const symbol0 = String(token0?.symbol || token0?.id || '').trim();
          const symbol1 = String(token1?.symbol || token1?.id || '').trim();
          if (!raw?.id || !symbol0 || !symbol1) continue;
          const symbol = symbol0 + '/' + symbol1;
          const marketType = 'AMM ' + deployment.version + ' Pool';
          const item = cryptoItem('UNISWAP', marketType, 'Crypto', {
            symbol: String(raw.id),
            baseAsset: symbol0,
            quoteAsset: symbol1,
            fullName: 'Uniswap ' + deployment.version + ' · ' + symbol,
            status: 'online',
            contractType: deployment.version === 'V2' ? 'constant-product' : 'concentrated-liquidity',
            settleCoin: 'N/A'
          }, {last: Number(raw?.token0Price) || undefined});
          if (!item) continue;
          item.id = 'UNISWAP:' + deployment.version + ':' + String(raw.id);
          item.providerLabel = 'Uniswap';
          item.marketType = marketType;
          item.category = 'Crypto';
          item.instrumentType = 'AMM Pool';
          item.contractType = deployment.version === 'V2' ? 'constant-product' : 'concentrated-liquidity';
          item.settlement = 'On-chain';
          item.price = Number.isFinite(Number(raw?.token0Price)) ? Number(raw.token0Price) : undefined;
          item.exchangeOpen = 1;
          out.push(item);
          total += 1;
        }
        if (rows.length < 1000) break;
      } catch (error) {
        console.warn('[SIRE UNISWAP] ' + deployment.version + ' page failed at skip=' + skip + ':', error);
        break;
      }
    }
    console.log('[SIRE UNISWAP] ' + deployment.version + ': ' + total);
  }

  const seen = new Set<string>();
  const unique = out.filter(item => !seen.has(item.id) && (seen.add(item.id), true));
  console.log('[SIRE UNISWAP] COMPLETE', JSON.stringify({total:unique.length, v2:unique.filter(x=>x.id.startsWith('UNISWAP:V2:')).length, v3:unique.filter(x=>x.id.startsWith('UNISWAP:V3:')).length, v4:unique.filter(x=>x.id.startsWith('UNISWAP:V4:')).length}));
  return unique;
}

async function coinstore(): Promise<UnifiedInstrument[]> {
 const out:UnifiedInstrument[]=[]; const seen=new Set<string>();
 const add=(r:any)=>{const symbol=String(r?.symbolCode||r?.symbol||r?.symbolName||'').trim(); if(!symbol)return; const base=String(r?.tradeCurrencyCode||r?.baseCurrencyCode||r?.baseCoin||'').toUpperCase(); const quote=String(r?.quoteCurrencyCode||r?.quoteCoin||'').toUpperCase(); const x=cryptoItem('COINSTORE','Spot','Crypto',{...r,symbol,baseAsset:base,quoteAsset:quote,fullName:r?.displayName||symbol,status:r?.openTrade===false?'offline':'online'}); if(!x||seen.has(x.id))return; x.providerLabel='Coinstore';seen.add(x.id);out.push(x);};
 try{const r=await postJson('https://api.coinstore.com/api/v2/public/config/spot/symbols',{},20000);const rows=Array.isArray(r?.data)?r.data:Array.isArray(r)?r:[];rows.forEach(add);console.log('[SIRE COINSTORE] Spot:',rows.length);}catch(e){console.warn('[SIRE COINSTORE] Spot failed:',e)}
 return out;
}
async function probit(): Promise<UnifiedInstrument[]> {
 const out:UnifiedInstrument[]=[];const seen=new Set<string>();
 const add=(r:any)=>{const symbol=String(r?.id||r?.market_id||r?.symbol||r?.market||'').trim();if(!symbol||!symbol.includes('-'))return;const p=symbol.split('-');const base=String(r?.base_currency_id||p[0]||'').toUpperCase(),quote=String(r?.quote_currency_id||p[1]||'').toUpperCase();const x=cryptoItem('PROBIT','Spot','Crypto',{...r,symbol,baseAsset:base,quoteAsset:quote,fullName:r?.display_name||symbol,status:r?.status||r?.state||'online'});if(!x||seen.has(x.id))return;x.providerLabel='ProBit Global';seen.add(x.id);out.push(x);};
 for(const body of [{market_ids:[]},{}]){try{const r=await postJson('https://api.probit.com/api/exchange/v1/market',body,20000);const rows=Array.isArray(r?.data)?r.data:Array.isArray(r)?r:[];rows.forEach(add);if(out.length)break;}catch(e){console.warn('[SIRE PROBIT] market failed:',e)}}
 return out;
}
async function poloniex(): Promise<UnifiedInstrument[]> {
  try {
    const markets = await getJson('https://api.poloniex.com/markets');
    const rows = Array.isArray(markets) ? markets : Array.isArray(markets?.data) ? markets.data : [];
    const tickers = await getJson('https://api.poloniex.com/markets/ticker24h');
    const tickerRows = Array.isArray(tickers) ? tickers : Array.isArray(tickers?.data) ? tickers.data : [];
    const prices = new Map(tickerRows.map((t: any) => [String(t?.symbol || t?.symbolName || ''), t]));
    return rows.map((m: any) => {
      const symbol = String(m?.symbol || m?.symbolName || m?.displayName || '');
      if (!symbol) return null;
      const parts = symbol.includes('_') ? symbol.split('_') : symbol.split('/');
      const base = parts[0] || '';
      const quote = parts[1] || '';
      const t = prices.get(symbol);
      return cryptoItem('POLONIEX', 'Spot', 'Crypto', {
        symbol, baseAsset: base, quoteAsset: quote, fullName: m?.baseCurrencyName || base, status: m?.state || 'online'
      }, t);
    }).filter(Boolean) as UnifiedInstrument[];
  } catch (e) {
    console.warn('[SIRE POLONIEX] failed', e);
    return [];
  }
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
    case 'XT': return xt();
    case 'DEEPCOIN': return deepcoin();
    case 'TOOBIT': return toobit();
    case 'WEEX': return weex();
    case 'BITUNIX': return bitunix();
    case 'BLOFIN': return blofin();
    case 'BITMART': return bitmart();
    case 'BLANK': return blank();
    case 'PHEMEX': return phemex();
    case 'LBANK': return lbank();
    case 'MEXC': return mexc();
    case 'COINCATCH': return coincatch();
    case 'ZOOMEX': return zoomex();
    case 'BTCC': return btcc();
    case 'DIGIFINEX': return digifinex();
    case 'BITHUMB': return bithumb();
    case 'UPBIT': return upbit();
    case 'PIONEX': return pionex();
    case 'POLONIEX': return poloniex();
    case 'COINSTORE': return coinstore();
    case 'PROBIT': return probit();
    case 'COINDCX': return coindcx();
    case 'POLYMARKET': return polymarket();
    case 'KALSHI': return kalshi();
    case 'OPINION': return opinion();
    case 'UNISWAP': return uniswap();
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
      ['HTX', htx()],
      ['BITTREX', bittrex()],
      ['XT', xt()],
      ['DEEPCOIN', deepcoin()],
      ['TOOBIT', toobit()],
      ['WEEX', weex()],
      ['BITUNIX', bitunix()],
      ['BLOFIN', blofin()],
      ['LBANK', lbank()],
      ['BITMART', bitmart()],
      ['PHEMEX', phemex()],
      ['COINCATCH', coincatch()],
      ['ZOOMEX', zoomex()],
      ['BTCC', btcc()],
      ['DIGIFINEX', digifinex()],
      ['BITHUMB', bithumb()],
      ['UPBIT', upbit()],
      ['PIONEX', pionex()],
      ['POLONIEX', poloniex()],
      ['COINSTORE', coinstore()],
      ['PROBIT', probit()],
      ['POLONIEX', poloniex()],
      ['COINDCX', coindcx()],
      ['POLYMARKET', polymarket()],
      ['KALSHI', kalshi()],
      ['OPINION', opinion()],
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