export type BinanceInstrument = {
  symbol: string;
  name: string;
  provider: 'BINANCE';
  exchange: string;
  marketGroup: 'CRYPTO' | 'TRADE FI' | 'ALPHA';
  marketType: string;
  category: string;
  marketSubcategory: string;
  marketSubSubcategory?: string;
  marketFilters: string[];
  marketFilter?: string;
  instrumentType: string;
  instrumentSubtype?: string;
  quote?: string;
  baseAsset?: string;
  settlement?: string;
  status?: string;
  pipSize?: number;
  onboardDate?: number;
  expiry?: number;
  newListing?: boolean;
  margin?: boolean;
  price?: number;
  priceChangePercent?: number;
  change24h?: number;
  volume24h?: number;
  high24h?: number;
  low24h?: number;
  marketCap?: number;
  fdv?: number;
  liquidity?: number;
  holders?: number;
  listedAt?: number;
};

export type BinanceTick = {
  provider: 'BINANCE';
  symbol: string;
  price: number;
  epoch: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  quoteVolume?: number;
  bid?: number;
  ask?: number;
  percent?: number;
  marketCap?: number;
};

type Bar = { time:number; open:number; high:number; low:number; close:number; volume?:number; };
type Diagnostic = { level:'info'|'warning'|'error'; code:string; message:string; detail?:string; };

export async function fetchBinanceInstruments(): Promise<BinanceInstrument[]> {
  const response = await fetch('/api/sire/binance/catalog', { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok || !Array.isArray(payload.instruments)) {
    throw new Error(payload?.error || 'Binance native catalog is unavailable.');
  }
  return payload.instruments as BinanceInstrument[];
}

/*
 * Binance chart adapter.
 *
 * This is intentionally separate from the catalogue loader. Public market
 * data does not require an API key for the NONE-security endpoints. We use
 * Binance's market-data hosts only; authenticated account/trading endpoints
 * are not used by the chart.
 *
 * Spot: data-api.binance.vision/api/v3/klines
 * USDT-M: fapi*.binance.com/fapi/v1/klines
 * COIN-M: dapi*.binance.com/dapi/v1/klines
 *
 * The adapter also owns its public WebSocket subscription and converts
 * Binance kline events into the OpenAlgo bar shape.
 */

const NATIVE_INTERVALS = new Set([
  '1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'
]);

const INTERVAL_SECONDS: Record<string, number> = {
  '1m':60,'2m':120,'3m':180,'5m':300,'10m':600,'15m':900,'20m':1200,
  '30m':1800,'45m':2700,'1h':3600,'2h':7200,'3h':10800,'4h':14400,
  '6h':21600,'8h':28800,'12h':43200,'1d':86400,'1w':604800
};

const SPOT_REST = [
  'https://data-api.binance.vision/api/v3',
  'https://api.binance.com/api/v3',
  'https://api1.binance.com/api/v3',
  'https://api2.binance.com/api/v3',
  'https://api3.binance.com/api/v3',
  'https://api4.binance.com/api/v3'
];
const UM_REST = [
  'https://fapi.binance.com/fapi/v1',
  'https://fapi1.binance.com/fapi/v1',
  'https://fapi2.binance.com/fapi/v1',
  'https://fapi3.binance.com/fapi/v1',
  'https://fapi4.binance.com/fapi/v1'
];
const CM_REST = [
  'https://dapi.binance.com/dapi/v1',
  'https://www.binance.com/dapi/v1'
];

const asNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

const diagnostic = (sink: ((event: Diagnostic) => void)|undefined, event: Diagnostic) => sink?.(event);

function marketKind(instrument: any): 'spot'|'um'|'cm'|'options'|'alpha'|'equity' {
  const type = String(instrument?.marketType || '').toLowerCase();
  const group = String(instrument?.marketGroup || '').toLowerCase();
  const sub = String(instrument?.marketSubcategory || instrument?.settlement || '').toLowerCase();
  if (type.includes('option')) return 'options';
  if (type.includes('alpha') || group === 'alpha') return 'alpha';
  if (type.includes('stock') || group.includes('trade fi') && type.includes('stock')) return 'equity';
  if (type.includes('coin') || sub.includes('coin-m') || sub.includes('coin m')) return 'cm';
  if (type.includes('future') || sub.includes('usdt-m') || sub.includes('usdt m')) return 'um';
  return 'spot';
}

function restHosts(instrument: any) {
  const kind = marketKind(instrument);
  return kind === 'um' ? UM_REST : kind === 'cm' ? CM_REST : kind === 'options' ? ['https://eapi.binance.com/eapi/v1'] : SPOT_REST;
}

function wsHosts(instrument: any) {
  const kind = marketKind(instrument);
  if (kind === 'alpha') return ['wss://nbstream.binance.com/w3w/wsa/stream/ws/'];
  if (kind === 'options') return ['wss://nbstream.binance.com/eoptions/ws/'];
  return kind === 'um'
    ? ['wss://fstream.binance.com/ws/','wss://fstream1.binance.com/ws/']
    : kind === 'cm'
      ? ['wss://dstream.binance.com/ws/']
      : ['wss://stream.binance.com:9443/ws/','wss://stream.binance.com/ws/'];
}

function nativeInterval(interval: string) {
  return NATIVE_INTERVALS.has(interval) ? interval : '1m';
}

function parseKline(row: any): Bar | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const time = Math.floor(asNumber(row[0]) / 1000);
  const open = asNumber(row[1]), high = asNumber(row[2]), low = asNumber(row[3]), close = asNumber(row[4]), volume = asNumber(row[5]);
  if (![time,open,high,low,close].every(Number.isFinite)) return null;
  return { time, open, high, low, close, ...(Number.isFinite(volume) ? { volume } : {}) };
}

function aggregateBars(source: Bar[], seconds: number) {
  if (seconds <= 60) return source;
  const map = new Map<number, Bar>();
  for (const bar of source) {
    const bucket = Math.floor(bar.time / seconds) * seconds;
    const current = map.get(bucket);
    if (!current) {
      map.set(bucket, { time:bucket, open:bar.open, high:bar.high, low:bar.low, close:bar.close, ...(bar.volume !== undefined ? {volume:bar.volume} : {}) });
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      if (bar.volume !== undefined) current.volume = (current.volume || 0) + bar.volume;
    }
  }
  return [...map.values()].sort((a,b) => a.time - b.time);
}

async function requestKlines(instrument: any, symbol: string, interval: string, end?: number, limit = 1000): Promise<Bar[]> {
  const params = new URLSearchParams({
    symbol: String(symbol).toUpperCase(),
    interval: nativeInterval(interval),
    limit: String(Math.max(1, Math.min(1000, Math.floor(limit))))
  });
  if (Number.isFinite(end)) params.set('endTime', String(Math.floor(Number(end) * 1000)));
  let lastError = '';
  for (const host of restHosts(instrument)) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(host + '/klines?' + params.toString(), { cache:'no-store', signal:controller.signal, headers:{Accept:'application/json'} });
      const text = await response.text();
      if (!response.ok) {
        lastError = 'Binance HTTP ' + response.status;
        continue;
      }
      let rows:any;
      try { rows = JSON.parse(text); } catch { lastError = 'Binance returned invalid JSON.'; continue; }
      if (!Array.isArray(rows)) {
        lastError = String(rows?.msg || 'Binance returned no kline array.');
        continue;
      }
      return rows.map(parseKline).filter(Boolean) as Bar[];
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw new Error(lastError || 'Binance public kline endpoint is unavailable.');
}

async function fetchHistory(instrument:any, symbol:string, interval:string, from?:number, to?:number, countBack?:number):Promise<Bar[]> {
  const seconds = INTERVAL_SECONDS[interval];
  if (!seconds) throw new Error('Unsupported Binance chart interval: ' + interval);

  const wanted = Math.max(1, Math.min(10000, Math.floor(Number(countBack) || 500)));
  const native = NATIVE_INTERVALS.has(interval);
  const targetEnd = Number.isFinite(to) ? Number(to) : undefined;

  if (native) {
    let end = targetEnd;
    const pages:Bar[] = [];
    while (pages.length < wanted) {
      const page = await requestKlines(instrument, symbol, interval, end, Math.min(1000, wanted - pages.length));
      if (!page.length) break;
      pages.unshift(...page);
      const oldest = page[0].time;
      if (page.length < 1000 || oldest <= 1) break;
      end = oldest - seconds;
      if (from !== undefined && oldest <= from) break;
    }
    const unique = [...new Map(pages.map(bar => [bar.time,bar])).values()].sort((a,b)=>a.time-b.time);
    return unique.filter(bar => (from === undefined || bar.time >= from) && (to === undefined || bar.time <= to)).slice(-wanted);
  }

  // OpenAlgo supports intervals Binance does not expose natively (2m, 10m,
  // 20m, 45m, etc.). Build those bars from public 1m candles, paging backward
  // in 1000-candle chunks instead of inventing a fixed history limit.
  const rawNeeded = Math.min(10000, wanted * Math.ceil(seconds / 60) + 120);
  const raw:Bar[] = [];
  let end = targetEnd;
  while (raw.length < rawNeeded) {
    const page = await requestKlines(instrument, symbol, '1m', end, Math.min(1000, rawNeeded - raw.length));
    if (!page.length) break;
    raw.unshift(...page);
    const oldest = page[0].time;
    if (page.length < 1000 || oldest <= 1) break;
    end = oldest - 60;
    if (from !== undefined && oldest <= from - seconds) break;
  }
  const aggregated = aggregateBars([...new Map(raw.map(bar=>[bar.time,bar])).values()].sort((a,b)=>a.time-b.time), seconds);
  return aggregated.filter(bar => (from === undefined || bar.time >= from) && (to === undefined || bar.time <= to)).slice(-wanted);
}

function intervalForStream(interval:string) {
  return nativeInterval(interval);
}

function createSocketFeed(instrument:any, symbol:string, interval:string, onQuote:(quote:BinanceTick)=>void, onDiagnostic?:(event:Diagnostic)=>void) {
  let socket: WebSocket | null = null;
  let stopped = false;
  let reconnectTimer:number|undefined;
  let openedHost = 0;
  let reconnectAttempt = 0;
  let currentBar:Bar|null = null;

  const close = () => {
    stopped = true;
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    try { socket?.close(); } catch {}
    socket = null;
  };

  const connect = () => {
    if (stopped) return;
    const kind = marketKind(instrument);
    if (kind === 'equity') {
      const poll = async () => {
        if (stopped) return;
        try {
          const response = await fetch('/api/sire/binance/market-snapshot?t=' + Date.now(), {cache:'no-store'});
          const payload = await response.json().catch(() => ({}));
          const snap = payload?.snapshots?.['EQUITY:' + String(symbol).toUpperCase()];
          const price = asNumber(snap?.price);
          if (Number.isFinite(price)) onQuote({provider:'BINANCE',symbol:String(symbol).toUpperCase(),price,epoch:Date.now()/1000,bid:asNumber(snap?.bid),ask:asNumber(snap?.ask)});
        } catch {}
        if (!stopped) reconnectTimer = window.setTimeout(() => { reconnectTimer=undefined; void poll(); }, 3000);
      };
      void poll();
      return;
    }
    const hosts = wsHosts(instrument);
    const stream = String(symbol).toLowerCase() + '@kline_' + intervalForStream(interval);
    const url = hosts[Math.min(openedHost, hosts.length - 1)] + stream;
    try { socket = new WebSocket(url); } catch (error) {
      diagnostic(onDiagnostic,{level:'error',code:'BINANCE_LIVE_SOCKET_FAILED',message:'Binance WebSocket could not be created.',detail:String(error)});
      scheduleReconnect(); return;
    }
    const currentSocket = socket;
    currentSocket.onopen = () => {
      reconnectAttempt = 0;
      diagnostic(onDiagnostic,{level:'info',code:'BINANCE_LIVE_CONNECTED',message:'Binance live market stream connected.',detail:url});
    };
    currentSocket.onmessage = event => {
      try {
        const payload = JSON.parse(String(event.data));
        const k = payload?.k;
        if (!k) return;
        const price = asNumber(k.c);
        const epoch = asNumber(payload.E) / 1000;
        if (!Number.isFinite(price) || !Number.isFinite(epoch)) return;
        const bar = {
          time:Math.floor(asNumber(k.t) / 1000),
          open:asNumber(k.o), high:asNumber(k.h), low:asNumber(k.l), close:price,
          volume:asNumber(k.v)
        };
        if (![bar.time,bar.open,bar.high,bar.low,bar.close].every(Number.isFinite)) return;
        currentBar = bar;
        onQuote({provider:'BINANCE',symbol:String(k.s || symbol).toUpperCase(),price,epoch,open:bar.open,high:bar.high,low:bar.low,volume:bar.volume});
      } catch {}
    };
    currentSocket.onerror = () => {
      diagnostic(onDiagnostic,{level:'warning',code:'BINANCE_LIVE_SOCKET_ERROR',message:'Binance live market stream reported a socket error.',detail:url});
    };
    currentSocket.onclose = () => {
      if (stopped) return;
      socket = null;
      if (reconnectAttempt === 0 && openedHost < hosts.length - 1) openedHost += 1;
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== undefined) return;
    reconnectAttempt += 1;
    const delay = Math.min(15000, 500 * Math.pow(2, Math.min(reconnectAttempt,5)));
    reconnectTimer = window.setTimeout(() => { reconnectTimer = undefined; connect(); }, delay);
  };

  connect();

  return {
    getCurrentBar: () => currentBar ? {...currentBar} : null,
    close
  };
}

export function createBinanceDataFeed(
  instrument:any,
  onQuote?:(quote:{symbol:string;price:number;epoch:number;bid?:number;ask?:number})=>void,
  onDiagnostic?:(event:Diagnostic)=>void
) {
  let liveSocket:{close:()=>void;getCurrentBar:()=>Bar|null}|null = null;
  let liveSymbol = String(instrument?.symbol || '');
  let liveInterval = '1m';

  return {
    async getBars({symbol,interval,from,to,countBack}:{symbol:string;interval:string;from?:number;to?:number;countBack?:number}) {
      diagnostic(onDiagnostic,{level:'info',code:'BINANCE_HISTORY_REQUEST_STARTED',message:'Binance history requested for '+symbol+' '+interval+'.',detail:'Using Binance public market-data klines; no API key is required for this chart data path.'});
      const bars = await fetchHistory(instrument,symbol,interval,from,to,countBack);
      if (!bars.length) throw new Error('Binance returned no historical candles for '+symbol+' '+interval+'.');
      diagnostic(onDiagnostic,{level:'info',code:'BINANCE_HISTORY_LOADED',message:'Loaded '+bars.length+' Binance candles for '+symbol+' '+interval+'.'});
      return bars;
    },
    async getBarsPage({symbol,interval,before,countBack}:{symbol:string;interval:string;before:number;countBack:number}) {
      const seconds = INTERVAL_SECONDS[interval];
      if (!seconds) throw new Error('Unsupported Binance chart interval: '+interval);
      const page = await fetchHistory(instrument,symbol,interval,undefined,Math.floor(before)-1,countBack);
      const older = page.filter(bar=>bar.time < before);
      diagnostic(onDiagnostic,{level:older.length?'info':'warning',code:older.length?'BINANCE_HISTORY_PAGE_LOADED':'BINANCE_HISTORY_PAGE_EMPTY',message:older.length?'Loaded '+older.length+' older Binance candles for '+symbol+'.':'Binance returned no older candles for '+symbol+'.'});
      return {bars:older,hasMore:older.length>0 && older[0].time>1,nextBefore:older[0]?.time};
    },
    subscribeBars({symbol,interval}:{symbol:string;interval:string}, onBar:(bar:Bar)=>void, options?:{seedFrom?:Bar}) {
      liveSocket?.close();
      liveSymbol = symbol;
      liveInterval = interval;
      let stopped = false;
      let current = options?.seedFrom ? {...options.seedFrom} : null;
      const socket = createSocketFeed(instrument,symbol,interval,quote=>{
        if (stopped || quote.symbol.toUpperCase() !== symbol.toUpperCase()) return;
        const seconds = INTERVAL_SECONDS[interval] || 60;
        const incoming:Bar = {
          time:Math.floor(quote.epoch / seconds) * seconds,
          open:Number(quote.open ?? quote.price),
          high:Number(quote.high ?? quote.price),
          low:Number(quote.low ?? quote.price),
          close:quote.price,
          volume:quote.volume
        };
        if (current && incoming.time < current.time) return;
        if (current && incoming.time === current.time) {
          current = {...current, high:Math.max(current.high,incoming.high), low:Math.min(current.low,incoming.low), close:incoming.close, volume:incoming.volume};
        } else {
          current = incoming;
        }
        onQuote?.(quote);
        onBar({...current});
      },onDiagnostic);
      liveSocket = socket;
      return () => {
        stopped = true;
        if (liveSocket === socket) liveSocket = null;
        socket.close();
      };
    },
    getLiveState() {
      return { connectionStatus: liveSocket ? 'connected' : 'disconnected', subscriptionStatus:liveSocket ? 'active' : 'idle', latestTick:null, dataTimestamp:null, dataAgeMs:null, stale:false, staleThresholdMs:30000, checkedAt:Date.now() };
    },
    close() { liveSocket?.close(); liveSocket=null; }
  };
}
