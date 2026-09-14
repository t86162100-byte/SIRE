import { db } from '@appdeploy/sdk';

type Tick = { symbol: string; quote: number; bid?: number; ask?: number; epoch: number; id?: string; source: 'Deriv' };

type Coverage = { symbol: string; storedTicks: number; oldestEpoch: number | null; newestEpoch: number | null; lastIngestAt: number | null; batches: number; storageVersion?: string; };

type Batch = { symbol: string; source: string; firstEpoch: number; lastEpoch: number; count: number; ticks: Tick[]; ingestKey: string; createdAt: number };

const COVERAGE_TABLE = 'sire_coverage_v1';
const BATCH_TABLE = 'sire_tick_batches_v1';
const STORAGE_VERSION = '1C';
const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089';
const MAX_HISTORY = 100000;

function validTick(t: unknown): t is Tick {
  if (!t || typeof t !== 'object') return false;
  const v = t as Record<string, unknown>;
  return typeof v.epoch === 'number' && Number.isFinite(v.epoch) && typeof v.quote === 'number' && Number.isFinite(v.quote) && typeof v.symbol === 'string';
}

function key(t: Tick) { return `${t.symbol}:${t.epoch}:${t.quote}`; }

async function allBatches(symbol: string): Promise<Batch[]> {
  const rows: Batch[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < 500; page += 1) {
    const response = await db.list<Batch>(BATCH_TABLE, { limit: 100, ...(nextToken ? { nextToken } : {}) });
    rows.push(...response.items.filter(x => x.symbol === symbol));
    nextToken = response.nextToken;
    if (!nextToken) break;
  }
  return rows;
}

async function storedTicks(symbol: string, limit = MAX_HISTORY): Promise<Tick[]> {
  const batches = await allBatches(symbol);
  return Array.from(new Map(batches.flatMap(b => b.ticks).filter(validTick).map(t => [key(t), t])).values())
    .sort((a, b) => a.epoch - b.epoch).slice(-limit);
}

function wsRequest(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(DERIV_APP_ID)}`);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('Deriv data request timed out')); }, 30000);
    ws.onopen = () => ws.send(JSON.stringify(request));
    ws.onmessage = event => {
      try {
        const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (payload.error) {
          clearTimeout(timer); try { ws.close(); } catch {}
          reject(new Error(String((payload.error as Record<string, unknown>).message || 'Deriv returned an error')));
          return;
        }
        if (payload.msg_type === 'history' || payload.history) {
          clearTimeout(timer); try { ws.close(); } catch {}
          resolve(payload);
        }
      } catch (e) {
        clearTimeout(timer); try { ws.close(); } catch {}
        reject(e);
      }
    };
    ws.onerror = () => { clearTimeout(timer); try { ws.close(); } catch {}; reject(new Error('Deriv data connection failed')); };
  });
}

async function persist(symbol: string, ticks: Tick[]) {
  const existing = new Set((await storedTicks(symbol, MAX_HISTORY)).map(key));
  const unique = ticks.filter(t => !existing.has(key(t))).sort((a, b) => a.epoch - b.epoch);
  if (!unique.length) return { inserted: 0, duplicate: ticks.length };
  let inserted = 0;
  for (let i = 0; i < unique.length; i += 250) {
    const chunk = unique.slice(i, i + 250);
    const record: Batch = { symbol, source: 'Deriv', firstEpoch: chunk[0].epoch, lastEpoch: chunk[chunk.length - 1].epoch, count: chunk.length, ticks: chunk, ingestKey: `${symbol}:${chunk[0].epoch}:${chunk[chunk.length - 1].epoch}`, createdAt: Date.now() };
    await db.add(BATCH_TABLE, [record]);
    inserted += chunk.length;
  }
  const rows = await db.list<Coverage>(COVERAGE_TABLE, { limit: 1000 });
  const current = rows.items.find(x => x.symbol === symbol);
  const epochs = unique.map(t => t.epoch);
  const coverage: Coverage = { symbol, storedTicks: (current?.storedTicks || 0) + inserted, oldestEpoch: Math.min(current?.oldestEpoch ?? Infinity, ...epochs), newestEpoch: Math.max(current?.newestEpoch ?? -Infinity, ...epochs), lastIngestAt: Date.now(), batches: (current?.batches || 0) + Math.ceil(unique.length / 250), storageVersion: STORAGE_VERSION };
  if (current?.id) await db.update(COVERAGE_TABLE, [{ id: current.id, record: coverage }]); else await db.add(COVERAGE_TABLE, [coverage]);
  return { inserted, duplicate: ticks.length - unique.length };
}

export async function ensureDerivHistory(symbol: string, requestedTicks = 10000) {
  const cleanSymbol = String(symbol || '').trim().toUpperCase();
  if (!cleanSymbol) throw new Error('symbol is required');
  const target = Math.min(MAX_HISTORY, Math.max(500, Number(requestedTicks) || 10000));
  const before = await storedTicks(cleanSymbol, MAX_HISTORY);
  if (before.length >= target) return { symbol: cleanSymbol, target, available: before.length, acquired: 0, source: 'Deriv', complete: true, reason: 'Existing persisted coverage is sufficient.' };

  const needed = target - before.length;
  const response = await wsRequest({ ticks_history: cleanSymbol, count: Math.min(needed, 5000), end: 'latest', style: 'ticks', adjust_start_time: 1 });
  const history = response.history as Record<string, unknown> | undefined;
  const prices = Array.isArray(history?.prices) ? history?.prices as unknown[] : [];
  const times = Array.isArray(history?.times) ? history?.times as unknown[] : [];
  const ticks: Tick[] = [];
  for (let i = 0; i < Math.min(prices.length, times.length); i += 1) {
    const quote = Number(prices[i]); const epoch = Number(times[i]);
    if (Number.isFinite(quote) && Number.isFinite(epoch)) ticks.push({ symbol: cleanSymbol, quote, epoch, source: 'Deriv' });
  }
  const result = await persist(cleanSymbol, ticks);
  const after = await storedTicks(cleanSymbol, MAX_HISTORY);
  return { symbol: cleanSymbol, target, available: after.length, acquired: result.inserted, duplicate: result.duplicate, source: 'Deriv', complete: after.length >= target, oldestEpoch: after[0]?.epoch || null, newestEpoch: after[after.length - 1]?.epoch || null };
}

function ema(values: number[], period: number) {
  if (!values.length) return [];
  const p = Math.max(1, Math.min(period, values.length));
  const alpha = 2 / (p + 1); let e = values[0]; const out = [e];
  for (let i = 1; i < values.length; i += 1) { e = values[i] * alpha + e * (1 - alpha); out.push(e); }
  return out;
}

export async function analyzeM30Trend(symbol: string, candleLimit = 250) {
  const cleanSymbol = String(symbol || '').trim().toUpperCase();
  const targetTicks = Math.min(MAX_HISTORY, Math.max(5000, candleLimit * 180));
  await ensureDerivHistory(cleanSymbol, targetTicks);
  const ticks = await storedTicks(cleanSymbol, MAX_HISTORY);
  const timeframe = 1800;
  const candles = new Map<number, { time: number; open: number; high: number; low: number; close: number }>();
  for (const t of ticks) {
    const bucket = Math.floor(t.epoch / timeframe) * timeframe;
    const c = candles.get(bucket);
    if (!c) candles.set(bucket, { time: bucket, open: t.quote, high: t.quote, low: t.quote, close: t.quote });
    else { c.high = Math.max(c.high, t.quote); c.low = Math.min(c.low, t.quote); c.close = t.quote; }
  }
  const series = Array.from(candles.values()).sort((a, b) => a.time - b.time).slice(-candleLimit);
  const closes = series.map(c => c.close);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const n = series.length; const last = series[n - 1];
  const structureWindow = series.slice(-Math.min(30, n));
  let highsUp = 0, lowsUp = 0, highsDown = 0, lowsDown = 0;
  for (let i = 1; i < structureWindow.length; i += 1) { const a = structureWindow[i - 1], b = structureWindow[i]; if (b.high > a.high) highsUp += 1; if (b.low > a.low) lowsUp += 1; if (b.high < a.high) highsDown += 1; if (b.low < a.low) lowsDown += 1; }
  const bullish = last.close > e20[n - 1] && e20[n - 1] > e50[n - 1] && e50[n - 1] >= e200[n - 1] && highsUp >= lowsDown;
  const bearish = last.close < e20[n - 1] && e20[n - 1] < e50[n - 1] && e50[n - 1] <= e200[n - 1] && lowsDown >= highsUp;
  const trend = bullish ? 'BULLISH' : bearish ? 'BEARISH' : 'MIXED/RANGING';
  return { symbol: cleanSymbol, timeframe: 'M30', timeframeSeconds: timeframe, candles: n, trend, lastPrice: last?.close ?? null, ema20: e20[n - 1] ?? null, ema50: e50[n - 1] ?? null, ema200: e200[n - 1] ?? null, structure: { higherHighs: highsUp, higherLows: lowsUp, lowerHighs: highsDown, lowerLows: lowsDown }, latestCandle: last || null, data: { source: 'Deriv', persistedTicks: ticks.length, oldestEpoch: ticks[0]?.epoch || null, newestEpoch: ticks[ticks.length - 1]?.epoch || null } };
}

export async function autonomousEnvironmentAudit() {
  const coverageRows = await db.list<Coverage>(COVERAGE_TABLE, { limit: 1000 });
  const catalogue = await db.list<Record<string, unknown>>('sire_catalogue_v1', { limit: 1000 });
  const instruments = new Map<string, { catalogue: boolean; ticks: number; oldest: number | null; newest: number | null }>();
  for (const item of catalogue.items) { const symbol = String(item.symbol || item.underlying_symbol || '').trim(); if (symbol) instruments.set(symbol, { catalogue: true, ticks: 0, oldest: null, newest: null }); }
  for (const row of coverageRows.items) { const symbol = row.symbol; const current = instruments.get(symbol) || { catalogue: false, ticks: 0, oldest: null, newest: null }; current.ticks = row.storedTicks || 0; current.oldest = row.oldestEpoch ?? null; current.newest = row.newestEpoch ?? null; instruments.set(symbol, current); }
  const rows = Array.from(instruments.entries()).map(([symbol, v]) => ({ symbol, ...v, dataStatus: v.ticks > 0 ? 'VERIFIED' : v.catalogue ? 'PARTIAL' : 'UNKNOWN' }));
  return { source: 'SIRE', catalogueCount: catalogue.items.length, coverageRecords: coverageRows.items.length, instruments: rows, capabilities: { autonomousInstrumentSelection: true, persistedTickStore: true, autonomousDerivHistoryAcquisition: true, m30Construction: true, backtesting: true, researchMemory: true }, gaps: rows.filter(x => x.dataStatus !== 'VERIFIED').map(x => ({ symbol: x.symbol, reason: x.dataStatus === 'PARTIAL' ? 'Catalogue exists but persisted history is limited/absent.' : 'No catalogue or persisted coverage record.' })) };
}
