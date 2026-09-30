import type { SireMarketQuote } from './marketDataRouter';

type Instrument = {
  symbol: string;
  provider?: string;
  marketType?: string;
  base?: string;
  quote?: string;
};

const INTERVAL: Record<string,string> = {
  '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m',
  '1h':'1h','2h':'2h','4h':'4h','6h':'6h','8h':'8h','12h':'12h',
  '1d':'1d','3d':'3d','1w':'1w','1M':'1M'
};

const BINANCE = {
  spotRest: 'https://data-api.binance.vision',
  spotStream: 'wss://data-stream.binance.vision',
  usdmRest: 'https://fapi.binance.com',
  usdmStream: 'wss://fstream.binance.com',
  coinmRest: 'https://dapi.binance.com',
  coinmStream: 'wss://dstream.binance.com',
  optionsRest: 'https://eapi.binance.com',
  optionsStream: 'wss://nbstream.binance.com/eoptions',
} as const;

function timeoutSignal(ms = 12000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  return { controller, timer };
}

async function fetchJson(url: string, label: string, timeoutMs = 12000): Promise<any> {
  const { controller, timer } = timeoutSignal(timeoutMs);
  try {
    console.info('[SIRE BINANCE BROWSER] HTTP', label, url);
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const raw = await response.text();
    let payload: any = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch {
      throw new Error('Binance returned non-JSON HTTP ' + response.status);
    }
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + String(payload?.msg || 'Binance request failed'));
    }
    if (payload?.code && Number(payload.code) < 0) {
      throw new Error('Binance ' + payload.code + ': ' + String(payload.msg || 'request failed'));
    }
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

function makeInstrument(raw: any, marketType: string, idPrefix = 'BINANCE'): any | null {
  const symbol = String(raw?.symbol || '').trim();
  if (!symbol) return null;

  const status = String(raw?.status || raw?.contractStatus || 'TRADING').toUpperCase();
  if (!['TRADING','PENDING_TRADING'].includes(status)) return null;

  const base = String(raw?.baseAsset || raw?.baseCoin || '').trim() || undefined;
  const quote = String(raw?.quoteAsset || raw?.quoteCoin || raw?.quoteCurrency || '').trim() || undefined;
  const expiry = Number(raw?.deliveryDate ?? raw?.expiryDate);
  const strike = Number(raw?.strikePrice);
  const side = String(raw?.side || '').toUpperCase();

  return {
    id: idPrefix + ':' + marketType + ':' + symbol,
    provider: 'BINANCE',
    providerLabel: 'Binance',
    exchange: 'BINANCE',
    marketType,
    category: 'Crypto',
    symbol,
    displaySymbol: symbol,
    name: base && quote ? base + ' / ' + quote : symbol,
    base,
    quote,
    exchangeOpen: 1,
    status: 'online',
    logoUrl: base
      ? 'https://cdn.jsdelivr.net/gh/vadimmalykhin/binance-icons/crypto/' + encodeURIComponent(base.toLowerCase()) + '.svg'
      : 'https://www.binance.com/favicon.ico',
    providerLogoUrl: 'https://www.binance.com/favicon.ico',
    instrumentType: marketType,
    contractType: raw?.contractType || undefined,
    settlement: raw?.marginAsset || raw?.settleAsset || raw?.settleCoin || undefined,
    expiry: Number.isFinite(expiry) ? expiry : undefined,
    strike: Number.isFinite(strike) ? strike : undefined,
    optionType: side === 'CALL' || side === 'PUT' ? side : undefined,
  };
}

async function postBrowserDiagnostic(diagnostic: any) {
  try {
    await fetch('/api/sire/binance/browser-diagnostic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(diagnostic),
      keepalive: true,
    });
  } catch (error) {
    console.warn('[SIRE BINANCE BROWSER] diagnostic POST failed', error);
  }
}

export async function fetchBinanceHotMarkets(limit = 8): Promise<any[]> {
  const data = await publicRest(BINANCE.spotRest + '/api/v3/ticker/24hr', {});
  const rows = Array.isArray(data) ? data : [];
  return rows
    .filter((row: any) => {
      const symbol = String(row?.symbol || '').toUpperCase();
      return symbol.endsWith('USDT') &&
        !symbol.endsWith('UPUSDT') &&
        !symbol.endsWith('DOWNUSDT') &&
        !symbol.endsWith('BULLUSDT') &&
        !symbol.endsWith('BEARUSDT') &&
        Number(row?.quoteVolume) > 0;
    })
    .map((row: any) => {
      const symbol = String(row.symbol).toUpperCase();
      const base = symbol.slice(0, -4);
      const change = Number(row.priceChangePercent);
      const quoteVolume = Number(row.quoteVolume);
      const trades = Number(row.count);
      // Binance does not document a public API endpoint for its proprietary
      // Hot ordering, so use Binance's own live 24h ticker fields to build a
      // deterministic Hot ranking: activity + movement + participation.
      const volumeScore = Math.log10(Math.max(1, quoteVolume));
      const movementScore = Math.min(12, Math.abs(change));
      const participationScore = Math.log10(Math.max(1, trades)) * 0.35;
      const hotScore = volumeScore * 1.15 + movementScore * 1.8 + participationScore;
      return {
        id: 'BINANCE:Spot:' + symbol,
        provider: 'BINANCE',
        providerLabel: 'Binance',
        exchange: 'BINANCE',
        marketType: 'Spot',
        category: 'Crypto',
        symbol,
        displaySymbol: symbol,
        name: base + ' / USDT',
        base,
        quote: 'USDT',
        price: Number(row.lastPrice),
        change24h: change,
        priceChangePercent: change,
        volume24h: quoteVolume,
        quoteVolume,
        tradeCount24h: trades,
        hotScore,
        logoUrl: 'https://cdn.jsdelivr.net/gh/vadimmalykhin/binance-icons/crypto/' + encodeURIComponent(base.toLowerCase()) + '.svg',
        providerLogoUrl: 'https://www.binance.com/favicon.ico',
        exchangeOpen: 1,
        status: 'online',
      };
    })
    .filter((row: any) => Number.isFinite(row.price))
    .sort((a: any, b: any) => b.hotScore - a.hotScore)
    .slice(0, Math.max(1, limit));
}

export async function fetchBinanceBrowserCatalogue(): Promise<any[]> {
  const out: any[] = [];
  const counts: Record<string, number> = {};
  const failures: Record<string, string> = {};

  const addRows = (rows: any[], marketType: string, idPrefix = 'BINANCE') => {
    let accepted = 0;
    for (const raw of rows || []) {
      const item = makeInstrument(raw, marketType, idPrefix);
      if (item) { out.push(item); accepted += 1; }
    }
    counts[marketType] = (counts[marketType] || 0) + accepted;
  };

  console.info('[SIRE BINANCE BROWSER] START official public market-data catalogue');

  // Spot: Binance explicitly documents data-api.binance.vision for public market data.
  try {
    const data = await fetchJson(BINANCE.spotRest + '/api/v3/exchangeInfo?symbolStatus=TRADING', 'Spot exchangeInfo');
    const rows = Array.isArray(data?.symbols) ? data.symbols : [];
    addRows(rows, 'Spot');
    // Binance's Spot exchangeInfo carries margin-trading availability on symbols.
    addRows(rows.filter((r: any) => r?.isMarginTradingAllowed === true), 'Margin');
    console.info('[SIRE BINANCE BROWSER] Spot exchangeInfo OK', { returned: rows.length, spot: counts.Spot || 0, margin: counts.Margin || 0 });
  } catch (error) {
    failures.Spot = error instanceof Error ? error.message : String(error);
    console.warn('[SIRE BINANCE BROWSER] Spot exchangeInfo FAILED', failures.Spot);
  }

  // USD-M: official public exchange information contains both perpetual and delivery contracts.
  try {
    const data = await fetchJson(BINANCE.usdmRest + '/fapi/v1/exchangeInfo', 'USD-M exchangeInfo');
    const rows = Array.isArray(data?.symbols) ? data.symbols : [];
    for (const raw of rows) {
      const type = String(raw?.contractType || '').toUpperCase() === 'PERPETUAL' ? 'Perpetuals' : 'Futures';
      const item = makeInstrument(raw, type);
      if (item) out.push(item);
      if (item) counts[type] = (counts[type] || 0) + 1;
    }
    console.info('[SIRE BINANCE BROWSER] USD-M exchangeInfo OK', { returned: rows.length, perpetuals: counts.Perpetuals || 0, futures: counts.Futures || 0 });
  } catch (error) {
    failures['USD-M'] = error instanceof Error ? error.message : String(error);
    console.warn('[SIRE BINANCE BROWSER] USD-M exchangeInfo FAILED', failures['USD-M']);
  }

  // COIN-M: official public exchange information contains perpetual and delivery contracts.
  try {
    const data = await fetchJson(BINANCE.coinmRest + '/dapi/v1/exchangeInfo', 'COIN-M exchangeInfo');
    const rows = Array.isArray(data?.symbols) ? data.symbols : [];
    for (const raw of rows) {
      const type = String(raw?.contractType || '').toUpperCase() === 'PERPETUAL' ? 'Perpetuals' : 'Futures';
      const item = makeInstrument(raw, type, 'BINANCE:COIN-M');
      if (item) {
        item.name = item.base && item.quote ? item.base + ' / ' + item.quote + ' (COIN-M)' : item.symbol;
        out.push(item);
        counts['COIN-M ' + type] = (counts['COIN-M ' + type] || 0) + 1;
      }
    }
    console.info('[SIRE BINANCE BROWSER] COIN-M exchangeInfo OK', { returned: rows.length });
  } catch (error) {
    failures['COIN-M'] = error instanceof Error ? error.message : String(error);
    console.warn('[SIRE BINANCE BROWSER] COIN-M exchangeInfo FAILED', failures['COIN-M']);
  }

  // Options: official eapi exchangeInfo exposes every currently trading option symbol.
  try {
    const data = await fetchJson(BINANCE.optionsRest + '/eapi/v1/exchangeInfo', 'Options exchangeInfo');
    const rows = Array.isArray(data?.optionSymbols) ? data.optionSymbols : [];
    for (const raw of rows) {
      const item = makeInstrument(raw, 'Options');
      if (!item) continue;
      item.name = String(raw?.symbol || item.symbol);
      item.base = String(raw?.underlying || '').replace(/USDT$|USDC$|BUSD$/i, '') || item.base;
      item.quote = String(raw?.quoteAsset || '').trim() || item.quote;
      item.optionType = String(raw?.side || '').toUpperCase();
      out.push(item);
      counts.Options = (counts.Options || 0) + 1;
    }
    console.info('[SIRE BINANCE BROWSER] Options exchangeInfo OK', { returned: rows.length, options: counts.Options || 0 });
  } catch (error) {
    failures.Options = error instanceof Error ? error.message : String(error);
    console.warn('[SIRE BINANCE BROWSER] Options exchangeInfo FAILED', failures.Options);
  }

  const seen = new Set<string>();
  const unique = out.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  const diagnostic = {
    source: 'browser-official-binance-public-market-data',
    total: unique.length,
    counts,
    failures,
    reportedAt: Date.now(),
    endpoints: {
      spot: BINANCE.spotRest + '/api/v3/exchangeInfo',
      usdm: BINANCE.usdmRest + '/fapi/v1/exchangeInfo',
      coinm: BINANCE.coinmRest + '/dapi/v1/exchangeInfo',
      options: BINANCE.optionsRest + '/eapi/v1/exchangeInfo',
    },
  };

  console.info('[SIRE BINANCE BROWSER] COMPLETE', diagnostic);
  void postBrowserDiagnostic(diagnostic);

  if (!unique.length) {
    throw new Error('Binance official browser catalogue returned zero instruments.');
  }
  return unique;
}

async function backendJson(path: string, params: Record<string,string>) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url.toString(), { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'SIRE Binance backend request failed');
  return payload;
}

function restTarget(marketType: string, symbol: string) {
  const mt = String(marketType || 'Spot');
  if (mt === 'Options') return { base: BINANCE.optionsRest, klines: '/eapi/v1/klines', ticker: '/eapi/v1/ticker' };
  if (mt === 'Perpetuals') return { base: symbol.includes('_') ? BINANCE.coinmRest : BINANCE.usdmRest, klines: symbol.includes('_') ? '/dapi/v1/klines' : '/fapi/v1/klines', ticker: symbol.includes('_') ? '/dapi/v1/ticker/price' : '/fapi/v1/ticker/price' };
  if (mt === 'Futures') return { base: symbol.includes('_') ? BINANCE.coinmRest : BINANCE.usdmRest, klines: symbol.includes('_') ? '/dapi/v1/klines' : '/fapi/v1/klines', ticker: symbol.includes('_') ? '/dapi/v1/ticker/price' : '/fapi/v1/ticker/price' };
  return { base: BINANCE.spotRest, klines: '/api/v3/klines', ticker: '/api/v3/ticker/24hr' };
}

async function publicRest(path: string, params: Record<string,string>) {
  const u = new URL(path);
  for (const [key, value] of Object.entries(params)) u.searchParams.set(key, value);
  return fetchJson(u.toString(), 'public market data');
}

export function createBinanceDataFeed(
  instrument: Instrument,
  onQuote?: (quote: SireMarketQuote) => void,
  onDiagnostic?: (event: any) => void,
) {
  let stopped = false;
  let reconnectTimer: number | undefined;
  let pollTimer: number | undefined;
  let socket: WebSocket | null = null;
  let last: any = null;
  let currentBar: any = null;
  let activeBarCallback: ((bar:any)=>void) | null = null;

  const marketType = String(instrument.marketType || 'Spot');
  const symbol = String(instrument.symbol || '');

  const getBars = async ({ symbol: requestedSymbol, interval, countBack = 500, from, to }: { symbol:string; interval:string; countBack?:number; from?:number; to?:number }) => {
    const target = restTarget(marketType, requestedSymbol);
    const params: Record<string,string> = {
      symbol: requestedSymbol,
      interval: INTERVAL[interval] || interval,
      limit: String(Math.min(1500, Math.max(2, countBack))),
    };
    if (Number.isFinite(from)) params.startTime = String(Math.floor(Number(from) * 1000));
    if (Number.isFinite(to)) params.endTime = String(Math.floor(Number(to) * 1000));

    let payload: any;
    try {
      payload = await publicRest(target.base + target.klines, params);
    } catch {
      payload = await backendJson('/api/sire/binance/history', {
        symbol: requestedSymbol,
        marketType,
        interval: params.interval,
        count: params.limit,
        ...(params.startTime ? { from: String(Number(params.startTime) / 1000) } : {}),
        ...(params.endTime ? { to: String(Number(params.endTime) / 1000) } : {}),
      });
      return payload.bars || [];
    }

    return (payload || []).map((row: any[]) => ({
      time: Number(row[0]) / 1000,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]) || 0,
    })).filter((bar: any) => [bar.time,bar.open,bar.high,bar.low,bar.close].every(Number.isFinite));
  };

  const getBarsPage = async ({ symbol: requestedSymbol, interval, before, countBack }: { symbol:string; interval:string; before:number; countBack:number }) => {
    const bars = await getBars({ symbol: requestedSymbol, interval, countBack, to: before - 1 });
    return { bars: bars.filter((bar:any) => bar.time < before), hasMore: bars.length > 0, nextBefore: bars[0]?.time };
  };

  const emit = (epochMs: number, price: number, volume = 0) => {
    if (!Number.isFinite(epochMs) || !Number.isFinite(price)) return;
    const seconds = intervalSeconds(String(instrument.marketType || 'Spot'));
    const epoch = epochMs / 1000;
    const bucket = Math.floor(epoch / seconds) * seconds;
    if (!currentBar || bucket > currentBar.time) {
      currentBar = { time: bucket, open: price, high: price, low: price, close: price, volume };
    } else if (bucket === currentBar.time) {
      currentBar = { ...currentBar, high: Math.max(currentBar.high, price), low: Math.min(currentBar.low, price), close: price, volume: volume || currentBar.volume || 0 };
    }
    last = { symbol, price, epoch, volume };
    onQuote?.(last);
    activeBarCallback?.({ ...currentBar });
    onDiagnostic?.({ level:'info', code:'LIVE_PRICE_RECEIVED', message:'Binance live price received.', detail:{ symbol, price, epoch } });
  };

  function intervalSeconds(interval: string) {
    const map: Record<string,number> = {'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'1w':604800,'1M':2592000};
    return map[interval] || 60;
  }

  const connect = () => {
    if (stopped) return;
    const s = symbol.toLowerCase();
    let url = '';
    if (marketType === 'Spot' || marketType === 'Margin' || marketType === 'Isolated Margin') url = BINANCE.spotStream + '/ws/' + s + '@aggTrade';
    else if (marketType === 'Perpetuals' || marketType === 'Futures') {
      url = (s.includes('_') ? BINANCE.coinmStream : BINANCE.usdmStream) + '/ws/' + s + '@aggTrade';
    } else if (marketType === 'Options') {
      url = BINANCE.optionsStream + '/ws/' + s + '@ticker';
    }

    if (!url) return;

    try {
      socket = new WebSocket(url);
      onDiagnostic?.({ level:'info', code:'LIVE_STREAM_CONNECTING', message:'Connecting to Binance official market-data stream.', detail:{url} });
      socket.onopen = () => onDiagnostic?.({ level:'info', code:'LIVE_STREAM_CONNECTED', message:'Connected to Binance official market-data stream.', detail:{url} });
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          const price = Number(message?.p ?? message?.c);
          const timestamp = Number(message?.T ?? message?.E ?? Date.now());
          const volume = Number(message?.q ?? message?.v) || 0;
          emit(timestamp, price, volume);
        } catch (error) {
          onDiagnostic?.({ level:'warning', code:'LIVE_STREAM_PARSE_ERROR', message:'Could not parse Binance stream message.', detail:String(error) });
        }
      };
      socket.onerror = () => onDiagnostic?.({ level:'warning', code:'LIVE_STREAM_ERROR', message:'Binance official market-data stream reported an error.', detail:{url} });
      socket.onclose = () => {
        if (!stopped) {
          onDiagnostic?.({ level:'warning', code:'LIVE_STREAM_RECONNECTING', message:'Binance official market-data stream disconnected; reconnecting.', detail:{url} });
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };
    } catch (error) {
      onDiagnostic?.({ level:'warning', code:'LIVE_STREAM_CONNECT_FAILED', message:'Could not open Binance official market-data stream.', detail:String(error) });
      reconnectTimer = window.setTimeout(connect, 1500);
    }
  };

  const pollQuote = async () => {
    if (stopped) return;
    const target = restTarget(marketType, symbol);
    try {
      const payload = await publicRest(target.base + target.ticker, { symbol });
      const row = Array.isArray(payload) ? (payload[0] || {}) : payload;
      const price = Number(row?.lastPrice ?? row?.price ?? row?.markPrice);
      const epoch = Number(row?.closeTime ?? row?.time ?? Date.now());
      if (Number.isFinite(price)) emit(epoch, price, Number(row?.volume) || 0);
    } catch (error) {
      try {
        const payload = await backendJson('/api/sire/binance/quote', { symbol, marketType });
        const q = payload.quote;
        if (Number.isFinite(Number(q?.price))) emit(Number(q.epoch) * 1000, Number(q.price), Number(q.volume) || 0);
      } catch (fallbackError) {
        onDiagnostic?.({ level:'warning', code:'LIVE_PRICE_NOT_RECEIVED', message:'Binance live REST fallback failed.', detail:String(fallbackError) });
      }
    }
    if (!stopped) pollTimer = window.setTimeout(pollQuote, 3000);
  };

  connect();
  void pollQuote();

  return {
    getBars,
    getBarsPage,
    subscribeBars({ symbol: requestedSymbol, interval: requestedInterval }: { symbol:string; interval:string }, onBar:(bar:any)=>void, options?:{seedFrom?:any}) {
      if (requestedSymbol !== symbol) return () => {};
      currentBar = options?.seedFrom ? { ...options.seedFrom } : null;
      activeBarCallback = onBar;
      const stopPolling = () => {
        stopped = true;
        if (pollTimer) window.clearTimeout(pollTimer);
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
        try { socket?.close(); } catch {}
        socket = null;
      };
      // The feed already maintains the official live stream; bars are emitted from it below.
      if (currentBar) onBar({ ...currentBar });
      const barTimer = window.setInterval(() => {
        if (currentBar) onBar({ ...currentBar });
      }, 1000);
      return () => {
        window.clearInterval(barTimer);
        activeBarCallback = null;
        stopPolling();
      };
    },
    getLiveState() {
      return last
        ? { connectionStatus:'live', subscriptionStatus:stopped?'stopped':'active', latestTick:{...last}, dataTimestamp:last.epoch, dataAgeMs:Math.max(0,Date.now()-last.epoch*1000), stale:Date.now()-last.epoch*1000>10000, staleThresholdMs:10000, checkedAt:Date.now() }
        : { connectionStatus:'connecting', subscriptionStatus:stopped?'stopped':'active', latestTick:null, dataTimestamp:null, dataAgeMs:null, stale:false, staleThresholdMs:10000, checkedAt:Date.now() };
    },
    close() {
      stopped = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try { socket?.close(); } catch {}
      socket = null;
    },
  };
}
