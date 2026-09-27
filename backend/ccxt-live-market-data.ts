import ccxt from 'ccxt';

type LiveQuote = {
  exchange: string;
  exchangeName: string;
  symbol: string;
  price: number;
  epoch: number;
  bid?: number;
  ask?: number;
  volume?: number;
  source: 'ws-ticker' | 'ws-trade' | 'rest-ticker' | 'rest-ohlcv';
};

type StreamState = {
  key: string;
  exchangeId: string;
  symbol: string;
  exchange: any;
  quote: LiveQuote | null;
  startedAt: number;
  lastAccess: number;
  lastUpdate: number;
  status: 'starting' | 'streaming' | 'polling' | 'error' | 'stopped';
  error?: string;
  stop?: boolean;
  loop?: Promise<void>;
};

const streams = new Map<string, StreamState>();
const REST_POLL_MS = 3000;
const STALE_STREAM_MS = 15 * 60 * 1000;

function keyOf(exchangeId: string, symbol: string) {
  return String(exchangeId || '').trim().toLowerCase() + ':' + String(symbol || '').trim();
}

function makeExchange(exchangeId: string, pro = false) {
  const id = String(exchangeId || '').trim().toLowerCase();
  const factory = pro ? (ccxt as any).pro?.[id] : (ccxt as any)[id];
  if (!factory) throw new Error('CCXT exchange "' + id + '" is not available in this build.');
  return new factory({ enableRateLimit: true, timeout: 20000, ...(pro ? { newUpdates: true } : {}) });
}

async function loadMarkets(exchange: any) {
  if (!exchange.markets) await exchange.loadMarkets();
  return exchange;
}

function validQuote(exchange: any, symbol: string, raw: any, source: LiveQuote['source']): LiveQuote | null {
  const price = Number(raw?.last ?? raw?.close ?? raw?.price);
  const timestamp = Number(raw?.timestamp ?? raw?.datetime ? Date.parse(raw.datetime) : NaN);
  const epoch = Number.isFinite(timestamp) && timestamp > 0 ? timestamp / 1000 : Date.now() / 1000;
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    exchange: exchange.id,
    exchangeName: exchange.name || exchange.id,
    symbol,
    price,
    epoch,
    bid: Number.isFinite(Number(raw?.bid)) ? Number(raw.bid) : undefined,
    ask: Number.isFinite(Number(raw?.ask)) ? Number(raw.ask) : undefined,
    volume: Number.isFinite(Number(raw?.baseVolume ?? raw?.amount)) ? Number(raw.baseVolume ?? raw.amount) : undefined,
    source,
  };
}

function tradeQuote(exchange: any, symbol: string, trade: any): LiveQuote | null {
  const price = Number(trade?.price);
  const epoch = Number(trade?.timestamp);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    exchange: exchange.id,
    exchangeName: exchange.name || exchange.id,
    symbol,
    price,
    epoch: Number.isFinite(epoch) ? epoch / 1000 : Date.now() / 1000,
    volume: Number.isFinite(Number(trade?.amount)) ? Number(trade.amount) : undefined,
    source: 'ws-trade',
  };
}

async function restQuote(state: StreamState) {
  const exchange = await loadMarkets(state.exchange);
  const market = exchange.market(state.symbol);
  if (!market) throw new Error('Market "' + state.symbol + '" was not found on ' + exchange.name + '.');

  if (exchange.has?.fetchTicker) {
    try {
      const ticker = await exchange.fetchTicker(state.symbol);
      const quote = validQuote(exchange, state.symbol, ticker, 'rest-ticker');
      if (quote) return quote;
    } catch {}
  }

  if (exchange.has?.fetchOHLCV) {
    const rows = await exchange.fetchOHLCV(state.symbol, '1m', undefined, 2);
    const row = Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
    const price = Number(row?.[4]);
    const epoch = Number(row?.[0]);
    if (Number.isFinite(price) && price > 0) {
      return {
        exchange: exchange.id,
        exchangeName: exchange.name || exchange.id,
        symbol: state.symbol,
        price,
        epoch: (Number.isFinite(epoch) ? epoch : Date.now()) / 1000,
        volume: Number.isFinite(Number(row?.[5])) ? Number(row[5]) : undefined,
        source: 'rest-ohlcv',
      } as LiveQuote;
    }
  }

  throw new Error(exchange.name + ' has no usable public ticker/trade/OHLCV live-data method for ' + state.symbol + '.');
}

async function streamLoop(state: StreamState) {
  const pro = (ccxt as any).pro;
  if (!pro?.[state.exchangeId]) {
    state.status = 'polling';
    while (!state.stop) {
      try {
        state.quote = await restQuote(state);
        state.lastUpdate = Date.now();
        state.error = undefined;
      } catch (error) {
        state.status = 'error';
        state.error = error instanceof Error ? error.message : String(error);
      }
      if (state.stop) break;
      await new Promise(resolve => setTimeout(resolve, REST_POLL_MS));
    }
    return;
  }

  const exchange = state.exchange;
  try {
    await loadMarkets(exchange);
    const market = exchange.market(state.symbol);
    if (!market) throw new Error('Market "' + state.symbol + '" was not found on ' + exchange.name + '.');

    const hasTicker = Boolean(exchange.has?.watchTicker);
    const hasTrades = Boolean(exchange.has?.watchTrades);
    if (!hasTicker && !hasTrades) {
      state.status = 'polling';
      while (!state.stop) {
        try {
          state.quote = await restQuote(state);
          state.lastUpdate = Date.now();
          state.error = undefined;
          state.status = 'polling';
        } catch (error) {
          state.status = 'error';
          state.error = error instanceof Error ? error.message : String(error);
        }
        if (state.stop) break;
        await new Promise(resolve => setTimeout(resolve, REST_POLL_MS));
      }
      return;
    }

    state.status = 'streaming';
    while (!state.stop) {
      try {
        if (hasTicker) {
          const ticker = await exchange.watchTicker(state.symbol);
          const quote = validQuote(exchange, state.symbol, ticker, 'ws-ticker');
          if (!quote) throw new Error('WebSocket ticker update contained no valid price.');
          state.quote = quote;
        } else {
          const trades = await exchange.watchTrades(state.symbol);
          const trade = Array.isArray(trades) && trades.length ? trades[trades.length - 1] : null;
          const quote = tradeQuote(exchange, state.symbol, trade);
          if (!quote) throw new Error('WebSocket trade update contained no valid price.');
          state.quote = quote;
        }
        state.status = 'streaming';
        state.lastUpdate = Date.now();
        state.error = undefined;
      } catch (error) {
        if (state.stop) break;
        state.status = 'error';
        state.error = error instanceof Error ? error.message : String(error);
        await new Promise(resolve => setTimeout(resolve, 1500));
        try { await exchange.close?.(); } catch {}
        try { state.exchange = makeExchange(state.exchangeId, true); } catch {}
      }
    }
  } catch (error) {
    state.status = 'error';
    state.error = error instanceof Error ? error.message : String(error);
  }
}

function ensureStream(exchangeId: string, symbol: string) {
  const key = keyOf(exchangeId, symbol);
  let state = streams.get(key);
  if (state) {
    state.lastAccess = Date.now();
    return state;
  }

  const id = String(exchangeId || '').trim().toLowerCase();
  const sym = String(symbol || '').trim();
  const pro = (ccxt as any).pro?.[id];
  let exchange: any;
  try {
    exchange = pro ? makeExchange(id, true) : makeExchange(id, false);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  state = {
    key,
    exchangeId: id,
    symbol: sym,
    exchange,
    quote: null,
    startedAt: Date.now(),
    lastAccess: Date.now(),
    lastUpdate: 0,
    status: 'starting',
  };
  streams.set(key, state);
  state.loop = streamLoop(state).catch(error => {
    state!.status = 'error';
    state!.error = error instanceof Error ? error.message : String(error);
  });
  return state;
}

export async function getCcxtLiveQuote(exchangeId: string, symbol: string) {
  const state = ensureStream(exchangeId, symbol);
  state.lastAccess = Date.now();

  if (!state.quote) {
    // Give a newly-created stream a short opportunity to receive its first
    // websocket update; REST is only a bootstrap fallback.
    try { state.quote = await restQuote(state); state.lastUpdate = Date.now(); } catch {}
  }

  if (!state.quote) throw new Error(state.error || 'No live quote has been received yet for ' + exchangeId + ' ' + symbol + '.');
  return {
    ...state.quote,
    stream: {
      status: state.status,
      lastUpdate: state.lastUpdate,
      dataAgeMs: Math.max(0, Date.now() - state.quote.epoch * 1000),
      stale: Date.now() - state.quote.epoch * 1000 > 15000,
      websocket: state.status === 'streaming',
      error: state.error || null,
    },
  };
}

export function getCcxtLiveStatus(exchangeId?: string, symbol?: string) {
  const rows = [...streams.values()]
    .filter(s => !exchangeId || s.exchangeId === String(exchangeId).toLowerCase())
    .filter(s => !symbol || s.symbol === symbol)
    .map(s => ({
      exchange: s.exchangeId,
      symbol: s.symbol,
      status: s.status,
      websocket: s.status === 'streaming',
      source: s.quote?.source || null,
      lastUpdate: s.lastUpdate || null,
      dataAgeMs: s.quote ? Math.max(0, Date.now() - s.quote.epoch * 1000) : null,
      stale: s.quote ? Date.now() - s.quote.epoch * 1000 > 15000 : true,
      error: s.error || null,
    }));
  return { count: rows.length, streams: rows };
}

export function getCcxtExchangeRuntime() {
  const all = Array.isArray((ccxt as any).exchanges) ? (ccxt as any).exchanges : [];
  const pro = (ccxt as any).pro;
  return {
    ccxtVersion: (ccxt as any).version || null,
    exchangeCount: all.length,
    websocketExchangeCount: pro ? Object.keys(pro).filter(k => all.includes(k)).length : 0,
    exchanges: all.map((id: string) => ({
      id,
      name: (ccxt as any)[id]?.name || id,
      rest: true,
      websocket: Boolean(pro?.[id]),
    })),
  };
}

export function stopCcxtLiveStream(exchangeId: string, symbol: string) {
  const key = keyOf(exchangeId, symbol);
  const state = streams.get(key);
  if (!state) return false;
  state.stop = true;
  try { state.exchange?.close?.(); } catch {}
  streams.delete(key);
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - STALE_STREAM_MS;
  for (const [key, state] of streams) {
    if (state.lastAccess < cutoff) {
      state.stop = true;
      try { state.exchange?.close?.(); } catch {}
      streams.delete(key);
    }
  }
}, 60000).unref?.();
