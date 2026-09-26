import { WebSocket } from 'ws';

const DERIV_PUBLIC_WS = 'wss://api.derivws.com/trading/v1/options/ws/public';
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const CANDLE_SECONDS = 60;
const MAX_SYMBOLS = 10;

function log(event, data = {}) {
  console.log(JSON.stringify({
    service: 'sire-autonomous-market-worker',
    event,
    at: new Date().toISOString(),
    ...data,
  }));
}

function parseSymbols() {
  const raw = String(process.env.SIRE_AUTONOMOUS_SYMBOLS || 'WLDAUD').trim();
  const symbols = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];
  if (!symbols.length) throw new Error('SIRE_AUTONOMOUS_SYMBOLS must contain at least one symbol.');
  if (symbols.length > MAX_SYMBOLS) {
    throw new Error(`SIRE_AUTONOMOUS_SYMBOLS may contain at most ${MAX_SYMBOLS} symbols in Step 1.`);
  }
  return symbols;
}

const requestedSymbols = parseSymbols();
const state = new Map();
let ws = null;
let pingTimer = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let shuttingDown = false;
let requestId = 0;

function ensureSymbolState(symbol) {
  if (!state.has(symbol)) {
    state.set(symbol, {
      symbol,
      subscribed: false,
      tickCount: 0,
      latestPrice: null,
      latestEpoch: null,
      lastTickReceivedAt: null,
      currentCandle: null,
      candles: [],
    });
  }
  return state.get(symbol);
}

function updateCandle(symbol, epoch, price) {
  const s = ensureSymbolState(symbol);
  const bucket = Math.floor(epoch / CANDLE_SECONDS) * CANDLE_SECONDS;
  let candle = s.currentCandle;

  if (!candle) {
    candle = { epoch: bucket, open: price, high: price, low: price, close: price, ticks: 1 };
    s.currentCandle = candle;
    return;
  }

  if (bucket < candle.epoch) {
    // Late/out-of-order ticks are not allowed to mutate an already closed
    // candle in Step 1. They remain observable through tick telemetry.
    return;
  }

  if (bucket > candle.epoch) {
    s.candles.push({ ...candle });
    if (s.candles.length > 200) s.candles.shift();

    candle = { epoch: bucket, open: price, high: price, low: price, close: price, ticks: 1 };
    s.currentCandle = candle;

    log('candle.closed', {
      symbol,
      timeframe: '1m',
      candle: candle,
      retainedCandles: s.candles.length,
    });
    return;
  }

  candle.high = Math.max(candle.high, price);
  candle.low = Math.min(candle.low, price);
  candle.close = price;
  candle.ticks += 1;
}

function send(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Deriv WebSocket is not open.');
  }
  ws.send(JSON.stringify(payload));
}

function clearTimers() {
  if (pingTimer) clearInterval(pingTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  pingTimer = null;
  heartbeatTimer = null;
  reconnectTimer = null;
}

function resetConnectionState() {
  for (const symbol of requestedSymbols) {
    ensureSymbolState(symbol).subscribed = false;
  }
}

function scheduleReconnect(reason) {
  if (shuttingDown || reconnectTimer) return;

  const exponential = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_MIN_MS * (2 ** Math.min(reconnectAttempt, 5)),
  );
  const jitter = Math.floor(Math.random() * 500);
  const delay = Math.min(RECONNECT_MAX_MS, exponential + jitter);

  reconnectAttempt += 1;
  log('connection.reconnect_scheduled', {
    reason,
    attempt: reconnectAttempt,
    delayMs: delay,
  });

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function startTimers() {
  clearTimers();

  pingTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      send({ ping: 1, req_id: ++requestId });
    } catch (error) {
      log('connection.ping_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, PING_INTERVAL_MS);

  heartbeatTimer = setInterval(() => {
    const symbols = [...state.values()].map(s => ({
      symbol: s.symbol,
      subscribed: s.subscribed,
      tickCount: s.tickCount,
      latestPrice: s.latestPrice,
      latestEpoch: s.latestEpoch,
      lastTickReceivedAt: s.lastTickReceivedAt,
      currentCandle: s.currentCandle,
      candleCount: s.candles.length,
    }));

    log('worker.heartbeat', {
      connection: ws?.readyState === WebSocket.OPEN ? 'open' : 'closed',
      reconnectAttempt,
      symbols,
    });
  }, HEARTBEAT_INTERVAL_MS);
}

function handleActiveSymbols(message) {
  const active = Array.isArray(message.active_symbols) ? message.active_symbols : [];
  const activeBySymbol = new Map(
    active
      .map(item => [String(item?.symbol || '').trim(), item])
      .filter(([symbol]) => Boolean(symbol)),
  );

  const missing = requestedSymbols.filter(symbol => !activeBySymbol.has(symbol));

  log('symbols.catalogue', {
    requested: requestedSymbols,
    activeCount: active.length,
    missing,
  });

  if (missing.length) {
    throw new Error(
      `Configured symbol(s) are not currently active: ${missing.join(', ')}. ` +
      'SIRE will not subscribe to an unverified symbol.',
    );
  }

  for (const symbol of requestedSymbols) {
    ensureSymbolState(symbol);
    send({
      ticks: symbol,
      subscribe: 1,
      req_id: ++requestId,
    });
  }
}

function handleTick(message) {
  const tick = message?.tick;
  const symbol = String(tick?.symbol || '').trim();
  const price = Number(tick?.quote);
  const epoch = Number(tick?.epoch);

  if (!symbol || !Number.isFinite(price) || !Number.isFinite(epoch)) {
    log('market.tick_rejected', { reason: 'invalid_tick_payload' });
    return;
  }

  if (!requestedSymbols.includes(symbol)) return;

  const s = ensureSymbolState(symbol);
  s.subscribed = true;
  s.tickCount += 1;
  s.latestPrice = price;
  s.latestEpoch = epoch;
  s.lastTickReceivedAt = new Date().toISOString();

  updateCandle(symbol, epoch, price);
}

function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    log('connection.message_rejected', { reason: 'invalid_json' });
    return;
  }

  if (message?.error) {
    log('deriv.error', {
      msgType: message?.msg_type || null,
      error: message.error,
      echoRequest: message.echo_req || null,
    });
    return;
  }

  switch (message?.msg_type) {
    case 'active_symbols':
      try {
        handleActiveSymbols(message);
      } catch (error) {
        log('symbols.validation_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        ws?.close(1008, 'Configured symbol validation failed');
      }
      break;

    case 'tick':
      handleTick(message);
      break;

    case 'ping':
      break;

    default:
      // Step 1 intentionally ignores unrelated Deriv messages while retaining
      // a heartbeat and connection telemetry.
      break;
  }
}

function connect() {
  if (shuttingDown) return;

  clearTimers();
  resetConnectionState();

  log('connection.connecting', {
    endpoint: DERIV_PUBLIC_WS,
    symbols: requestedSymbols,
    reconnectAttempt,
  });

  const socket = new WebSocket(DERIV_PUBLIC_WS);
  ws = socket;

  socket.on('open', () => {
    if (ws !== socket) return;

    reconnectAttempt = 0;
    log('connection.open', { endpoint: DERIV_PUBLIC_WS });

    startTimers();

    send({
      active_symbols: 'brief',
      req_id: ++requestId,
    });
  });

  socket.on('message', data => {
    if (ws !== socket) return;
    handleMessage(data);
  });

  socket.on('error', error => {
    if (ws !== socket) return;
    log('connection.error', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  socket.on('close', (code, reason) => {
    if (ws !== socket) return;

    clearTimers();
    ws = null;
    resetConnectionState();

    log('connection.closed', {
      code,
      reason: String(reason || ''),
    });

    scheduleReconnect(`socket_closed_${code}`);
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  clearTimers();

  log('worker.shutdown', { signal });

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close(1000, 'SIRE worker shutting down');
  }

  setTimeout(() => process.exit(0), 250);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', error => {
  log('worker.uncaught_exception', {
    error: error instanceof Error ? error.stack || error.message : String(error),
  });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', reason => {
  log('worker.unhandled_rejection', {
    error: reason instanceof Error ? reason.stack || reason.message : String(reason),
  });
  shutdown('unhandledRejection');
});

log('worker.starting', {
  symbols: requestedSymbols,
  timeframe: '1m',
  endpoint: DERIV_PUBLIC_WS,
  note: 'Step 1 observes public market data only; no trading or account access is enabled.',
});

connect();
