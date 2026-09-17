import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { createChart, darkTheme, type Chart } from 'openalgo-charts';
import './financialChart.css';

type Tick = { symbol: string; quote: number; epoch: number };
type HistoryResponse = Record<string, unknown>;
type HistoryRequester = (request: Record<string, unknown>) => Promise<HistoryResponse>;
type Instrument = { symbol: string; name: string };
type Props = { symbol: string; liveTick: Tick | null; requestHistory: HistoryRequester; instruments: Instrument[]; onSelectInstrument: (instrument: Instrument) => void };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type Period = { label: string; seconds: number };

const PERIODS: Period[] = [
  { label: '1m', seconds: 60 }, { label: '2m', seconds: 120 }, { label: '3m', seconds: 180 },
  { label: '5m', seconds: 300 }, { label: '10m', seconds: 600 }, { label: '15m', seconds: 900 },
  { label: '20m', seconds: 1200 }, { label: '30m', seconds: 1800 }, { label: '45m', seconds: 2700 },
  { label: '1H', seconds: 3600 }, { label: '2H', seconds: 7200 }, { label: '3H', seconds: 10800 },
  { label: '4H', seconds: 14400 }, { label: '6H', seconds: 21600 }, { label: '8H', seconds: 28800 },
  { label: '12H', seconds: 43200 }, { label: '1D', seconds: 86400 }, { label: '2D', seconds: 172800 },
  { label: '3D', seconds: 259200 }, { label: '1W', seconds: 604800 }, { label: '1M', seconds: 2592000 },
];

const PITCH_BLACK_THEME = {
  ...darkTheme,
  background: '#000000', grid: '#111111', axisText: '#8a8a8a', axisLine: '#242424', paneSeparator: '#161616',
  crosshair: '#555555', crosshairLabelBackground: '#161616', upColor: '#26a69a', wickUpColor: '#26a69a',
  downColor: '#ef5350', wickDownColor: '#ef5350', lastPriceUp: '#26a69a', lastPriceDown: '#ef5350', lastPriceText: '#ffffff',
};

function parseCandles(data: HistoryResponse): Candle[] | null {
  if (!Array.isArray(data.candles)) return null;
  const candles = data.candles.map((item: unknown) => {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    return { time: Number(raw.epoch), open: Number(raw.open), high: Number(raw.high), low: Number(raw.low), close: Number(raw.close) };
  }).filter((candle): candle is Candle => Boolean(candle) && Number.isFinite(candle.time) && Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close));
  return candles.length ? candles.sort((a, b) => a.time - b.time) : null;
}

function parseTicks(data: HistoryResponse): { epoch: number; quote: number }[] | null {
  const history = data.history as Record<string, unknown> | undefined;
  const prices = Array.isArray(history?.prices) ? history.prices : [];
  const times = Array.isArray(history?.times) ? history.times : [];
  if (!prices.length || !times.length) return null;
  return prices.map((price, index) => ({ epoch: Number(times[index]), quote: Number(price) })).filter(item => Number.isFinite(item.epoch) && Number.isFinite(item.quote));
}

function aggregateTicks(data: { epoch: number; quote: number }[], seconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const tick of data) {
    const time = Math.floor(tick.epoch / seconds) * seconds;
    const current = buckets.get(time);
    if (!current) buckets.set(time, { time, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote });
    else { current.high = Math.max(current.high, tick.quote); current.low = Math.min(current.low, tick.quote); current.close = tick.quote; }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

async function loadHistory(symbol: string, seconds: number, request: HistoryRequester): Promise<Candle[]> {
  const result = await request({ ticks_history: symbol, end: 'latest', count: 1500, style: 'candles', granularity: seconds });
  const candles = parseCandles(result);
  if (candles) return candles;
  const ticks = parseTicks(result);
  if (ticks?.length) return aggregateTicks(ticks, seconds);
  throw new Error('Deriv returned no chart history');
}

export default function FinancialChart({ symbol, liveTick, requestHistory, instruments, onSelectInstrument }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const seriesRef = useRef<any>(null);
  const candlesRef = useRef<Candle[]>([]);
  const periodRef = useRef(PERIODS[0].seconds);
  const generationRef = useRef(0);
  const latestTickRef = useRef<Tick | null>(null);
  const symbolRef = useRef(symbol);
  const [period, setPeriod] = useState(PERIODS[0].seconds);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [periodOpen, setPeriodOpen] = useState(false);
  const pressTimerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMovedRef = useRef(false);
  const interactionRef = useRef<'instrument' | 'period' | null>(null);

  const selectedIndex = Math.max(0, instruments.findIndex(item => item.symbol === symbol));
  const currentInstrument = instruments[selectedIndex];
  const previousInstrument = instruments.length ? instruments[(selectedIndex - 1 + instruments.length) % instruments.length] : undefined;
  const nextInstrument = instruments.length ? instruments[(selectedIndex + 1) % instruments.length] : undefined;
  const currentPeriod = PERIODS.find(item => item.seconds === period) || PERIODS[0];
  const previousPeriod = PERIODS[(PERIODS.findIndex(item => item.seconds === period) - 1 + PERIODS.length) % PERIODS.length];
  const nextPeriod = PERIODS[(PERIODS.findIndex(item => item.seconds === period) + 1) % PERIODS.length];
  const filteredInstruments = instruments.filter(item => `${item.name} ${item.symbol}`.toLowerCase().includes(searchQuery.trim().toLowerCase()));
  const latestCandle = candlesRef.current[candlesRef.current.length - 1];
  const livePrice = liveTick?.symbol === symbol ? liveTick.quote : latestCandle?.close;
  const formatPrice = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });

  const clearPressTimer = () => {
    if (pressTimerRef.current !== null) { window.clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
  };
  const changeInstrument = (direction: 1 | -1) => {
    if (!instruments.length || instruments.length === 1) return;
    const nextIndex = (selectedIndex + direction + instruments.length) % instruments.length;
    onSelectInstrument(instruments[nextIndex]);
  };
  const changePeriod = (direction: 1 | -1) => {
    const currentIndex = PERIODS.findIndex(item => item.seconds === period);
    const nextIndex = (currentIndex + direction + PERIODS.length) % PERIODS.length;
    setPeriod(PERIODS[nextIndex].seconds);
  };
  const handlePointerDown = (zone: 'instrument' | 'period') => (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId); interactionRef.current = zone;
    pointerStartRef.current = { x: event.clientX, y: event.clientY }; pointerMovedRef.current = false; clearPressTimer();
    pressTimerRef.current = window.setTimeout(() => {
      if (!pointerMovedRef.current && interactionRef.current === zone) {
        if (zone === 'instrument') { setPeriodOpen(false); setSearchOpen(true); setSearchQuery(''); }
        else { setSearchOpen(false); setPeriodOpen(true); }
      }
      pressTimerRef.current = null;
    }, 600);
  };
  const handlePointerMove = (zone: 'instrument' | 'period') => (event: PointerEvent<HTMLDivElement>) => {
    if (interactionRef.current !== zone) return; const start = pointerStartRef.current; if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) { pointerMovedRef.current = true; clearPressTimer(); }
  };
  const handlePointerUp = (zone: 'instrument' | 'period') => (event: PointerEvent<HTMLDivElement>) => {
    if (interactionRef.current !== zone) return; const start = pointerStartRef.current; clearPressTimer(); pointerStartRef.current = null; interactionRef.current = null; if (!start) return;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) >= 24) { if (zone === 'instrument') changeInstrument(dy < 0 ? 1 : -1); else changePeriod(dy < 0 ? 1 : -1); }
    pointerMovedRef.current = false;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
  };
  const handlePointerCancel = (zone: 'instrument' | 'period') => (event: PointerEvent<HTMLDivElement>) => {
    if (interactionRef.current !== zone) return; clearPressTimer(); pointerStartRef.current = null; pointerMovedRef.current = false; interactionRef.current = null;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
  };
  const handleWheel = (zone: 'instrument' | 'period') => (event: WheelEvent<HTMLDivElement>) => {
    event.stopPropagation(); if (Math.abs(event.deltaY) < 8) return; event.preventDefault();
    if (zone === 'instrument') changeInstrument(event.deltaY > 0 ? -1 : 1); else changePeriod(event.deltaY > 0 ? -1 : 1);
  };

  const updateTick = (tick: Tick, seconds: number) => {
    const series = seriesRef.current;
    if (!series || tick.symbol !== symbolRef.current || !Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) return;
    const time = Math.floor(tick.epoch / seconds) * seconds; const last = candlesRef.current[candlesRef.current.length - 1];
    const next: Candle = last?.time === time ? { ...last, high: Math.max(last.high, tick.quote), low: Math.min(last.low, tick.quote), close: tick.quote } : { time, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote };
    if (last?.time === time) candlesRef.current[candlesRef.current.length - 1] = next; else candlesRef.current.push(next);
    if (candlesRef.current.length > 1500) candlesRef.current.shift(); series.update(next);
  };

  useEffect(() => { symbolRef.current = symbol; latestTickRef.current = null; }, [symbol]);
  useEffect(() => () => clearPressTimer(), []);
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, { theme: PITCH_BLACK_THEME, timezone: 'Africa/Lagos', branding: false, navigation: { mousePan: 'both', defaultVisibleBars: 120 }, crosshair: { mode: 'normal' }, grid: { vertical: true, horizontal: true } });
    const series = chart.addSeries('candlestick'); chartRef.current = chart; seriesRef.current = series;
    return () => { chart.destroy(); chartRef.current = null; seriesRef.current = null; };
  }, []);
  useEffect(() => {
    const generation = ++generationRef.current;
    if (!symbol || !seriesRef.current) return; periodRef.current = period; setLoading(true); setError('');
    loadHistory(symbol, period, requestHistory).then(candles => {
      if (generation !== generationRef.current || !seriesRef.current) return;
      candlesRef.current = candles; seriesRef.current.setData(candles); const pending = latestTickRef.current; if (pending?.symbol === symbol) updateTick(pending, period);
    }).catch(reason => { if (generation === generationRef.current) setError(reason instanceof Error ? reason.message : 'Unable to load chart history from Deriv'); }).finally(() => { if (generation === generationRef.current) setLoading(false); });
    return () => { generationRef.current += 1; };
  }, [symbol, period, requestHistory]);
  useEffect(() => { latestTickRef.current = liveTick; if (liveTick?.symbol === symbolRef.current) updateTick(liveTick, periodRef.current); }, [liveTick]);

  return (
    <div className="sire-financial-chart">
      <div className="sire-chart-periods" role="toolbar" aria-label="Chart timeframe">
        {PERIODS.map(item => <button key={item.label} type="button" className={period === item.seconds ? 'active' : ''} onClick={() => setPeriod(item.seconds)}>{item.label}</button>)}
      </div>
      <div ref={containerRef} className="sire-chart-canvas" />
      <div className="sire-chart-market-info" aria-live="polite">
        <div className="sire-chart-market-name">{currentInstrument?.name || symbol}</div>
        <div className="sire-chart-live-price">{formatPrice(livePrice)}</div>
        <div className="sire-chart-ohlc">
          <span>O <b>{formatPrice(latestCandle?.open)}</b></span>
          <span>H <b>{formatPrice(latestCandle?.high)}</b></span>
          <span>L <b>{formatPrice(latestCandle?.low)}</b></span>
          <span>C <b>{formatPrice(latestCandle?.close)}</b></span>
        </div>
      </div>
      {(loading || error) && <div className={`sire-chart-status${error ? ' error' : ''}`}>{error || `Loading ${symbol} history...`}</div>}
      <div className="sire-chart-bottom-glass">
        <div className="sire-instrument-control" onPointerDown={handlePointerDown('instrument')} onPointerMove={handlePointerMove('instrument')} onPointerUp={handlePointerUp('instrument')} onPointerCancel={handlePointerCancel('instrument')} onWheel={handleWheel('instrument')} onContextMenu={event => event.preventDefault()} role="button" tabIndex={0} aria-label={`Change instrument. Current instrument ${currentInstrument?.name || symbol}. Hold for search.`}>
          <div className="sire-instrument-carousel" aria-live="polite">
            <div className="sire-instrument-neighbor sire-instrument-neighbor-top">{previousInstrument?.name || ''}</div>
            <div className="sire-instrument-current">{currentInstrument?.name || symbol}</div>
            <div className="sire-instrument-neighbor sire-instrument-neighbor-bottom">{nextInstrument?.name || ''}</div>
          </div>
          {searchOpen && (
            <div className="sire-instrument-search" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
              <div className="sire-instrument-search-head"><input autoFocus value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search Synthetic Indices" aria-label="Search Synthetic Indices" /><button type="button" onClick={() => setSearchOpen(false)}>Close</button></div>
              <div className="sire-instrument-search-results">
                {filteredInstruments.slice(0, 40).map(item => <button key={item.symbol} type="button" className={item.symbol === symbol ? 'active' : ''} onClick={() => { onSelectInstrument(item); setSearchOpen(false); setSearchQuery(''); }}><span>{item.name}</span><small>{item.symbol}</small></button>)}
                {!filteredInstruments.length && <div className="sire-instrument-empty">No Synthetic Indices found.</div>}
              </div>
            </div>
          )}
        </div>
        <div className="sire-period-control" onPointerDown={handlePointerDown('period')} onPointerMove={handlePointerMove('period')} onPointerUp={handlePointerUp('period')} onPointerCancel={handlePointerCancel('period')} onWheel={handleWheel('period')} onContextMenu={event => event.preventDefault()} role="button" tabIndex={0} aria-label={`Change timeframe. Current timeframe ${currentPeriod.label}. Hold for timeframe selection.`}>
          <div className="sire-period-carousel" aria-live="polite"><div className="sire-period-neighbor sire-period-neighbor-top">{previousPeriod.label}</div><div className="sire-period-current">{currentPeriod.label}</div><div className="sire-period-neighbor sire-period-neighbor-bottom">{nextPeriod.label}</div></div>
          {periodOpen && <div className="sire-period-search" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}><div className="sire-period-list">{PERIODS.map(item => <button key={item.label} type="button" className={item.seconds === period ? 'active' : ''} onClick={() => { setPeriod(item.seconds); setPeriodOpen(false); }}>{item.label}</button>)}</div></div>}
        </div>
      </div>
    </div>
  );
}
