export type DerivInstrument = {
  symbol: string;
  name: string;
  market: string;
  submarket: string;
  subgroup: string;
  symbolType: string;
  exchangeOpen?: number;
};

export type DerivTick = {
  symbol: string;
  quote: number;
  bid?: number;
  ask?: number;
  epoch: number;
  id?: string;
  source: 'Deriv';
};

export type DerivResponse = Record<string, any>;

type Pending = {
  resolve: (value: DerivResponse) => void;
  reject: (error: Error) => void;
  timer: number;
};

const ENDPOINT = 'wss://ws.binaryws.com/websockets/v3';

function messageText(data: unknown): Promise<string> {
  if (typeof data === 'string') return Promise.resolve(data);
  if (data instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(data));
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  return Promise.reject(new Error('Unsupported Deriv WebSocket message format'));
}

function isSynthetic(item: Record<string, unknown>): boolean {
  const symbol = String(item.underlying_symbol || item.symbol || '');
  const market = String(item.market || '').toLowerCase();
  const submarket = String(item.submarket || '').toLowerCase();
  const subgroup = String(item.subgroup || '').toLowerCase();
  const type = String(item.underlying_symbol_type || item.symbol_type || '').toLowerCase();
  const text = [symbol, item.underlying_symbol_name, item.display_name, market, submarket, subgroup, type]
    .filter(value => value !== undefined && value !== null)
    .map(String)
    .join(' ')
    .toLowerCase();

  return (
    market === 'synthetic_index' ||
    market === 'synthetic indices' ||
    submarket.includes('synthetic') ||
    subgroup.includes('synthetic') ||
    type.includes('synthetic') ||
    /synthetic index|volatility|boom|crash|jump|step|drift|range break|daily reset|bull market|bear market|random index/.test(text) ||
    /^(r_|1hz|boom|crash|step|jump|drift|range_break|bull|bear)/i.test(symbol)
  );
}

function normalize(item: Record<string, unknown>): DerivInstrument | null {
  const symbol = String(item.underlying_symbol || item.symbol || '').trim();
  if (!symbol) return null;
  return {
    symbol,
    name: String(item.underlying_symbol_name || item.display_name || symbol),
    market: String(item.market || ''),
    submarket: String(item.submarket || ''),
    subgroup: String(item.subgroup || ''),
    symbolType: String(item.underlying_symbol_type || item.symbol_type || ''),
    exchangeOpen: typeof item.exchange_is_open === 'number' ? item.exchange_is_open : undefined,
  };
}

export class DerivMarketData {
  private socket: WebSocket | null = null;
  private pending = new Map<number, Pending>();
  private nextReqId = 1;
  private listeners = new Set<(tick: DerivTick) => void>();
  private statusListeners = new Set<(status: 'connecting' | 'connected' | 'closed' | 'error') => void>();
  private reconnectTimer = 0;
  private closedByUser = false;

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    this.closedByUser = false;
    this.emitStatus('connecting');
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(ENDPOINT);
      this.socket = socket;
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch { /* ignore */ }
        reject(new Error('Deriv WebSocket connection timed out'));
      }, 15000);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.emitStatus('connected');
        resolve();
      };
      socket.onerror = () => {
        this.emitStatus('error');
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          reject(new Error('Deriv WebSocket connection failed'));
        }
      };
      socket.onclose = event => {
        this.emitStatus('closed');
        this.rejectPending(new Error(`Deriv WebSocket closed (${event.code}${event.reason ? `: ${event.reason}` : ''})`));
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          reject(new Error(`Deriv WebSocket closed before connection (${event.code})`));
        }
        if (!this.closedByUser && this.socket === socket) this.scheduleReconnect();
      };
      socket.onmessage = event => {
        void messageText(event.data).then(text => {
          let data: DerivResponse;
          try { data = JSON.parse(text) as DerivResponse; }
          catch { return; }
          if (data.msg_type === 'tick' && data.tick) {
            const raw = data.tick as Record<string, unknown>;
            const tick: DerivTick = {
              symbol: String(raw.symbol || raw.underlying_symbol || ''),
              quote: Number(raw.quote),
              bid: Number.isFinite(Number(raw.bid)) ? Number(raw.bid) : undefined,
              ask: Number.isFinite(Number(raw.ask)) ? Number(raw.ask) : undefined,
              epoch: Number(raw.epoch),
              id: raw.id ? String(raw.id) : undefined,
              source: 'Deriv',
            };
            if (tick.symbol && Number.isFinite(tick.quote) && Number.isFinite(tick.epoch)) {
              this.listeners.forEach(listener => listener(tick));
            }
          }
          const reqId = Number(data.req_id);
          const waiter = this.pending.get(reqId);
          if (!waiter) return;
          window.clearTimeout(waiter.timer);
          this.pending.delete(reqId);
          if (data.error) {
            const error = data.error as Record<string, unknown>;
            waiter.reject(new Error(String(error.message || 'Deriv API error')));
          } else {
            waiter.resolve(data);
          }
        }).catch(() => undefined);
      };
    });
  }

  async request(request: Record<string, unknown>): Promise<DerivResponse> {
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Deriv WebSocket is not connected');
    const reqId = this.nextReqId++;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`Deriv request timed out (${String(request.active_symbols ? 'active_symbols' : request.ticks_history ? 'ticks_history' : request.ticks ? 'ticks' : 'request')})`));
      }, 15000);
      this.pending.set(reqId, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ ...request, req_id: reqId }));
      } catch (error) {
        window.clearTimeout(timer);
        this.pending.delete(reqId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async getSyntheticIndices(): Promise<DerivInstrument[]> {
    const response = await this.request({ active_symbols: 'brief' });
    const records = Array.isArray(response.active_symbols)
      ? response.active_symbols.filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      : [];
    const instruments = Array.from(
      new Map(
        records.filter(isSynthetic).map(normalize).filter((item): item is DerivInstrument => Boolean(item)).map(item => [item.symbol, item]),
      ).values(),
    );
    if (!instruments.length) throw new Error(`Deriv returned ${records.length} active symbols, but no Synthetic Indices were found`);
    return instruments.sort((a, b) => a.name.localeCompare(b.name));
  }

  subscribe(symbol: string): Promise<DerivResponse> {
    return this.request({ ticks: symbol, subscribe: 1 });
  }

  history(symbol: string, granularity: number): Promise<DerivResponse> {
    return this.request({ ticks_history: symbol, end: 'latest', count: 1500, style: 'candles', granularity, subscribe: 0 });
  }

  onTick(listener: (tick: DerivTick) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: 'connecting' | 'connected' | 'closed' | 'error') => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  close(): void {
    this.closedByUser = true;
    window.clearTimeout(this.reconnectTimer);
    this.rejectPending(new Error('Deriv client closed'));
    try { this.socket?.close(); } catch { /* ignore */ }
    this.socket = null;
  }

  private emitStatus(status: 'connecting' | 'connected' | 'closed' | 'error') {
    this.statusListeners.forEach(listener => listener(status));
  }

  private rejectPending(error: Error) {
    this.pending.forEach(waiter => {
      window.clearTimeout(waiter.timer);
      waiter.reject(error);
    });
    this.pending.clear();
  }

  private scheduleReconnect() {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      if (!this.closedByUser) void this.connect().catch(() => this.scheduleReconnect());
    }, 1500);
  }
}

export const derivMarketData = new DerivMarketData();
