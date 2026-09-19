import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, History, Lock, Minus, MoreHorizontal, Pause, Play, RotateCcw, Settings2, SkipBack, SkipForward, Trash2, Wrench, X } from 'lucide-react';
import { registerInterval, ReplayController } from 'openalgo-charts';
import 'openalgo-charts/indicators';
import 'openalgo-charts/draw';
import 'openalgo-charts/trade';
import 'openalgo-charts/transform';
import 'openalgo-charts/webgl';
import { createWidget, type Widget } from 'openalgo-charts/widget';
import './financialChart.css';

type Instrument = { symbol: string; name: string; pipSize?: number };
type Props = {
  symbol: string;
  isActive?: boolean;
  instruments: Instrument[];
  onSelectInstrument: (instrument: Instrument) => void;
  onWidgetReady?: (widget: Widget) => void;
  onWidgetDestroyed?: (widget: Widget) => void;
  onInstrumentTap?: () => void;
};

const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60, '2m': 120, '3m': 180, '5m': 300, '10m': 600, '15m': 900, '20m': 1200,
  '30m': 1800, '45m': 2700, '1h': 3600, '2h': 7200, '3h': 10800, '4h': 14400,
  '6h': 21600, '8h': 28800, '12h': 43200, '1d': 86400, '1w': 604800,
};
const CHART_INTERVALS = Object.keys(INTERVAL_SECONDS);
for (const [code, seconds] of Object.entries(INTERVAL_SECONDS)) {
  if (!['1m', '5m', '15m', '1h', '1d', '1w'].includes(code)) registerInterval({ code, bucketing: { mode: 'interval', seconds } });
}
const CHART_TYPES = [
  { id: 'candlestick', label: 'Candles' }, { id: 'hollow-candle', label: 'Hollow Candles' },
  { id: 'volume-candle', label: 'Volume Candles' }, { id: 'bar', label: 'Bars (OHLC)' },
  { id: 'high-low', label: 'High-Low' }, { id: 'line', label: 'Line' },
  { id: 'line-markers', label: 'Line + Markers' }, { id: 'step', label: 'Step Line' },
  { id: 'area', label: 'Area' }, { id: 'hlc-area', label: 'HLC Area' },
  { id: 'baseline', label: 'Baseline' }, { id: 'columns', label: 'Columns' }, { id: 'histogram', label: 'Histogram' },
] as const;
const REPLAY_SPEEDS = [0.5, 1, 2, 5, 10] as const;
const replaySpeedLabel = (speed: number) => `${speed}×`;

type ChartDiagnostic = DerivFeedDiagnostic & { id: number; timestamp: number };

function analyzeChartHealth(events: ChartDiagnostic[], snapshot: { bars: number; tickAgeMs: number | null; width: number; height: number; hasCanvas: boolean; hasPrimarySeries: boolean }) {
  const latest = [...events].reverse();
  const find = (code: string) => latest.find(event => event.code === code);
  const runtime = find('CHART_FRONTEND_ERROR') || find('CHART_UNHANDLED_REJECTION');
  if (runtime) return { state: 'ISSUE', subsystem: 'Browser/runtime', cause: runtime.message, evidence: 'SIRE captured the browser exception directly.', next: 'Use the copied error/stack entry to locate the exact failing component or source line.' };
  if (find('CHART_ZERO_SIZE')) return { state: 'ISSUE', subsystem: 'Layout/DOM', cause: 'The chart container has no usable dimensions.', evidence: snapshot.width + '×' + snapshot.height + 'px was measured.', next: 'Fix the parent layout or visibility before debugging market data.' };
  if (!snapshot.hasCanvas) return { state: 'ISSUE', subsystem: 'Chart renderer', cause: 'No chart canvas is mounted.', evidence: 'The chart host contains no canvas element.', next: 'Inspect widget creation, renderer initialization and teardown.' };
  if (!snapshot.hasPrimarySeries) return { state: 'ISSUE', subsystem: 'OpenAlgo chart API', cause: 'The primary price series is unavailable through widget.chart.', evidence: 'SIRE could not obtain widget.chart.primarySeries().', next: 'Inspect the installed OpenAlgo Charts API/version and object shape.' };
  if (snapshot.bars === 0 || find('HISTORY_EMPTY') || find('HISTORY_LOAD_FAILED')) { const event = find('HISTORY_LOAD_FAILED') || find('HISTORY_EMPTY'); return { state: 'ISSUE', subsystem: 'Deriv history', cause: event?.message || 'No historical candles are available.', evidence: event?.detail || 'The primary series contains zero usable OHLC bars.', next: 'Check the SIRE history endpoint, Deriv response and symbol/granularity validation.' }; }
  if (find('LIVE_TICK_SUBSCRIPTION_FAILED')) { const event = find('LIVE_TICK_SUBSCRIPTION_FAILED')!; return { state: 'ISSUE', subsystem: 'Deriv live transport', cause: event.message, evidence: event.detail || 'The live subscription did not complete.', next: 'Check the /deriv/ws proxy, Deriv public WebSocket and subscription response.' }; }
  if (find('LIVE_TICK_STALE') || (snapshot.tickAgeMs !== null && snapshot.tickAgeMs > 10000)) return { state: 'ISSUE', subsystem: 'Deriv live transport', cause: 'The live tick stream is stale.', evidence: snapshot.tickAgeMs === null ? 'No live tick timestamp exists.' : Math.round(snapshot.tickAgeMs / 1000) + 's since the last tick.', next: 'Check the browser→SIRE WebSocket→Deriv path and reconnect state.' };
  if (find('LIVE_RENDER_LAG')) { const event = find('LIVE_RENDER_LAG')!; return { state: 'ISSUE', subsystem: 'Live chart update', cause: 'Fresh Deriv ticks are arriving but the primary series is not reflecting the latest price.', evidence: event.detail || 'The fresh quote and chart close differ.', next: 'Inspect tick-to-bar conversion and the series.update path.' }; }
  if (snapshot.bars > 0 && snapshot.hasPrimarySeries && snapshot.hasCanvas && (snapshot.tickAgeMs === null || snapshot.tickAgeMs < 10000)) return { state: 'HEALTHY', subsystem: 'End-to-end chart', cause: 'No active chart fault is detected.', evidence: snapshot.bars + ' candles loaded; series and canvas are present; live data is not stale.', next: 'Continue monitoring. New faults will be appended to the persistent log.' };
  return { state: 'CHECKING', subsystem: 'Chart health monitor', cause: 'SIRE is still checking the chart.', evidence: 'Layout, renderer, history, live transport and price updates are being checked.', next: 'Keep diagnostics open while the checks run.' };
}

function diagnosticLabel(level: ChartDiagnostic['level']) { return level === 'error' ? 'ERROR' : level === 'warning' ? 'WARNING' : 'OK'; }

function diagnosticText(event: ChartDiagnostic) {
  const when = new Date(event.timestamp).toISOString();
  return `[${when}] ${diagnosticLabel(event.level)} · ${event.code}\n${event.message}${event.detail ? `\nDetail: ${event.detail}` : ''}`;
}

async function copyDiagnosticText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

function ChartDiagnosticsPanel({ open, events, symbol, interval, quoteAgeMs, bars, renderer, width, height, hasCanvas, hasPrimarySeries, onClose, onRetry }: { open: boolean; events: ChartDiagnostic[]; symbol: string; interval: string; quoteAgeMs: number | null; bars: number; renderer: string; width: number; height: number; hasCanvas: boolean; hasPrimarySeries: boolean; onClose: () => void; onRetry: () => void }) {
  const [copiedId, setCopiedId] = useState<number | 'all' | null>(null);
  if (!open) return null;
  const activeError = [...events].reverse().find(event => event.level === 'error');
  const liveText = quoteAgeMs === null ? 'No live tick received yet' : Math.round(quoteAgeMs / 1000) + 's since last live tick';
  const diagnosis = analyzeChartHealth(events, { bars, tickAgeMs: quoteAgeMs, width, height, hasCanvas, hasPrimarySeries });
  const allText = events.map(diagnosticText).join('\n\n');
  const copy = async (id: number | 'all', value: string) => { if (await copyDiagnosticText(value)) { setCopiedId(id); window.setTimeout(() => setCopiedId(current => current === id ? null : current), 1400); } };
  return <div className="sire-chart-diagnostics" role="dialog" aria-label="Chart diagnostics">
    <div className="sire-chart-diagnostics__head"><div><strong>Chart diagnostics</strong><small>{symbol} · {interval} · {events.length} log entries · continuous monitoring</small></div><div className="sire-chart-diagnostics__head-actions"><button type="button" className="sire-chart-diagnostics__copy-all" onClick={() => void copy('all', allText)} disabled={!events.length}>{copiedId === 'all' ? 'Copied' : 'Copy all'}</button><button type="button" onClick={onClose} aria-label="Close chart diagnostics">×</button></div></div>
    <div className={'sire-chart-diagnostics__diagnosis is-' + diagnosis.state.toLowerCase()}><div><b>{diagnosis.state === 'HEALTHY' ? 'Chart is healthy' : diagnosis.state === 'ISSUE' ? 'Issue identified' : 'Checking chart'}</b><span>{diagnosis.subsystem}</span></div><strong>What is happening: </strong>{diagnosis.cause}<small><b>Evidence:</b> {diagnosis.evidence}</small><small><b>Next check:</b> {diagnosis.next}</small></div>
    <div className="sire-chart-diagnostics__metrics"><span>History <b>{bars}</b></span><span>Live <b>{liveText}</b></span><span>Renderer <b>{renderer}</b></span><span>Canvas <b>{width}×{height}</b></span><span>Series <b>{hasPrimarySeries ? 'OK' : 'Missing'}</b></span></div>
    {activeError && <div className="sire-chart-diagnostics__active"><b>{diagnosticLabel(activeError.level)} · {activeError.code}</b><span>{activeError.message}</span>{activeError.detail && <small>Why: {activeError.detail}</small>}<button type="button" onClick={onRetry}>Retry chart data</button></div>}
    <div className="sire-chart-diagnostics__list">{events.length ? events.map(event => <div key={event.id} className={'sire-chart-diagnostics__event is-' + event.level}><div><b>{diagnosticLabel(event.level)} · {event.code}</b><time>{new Date(event.timestamp).toLocaleTimeString()}</time><button type="button" className="sire-chart-diagnostics__copy" onClick={() => void copy(event.id, diagnosticText(event))}>{copiedId === event.id ? 'Copied' : 'Copy'}</button></div><span>{event.message}</span>{event.detail && <small>{event.detail}</small>}</div>) : <div className="sire-chart-diagnostics__empty">No chart faults detected. Monitoring all chart layers continuously.</div>}</div>
  </div>;
}
import { createDerivDataFeed, DERIV_INTERVAL_SECONDS, DERIV_PAGE_SIZE, fetchAllDerivHistory, fetchOlderDerivHistory, tickToBar, type DerivBar, type DerivInstrument, type DerivFeedDiagnostic } from './derivMarketData';

export { type DerivInstrument, type DerivBar } from './derivMarketData';

export default function FinancialChart({ symbol, isActive = false, instruments, onSelectInstrument, onWidgetReady, onWidgetDestroyed, onInstrumentTap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawRackOpen, setDrawRackOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [compareQuery, setCompareQuery] = useState('');
  const [comparisons, setComparisons] = useState<string[]>([]);
  const [replayActive, setReplayActive] = useState(false);
  const [replayState, setReplayState] = useState<any>(null);
  const [replaySetupOpen, setReplaySetupOpen] = useState(false);
  const [replayStartInput, setReplayStartInput] = useState('');
  const [replayEndInput, setReplayEndInput] = useState('');
  const [replayRangeError, setReplayRangeError] = useState<string | null>(null);
  const [replayDraftSpeed, setReplayDraftSpeed] = useState(1);
  const [replayStartMin, setReplayStartMin] = useState('');
  const [replayNow, setReplayNow] = useState('');
  const replaySpeedRef = useRef(1);
  const [rendererKind, setRendererKind] = useState<'canvas2d' | 'webgl2'>('canvas2d');
  const [tpoEnabled, setTpoEnabled] = useState(false);
  const [marketQuote, setMarketQuote] = useState<{ price: number; percent: number } | null>(null);
  const lastLiveQuoteRef = useRef<{ symbol: string; price: number; epoch: number } | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ChartDiagnostic[]>([]);
  const diagnosticIdRef = useRef(0);
  const lastTickAtRef = useRef<number | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [selectedDrawing, setSelectedDrawing] = useState<{ id: string; sourceId: string; name: string; visible: boolean; locked: boolean } | null>(null);
  const [selectedDrawingPosition, setSelectedDrawingPosition] = useState<{ left: number; top: number } | null>(null);
  const [selectedIndicator, setSelectedIndicator] = useState<{ id: string; name: string; paneIndex: number } | null>(null);
  const [selectedIndicatorPosition, setSelectedIndicatorPosition] = useState<{ left: number; top: number } | null>(null);
  const selectedIndicatorRef = useRef<{ id: string; name: string; paneIndex: number } | null>(null);
  const [swipeInstrumentIndex, setSwipeInstrumentIndex] = useState(() => Math.max(0, instruments.findIndex(item => item.symbol === symbol)));
  const swipeStartYRef = useRef<number | null>(null);
  const swipeAccumulatedRef = useRef(0);
  const swipeAnimatingRef = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const timeframeHoldTimerRef = useRef<number | null>(null);
  const timeframeHoldTriggeredRef = useRef(false);
  const timeframeSwipeStartYRef = useRef(0);
  const timeframeSwipeAccumulatedRef = useRef(0);
  const timeframeSwipeAnimatingRef = useRef(false);
  const [timeframeOpen, setTimeframeOpen] = useState(false);
  const [activeTimeframe, setActiveTimeframe] = useState('1m');
  const [swipeAnimation, setSwipeAnimation] = useState<'up' | 'down' | null>(null);
  const widgetRef = useRef<Widget | null>(null);
  const replayRef = useRef<ReplayController | null>(null);
  const dataFeedRef = useRef<ReturnType<typeof createDerivDataFeed> | null>(null);
  const instrumentsRef = useRef(instruments);
  const onSelectInstrumentRef = useRef(onSelectInstrument);
  const symbolRef = useRef(symbol);
  const timeframeRef = useRef(activeTimeframe);
  const historyLoadingRef = useRef(false);
  const historyExhaustedRef = useRef(false);
  const oldestLoadedTimeRef = useRef<number | null>(null);
  instrumentsRef.current = instruments;
  onSelectInstrumentRef.current = onSelectInstrument;
  symbolRef.current = symbol;
  timeframeRef.current = activeTimeframe;
  const marketInstrument = instruments.find(item => item.symbol === symbol);
  const marketInstrumentName = marketInstrument?.name || symbol;
  const reportDiagnostic = (event: DerivFeedDiagnostic) => { const now = Date.now(); const item: ChartDiagnostic = { ...event, id: ++diagnosticIdRef.current, timestamp: now }; setDiagnostics(current => { const last = current[current.length - 1]; if (last && last.code === item.code && last.message === item.message && now - last.timestamp < 5000) return current; return [...current, item]; }); if (event.level === 'error') setDiagnosticsOpen(true); };

  const formatMarketPrice = (price: number) => {
    if (!Number.isFinite(price)) return '—';
    const pipSize = Number(marketInstrument?.pipSize);
    const decimals = Number.isFinite(pipSize) && pipSize > 0 ? Math.max(0, Math.min(8, Math.ceil(-Math.log10(pipSize)))) : 2;
    return price.toFixed(decimals);
  };

  useEffect(() => {
    const nextIndex = instruments.findIndex(item => item.symbol === symbol);
    if (nextIndex >= 0) setSwipeInstrumentIndex(nextIndex);
  }, [instruments, symbol]);

  const compactInstrumentName = (name: string) => {
    const first = name.trim().split(/\s+/)[0] || symbol;
    return `${first.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 5)}_`;
  };
  const swipeInstrument = (direction: 1 | -1) => {
    if (!instruments.length) return;
    const currentIndex = Math.max(0, instruments.findIndex(item => item.symbol === symbol));
    const nextIndex = Math.max(0, Math.min(instruments.length - 1, currentIndex + direction));
    const next = instruments[nextIndex];
    if (next && next.symbol !== symbol) onSelectInstrument(next);
  };
  const triggerSwipeStep = (direction: 1 | -1) => {
    if (!instruments.length) return;
    const currentIndex = Math.max(0, instruments.findIndex(item => item.symbol === symbol));
    const nextIndex = Math.max(0, Math.min(instruments.length - 1, currentIndex + direction));
    if (nextIndex === currentIndex) return;
    setSwipeAnimation(direction > 0 ? 'up' : 'down');
    swipeInstrument(direction);
    window.setTimeout(() => setSwipeAnimation(null), 320);
  };
  const clearTimeframeHold = () => { if (timeframeHoldTimerRef.current !== null) { window.clearTimeout(timeframeHoldTimerRef.current); timeframeHoldTimerRef.current = null; } };
  const selectTimeframe = (interval: string) => {
    const widget = widgetRef.current;
    if (!widget) return;
    setActiveTimeframe(interval);
    setTimeframeOpen(false);
    widget.setInterval(interval);
  };
  const handleTimeframePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    timeframeSwipeStartYRef.current = event.clientY;
    timeframeSwipeAccumulatedRef.current = 0;
    timeframeHoldTriggeredRef.current = false;
    clearTimeframeHold();
    timeframeHoldTimerRef.current = window.setTimeout(() => { timeframeHoldTriggeredRef.current = true; setTimeframeOpen(true); }, 600);
  };
  const handleTimeframePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (timeframeHoldTriggeredRef.current) return;
    const delta = event.clientY - timeframeSwipeStartYRef.current;
    if (Math.abs(delta) >= 8) clearTimeframeHold();
    if (Math.abs(delta) < 45 || timeframeSwipeAnimatingRef.current) return;
    const direction: 1 | -1 = delta < 0 ? 1 : -1;
    const currentIndex = CHART_INTERVALS.indexOf(activeTimeframe);
    const nextIndex = Math.max(0, Math.min(CHART_INTERVALS.length - 1, currentIndex + direction));
    if (nextIndex !== currentIndex) {
      timeframeSwipeAnimatingRef.current = true;
      selectTimeframe(CHART_INTERVALS[nextIndex]);
      window.setTimeout(() => { timeframeSwipeAnimatingRef.current = false; }, 280);
    }
    timeframeSwipeStartYRef.current = event.clientY;
    timeframeSwipeAccumulatedRef.current = 0;
  };
  const handleTimeframePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    clearTimeframeHold(); timeframeHoldTriggeredRef.current = false; timeframeSwipeStartYRef.current = 0; timeframeSwipeAccumulatedRef.current = 0;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const clearInstrumentHold = () => { if (holdTimerRef.current !== null) { window.clearTimeout(holdTimerRef.current); holdTimerRef.current = null; } };
  const handleInstrumentPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId);
    swipeStartYRef.current = event.clientY; swipeAccumulatedRef.current = 0; holdTriggeredRef.current = false; clearInstrumentHold();
    holdTimerRef.current = window.setTimeout(() => { if (swipeStartYRef.current !== null) { holdTriggeredRef.current = true; onInstrumentTap?.(); } }, 600);
  };
  const handleInstrumentPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStartYRef.current; if (start === null) return;
    const delta = event.clientY - start;
    if (Math.abs(delta) >= 18 && !holdTriggeredRef.current) clearInstrumentHold();
    if (Math.abs(delta) < 55 || swipeAnimatingRef.current || holdTriggeredRef.current) return;
    triggerSwipeStep(delta < 0 ? 1 : -1); swipeAnimatingRef.current = true; swipeStartYRef.current = event.clientY; swipeAccumulatedRef.current = 0;
    window.setTimeout(() => { swipeAnimatingRef.current = false; }, 320);
  };
  const handleInstrumentPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    clearInstrumentHold(); swipeStartYRef.current = null; swipeAccumulatedRef.current = 0; holdTriggeredRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const stopReplay = () => {
    replayRef.current?.stop();
    replayRef.current = null;
    widgetRef.current?.dataController?.setPaused(false);
    setReplayActive(false);
    setReplayState(null);
    setReplaySetupOpen(false);
  };
  const toggleReplay = () => {
    const replay = replayRef.current;
    if (replay) {
      const state = replay.state();
      if (state.playing) replay.pause();
      else replay.play({ speed: replaySpeedRef.current });
      setReplayState(replay.state());
      return;
    }
    setReplaySetupOpen(open => !open);
  };
  const replayStep = () => replayRef.current?.step();
  const replayStepBack = () => replayRef.current?.stepBack();
  const replayJumpStart = () => replayRef.current?.seek(0);
  const replayJumpEnd = () => {
    const replay = replayRef.current;
    if (replay) replay.seek(Math.max(0, replay.state().total - 1));
  };
  const replaySeek = (index: number) => replayRef.current?.seek(index);
  const setReplaySpeed = (speed: number) => { replaySpeedRef.current = speed; setReplayDraftSpeed(speed); if (replayRef.current?.state().playing) replayRef.current.play({ speed }); };
  const formatReplayInputTime = (epoch: number) => {
    const date = new Date(epoch * 1000);
    const pad = (value: number) => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  };
  const refreshReplayBounds = () => {
    const oldest = oldestLoadedTimeRef.current;
    const now = Math.floor(Date.now() / 1000);
    if (oldest && Number.isFinite(oldest)) setReplayStartMin(formatReplayInputTime(oldest));
    setReplayNow(formatReplayInputTime(now));
    const currentStart = replayStartInput ? new Date(replayStartInput).getTime() / 1000 : oldest ?? now;
    const cappedStart = Math.max(oldest ?? 0, Math.min(now, currentStart));
    setReplayStartInput(formatReplayInputTime(cappedStart));
  };
  const startReplayFromInputs = async (fromBeginning: boolean, toLatest: boolean) => {
    setReplayRangeError(null);
    refreshReplayBounds();
    const widget = widgetRef.current;
    if (!widget) { setReplayRangeError('Chart is still loading.'); return; }
    replayRef.current?.stop();
    replayRef.current = null;

    const series = widget.chart.primarySeries();
    if (!series) { setReplayRangeError('No chart data is loaded yet.'); return; }

    let allBars = (series.getData?.() || []) as DerivBar[];
    if (!allBars.length) {
      try {
        allBars = await fetchChartHistory(symbol, activeTimeframe);
        if (allBars.length) series.setData(allBars);
      } catch (error) {
        setReplayRangeError(error instanceof Error ? error.message : 'Unable to load chart history for replay.');
        return;
      }
    }
    allBars = [...allBars].sort((a, b) => a.time - b.time);

    const parseReplayTime = (value: string) => {
      if (!value) return null;
      const ms = new Date(value).getTime();
      return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    };
    const leftEdge = oldestLoadedTimeRef.current ?? allBars[0]?.time ?? Math.floor(Date.now() / 1000);
    const now = Math.floor(Date.now() / 1000);
    const requestedStart = fromBeginning ? leftEdge : parseReplayTime(replayStartInput);
    if (!fromBeginning && replayStartInput && requestedStart === null) { setReplayRangeError('Invalid replay start date/time.'); return; }
    const startTime = Math.max(leftEdge, Math.min(now, requestedStart ?? leftEdge));
    const endTime = now;
    if (startTime >= endTime) { setReplayRangeError('Replay start must be before the current time.'); return; }

    const bars = allBars.filter(bar => bar.time >= startTime && bar.time <= endTime);
    if (bars.length < 2) { setReplayRangeError('Not enough chart history in the selected replay range.'); return; }

    widget.dataController?.setPaused(true);
    const replay = new ReplayController(widget.chart, {
      series,
      bars,
      startIndex: 0,
      barMs: 1000,
      speed: replaySpeedRef.current,
      onFrame: state => setReplayState(state),
    });
    replayRef.current = replay;
    setReplayActive(true);
    setReplaySetupOpen(false);
    setReplayState(replay.state());
  };
  const toggleTpo = () => setTpoEnabled(value => !value);

  useEffect(() => {
    if (!drawRackOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawRackOpen(false); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [drawRackOpen]);

  useEffect(() => {
    if (!containerRef.current) return;
    const host = containerRef.current;
    let widget: Widget;
    try {
      const feed = dataFeedRef.current || createDerivDataFeed(quote => {
        if (quote.symbol !== symbolRef.current) return;
        lastTickAtRef.current = Date.now();
        lastLiveQuoteRef.current = quote;
        const series = widgetRef.current?.chart.primarySeries();
        const bars = (series?.getData?.() || []) as DerivBar[];
        const previous = bars[bars.length - 1] || null;
        const seconds = DERIV_INTERVAL_SECONDS[timeframeRef.current] || 60;
        const next = tickToBar(previous, quote.epoch, quote.price, seconds);
        if (series?.update) series.update(next);
        // Keep the live bar count/axis chrome on the same hot path as the price.
        // The chart engine coalesces update() calls into the next render frame, so
        // both the forming candle and its price metadata move together.
        const previousClosed = bars.length > 1 ? bars[bars.length - 2] : null;
        const percent = previousClosed?.close ? ((quote.price - previousClosed.close) / previousClosed.close) * 100 : 0;
        setMarketQuote({ price: quote.price, percent });
        // Healthy tick updates are intentionally not logged individually; the monitor checks their effect on the chart.
      }, reportDiagnostic);
      dataFeedRef.current = feed;
      widget = createWidget(host, {
        symbol,
        exchange: 'DERIV',
        feed,
        loading: { retainedBars: 10000 },
        interval: '1m',
        intervals: CHART_INTERVALS,
        chartType: 'candlestick',
        theme: 'dark',
        renderer: 'canvas2d',
        navigation: { mousePan: 'both', defaultVisibleBars: 10 },
        lookbackBars: 5000,
        animZoom: true,
        animAutoscale: true,
        branding: false,
        rail: true,
        topbar: false,
        statusline: true,
        indicators: true,
        mobile: 'never',
        timezone: 'Africa/Lagos',
        axisChrome: { sessionClock: true, barCountdown: true },
        symbolSearch: async (query: string) => instrumentsRef.current
          .filter(item => `${item.name} ${item.symbol}`.toLowerCase().includes(query.trim().toLowerCase()))
          .slice(0, 50)
          .map(item => ({ symbol: item.symbol, name: item.name })),
      });
      const pitchBlackTheme = { ...widget.chart.theme(), background: '#000000' };
      widget.setTheme(pitchBlackTheme);
      widget.chart.applyOptions({ canvas: { background: '#000000' } });
      widget.chart.setAutoScale?.(true);
      widget.chart.resetScale?.();
      widget.chart.applyOptions({ crosshair: { mode: 'normal' } });
      setRendererKind(widget.chart.rendererKind);
      const offRenderer = widget.chart.on('renderer:fallback', () => { setRendererKind('canvas2d'); reportDiagnostic({ level: 'warning', code: 'CHART_RENDERER_FALLBACK', message: 'Chart renderer fell back to Canvas 2D.', detail: 'The requested renderer was unavailable, so the chart switched rendering backends.' }); });
      widgetRef.current = widget;
      setActiveTimeframe(widget.interval());
      const offInterval = widget.on('interval', (event: { interval: string }) => {
        setActiveTimeframe(event.interval);
        historyLoadingRef.current = false;
        historyExhaustedRef.current = false;
        oldestLoadedTimeRef.current = null;
        setMarketQuote(null);
        lastTickAtRef.current = null;
        lastLiveQuoteRef.current = null;
        reportDiagnostic({ level: 'info', code: 'CHART_CONTEXT_CHANGED', message: 'Chart context changed to ' + symbol + '; preserving the existing diagnostic history.', detail: 'The issue log continues across instrument changes and timeframes.' });
      });
      const offSymbol = widget.on('symbol', (event: { symbol: string }) => {
        const instrument = instrumentsRef.current.find(item => item.symbol === event.symbol);
        if (instrument && instrument.symbol !== symbolRef.current) onSelectInstrumentRef.current(instrument);
      });
      const syncQuoteFromSeries = () => {
        const live = lastLiveQuoteRef.current;
        if (live && live.symbol === symbolRef.current && Math.floor(Date.now() / 1000) - live.epoch < 10) return;
        const bars = (widget.chart.primarySeries()?.getData?.() || []) as DerivBar[];
        const last = bars[bars.length - 1];
        if (bars.length && oldestLoadedTimeRef.current === null) oldestLoadedTimeRef.current = bars[0].time;
        if (!last || !Number.isFinite(last.close)) return;
        const previous = bars.length > 1 ? bars[bars.length - 2] : null;
        const percent = previous?.close ? ((last.close - previous.close) / previous.close) * 100 : 0;
        setMarketQuote({ price: last.close, percent });
      };
      const offData = widget.on('data', (event: any) => { if (event?.error) { const message = event.error instanceof Error ? event.error.message : String(event.error); reportDiagnostic({ level: 'error', code: 'CHART_DATA_ERROR', message: 'Chart data load failed: ' + message, detail: 'The chart data controller reported a history/load failure.' }); } syncQuoteFromSeries(); });

      // Load history progressively as the user pans toward the oldest loaded bar.
      // The chart keeps everything already loaded, while older pages are fetched
      // only when they are actually needed.
      widget.chart.setHistoryLoader?.(() => {
        if (historyLoadingRef.current || historyExhaustedRef.current) return;
        const currentSymbol = symbolRef.current;
        const currentInterval = timeframeRef.current;
        const oldest = oldestLoadedTimeRef.current;
        if (!currentSymbol || !oldest) return;

        historyLoadingRef.current = true;
        void (async () => {
          try {
            const older = await fetchOlderDerivHistory(currentSymbol, currentInterval, oldest - 1, DERIV_PAGE_SIZE);
            if (widgetRef.current !== widget || symbolRef.current !== currentSymbol || timeframeRef.current !== currentInterval) return;
            if (!older.length) {
              historyExhaustedRef.current = true;
              return;
            }
            const series = widget.chart.primarySeries();
            if (!series) return;
            // OpenAlgo's prependData merges/deduplicates older bars while
            // preserving the currently loaded history and viewport.
            series.prependData(older);
            oldestLoadedTimeRef.current = older[0].time;
            if (older.length < DERIV_PAGE_SIZE || older[0].time <= 1) historyExhaustedRef.current = true;
          } catch (error) {
            console.error('Failed to load older chart history', error);
          } finally {
            historyLoadingRef.current = false;
            widget.chart.historyLoadComplete?.();
          }
        })();
      });
      const updateDrawingOverlay = (drawing: any) => {
        if (!drawing) { setSelectedDrawingPosition(null); return; }
        const rect = host.getBoundingClientRect();
        setSelectedDrawingPosition({ left: Math.max(90, rect.width / 2), top: Math.max(90, rect.height / 2 - 70) });
      };
      const updateIndicatorOverlay = (indicator: { id: string; name: string; paneIndex: number } | null) => {
        if (!indicator) { setSelectedIndicatorPosition(null); return; }
        const rect = host.getBoundingClientRect();
        setSelectedIndicatorPosition({ left: Math.max(8, Math.min(rect.width - 92, 8 + Math.max(46, indicator.name.length * 6.5 + 8))), top: 14 });
      };
      const offIndicatorObjects = widget.objects.subscribe(objects => {
        const current = selectedIndicatorRef.current;
        if (!current) return;
        const item = objects.find(object => object.kind === 'indicator' && object.id === current.id);
        if (!item) {
          selectedIndicatorRef.current = null;
          setSelectedIndicator(null);
          setSelectedIndicatorPosition(null);
          return;
        }
        const next = { id: item.id, name: item.name, paneIndex: item.paneIndex };
        selectedIndicatorRef.current = next;
        setSelectedIndicator(next);
        updateIndicatorOverlay(next);
      });
      const offDrawingObjects = widget.objects.subscribe(objects => {
        const drawing = objects.find(object => object.kind === 'drawing' && object.selected);
        setSelectedDrawing(drawing ? {
          id: drawing.id, sourceId: drawing.sourceId, name: drawing.name,
          visible: drawing.visible, locked: drawing.locked === true,
        } : null);
        updateDrawingOverlay(drawing);
      });
      const offDrawingSelect = widget.chart.on('drawing:select', () => {
        const drawing = widget.objects.selection?.().find?.((item: any) => item?.kind === 'drawing');
        if (drawing) updateDrawingOverlay(drawing);
      });
      onWidgetReady?.(widget);
      return () => {
        replayRef.current?.stop(); replayRef.current = null; widget.dataController?.setPaused(false);
        offSymbol?.(); offInterval?.(); offRenderer?.(); offData?.();
        offIndicatorObjects?.(); offDrawingObjects?.(); offDrawingSelect?.();
        dataFeedRef.current?.close?.();
        dataFeedRef.current = null;
        onWidgetDestroyed?.(widget); widget.destroy(); widgetRef.current = null;
      };
    } catch (error) {
      host.textContent = `OpenAlgo widget failed to initialize: ${error instanceof Error ? error.message : String(error)}`;
      host.style.padding = '24px'; host.style.boxSizing = 'border-box'; host.style.color = '#ff8080';
      host.style.background = '#080808'; host.style.fontFamily = 'monospace'; host.style.fontSize = '14px';
      throw error;
    }
  }, []);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const onWindowError = (event: ErrorEvent) => reportDiagnostic({ level: 'error', code: 'CHART_FRONTEND_ERROR', message: event.message || 'A frontend error occurred while the chart was running.' });
    const onUnhandled = (event: PromiseRejectionEvent) => reportDiagnostic({ level: 'error', code: 'CHART_UNHANDLED_REJECTION', message: 'An unhandled chart promise failed: ' + String(event.reason || 'Unknown rejection') });
    window.addEventListener('error', onWindowError); window.addEventListener('unhandledrejection', onUnhandled);
    const timer = window.setInterval(() => {
      const widget = widgetRef.current; const series = widget?.chart?.primarySeries(); const bars = (series?.getData?.() || []) as DerivBar[]; const rect = host.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) { reportDiagnostic({ level: 'error', code: 'CHART_ZERO_SIZE', message: 'The chart container has no usable size.', detail: 'Measured ' + Math.round(rect.width) + '×' + Math.round(rect.height) + 'px.' }); return; }
      if (!bars.length) { reportDiagnostic({ level: 'error', code: 'CHART_NO_CANDLES', message: 'No historical candles are currently loaded.', detail: 'The price pane has no primary OHLC data to render.' }); return; }
      const instrument = instrumentsRef.current.find(item => item.symbol === symbolRef.current); const marketClosed = instrument?.exchangeOpen === 0 || instrument?.tradingSuspended === 1; const tickAge = lastTickAtRef.current === null ? null : Date.now() - lastTickAtRef.current;
      if (!marketClosed && tickAge === null) reportDiagnostic({ level: 'warning', code: 'LIVE_PRICE_NOT_RECEIVED', message: 'No live price has been received yet.', detail: 'History is present, but the Deriv tick stream has not delivered a quote.' });
      if (!marketClosed && tickAge !== null && tickAge > 10000) reportDiagnostic({ level: 'error', code: 'LIVE_TICK_STALE', message: 'Live price updates are stale: ' + Math.round(tickAge / 1000) + 's since the last tick.', detail: 'The live tick stream or the SIRE-to-chart delivery path stopped updating.' });
      const live = lastLiveQuoteRef.current; const last = bars[bars.length - 1];
      if (live && tickAge !== null && tickAge < 5000 && Math.abs(last.close - live.price) > Math.max(Math.abs(live.price) * 1e-8, 1e-10)) reportDiagnostic({ level: 'warning', code: 'LIVE_RENDER_LAG', message: 'A fresh live tick arrived, but the chart candle has not caught up.', detail: 'Live price=' + live.price + '; chart close=' + last.close + '. The chart rendering/data-update path is lagging.' });
      if (!Number.isFinite(last.close)) reportDiagnostic({ level: 'error', code: 'CANDLE_PRICE_INVALID', message: 'The latest candle contains an invalid close price.', detail: 'The price pane cannot safely render this OHLC value.' });
      if (!host.querySelector('canvas')) reportDiagnostic({ level: 'error', code: 'CHART_CANVAS_MISSING', message: 'The chart has data but no canvas renderer is present.', detail: 'The chart surface is missing from the DOM.' });
    }, 2500);
    return () => { window.clearInterval(timer); window.removeEventListener('error', onWindowError); window.removeEventListener('unhandledrejection', onUnhandled); };
  }, [symbol]);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget || !symbol) return;
    setMarketQuote(null);
    lastTickAtRef.current = null;
    lastLiveQuoteRef.current = null;
    setDiagnostics([]);
    historyLoadingRef.current = false;
    historyExhaustedRef.current = false;
    oldestLoadedTimeRef.current = null;
    if (widget.symbol() !== symbol) widget.setSymbol(symbol, 'DERIV');
  }, [symbol]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const positionRail = () => {
      const rail = host.querySelector<HTMLElement>('.oac-rail');
      if (!rail) return;
      rail.classList.toggle('sire-oac-rail--closed', !drawRackOpen);
      rail.setAttribute('aria-hidden', String(!drawRackOpen));
      if (!drawRackOpen) { rail.style.removeProperty('--sire-rail-top'); return; }
      const quote = host.querySelector<HTMLElement>('.sire-market-quote');
      const hostRect = host.getBoundingClientRect();
      const quoteRect = quote?.getBoundingClientRect();
      const quoteBottom = quoteRect ? quoteRect.bottom - hostRect.top : 0;
      const widget = widgetRef.current;
      const mainPaneIndicators = widget?.objects.list?.().filter((item: any) => item?.kind === 'indicator' && Number(item?.paneIndex) === 0 && item?.visible !== false) ?? [];
      const indicatorLegendBottom = mainPaneIndicators.length ? 6 + mainPaneIndicators.length * 24 + 4 : 0;
      rail.style.setProperty('--sire-rail-top', `${Math.max(0, Math.ceil(Math.max(quoteBottom + 8, indicatorLegendBottom)))}px`);
    };
    positionRail();
    const observer = new MutationObserver(() => window.requestAnimationFrame(positionRail));
    observer.observe(host, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(positionRail);
    resizeObserver.observe(host);
    const onResize = () => positionRail();
    window.addEventListener('resize', onResize);
    return () => { observer.disconnect(); resizeObserver.disconnect(); window.removeEventListener('resize', onResize); host.querySelector<HTMLElement>('.oac-rail')?.style.removeProperty('--sire-rail-top'); };
  }, [drawRackOpen, symbol, instruments]);

  return (
    <div ref={containerRef} className={`sire-financial-chart${drawRackOpen ? ' sire-draw-rack-open' : ''}${isActive ? ' sire-toolbar-owner' : ''}`}>
      <button type="button" className={'sire-chart-diagnostics-button' + (diagnostics.some(event => event.level === 'error') ? ' has-error' : '')} onClick={() => setDiagnosticsOpen(open => !open)} aria-label="Open chart diagnostics" title="Chart diagnostics"><Wrench size={14} />{diagnostics.some(event => event.level === 'error') ? 'ISSUE' : 'OK'}</button>
      <ChartDiagnosticsPanel open={diagnosticsOpen} events={diagnostics} symbol={symbol} interval={activeTimeframe} quoteAgeMs={lastTickAtRef.current === null ? null : Date.now() - lastTickAtRef.current} bars={((widgetRef.current?.chart?.primarySeries()?.getData?.() || []) as DerivBar[]).length} renderer={rendererKind} width={Math.round(containerRef.current?.getBoundingClientRect().width || 0)} height={Math.round(containerRef.current?.getBoundingClientRect().height || 0)} hasCanvas={!!containerRef.current?.querySelector('canvas')} hasPrimarySeries={!!widgetRef.current?.chart?.primarySeries?.()} onClose={() => setDiagnosticsOpen(false)} onRetry={() => { setDiagnostics([]); lastTickAtRef.current = null; lastLiveQuoteRef.current = null; setMarketQuote(null); void widgetRef.current?.reload?.(); }} />
      <div className="sire-market-quote" aria-label={`Selected ${marketInstrumentName}`}>
        <strong className="sire-market-quote__name">{marketInstrumentName}</strong>
        <div className="sire-market-quote__value-row">
          <span className="sire-market-quote__price">{marketQuote ? formatMarketPrice(marketQuote.price) : '—'}</span>
          <span className={`sire-market-quote__change ${marketQuote && marketQuote.percent > 0 ? 'is-positive' : marketQuote && marketQuote.percent < 0 ? 'is-negative' : 'is-neutral'}`}>
            {marketQuote ? `${marketQuote.percent >= 0 ? '+' : ''}${marketQuote.percent.toFixed(2)}%` : '—'}
          </span>
        </div>
      </div>
      <button type="button" className="sire-chart-settings-button" aria-label="Chart settings" title="Chart settings" onClick={() => widgetRef.current?.openSettings()}><MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" /></button>
      {replayActive && replayState && (
        <div className="sire-replay-transport" role="dialog" aria-label="Chart replay controls">
          <div className="sire-replay-head">
            <span className="sire-replay-badge"><History size={13} strokeWidth={2.1} aria-hidden="true" /> REPLAY</span>
            <span className="sire-replay-clock">{replayState.bar ? new Date(replayState.bar.time * 1000 + 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ') : ''}</span>
            <span className="sire-replay-count">{replayState.index + 1}/{replayState.total}{replayState.subSteps > 1 ? ` · ${replayState.subIndex + 1}/${replayState.subSteps}` : ''}</span>
          </div>
          <div className="sire-replay-progress-row">
            <button type="button" onClick={replayJumpStart} aria-label="Jump to replay start" title="Start"><SkipBack size={15} /></button>
            <input type="range" min="0" max={Math.max(0, replayState.total - 1)} step="1" value={Math.min(replayState.index, Math.max(0, replayState.total - 1))} onChange={event => replaySeek(Number(event.target.value))} aria-label="Replay position" title="Scrub replay" />
            <button type="button" onClick={replayJumpEnd} aria-label="Jump to replay end" title="End"><SkipForward size={15} /></button>
          </div>
          <div className="sire-replay-transport-row">
            <button type="button" onClick={replayStepBack} aria-label="Previous replay bar" title="Previous"><ChevronLeft size={17} /></button>
            <button type="button" className="sire-replay-play" onClick={toggleReplay} aria-label={replayState.playing ? 'Pause replay' : 'Play replay'} title={replayState.playing ? 'Pause' : 'Play'}>{replayState.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
            <button type="button" onClick={replayStep} aria-label="Next replay bar" title="Next"><ChevronRight size={17} /></button>
            <button type="button" onClick={stopReplay} aria-label="Exit replay" title="Exit replay"><X size={17} /></button>
            <button type="button" onClick={() => replaySeek(Math.max(0, replayState.index - 10))} aria-label="Back ten bars" title="Back 10 bars"><RotateCcw size={15} /></button>
          </div>
          <div className="sire-replay-speed-row">
            {REPLAY_SPEEDS.map(speed => (
              <button key={speed} type="button" className={replaySpeedRef.current === speed ? 'active' : ''} onClick={() => setReplaySpeed(speed)} title={`Speed ${replaySpeedLabel(speed)}`}>{replaySpeedLabel(speed)}</button>
            ))}
          </div>
        </div>
      )}
      {replaySetupOpen && !replayActive && (
        <div className="sire-replay-setup" role="dialog" aria-label="Set replay range">
          <div className="sire-replay-setup-row">
            <input aria-label="Replay start date and time" type="datetime-local" min={replayStartMin || undefined} max={replayNow || undefined} value={replayStartInput} onChange={event => { const value = event.target.value; setReplayStartInput(replayStartMin && value < replayStartMin ? replayStartMin : replayNow && value > replayNow ? replayNow : value); }} title="Start (capped at the left edge)" />
            <span aria-hidden="true">→</span>
            <input aria-label="Replay finish time (current time)" type="datetime-local" value={replayNow} readOnly disabled title="Finish is always the current time" />
          </div>
          <div className="sire-replay-quick-row">
            <button type="button" onClick={() => startReplayFromInputs(true, true)} aria-label="Replay from beginning to latest" title="Beginning to latest">⏮▶</button>
            <button type="button" onClick={() => startReplayFromInputs(false, true)} aria-label="Replay selected start to latest" title="Start to latest">▶⏭</button>
            <button type="button" onClick={() => startReplayFromInputs(false, true)} aria-label="Replay from selected start to current time" title="Start to current time">▶⏱</button>
            <button type="button" onClick={() => setReplaySetupOpen(false)} aria-label="Close replay setup" title="Close">×</button>
          </div>
          {replayRangeError && <div className="sire-replay-error">{replayRangeError}</div>}
          <div className="sire-replay-speed-row">
            {REPLAY_SPEEDS.map(speed => (
              <button key={speed} type="button" className={replayDraftSpeed === speed ? 'active' : ''} onClick={() => { setReplayDraftSpeed(speed); setReplaySpeed(speed); }} title={`Speed ${replaySpeedLabel(speed)}`}>{replaySpeedLabel(speed)}</button>
            ))}
          </div>
        </div>
      )}
      {selectedIndicator && (
        <div
          className="sire-indicator-selection-bar"
          role="toolbar"
          aria-label={`Selected indicator: ${selectedIndicator.name}`}
          style={selectedIndicatorPosition ? { left: selectedIndicatorPosition.left, top: selectedIndicatorPosition.top } : undefined}
          onPointerDown={event => event.stopPropagation()}
        >
          <button
            type="button"
            className="sire-indicator-selection-button"
            aria-label="Indicator settings"
            title="Indicator settings"
            onClick={() => widgetRef.current?.objects.openSettings(selectedIndicator.id)}
          >
            <Settings2 size={15} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sire-indicator-selection-button sire-indicator-selection-obj"
            aria-label="Open objects"
            title="Objects"
            onClick={() => widgetRef.current?.openObjects()}
          >
            <span aria-hidden="true">OBJ</span>
          </button>
          <button
            type="button"
            className="sire-indicator-selection-button sire-indicator-selection-delete"
            aria-label="Delete indicator"
            title="Delete indicator"
            onClick={() => {
              const widget = widgetRef.current;
              if (!widget) return;
              widget.objects.remove(selectedIndicator.id);
              selectedIndicatorRef.current = null;
              setSelectedIndicator(null);
              setSelectedIndicatorPosition(null);
            }}
          >
            <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
      {selectedDrawing && (
        <div
          className="sire-drawing-selection-bar"
          role="toolbar"
          aria-label={`Selected drawing: ${selectedDrawing.name}`}
          style={selectedDrawingPosition ? { left: selectedDrawingPosition.left, top: selectedDrawingPosition.top } : undefined}
        >
          <button
            type="button"
            className="sire-drawing-selection-button"
            aria-label={selectedDrawing.visible ? 'Hide drawing' : 'Show drawing'}
            title={selectedDrawing.visible ? 'Hide drawing' : 'Show drawing'}
            onClick={() => {
              const widget = widgetRef.current;
              if (!widget) return;
              widget.objects.setVisible(selectedDrawing.id, !selectedDrawing.visible);
            }}
          >
            <Eye size={16} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`sire-drawing-selection-button sire-drawing-selection-lock${selectedDrawing.locked ? ' is-locked' : ''}`}
            aria-label={selectedDrawing.locked ? 'Unlock drawing' : 'Lock drawing'}
            title={selectedDrawing.locked ? 'Unlock drawing' : 'Lock drawing'}
            onClick={() => {
              const widget = widgetRef.current;
              if (!widget) return;
              widget.objects.setLocked(selectedDrawing.id, !selectedDrawing.locked);
            }}
          >
            <Lock size={16} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sire-drawing-selection-button"
            aria-label="Drawing settings"
            title="Drawing settings"
            onClick={() => widgetRef.current?.objects.openSettings(selectedDrawing.id)}
          >
            <MoreHorizontal size={19} strokeWidth={2.1} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sire-drawing-selection-button"
            aria-label="Focus drawing"
            title="Focus drawing"
            onClick={() => widgetRef.current?.objects.focus(selectedDrawing.id)}
          >
            <span className="sire-drawing-focus-glyph" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sire-drawing-selection-button sire-drawing-selection-delete"
            aria-label="Delete drawing"
            title="Delete drawing"
            onClick={() => {
              const widget = widgetRef.current;
              if (!widget) return;
              widget.objects.remove(selectedDrawing.id);
            }}
          >
            <Minus size={17} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="sire-bottom-glass-bar">
        <div className="sire-bottom-scroll-track">
        <div
          onPointerDown={handleInstrumentPointerDown}
          onPointerMove={handleInstrumentPointerMove}
          onPointerUp={handleInstrumentPointerEnd}
          onPointerCancel={handleInstrumentPointerEnd}
          onContextMenu={event => event.preventDefault()}
          className={`sire-bottom-instrument-swipe${swipeAnimation ? ` is-swiping-${swipeAnimation}` : ''}`}
          title="Swipe up or down to change instrument"
        >
          <span className="sire-bottom-instrument-prev">{compactInstrumentName(instruments[Math.max(0, swipeInstrumentIndex - 1)]?.name || '')}</span>
          <strong>{compactInstrumentName(instruments[swipeInstrumentIndex]?.name || symbol)}</strong>
          <span className="sire-bottom-instrument-next">{compactInstrumentName(instruments[Math.min(instruments.length - 1, swipeInstrumentIndex + 1)]?.name || '')}</span>
        </div>
        <div
          className="sire-bottom-timeframe"
          onPointerDown={handleTimeframePointerDown}
          onPointerMove={handleTimeframePointerMove}
          onPointerUp={handleTimeframePointerEnd}
          onPointerCancel={handleTimeframePointerEnd}
          onContextMenu={event => event.preventDefault()}
          title="Tap and hold to choose timeframe"
        >
          <strong>{activeTimeframe}</strong>
        </div>
        <button
          type="button"
          className="sire-bottom-indicator-button"
          aria-label="Open indicators"
          title="Indicators"
          onClick={() => widgetRef.current?.openIndicatorPicker()}
        >
          <span className="sire-bottom-indicator-icon" aria-hidden="true">ƒ</span>
        </button>
        <button
          type="button"
          className="sire-bottom-replay-button"
          aria-label={replayActive ? (replayState?.playing ? 'Pause replay' : 'Play replay') : 'Open replay'}
          title={replayActive ? (replayState?.playing ? 'Pause replay' : 'Play replay') : 'Replay'}
          onClick={toggleReplay}
        >
          <span aria-hidden="true">{replayActive ? (replayState?.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />) : <History size={20} />}</span>
        </button>
        <button
          type="button"
          className="sire-bottom-tools-button"
          aria-label={drawRackOpen ? 'Close OpenAlgo drawing tools' : 'Open OpenAlgo drawing tools'}
          aria-expanded={drawRackOpen}
          title={drawRackOpen ? 'Close OpenAlgo tools' : 'OpenAlgo drawing tools'}
          onClick={() => setDrawRackOpen(open => !open)}
        >
          <Wrench size={22} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sire-bottom-multichart-button"
          aria-label="Open multi-chart manager"
          title="Multi-chart"
          onClick={() => window.dispatchEvent(new CustomEvent('sire:open-multichart'))}
        >
          <span className="sire-bottom-multichart-icon" aria-hidden="true"><span /><span /><span /></span>
        </button>
        <button
          type="button"
          className="sire-bottom-more-button"
          aria-label="Open chart menu"
          aria-expanded={moreMenuOpen}
          aria-haspopup="menu"
          title="More chart options"
          onClick={() => setMoreMenuOpen(open => !open)}
        >
          <MoreHorizontal size={23} strokeWidth={2} aria-hidden="true" />
        </button>
        {moreMenuOpen && (
          <div className="sire-bottom-more-menu" role="menu" aria-label="Chart options">
            <div className="sire-bottom-more-menu__section">
              <div className="sire-bottom-more-menu__title">Chart type</div>
              <div className="sire-bottom-more-menu__chart-types">
                {CHART_TYPES.map(chartType => (
                  <button
                    key={chartType.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={widgetRef.current?.chartType?.() === chartType.id}
                    className={widgetRef.current?.chartType?.() === chartType.id ? 'active' : ''}
                    onClick={() => selectChartType(chartType.id)}
                  >
                    {chartType.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sire-bottom-more-menu__section sire-bottom-more-menu__actions">
              <button type="button" role="menuitem" onClick={toggleTpo}>
                {tpoEnabled ? 'Hide Market Profile' : 'Market Profile'}
              </button>
              <button type="button" role="menuitem" onClick={captureChartPng}>Capture PNG</button>
              <button type="button" role="menuitem" onClick={exportChartSvgFromMenu}>Export SVG</button>
            </div>
          </div>
        )}
                <button
          type="button"
          className="sire-bottom-obj-button"
          aria-label="Open objects"
          title="Objects"
          onClick={() => widgetRef.current?.openObjects()}
        >
          <span aria-hidden="true">OBJ</span>
        </button>
        {timeframeOpen && (
          <div className="sire-bottom-timeframe-menu">
            {CHART_INTERVALS.map(interval => (
              <button
                key={interval}
                type="button"
                className={interval === activeTimeframe ? 'active' : ''}
                onClick={() => selectTimeframe(interval)}
              >
                {interval}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}