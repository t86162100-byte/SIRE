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

const DERIV_WS = 'wss://ws.binaryws.com/websockets/v3';

function readText(data: unknown): Promise<string> {
  if (typeof data === 'string') return Promise.resolve(data);
  if (data instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(data));
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  return Promise.reject(new Error('Unsupported Deriv WebSocket message'));
}

function textValue(item: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function isSynthetic(item: Record<string, unknown>): boolean {
  const symbol = textValue(item, 'underlying_symbol', 'symbol');
  const market = textValue(item, 'market').toLowerCase();
  const submarket = textValue(item, 'submarket').toLowerCase();
  const subgroup = textValue(item, 'subgroup').toLowerCase();
  const type = textValue(item, 'underlying_symbol_type', 'symbol_type').toLowerCase();
  const name = textValue(item, 'underlying_symbol_name', 'display_name').toLowerCase();
  const text = `${symbol} ${name} ${market} ${submarket} ${subgroup} ${type}`;
  return market.includes('synthetic') ||
    submarket.includes('synthetic') ||
    subgroup.includes('synthetic') ||
    type.includes('synthetic') ||
    /volatility|boom|crash|jump|step|drift|range break|daily reset|bull market|bear market|random index/.test(text) ||
    /^(r_|1hz|boom|crash|step|jump|drift|range_break|bull|bear)/i.test(symbol);
}

function normalizeInstrument(item: Record<string, unknown>): DerivInstrument | null {
  const symbol = textValue(item, 'underlying_symbol', 'symbol');
  if (!symbol) return null;
  const pip = Number(item.pip_size ?? item.pip);
  return {
    symbol,
    name: textValue(item, 'underlying_symbol_name', 'display_name') || symbol,
    market: textValue(item, 'market'),
    submarket: textValue(item, 'submarket'),
    subgroup: textValue(item, 'subgroup'),
    symbolType: textValue(item, 'underlying_symbol_type', 'symbol_type'),
    pipSize: Number.isFinite(pip) && pip > 0 ? pip : undefined,
    exchangeOpen: Number.isFinite(Number(item.exchange_is_open)) ? Number(item.exchange_is_open) : undefined,
  };
}

export class DerivMarketData {
  private socket: WebSocket | null = null;
  private pending = new Map<number, Pending>();
  private nextRequestId = 1;
  private tickListeners = new Set<(tick: DerivTick) => void>();
  private statusListeners = new Set<(status: 'connecting' | 'connected' | 'closed' | 'error') => void>();
  private reconnectTimer = 0;
  private closed = false;

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    this.closed = false;
    this.emitStatus('connecting');
    await new Promise<void>((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(DERIV_WS);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.socket = socket;
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch {}
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
        if (!this.closed && this.socket === socket) this.scheduleReconnect();
      };

      socket.onmessage = event => {
        void readText(event.data).then(raw => {
          let data: DerivResponse;
          try { data = JSON.parse(raw); } catch { return; }

          if (data.msg_type === 'tick' && data.tick) {
            const rawTick = data.tick as Record<string, unknown>;
            const tick: DerivTick = {
              symbol: String(rawTick.symbol || ''),
              quote: Number(rawTick.quote),
              bid: Number.isFinite(Number(rawTick.bid)) ? Number(rawTick.bid) : undefined,
              ask: Number.isFinite(Number(rawTick.ask)) ? Number(rawTick.ask) : undefined,
              epoch: Number(rawTick.epoch),
              id: rawTick.id ? String(rawTick.id) : undefined,
              source: 'Deriv',
            };
            if (tick.symbol && Number.isFinite(tick.quote) && Number.isFinite(tick.epoch)) {
              this.tickListeners.forEach(listener => listener(tick));
            }
          }

          const requestId = Number(data.req_id);
          const pending = this.pending.get(requestId);
          if (!pending) return;
          window.clearTimeout(pending.timer);
          this.pending.delete(requestId);
          if (data.error) {
            const error = data.error as Record<string, unknown>;
            pending.reject(new Error(String(error.message || 'Deriv API error')));
          } else {
            pending.resolve(data);
          }
        }).catch(() => undefined);
      };
    });
  }

  async request(request: Record<string, unknown>): Promise<DerivResponse> {
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Deriv WebSocket is not connected');

    const reqId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(reqId);
        const operation = request.active_symbols ? 'active_symbols' : request.ticks_history ? 'ticks_history' : request.ticks ? 'ticks' : 'request';
        reject(new Error(`Deriv ${operation} request timed out`));
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
    const response = await this.request({
      active_symbols: 'brief',
    });
    const records = Array.isArray(response.active_symbols)
      ? response.active_symbols.filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      : [];
    if (!records.length) throw new Error('Deriv returned no active symbols.');

    const instruments = Array.from(
      new Map(
        records
          .filter(isSynthetic)
          .map(normalizeInstrument)
          .filter((item): item is DerivInstrument => Boolean(item))
          .map(item => [item.symbol, item]),
      ).values(),
    ).sort((a, b) => a.name.localeCompare(b.name));

    if (!instruments.length) throw new Error('Deriv returned active symbols, but no Synthetic Indices matched.');
    return instruments;
  }

  subscribe(symbol: string): Promise<DerivResponse> {
    return this.request({ ticks: symbol, subscribe: 1 });
  }

  async forget(subscriptionId: string): Promise<void> {
    await this.request({ forget: subscriptionId });
  }

  async history(symbol: string, granularity: number, end?: number | 'latest', count = 5000): Promise<DerivResponse> {
    const response = await this.request({
      ticks_history: symbol,
      end: end ?? 'latest',
      count: Math.min(Math.max(Math.floor(count), 1), 5000),
      style: 'candles',
      granularity,
      adjust_start_time: 1,
      subscribe: 0,
    });
    if (response.error) {
      const error = response.error as Record<string, unknown>;
      throw new Error(`Deriv historical candles failed: ${String(error.message || 'Unknown API error')}`);
    }
    return response;
  }

  onTick(listener: (tick: DerivTick) => void): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  onStatus(listener: (status: 'connecting' | 'connected' | 'closed' | 'error') => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    window.clearTimeout(this.reconnectTimer);
    this.rejectPending(new Error('Deriv client closed'));
    try { this.socket?.close(); } catch {}
    this.socket = null;
  }

  private emitStatus(status: 'connecting' | 'connected' | 'closed' | 'error') {
    this.statusListeners.forEach(listener => listener(status));
  }

  private rejectPending(error: Error) {
    this.pending.forEach(item => {
      window.clearTimeout(item.timer);
      item.reject(error);
    });
    this.pending.clear();
  }

  private scheduleReconnect() {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      if (!this.closed) void this.connect().catch(() => this.scheduleReconnect());
    }, 1500);
  }
}

export const derivMarketData = new DerivMarketData();
