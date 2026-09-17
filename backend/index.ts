import { router, json, error, db } from '@appdeploy/sdk';
import { ensureDerivHistory, analyzeM30Trend, autonomousEnvironmentAudit } from './sire-autonomy';

type StoredTick = {
  symbol: string;
  quote: number;
  bid?: number;
  ask?: number;
  epoch: number;
  id?: string;
  source: 'Deriv';
};
type CoverageRecord = {
  symbol: string;
  storedTicks: number;
  oldestEpoch: number | null;
  newestEpoch: number | null;
  lastIngestAt: number | null;
  batches: number;
  lastBatchId?: string | null;
  lastIngestKey?: string | null;
  storageVersion?: string;
};
type BatchRecord = {
  symbol: string;
  source: string;
  firstEpoch: number;
  lastEpoch: number;
  count: number;
  ticks: StoredTick[];
  ingestKey: string;
  createdAt: number;
};
const COVERAGE_TABLE = 'sire_coverage_v1';
const BATCH_TABLE = 'sire_tick_batches_v1';
const MAX_TICKS = 500;
const MAX_STORED_TICKS_PER_BATCH = 250;
const DEDUPE_SCAN_PAGES = 5;
const STORAGE_VERSION = '1C';
const RESEARCH_TABLE = 'sire_research_experiments_v1';
const CATALOGUE_TABLE = 'sire_catalogue_v1';
const BACKTEST_MAX_TICKS = 100000;
const DATA_PAGE_LIMIT = 100;
const PAPER_TABLE = 'sire_paper_trades_v1';
const DATA_MAX_PAGES = 120;

type StrategySpec = { signal?: 'reversal_after_streak' | 'momentum_after_streak' | 'direction'; streakLength?: number; direction?: 'long' | 'short' | 'both'; exitTicks?: number; stopLoss?: number; takeProfit?: number; stake?: number; exposure?: number; spread?: number; slippage?: number; delayTicks?: number };

function strategySignal(diff: number[], index: number, strategy: StrategySpec) {
  const streak = Math.max(1, Math.floor(strategy.streakLength || 3));
  if (index < streak) return 0;
  const lastSign = diff[index - 1] > 0 ? 1 : diff[index - 1] < 0 ? -1 : 0;
  if (!lastSign) return 0;
  for (let j = index - streak; j < index; j += 1) { const sign = diff[j] > 0 ? 1 : diff[j] < 0 ? -1 : 0; if (sign !== lastSign) return 0; }
  let side = (strategy.signal || 'reversal_after_streak') === 'momentum_after_streak' ? lastSign : -lastSign;
  if ((strategy.signal || 'reversal_after_streak') === 'direction') side = lastSign;
  if (strategy.direction === 'long' && side < 0) return 0;
  if (strategy.direction === 'short' && side > 0) return 0;
  return side;
}

function simulateBacktest(ticks: StoredTick[], strategy: StrategySpec) {
  const diff = returns(ticks); const stake = Math.max(0.000001, Number(strategy.stake || 1)); const exposure = Math.max(0.000001, Number(strategy.exposure || 1)); const spread = Math.max(0, Number(strategy.spread || 0)); const slippage = Math.max(0, Number(strategy.slippage || 0)); const delayTicks = Math.max(0, Math.floor(strategy.delayTicks || 0)); const exitTicks = Math.max(1, Math.floor(strategy.exitTicks || 20)); const stopLoss = Math.max(0, Number(strategy.stopLoss || 0)); const takeProfit = Math.max(0, Number(strategy.takeProfit || 0)); const trades: Array<Record<string, unknown>> = []; let equity = 0; let peak = 0; let maxDrawdown = 0;
  for (let i = 1; i < ticks.length - delayTicks - 1; i += 1) { const side = strategySignal(diff, i, strategy); if (!side) continue; const entryIndex = i + delayTicks; const entryRaw = ticks[entryIndex]?.quote; if (!Number.isFinite(entryRaw)) continue; const entry = entryRaw + side * (spread / 2 + slippage); let exitIndex = Math.min(ticks.length - 1, entryIndex + exitTicks); let exit = ticks[exitIndex]?.quote; if (!Number.isFinite(exit)) continue; let reason = 'time_exit'; for (let j = entryIndex + 1; j <= exitIndex; j += 1) { const move = side * (ticks[j].quote - entry); if (takeProfit > 0 && move >= takeProfit) { exitIndex = j; exit = ticks[j].quote - side * slippage; reason = 'take_profit'; break; } if (stopLoss > 0 && move <= -stopLoss) { exitIndex = j; exit = ticks[j].quote + side * slippage; reason = 'stop_loss'; break; } } const pnl = side * (exit - entry) * stake * exposure; equity += pnl; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); trades.push({ entryEpoch: ticks[entryIndex].epoch, exitEpoch: ticks[exitIndex].epoch, side: side > 0 ? 'long' : 'short', entry, exit, pnl, reason, holdTicks: exitIndex - entryIndex }); i = exitIndex; }
  const pnls = trades.map(t => Number(t.pnl)); const wins = pnls.filter(v => v > 0).length; const losses = pnls.filter(v => v < 0).length; const total = pnls.reduce((a, b) => a + b, 0); const grossWin = pnls.filter(v => v > 0).reduce((a, b) => a + b, 0); const grossLoss = Math.abs(pnls.filter(v => v < 0).reduce((a, b) => a + b, 0)); return { strategy, sampleTicks: ticks.length, trades: trades.length, wins, losses, winRate: trades.length ? wins / trades.length : 0, totalPnl: total, expectancy: pnls.length ? total / pnls.length : 0, profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0, maxDrawdown, endingEquity: equity, baselineBuyAndHold: ticks.length > 1 ? ticks[ticks.length - 1].quote - ticks[0].quote : 0, trades: trades.slice(0, 10000), costModel: { spread, slippage, delayTicks }, lookAheadProtection: 'Signals are formed from ticks strictly before simulated execution; delay is applied forward.' };
}

function seededShuffle(values: number[], seed = 17) { const out = [...values]; let state = seed >>> 0; for (let i = out.length - 1; i > 0; i -= 1) { state = (Math.imul(state ^ (i + 1), 1664525) + 1013904223) >>> 0; const j = state % (i + 1); [out[i], out[j]] = [out[j], out[i]]; } return out; }

function featureRows(ticks: StoredTick[]) { return ticks.map((tick, i) => { const previous = ticks[i - 1]; const delta = previous ? tick.quote - previous.quote : null; return { symbol: tick.symbol, epoch: tick.epoch, quote: tick.quote, delta, absDelta: delta === null ? null : Math.abs(delta), direction: delta === null ? 'F' : delta > 0 ? 'U' : delta < 0 ? 'D' : 'F', secondsSincePrevious: previous ? tick.epoch - previous.epoch : null }; }); }
function analyzeTicks(ticks: StoredTick[], operation: string, options: Record<string, number | string>) {
  const diff = returns(ticks); const values = operation === 'returns' || operation === 'volatility' || operation === 'autocorrelation' || operation === 'entropy' || operation === 'runs' ? diff : ticks.map(t => t.quote);
  if (operation === 'summary' || operation === 'distribution') return { operation, quote: stats(ticks.map(t => t.quote)), returns: stats(diff), returnQuantiles: quantiles(diff), returnHistogram: histogram(diff, Number(options.bins || 20)) };
  if (operation === 'quantiles') return { operation, quote: quantiles(ticks.map(t => t.quote)), returns: quantiles(diff) };
  if (operation === 'histogram') return { operation, bins: Number(options.bins || 20), returns: histogram(diff, Number(options.bins || 20)) };
  if (operation === 'zscore') return { operation, values: zscore(diff) };
  if (operation === 'bootstrap_mean') return { operation, ...bootstrapMean(diff, Number(options.iterations || 1000)) };
  if (operation === 'ohlc') return { operation, timeframeSeconds: Math.max(1, Number(options.timeframeSeconds || 60)), candles: ohlc(ticks, Math.max(1, Number(options.timeframeSeconds || 60))) };
  if (operation === 'quality') return { operation, ...quality(ticks) };
  if (operation === 'features') return { operation, features: featureRows(ticks) };
  if (operation === 'returns_series') return { operation, returns: diff };
  if (operation === 'prices') return { operation, prices: ticks.map(t => ({ epoch: t.epoch, quote: t.quote })) };
  if (operation === 'rolling_volatility') { const window = Math.max(2, Number(options.window || 20)); const rows = diff.map((_, i) => i + 1 < window ? null : stats(diff.slice(i + 1 - window, i + 1)).stdev); return { operation, window, values: rows }; }
  if (operation === 'returns') return { operation, returns: stats(diff) };
  if (operation === 'volatility') return { operation, returnStats: stats(diff), volatility: stats(diff.map(value => Math.abs(value))), annualizationNotApplied: true };
  if (operation === 'drawdown') { let peak = -Infinity; let equity = 0; let maxDrawdown = 0; for (const value of diff) { equity += value; peak = Math.max(peak, equity); maxDrawdown = Math.min(maxDrawdown, equity - peak); } return { operation, maxDrawdown, endingReturn: equity }; }
  if (operation === 'runs') return { operation, ...runStats(diff) };
  if (operation === 'autocorrelation') return { operation, lag: Number(options.lag || 1), value: autocorrelation(values, Math.max(1, Number(options.lag || 1))) };
  if (operation === 'entropy') return { operation, bins: Number(options.bins || 10), entropyBits: entropy(values, Math.max(2, Number(options.bins || 10))) };
  if (operation === 'sequence') { const length = Math.max(2, Number(options.sequenceLength || 37)); const horizon = Math.max(1, Number(options.reversalHorizon || 10)); const signs = diff.map(v => v > 0 ? 'U' : v < 0 ? 'D' : 'F'); const counts = new Map<string, number>(); const reversals = new Map<string, number>(); for (let i = length; i < signs.length - horizon; i += 1) { const seq = signs.slice(i - length, i).join(''); counts.set(seq, (counts.get(seq) || 0) + 1); const last = signs[i - 1]; const future = signs.slice(i, i + horizon); const reversal = future.some(s => (last === 'U' && s === 'D') || (last === 'D' && s === 'U')); if (reversal) reversals.set(seq, (reversals.get(seq) || 0) + 1); } const rows = Array.from(counts.entries()).map(([sequence, sampleCount]) => ({ sequence, sampleCount, reversalCount: reversals.get(sequence) || 0, conditionalProbability: (reversals.get(sequence) || 0) / sampleCount })).sort((a, b) => b.conditionalProbability - a.conditionalProbability || b.sampleCount - a.sampleCount).slice(0, 50); const baseline = signs.slice(0, -horizon).reduce((n, s, i) => n + signs.slice(i + 1, i + 1 + horizon).some(f => (s === 'U' && f === 'D') || (s === 'D' && f === 'U')) ? 1 : 0, 0) / Math.max(1, signs.length - horizon); return { operation, sequenceLength: length, reversalHorizon: horizon, sampleCount: counts.size, baselineReversalProbability: baseline, topSequences: rows }; }
  return { operation, unsupported: true, availableOperations: ['summary', 'returns', 'returns_series', 'prices', 'volatility', 'rolling_volatility', 'drawdown', 'runs', 'autocorrelation', 'entropy', 'sequence', 'distribution', 'quantiles', 'histogram', 'zscore', 'bootstrap_mean', 'ohlc', 'quality', 'features'] };
}
async function researchContext(symbol: string) {
  const coverage = await findCoverage(symbol);
  const recentTicks = await loadTicks(symbol, undefined, undefined, 100);
  return { symbol, source: 'Deriv', coverage, availableTicks: coverage?.storedTicks || recentTicks.length, oldestEpoch: coverage?.oldestEpoch ?? recentTicks[0]?.epoch ?? null, newestEpoch: coverage?.newestEpoch ?? recentTicks[recentTicks.length - 1]?.epoch ?? null, operations: ['summary', 'returns', 'returns_series', 'prices', 'volatility', 'rolling_volatility', 'drawdown', 'runs', 'autocorrelation', 'entropy', 'sequence', 'distribution', 'ohlc', 'quality', 'features'], replay: true, rawTicks: true, comparison: true, latest: recentTicks[recentTicks.length - 1] || null, provenance: 'Genuine Deriv tick data stored by SIRE' };
}

const RESEARCH_TOOL_MANIFEST = {
  name: 'SIRE Research Gateway',
  version: 1,
  source: 'Deriv',
  purpose: 'Programmatic research access to SIRE Synthetic Index data without UI interaction.',
  primaryExample: 'BOOM1000',
  tools: [
    { name: 'workspace', method: 'GET', path: '/api/sire/research/workspace', required: [], optional: ['symbol'] },
    { name: 'research', method: 'POST', path: '/api/sire/research/research', required: ['steps'], optional: ['symbol'] },
    { name: 'audit', method: 'GET', path: '/api/sire/research/audit', required: [] },
    { name: 'catalogue', method: 'GET', path: '/api/sire/research/catalogue', required: [] },
    { name: 'latest', method: 'GET', path: '/api/sire/research/latest', required: ['symbol'] },
    { name: 'ticks', method: 'GET', path: '/api/sire/history', required: ['symbol'], optional: ['limit'] },
    { name: 'analyze', method: 'GET', path: '/api/sire/research/query', required: ['symbol'], optional: ['operation', 'startEpoch', 'endEpoch', 'limit', 'sequenceLength', 'reversalHorizon', 'lag', 'bins', 'includeTicks'] },
    { name: 'compare', method: 'GET', path: '/api/sire/research/compare', required: ['symbolA', 'symbolB'], optional: ['startEpoch', 'endEpoch', 'limit'] },
    { name: 'ohlc', method: 'GET', path: '/api/sire/research/ohlc', required: ['symbol'], optional: ['startEpoch', 'endEpoch', 'limit', 'timeframeSeconds'] },
    { name: 'quality', method: 'GET', path: '/api/sire/research/quality', required: ['symbol'], optional: ['limit'] },
    { name: 'replay', method: 'GET', path: '/api/sire/research/replay', required: ['symbol'], optional: ['startEpoch', 'endEpoch', 'limit'] },
    { name: 'save_experiment', method: 'POST', path: '/api/sire/research/experiments', required: ['name', 'symbol'], optional: ['hypothesis', 'methodology', 'result'] },
    { name: 'experiments', method: 'GET', path: '/api/sire/research/experiments', required: ['symbol'] },
  ],
  operations: ['summary', 'returns', 'returns_series', 'prices', 'volatility', 'rolling_volatility', 'drawdown', 'runs', 'autocorrelation', 'entropy', 'sequence', 'distribution', 'ohlc', 'quality', 'features'],
  guarantees: ['exact epoch timestamps', 'persistent Deriv source provenance', 'bounded raw tick access', 'configurable analysis parameters', 'historical replay', 'persistent research memory'],
};

async function researchTool(tool: string, args: Record<string, unknown>) {
  const symbol = String(args.symbol || '');
  if (tool === 'workspace') {
    const environment = await environmentSnapshot(args);
    const context = symbol ? await researchContext(symbol) : null;
    return { ...environment, selectedInstrument: context };
  }
  if (tool === 'environment') return environmentSnapshot(args);
  if (tool === 'find_instruments') {
    const query = String(args.query || '').trim().toLowerCase();
    if (!query) return { source: 'Deriv', instruments: [] };
    const limit = Math.min(500, Math.max(1, Number(args.limit || 50)));
    const rows = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 });
    const instruments = rows.items.filter(row => `${row.symbol || ''} ${row.name || ''} ${row.display_name || ''} ${row.market || ''} ${row.submarket || ''} ${row.subgroup || ''}`.toLowerCase().includes(query)).slice(0, limit);
    return { source: 'Deriv', query, count: instruments.length, instruments };
  }
  if (tool === 'all_market_snapshots') return { source: 'Deriv', snapshots: await latestMarketSnapshots(Math.min(5000, Number(args.limit || 1000))) };
  if (tool === 'instrument') {
    if (!symbol) throw new Error('symbol is required');
    const rows = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 });
    const instrument = rows.items.find(row => String(row.symbol || row.underlying_symbol || '') === symbol);
    const context = await researchContext(symbol);
    return { source: 'Deriv', instrument: instrument || null, context };
  }
  if (tool === 'catalogue') { const rows = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 }); return { source: 'Deriv', instruments: rows.items }; }
  if (tool === 'latest') { const ticks = await loadTicks(symbol, undefined, undefined, 10); return { source: 'Deriv', symbol, latest: ticks[ticks.length - 1] || null, recent: ticks }; }
  if (tool === 'ticks') { const limit = Math.min(MAX_TICKS, Number(args.limit || 1000)); const ticks = await loadTicks(symbol, args.startEpoch === undefined ? undefined : Number(args.startEpoch), args.endEpoch === undefined ? undefined : Number(args.endEpoch), limit); return { source: 'Deriv', symbol, ticks, count: ticks.length }; }
  if (tool === 'analyze') { const limit = Math.min(BACKTEST_MAX_TICKS, Number(args.limit || 10000)); const ticks = await loadTicks(symbol, args.startEpoch === undefined ? undefined : Number(args.startEpoch), args.endEpoch === undefined ? undefined : Number(args.endEpoch), limit); const result = analyzeTicks(ticks, String(args.operation || 'summary'), { sequenceLength: Number(args.sequenceLength || 37), reversalHorizon: Number(args.reversalHorizon || 10), lag: Number(args.lag || 1), bins: Number(args.bins || 10), timeframeSeconds: Number(args.timeframeSeconds || 60), window: Number(args.window || 20) }); return { source: 'Deriv', symbol, sampleCount: ticks.length, result, provenance: 'SIRE persistent Deriv tick store' }; }
  if (tool === 'backtest') { if (!symbol) throw new Error('symbol is required'); const strategy = (args.strategy || {}) as StrategySpec; const ticks = await loadTicks(symbol, args.startEpoch === undefined ? undefined : Number(args.startEpoch), args.endEpoch === undefined ? undefined : Number(args.endEpoch), Math.min(BACKTEST_MAX_TICKS, Number(args.limit || BACKTEST_MAX_TICKS))); if (ticks.length < 50) return { source: 'Deriv', symbol, insufficientData: true, sampleTicks: ticks.length, minimumTicks: 50 }; return { source: 'Deriv', symbol, result: simulateBacktest(ticks, strategy), provenance: 'SIRE chronological Deriv tick store' }; }
  if (tool === 'walk_forward') { if (!symbol) throw new Error('symbol is required'); const strategy = (args.strategy || {}) as StrategySpec; const ticks = await loadTicks(symbol, undefined, undefined, Math.min(BACKTEST_MAX_TICKS, Number(args.limit || BACKTEST_MAX_TICKS))); const train = Math.max(50, Math.floor(Number(args.trainTicks || 10000))); const validation = Math.max(25, Math.floor(Number(args.validationTicks || 2500))); const test = Math.max(25, Math.floor(Number(args.testTicks || 2500))); const step = Math.max(1, Math.floor(Number(args.stepTicks || test))); const windows: Array<Record<string, unknown>> = []; for (let start = 0; start + train + validation + test <= ticks.length; start += step) { const trainTicks = ticks.slice(start, start + train); const validationTicks = ticks.slice(start + train, start + train + validation); const testTicks = ticks.slice(start + train + validation, start + train + validation + test); const validationResult = simulateBacktest(validationTicks, strategy); const testResult = simulateBacktest(testTicks, strategy); windows.push({ trainRange: [trainTicks[0]?.epoch, trainTicks[trainTicks.length - 1]?.epoch], validationRange: [validationTicks[0]?.epoch, validationTicks[validationTicks.length - 1]?.epoch], testRange: [testTicks[0]?.epoch, testTicks[testTicks.length - 1]?.epoch], validation: { trades: validationResult.trades, pnl: validationResult.totalPnl, expectancy: validationResult.expectancy, drawdown: validationResult.maxDrawdown }, unseenTest: { trades: testResult.trades, pnl: testResult.totalPnl, expectancy: testResult.expectancy, drawdown: testResult.maxDrawdown, winRate: testResult.winRate } }); } const testPnls = windows.map(w => Number((w.unseenTest as Record<string, unknown>).pnl || 0)); return { source: 'Deriv', symbol, windows, windowsPassed: windows.filter(w => Number((w.unseenTest as Record<string, unknown>).pnl || 0) > 0).length, totalWindows: windows.length, unseenTestPnl: testPnls.reduce((a, b) => a + b, 0), methodology: 'Rolling train/validation/unseen-test windows with strictly chronological ranges.' }; }
  if (tool === 'robustness') { if (!symbol) throw new Error('symbol is required'); const strategy = (args.strategy || {}) as StrategySpec; const ticks = await loadTicks(symbol, undefined, undefined, Math.min(BACKTEST_MAX_TICKS, Number(args.limit || BACKTEST_MAX_TICKS))); const baseline = simulateBacktest(ticks, strategy); const observed = baseline.totalPnl; const permutations = Math.min(2000, Math.max(100, Math.floor(Number(args.permutations || 500)))); const diff = returns(ticks); let extreme = 0; const samples: number[] = []; for (let i = 0; i < permutations; i += 1) { const shuffled = seededShuffle(diff, i + 19); const synthetic: StoredTick[] = []; let price = ticks[0]?.quote || 0; for (let j = 0; j < shuffled.length; j += 1) { price += shuffled[j]; synthetic.push({ symbol, quote: price, epoch: ticks[Math.min(ticks.length - 1, j + 1)]?.epoch || 0, source: 'Deriv' }); } const result = simulateBacktest([ticks[0], ...synthetic], strategy); samples.push(result.totalPnl); if (result.totalPnl >= observed) extreme += 1; } const sorted = [...samples].sort((a, b) => a - b); const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]; return { source: 'Deriv', symbol, observedPnl: observed, permutationCount: permutations, randomizedPnlQuantiles: { p05: q(.05), p50: q(.5), p95: q(.95) }, permutationPValue: (extreme + 1) / (permutations + 1), bootstrap: bootstrapMean(samples), warning: 'Permutation testing reduces but does not eliminate data-mining risk. Searching many hypotheses still requires multiple-testing correction and independent confirmation.' }; }
  if (tool === 'paper_trade') { if (!symbol) throw new Error('symbol is required'); const [id] = await db.add(PAPER_TABLE, [{ symbol, action: String(args.action || ''), expectedEntry: args.expectedEntry ?? null, actualQuote: args.actualQuote ?? null, spread: args.spread ?? null, executionDelayMs: args.executionDelayMs ?? null, strategy: String(args.strategy || ''), result: args.result ?? null, createdAt: Date.now() }]); return { saved: Boolean(id), id, symbol }; }
  if (tool === 'paper_trade_report') { if (!symbol) throw new Error('symbol is required'); const rows = await db.list<Record<string, unknown>>(PAPER_TABLE, { limit: 1000 }); const records = rows.items.filter(row => row.symbol === symbol); const results = records.map(row => Number(row.result)).filter(Number.isFinite); const wins = results.filter(v => v > 0).length; return { symbol, records: records.length, settledResults: results.length, totalPnl: results.reduce((a, b) => a + b, 0), winRate: results.length ? wins / results.length : 0, meanResult: results.length ? results.reduce((a, b) => a + b, 0) / results.length : 0, recent: records.slice(-100) }; }
  if (tool === 'risk_limits') { if (!symbol) throw new Error('symbol is required'); const table = 'sire_risk_limits_v1'; const rows = await db.list<Record<string, unknown>>(table, { limit: 1000 }); const existing = rows.items.find(row => row.symbol === symbol); const record = { symbol, maxExposure: Number(args.maxExposure ?? 1), maxDailyLoss: Number(args.maxDailyLoss ?? 1), maxDrawdown: Number(args.maxDrawdown ?? 1), maxConcentration: Number(args.maxConcentration ?? 1), updatedAt: Date.now() }; if (existing) await db.update(table, [{ id: existing.id, record }]); else await db.add(table, [record]); return { saved: true, ...record }; }
  if (tool === 'compare') { const symbolA = String(args.symbolA || ''); const symbolB = String(args.symbolB || ''); const start = args.startEpoch === undefined ? undefined : Number(args.startEpoch); const end = args.endEpoch === undefined ? undefined : Number(args.endEpoch); const limit = Math.min(BACKTEST_MAX_TICKS, Number(args.limit || 10000)); const [a, b] = await Promise.all([loadTicks(symbolA, start, end, limit), loadTicks(symbolB, start, end, limit)]); const n = Math.min(a.length, b.length); const ap = a.slice(-n).map(t => t.quote); const bp = b.slice(-n).map(t => t.quote); const ar = returns(a).slice(-Math.max(0, n - 1)); const br = returns(b).slice(-Math.max(0, n - 1)); return { source: 'Deriv', symbolA, symbolB, sampleCount: n, priceCorrelation: pearson(ap, bp), returnCorrelation: pearson(ar, br), statsA: stats(ar), statsB: stats(br) }; }
  if (tool === 'ohlc') { const limit = Math.min(BACKTEST_MAX_TICKS, Number(args.limit || 10000)); const ticks = await loadTicks(symbol, args.startEpoch === undefined ? undefined : Number(args.startEpoch), args.endEpoch === undefined ? undefined : Number(args.endEpoch), limit); const timeframeSeconds = Math.max(1, Number(args.timeframeSeconds || 60)); return { source: 'Deriv', symbol, timeframeSeconds, candles: ohlc(ticks, timeframeSeconds) }; }
  if (tool === 'quality') { const limit = Math.min(BACKTEST_MAX_TICKS, Number(args.limit || 10000)); const ticks = await loadTicks(symbol, args.startEpoch === undefined ? undefined : Number(args.startEpoch), args.endEpoch === undefined ? undefined : Number(args.endEpoch), limit); return { source: 'Deriv', symbol, quality: quality(ticks) }; }
  if (tool === 'replay') { const limit = Math.min(MAX_TICKS, Number(args.limit || 1000)); const ticks = await loadTicks(symbol, args.startEpoch === undefined ? undefined : Number(args.startEpoch), args.endEpoch === undefined ? undefined : Number(args.endEpoch), limit); return { source: 'Deriv', symbol, ticks, replay: { step: true, pause: true, speeds: [0.25, 0.5, 1, 2, 5, 20] } }; }
  if (tool === 'save_experiment') { if (!args.name || !symbol) throw new Error('name and symbol are required'); const [id] = await db.add(RESEARCH_TABLE, [{ name: String(args.name), symbol, hypothesis: String(args.hypothesis || ''), methodology: String(args.methodology || ''), result: args.result || {}, createdAt: Date.now() }]); return { id, saved: true, symbol }; }
  if (tool === 'experiments') { const rows = await db.list<Record<string, unknown>>(RESEARCH_TABLE, { limit: 100 }); return { symbol, experiments: rows.items.filter(row => row.symbol === symbol).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)) }; }
  if (tool === 'research') { const steps = Array.isArray(args.steps) ? args.steps : []; if (!steps.length) throw new Error('steps[] is required'); const outputs: unknown[] = []; for (let i = 0; i < Math.min(25, steps.length); i += 1) { const step = steps[i] as Record<string, unknown>; const stepTool = String(step.tool || ''); if (stepTool === 'research' || stepTool === 'audit') throw new Error('Nested research/audit tools are not allowed'); outputs.push({ index: i, tool: stepTool, result: await researchTool(stepTool, (step.args || {}) as Record<string, unknown>) }); } return { stepsRun: outputs.length, outputs }; }
  if (tool === 'audit') {
    const snapshot = await environmentSnapshot({ includeMarketState: true, includeDataCoverage: true });
    return {
      source: 'Deriv',
      accessible: snapshot.capabilities,
      instrumentCatalogueRecords: snapshot.catalogue.count,
      persistedInstrumentCount: snapshot.persistedData.instrumentCountWithTicks,
      instrumentsWithoutPersistedTicks: snapshot.persistedData.instrumentsWithoutPersistedTicks,
      researchOperations: ['summary', 'returns', 'returns_series', 'prices', 'volatility', 'rolling_volatility', 'drawdown', 'runs', 'autocorrelation', 'entropy', 'sequence', 'distribution', 'quantiles', 'histogram', 'zscore', 'bootstrap_mean', 'ohlc', 'quality', 'features'],
      limits: { maxTicksPerAnalysis: 100000, maxBacktestTicks: BACKTEST_MAX_TICKS, maxReplayTicks: 5000, maxResearchSteps: 25, maxPermutationRuns: 2000 },
      knownGaps: snapshot.knownGaps,
      recommendation: snapshot.persistedData.instrumentsWithoutPersistedTicks.length ? 'Catalogue access is broader than historical tick coverage. SIRE can choose any catalogue instrument, but historical analysis requires ingestion for that instrument.' : 'The current persisted catalogue and data coverage are internally consistent.'
    };
  }
  throw new Error(`Unknown SIRE tool: ${tool}`);
}

export const handler = router({
  'POST /api/sire/data/ensure': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>;
      const symbol = String(payload.symbol || '').trim();
      if (!symbol) return error('symbol is required', 400);
      try { return json({ ok: true, ...(await ensureDerivHistory(symbol, Number(payload.ticks || 10000))) }); }
      catch (cause) { return error(cause instanceof Error ? cause.message : String(cause), 502); }
    },
  ],
  'GET /api/sire/data/m30-trend': [
    async ({ query }) => {
      const symbol = String(query.symbol || '').trim();
      if (!symbol) return error('symbol is required', 400);
      try { return json({ ok: true, ...(await analyzeM30Trend(symbol, Number(query.candles || 250))) }); }
      catch (cause) { return error(cause instanceof Error ? cause.message : String(cause), 502); }
    },
  ],
  'GET /api/sire/environment/audit': [
    async () => json({ ok: true, ...(await autonomousEnvironmentAudit()) }),
  ],
  'GET /api/_healthcheck': [
    async () => json({ ok: true, source: 'Deriv', part: 1 }),
  ],
  'GET /api/sire/coverage': [
    async ({ query }) => {
      const symbol = query.symbol;
      if (!symbol) return error('symbol is required', 400);
      return json({ coverage: await findCoverage(symbol), storage: { persistent: true, version: STORAGE_VERSION, source: 'Deriv', resumable: true, deduplicated: true } });
    },
  ],
  'POST /api/sire/ingest': [
    async ({ body }) => {
      const payload = body as { symbol?: unknown; source?: unknown; ticks?: unknown };
      const symbol = String(payload.symbol || '').trim();
      if (!symbol || payload.source !== 'Deriv' || !Array.isArray(payload.ticks)) {
        return error('symbol, source=Deriv and ticks[] are required', 400);
      }
      if (payload.ticks.length > MAX_TICKS) return error(`Maximum ${MAX_TICKS} ticks per ingest request`, 413);
      const clean = normalizeTicks(symbol, payload.ticks.filter(validTick));
      if (!clean.length) return error('No valid Deriv ticks supplied', 422);
      const persistedKeys = await recentPersistedTicks(symbol);
      const unique = clean.filter(tick => !persistedKeys.has(keyFor(tick)));
      if (!unique.length) return json({ ok: true, inserted: 0, duplicate: true, source: 'Deriv', storageVersion: STORAGE_VERSION });

      let inserted = 0;
      const batchIds: string[] = [];
      for (let offset = 0; offset < unique.length; offset += MAX_STORED_TICKS_PER_BATCH) {
        const chunk = unique.slice(offset, offset + MAX_STORED_TICKS_PER_BATCH);
        const ingestKey = batchKey(symbol, chunk);
        const record: BatchRecord = {
          symbol,
          source: 'Deriv',
          firstEpoch: chunk[0].epoch,
          lastEpoch: chunk[chunk.length - 1].epoch,
          count: chunk.length,
          ticks: chunk,
          ingestKey,
          createdAt: Date.now(),
        };
        const [id] = await db.add(BATCH_TABLE, [record]);
        if (!id) return error('Persistent storage rejected the tick batch', 500);
        batchIds.push(id);
        inserted += chunk.length;
      }

      const coverageRows = await db.list<CoverageRecord>(COVERAGE_TABLE, { limit: 100 });
      const current = coverageRows.items.find(item => item.symbol === symbol);
      const epochs = unique.map(tick => tick.epoch);
      const coverage: CoverageRecord = {
        symbol,
        storedTicks: (current?.storedTicks || 0) + inserted,
        oldestEpoch: Math.min(current?.oldestEpoch ?? Infinity, ...epochs),
        newestEpoch: Math.max(current?.newestEpoch ?? -Infinity, ...epochs),
        lastIngestAt: Date.now(),
        batches: (current?.batches || 0) + batchIds.length,
        lastBatchId: batchIds[batchIds.length - 1] || null,
        lastIngestKey: batchKey(symbol, unique.slice(-1)),
        storageVersion: STORAGE_VERSION,
      };
      if (current) await db.update(COVERAGE_TABLE, [{ id: current.id, record: coverage }]);
      else await db.add(COVERAGE_TABLE, [coverage]);

      return json({ ok: true, inserted, duplicateTicksSkipped: clean.length - unique.length, batchIds, source: 'Deriv', storageVersion: STORAGE_VERSION });
    },
  ],
  'GET /api/sire/history': [
    async ({ query }) => {
      const symbol = query.symbol;
      if (!symbol) return error('symbol is required', 400);
      const requestedLimit = Math.max(1, Number(query.limit || 5000));
      const limit = Math.min(100, requestedLimit);
      const batches: BatchRecord[] = [];
      let nextToken: string | undefined;
      // Follow bounded pages until we have enough matching batches. The previous
      // implementation stopped after 100 pages even when the requested history was
      // larger, making older candles disappear after reload.
      for (let page = 0; page < 500; page += 1) {
        const response = await db.list<BatchRecord>(BATCH_TABLE, {
          limit,
          ...(nextToken ? { nextToken } : {}),
        });
        batches.push(...response.items.filter(item => item.symbol === symbol));
        nextToken = response.nextToken;
        if (!nextToken || batches.reduce((sum, batch) => sum + batch.count, 0) >= Math.min(100000, requestedLimit)) break;
      }
      const ticks = Array.from(
        new Map(
          batches.flatMap(item => item.ticks).map(tick => [keyFor(tick), tick])
        ).values()
      ).sort((a, b) => a.epoch - b.epoch);
      return json({
        source: 'Deriv',
        symbol,
        storageVersion: STORAGE_VERSION,
        persisted: true,
        // Return the requested historical window instead of silently truncating every chart load to 5,000 ticks.
        ticks: ticks.slice(-Math.min(100000, requestedLimit)),
        batches: batches.length,
      });
    },
  ],
  'GET /api/sire/catalogue': [
    async () => {
      const rows = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 });
      return json({ ok: true, source: 'Deriv', count: rows.items.length, instruments: rows.items });
    },
  ],
  'POST /api/sire/catalogue/sync': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>;
      const instruments = Array.isArray(payload.instruments)
        ? payload.instruments.filter(item => item && typeof item === 'object')
        : [];
      if (!instruments.length) return error('instruments[] is required', 400);
      const rows = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 });
      const existing = new Map(rows.items.map(item => [String(item.symbol || item.underlying_symbol || ''), item]));
      let added = 0;
      let updated = 0;
      for (const item of instruments) {
        const row = item as Record<string, unknown>;
        const symbol = String(row.underlying_symbol || row.symbol || '').trim();
        if (!symbol) continue;
        const record = { ...row, symbol, source: 'Deriv', discoveredAt: Date.now(), updatedAt: Date.now() };
        const prior = existing.get(symbol);
        if (prior?.id) {
          await db.update(CATALOGUE_TABLE, [{ id: prior.id, record }]);
          updated += 1;
        } else {
          await db.add(CATALOGUE_TABLE, [record]);
          added += 1;
        }
      }
      return json({ ok: true, source: 'Deriv', discovered: instruments.length, added, updated, persisted: added + updated });
    },
  ],
  'POST /api/sire/research/catalogue': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>;
      const instruments = Array.isArray(payload.instruments)
        ? payload.instruments.filter(item => item && typeof item === 'object')
        : [];
      if (!instruments.length) return error('instruments[] is required', 400);
      const rows = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 });
      const existing = new Map(rows.items.map(item => [String(item.symbol || item.underlying_symbol || ''), item]));
      for (const item of instruments) {
        const row = item as Record<string, unknown>;
        const symbol = String(row.underlying_symbol || row.symbol || '').trim();
        if (!symbol) continue;
        const prior = existing.get(symbol);
        const record = { ...row, symbol, updatedAt: Date.now(), source: 'Deriv' };
        if (prior?.id) await db.update(CATALOGUE_TABLE, [{ id: prior.id, record }]);
        else await db.add(CATALOGUE_TABLE, [record]);
      }
      return json({ ok: true, stored: instruments.length, source: 'Deriv' });
    },
  ],
  'GET /api/sire/research/latest': [
    async ({ query }) => { const symbol = String(query.symbol || ''); if (!symbol) return error('symbol is required', 400); const batches = await allBatches(symbol); const ticks = numericTicks(batches, symbol, undefined, undefined, 10); return json({ ok: true, source: 'Deriv', symbol, latest: ticks[ticks.length - 1] || null, recent: ticks }); },
  ],
  'GET /api/sire/research/quality': [
    async ({ query }) => { const symbol = String(query.symbol || ''); if (!symbol) return error('symbol is required', 400); const batches = await allBatches(symbol); const ticks = numericTicks(batches, symbol, undefined, undefined, Number(query.limit || 100000)); return json({ ok: true, symbol, source: 'Deriv', quality: quality(ticks) }); },
  ],
  'GET /api/sire/research/ohlc': [
    async ({ query }) => { const symbol = String(query.symbol || ''); if (!symbol) return error('symbol is required', 400); const batches = await allBatches(symbol); const ticks = numericTicks(batches, symbol, query.startEpoch === undefined ? undefined : Number(query.startEpoch), query.endEpoch === undefined ? undefined : Number(query.endEpoch), Number(query.limit || 100000)); const timeframeSeconds = Math.max(1, Number(query.timeframeSeconds || 60)); return json({ ok: true, symbol, source: 'Deriv', timeframeSeconds, candles: ohlc(ticks, timeframeSeconds) }); },
  ],
  'GET /api/sire/research/compare': [
    async ({ query }) => { const symbolA = String(query.symbolA || ''); const symbolB = String(query.symbolB || ''); if (!symbolA || !symbolB) return error('symbolA and symbolB are required', 400); const start = query.startEpoch === undefined ? undefined : Number(query.startEpoch); const end = query.endEpoch === undefined ? undefined : Number(query.endEpoch); const [aBatches, bBatches] = await Promise.all([allBatches(symbolA), allBatches(symbolB)]); const a = numericTicks(aBatches, symbolA, start, end, Number(query.limit || 100000)); const b = numericTicks(bBatches, symbolB, start, end, Number(query.limit || 100000)); const n = Math.min(a.length, b.length); const ap = a.slice(-n).map(t => t.quote); const bp = b.slice(-n).map(t => t.quote); const ar = returns(a).slice(-Math.max(0, n - 1)); const br = returns(b).slice(-Math.max(0, n - 1)); return json({ ok: true, source: 'Deriv', symbolA, symbolB, sampleCount: n, priceCorrelation: pearson(ap, bp), returnCorrelation: pearson(ar, br), statsA: stats(ar), statsB: stats(br) }); },
  ],
  'GET /api/sire/research/context': [
    async ({ query }) => {
      const symbol = String(query.symbol || '');
      if (!symbol) return error('symbol is required', 400);
      return json(await researchContext(symbol));
    },
  ],
  'GET /api/sire/research/query': [
    async ({ query }) => {
      const symbol = String(query.symbol || ''); const operation = String(query.operation || 'summary');
      if (!symbol) return error('symbol is required', 400);
      const start = query.startEpoch === undefined ? undefined : Number(query.startEpoch);
      const end = query.endEpoch === undefined ? undefined : Number(query.endEpoch);
      const batches = await allBatches(symbol); const ticks = numericTicks(batches, symbol, start, end, Number(query.limit || 100000));
      const result = analyzeTicks(ticks, operation, { sequenceLength: Number(query.sequenceLength || 37), reversalHorizon: Number(query.reversalHorizon || 10), lag: Number(query.lag || 1), bins: Number(query.bins || 10) });
      return json({ ok: true, source: 'Deriv', symbol, startEpoch: start ?? ticks[0]?.epoch ?? null, endEpoch: end ?? ticks[ticks.length - 1]?.epoch ?? null, sampleCount: ticks.length, result, ticks: query.includeTicks === '1' ? ticks.slice(-Math.min(5000, ticks.length)) : undefined, provenance: 'SIRE persistent Deriv tick store' });
    },
  ],
  'POST /api/sire/research/query': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>;
      const symbol = String(payload.symbol || ''); const operation = String(payload.operation || 'summary');
      if (!symbol) return error('symbol is required', 400);
      const start = payload.startEpoch === undefined ? undefined : Number(payload.startEpoch);
      const end = payload.endEpoch === undefined ? undefined : Number(payload.endEpoch);
      const batches = await allBatches(symbol); const ticks = numericTicks(batches, symbol, start, end, Number(payload.limit || 100000));
      const result = analyzeTicks(ticks, operation, { sequenceLength: Number(payload.sequenceLength || 37), reversalHorizon: Number(payload.reversalHorizon || 10), lag: Number(payload.lag || 1), bins: Number(payload.bins || 10) });
      return json({ ok: true, source: 'Deriv', symbol, startEpoch: start ?? ticks[0]?.epoch ?? null, endEpoch: end ?? ticks[ticks.length - 1]?.epoch ?? null, sampleCount: ticks.length, result, ticks: payload.includeTicks ? ticks.slice(-Math.min(5000, ticks.length)) : undefined, provenance: 'SIRE persistent Deriv tick store' });
    },
  ],
  'GET /api/sire/research/environment': [
    async ({ query }) => json({ ok: true, result: await environmentSnapshot({ includeMarketState: query.includeMarketState !== '0', includeDataCoverage: query.includeDataCoverage !== '0' }) }),
  ],
  'GET /api/sire/research/workspace': [
    async ({ query }) => {
      const symbol = query.symbol ? String(query.symbol) : '';
      const context = symbol ? await researchContext(symbol) : null;
      const rows = await db.list<Record<string, unknown>>(RESEARCH_TABLE, { limit: 100 });
      const catalogue = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 });
      const experiments = symbol ? rows.items.filter(row => row.symbol === symbol) : rows.items;
      return json({ ok: true, workspace: { source: 'Deriv', selectedSymbol: symbol || null, context, catalogue: catalogue.items, experiments: experiments.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)), tools: RESEARCH_TOOL_MANIFEST.tools, operations: RESEARCH_TOOL_MANIFEST.operations, controls: { analysis: true, rawTicks: true, replay: true, comparison: true, persistentMemory: true, programmaticAccess: true, catalogue: true, latest: true, quality: true, ohlc: true, multiStepResearch: true, audit: true } } });
    },
  ],
  'POST /api/sire/research/research': [
    async ({ body }) => { const payload = (body || {}) as Record<string, unknown>; try { return json({ ok: true, tool: 'research', result: await researchTool('research', payload), provenance: 'SIRE Research Gateway' }); } catch (cause) { return error(cause instanceof Error ? cause.message : String(cause), 400); } },
  ],
  'GET /api/sire/research/audit': [
    async () => json({ ok: true, result: await researchTool('audit', {}) }),
  ],
  'GET /api/sire/research/replay': [
    async ({ query }) => {
      const symbol = String(query.symbol || ''); if (!symbol) return error('symbol is required', 400);
      const start = query.startEpoch === undefined ? undefined : Number(query.startEpoch); const end = query.endEpoch === undefined ? undefined : Number(query.endEpoch); const batches = await allBatches(symbol); const ticks = numericTicks(batches, symbol, start, end, Number(query.limit || 5000));
      return json({ ok: true, symbol, source: 'Deriv', ticks, replay: { step: true, pause: true, speeds: [0.25, 0.5, 1, 2, 5, 20] } });
    },
  ],
  'POST /api/sire/research/experiments': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>; if (!payload.name || !payload.symbol) return error('name and symbol are required', 400);
      const [id] = await db.add(RESEARCH_TABLE, [{ name: String(payload.name), symbol: String(payload.symbol), hypothesis: String(payload.hypothesis || ''), methodology: String(payload.methodology || ''), result: payload.result || {}, createdAt: Date.now() }]);
      return json({ ok: true, id, experiment: payload });
    },
  ],
  'GET /api/sire/research/experiments': [
    async ({ query }) => { const rows = await db.list<Record<string, unknown>>(RESEARCH_TABLE, { limit: 100 }); const symbol = query.symbol ? String(query.symbol) : ''; return json({ experiments: rows.items.filter(row => !symbol || row.symbol === symbol).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)) }); },
  ],
});
