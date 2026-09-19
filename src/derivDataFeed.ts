export type DerivInstrument = {
  symbol: string;
  name: string;
  market: string;
  submarket: string;
  subgroup: string;
  symbolType: string;
  pipSize?: number;
  exchangeOpen?: number;
};

export type DerivBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const DERIV_WS_URL = 'wss://ws.binaryws.com/websockets/v3';

const REQUEST_TIMEOUT_MS = 20_000;
const HISTORY_PAGE_SIZE = 5_000;
const PAGE_DELAY_MS = 75;

const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60,
  '2m': 120,
  '3m': 180,
  '5m': 300,
  '10m': 600,
  '15m': 900,
  '20m': 1200,
  '30m': 1800,
  '45m': 2700,
  '1h': 3600,
  '2h': 7200,
  '3h': 10800,
  '4h': 14400,
  '6h': 21600,
  '8h': 28800,
  '12h': 43200,
  '1d': 86400,
  '1w': 604800,
};

let requestSequence = 0;

function nextRequestId() {
  requestSequence += 1;
  return requestSequence;
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function connectSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(DERIV_WS_URL);
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error('Deriv WebSocket connection timed out.'));
    }, REQUEST_TIMEOUT_MS);

    socket.onopen = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(socket);
    };
    socket.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error('Deriv WebSocket connection failed.'));
    };
  });
}

function requestOnce(socket: WebSocket, payload: Record<string, unknown>): Promise<any> {
  const reqId = nextRequestId();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Deriv request timed out (${String(payload.ticks_history || payload.active_symbols || payload.ticks || 'request')}).`));
    }, REQUEST_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
    };
    const onMessage = (event: MessageEvent) => {
      let data: any;
      try { data = JSON.parse(String(event.data)); } catch { return; }
      if (data.req_id !== reqId) return;
      cleanup();
      if (data.error) reject(new Error(data.error.message || 'Deriv API request failed.'));
      else resolve(data);
    };
    const onError = () => { cleanup(); reject(new Error('Deriv WebSocket error.')); };
    const onClose = () => { cleanup(); reject(new Error('Deriv WebSocket closed before the request completed.')); };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
    socket.send(JSON.stringify({ ...payload, req_id: reqId }));
  });
}

function isSyntheticIndex(item: any) {
  const market = String(item.market || '').toLowerCase();
  const type = String(item.underlying_symbol_type || item.symbol_type || '').toLowerCase();
  const submarket = String(item.submarket || '').toLowerCase();
  const subgroup = String(item.subgroup || '').toLowerCase();
  return market.includes('synthetic') || type.includes('synthetic') || submarket.includes('synthetic') || subgroup.includes('synthetic');
}

function mapInstrument(item: any): DerivInstrument | null {
  const symbol = String(item.underlying_symbol || item.symbol || '').trim();
  if (!symbol || !isSyntheticIndex(item)) return null;
  return {
    symbol,
    name: String(item.underlying_symbol_name || item.display_name || symbol),
    market: String(item.market || ''),
    submarket: String(item.submarket || ''),
    subgroup: String(item.subgroup || ''),
    symbolType: String(item.underlying_symbol_type || item.symbol_type || ''),
    pipSize: Number.isFinite(Number(item.pip_size ?? item.pip)) ? Number(item.pip_size ?? item.pip) : undefined,
    exchangeOpen: Number.isFinite(Number(item.exchange_is_open)) ? Number(item.exchange_is_open) : undefined,
  };
}

export async function fetchSyntheticInstruments(): Promise<DerivInstrument[]> {
  const socket = await connectSocket();
  try {
    const response = await requestOnce(socket, { active_symbols: 'brief' });
    const mapped = Array.isArray(response.active_symbols)
      ? response.active_symbols.map(mapInstrument).filter(Boolean) as DerivInstrument[]
      : [];
    return mapped.sort((a, z) => a.name.localeCompare(z.name));
  } finally {
    socket.close();
  }
}

function intervalSeconds(interval: string) {
  const seconds = INTERVAL_SECONDS[interval];
  if (!seconds) throw new Error(`Unsupported chart interval: ${interval}`);
  return seconds;
}

function normalizeCandle(candle: any): DerivBar | null {
  const time = Number(candle?.epoch);
  const open = Number(candle?.open);
  const high = Number(candle?.high);
  const low = Number(candle?.low);
  const close = Number(candle?.close);
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  return { time, open, high, low, close, volume: 0 };
}

async function fetchHistoryPage(symbol: string, interval: string, end: number | 'latest') {
  const socket = await connectSocket();
  try {
    const response = await requestOnce(socket, {
      ticks_history: symbol,
      end,
      count: HISTORY_PAGE_SIZE,
      style: 'candles',
      granularity: intervalSeconds(interval),
      adjust_start_time: 1,
      subscribe: 0,
    });
    return Array.isArray(response.candles)
      ? response.candles.map(normalizeCandle).filter(Boolean) as DerivBar[]
      : [];
  } finally {
    socket.close();
  }
}

export async function fetchAllHistory(symbol: string, interval: string, onPage?: (bars: number) => void): Promise<DerivBar[]> {
  const all: DerivBar[] = [];
  let end: number | 'latest' = 'latest';
  let previousOldest = Number.POSITIVE_INFINITY;

  while (true) {
    const page = await fetchHistoryPage(symbol, interval, end);
    if (!page.length) break;

    page.sort((a, b) => a.time - b.time);
    const oldest = page[0].time;
    const newest = page[page.length - 1].time;
    const unique = page.filter(bar => !all.length || bar.time < all[0].time || bar.time > all[all.length - 1].time);
    if (unique.length) {
      const merged = [...all, ...unique];
      merged.sort((a, b) => a.time - b.time);
      all.splice(0, all.length, ...merged);
    }
    onPage?.(all.length);

    if (page.length < HISTORY_PAGE_SIZE || oldest <= 0 || oldest >= previousOldest) break;
    previousOldest = oldest;
    end = Math.max(1, oldest - 1);
    await sleep(PAGE_DELAY_MS);

    if (newest <= 0) break;
  }

  return all;
}

type TickBar = DerivBar;

function updateBar(previous: TickBar | null, epoch: number, price: number, seconds: number): TickBar {
  const time = Math.floor(epoch / seconds) * seconds;
  if (!previous || time > previous.time) {
    return { time, open: price, high: price, low: price, close: price, volume: 0 };
  }
  if (time < previous.time) return previous;
  return {
    ...previous,
    high: Math.max(previous.high, price),
    low: Math.min(previous.low, price),
    close: price,
  };
}

export function createDerivDataFeed() {
  return {
    async getBars({ symbol, interval }: { symbol: string; interval: string }) {
      return fetchAllHistory(symbol, interval);
    },

    subscribeBars(
      { symbol, interval }: { symbol: string; interval: string },
      onBar: (bar: DerivBar) => void,
      options?: { seedFrom?: DerivBar },
    ) {
      let stopped = false;
      let socket: WebSocket | null = null;
      let reconnectTimer: number | null = null;
      let currentBar: TickBar | null = options?.seedFrom ? { ...options.seedFrom } : null;

      const connect = () => {
        if (stopped) return;
        socket = new WebSocket(DERIV_WS_URL);
        socket.onopen = () => {
          if (stopped || !socket) return;
          socket.send(JSON.stringify({ ticks: symbol, subscribe: 1, req_id: nextRequestId() }));
        };
        socket.onmessage = event => {
          let data: any;
          try { data = JSON.parse(String(event.data)); } catch { return; }
          if (data.error || data.msg_type !== 'tick' || data.tick?.symbol !== symbol) return;
          const epoch = Number(data.tick.epoch);
          const price = Number(data.tick.quote);
          if (!Number.isFinite(epoch) || !Number.isFinite(price)) return;
          const next = updateBar(currentBar, epoch, price, intervalSeconds(interval));
          if (next !== currentBar || next.close !== currentBar?.close || next.high !== currentBar?.high || next.low !== currentBar?.low) {
            currentBar = next;
            onBar({ ...next });
          }
        };
        socket.onerror = () => {};
        socket.onclose = () => {
          socket = null;
          if (stopped) return;
          reconnectTimer = window.setTimeout(connect, 1000);
        };
      };

      connect();

      return () => {
        stopped = true;
        if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ forget_all: 'ticks' }));
        socket?.close();
        socket = null;
      };
    },
  };
}
