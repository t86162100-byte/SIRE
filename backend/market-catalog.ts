export type MarketProvider = 'BINANCE' | 'FXCM' | 'YFINANCE' | 'SP' | 'DERIV' | 'BITGET' | 'BYBIT' | 'OKX' | 'KRAKEN' | 'COINBASE' | 'GATEIO' | 'KUCOIN' | 'GEMINI' | 'BITSO' | 'BITFINEX' | 'BITVAVO' | 'COINEX' | 'LBANK' | 'WOOX' | 'CRYPTOCOM' | 'HTX' | 'BITKUB' | 'UPBIT' | 'PIONEX' | 'POLONIEX' | 'BITHUMB' | 'MEXC' | 'PHEMEX' | 'WHITEBIT' | 'TWELVEDATA' | 'NASDAQTRADER' | 'CME' | 'CBOT' | 'NYMEX' | 'COMEX' | 'NYSEAMERICAN' | 'XETR' | 'HKEX' | 'BSE' | 'TSE' | 'XFRA' | 'EUREX' | 'ASX' | 'TWSE' | 'PSX' | 'IDX' | 'NSE' | 'BITSTAMP' | 'OANDA' | 'TRADINGVIEW' | 'FOREXCOM' | 'INTERACTIVEBROKERS' | 'TRADESTATION' | 'WEBULL' | 'MOOMOO' | 'NINJATRADER' | 'TRADOVATE' | 'AMPFUTURES' | 'TASTYTRADE' | 'TASTYFX' | 'CRYPTOCOMEXCHANGE' | 'COINBASEADVANCED' | 'ALPACA' | 'TRADIERBROKERAGE' | 'TRADEZERO' | 'COBRATRADING' | 'CLEARSTREET' | 'INVESTRADE' | 'PUBLIC' | 'PLUS500US' | 'OPTIMUSFUTURES' | 'EDGECLEAR' | 'IRONBEAM' | 'STONEX' | 'DORMANTRADING' | 'TRADIERFUTURES';

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

async function gateio(): Promise<UnifiedInstrument[]> { const out:UnifiedInstrument[]=[];try{const r=await getJson('https://api.gateio.ws/api/v4/spot/currency_pairs',15000);for(const raw of r||[]){if(String(raw?.trade_status||'').toLowerCase()!=='tradable')continue;const i=cryptoItem('GATEIO','Spot','Crypto',{symbol:raw?.id,baseAsset:raw?.base,quoteAsset:raw?.quote,status:'online'});if(i)out.push(i)}}catch(e){console.warn('[SIRE GATEIO] Spot failed:',e)}for(const settle of ['usdt','usdc','btc','usd'])for(const kind of ['futures','delivery'])try{const r=await getJson('https://api.gateio.ws/api/v4/'+kind+'/'+settle+'/contracts',15000);for(const raw of r||[]){const i=cryptoItem('GATEIO',kind==='futures'?'Perpetuals':'Futures','Crypto',{...raw,symbol:raw?.name,baseAsset:String(raw?.underlying||'').split('_')[0],quoteAsset:settle.toUpperCase()});if(i)out.push(i)}}catch(e){console.warn('[SIRE GATEIO] '+kind+'/'+settle+' failed:',e)}try{const us=await getJson('https://api.gateio.ws/api/v4/options/underlyings',15000);for(const u of us||[]){const underlying=String(u?.name||'');if(!underlying)continue;const r=await getJson('https://api.gateio.ws/api/v4/options/contracts?underlying='+encodeURIComponent(underlying),15000);for(const raw of r||[]){const i=cryptoItem('GATEIO','Options','Crypto',{...raw,symbol:raw?.name,baseAsset:underlying.split('_')[0],quoteAsset:underlying.split('_')[1]||'USDT'});if(i)out.push(i)}}}catch(e){console.warn('[SIRE GATEIO] Options failed:',e)}return out; }

async function kucoin(): Promise<UnifiedInstrument[]> { const out:UnifiedInstrument[]=[];try{const r=await getJson('https://api.kucoin.com/api/v2/symbols',15000);for(const raw of r?.data||[]){if(raw?.enableTrading===false)continue;const i=cryptoItem('KUCOIN','Spot','Crypto',{symbol:raw?.symbol,baseAsset:raw?.baseCurrency,quoteAsset:raw?.quoteCurrency,status:'online'});if(i)out.push(i)}}catch(e){console.warn('[SIRE KUCOIN] Spot failed:',e)}for(const u of ['https://api.kucoin.com/api/v3/margin/symbols','https://api.kucoin.com/api/v1/isolated/symbols'])try{const r=await getJson(u,15000);const rows=Array.isArray(r?.data)?r.data:r?.data?.items||[];for(const raw of rows){if(raw?.enableTrading===false||raw?.tradeEnable===false)continue;const i=cryptoItem('KUCOIN','Margin','Crypto',{symbol:raw?.symbol,baseAsset:raw?.baseCurrency,quoteAsset:raw?.quoteCurrency,status:'online',isMarginEnabled:true});if(i&&!out.some(x=>x.marketType==='Margin'&&x.symbol===i.symbol))out.push(i)}}catch(e){console.warn('[SIRE KUCOIN] Margin failed:',e)}try{const r=await getJson('https://api-futures.kucoin.com/api/v1/contracts/active',15000);for(const raw of r?.data||[]){const i=cryptoItem('KUCOIN',raw?.expireDate?'Futures':'Perpetuals','Crypto',raw);if(i)out.push(i)}}catch(e){console.warn('[SIRE KUCOIN] Futures failed:',e)}return out; }

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
  const out: UnifiedInstrument[]=[];
  try{const r=await getJson('https://api.mexc.com/api/v3/exchangeInfo',15000);for(const raw of r?.symbols||[]){if(String(raw?.status||'').toUpperCase()!=='ENABLED')continue;const i=cryptoItem('MEXC','Spot','Crypto',raw);if(i)out.push(i)}}catch(e){console.warn('[SIRE MEXC] Spot failed:',e)}
  try{const r=await getJson('https://api.mexc.com/api/v1/contract/detail',15000);for(const raw of r?.data||[]){const i=cryptoItem('MEXC','Perpetuals','Crypto',{...raw,symbol:raw?.symbol,baseAsset:raw?.baseCoin,quoteAsset:raw?.quoteCoin,status:'online'});if(i)out.push(i)}}catch(e){console.warn('[SIRE MEXC] Futures failed:',e)}
  return out;
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

async function bitget(): Promise<UnifiedInstrument[]> { const out:UnifiedInstrument[]=[];for(const c of ['SPOT','MARGIN','USDT-FUTURES','COIN-FUTURES','USDC-FUTURES'])try{const r=await getJson('https://api.bitget.com/api/v3/market/instruments?category='+c,15000);for(const raw of r?.data||[]){if(String(raw?.status||'').toLowerCase()!=='online')continue;const t=c==='SPOT'?'Spot':c==='MARGIN'?'Margin':c==='USDT-FUTURES'?(String(raw?.type||'').toLowerCase()==='delivery'?'USDT Futures':'USDT Perpetuals'):c==='COIN-FUTURES'?(String(raw?.type||'').toLowerCase()==='delivery'?'Coin-M Futures':'Coin-M Perpetuals'):(String(raw?.type||'').toLowerCase()==='delivery'?'USDC Futures':'USDC Perpetuals');const i=cryptoItem('BITGET',t,'Crypto',raw);if(i)out.push(i)}}catch(e){console.warn('[SIRE BITGET] '+c+' failed:',e)}return out; }

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

async function cme(): Promise<UnifiedInstrument[]> {
  // CME Group publishes the Product Slate for its Globex universe. The response
  // contains product metadata; field names have changed over time, so parsing
  // deliberately accepts the documented product/name/code variants instead of
  // assuming one JSON shape.
  const exchanges = new Map([
    ['CME','CME'],['CHICAGO MERCANTILE EXCHANGE','CME'],
    ['CBOT','CBOT'],['CBT','CBOT'],['CHICAGO BOARD OF TRADE','CBOT'],
    ['NYMEX','NYMEX'],['NYM','NYMEX'],['NEW YORK MERCANTILE EXCHANGE','NYMEX'],
    ['COMEX','COMEX'],['CMX','COMEX'],['COMMODITY EXCHANGE','COMEX'],
  ]);
  const scalar = (o:any, keys:string[]) => {
    for (const k of keys) {
      const v=o?.[k];
      if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
    }
    return '';
  };
  const normExchange = (v:string) => {
    const s=String(v||'').trim().toUpperCase().replace(/\s+DCM$|\s+EXCHANGE$/,'').trim();
    return exchanges.get(s) || exchanges.get(s.split(/[|,:\-/]/)[0]) || '';
  };
  const category = (v:string) => {
    const s=String(v||'').toLowerCase();
    if (s.includes('option')) return 'Options';
    if (s.includes('future')) return 'Futures';
    if (s.includes('energy')) return 'Energy';
    if (s.includes('metal')) return 'Metals';
    if (s.includes('agric')) return 'Agriculture';
    if (s.includes('equity')) return 'Equities';
    if (s.includes('interest') || s.includes('rate')) return 'Interest Rates';
    if (s.includes('fx') || s.includes('currency')) return 'Forex';
    return 'Derivatives';
  };
  const collectCandidates=(v:any,out:any[]=[]):any[]=>{
    if(!v || typeof v!=='object') return out;
    if(Array.isArray(v)){ for(const x of v) collectCandidates(x,out); return out; }
    const exchange=normExchange(scalar(v,['exch','exchange','exchangeName','exchangeCode','dcm','venue','venueName','market','marketName']));
    const symbol=scalar(v,['globex','globexSymbol','globexCode','prodCode','symbol','productCode','code','ticker','product','productSymbol','id']);
    const name=scalar(v,['productName','name','description','displayName','fullName','title']);
    if(exchange && symbol && name) out.push(v);
    for(const x of Object.values(v)) collectCandidates(x,out);
    return out;
  };
  try {
    const out:UnifiedInstrument[]=[]; const seen=new Set<string>();
    for(const cleared of ['Futures','Options']) {
      for(let page=1; page<=20; page++){
        const url='https://www.cmegroup.com/services/product-slate?sortAsc=false&sortField=vol&pageNumber='+page+'&venues=3&cleared='+cleared;
        const response=await fetch(url,{headers:{'User-Agent':'SIRE-market-catalog/1.0','Accept':'application/json, text/plain, */*'},signal:AbortSignal.timeout(30000)});
        if(!response.ok) throw new Error('Product Slate HTTP '+response.status+' ('+cleared+' page '+page+')');
        const payload=await response.json();
        const rows=collectCandidates(payload);
        if(!rows.length) break;
        let added=0;
        for(const row of rows){
          const exchange=normExchange(scalar(row,['exch','exchange','exchangeName','exchangeCode','dcm','venue','venueName','market','marketName']));
          const symbol=scalar(row,['globex','globexSymbol','globexCode','prodCode','symbol','productCode','code','ticker','product','productSymbol','id']);
          const name=scalar(row,['productName','name','description','displayName','fullName','title']);
          if(!exchange||!symbol||!name) continue;
          const key=exchange+':'+symbol; if(seen.has(key)) continue; seen.add(key);
          const type=scalar(row,['clearedAs','instrumentType','type','productType'])||cleared;
          const item=cryptoItem(exchange as MarketProvider,exchange,category(type),{symbol,fullName:name,status:'online'});
          if(!item) continue;
          item.id=key; item.providerLabel=exchange; item.marketType=exchange; item.category=category(type);
          item.name=name; item.symbol=symbol; item.displaySymbol=symbol; item.status='Active';
          item.instrumentType=type; item.contractType=type; item.logoUrl=providerLogo('CME'); item.providerLogoUrl=providerLogo('CME');
          out.push(item); added++;
        }
        console.log('[SIRE CME GROUP] Product Slate page '+cleared+' '+page+': candidates='+rows.length+' added='+added);
        if(added===0 || rows.length<100) break;
      }
    }
    const counts=['CME','CBOT','NYMEX','COMEX'].map(e=>e+'='+out.filter(i=>i.providerLabel===e).length).join(' ');
    console.log('[SIRE CME GROUP] Product Slate catalogue: '+counts+' total='+out.length);
    if(!out.length) throw new Error('CME Product Slate returned no supported DCM instruments');
    return out;
  } catch(error){ console.warn('[SIRE CME GROUP] failed:',error); return []; }
}
export async function getCmeCatalogueForDiagnostics(): Promise<UnifiedInstrument[]> { return cme(); }

async function nyseAmerican(): Promise<UnifiedInstrument[]> {
  // Official NYSE Listings Directory API used by the NYSE listings page.
  const url='https://www.nyse.com/api/quotes/filter';
  try {
    const out:UnifiedInstrument[]=[]; const seen=new Set<string>();
    for(let page=1; page<=20; page++){
      const response=await fetch(url,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Origin:'https://www.nyse.com',Referer:'https://www.nyse.com/listings_directory/stock','User-Agent':'SIRE-market-catalog/1.0'},body:JSON.stringify({instrumentType:'EQUITY',pageNumber:page,sortColumn:'NORMALIZED_TICKER',sortOrder:'ASC',maxResultsPerPage:5000,filterToken:''}),signal:AbortSignal.timeout(30000)});
      if(!response.ok) throw new Error('NYSE listings HTTP '+response.status);
      const payload=await response.json();
      const rows=Array.isArray(payload)?payload:(Array.isArray(payload?.data?.rows)?payload.data.rows:Array.isArray(payload?.data)?payload.data:[]);
      if(!rows.length) break;
      let added=0;
      for(const raw of rows){
        const exchange=String(raw?.exchange||raw?.exchangeName||raw?.listingExchange||raw?.market||raw?.marketName||raw?.exchangeCode||'').trim();
        const listingUrl=String(raw?.url||'').trim();
        if(!/NYSE\s*AMERICAN|AMEX|NYSE\s*MKT/i.test(exchange) && !/\/XASE(?:[:\/]|$)|\/AMEX(?:[:\/]|$)|NYSE\s*AMERICAN/i.test(listingUrl)) continue;
        const symbol=String(raw?.symbolTicker||raw?.normalizedTicker||raw?.symbol||raw?.ticker||'').trim();
        const name=String(raw?.instrumentName||raw?.securityName||raw?.name||raw?.companyName||symbol).trim();
        if(!symbol||seen.has(symbol)) continue;
        const textType=String(raw?.instrumentType||raw?.securityType||raw?.type||'').toLowerCase();
        const category=/etf|fund|etn|etv/i.test(textType+' '+name)?'Funds':/preferred/i.test(textType+' '+name)?'Preferred':/warrant|right|unit/i.test(textType+' '+name)?'Derivatives':'Stocks';
        const item=cryptoItem('NYSEAMERICAN','NYSE American',category,{symbol,fullName:name,status:'online'});
        if(!item) continue;
        item.id='NYSEAMERICAN:'+symbol; item.symbol=symbol; item.displaySymbol=symbol; item.name=name; item.providerLabel='NYSE American'; item.marketType='NYSE American'; item.category=category; item.status='Active'; item.logoUrl='https://cdn.simpleicons.org/nyse'; item.providerLogoUrl='https://cdn.simpleicons.org/nyse';
        out.push(item); seen.add(symbol); added++;
      }
      console.log('[SIRE NYSE AMERICAN] page '+page+': rows='+rows.length+' added='+added);
      if(rows.length<5000) break;
    }
    console.log('[SIRE NYSE AMERICAN] Total catalogue: '+out.length);
    return out;
  } catch(error){ console.warn('[SIRE NYSE AMERICAN] failed:',error); return []; }
}

export async function getNyseAmericanCatalogueForDiagnostics(): Promise<UnifiedInstrument[]> { return nyseAmerican(); }
async function nasdaqTrader(): Promise<UnifiedInstrument[]> {
  // Nasdaq Trader is the official public symbol-directory/discovery layer for the
  // Nasdaq universe. These are the published directories, not synthetic symbols.
  // The exchange name shown to users is simply "Nasdaq".
  const pipeSources = [
    { file: 'nasdaqlisted.txt', category: 'Stocks', marketType: 'Nasdaq Listed' },
    { file: 'otherlisted.txt', category: 'Stocks', marketType: 'US Other Exchanges' },
    { file: 'bondslist.txt', category: 'Bonds', marketType: 'Nasdaq Bonds' },
    { file: 'options.txt', category: 'Options', marketType: 'Nasdaq Options Market' },
    { file: 'mfundslist.txt', category: 'Funds', marketType: 'Nasdaq Fund Network' },
  ] as const;

  const csvSources = [
    { file: 'pbot.csv', category: 'Futures', marketType: 'PBOT Futures' },
    { file: 'phlxoptions.csv', category: 'Options', marketType: 'Nasdaq PHLX Options' },
  ] as const;

  const splitCsvLine = (line: string): string[] => {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        cells.push(cell.trim());
        cell = '';
      } else cell += ch;
    }
    cells.push(cell.trim());
    return cells;
  };

  const makeItem = (
    symbol: string,
    name: string,
    category: string,
    marketType: string,
    idSuffix: string
  ): UnifiedInstrument | null => {
    symbol = String(symbol || '').trim();
    name = String(name || symbol).trim();
    if (!symbol) return null;
    const item = cryptoItem('NASDAQTRADER', marketType, category, {
      symbol,
      fullName: name,
      status: 'online'
    });
    if (!item) return null;
    item.id = 'NASDAQ:' + marketType + ':' + (idSuffix || symbol);
    item.symbol = symbol;
    item.displaySymbol = symbol;
    item.name = name;
    item.providerLabel = 'Nasdaq';
    item.marketType = marketType;
    item.category = category;
    item.status = 'Active';
    item.logoUrl = providerLogo('nasdaq');
    item.providerLogoUrl = providerLogo('nasdaq');
    return item;
  };

  const parsePipe = async (source: typeof pipeSources[number]): Promise<UnifiedInstrument[]> => {
    const text = await getText('https://www.nasdaqtrader.com/dynamic/SymDir/' + source.file, 12000);
    const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    if (!rows.length) return [];

    const headerIndex = rows.findIndex(row => /(^|\\|)(Symbol|ACT Symbol|Root Symbol|Fund Symbol)(\\||$)/i.test(row));
    if (headerIndex < 0) throw new Error(source.file + ': header row not found');

    const headers = rows[headerIndex].split('|').map(v => v.trim());
    const out: UnifiedInstrument[] = [];
    const seen = new Set<string>();

    for (const line of rows.slice(headerIndex + 1)) {
      if (!line || /^File Creation Time/i.test(line)) continue;
      const values = line.split('|');
      const raw: Record<string, string> = {};
      headers.forEach((header, index) => { raw[header] = String(values[index] ?? '').trim(); });

      let symbol = '';
      let name = '';
      if (source.file === 'options.txt') {
        // NOM publishes option classes here; Root Symbol is the instrument identifier.
        symbol = raw['Root Symbol'] || raw['Underlying Symbol'] || '';
        name = raw['Underlying Issue Name'] || symbol;
      } else if (source.file === 'mfundslist.txt') {
        symbol = raw['Fund Symbol'] || '';
        name = raw['Fund Name'] || symbol;
      } else {
        symbol = raw['Symbol'] || raw['ACT Symbol'] || '';
        name = raw['Security Name'] || raw['Company Name'] || symbol;
      }
      if (!symbol) continue;

      let category = source.category;
      if (source.file === 'nasdaqlisted.txt' || source.file === 'otherlisted.txt') {
        const isEtf = String(raw['ETF'] || '').toUpperCase() === 'Y' ||
          /\\bETF\\b|EXCHANGE[- ]TRADED FUND/i.test(name);
        category = isEtf ? 'Funds' : 'Stocks';
      }

      const exchange = source.file === 'otherlisted.txt'
        ? (raw['Exchange'] || source.marketType)
        : source.marketType;
      const key = source.file + ':' + exchange + ':' + symbol;
      if (seen.has(key)) continue;
      seen.add(key);

      const item = makeItem(symbol, name, category, exchange, key);
      if (item) out.push(item);
    }
    console.log('[SIRE NASDAQ] ' + source.file + ': ' + out.length);
    return out;
  };

  const parseCsv = async (source: typeof csvSources[number]): Promise<UnifiedInstrument[]> => {
    const text = await getText('https://www.nasdaqtrader.com/SymbolDirectory/' + source.file, 12000);
    const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    if (!rows.length) return [];

    const out: UnifiedInstrument[] = [];
    const seen = new Set<string>();
    for (const line of rows) {
      if (/^File Creation Time/i.test(line)) continue;
      const cells = splitCsvLine(line);
      if (!cells.length) continue;

      // Official layouts:
      // PBOT: commodity id, PBOT product symbol, description, last trade date, expiry date.
      // PHLX: company, cycle, option symbol, stock symbol, specialist unit.
      const symbol = source.file === 'pbot.csv'
        ? String(cells[1] || '').trim()
        : String(cells[2] || '').trim();
      const name = source.file === 'pbot.csv'
        ? String(cells[2] || symbol).trim()
        : String(cells[0] || symbol).trim();
      if (!symbol) continue;

      const key = source.file + ':' + symbol;
      if (seen.has(key)) continue;
      seen.add(key);

      const item = makeItem(symbol, name, source.category, source.marketType, key);
      if (item) out.push(item);
    }
    console.log('[SIRE NASDAQ] ' + source.file + ': ' + out.length);
    return out;
  };

  const [pipeResults, csvResults] = await Promise.all([
    Promise.allSettled(pipeSources.map(parsePipe)),
    Promise.allSettled(csvSources.map(parseCsv)),
  ]);

  const out = [
    ...pipeResults.flatMap(r => r.status === 'fulfilled' ? r.value : []),
    ...csvResults.flatMap(r => r.status === 'fulfilled' ? r.value : []),
  ];

  pipeResults.forEach((r, i) => {
    if (r.status === 'rejected') console.warn('[SIRE NASDAQ] ' + pipeSources[i].file + ' failed:', r.reason);
  });
  csvResults.forEach((r, i) => {
    if (r.status === 'rejected') console.warn('[SIRE NASDAQ] ' + csvSources[i].file + ' failed:', r.reason);
  });

  // Defensive final dedupe: one catalogue entry per Nasdaq-published instrument key.
  const unique = out.filter((item, index, arr) =>
    arr.findIndex(other => other.id === item.id) === index
  );
  console.log('[SIRE NASDAQ] Total catalogue: ' + unique.length);
  return unique;
}
async function twse(): Promise<UnifiedInstrument[]> {
  const url = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
  try {
    const rows = await getJson(url, 12000);
    if (!Array.isArray(rows)) throw new Error('TWSE returned no rows');
    const out: UnifiedInstrument[] = [];
    const seen = new Set<string>();
    for (const raw of rows) {
      const code = String(raw?.['公司代號'] || raw?.['公司代碼'] || raw?.['Code'] || '').trim();
      const name = String(raw?.['公司簡稱'] || raw?.['公司名稱'] || raw?.['Company Name'] || '').trim();
      if (!/^\d{4,6}$/.test(code) || !name || seen.has(code)) continue;
      seen.add(code);
      const item = cryptoItem('TWSE', 'TWSE', 'Stocks', { symbol: code, fullName: name, quoteAsset: 'TWD', status: 'online' });
      if (!item) continue;
      item.id = 'TWSE:TWSE:' + code; item.name = name; item.displaySymbol = code; item.marketType = 'TWSE'; item.category = 'Stocks'; item.quote = 'TWD'; item.status = 'Active'; item.logoUrl = providerLogo('TWSE'); item.providerLogoUrl = providerLogo('TWSE'); out.push(item);
    }
    console.log('[SIRE TWSE] company catalogue: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE TWSE] failed:', error); return []; }
}

async function asx(): Promise<UnifiedInstrument[]> {
  const url = 'https://www.asx.com.au/content/dam/asx/issuers/ISIN.xls';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    const xlsx = await import('xlsx');
    const workbook = xlsx.read(bytes, { type: 'buffer' });
    const rows: any[][] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheetRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' }) as any[][];
      rows.push(...sheetRows);
    }
    const out: UnifiedInstrument[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const cells = row.map(v => String(v ?? '').trim());
      const isinIndex = cells.findIndex(v => /^AU[A-Z0-9]{9}[0-9]$/i.test(v));
      if (isinIndex < 0) continue;
      const isin = cells[isinIndex];
      const code = cells.find(v => /^[A-Z0-9]{2,6}$/.test(v) && v !== isin && !/^AU[A-Z0-9]{9}[0-9]$/i.test(v)) || '';
      const name = cells.find(v => /[A-Za-z]/.test(v) && v.length > 2 && v !== code && v !== isin) || code;
      if (!code || seen.has(isin)) continue;
      seen.add(isin);
      const item = cryptoItem('ASX', 'ASX', 'Stocks', { symbol: code, fullName: name, quoteAsset: 'AUD', status: 'online' });
      if (!item) continue;
      item.id = 'ASX:ASX:' + isin;
      item.name = name;
      item.displaySymbol = code;
      item.marketType = 'ASX';
      item.category = 'Stocks';
      item.quote = 'AUD';
      item.status = 'Active';
      item.logoUrl = providerLogo('ASX');
      item.providerLogoUrl = providerLogo('ASX');
      out.push(item);
    }
    console.log('[SIRE ASX] ISIN catalogue: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE ASX] failed:', error); return []; }
}

async function xetra(): Promise<UnifiedInstrument[]> {
  const url = 'https://www.cashmarket.deutsche-boerse.com/resource/blob/1528/684b31b077a5de5d5777352984c7a7df/data/t7-xetr-allTradableInstruments.csv';
  try {
    const text = await getText(url, 12000);
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    if (lines.length < 4) throw new Error('XETR feed returned no instrument rows');
    const headers = lines[2].split(';').map(v => v.trim().replace(/^"|"$/g, ''));
    const out: UnifiedInstrument[] = [];
    const seen = new Set<string>();
    for (const line of lines.slice(3)) {
      const values = line.split(';').map(v => v.trim().replace(/^"|"$/g, ''));
      const raw: Record<string,string> = {};
      headers.forEach((header, index) => { raw[header] = values[index] ?? ''; });
      const status = String(raw['Instrument Status'] || raw['Product Status'] || '').trim();
      if (status && !/^active$/i.test(status)) continue;
      const symbol = String(raw['Mnemonic'] || raw['Instrument'] || raw['ISIN'] || raw['Instrument ID'] || '').trim();
      const name = String(raw['Instrument'] || raw['Mnemonic'] || raw['ISIN'] || symbol).trim();
      const isin = String(raw['ISIN'] || '').trim();
      if (!symbol || !name) continue;
      const type = String(raw['Instrument Type'] || '').toUpperCase();
      const category = /ETF|ETP|ETN|ETC|FUND/i.test(type + ' ' + name)
        ? 'Funds'
        : /BOND|FIXED/i.test(type + ' ' + name)
          ? 'Bonds'
          : /WARRANT|OPTION|RIGHT|CERTIFICATE/i.test(type + ' ' + name)
            ? 'Derivatives'
            : 'Stocks';
      const key = 'XETR:' + (isin || symbol);
      if (seen.has(key)) continue;
      seen.add(key);
      const item = cryptoItem('XETR', 'Xetra', category, { symbol, fullName: name, status: 'online' });
      if (!item) continue;
      item.name = name;
      item.displaySymbol = symbol;
      item.marketType = 'Xetra';
      item.category = category;
      item.base = undefined;
      item.quote = String(raw['Settlement Currency'] || raw['Currency'] || '').trim() || undefined;
      item.status = status || 'Active';
      item.logoUrl = providerLogo('XETR');
      item.providerLogoUrl = providerLogo('XETR');
      if (isin) item.id = 'XETR:Xetra:' + isin;
      out.push(item);
    }
    console.log('[SIRE XETR] Tradable instruments: ' + out.length);
    return out;
  } catch (error) {
    console.warn('[SIRE XETR] failed:', error);
    return [];
  }
}

async function xfra(): Promise<UnifiedInstrument[]> {
  const url = 'https://www.cashmarket.deutsche-boerse.com/resource/blob/2289108/908619b62b8e0962ae4fdd87b7317250/data/t7-xfra-BF-allTradableInstruments.csv';
  try {
    const text = await getText(url, 12000);
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    if (lines.length < 4) throw new Error('XFRA feed returned no instrument rows');
    const headers = lines[2].split(';').map(v => v.trim().replace(/^"|"$/g, ''));
    const out: UnifiedInstrument[] = [];
    const seen = new Set<string>();
    for (const line of lines.slice(3)) {
      const values = line.split(';').map(v => v.trim().replace(/^"|"$/g, ''));
      const raw: Record<string,string> = {};
      headers.forEach((header, index) => { raw[header] = values[index] ?? ''; });
      const status = String(raw['Instrument Status'] || raw['Product Status'] || '').trim();
      if (status && !/^active$/i.test(status)) continue;
      const symbol = String(raw['Mnemonic'] || raw['Instrument'] || raw['ISIN'] || '').trim();
      const name = String(raw['Instrument'] || raw['Mnemonic'] || raw['ISIN'] || symbol).trim();
      const isin = String(raw['ISIN'] || '').trim();
      if (!symbol || !name) continue;
      const type = String(raw['Instrument Type'] || '').toUpperCase();
      const category = /ETF|ETP|ETN|ETC|FUND/i.test(type + ' ' + name)
        ? 'Funds'
        : /BOND|FIXED/i.test(type + ' ' + name)
          ? 'Bonds'
          : /WARRANT|OPTION|RIGHT|CERTIFICATE/i.test(type + ' ' + name)
            ? 'Derivatives'
            : 'Stocks';
      const key = 'XFRA:' + (isin || symbol);
      if (seen.has(key)) continue;
      seen.add(key);
      const item = cryptoItem('XFRA', 'Frankfurt', category, { symbol, fullName: name, status: 'online' });
      if (!item) continue;
      item.name = name; item.displaySymbol = symbol; item.marketType = 'Frankfurt';
      item.category = category; item.quote = String(raw['Settlement Currency'] || raw['Currency'] || '').trim() || undefined;
      item.status = status || 'Active'; item.logoUrl = providerLogo('XFRA'); item.providerLogoUrl = providerLogo('XFRA');
      if (isin) item.id = 'XFRA:Frankfurt:' + isin;
      out.push(item);
    }
    console.log('[SIRE XFRA] Tradable instruments: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE XFRA] failed:', error); return []; }
}

async function eurex(): Promise<UnifiedInstrument[]> {
  const url = 'https://api.developer.deutsche-boerse.com/eurex-prod-graphql/';
  const query = `query { Products { date data { Product } } }`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-DBP-APIKEY': '68cdafd2-c5c1-49be-8558-37244ab4f513' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const payload: any = await response.json();
    const rows = Array.isArray(payload?.data?.Products?.data) ? payload.data.Products.data : [];
    const out: UnifiedInstrument[] = [];
    const seen = new Set<string>();
    for (const raw of rows) {
      const symbol = String(raw?.Product || '').trim();
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      const item = cryptoItem('EUREX', 'Eurex', 'Futures', { symbol, fullName: symbol, status: 'online' });
      if (item) { item.name = symbol; item.displaySymbol = symbol; item.marketType = 'Eurex'; item.category = 'Futures'; item.quote = 'EUR'; item.logoUrl = providerLogo('EUREX'); item.providerLogoUrl = providerLogo('EUREX'); out.push(item); }
    }
    console.log('[SIRE EUREX] Products: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE EUREX] failed:', error); return []; }
}

async function hkex(): Promise<UnifiedInstrument[]> {
  const url = 'https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx';
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'SIRE-market-catalog/1.0' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const buffer = Buffer.from(await response.arrayBuffer());
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
    const headerIndex = rows.findIndex((row: any[]) => row.some(v => String(v).trim() === 'Stock Code'));
    if (headerIndex < 0) throw new Error('HKEX header row not found');
    const headers = rows[headerIndex].map(v => String(v).trim());
    const idx = (names: string[]) => names.map(n => headers.findIndex(h => h.toLowerCase() === n.toLowerCase())).find(i => i >= 0) ?? -1;
    const codeI = idx(['Stock Code','Stock Code (5-digit)']);
    const nameI = idx(['English Name','Name']);
    const isinI = idx(['ISIN']);
    const typeI = idx(['Category','Security Type','Type']);
    const currencyI = idx(['Trading Currency','Currency']);
    const out: UnifiedInstrument[] = [];
    const seen = new Set<string>();
    for (const row of rows.slice(headerIndex + 1)) {
      const symbol = String(row[codeI] ?? '').trim().replace(/^'+/,'');
      const name = String(row[nameI] ?? '').trim();
      if (!symbol || !name || !/^\d{1,5}$/.test(symbol)) continue;
      const code = symbol.padStart(5,'0');
      const isin = String(row[isinI] ?? '').trim();
      const type = String(row[typeI] ?? '').toUpperCase();
      const category = /BOND|DEBT|NOTE/i.test(type) ? 'Bonds' : /ETF|REIT|FUND|UNIT TRUST/i.test(type) ? 'Funds' : 'Stocks';
      const key = 'HKEX:' + (isin || code);
      if (seen.has(key)) continue;
      seen.add(key);
      const item = cryptoItem('HKEX','HKEX',category,{symbol:code,fullName:name,status:'online'});
      if (!item) continue;
      item.id = 'HKEX:HKEX:' + (isin || code);
      item.symbol = code; item.displaySymbol = code; item.name = name; item.marketType = 'HKEX';
      item.category = category; item.quote = String(row[currencyI] ?? '').trim() || undefined;
      item.status = 'Active'; item.logoUrl = providerLogo('HKEX'); item.providerLogoUrl = providerLogo('HKEX');
      out.push(item);
    }
    console.log('[SIRE HKEX] Securities: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE HKEX] failed:', error); return []; }
}

async function bse(): Promise<UnifiedInstrument[]> {
  const base = 'https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w';
  const groups = ['A','B','E','F','FC','GC','I','IF','IP','M','MS','MT','P','R','T','TS','W','X','XD','XT','Y','Z','ZP','ZY'];
  const segments = ['Equity','Preference Shares','Debentures and Bonds','Commercial Papers','MF','Equity - Institutional Series'];
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();
  const jobs = segments.flatMap(segment => groups.map(group => ({ segment, group })));
  const results = await Promise.allSettled(jobs.map(async ({ segment, group }) => {
      try {
        const url = new URL(base);
        url.searchParams.set('scripcode','');
        url.searchParams.set('Group',group);
        url.searchParams.set('industry','');
        url.searchParams.set('segment',segment);
        url.searchParams.set('status','Active');
        const response = await fetch(url, {
          headers: {
            Accept: 'application/json, text/plain, */*',
            'User-Agent': 'SIRE-market-catalog/1.0',
            Referer: 'https://www.bseindia.com/'
          },
          signal: AbortSignal.timeout(9000)
        });
        if (!response.ok) return;
        const data = await response.json();
        const rows = Array.isArray(data) ? data : (data?.Table || data?.data || []);
        if (!Array.isArray(rows)) return;
        for (const row of rows) {
          const code = String(row.scripcode ?? row.Scripcode ?? row.ScripCode ?? '').trim();
          const symbol = String(row.scrip_id ?? row.Scrip_Id ?? row.Symbol ?? row.symbol ?? '').trim();
          const name = String(row.scrip_name ?? row.Scrip_Name ?? row.CompanyName ?? row.companyName ?? '').trim();
          const isin = String(row.ISIN ?? row.isin ?? '').trim();
          if (!code || !name || (!symbol && !isin)) continue;
          const key = 'BSE:' + (isin || code);
          if (seen.has(key)) continue;
          seen.add(key);
          const category = /BOND|DEBENTURE|COMMERCIAL PAPER/i.test(segment + ' ' + name) ? 'Bonds' : /MF|MUTUAL/i.test(segment + ' ' + name) ? 'Funds' : 'Stocks';
          const item = cryptoItem('BSE','BSE India',category,{symbol:symbol || code,fullName:name,status:'online'});
          if (!item) continue;
          item.id = 'BSE:BSE:' + (isin || code);
          item.symbol = symbol || code;
          item.displaySymbol = symbol || code;
          item.name = name;
          item.marketType = 'BSE';
          item.category = category;
          item.quote = String(row.Currency ?? row.currency ?? 'INR').trim() || 'INR';
          item.status = 'Active';
          item.logoUrl = providerLogo('BSE');
          item.providerLogoUrl = providerLogo('BSE');
          out.push(item);
        }
      } catch {}
  }));
  void results;
  console.log('[SIRE BSE] Securities: ' + out.length);
  return out;
}

async function psx(): Promise<UnifiedInstrument[]> {
  const url = 'https://dps.psx.com.pk/eligible-scrips';
  try {
    const html = await getText(url, 12000);
    const out: UnifiedInstrument[] = [];
    const seen = new Set<string>();
    const rowRe = /<tr[^>]*>\s*<td[^>]*>\s*([^<]+)\s*<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html))) {
      const symbol = m[1].replace(/\s+/g,' ').trim(), name = m[2].replace(/\s+/g,' ').trim();
      if (!symbol || !name || /^symbol$/i.test(symbol) || seen.has(symbol)) continue;
      seen.add(symbol);
      const item = cryptoItem('PSX','Pakistan Stock Exchange','Stocks',{symbol,fullName:name,quoteAsset:'PKR',status:'online'});
      if (!item) continue;
      item.id='PSX:PSX:'+symbol; item.displaySymbol=symbol; item.name=name; item.marketType='PSX'; item.category='Stocks'; item.quote='PKR'; item.status='Active'; item.logoUrl=providerLogo('PSX'); item.providerLogoUrl=providerLogo('PSX'); out.push(item);
    }
    console.log('[SIRE PSX] eligible scrips: '+out.length);
    return out;
  } catch (error) { console.warn('[SIRE PSX] failed:', error); return []; }
}

async function idx(): Promise<UnifiedInstrument[]> {
  const url = 'https://idx.co.id/en/listed-companies/company-profiles/';
  try {
    const html = await getText(url, 12000);
    const out: UnifiedInstrument[] = [];
    const seen = new Set<string>();
    const rowRe = /<tr[^>]*>\s*<td[^>]*>\s*\d+\s*<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html))) {
      const symbol=m[1].replace(/\s+/g,' ').trim(), name=m[2].replace(/\s+/g,' ').trim();
      if (!/^[A-Z0-9.-]{2,8}$/.test(symbol) || !name || seen.has(symbol)) continue;
      seen.add(symbol);
      const item=cryptoItem('IDX','Indonesia Stock Exchange','Stocks',{symbol,fullName:name,quoteAsset:'IDR',status:'online'});
      if (!item) continue;
      item.id='IDX:IDX:'+symbol; item.displaySymbol=symbol; item.name=name; item.marketType='IDX'; item.category='Stocks'; item.quote='IDR'; item.status='Active'; item.logoUrl=providerLogo('IDX'); item.providerLogoUrl=providerLogo('IDX'); out.push(item);
    }
    console.log('[SIRE IDX] listed companies: '+out.length);
    return out;
  } catch (error) { console.warn('[SIRE IDX] failed:', error); return []; }
}

async function tse(): Promise<UnifiedInstrument[]> {
  const url = 'https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls';
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'SIRE-market-catalog/1.0' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const buffer = Buffer.from(await response.arrayBuffer());
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
    const headerIndex = rows.findIndex(row => row.some(v => /コード|Code/i.test(String(v))) && row.some(v => /銘柄名|会社名|Name/i.test(String(v))));
    if (headerIndex < 0) throw new Error('JPX TSE header row not found');
    const headers = rows[headerIndex].map(v => String(v).trim());
    const findCol = (patterns: RegExp[]) => headers.findIndex(h => patterns.some(p => p.test(h)));
    const codeI = findCol([/コード/i, /code/i]);
    const nameI = findCol([/銘柄名/i, /会社名/i, /name/i]);
    const marketI = findCol([/市場・商品区分/i, /市場区分/i, /market/i]);
    const isinI = findCol([/ISIN/i]);
    const out: UnifiedInstrument[] = [];
    const seen = new Set<string>();
    for (const row of rows.slice(headerIndex + 1)) {
      const code = String(row[codeI] ?? '').trim();
      const name = String(row[nameI] ?? '').trim();
      if (!/^\d{4}[A-Z]?$/.test(code) || !name) continue;
      const isin = isinI >= 0 ? String(row[isinI] ?? '').trim() : '';
      const market = marketI >= 0 ? String(row[marketI] ?? '').trim() : '';
      const key = 'TSE:' + (isin || code);
      if (seen.has(key)) continue;
      seen.add(key);
      const category = /ETF|ETN|REIT|投資法人|インフラ/i.test(market + ' ' + name) ? 'Funds' : 'Stocks';
      const item = cryptoItem('TSE','Tokyo Stock Exchange',category,{symbol:code,fullName:name,status:'online'});
      if (!item) continue;
      item.id='TSE:TSE:'+(isin || code); item.symbol=code; item.displaySymbol=code; item.name=name;
      item.marketType=market || 'TSE'; item.category=category; item.quote='JPY'; item.status='Active';
      item.logoUrl=providerLogo('TSE'); item.providerLogoUrl=providerLogo('TSE');
      out.push(item);
    }
    console.log('[SIRE TSE] Listed issues: ' + out.length);
    return out;
  } catch (error) { console.warn('[SIRE TSE] failed:', error); return []; }
}

async function fxcm(): Promise<UnifiedInstrument[]> {
  const token=String(process.env.FXCM_ACCESS_TOKEN||'').trim();
  if(!token){console.warn('[SIRE FXCM] FXCM_ACCESS_TOKEN is not configured');return [];}
  const host=String(process.env.FXCM_ENV||'demo').toLowerCase()==='real'?'https://api.fxcm.com':'https://api-demo.fxcm.com';
  try{
    const r=await fetch(host+'/trading/get_instruments',{headers:{Accept:'application/json',Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const p=await r.json(); const rows=Array.isArray(p?.data?.instrument)?p.data.instrument:[];
    const out:UnifiedInstrument[]=[];
    for(const raw of rows){const symbol=String(raw?.symbol||'').trim();if(!symbol||raw?.visible===false)continue;const u=symbol.toUpperCase();
      const category=u.includes('/')?((u.startsWith('XAU/')||u.startsWith('XAG/'))?'Commodities':'Forex'):/^(US30|SPX500|NAS100|US2000|UK100|GER30|ESP35|FRA40|HKG33|JPN225|AUS200|EUSTX50|CHN50|VOLX)$/.test(u)?'Indices':/OIL|NGAS|COPPER|SOYF|WHEAT|CORNF|BUND/.test(u)?'Commodities':'CFDs';
      out.push({id:'FXCM:'+symbol,provider:'FXCM',providerLabel:'FXCM',marketType:category,category,symbol,displaySymbol:symbol,name:symbol,quote:u.includes('/')?u.split('/')[1]:'USD',status:'Active',logoUrl:'https://cdn.simpleicons.org/fxcm',providerLogoUrl:'https://cdn.simpleicons.org/fxcm',instrumentType:category});
    } console.log('[SIRE FXCM] Instruments: '+out.length);return out;
  }catch(e){console.warn('[SIRE FXCM] failed:',e);return [];}
}

async function yfinance(): Promise<UnifiedInstrument[]> {
  try {
    const { stdout } = await execFileAsync(
      process.env.YFINANCE_PYTHON || '.venv/bin/python',
      ['backend/yfinance_catalog.py'],
      { timeout: 90000, maxBuffer: 8 * 1024 * 1024 }
    );
    const rows = JSON.parse(stdout || '[]');
    const out: UnifiedInstrument[] = [];
    for (const raw of Array.isArray(rows) ? rows : []) {
      const symbol = String(raw?.symbol || '').trim();
      if (!symbol) continue;
      const category = String(raw?.category || 'Stocks');
      const item = cryptoItem('YFINANCE', String(raw?.marketType || 'Yahoo Finance'), category, {
        symbol,
        baseAsset: raw?.base,
        quoteAsset: raw?.quote,
        fullName: raw?.name || symbol,
        status: 'online'
      });
      if (!item) continue;
      item.id = 'YFINANCE:' + symbol;
      item.providerLabel = 'Yahoo Finance (yfinance)';
      item.marketType = String(raw?.marketType || 'Yahoo Finance');
      item.category = category;
      item.name = String(raw?.name || symbol);
      item.displaySymbol = symbol;
      item.symbol = symbol;
      item.quote = String(raw?.quote || '').trim() || undefined;
      item.status = 'Active';
      item.logoUrl = 'https://cdn.simpleicons.org/yahoo';
      item.providerLogoUrl = 'https://cdn.simpleicons.org/yahoo';
      item.instrumentType = String(raw?.type || category);
      out.push(item);
    }
    console.log('[SIRE YFINANCE] Catalogue: ' + out.length);
    return out;
  } catch (error) {
    console.warn('[SIRE YFINANCE] failed:', error);
    return [];
  }
}

async function sp(): Promise<UnifiedInstrument[]> {
  // S&P DJI publishes the S&P 500 as an index, not as an exchange. Keep this
  // provider separate from Nasdaq/NYSE/CME so the catalogue preserves the
  // distinction between an index and the venues where its constituents trade.
  const items: UnifiedInstrument[] = [];
  const add = (symbol: string, name: string, category = 'Indices') => {
    items.push({
      id: 'SP:' + symbol,
      provider: 'SP',
      providerLabel: 'S&P',
      marketType: 'S&P',
      category,
      symbol,
      displaySymbol: symbol,
      name,
      quote: 'USD',
      status: 'Active',
      logoUrl: 'https://cdn.simpleicons.org/spglobal',
      providerLogoUrl: 'https://cdn.simpleicons.org/spglobal',
      instrumentType: 'Index',
    });
  };
  // S&P DJI's public S&P 500 page identifies SPX as the price-return ticker.
  add('SPX', 'S&P 500');
  add('SPTR500N', 'S&P 500 Net Total Return');
  add('SPXT', 'S&P 500 Total Return');
  console.log('[SIRE S&P] Public index catalogue: ' + items.length);
  return items;
}

async function bybit(): Promise<UnifiedInstrument[]> {
  const out: UnifiedInstrument[] = [];
  const seen = new Set<string>();

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

      const response = await getJsonAny([
        'https://api.bybit.com/v5/market/instruments-info?' + query.toString(),
        'https://api.bytick.com/v5/market/instruments-info?' + query.toString(),
      ], 15000);

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
    const response = await getJsonAny([
      'https://api.bybit.com/v5/market/option-base-coins',
      'https://api.bytick.com/v5/market/option-base-coins',
    ], 15000);
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
      const response = await getJsonAny([
        'https://api.bybit.com/v5/event/instruments-info?' + query.toString(),
        'https://api.bytick.com/v5/event/instruments-info?' + query.toString(),
      ], 15000);
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

export async function getStandaloneMarketProviderCatalogue(
  provider: MarketProvider,
  fetchDeriv: () => Promise<any[]>,
): Promise<UnifiedInstrument[]> {
  switch (provider) {
    case 'DERIV': {
      const items = await fetchDeriv();
      return items.map(derivItem).filter(Boolean) as UnifiedInstrument[];
    }
    case 'BINANCE': return binance();
    case 'COINBASE': return coinbase();
    case 'KRAKEN': return kraken();
    case 'BYBIT': return bybit();
    case 'OKX': return okx();
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
        withProviderTimeout(provider, promise, provider === 'DERIV' ? 10000 : provider === 'CME' || provider === 'NYSEAMERICAN' ? 120000 : 20000)
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