import ccxt from 'ccxt';
import { getCcxtLiveQuote } from './ccxt-live-market-data.ts';

export type CcxtExchangeAuditRow = {
  exchange: string;
  name: string;
  marketCount: number;
  sampleSymbol: string | null;
  history: 'working' | 'unsupported' | 'failed';
  live: 'working' | 'websocket' | 'rest' | 'failed';
  errors: string[];
  checkedAt: string;
};

let running: Promise<void> | null = null;
let state: {
  running: boolean;
  cursor: number;
  total: number;
  rows: CcxtExchangeAuditRow[];
  startedAt?: string;
  finishedAt?: string;
} = { running: false, cursor: 0, total: 0, rows: [] };

function candidateMarkets(exchange: any) {
  return Object.values(exchange.markets || {})
    .filter((m: any) => m && m.active !== false)
    .filter((m: any) => m.spot !== false || m.type === 'spot')
    .filter((m: any) => typeof m.symbol === 'string')
    .sort((a: any, b: any) => {
      const aKey = a.symbol === 'BTC/USDT' ? 0 : a.symbol === 'BTC/USD' ? 1 : 2;
      const bKey = b.symbol === 'BTC/USDT' ? 0 : b.symbol === 'BTC/USD' ? 1 : 2;
      return aKey - bKey || a.symbol.localeCompare(b.symbol);
    });
}

async function auditOne(id: string): Promise<CcxtExchangeAuditRow> {
  const Exchange = (ccxt as any)[id];
  const row: CcxtExchangeAuditRow = {
    exchange: id,
    name: Exchange?.name || id,
    marketCount: 0,
    sampleSymbol: null,
    history: 'failed',
    live: 'failed',
    errors: [],
    checkedAt: new Date().toISOString(),
  };

  if (!Exchange) {
    row.errors.push('Exchange factory is not available in this CCXT build.');
    return row;
  }

  let exchange: any;
  try {
    exchange = new Exchange({ enableRateLimit: true, timeout: 15000 });
    await exchange.loadMarkets();
    row.marketCount = Object.keys(exchange.markets || {}).length;
    const candidates = candidateMarkets(exchange);
    const sample = candidates[0];
    if (!sample) {
      row.errors.push('No active spot-like market is available for a representative live-data test.');
      return row;
    }
    row.sampleSymbol = sample.symbol;

    if (exchange.has?.fetchOHLCV && exchange.timeframes?.['1m']) {
      try {
        const bars = await exchange.fetchOHLCV(sample.symbol, '1m', undefined, 3);
        const valid = Array.isArray(bars) && bars.filter((r: any[]) =>
          Array.isArray(r) && Number.isFinite(Number(r?.[0])) && Number.isFinite(Number(r?.[4]))
        );
        row.history = valid.length >= 2 ? 'working' : 'failed';
        if (row.history === 'failed') row.errors.push('fetchOHLCV returned fewer than 2 valid 1m candles.');
      } catch (error) {
        row.history = 'failed';
        row.errors.push('1m history: ' + (error instanceof Error ? error.message : String(error)));
      }
    } else {
      row.history = 'unsupported';
      row.errors.push('This exchange does not expose 1m fetchOHLCV through CCXT.');
    }

    try {
      const quote = await Promise.race([
        getCcxtLiveQuote(id, sample.symbol),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('live quote verification timed out after 8 seconds')), 8000)),
      ]);
      row.live = quote.stream?.websocket ? 'websocket' : 'rest';
      if (!Number.isFinite(Number(quote.price))) {
        row.live = 'failed';
        row.errors.push('Live adapter returned an invalid price.');
      }
    } catch (error) {
      row.live = 'failed';
      row.errors.push('live data: ' + (error instanceof Error ? error.message : String(error)));
    }
  } catch (error) {
    row.errors.push('market discovery: ' + (error instanceof Error ? error.message : String(error)));
  } finally {
    try { await exchange?.close?.(); } catch {}
  }

  return row;
}

export function getCcxtExchangeAuditStatus() {
  const working = state.rows.filter(r => r.live === 'working' || r.live === 'websocket' || r.live === 'rest').length;
  const failed = state.rows.filter(r => r.live === 'failed').length;
  return {
    ...state,
    working,
    failed,
    websocket: state.rows.filter(r => r.live === 'websocket').length,
    historyWorking: state.rows.filter(r => r.history === 'working').length,
  };
}

export function getCcxtExchangeAuditResults(failedOnly = false) {
  return failedOnly ? state.rows.filter(r => r.live === 'failed' || r.history === 'failed') : state.rows;
}

export function startCcxtExchangeAudit() {
  if (state.running && running) return getCcxtExchangeAuditStatus();
  const exchanges = Array.isArray((ccxt as any).exchanges) ? [...(ccxt as any).exchanges] : [];
  state = { running: true, cursor: 0, total: exchanges.length, rows: [], startedAt: new Date().toISOString() };

  running = (async () => {
    for (const id of exchanges) {
      const row = await auditOne(id);
      state.rows.push(row);
      state.cursor += 1;
      console.info('[CCXT EXCHANGE AUDIT]', JSON.stringify({
        exchange: row.exchange,
        marketCount: row.marketCount,
        sample: row.sampleSymbol,
        history: row.history,
        live: row.live,
        errors: row.errors,
      }));
    }
    state.running = false;
    state.finishedAt = new Date().toISOString();
    console.info('[CCXT EXCHANGE AUDIT] COMPLETE', JSON.stringify(getCcxtExchangeAuditStatus()));
  })().catch(error => {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    console.error('[CCXT EXCHANGE AUDIT] FATAL', error instanceof Error ? error.message : String(error));
  }).finally(() => { running = null; });

  return getCcxtExchangeAuditStatus();
}
