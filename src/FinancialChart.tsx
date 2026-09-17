import { useEffect, useRef, useState, type ComponentProps, type PointerEvent, type WheelEvent } from 'react';
import { createChart, darkTheme, type Chart } from 'openalgo-charts';
import { DrawingController } from 'openalgo-charts/draw';
import { Pencil, Magnet, Lock, EyeOff, Trash2, Undo2, Redo2, X } from 'lucide-react';
import { DRAWING_TOOL_ICONS, hasDrawingTool, getDrawingTool } from 'openalgo-charts/draw';
import './financialChart.css';

type LoadingApi = { show: (message?: string) => void; hide: () => void };
const getSIRELoading = () => (window as Window & { SIRELoading?: LoadingApi }).SIRELoading;

type Tick = { symbol: string; quote: number; epoch: number };
type HistoryResponse = Record<string, unknown>;
type HistoryRequester = (request: Record<string, unknown>) => Promise<HistoryResponse>;
type Instrument = { symbol: string; name: string };
type Props = { symbol: string; liveTick: Tick | null; requestHistory: HistoryRequester; instruments: Instrument[]; onSelectInstrument: (instrument: Instrument) => void };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type Period = { label: string; seconds: number };
type ToolId = string;
type ToolId = string;
type ToolGroup = { id: string; label: string; tools: ToolId[] };

const DRAWING_GROUPS: ToolGroup[] = [
  { id: 'lines', label: 'Lines', tools: ['trend-line','ray','extended-line','arrow','info-line','trend-angle','horizontal-line','horizontal-ray','vertical-line','cross-line'] },
  { id: 'channels', label: 'Channels', tools: ['parallel-channel','fib-channel','disjoint-channel','flat-top-bottom','regression-channel','pitchfork','schiff-pitchfork','modified-schiff-pitchfork','inside-pitchfork'] },
  { id: 'fib', label: 'Fibonacci & Gann', tools: ['fib-retracement','fib-extension','fib-time-zone','fib-fan','fib-extension-two-point','fib-speed-resistance-fan','trend-fib-time','fib-circles','fib-speed-resistance-arcs','fib-wedge','fib-spiral','gann-fan','gann-box','gann-square'] },
  { id: 'shapes', label: 'Shapes', tools: ['rectangle','rotated-rectangle','ellipse','circle','triangle','path','polyline','arc','curve','double-curve'] },
  { id: 'cycles', label: 'Cycles', tools: ['cyclic-lines','time-cycles','sine-line'] },
  { id: 'patterns', label: 'Patterns', tools: ['xabcd-pattern','abcd-pattern','head-shoulders','elliott-impulse','elliott-correction','gartley','bat','butterfly','crab','shark','cypher'] },
  { id: 'geometry', label: 'Geometric studies', tools: ['dedekind-tessellation','sonic','supersonic','golden-sonic','golden-supersonic'] },
  { id: 'marks', label: 'Arrows & marks', tools: ['arrow-up','arrow-down','arrow-left','arrow-right','flag-mark','icon-stamp','price-label','signpost'] },
  { id: 'forecast', label: 'Forecasting', tools: ['long-position','short-position','forecast'] },
  { id: 'measure', label: 'Measurement', tools: ['price-range','date-range','measure'] },
  { id: 'text', label: 'Text & notes', tools: ['text','note','callout','balloon','comment','price-note','table','brush','highlighter'] },
];

const DRAWING_GROUP_ICONS: Record<string,string> = {
  lines:'M3 18 21 6', channels:'M2 17 10 9M8 21 22 7', fib:'M3 5h18M3 12h18M3 19h18', shapes:'M4 5h16v14H4z',
  cycles:'M3 12h18M12 3v18', patterns:'M4 17 9 7l6 10 5-12', geometry:'M4 18 12 4l8 14M7 14h10', marks:'M4 12h14m-5-5 5 5-5 5',
  forecast:'M4 18 11 11l4 4 5-9', measure:'M4 18 20 6M7 18h13M4 18v-3', text:'M5 5h14M12 5v14M8 19h8',
};

function drawingGlyph(id: string, size = 18) {
  const d = DRAWING_TOOL_ICONS[id] || DRAWING_GROUP_ICONS[id] || DRAWING_TOOL_ICONS['cursor'];
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}


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
  const drawingRef = useRef<DrawingController | null>(null);
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
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [drawingGroup, setDrawingGroup] = useState('lines');
  const [activeTool, setActiveTool] = useState<string | null>(null);
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

  const clearPressTimer = () => { if (pressTimerRef.current !== null) { window.clearTimeout(pressTimerRef.current); pressTimerRef.current = null; } };
  const changeInstrument = (direction: 1 | -1) => { if (!instruments.length || instruments.length === 1) return; const nextIndex = (selectedIndex + direction + instruments.length) % instruments.length; onSelectInstrument(instruments[nextIndex]); };
  const changePeriod = (direction: 1 | -1) => { const currentIndex = PERIODS.findIndex(item => item.seconds === period); const nextIndex = (currentIndex + direction + PERIODS.length) % PERIODS.length; setPeriod(PERIODS[nextIndex].seconds); };
  const handlePointerDown = (zone: 'instrument' | 'period') => (event: PointerEvent<HTMLDivElement>) => { event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId); interactionRef.current = zone; pointerStartRef.current = { x: event.clientX, y: event.clientY }; pointerMovedRef.current = false; clearPressTimer(); pressTimerRef.current = window.setTimeout(() => { if (!pointerMovedRef.current && interactionRef.current === zone) { if (zone === 'instrument') { setPeriodOpen(false); setSearchOpen(true); setSearchQuery(''); } else { setSearchOpen(false); setPeriodOpen(true); } } pressTimerRef.current = null; }, 600); };
  const handlePointerMove = (zone: 'instrument' | 'period') => (event: PointerEvent<HTMLDivElement>) => { if (interactionRef.current !== zone) return; const start = pointerStartRef.current; if (!start) return; if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) { pointerMovedRef.current = true; clearPressTimer(); } };
  const handlePointerUp = (zone: 'instrument' | 'period') => (event: PointerEvent<HTMLDivElement>) => { if (interactionRef.current !== zone) return; const start = pointerStartRef.current; clearPressTimer(); pointerStartRef.current = null; interactionRef.current = null; if (!start) return; const dy = event.clientY - start.y; if (Math.abs(dy) >= 24) { if (zone === 'instrument') changeInstrument(dy < 0 ? 1 : -1); else changePeriod(dy < 0 ? 1 : -1); } pointerMovedRef.current = false; try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* already released */ } };
  const handlePointerCancel = (zone: 'instrument' | 'period') => (event: PointerEvent<HTMLDivElement>) => { if (interactionRef.current !== zone) return; clearPressTimer(); pointerStartRef.current = null; pointerMovedRef.current = false; interactionRef.current = null; try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* already released */ } };
  const handleDrawingTool = (tool: ToolId) => {
    if (!drawingRef.current || !hasDrawingTool(tool)) return;
    try {
      drawingRef.current.setTool(tool);
      setActiveTool(tool);
      setDrawingOpen(false);
    } catch {
      setActiveTool(null);
    }
  };
  const handleWheel = (zone: 'instrument' | 'period') => (event: WheelEvent<HTMLDivElement>) => { event.stopPropagation(); if (Math.abs(event.deltaY) < 8) return; event.preventDefault(); if (zone === 'instrument') changeInstrument(event.deltaY > 0 ? -1 : 1); else changePeriod(event.deltaY > 0 ? -1 : 1); };

  const updateTick = (tick: Tick, seconds: number) => { const series = seriesRef.current; if (!series || tick.symbol !== symbolRef.current || !Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) return; const time = Math.floor(tick.epoch / seconds) * seconds; const last = candlesRef.current[candlesRef.current.length - 1]; const next: Candle = last?.time === time ? { ...last, high: Math.max(last.high, tick.quote), low: Math.min(last.low, tick.quote), close: tick.quote } : { time, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote }; if (last?.time === time) candlesRef.current[candlesRef.current.length - 1] = next; else candlesRef.current.push(next); if (candlesRef.current.length > 1500) candlesRef.current.shift(); series.update(next); };

  useEffect(() => { symbolRef.current = symbol; latestTickRef.current = null; }, [symbol]);
  useEffect(() => () => clearPressTimer(), []);
  useEffect(() => { if (!containerRef.current) return; const chart = createChart(containerRef.current, { theme: PITCH_BLACK_THEME, timezone: 'Africa/Lagos', branding: false, navigation: { mousePan: 'both', defaultVisibleBars: 120 }, crosshair: { mode: 'normal' }, grid: { vertical: true, horizontal: true } }); const series = chart.addSeries('candlestick'); chartRef.current = chart; seriesRef.current = series; drawingRef.current = new DrawingController(chart, { magnet: 'weak' }); return () => { chart.destroy(); drawingRef.current = null; chartRef.current = null; seriesRef.current = null; }; }, []);
  useEffect(() => {
    const generation = ++generationRef.current;
    if (!symbol || !seriesRef.current) return;
    periodRef.current = period; setLoading(true); setError('');
    getSIRELoading()?.show(`Loading ${symbol} history...`);
    loadHistory(symbol, period, requestHistory).then(candles => {
      if (generation !== generationRef.current || !seriesRef.current) return;
      candlesRef.current = candles; seriesRef.current.setData(candles); const pending = latestTickRef.current; if (pending?.symbol === symbol) updateTick(pending, period);
    }).catch(reason => {
      if (generation === generationRef.current) setError(reason instanceof Error ? reason.message : 'Unable to load chart history from Deriv');
    }).finally(() => {
      if (generation === generationRef.current) { setLoading(false); getSIRELoading()?.hide(); }
    });
    return () => { generationRef.current += 1; };
  }, [symbol, period, requestHistory]);
  useEffect(() => { latestTickRef.current = liveTick; if (liveTick?.symbol === symbolRef.current) updateTick(liveTick, periodRef.current); }, [liveTick]);

  return (
    <div className="sire-financial-chart">
      <div className="sire-chart-periods" role="toolbar" aria-label="Chart timeframe">{PERIODS.map(item => <button key={item.label} type="button" className={period === item.seconds ? 'active' : ''} onClick={() => setPeriod(item.seconds)}>{item.label}</button>)}</div>
      <div ref={containerRef} className="sire-chart-canvas" />
      <div className="sire-chart-market-info" aria-live="polite"><div className="sire-chart-market-name">{currentInstrument?.name || symbol}</div><div className="sire-chart-live-price">{formatPrice(livePrice)}</div><div className="sire-chart-ohlc"><span>O <b>{formatPrice(latestCandle?.open)}</b></span><span>H <b>{formatPrice(latestCandle?.high)}</b></span><span>L <b>{formatPrice(latestCandle?.low)}</b></span><span>C <b>{formatPrice(latestCandle?.close)}</b></span></div></div>
      {(loading || error) && <div className={`sire-chart-status${error ? ' error' : ''}`}>{error || `Loading ${symbol} history...`}</div>}
      <div className="sire-chart-bottom-glass">
        <div className="sire-instrument-control" onPointerDown={handlePointerDown('instrument')} onPointerMove={handlePointerMove('instrument')} onPointerUp={handlePointerUp('instrument')} onPointerCancel={handlePointerCancel('instrument')} onWheel={handleWheel('instrument')} onContextMenu={event => event.preventDefault()} role="button" tabIndex={0} aria-label={`Change instrument. Current instrument ${currentInstrument?.name || symbol}. Hold for search.`}>
          <div className="sire-instrument-carousel" aria-live="polite"><div className="sire-instrument-neighbor sire-instrument-neighbor-top">{previousInstrument?.name || ''}</div><div className="sire-instrument-current">{currentInstrument?.name || symbol}</div><div className="sire-instrument-neighbor sire-instrument-neighbor-bottom">{nextInstrument?.name || ''}</div></div>
          {searchOpen && <div className="sire-instrument-search" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}><div className="sire-instrument-search-head"><input autoFocus value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search Synthetic Indices" aria-label="Search Synthetic Indices" /><button type="button" onClick={() => setSearchOpen(false)}>Close</button></div><div className="sire-instrument-search-results">{filteredInstruments.slice(0, 40).map(item => <button key={item.symbol} type="button" className={item.symbol === symbol ? 'active' : ''} onClick={() => { onSelectInstrument(item); setSearchOpen(false); setSearchQuery(''); }}><span>{item.name}</span><small>{item.symbol}</small></button>)}{!filteredInstruments.length && <div className="sire-instrument-empty">No Synthetic Indices found</div>}</div></div>}
        </div>
        <div className="sire-period-control" onPointerDown={handlePointerDown('period')} onPointerMove={handlePointerMove('period')} onPointerUp={handlePointerUp('period')} onPointerCancel={handlePointerCancel('period')} onWheel={handleWheel('period')} onContextMenu={event => event.preventDefault()} role="button" tabIndex={0} aria-label={`Change timeframe. Current timeframe ${currentPeriod.label}. Hold for timeframe selection.`}>

          <div className="sire-period-carousel" aria-live="polite"><div className="sire-period-neighbor sire-period-neighbor-top">{previousPeriod.label}</div><div className="sire-period-current">{currentPeriod.label}</div><div className="sire-period-neighbor sire-period-neighbor-bottom">{nextPeriod.label}</div></div>
          {periodOpen && <div className="sire-period-search" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}><div className="sire-period-list">{PERIODS.map(item => <button key={item.label} type="button" className={item.seconds === period ? 'active' : ''} onClick={() => { setPeriod(item.seconds); setPeriodOpen(false); }}>{item.label}</button>)}</div></div>}
        </div>
        <button type="button" className={`sire-drawing-trigger${drawingOpen ? ' active' : ''}`} aria-label="Drawing tools" aria-expanded={drawingOpen} onClick={() => { setDrawingOpen(value => !value); setPeriodOpen(false); setSearchOpen(false); }}>
          <Pencil size={18} strokeWidth={2.2} />
        </button>
        {drawingOpen && (
          <div className="sire-drawing-rack" role="dialog" aria-label="Drawing tools">
            <div className="sire-drawing-category-strip" role="tablist" aria-label="Drawing categories">
              {DRAWING_GROUPS.map(group => (
                <button key={group.id} type="button" role="tab" aria-selected={drawingGroup === group.id} className={`sire-drawing-category${drawingGroup === group.id ? ' active' : ''}`} aria-label={group.label} title={group.label} onClick={() => setDrawingGroup(group.id)}>
                  {drawingGlyph(group.id, 19)}
                </button>
              ))}
            </div>
            <div className="sire-drawing-tool-strip" role="toolbar" aria-label={DRAWING_GROUPS.find(group => group.id === drawingGroup)?.label || 'Drawing tools'}>
              {(DRAWING_GROUPS.find(group => group.id === drawingGroup)?.tools || []).filter(hasDrawingTool).map(tool => (
                <button key={tool} type="button" className={`sire-drawing-tool${activeTool === tool ? ' active' : ''}`} aria-label={getDrawingTool(tool).name} title={getDrawingTool(tool).name} onClick={() => handleDrawingTool(tool)}>
                  {drawingGlyph(tool, 18)}
                </button>
              ))}
            </div>
            <div className="sire-drawing-actions">
              <button type="button" aria-label="Magnet" title="Magnet" onClick={() => drawingRef.current?.setOptions({ magnet: 'weak' })}><Magnet size={16}/></button>
              <button type="button" aria-label="Undo" title="Undo" onClick={() => drawingRef.current?.undo()}><Undo2 size={16}/></button>
              <button type="button" aria-label="Redo" title="Redo" onClick={() => drawingRef.current?.redo()}><Redo2 size={16}/></button>
              <button type="button" aria-label="Lock drawings" title="Lock drawings" onClick={() => { for (const id of drawingRef.current?.selection?.() || []) drawingRef.current?.update(id, { locked: true }); }}><Lock size={16}/></button>
              <button type="button" aria-label="Hide drawings" title="Hide drawings" onClick={() => { for (const id of drawingRef.current?.selection?.() || []) drawingRef.current?.update(id, { visible: false }); }}><EyeOff size={16}/></button>
              <button type="button" aria-label="Remove drawings" title="Remove drawings" onClick={() => { for (const id of drawingRef.current?.selection?.() || []) drawingRef.current?.remove(id); }}><Trash2 size={16}/></button>
              <button type="button" aria-label="Close drawing tools" title="Close" onClick={() => setDrawingOpen(false)}><X size={16}/></button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
