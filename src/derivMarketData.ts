export type DerivMarketCategory =
  | 'synthetic'
  | 'forex'
  | 'commodities'
  | 'indices'
  | 'stocks'
  | 'crypto'
  | 'other';

export type DerivInstrument = {
  symbol: string;
  name: string;
  market: string;
  submarket: string;
  subgroup: string;
  symbolType: string;
  category: DerivMarketCategory;
  pipSize?: number;
  exchangeOpen?: number;
  tradingSuspended?: number;
};

export type DerivBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const DERIV_DIRECT_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
export const DERIV_WS_URL = DERIV_DIRECT_WS_URL;
export const DERIV_PROXY_WS_URL = typeof window !== 'undefined'
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/deriv/ws`
  : DERIV_DIRECT_WS_URL;
export const DERIV_REQUEST_TIMEOUT = 20000;
export const DERIV_PAGE_SIZE = 500;
export const DERIV_INITIAL_BARS = 10000; // Large startup stress-test window; older candles are still loaded progressively.

export const DERIV_INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60, '2m': 120, '3m': 180, '5m': 300, '10m': 600, '15m': 900,
  '20m': 1200, '30m': 1800, '45m': 2700, '1h': 3600, '2h': 7200,
  '3h': 10800, '4h': 14400, '6h': 21600, '8h': 28800, '12h': 43200,
  '1d': 86400, '1w': 604800,
};

type Pending = { resolve: (value: any) => void; reject: (reason?: unknown) => void; timer: number };
type TickHandler = (tick: { symbol: string; price: number; epoch: number }) => void;

export type DerivHistoryProgress = {
  phase: 'initial' | 'older';
  requested: number;
  received: number;
  valid: number;
  oldestTime: number | null;
  newestTime: number | null;
  end: number | 'latest';
};

export type DerivFeedDiagnostic = {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  detail?: string;
};

type DiagnosticHandler = (event: DerivFeedDiagnostic) => void;

let requestId = 0;

function nextRequestId() {
  requestId += 1;
  return requestId;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function classify(item: any): DerivMarketCategory {
  const market = lower(item.market);
  const type = lower(item.underlying_symbol_type ?? item.symbol_type);
  const submarket = lower(item.submarket);
  const subgroup = lower(item.subgroup);
  const symbol = text(item.underlying_symbol ?? item.symbol);

  if (type.includes('synthetic') || market.includes('synthetic') || submarket.includes('synthetic') || subgroup.includes('synthetic') ||
      /^(1HZ|R_|RDBULL|RDBEAR|JD|stp)/i.test(symbol)) return 'synthetic';
  if (type.includes('forex') || market === 'forex' || market.includes('currency')) return 'forex';
  if (type.includes('commodity') || market.includes('commodity')) return 'commodities';
  if (type.includes('crypto') || market.includes('crypto')) return 'crypto';
  if (type.includes('stock') || market.includes('stock') || market.includes('share')) return 'stocks';
  if (type.includes('index') || market.includes('index')) return 'indices';
  return 'other';
}

export function normalizeDerivInstrument(item: any): DerivInstrument | null {
  const symbol = text(item?.underlying_symbol ?? item?.symbol);
  if (!symbol) return null;
  const pip = Number(item?.pip_size ?? item?.pip);
  const open = Number(item?.exchange_is_open);
  const suspended = Number(item?.is_trading_suspended);
  return {
    symbol,
    name: text(item?.underlying_symbol_name ?? item?.display_name) || symbol,
    market: text(item?.market) || 'other',
    submarket: text(item?.submarket),
    subgroup: text(item?.subgroup),
    symbolType: text(item?.underlying_symbol_type ?? item?.symbol_type) || 'unknown',
    category: classify(item),
    pipSize: Number.isFinite(pip) ? pip : undefined,
    exchangeOpen: Number.isFinite(open) ? open : undefined,
    tradingSuspended: Number.isFinite(suspended) ? suspended : undefined,
  };
}

export function sortDerivInstruments(items: DerivInstrument[]) {
  const order: Record<DerivMarketCategory, number> = {
    synthetic: 0, forex: 1, commodities: 2, indices: 3, stocks: 4, crypto: 5, other: 6,
  };
  return [...items].sort((a, b) =>
    order[a.category] - order[b.category] ||
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
    a.symbol.localeCompare(b.symbol),
  );
}

export async function fetchDerivInstruments(): Promise<DerivInstrument[]> {
  const client = new DerivMarketDataClient();
  try {
    const data = await client.request({ active_symbols: 'brief' });
    if (!Array.isArray(data?.active_symbols)) throw new Error('Deriv returned no active symbols.');
    const bySymbol = new Map<string, DerivInstrument>();
    for (const raw of data.active_symbols) {
      const item = normalizeDerivInstrument(raw);
      if (item) bySymbol.set(item.symbol, item);
    }
    return sortDerivInstruments([...bySymbol.values()]);
  } finally {
    client.close();
  }
}

export function derivBar(candle: any): DerivBar | null {
  const time = Number(candle?.epoch);
  const open = Number(candle?.open);
  const high = Number(candle?.high);
  const low = Number(candle?.low);
  const close = Number(candle?.close);
  return [time, open, high, low, close].every(Number.isFinite)
    ? { time, open, high, low, close, volume: Number(candle?.volume) || 0 }
    : null;
}

export class DerivMarketDataClient {
  private socket: WebSocket | null = null;
  private socketUrl = DERIV_WS_URL;
  private opening: Promise<WebSocket> | null = null;
  private pending = new Map<number, Pending>();
  private subscriptions = new Map<number, { symbol: string; handler: TickHandler; upstreamId?: string }>();
  private subscriptionWaiters = new Map<number, { symbol: string; resolve: (id: string) => void; reject: (reason?: unknown) => void; timer: number }>();
  private closed = false;

  private attach(socket: WebSocket) {
    socket.onmessage = event => {
      let data: any;
      try { data = JSON.parse(String(event.data)); } catch { return; }

      const reqId = Number(data?.req_id);
      if (Number.isFinite(reqId)) {
        const pending = this.pending.get(reqId);
        if (pending) {
          this.pending.delete(reqId);
          window.clearTimeout(pending.timer);
          if (data.error) pending.reject(new Error(data.error.message || 'Deriv request failed.'));
          else pending.resolve(data);
        }
      }

      if (data?.msg_type !== 'tick' || !data.tick) return;
      const symbol = text(data.tick.symbol ?? data.tick.underlying_symbol);
      const price = Number(data.tick.quote);
      const epoch = Number(data.tick.epoch);
      if (!symbol || !Number.isFinite(price) || !Number.isFinite(epoch)) return;
      const upstreamId = text(data?.subscription?.id);
      if (upstreamId) {
        for (const [token, waiter] of this.subscriptionWaiters) {
          if (waiter.symbol === symbol) {
            window.clearTimeout(waiter.timer);
            this.subscriptionWaiters.delete(token);
            waiter.resolve(upstreamId);
            break;
          }
        }
      } else {
        for (const [token, waiter] of this.subscriptionWaiters) {
          if (waiter.symbol === symbol) {
            window.clearTimeout(waiter.timer);
            this.subscriptionWaiters.delete(token);
            waiter.resolve('');
            break;
          }
        }
      }
      for (const subscription of this.subscriptions.values()) {
        if (subscription.symbol === symbol) subscription.handler({ symbol, price, epoch });
      }
    };

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      for (const [id, pending] of this.pending) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error('Deriv market-data connection closed.'));
        this.pending.delete(id);
      }
      if (!this.closed && this.subscriptions.size) {
        window.setTimeout(() => { void this.reconnectSubscriptions(); }, 500);
      }
    };

    socket.onerror = () => {};
  }

  private async ensureSocket() {
    if (this.closed) throw new Error('Deriv market-data client is closed.');
    if (this.socket?.readyState === WebSocket.OPEN) return this.socket;
    if (this.opening) return this.opening;

    this.opening = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.socketUrl);
      const timer = window.setTimeout(() => {
        socket.close();
        reject(new Error('Deriv market-data connection timed out.'));
      }, DERIV_REQUEST_TIMEOUT);
      socket.onmessage = event => {
        try {
          const data = JSON.parse(String(event.data));
          if (data?.error) {
            window.clearTimeout(timer);
            const detail = data.error.message || data.error.code || 'Unknown Deriv WebSocket error.';
            reject(new Error(`Deriv WebSocket error: ${detail}`));
            socket.close();
          }
        } catch {}
      };
      socket.onopen = () => {
        window.clearTimeout(timer);
        this.socket = socket;
        this.attach(socket);
        resolve(socket);
      };
      socket.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('Deriv market-data WebSocket connection failed before startup completed. Check the Deriv public market-data endpoint or SIRE /deriv/ws proxy.'));
      };
      socket.onclose = event => {
        window.clearTimeout(timer);
        if (event.code !== 1000 && event.reason) {
          reject(new Error(`Deriv market-data WebSocket closed (code ${event.code}): ${event.reason}`));
        } else {
          reject(new Error(`Deriv market-data WebSocket closed before startup completed (code ${event.code}).`));
        }
      };
    }).finally(() => { this.opening = null; });

    return this.opening;
  }

  async request(payload: Record<string, unknown>) {
    const socket = await this.ensureSocket();
    const req_id = nextRequestId();
    return new Promise<any>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(req_id);
        reject(new Error('Deriv market-data request timed out.'));
      }, DERIV_REQUEST_TIMEOUT);
      this.pending.set(req_id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ ...payload, req_id }));
      } catch (error) {
        window.clearTimeout(timer);
        this.pending.delete(req_id);
        reject(error);
      }
    });
  }

  async subscribeTicks(symbol: string, handler: TickHandler) {
    await this.ensureSocket();
    const subscriptionToken = nextRequestId();
    const upstreamId = await new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.subscriptionWaiters.delete(subscriptionToken);
        reject(new Error('Deriv tick subscription timed out waiting for the streaming response.'));
      }, DERIV_REQUEST_TIMEOUT);
      this.subscriptionWaiters.set(subscriptionToken, { symbol, resolve, reject, timer });
      try {
        this.socket?.send(JSON.stringify({ ticks: symbol, subscribe: 1, req_id: nextRequestId() }));
      } catch (error) {
        window.clearTimeout(timer);
        this.subscriptionWaiters.delete(subscriptionToken);
        reject(error);
      }
    });
    this.subscriptions.set(subscriptionToken, { symbol, handler, upstreamId });
    return () => {
      const subscription = this.subscriptions.get(subscriptionToken);
      this.subscriptions.delete(subscriptionToken);
      if (subscription?.upstreamId && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ forget: subscription.upstreamId, req_id: nextRequestId() }));
      }
    };
  }

  private async reconnectSubscriptions() {
    if (this.closed || !this.subscriptions.size) return;
    try {
      await this.ensureSocket();
      for (const [token, subscription] of this.subscriptions) {
        const response = await this.request({ ticks: subscription.symbol, subscribe: 1 });
        const upstreamId = text(response?.subscription?.id);
        if (upstreamId) this.subscriptions.set(token, { ...subscription, upstreamId });
      }
    } catch (error) {
      console.error('[DERIV] reconnect failed', error);
    }
  }

  close() {
    this.closed = true;
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error('Deriv market-data client closed.'));
    }
    this.pending.clear();
    for (const waiter of this.subscriptionWaiters.values()) { window.clearTimeout(waiter.timer); waiter.reject(new Error('Deriv market-data client closed.')); }
    this.subscriptionWaiters.clear();
    this.subscriptions.clear();
    this.socket?.close();
    this.socket = null;
  }
}

async function requestDerivHistorySocket(
  socketUrl: string,
  payload: Record<string, unknown>,
) {
  const req_id = nextRequestId();
  return await new Promise<any>((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    let settled = false;
    const finish = (error?: unknown, value?: any) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) reject(error);
      else resolve(value);
    };
    const timer = window.setTimeout(() => {
      finish(new Error(`Deriv history request timed out (${socketUrl}).`));
    }, DERIV_REQUEST_TIMEOUT);
    socket.onopen = () => {
      try {
        socket.send(JSON.stringify({ ...payload, req_id }));
      } catch (error) {
        finish(error);
      }
    };
    socket.onmessage = event => {
      try {
        const data = JSON.parse(String(event.data));
        if (Number(data?.req_id) !== req_id) return;
        if (data?.error) {
          finish(new Error(data.error.message || data.error.code || 'Deriv history request failed.'));
          return;
        }
        finish(undefined, data);
      } catch (error) {
        finish(error);
      }
    };
    socket.onerror = () => finish(new Error(`Deriv history WebSocket failed (${socketUrl}).`));
    socket.onclose = event => {
      if (!settled && event.code !== 1000) {
        finish(new Error(`Deriv history WebSocket closed unexpectedly (code ${event.code}).`));
      }
    };
  });
}

async function fetchDerivHistoryPage(symbol: string, seconds: number, end: number | 'latest', count: number) {
  const payload = {
    symbol,
    end,
    count,
    granularity: seconds,
  };

  // Progressive history runs through SIRE's server-side Deriv adapter first.
  // This avoids browser WebSocket/runtime differences on older-history calls
  // while keeping the live tick stream on the existing direct WebSocket client.
  if (typeof window !== 'undefined') {
    try {
      // Use XHR for this one-shot endpoint instead of fetch/Response methods.
      // Some browser/runtime combinations can throw an internal ".call is not
      // a function" while invoking fetch/Response methods. XHR avoids that
      // runtime path and gives us the raw response text directly.
      const data = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const timer = window.setTimeout(() => {
          xhr.abort();
          reject(new Error('SIRE Deriv history endpoint timed out after 20 seconds.'));
        }, DERIV_REQUEST_TIMEOUT);
        xhr.open('POST', '/api/sire/deriv/history', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Cache-Control', 'no-cache');
        xhr.onreadystatechange = () => {
          if (xhr.readyState !== XMLHttpRequest.DONE) return;
          window.clearTimeout(timer);
          const status = xhr.status;
          const rawBody = xhr.responseText || '';
          let parsed: any = {};
          try {
            parsed = rawBody ? JSON.parse(rawBody) : {};
          } catch {
            reject(new Error(`SIRE Deriv history endpoint returned invalid JSON (HTTP ${status}).`));
            return;
          }
          if (status < 200 || status >= 300 || parsed?.error) {
            reject(new Error(parsed?.error || `SIRE Deriv history endpoint returned HTTP ${status}.`));
            return;
          }
          resolve(parsed);
        };
        xhr.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error('SIRE Deriv history endpoint network request failed.'));
        };
        xhr.onabort = () => {
          window.clearTimeout(timer);
          reject(new Error('SIRE Deriv history endpoint request was aborted.'));
        };
        try {
          xhr.send(JSON.stringify(payload));
        } catch (error) {
          window.clearTimeout(timer);
          reject(error);
        }
      });
      return data;
    } catch (serverError) {
      // Fall back to a direct browser request if the SIRE adapter is unavailable.
      try {
        return await requestDerivHistorySocket(DERIV_DIRECT_WS_URL, {
          ticks_history: symbol,
          end,
          count,
          style: 'candles',
          granularity: seconds,
          adjust_start_time: 1,
        });
      } catch (directError) {
        const server = serverError instanceof Error ? serverError.message : String(serverError);
        const direct = directError instanceof Error ? directError.message : String(directError);
        throw new Error(`Deriv history failed through SIRE and direct WebSocket. Server: ${server}. Direct: ${direct}.`);
      }
    }
  }

  return await requestDerivHistorySocket(DERIV_DIRECT_WS_URL, {
    ticks_history: symbol,
    end,
    count,
    style: 'candles',
    granularity: seconds,
    adjust_start_time: 1,
  });
}

export async function fetchAllDerivHistory(symbol: string, interval: string, maxBars = DERIV_INITIAL_BARS) {
  const seconds = DERIV_INTERVAL_SECONDS[interval];
  if (!seconds) throw new Error(`Unsupported Deriv interval: ${interval}`);
  const all: DerivBar[] = [];
  let end: number | 'latest' = 'latest';
  let previousOldest = Infinity;
  while (all.length < maxBars) {
    const count = Math.min(DERIV_PAGE_SIZE, maxBars - all.length);
    const data = await fetchDerivHistoryPage(symbol, seconds, end, count);
    const page = Array.isArray(data?.candles)
      ? data.candles.map(derivBar).filter(Boolean) as DerivBar[]
      : [];
    page.sort((a, b) => a.time - b.time);
    if (!page.length) break;
    const seen = new Set(all.map(bar => bar.time));
    for (const bar of page) if (!seen.has(bar.time)) all.push(bar);
    all.sort((a, b) => a.time - b.time);
    const oldest = page[0].time;
    // Deriv can legitimately return a short page for a timeframe (notably D1)
    // even when older candles still exist. Do not treat a short page as the
    // end of history: keep paging backwards until the requested startup
    // window is filled, the API returns no candles, or the oldest timestamp
    // stops moving.
    if (oldest <= 0 || oldest >= previousOldest) break;
    previousOldest = oldest;
    end = Math.max(1, oldest - 1);
  }
  return all.slice(-maxBars);
}

export async function fetchOlderDerivHistory(symbol: string, interval: string, end: number, count = DERIV_PAGE_SIZE, onProgress?: (progress: DerivHistoryProgress) => void) {
  const seconds = DERIV_INTERVAL_SECONDS[interval];
  if (!seconds) throw new Error(`Unsupported Deriv interval: ${interval}`);
  const safeEnd = Math.max(1, Math.floor(end));
  const data = await fetchDerivHistoryPage(symbol, seconds, safeEnd, count);
  const raw = Array.isArray(data?.candles) ? data.candles : [];
  const bars = raw.map(derivBar).filter(Boolean) as DerivBar[];
  bars.sort((a, b) => a.time - b.time);
  onProgress?.({
    phase: 'older', requested: count, received: raw.length, valid: bars.length,
    oldestTime: bars[0]?.time ?? null, newestTime: bars[bars.length - 1]?.time ?? null, end: safeEnd,
  });
  return bars;
}

export function tickToBar(previous: DerivBar | null, epoch: number, price: number, seconds: number): DerivBar {
  const time = Math.floor(epoch / seconds) * seconds;
  if (!previous || time > previous.time) return { time, open: price, high: price, low: price, close: price, volume: 0 };
  if (time < previous.time) return previous;
  return { ...previous, high: Math.max(previous.high, price), low: Math.min(previous.low, price), close: price };
}

export function createDerivDataFeed(
  onQuote?: (quote: { symbol: string; price: number; epoch: number }) => void,
  onDiagnostic?: DiagnosticHandler,
) {
  const client = new DerivMarketDataClient();
  return {
    async getBars({ symbol, interval }: { symbol: string; interval: string }) {
      onDiagnostic?.({ level: 'info', code: 'HISTORY_REQUEST_STARTED', message: `Loading ${interval} historical candles for ${symbol}.` });
      try {
        const bars = await fetchAllDerivHistory(symbol, interval, DERIV_INITIAL_BARS);
        if (!bars.length) {
          const error = new Error(`Deriv returned no historical candles for ${symbol} ${interval}.`);
          onDiagnostic?.({ level: 'error', code: 'HISTORY_EMPTY', message: error.message, detail: 'The request completed, but no usable OHLC candles were returned.' });
          throw error;
        }
        onDiagnostic?.({
          level: bars.length >= DERIV_INITIAL_BARS ? 'info' : 'warning',
          code: 'HISTORY_INITIAL_WINDOW',
          message: `Loaded ${bars.length} startup candles for ${symbol} ${interval}.`,
          detail: bars.length >= DERIV_INITIAL_BARS
            ? `Requested ${DERIV_INITIAL_BARS}; the startup window is full. Older candles are fetched progressively as the chart moves toward the left edge.`
            : `Requested ${DERIV_INITIAL_BARS}; only ${bars.length} usable candles were available after paging backward. The loader will not manufacture candles.`,
        });
        onDiagnostic?.({ level: 'info', code: 'HISTORY_LOADED', message: `Loaded ${bars.length} historical candles for ${symbol} ${interval}.`, detail: `Initial target: ${DERIV_INITIAL_BARS}. Progressive older-history loading is available.` });
        return bars;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onDiagnostic?.({ level: 'error', code: 'HISTORY_LOAD_FAILED', message: `Historical candles failed for ${symbol} ${interval}: ${message}`, detail: 'The chart cannot build reliable history until this request succeeds.' });
        throw error;
      }
    },
    subscribeBars(
      { symbol, interval }: { symbol: string; interval: string },
      onBar: (bar: DerivBar) => void,
      options?: { seedFrom?: DerivBar },
    ) {
      const seconds = DERIV_INTERVAL_SECONDS[interval];
      if (!seconds) throw new Error(`Unsupported Deriv interval: ${interval}`);
      let stopped = false;
      let current = options?.seedFrom ? { ...options.seedFrom } : null;
      let unsubscribe: (() => void) | null = null;
      const start = async () => {
        try {
          unsubscribe = await client.subscribeTicks(symbol, tick => {
            if (stopped) return;
            const next = tickToBar(current, tick.epoch, tick.price, seconds);
            current = next;
            onQuote?.(tick);
            onBar({ ...next });
          });
        } catch (error) {
          if (!stopped) {
            const message = error instanceof Error ? error.message : String(error);
            onDiagnostic?.({ level: 'error', code: 'LIVE_TICK_SUBSCRIPTION_FAILED', message: `Live price subscription failed for ${symbol}: ${message}`, detail: 'Historical candles may still be available, but live price updates are not healthy.' });
            console.error('[DERIV TICKS]', symbol, error);
          }
        }
      };
      void start();
      return () => {
        stopped = true;
        unsubscribe?.();
        // Do not close the shared client here. OpenAlgo can tear down and
        // recreate a bar subscription during symbol/timeframe changes. Closing
        // the client makes the next subscription permanently fail with
        // "Deriv market-data client is closed". The feed owns the client and
        // closes it only when the whole feed is destroyed.
      };
    },
    close() { client.close(); },
  };
}
