import ccxt from 'ccxt';

const exchangeCache = new Map<string, any>();

function getExchange(id: string) {
  const key = String(id || '').trim().toLowerCase();
  if (!key) throw new Error('CCXT exchange id is required.');
  const Exchange = (ccxt as any)[key];
  if (!Exchange) throw new Error('CCXT exchange "' + key + '" is not available in this build.');
  let exchange = exchangeCache.get(key);
  if (!exchange) {
    exchange = new Exchange({ enableRateLimit: true, timeout: 15000 });
    exchangeCache.set(key, exchange);
  }
  return exchange;
}

async function readyExchange(id: string) {
  const exchange = getExchange(id);
  if (!exchange.markets) await exchange.loadMarkets();
  return exchange;
}

export async function ccxtMarketCapabilities(exchangeId: string, symbol: string) {
  const exchange = await readyExchange(exchangeId);
  const market = exchange.market(symbol);
  if (!market) throw new Error('CCXT market "' + symbol + '" was not found on ' + exchange.id + '.');
  return {
    exchange: exchange.id,
    exchangeName: exchange.name || exchange.id,
    symbol: market.symbol,
    marketId: market.id,
    type: market.type,
    active: market.active !== false,
    fetchOHLCV: Boolean(exchange.has?.fetchOHLCV),
    fetchTicker: Boolean(exchange.has?.fetchTicker),
    watchOHLCV: Boolean(exchange.has?.watchOHLCV),
    watchTicker: Boolean(exchange.has?.watchTicker),
    timeframes: exchange.timeframes || {},
  };
}

export async function ccxtMarketHistory(input: {
  exchangeId: string;
  symbol: string;
  timeframe: string;
  limit?: number;
  since?: number;
  until?: number;
}) {
  const exchange = await readyExchange(input.exchangeId);
  const symbol = String(input.symbol || '').trim();
  const market = exchange.market(symbol);
  if (!market) throw new Error('CCXT market "' + symbol + '" was not found on ' + exchange.id + '.');
  if (!exchange.has?.fetchOHLCV) {
    throw new Error(exchange.name + ' does not expose fetchOHLCV for chart history through CCXT.');
  }
  const timeframe = String(input.timeframe || '1m');
  if (exchange.timeframes && !exchange.timeframes[timeframe]) {
    throw new Error(exchange.name + ' does not support the ' + timeframe + ' candle timeframe for ' + symbol + '.');
  }
  const limit = Math.max(2, Math.min(1000, Math.floor(Number(input.limit) || 500)));
  const since = Number.isFinite(Number(input.since)) ? Math.floor(Number(input.since)) : undefined;
  const rows = await exchange.fetchOHLCV(symbol, timeframe, since, limit);
  const until = Number.isFinite(Number(input.until)) ? Number(input.until) : undefined;
  const bars = (Array.isArray(rows) ? rows : [])
    .map((r: any[]) => ({
      time: Number(r?.[0]) / 1000,
      open: Number(r?.[1]),
      high: Number(r?.[2]),
      low: Number(r?.[3]),
      close: Number(r?.[4]),
      volume: Number(r?.[5]) || 0,
    }))
    .filter((b: any) => [b.time,b.open,b.high,b.low,b.close].every(Number.isFinite))
    .filter((b: any) => until === undefined || b.time * 1000 <= until)
    .sort((a: any,b: any) => a.time-b.time);
  if (!bars.length) throw new Error('CCXT returned no candles for ' + exchange.name + ' ' + symbol + ' ' + timeframe + '.');
  return { exchange: exchange.id, exchangeName: exchange.name || exchange.id, symbol, timeframe, bars };
}

export async function ccxtMarketQuote(exchangeId: string, symbol: string) {
  const exchange = await readyExchange(exchangeId);
  const market = exchange.market(symbol);
  if (!market) throw new Error('CCXT market "' + symbol + '" was not found on ' + exchange.id + '.');
  if (!exchange.has?.fetchTicker) {
    throw new Error(exchange.name + ' does not expose fetchTicker for live quotes through CCXT.');
  }
  const ticker = await exchange.fetchTicker(symbol);
  const price = Number(ticker?.last ?? ticker?.close ?? ticker?.bid ?? ticker?.ask);
  const epoch = Number(ticker?.timestamp || Date.now()) / 1000;
  if (!Number.isFinite(price) || !Number.isFinite(epoch)) throw new Error('CCXT returned an invalid live quote for ' + exchange.name + ' ' + symbol + '.');
  return {
    exchange: exchange.id,
    exchangeName: exchange.name || exchange.id,
    symbol,
    price,
    epoch,
    bid: Number.isFinite(Number(ticker?.bid)) ? Number(ticker.bid) : undefined,
    ask: Number.isFinite(Number(ticker?.ask)) ? Number(ticker.ask) : undefined,
    volume: Number.isFinite(Number(ticker?.baseVolume)) ? Number(ticker.baseVolume) : undefined,
  };
}
