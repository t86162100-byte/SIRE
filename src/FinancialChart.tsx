import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, History, Lock, Minus, MoreHorizontal, Pause, Play, RotateCcw, Settings2, SkipBack, SkipForward, Trash2, Wrench, X } from 'lucide-react';
import { addComparison, comparisonController, PriceLevels, ReplayController, ReplayShade, TextWatermark, registerInterval, withBarCache } from 'openalgo-charts';
import 'openalgo-charts/indicators';
import 'openalgo-charts/draw';
import { computeMarketProfile, MarketProfile } from 'openalgo-charts/profile';
import 'openalgo-charts/trade';
import 'openalgo-charts/transform';
import 'openalgo-charts/webgl';
import { createWidget, type Widget } from 'openalgo-charts/widget';
import './financialChart.css';

type Tick = { symbol: string; quote: number; epoch: number };
type HistoryResponse = Record<string, unknown>;
type HistoryRequester = (request: Record<string, unknown>) => Promise<HistoryResponse>;
type Instrument = { symbol: string; name: string; pipSize?: number };
type Props = { symbol: string; isActive?: boolean; liveTick: Tick | null; requestHistory: HistoryRequester; instruments: Instrument[]; onSelectInstrument: (instrument: Instrument) => void; onWidgetReady?: (widget: Widget) => void; onWidgetDestroyed?: (widget: Widget) => void; onInstrumentTap?: () => void };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60, '2m': 120, '3m': 180, '5m': 300, '10m': 600, '15m': 900, '20m': 1200,
  '30m': 1800, '45m': 2700, '1h': 3600, '2h': 7200, '3h': 10800, '4h': 14400,
  '6h': 21600, '8h': 28800, '12h': 43200, '1d': 86400, '1w': 604800,
};
const DERIV_INTERVALS = Object.keys(INTERVAL_SECONDS);
for (const [code, seconds] of Object.entries(INTERVAL_SECONDS)) {
  if (!['1m', '5m', '15m', '1h', '1d', '1w'].includes(code)) {
    registerInterval({ code, bucketing: { mode: 'interval', seconds } });
  }
}
const intervalSeconds = (interval: string) => INTERVAL_SECONDS[interval] ?? 60;

const CHART_TYPES = [
  { id: 'candlestick', label: 'Candles' },
  { id: 'hollow-candle', label: 'Hollow Candles' },
  { id: 'volume-candle', label: 'Volume Candles' },
  { id: 'bar', label: 'Bars (OHLC)' },
  { id: 'high-low', label: 'High-Low' },
  { id: 'line', label: 'Line' },
  { id: 'line-markers', label: 'Line + Markers' },
  { id: 'step', label: 'Step Line' },
  { id: 'area', label: 'Area' },
  { id: 'hlc-area', label: 'HLC Area' },
  { id: 'baseline', label: 'Baseline' },
  { id: 'columns', label: 'Columns' },
  { id: 'histogram', label: 'Histogram' },
] as const;

const REPLAY_SPEEDS = [0.5, 1, 2, 5, 10] as const;
const replaySpeedLabel = (speed: number) => `${speed}×`;
const REPLAY_HISTORY_PAGE_LIMIT = 100;
const formatReplayInput = (epoch: number) => new Date(epoch * 1000 + 60 * 60 * 1000).toISOString().slice(0, 16);
const parseReplayInput = (value: string) => {
  if (!value) return NaN;
  const ms = Date.parse(`${value}:00+01:00`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
};

function parseCandles(data: HistoryResponse): Candle[] | null {
  if (!Array.isArray(data.candles)) return null;
  const candles = data.candles.map((item: unknown) => {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    return { time: Number(raw.epoch), open: Number(raw.open), high: Number(raw.high), low: Number(raw.low), close: Number(raw.close) };
  }).filter((c): c is Candle => Boolean(c) && Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
  return candles.length ? candles.sort((a, b) => a.time - b.time) : null;
}

function parseTicks(data: HistoryResponse) {
  const history = data.history as Record<string, unknown> | undefined;
  const prices = Array.isArray(history?.prices) ? history.prices : [];
  const times = Array.isArray(history?.times) ? history.times : [];
  if (!prices.length || !times.length) return null;
  return prices.map((price, index) => ({ epoch: Number(times[index]), quote: Number(price) })).filter(x => Number.isFinite(x.epoch) && Number.isFinite(x.quote));
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

function aggregateCandles(data: Candle[], seconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const candle of data) {
    const time = Math.floor(candle.time / seconds) * seconds;
    const current = buckets.get(time);
    if (!current) {
      buckets.set(time, {
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
    } else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

const REPLAY_SUB_INTERVAL: Record<string, string> = {
  '2m': '1m', '3m': '1m', '5m': '1m', '10m': '5m', '15m': '5m', '20m': '5m',
  '30m': '15m', '45m': '15m', '1h': '15m', '2h': '30m', '3h': '30m',
  '4h': '1h', '6h': '1h', '8h': '1h', '12h': '1h', '1d': '1h', '1w': '1d',
};
const replaySubInterval = (interval: string) => REPLAY_SUB_INTERVAL[interval] ?? null;

const FALLBACK_BASE_SECONDS: Record<string, number> = {
  '20m': 600,
  '45m': 900,
  '3h': 3600,
  '6h': 3600,
  '12h': 3600,
};

type BarsRequest = { symbol: string; interval: string; from?: number; to?: number; noCache?: boolean };

async function requestBars(req: BarsRequest, requestHistory: HistoryRequester): Promise<Candle[]> {
  const seconds = intervalSeconds(req.interval);
  const request: Record<string, unknown> = {
    ticks_history: req.symbol,
    end: Number.isFinite(req.to) ? Math.floor(Number(req.to)) : 'latest',
    count: 5000,
    style: 'candles',
    granularity: seconds,
  };
  if (Number.isFinite(req.from)) request.start = Math.floor(Number(req.from));
  if (req.noCache) request.noCache = true;

  let result: HistoryResponse;
  try {
    result = await requestHistory(request);
  } catch (error) {
    const fallbackSeconds = FALLBACK_BASE_SECONDS[req.interval];
    if (!fallbackSeconds) throw error;
    const fallbackRequest = { ...request, granularity: fallbackSeconds };
    const fallbackResult = await requestHistory(fallbackRequest);
    const fallbackCandles = parseCandles(fallbackResult);
    if (fallbackCandles?.length) return aggregateCandles(fallbackCandles, seconds);
    const fallbackTicks = parseTicks(fallbackResult);
    if (fallbackTicks?.length) return aggregateTicks(fallbackTicks, seconds);
    throw error;
  }

  const candles = parseCandles(result);
  if (candles) {
    // Deriv's current API accepts arbitrary integer granularities, but the
    // legacy public endpoint can return a coarse/underspecified response for
    // some custom intervals. If a requested custom interval comes back with
    // only one or two bars, rebuild it from a supported lower timeframe so the
    // chart never renders one oversized historical candle.
    const fallbackSeconds = FALLBACK_BASE_SECONDS[req.interval];
    if (fallbackSeconds && candles.length < 3) {
      try {
        const fallbackResult = await requestHistory({ ...request, granularity: fallbackSeconds });
        const fallbackCandles = parseCandles(fallbackResult);
        if (fallbackCandles?.length) return aggregateCandles(fallbackCandles, seconds);
      } catch {
        // Keep the direct response if the fallback request itself fails.
      }
    }
    return candles;
  }

  const ticks = parseTicks(result);
  if (ticks?.length) return aggregateTicks(ticks, seconds);
  throw new Error('Deriv returned no chart history');
}

export default function FinancialChart({ symbol, isActive = false, liveTick, requestHistory, instruments, onSelectInstrument, onWidgetReady, onWidgetDestroyed, onInstrumentTap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawRackOpen, setDrawRackOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [compareQuery, setCompareQuery] = useState('');
  const [comparisons, setComparisons] = useState<string[]>([]);
  const [replayActive, setReplayActive] = useState(false);
  const [replayState, setReplayState] = useState<{ index:number; total:number; playing:boolean; speed:number; bar:Candle|null; subIndex:number; subSteps:number } | null>(null);
  const [rendererKind, setRendererKind] = useState<'canvas2d' | 'webgl2'>('canvas2d');
  const [tpoEnabled, setTpoEnabled] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [selectedDrawing, setSelectedDrawing] = useState<{ id: string; sourceId: string; name: string; visible: boolean; locked: boolean } | null>(null);
  const [selectedDrawingPosition, setSelectedDrawingPosition] = useState<{ left: number; top: number } | null>(null);
  const [selectedIndicator, setSelectedIndicator] = useState<{ id: string; name: string; paneIndex: number } | null>(null);
  const [selectedIndicatorPosition, setSelectedIndicatorPosition] = useState<{ left: number; top: number } | null>(null);
  const [swipeInstrumentIndex, setSwipeInstrumentIndex] = useState(() => Math.max(0, instruments.findIndex(item => item.symbol === symbol)));
  const selectedIndicatorRef = useRef<{ id: string; name: string; paneIndex: number } | null>(null);
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
  const replayRef = useRef<ReplayController | null>(null);
  const replayShadeRef = useRef<ReplayShade | null>(null);
  const replayMarkRef = useRef<TextWatermark | null>(null);
  const replaySubBarsRef = useRef<{ key: string; bars: Candle[] } | null>(null);
  const [replaySetupOpen, setReplaySetupOpen] = useState(false);
  const [replayStartInput, setReplayStartInput] = useState('');
  const [replayEndInput, setReplayEndInput] = useState('');
  const [replayRangeError, setReplayRangeError] = useState<string | null>(null);
  const [replayDraftSpeed, setReplayDraftSpeed] = useState(1);
  const [replayLoading, setReplayLoading] = useState(false);
  const replaySpeedRef = useRef(1);
  const [marketQuote, setMarketQuote] = useState<{ price: number; percent: number } | null>(null);
  const widgetRef = useRef<Widget | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const subscriberRef = useRef<((bar: Candle) => void) | null>(null);
  const resyncRef = useRef<(() => void) | null>(null);
  const lastLiveEpochRef = useRef<number | null>(null);
  const latestTickRef = useRef<Tick | null>(null);
  const tpoEnabledRef = useRef(false);
  const tpoProfileRef = useRef<MarketProfile | null>(null);
  const tpoUnregisterRef = useRef<(() => void) | null>(null);
  const requestHistoryRef = useRef(requestHistory);
  const instrumentsRef = useRef(instruments);
  const onSelectInstrumentRef = useRef(onSelectInstrument);
  const symbolRef = useRef(symbol);
  requestHistoryRef.current = requestHistory;
  instrumentsRef.current = instruments;
  onSelectInstrumentRef.current = onSelectInstrument;
  symbolRef.current = symbol;
  tpoEnabledRef.current = tpoEnabled;
  useEffect(() => {
    const nextIndex = instruments.findIndex(item => item.symbol === symbol);
    if (nextIndex >= 0) setSwipeInstrumentIndex(nextIndex);
  }, [instruments, symbol]);
  const marketInstrument = instruments.find(item => item.symbol === symbol);
  const marketInstrumentName = marketInstrument?.name || symbol;
  const marketPriceDecimals = (() => {
    const tickSize = marketInstrument?.pipSize;
    if (!tickSize || !Number.isFinite(tickSize) || tickSize <= 0) return 2;
    const text = String(tickSize);
    if (text.includes('e-')) return Math.max(0, Number(text.split('e-')[1]));
    return Math.max(0, text.split('.')[1]?.length ?? 0);
  })();
  const formatMarketPrice = (price: number) => price.toLocaleString(undefined, { minimumFractionDigits: marketPriceDecimals, maximumFractionDigits: marketPriceDecimals });
  const updateMarketQuote = (bars: Candle[], livePrice?: number) => {
    // History is kept in chronological order by OpenAlgo's data controller;
    // avoid copying/sorting the full retained history on every live tick.
    const latest = bars[bars.length - 1];
    const price = Number.isFinite(livePrice) ? Number(livePrice) : latest?.close;
    if (!Number.isFinite(price)) return;
    const previous = bars.length > 1 ? bars[bars.length - 2].close : latest?.open;
    const percent = Number.isFinite(previous) && Number(previous) !== 0 ? ((Number(price) - Number(previous)) / Number(previous)) * 100 : 0;
    setMarketQuote({ price: Number(price), percent });
  };
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
  const clearTimeframeHold = () => {
    if (timeframeHoldTimerRef.current !== null) {
      window.clearTimeout(timeframeHoldTimerRef.current);
      timeframeHoldTimerRef.current = null;
    }
  };
  const handleTimeframePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    timeframeSwipeStartYRef.current = event.clientY;
    timeframeSwipeAccumulatedRef.current = 0;
    timeframeHoldTriggeredRef.current = false;
    clearTimeframeHold();
    timeframeHoldTimerRef.current = window.setTimeout(() => {
      timeframeHoldTriggeredRef.current = true;
      setTimeframeOpen(true);    }, 600);
  };
  const handleTimeframePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (timeframeHoldTriggeredRef.current) return;
    const delta = event.clientY - timeframeSwipeStartYRef.current;
    if (Math.abs(delta) >= 8) clearTimeframeHold();
    if (Math.abs(delta) < 45 || timeframeSwipeAnimatingRef.current) return;

    const direction: 1 | -1 = delta < 0 ? 1 : -1;
    const currentIndex = DERIV_INTERVALS.indexOf(activeTimeframe);
    const nextIndex = Math.max(0, Math.min(DERIV_INTERVALS.length - 1, currentIndex + direction));
    if (nextIndex !== currentIndex) {
      timeframeSwipeAnimatingRef.current = true;
      selectTimeframe(DERIV_INTERVALS[nextIndex]);
      window.setTimeout(() => { timeframeSwipeAnimatingRef.current = false; }, 280);
    }
    timeframeSwipeStartYRef.current = event.clientY;
    timeframeSwipeAccumulatedRef.current = 0;
  };
  const handleTimeframePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    clearTimeframeHold();
    timeframeHoldTriggeredRef.current = false;
    timeframeSwipeStartYRef.current = 0;
    timeframeSwipeAccumulatedRef.current = 0;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };
  const selectTimeframe = (interval: string) => {
    if (replayRef.current) stopReplay();
    const widget = widgetRef.current;
    if (!widget) return;
    setActiveTimeframe(interval);
    setTimeframeOpen(false);
    widget.setInterval(interval);
  };

  const clearInstrumentHold = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };
  const handleInstrumentPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    swipeStartYRef.current = event.clientY;
    swipeAccumulatedRef.current = 0;
    holdTriggeredRef.current = false;
    clearInstrumentHold();
    holdTimerRef.current = window.setTimeout(() => {
      if (swipeStartYRef.current !== null) {
        holdTriggeredRef.current = true;
        onInstrumentTap?.();
      }
    }, 600);
  };
  const handleInstrumentPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStartYRef.current;
    if (start === null) return;
    const delta = event.clientY - start;
    if (Math.abs(delta) >= 18 && !holdTriggeredRef.current) clearInstrumentHold();
    if (Math.abs(delta) < 55 || swipeAnimatingRef.current || holdTriggeredRef.current) return;
    const direction: 1 | -1 = delta < 0 ? 1 : -1;
    triggerSwipeStep(direction);
    swipeAnimatingRef.current = true;
    swipeStartYRef.current = event.clientY;
    swipeAccumulatedRef.current = 0;
    window.setTimeout(() => { swipeAnimatingRef.current = false; }, 320);
  };
  const handleInstrumentPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    clearInstrumentHold();
    swipeStartYRef.current = null;
    swipeAccumulatedRef.current = 0;
    holdTriggeredRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  useEffect(() => {
    if (!drawRackOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawRackOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [drawRackOpen]);

  useEffect(() => {
    if (!containerRef.current) return;
    const host = containerRef.current;
    const sourceFeed = {
      async getBars(req: BarsRequest) {
        const bars = await requestBars(req, requestHistoryRef.current);
        candlesRef.current = bars;
        updateMarketQuote(bars);
        resyncRef.current = null;
        return bars;
      },
      subscribeBars(req: BarsRequest, onBar: (bar: Candle) => void, options?: { seedFrom?: Candle; onResync?: () => void }) {
        subscriberRef.current = bar => { if (req.symbol === symbolRef.current) onBar(bar); };
        resyncRef.current = options?.onResync ?? null;
        lastLiveEpochRef.current = options?.seedFrom?.time ?? null;
        return () => {
          subscriberRef.current = null;
          resyncRef.current = null;
          lastLiveEpochRef.current = null;
        };
      },
    };
    const feed = withBarCache(sourceFeed, { ttlMs: 60_000, max: 32, maxBars: 250_000 });
    let widget: Widget;
    try {
      widget = createWidget(host, {
      feed,
      symbol,
      exchange: 'Deriv Synthetic Indices',
      interval: '1m',
      intervals: DERIV_INTERVALS,
      chartType: 'candlestick',
      theme: 'dark',
      renderer: 'auto',
      persist: `sire-${symbol}`,
      // OpenAlgo's managed loader owns older-history paging. Start with a
      // substantial recent window, then fetch older pages as the user pans
      // left; replay can explicitly backfill to an older requested start.
      lookbackBars: 5000,
      loading: { pageSize: 5000, maxBars: 500000 },
      navigation: { mousePan: 'both', defaultVisibleBars: 120 },
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
    // OpenAlgo owns the crosshair. Normal mode follows the pointer exactly;
    // drawing placement consumes that same native crosshair position.
    widget.chart.applyOptions({ crosshair: { mode: 'normal' } });
    const priceLevels = new PriceLevels({
      timezone: 'Africa/Lagos',
      quote: () => {
        const current = latestTickRef.current;
        return current ? { bid: current.bid, ask: current.ask } : undefined;
      },
    });
    widget.chart.addPrimitive(priceLevels, 0);
    setRendererKind(widget.chart.rendererKind);
    const offRenderer = widget.chart.on('renderer:fallback', () => setRendererKind('canvas2d'));
    widgetRef.current = widget;

    const updateSelectedDrawingOverlay = (drawing: any) => {
      if (!drawing) {
        setSelectedDrawingPosition(null);
        return;
      }
      const rawDoc = widget.draw?.toJSON?.() as any;
      const drawings = Array.isArray(rawDoc?.drawings) ? rawDoc.drawings : [];
      const model = drawings.find((item: any) => item?.id === drawing.id || item?.sourceId === drawing.sourceId);
      const points = Array.isArray(model?.points) ? model.points : [];
      const chart = widget.chart;
      const hostRect = host.getBoundingClientRect();
      const coords = points.map((point: any) => {
        const time = Number(point?.time);
        const price = Number(point?.price);
        if (!Number.isFinite(time) || !Number.isFinite(price)) return null;
        const x = chart.timeToCoordinate(time);
        const y = chart.priceToCoordinate(price, Number(model?.paneIndex) || 0);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
      }).filter(Boolean) as Array<{ x: number; y: number }>;
      if (!coords.length) {
        setSelectedDrawingPosition({ left: hostRect.width / 2, top: Math.max(90, hostRect.height / 2 - 70) });
        return;
      }
      const center = coords.reduce((acc, point) => ({ x: acc.x + point.x / coords.length, y: acc.y + point.y / coords.length }), { x: 0, y: 0 });
      const left = Math.max(90, Math.min(hostRect.width - 90, center.x));
      const top = Math.max(72, Math.min(hostRect.height - 120, center.y - 54));
      setSelectedDrawingPosition({ left, top });
    };
    const updateSelectedIndicatorOverlay = (indicator: { id: string; name: string; paneIndex: number } | null) => {
      if (!indicator) {
        setSelectedIndicatorPosition(null);
        return;
      }

      // The SIRE indicator controls are intentionally rendered over the price
      // pane, even when the selected indicator lives in a lower pane. This
      // keeps the settings/delete bar in one predictable place.
      const hostRect = host.getBoundingClientRect();
      const pricePane = widget.chart.panes()[0];
      const pricePaneRect = pricePane?.element?.getBoundingClientRect?.();
      const priceTop = pricePaneRect ? pricePaneRect.top - hostRect.top : 8;
      const left = Math.max(8, Math.min(hostRect.width - 92, 8 + Math.max(46, indicator.name.length * 6.5 + 8)));
      const top = Math.max(8, Math.min(hostRect.height - 42, priceTop + 6));
      setSelectedIndicatorPosition({ left, top });
    };

    const offIndicatorObjects = widget.objects.subscribe(objects => {
      if (selectedIndicatorRef.current) {
        const current = objects.find(object => object.kind === 'indicator' && object.id === selectedIndicatorRef.current?.id);
        if (!current) {
          selectedIndicatorRef.current = null;
          setSelectedIndicator(null);
          setSelectedIndicatorPosition(null);
        } else {
          const next = { id: current.id, name: current.name, paneIndex: current.paneIndex };
          selectedIndicatorRef.current = next;
          setSelectedIndicator(next);
          updateSelectedIndicatorOverlay(next);
        }
      }
    });

    // PaneLegend rows are canvas primitives. OpenAlgo routes their
    // `${id}::row` hit through subscribeClick (not chart.on('click')).
    // Use that public hit-test path so a tap on the indicator name reliably
    // opens our SIRE controls.
    const offIndicatorClick = widget.chart.subscribeClick((externalId: string) => {
      if (typeof externalId !== 'string' || !externalId.endsWith('::row')) return;

      const id = externalId.slice(0, -'::row'.length);
      const indicator = widget.objects.list().find(
        object => object.kind === 'indicator' && (object.id === id || object.sourceId === id)
      );
      if (!indicator) return;

      const next = {
        id: indicator.id,
        name: indicator.name,
        paneIndex: indicator.paneIndex,
      };

      widget.objects.select(indicator.id);
      selectedIndicatorRef.current = next;
      setSelectedIndicator(next);
      updateSelectedIndicatorOverlay(next);
    });

    const offDrawingObjects = widget.objects.subscribe(objects => {
      const drawing = objects.find(object => object.kind === 'drawing' && object.selected);
      setSelectedDrawing(drawing ? {
        id: drawing.id,
        sourceId: drawing.sourceId,
        name: drawing.name,
        visible: drawing.visible,
        locked: drawing.locked === true,
      } : null);
      updateSelectedDrawingOverlay(drawing);
    });

    // Re-show the floating controls whenever a drawing is touched/selected.
    const onDrawingInteraction = () => {
      window.requestAnimationFrame(() => {
        const selected = widget.objects.selection?.().find?.((item: any) => item?.kind === 'drawing');
        if (!selected) return;
        setSelectedDrawing({
          id: selected.id,
          sourceId: selected.sourceId,
          name: selected.name,
          visible: selected.visible,
          locked: selected.locked === true,
        });
        updateSelectedDrawingOverlay(selected);
      });
    };
    host.addEventListener('pointerdown', onDrawingInteraction, true);
    const onIndicatorInteraction = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('.sire-indicator-selection-bar')) return;

      // Sub-pane indicators do not reliably expose their legend row as a DOM
      // target because OpenAlgo renders the pane/legend on canvas. Treat a tap
      // anywhere inside an indicator pane as selecting that pane's indicator.
      // The controls are then shown on the price pane, where the user can
      // always reach Settings/Delete.
      const clientX = event.clientX;
      const clientY = event.clientY;
      const panes = widget.chart.panes();
      for (let paneIndex = 1; paneIndex < panes.length; paneIndex += 1) {
        const pane = panes[paneIndex];
        const rect = pane?.element?.getBoundingClientRect?.();
        if (!rect) continue;
        const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
        if (!inside) continue;

        const paneIndicators = widget.objects.list().filter(
          (item: any) => item?.kind === 'indicator' && Number(item?.paneIndex) === paneIndex && item?.visible !== false
        );
        const indicator = paneIndicators[paneIndicators.length - 1];
        if (!indicator) break;

        const next = {
          id: indicator.id,
          name: indicator.name,
          paneIndex: indicator.paneIndex,
        };
        widget.objects.select(indicator.id);
        selectedIndicatorRef.current = next;
        setSelectedIndicator(next);
        updateSelectedIndicatorOverlay(next);
        return;
      }

      selectedIndicatorRef.current = null;
      setSelectedIndicator(null);
      setSelectedIndicatorPosition(null);
    };
    host.addEventListener('pointerdown', onIndicatorInteraction, true);
    const offDrawingSelect = widget.chart.on('drawing:select', () => {
      window.requestAnimationFrame(() => {
        const selected = widget.objects.selection?.().find?.((item: any) => item?.kind === 'drawing');
        if (selected) updateSelectedDrawingOverlay(selected);
      });
    });
    const onResize = () => {
      const selected = widget.objects.selection?.().find?.((item: any) => item?.kind === 'drawing');
      if (selected) updateSelectedDrawingOverlay(selected);
      if (selectedIndicatorRef.current) updateSelectedIndicatorOverlay(selectedIndicatorRef.current);
    };
    window.addEventListener('resize', onResize);
    onWidgetReady?.(widget);
    setActiveTimeframe(widget.interval());
    const offInterval = widget.on('interval', (event: { interval: string }) => setActiveTimeframe(event.interval));
    const offSymbol = widget.on('symbol', (event: { symbol: string }) => {
      const instrument = instrumentsRef.current.find(item => item.symbol === event.symbol);
      if (instrument && instrument.symbol !== symbolRef.current) onSelectInstrumentRef.current(instrument);
    });
    const offData = widget.on('data', () => {
      // The widget's data event reports the retained bar count, not the bar
      // array. Read the authoritative managed-history store so prepend pages
      // immediately become available to replay and profile features.
      const loaded = widget.dataController?.bars();
      if (loaded) candlesRef.current = loaded.slice().sort((a, b) => a.time - b.time);
      window.setTimeout(refreshTpoProfile, 0);
    });
    const renderReplayState = (state: unknown) => {
      const next = state as typeof replayState;
      if (next) replaySpeedRef.current = next.speed;
      setReplayState(next);
    };
    const offReplayStart = widget.chart.on('replay:start', renderReplayState);
    const offReplayFrame = widget.chart.on('replay:frame', (state: unknown) => { renderReplayState(state); syncReplayDecorations(state as typeof replayState); });
    const offReplayPlay = widget.chart.on('replay:play', renderReplayState);
    const offReplayPause = widget.chart.on('replay:pause', renderReplayState);
    const offReplayEnd = widget.chart.on('replay:end', renderReplayState);
    const offReplayStop = widget.chart.on('replay:stop', () => {
      widget.dataController?.setPaused?.(false);
      setReplayActive(false);
      clearReplayDecorations();
      setReplayState(null);
      window.setTimeout(() => resyncRef.current?.(), 0);
    });
    tpoUnregisterRef.current = widget.objects.register({
      id: 'sire-market-profile',
      get: () => tpoProfileRef.current ? { kind: 'profile', name: 'Market Profile (TPO)', paneIndex: 0, visible: tpoEnabledRef.current } : null,
      setVisible: on => {
        if (on !== tpoEnabledRef.current) toggleTpo();
      },
      remove: () => {
        if (tpoEnabledRef.current) toggleTpo();
      },
    });
    return () => {
      offSymbol?.();
      offInterval?.();
      offData?.();
      offRenderer?.();
      offDrawingObjects?.();
      offIndicatorObjects?.();
      offDrawingSelect?.();
      window.removeEventListener('resize', onResize);
      host.removeEventListener('pointerdown', onDrawingInteraction, true);
      host.removeEventListener('pointerdown', onIndicatorInteraction, true);
      offReplayStart?.();
      offReplayFrame?.();
      offReplayPlay?.();
      offReplayPause?.();
      offReplayEnd?.();
      offReplayStop?.();
      tpoUnregisterRef.current?.();
      tpoUnregisterRef.current = null;
      tpoProfileRef.current = null;
      subscriberRef.current = null;
      onWidgetDestroyed?.(widget);
      replayRef.current?.stop();
      replayRef.current = null;
      replayShadeRef.current = null;
      replayMarkRef.current = null;
      replaySubBarsRef.current = null;
      widget.destroy();
      widgetRef.current = null;
      candlesRef.current = [];
    };
    } catch (error) {
      host.textContent = `OpenAlgo widget failed to initialize: ${error instanceof Error ? error.message : String(error)}`;
      host.style.padding = '24px';
      host.style.boxSizing = 'border-box';
      host.style.color = '#ff8080';
      host.style.background = '#080808';
      host.style.fontFamily = 'monospace';
      host.style.fontSize = '14px';
      throw error;
    }
  }, []);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const positionRail = () => {
      const rail = host.querySelector<HTMLElement>('.oac-rail');
      if (!rail) return;
      rail.classList.toggle('sire-oac-rail--closed', !drawRackOpen);
      rail.setAttribute('aria-hidden', String(!drawRackOpen));

      if (!drawRackOpen) {
        rail.style.removeProperty('--sire-rail-top');
        return;
      }

      const quote = host.querySelector<HTMLElement>('.sire-market-quote');
      const hostRect = host.getBoundingClientRect();
      const quoteRect = quote?.getBoundingClientRect();
      const quoteBottom = quoteRect ? quoteRect.bottom - hostRect.top : 0;

      // OpenAlgo indicator legends are canvas-rendered, so measure their row
      // count from the chart objects rather than looking for DOM elements.
      const widget = widgetRef.current;
      const mainPaneIndicators = widget?.objects.list?.().filter(
        (item: any) => item?.kind === 'indicator' && Number(item?.paneIndex) === 0 && item?.visible !== false
      ) ?? [];
      const indicatorLegendBottom = mainPaneIndicators.length
        ? 6 + mainPaneIndicators.length * 24 + 4
        : 0;

      // Keep the drawing rail below the SIRE quote and any main-pane legend
      // rows, with a small breathing gap so nothing is covered.
      const top = Math.ceil(Math.max(quoteBottom + 8, indicatorLegendBottom));
      rail.style.setProperty('--sire-rail-top', `${Math.max(0, top)}px`);
    };

    positionRail();
    const observer = new MutationObserver(() => window.requestAnimationFrame(positionRail));
    observer.observe(host, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(positionRail);
    resizeObserver.observe(host);
    const onResize = () => positionRail();
    window.addEventListener('resize', onResize);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      const rail = host.querySelector<HTMLElement>('.oac-rail');
      rail?.style.removeProperty('--sire-rail-top');
    };
  }, [drawRackOpen, symbol, marketQuote, instruments]);

  useEffect(() => {
    setMarketQuote(null);
    if (replayRef.current) stopReplay();
    const widget = widgetRef.current;
    if (widget && widget.symbol() !== symbol) widget.setSymbol(symbol, 'Deriv Synthetic Indices');
  }, [symbol]);

  useEffect(() => {
    const tick = liveTick;
    if (!tick || tick.symbol !== symbol || !Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) return;
    latestTickRef.current = tick;
    updateMarketQuote(candlesRef.current, tick.quote);
    if (replayRef.current) return;
    if (tpoEnabledRef.current) window.setTimeout(refreshTpoProfile, 0);
    const widget = widgetRef.current;
    if (!widget) return;
    const seconds = intervalSeconds(widget.interval());
    const previousEpoch = lastLiveEpochRef.current;
    if (previousEpoch !== null && tick.epoch - previousEpoch > Math.max(seconds * 2, 120)) {
      resyncRef.current?.();
    }
    lastLiveEpochRef.current = tick.epoch;
    const time = Math.floor(tick.epoch / seconds) * seconds;
    const last = candlesRef.current[candlesRef.current.length - 1];
    const bar: Candle = last?.time === time
      ? { ...last, high: Math.max(last.high, tick.quote), low: Math.min(last.low, tick.quote), close: tick.quote }
      : { time, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote };
    if (last?.time === time) candlesRef.current[candlesRef.current.length - 1] = bar;
    else {
      candlesRef.current.push(bar);
      const retainedLimit = widget.dataController ? 500000 : 1500;
      if (candlesRef.current.length > retainedLimit) candlesRef.current.splice(0, candlesRef.current.length - retainedLimit);
    }
    subscriberRef.current?.(bar);
  }, [liveTick, symbol]);

  const loadReplaySubBars = async (fullBars: Candle[], startIndex: number, endIndex: number) => {
    const widget = widgetRef.current;
    if (!widget) return null;
    const displayInterval = widget.interval();
    const finer = replaySubInterval(displayInterval);
    const useTicks = displayInterval === '1m';
    if (!finer && !useTicks) return null;
    const key = `${symbolRef.current}|${displayInterval}|${fullBars[startIndex]?.time ?? 0}|${fullBars[endIndex]?.time ?? 0}`;
    if (replaySubBarsRef.current?.key === key) return replaySubBarsRef.current.bars;
    const from = fullBars[startIndex]?.time;
    const to = fullBars[endIndex]?.time;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    try {
      let sub: Candle[] = [];
      if (useTicks) {
        const tickResult = await requestHistoryRef.current({
          ticks_history: symbolRef.current,
          start: Math.floor(Number(from)),
          end: Math.floor(Number(to)) + intervalSeconds(displayInterval),
          count: 5000,
          style: 'ticks',
          subscribe: 0,
          noCache: true,
        });
        const ticks = parseTicks(tickResult) ?? [];
        sub = aggregateTicks(ticks, 1).filter(bar => bar.time >= Number(from) && bar.time <= Number(to) + intervalSeconds(displayInterval));
      } else {
        const bars = await requestBars({
          symbol: symbolRef.current,
          interval: finer as string,
          from,
          to: Number(to) + intervalSeconds(displayInterval),
          noCache: true,
        }, requestHistoryRef.current);
        sub = bars.filter(bar => bar.time >= Number(from) && bar.time <= Number(to) + intervalSeconds(displayInterval));
      }
      if (!sub.length) return null;
      replaySubBarsRef.current = { key, bars: sub };
      return sub;
    } catch {
      return null;
    }
  };

  const clearReplayDecorations = () => {
    const widget = widgetRef.current;
    if (widget && replayShadeRef.current) widget.chart.removePrimitive(replayShadeRef.current);
    replayShadeRef.current = null;
    if (widget && replayMarkRef.current) widget.chart.removePrimitive(replayMarkRef.current);
    replayMarkRef.current = null;
  };

  const syncReplayDecorations = (state: typeof replayState) => {
    const widget = widgetRef.current;
    if (!widget || !state) return;
    if (!replayMarkRef.current) {
      replayMarkRef.current = new TextWatermark({ text: 'Replay' });
      widget.chart.addPrimitive(replayMarkRef.current, 0);
    }
    if (!replayShadeRef.current) {
      replayShadeRef.current = new ReplayShade({ index: state.index, lineVisible: true });
      widget.chart.addPrimitive(replayShadeRef.current, 0);
    } else {
      replayShadeRef.current.setOptions({ index: state.index });
    }
  };

  const startReplay = async (startIndex: number, endIndex: number, speed: number) => {
    const widget = widgetRef.current;
    const fullBars = candlesRef.current.slice().sort((a, b) => a.time - b.time);
    if (!widget || fullBars.length < 2) return false;
    const start = Math.max(0, Math.min(startIndex, fullBars.length - 2));
    const end = Math.max(start + 1, Math.min(endIndex, fullBars.length - 1));
    setReplayLoading(true);
    replaySpeedRef.current = speed;
    const subBars = await loadReplaySubBars(fullBars, start, end);
    if (!widgetRef.current || widgetRef.current !== widget) {
      setReplayLoading(false);
      return false;
    }
    replayRef.current?.stop();
    replayRef.current = null;
    clearReplayDecorations();
    widget.dataController?.setPaused?.(true);
    const replayBars = fullBars.slice(0, end + 1);
    const replay = new ReplayController(widget.chart, {
      series: widget.series,
      bars: replayBars,
      startIndex: start,
      subBars: subBars || undefined,
      barMs: 1000,
      speed,
    });
    replayRef.current = replay;
    setReplayActive(true);
    setReplayState(replay.state() as typeof replayState);
    syncReplayDecorations(replay.state() as typeof replayState);
    setReplaySetupOpen(false);
    setReplayLoading(false);
    return true;
  };

  const stopReplay = () => {
    replayRef.current?.stop();
    replayRef.current = null;
    clearReplayDecorations();
    widgetRef.current?.dataController?.setPaused?.(false);
    setReplayActive(false);
    setReplayState(null);
    setReplaySetupOpen(false);
  };

  const backfillHistoryTo = async (targetEpoch?: number) => {
    const widget = widgetRef.current;
    const controller = widget?.dataController;
    if (!controller) return candlesRef.current.slice().sort((a, b) => a.time - b.time);

    let previousFirst = Infinity;
    for (let page = 0; page < REPLAY_HISTORY_PAGE_LIMIT; page += 1) {
      const loaded = controller.bars().slice().sort((a, b) => a.time - b.time);
      const first = loaded[0];
      if (!first) break;
      if (targetEpoch !== undefined && first.time <= targetEpoch) break;
      if (first.time >= previousFirst) break;
      previousFirst = first.time;

      const next = await controller.loadMore();
      const nextBars = next.slice().sort((a, b) => a.time - b.time);
      const nextFirst = nextBars[0];
      if (!nextFirst || nextFirst.time >= first.time) break;
      if (controller.getState().hasMore === false) break;
    }

    return controller.bars().slice().sort((a, b) => a.time - b.time);
  };

  const openReplaySetup = async () => {
    setReplayLoading(true);
    setReplayRangeError(null);
    try {
      // Resolve the actual earliest history available from the provider, not
      // merely the first page currently resident in the chart.
      const bars = await backfillHistoryTo();
      if (bars.length < 2) {
        setReplayRangeError('Not enough history');
        return;
      }
      setReplayStartInput(formatReplayInput(bars[0].time));
      setReplayEndInput(formatReplayInput(bars[bars.length - 1].time));
      replaySpeedRef.current = 1;
      setReplayDraftSpeed(1);
      setReplaySetupOpen(true);
    } finally {
      setReplayLoading(false);
    }
  };

  const startReplayFromInputs = async (forceBeginning = false, forceLatest = false) => {
    setReplayLoading(true);
    try {
      let bars = candlesRef.current.slice().sort((a, b) => a.time - b.time);
      if (bars.length < 2) {
        setReplayRangeError('Not enough history');
        return;
      }

      const requestedStart = forceBeginning ? undefined : parseReplayInput(replayStartInput);
      if (!forceBeginning && !Number.isFinite(requestedStart)) {
        setReplayRangeError('Choose a valid start and end');
        return;
      }

      // If the requested replay starts before the currently loaded window,
      // keep paging backward until that timestamp is resident or the provider
      // reports exhaustion.
      bars = await backfillHistoryTo(requestedStart);
      if (forceBeginning) bars = await backfillHistoryTo();

      if (bars.length < 2) {
        setReplayRangeError('Not enough history');
        return;
      }

      const startEpoch = forceBeginning ? bars[0].time : Number(requestedStart);
      const endEpoch = forceLatest ? bars[bars.length - 1].time : parseReplayInput(replayEndInput);
      if (!Number.isFinite(startEpoch) || !Number.isFinite(endEpoch) || startEpoch >= endEpoch) {
        setReplayRangeError('Choose a valid start and end');
        return;
      }

      const startIndex = Math.max(0, bars.findIndex(bar => bar.time >= startEpoch));
      let endIndex = bars.length - 1;
      while (endIndex > 0 && bars[endIndex].time > endEpoch) endIndex -= 1;
      if (endIndex <= startIndex) {
        setReplayRangeError('Range must contain at least two candles');
        return;
      }
      setReplayRangeError(null);
      await startReplay(startIndex, endIndex, replayDraftSpeed);
    } finally {
      setReplayLoading(false);
    }
  };

  const toggleReplay = () => {
    const replay = replayRef.current;
    if (!replay) {
      openReplaySetup();
      return;
    }
    if (replay.state().playing) replay.pause();
    else replay.play({ speed: replaySpeedRef.current });
  };

  const setReplaySpeed = (speed: number) => {
    const replay = replayRef.current;
    replaySpeedRef.current = speed;
    if (replay && replay.state().playing) replay.play({ speed });
    setReplayDraftSpeed(speed);
    setReplayState(current => current ? { ...current, speed } : current);
  };

  const replayStepBack = () => replayRef.current?.stepBack();
  const replayStep = () => replayRef.current?.step();
  const replaySeek = (index: number) => replayRef.current?.seek(index);
  const replayJumpStart = () => replayRef.current?.seek(0);
  const replayJumpEnd = () => {
    const replay = replayRef.current;
    if (replay) replay.seek(Math.max(0, replay.state().total - 1));
  };
  useEffect(() => {
    if (!replayActive) return;
    const onReplayKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === ' ') { event.preventDefault(); toggleReplay(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); replayStepBack(); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); replayStep(); }
      else if (event.key === 'Home') { event.preventDefault(); replayJumpStart(); }
      else if (event.key === 'End') { event.preventDefault(); replayJumpEnd(); }
      else if (event.key === 'Escape') { event.preventDefault(); stopReplay(); }
    };
    window.addEventListener('keydown', onReplayKey);
    return () => window.removeEventListener('keydown', onReplayKey);
  }, [replayActive]);

  const exportChartSvg = () => { const widget = widgetRef.current; if (!widget) return; const svg = widget.chart.exportSVG({ background: true }); const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sire-${widget.symbol()}-${widget.interval()}.svg`; anchor.click(); URL.revokeObjectURL(url); };
  const addCompare = async (compareSymbol: string) => {
    const widget = widgetRef.current;
    if (!widget || !compareSymbol || compareSymbol === symbol || comparisons.includes(compareSymbol)) return;
    const bars = await requestBars({ symbol: compareSymbol, interval: widget.interval() }, requestHistoryRef.current);
    addComparison(widget.chart, { symbol: compareSymbol, bars });
    comparisonController(widget.chart).setMode('percentage');
    setComparisons(current => [...current, compareSymbol]);
  };
  const removeCompare = (compareSymbol: string) => {
    const widget = widgetRef.current;    if (!widget) return;
    const controller = comparisonController(widget.chart);
    const handle = controller.list().find(item => item.symbol === compareSymbol);
    if (handle) controller.remove(handle);
    setComparisons(current => current.filter(item => item !== compareSymbol));
  };

  const refreshTpoProfile = () => {
    const widget = widgetRef.current;
    if (!widget || !tpoEnabledRef.current || candlesRef.current.length < 2) return;
    const instrument = instrumentsRef.current.find(item => item.symbol === symbolRef.current);
    const tickSize = instrument?.pipSize && instrument.pipSize > 0 ? instrument.pipSize : 0.01;
    const result = computeMarketProfile(candlesRef.current, {
      tickSize,
      rowTicks: Math.max(1, Math.round(0.5 / tickSize)),
      session: 'day',
      blockMinutes: 30,
      valueAreaPercent: 0.7,
      initialBalancePeriods: 2,
      compositeSessions: 1,
      tailEdges: 0,
      timezone: 'Africa/Lagos',
    });
    let profile = tpoProfileRef.current;
    if (!profile) {
      profile = new MarketProfile(result, {
        blockDisplay: 'auto',
        showSessionLabel: true,
        showPoc: true,
        showValueArea: true,
        showInitialBalance: true,
        showSinglePrints: true,
        fillValueArea: true,
      });
      tpoProfileRef.current = profile;
      widget.chart.addPrimitive(profile, 0);
    } else {
      profile.setData(result);
    }
    widget.objects.refresh();
  };

  const selectChartType = (chartType: string) => {
    const widget = widgetRef.current;
    if (!widget) return;
    try {
      widget.setChartType(chartType);
    } catch {
      return;
    }
    setMoreMenuOpen(false);
  };

  const captureChartPng = () => {
    const widget = widgetRef.current;
    if (!widget) return;
    widget.chart.downloadScreenshot(`sire-${symbol}-${widget.interval() || 'chart'}.png`);
    setMoreMenuOpen(false);
  };

  const exportChartSvgFromMenu = () => {
    exportChartSvg();
    setMoreMenuOpen(false);
  };

  const toggleTpo = () => {
    const widget = widgetRef.current;
    if (!widget) return;
    if (tpoEnabledRef.current) {
      tpoEnabledRef.current = false;
      setTpoEnabled(false);
      if (tpoProfileRef.current) widget.chart.removePrimitive(tpoProfileRef.current);
      tpoProfileRef.current = null;
      widget.objects.refresh();
      return;
    }
    tpoEnabledRef.current = true;
    setTpoEnabled(true);
    refreshTpoProfile();
  };

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
            {DERIV_INTERVALS.map(interval => (
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