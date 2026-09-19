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


export type DerivInstrument = { symbol: string; name: string; market: string; submarket: string; subgroup: string; symbolType: string; pipSize?: number; exchangeOpen?: number };
export type DerivBar = { time: number; open: number; high: number; low: number; close: number; volume: number };
const DERIV_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const DERIV_REQUEST_TIMEOUT = 20000;
const DERIV_PAGE_SIZE = 5000;
const DERIV_INTERVAL_SECONDS: Record<string, number> = Object.fromEntries(Object.entries(INTERVAL_SECONDS));
let derivRequestId = 0;
const nextDerivRequestId = () => ++derivRequestId;
const derivSleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

function openDerivSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(DERIV_WS_URL);
    const timer = window.setTimeout(() => { socket.close(); reject(new Error('Deriv market-data connection timed out.')); }, DERIV_REQUEST_TIMEOUT);
    socket.onopen = () => { window.clearTimeout(timer); resolve(socket); };
    socket.onerror = () => { window.clearTimeout(timer); reject(new Error('Deriv market-data connection failed.')); };
  });
}

function derivRequest(socket: WebSocket, payload: Record<string, unknown>): Promise<any> {
  const req_id = nextDerivRequestId();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('Deriv market-data request timed out.')); }, DERIV_REQUEST_TIMEOUT);
    const cleanup = () => { window.clearTimeout(timer); socket.removeEventListener('message', onMessage); socket.removeEventListener('error', onError); socket.removeEventListener('close', onClose); };
    const onMessage = (event: MessageEvent) => { let data: any; try { data = JSON.parse(String(event.data)); } catch { return; } if (data.req_id !== req_id) return; cleanup(); if (data.error) reject(new Error(data.error.message || 'Deriv market-data request failed.')); else resolve(data); };
    const onError = () => { cleanup(); reject(new Error('Deriv market-data socket error.')); };
    const onClose = () => { cleanup(); reject(new Error('Deriv market-data socket closed.')); };
    socket.addEventListener('message', onMessage); socket.addEventListener('error', onError); socket.addEventListener('close', onClose); socket.send(JSON.stringify({ ...payload, req_id }));
  });
}

function syntheticInstrument(item: any): DerivInstrument | null {
  const market = String(item.market || '').toLowerCase();
  const type = String(item.underlying_symbol_type || '').toLowerCase();
  const submarket = String(item.submarket || '').toLowerCase();
  const subgroup = String(item.subgroup || '').toLowerCase();
  if (!(market.includes('synthetic') || type.includes('synthetic') || submarket.includes('synthetic') || subgroup.includes('synthetic'))) return null;
  const symbol = String(item.underlying_symbol || '').trim();
  if (!symbol) return null;
  const pip = Number(item.pip_size);
  return { symbol, name: String(item.underlying_symbol_name || symbol), market: String(item.market || ''), submarket: String(item.submarket || ''), subgroup: String(item.subgroup || ''), symbolType: String(item.underlying_symbol_type || ''), pipSize: Number.isFinite(pip) ? pip : undefined, exchangeOpen: Number.isFinite(Number(item.exchange_is_open)) ? Number(item.exchange_is_open) : undefined };
}

export async function fetchSyntheticInstruments(): Promise<DerivInstrument[]> {
  const socket = await openDerivSocket();
  try { const data = await derivRequest(socket, { active_symbols: 'brief' }); return (Array.isArray(data.active_symbols) ? data.active_symbols.map(syntheticInstrument).filter(Boolean) as DerivInstrument[] : []).sort((a, b) => a.name.localeCompare(b.name)); }
  finally { socket.close(); }
}

function derivBar(candle: any): DerivBar | null {
  const time = Number(candle?.epoch), open = Number(candle?.open), high = Number(candle?.high), low = Number(candle?.low), close = Number(candle?.close);
  return [time, open, high, low, close].every(Number.isFinite) ? { time, open, high, low, close, volume: 0 } : null;
}

export async function fetchAllDerivHistory(symbol: string, interval: string): Promise<DerivBar[]> {
  const seconds = DERIV_INTERVAL_SECONDS[interval]; if (!seconds) throw new Error(`Unsupported Deriv interval: ${interval}`);
  const socket = await openDerivSocket();
  try {
    const all: DerivBar[] = []; let end: number | 'latest' = 'latest'; let previousOldest = Infinity;
    while (true) {
      const data = await derivRequest(socket, { ticks_history: symbol, end, count: DERIV_PAGE_SIZE, style: 'candles', granularity: seconds, adjust_start_time: 1 });
      const page = (Array.isArray(data.candles) ? data.candles.map(derivBar).filter(Boolean) as DerivBar[] : []).sort((a, b) => a.time - b.time);
      if (!page.length) break;
      const seen = new Set(all.map(bar => bar.time)); for (const bar of page) if (!seen.has(bar.time)) all.push(bar); all.sort((a, b) => a.time - b.time);
      const oldest = page[0].time; if (page.length < DERIV_PAGE_SIZE || oldest <= 0 || oldest >= previousOldest) break; previousOldest = oldest; end = Math.max(1, oldest - 1); await derivSleep(75);
    }
    return all;
  } finally { socket.close(); }
}

function tickToBar(previous: DerivBar | null, epoch: number, price: number, seconds: number): DerivBar {
  const time = Math.floor(epoch / seconds) * seconds;
  if (!previous || time > previous.time) return { time, open: price, high: price, low: price, close: price, volume: 0 };
  if (time < previous.time) return previous;
  return { ...previous, high: Math.max(previous.high, price), low: Math.min(previous.low, price), close: price };
}

export function createDerivDataFeed(onQuote?: (quote: { symbol: string; price: number }) => void) {
  return {
    async getBars({ symbol, interval }: { symbol: string; interval: string }) { return fetchAllDerivHistory(symbol, interval); },
    subscribeBars({ symbol, interval }: { symbol: string; interval: string }, onBar: (bar: DerivBar) => void, options?: { seedFrom?: DerivBar }) {
      const seconds = DERIV_INTERVAL_SECONDS[interval]; let stopped = false; let socket: WebSocket | null = null; let reconnect: number | null = null; let current = options?.seedFrom ? { ...options.seedFrom } : null;
      const connect = () => { if (stopped) return; socket = new WebSocket(DERIV_WS_URL); socket.onopen = () => { if (!stopped && socket) socket.send(JSON.stringify({ ticks: symbol, subscribe: 1, req_id: nextDerivRequestId() })); }; socket.onmessage = event => { let data: any; try { data = JSON.parse(String(event.data)); } catch { return; } if (data.msg_type !== 'tick' || data.tick?.symbol !== symbol) return; const epoch = Number(data.tick.epoch), price = Number(data.tick.quote); if (!Number.isFinite(epoch) || !Number.isFinite(price)) return; const next = tickToBar(current, epoch, price, seconds); onQuote?.({ symbol, price }); if (!current || next.time !== current.time || next.close !== current.close || next.high !== current.high || next.low !== current.low) { current = next; onBar({ ...next }); } }; socket.onclose = () => { socket = null; if (!stopped) reconnect = window.setTimeout(connect, 1000); }; socket.onerror = () => {}; };
      connect(); return () => { stopped = true; if (reconnect !== null) window.clearTimeout(reconnect); if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ forget_all: 'ticks' })); socket?.close(); socket = null; };
    },
  };
}

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
  const replaySpeedRef = useRef(1);
  const [rendererKind, setRendererKind] = useState<'canvas2d' | 'webgl2'>('canvas2d');
  const [tpoEnabled, setTpoEnabled] = useState(false);
  const [marketQuote, setMarketQuote] = useState<{ price: number; percent: number } | null>(null);
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
  instrumentsRef.current = instruments;
  onSelectInstrumentRef.current = onSelectInstrument;
  symbolRef.current = symbol;
  const marketInstrument = instruments.find(item => item.symbol === symbol);
  const marketInstrumentName = marketInstrument?.name || symbol;
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
  const startReplayFromInputs = async (fromBeginning: boolean, toLatest: boolean) => {
    setReplayRangeError(null);
    const widget = widgetRef.current;
    if (!widget) { setReplayRangeError('Chart is still loading.'); return; }
    replayRef.current?.stop();
    replayRef.current = null;

    const series = widget.primarySeries();
    if (!series) { setReplayRangeError('No chart data is loaded yet.'); return; }

    let allBars = (series.getData?.() || []) as DerivBar[];
    if (!allBars.length) {
      try {
        allBars = await fetchAllDerivHistory(symbol, activeTimeframe);
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
    const startTime = fromBeginning ? null : parseReplayTime(replayStartInput);
    const endTime = toLatest ? null : parseReplayTime(replayEndInput);
    if (!fromBeginning && replayStartInput && startTime === null) { setReplayRangeError('Invalid replay start date/time.'); return; }
    if (!toLatest && replayEndInput && endTime === null) { setReplayRangeError('Invalid replay end date/time.'); return; }
    if (startTime !== null && endTime !== null && startTime > endTime) { setReplayRangeError('Replay start must be before replay end.'); return; }

    const bars = allBars.filter(bar => (startTime === null || bar.time >= startTime) && (endTime === null || bar.time <= endTime));
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
        setMarketQuote(current => {
          const series = widgetRef.current?.primarySeries();
          const bars = (series?.getData?.() || []) as DerivBar[];
          const previousClosed = bars.length > 1 ? bars[bars.length - 2] : null;
          const percent = previousClosed?.close ? ((quote.price - previousClosed.close) / previousClosed.close) * 100 : (current?.percent || 0);
          return { price: quote.price, percent };
        });
      });
      dataFeedRef.current = feed;
      widget = createWidget(host, {
        symbol,
        exchange: 'SYNTHETIC',
        feed,
        loading: { retainedBars: Number.MAX_SAFE_INTEGER },
        interval: '1m',
        intervals: CHART_INTERVALS,
        chartType: 'candlestick',
        theme: 'dark',
        renderer: 'canvas2d',
        navigation: { mousePan: 'both', defaultVisibleBars: 10 },
        lookbackBars: Number.MAX_SAFE_INTEGER,
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
      const offRenderer = widget.chart.on('renderer:fallback', () => setRendererKind('canvas2d'));
      widgetRef.current = widget;
      setActiveTimeframe(widget.interval());
      const offInterval = widget.on('interval', (event: { interval: string }) => setActiveTimeframe(event.interval));
      const offSymbol = widget.on('symbol', (event: { symbol: string }) => {
        const instrument = instrumentsRef.current.find(item => item.symbol === event.symbol);
        if (instrument && instrument.symbol !== symbolRef.current) onSelectInstrumentRef.current(instrument);
      });
      const syncQuoteFromSeries = () => {
        const bars = (widget.primarySeries()?.getData?.() || []) as DerivBar[];
        const last = bars[bars.length - 1];
        if (!last || !Number.isFinite(last.close)) return;
        const previous = bars.length > 1 ? bars[bars.length - 2] : null;
        const percent = previous?.close ? ((last.close - previous.close) / previous.close) * 100 : 0;
        setMarketQuote({ price: last.close, percent });
      };
      const offData = widget.on('data', syncQuoteFromSeries);
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
    setMarketQuote(null);
    const widget = widgetRef.current;
    if (widget && widget.symbol() !== symbol) widget.setSymbol(symbol, 'SYNTHETIC');
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
            <input aria-label="Replay start date and time" type="datetime-local" value={replayStartInput} onChange={event => setReplayStartInput(event.target.value)} title="Start" />
            <span aria-hidden="true">↔</span>
            <input aria-label="Replay stop date and time" type="datetime-local" value={replayEndInput} onChange={event => setReplayEndInput(event.target.value)} title="Stop" />
          </div>
          <div className="sire-replay-quick-row">
            <button type="button" onClick={() => startReplayFromInputs(true, true)} aria-label="Replay from beginning to latest" title="Beginning to latest">⏮▶</button>
            <button type="button" onClick={() => startReplayFromInputs(false, true)} aria-label="Replay selected start to latest" title="Start to latest">▶⏭</button>
            <button type="button" onClick={() => startReplayFromInputs(false, false)} aria-label="Replay selected range" title="Start to stop">↔▶</button>
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