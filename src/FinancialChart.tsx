import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Circle, Crosshair, Eraser, GitBranch, Highlighter, Minus, MousePointer2, MoveUpRight, Pencil, Plus, RectangleHorizontal, Ruler, Shapes, Slash, Square, Table2, Target, TextCursorInput, Type, Waves } from 'lucide-react';
import { addComparison, comparisonController, PriceLevels, ReplayController, registerInterval, withBarCache } from 'openalgo-charts';
import 'openalgo-charts/indicators';
import 'openalgo-charts/draw';
import { iconSvg, registeredDrawingTools } from 'openalgo-charts/draw';
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
type Props = { symbol: string; liveTick: Tick | null; requestHistory: HistoryRequester; instruments: Instrument[]; onSelectInstrument: (instrument: Instrument) => void; onWidgetReady?: (widget: Widget) => void; onWidgetDestroyed?: (widget: Widget) => void; onInstrumentTap?: () => void };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type DrawGroup = { label: string; tools: string[] };

const DRAW_RACK_GROUPS: DrawGroup[] = [
  { label: 'Cursor', tools: ['__cursor__'] },
  { label: 'Trend line', tools: ['trend-line', 'ray', 'extended-line', 'horizontal-line', 'horizontal-ray', 'vertical-line', 'cross-line', 'arrow'] },
  { label: 'Channels', tools: ['parallel-channel'] },
  { label: 'Fibonacci & Gann', tools: ['fib-retracement', 'fib-extension', 'fib-channel', 'fib-time-zone', 'fib-fan', 'gann-fan', 'gann-box', 'cyclic-lines', 'time-cycles', 'sine-line'] },
  { label: 'Patterns', tools: ['path', 'polyline', 'triangle', 'rotated-rectangle', 'double-curve'] },
  { label: 'Forecast & measure', tools: ['forecast', 'price-range', 'date-range', 'measure', 'long-position', 'short-position'] },
  { label: 'Shapes', tools: ['rectangle', 'ellipse', 'circle', 'arc', 'curve', 'highlighter', 'brush'] },
  { label: 'Annotation', tools: ['text', 'note', 'price-note', 'callout', 'comment', 'balloon', 'signpost', 'table', 'price-label', 'flag-mark'] },
  { label: 'Arrows & marks', tools: ['arrow-up', 'arrow-down', 'arrow-left', 'arrow-right'] },
];

const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60, '2m': 120, '3m': 180, '5m': 300, '10m': 600, '15m': 900,
  '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '1d': 86400, '1w': 604800,
};
const DERIV_INTERVALS = Object.keys(INTERVAL_SECONDS);
for (const [code, seconds] of Object.entries(INTERVAL_SECONDS)) {
  if (!['1m', '5m', '15m', '1h', '1d', '1w'].includes(code)) {
    registerInterval({ code, bucketing: { mode: 'interval', seconds } });
  }
}
const intervalSeconds = (interval: string) => INTERVAL_SECONDS[interval] ?? 60;

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
  const result = await requestHistory(request);
  const candles = parseCandles(result);
  if (candles) return candles;
  const ticks = parseTicks(result);
  if (ticks?.length) return aggregateTicks(ticks, seconds);
  throw new Error('Deriv returned no chart history');
}

export default function FinancialChart({ symbol, liveTick, requestHistory, instruments, onSelectInstrument, onWidgetReady, onWidgetDestroyed, onInstrumentTap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawRackOpen, setDrawRackOpen] = useState(false);
  const [drawGroup, setDrawGroup] = useState(1);
  const [activeDrawTool, setActiveDrawTool] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [compareQuery, setCompareQuery] = useState('');
  const [comparisons, setComparisons] = useState<string[]>([]);
  const [replayActive, setReplayActive] = useState(false);
  const [replayState, setReplayState] = useState<{ index:number; total:number; playing:boolean; speed:number; bar:Candle|null } | null>(null);
  const [rendererKind, setRendererKind] = useState<'canvas2d' | 'webgl2'>('canvas2d');
  const [tpoEnabled, setTpoEnabled] = useState(false);
  const [swipeInstrumentIndex, setSwipeInstrumentIndex] = useState(() => Math.max(0, instruments.findIndex(item => item.symbol === symbol)));
  const swipeStartYRef = useRef<number | null>(null);
  const swipeAccumulatedRef = useRef(0);
  const swipeAnimatingRef = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const [swipeAnimation, setSwipeAnimation] = useState<'up' | 'down' | null>(null);
  const replayRef = useRef<ReplayController | null>(null);
  const availableDrawTools = useMemo(() => new Set(['__cursor__', ...registeredDrawingTools().map(tool => tool.id)]), []);
  const universalIcons = useMemo(() => ({
    cursor: MousePointer2, 'trend-line': Slash, ray: MoveUpRight, 'extended-line': ArrowUpRight,
    'horizontal-line': Minus, 'horizontal-ray': ArrowRight, 'vertical-line': ArrowUp, 'cross-line': Crosshair,
    arrow: ArrowUpRight, 'parallel-channel': GitBranch, 'fib-retracement': Waves, 'fib-extension': Waves,
    'fib-channel': Waves, 'fib-time-zone': Waves, 'fib-fan': GitBranch, 'gann-fan': GitBranch, 'gann-box': RectangleHorizontal,
    'cyclic-lines': Circle, 'time-cycles': Circle, 'sine-line': Waves, path: Pencil, polyline: Pencil,
    triangle: Shapes, 'rotated-rectangle': RectangleHorizontal, 'double-curve': Waves, forecast: ArrowUpRight,
    'price-range': Ruler, 'date-range': Ruler, measure: Ruler, 'long-position': ArrowUp, 'short-position': ArrowDown,
    rectangle: RectangleHorizontal, ellipse: Circle, circle: Circle, arc: Circle, curve: Waves,
    highlighter: Highlighter, brush: Pencil, text: Type, note: TextCursorInput, 'price-note': TextCursorInput,
    callout: TextCursorInput, comment: TextCursorInput, balloon: TextCursorInput, signpost: Target, table: Table2,
    'price-label': TextCursorInput, 'flag-mark': Target, 'arrow-up': ArrowUp, 'arrow-down': ArrowDown,
    'arrow-left': ArrowLeft, 'arrow-right': ArrowRight,
  } as Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }> >), []);
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
    const host = containerRef.current;
    if (!host) return;
    const onDrawButton = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLElement>('[data-mobile-action="draw"]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      setDrawRackOpen(open => !open);
    };
    host.addEventListener('click', onDrawButton, true);
    return () => host.removeEventListener('click', onDrawButton, true);
  }, []);

  useEffect(() => {
    if (!drawRackOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawRackOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [drawRackOpen]);

  useEffect(() => {
    if (!drawRackOpen) return;
    const host = containerRef.current;
    if (!host) return;
    const onToolEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ tool?: string | null }>).detail;
      setActiveDrawTool(detail?.tool ?? null);
    };
    const off = host.addEventListener('draw:tool', onToolEvent as EventListener);
    return () => host.removeEventListener('draw:tool', onToolEvent as EventListener);
  }, [drawRackOpen]);

  useEffect(() => {
    if (!containerRef.current) return;
    const host = containerRef.current;
    const sourceFeed = {
      async getBars(req: BarsRequest) {
        const bars = await requestBars(req, requestHistoryRef.current);
        candlesRef.current = bars;
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
      lookbackBars: 1000,
      navigation: { mousePan: 'both', defaultVisibleBars: 120 },
      animZoom: true,
      animAutoscale: true,
      branding: false,
      rail: true,
      topbar: false,
      statusline: true,
      indicators: true,
      mobile: 'auto',
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
    onWidgetReady?.(widget);
    const offSymbol = widget.on('symbol', (event: { symbol: string }) => {
      const instrument = instrumentsRef.current.find(item => item.symbol === event.symbol);
      if (instrument && instrument.symbol !== symbolRef.current) onSelectInstrumentRef.current(instrument);
    });
    const offData = widget.on('data', (event: { bars?: Candle[] }) => {
      if (Array.isArray(event.bars)) {
        candlesRef.current = event.bars;
        window.setTimeout(refreshTpoProfile, 0);
      }
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
      offData?.();
      offRenderer?.();
      tpoUnregisterRef.current?.();
      tpoUnregisterRef.current = null;
      tpoProfileRef.current = null;
      subscriberRef.current = null;
      onWidgetDestroyed?.(widget);
      replayRef.current?.stop();
      replayRef.current = null;
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
    const widget = widgetRef.current;
    if (widget && widget.symbol() !== symbol) widget.setSymbol(symbol, 'Deriv Synthetic Indices');
  }, [symbol]);

  useEffect(() => {
    const tick = liveTick;
    if (!tick || tick.symbol !== symbol || !Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) return;
    latestTickRef.current = tick;
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
    else { candlesRef.current.push(bar); if (candlesRef.current.length > 1500) candlesRef.current.shift(); }
    subscriberRef.current?.(bar);
  }, [liveTick, symbol]);

  const startReplay = () => {
    const widget = widgetRef.current;
    const bars = candlesRef.current;
    if (!widget || bars.length < 10) return;
    widget.dataController?.setPaused?.(true);
    replayRef.current?.stop();
    const replay = new ReplayController(widget.chart, { series: widget.series, bars, startIndex: Math.max(1, bars.length - Math.min(200, bars.length - 1)), barMs: 500 });
    replayRef.current = replay;
    setReplayActive(true);
    setReplayState(replay.state() as typeof replayState);
    const render = (state: unknown) => setReplayState(state as typeof replayState);
    widget.chart.on('replay:frame', render);
    widget.chart.on('replay:play', render);
    widget.chart.on('replay:pause', render);
    widget.chart.on('replay:end', render);
    widget.chart.on('replay:stop', () => {
      widget.dataController?.setPaused?.(false);
      setReplayActive(false);
      setReplayState(null);
    });
  };
  const stopReplay = () => {
    replayRef.current?.stop();
    replayRef.current = null;
    widgetRef.current?.dataController?.setPaused?.(false);
    setReplayActive(false);
    setReplayState(null);
  };
  const exportChartSvg = () => { const widget = widgetRef.current; if (!widget) return; const svg = widget.chart.exportSVG({ background: true }); const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sire-${widget.symbol()}-${widget.interval()}.svg`; anchor.click(); URL.revokeObjectURL(url); };
  const toggleReplay = () => { if (!replayRef.current) startReplay(); else if (replayRef.current.state().playing) replayRef.current.pause(); else replayRef.current.play({ speed: replayRef.current.state().speed }); };
  const addCompare = async (compareSymbol: string) => {
    const widget = widgetRef.current;
    if (!widget || !compareSymbol || compareSymbol === symbol || comparisons.includes(compareSymbol)) return;
    const bars = await requestBars({ symbol: compareSymbol, interval: widget.interval() }, requestHistoryRef.current);
    addComparison(widget.chart, { symbol: compareSymbol, bars });
    comparisonController(widget.chart).setMode('percentage');
    setComparisons(current => [...current, compareSymbol]);
  };
  const removeCompare = (compareSymbol: string) => {
    const widget = widgetRef.current;
    if (!widget) return;
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

  const visibleGroups = useMemo(() => {
    const registered = registeredDrawingTools();
    const groups = DRAW_RACK_GROUPS.map(group => ({ ...group, tools: group.tools.filter(id => availableDrawTools.has(id)) })).filter(group => group.tools.length > 0);
    const grouped = new Set(groups.flatMap(group => group.tools));
    const remaining = registered.map(tool => tool.id).filter(id => !grouped.has(id));
    if (remaining.length) groups.push({ label: 'All other OpenAlgo tools', tools: remaining });
    return groups;
  }, [availableDrawTools]);

  const currentGroup = visibleGroups[Math.min(drawGroup, Math.max(visibleGroups.length - 1, 0))] ?? visibleGroups[0];

  return (
    <div ref={containerRef} className={`sire-financial-chart${drawRackOpen ? ' sire-draw-rack-open' : ''}`}>
      <div className="sire-advanced-tools">
        <button type="button" onClick={() => setAdvancedOpen(open => !open)} aria-label="Advanced chart tools">Tools</button>
        {advancedOpen && <div className="sire-advanced-tools__panel">
          <div className="sire-advanced-tools__status">Renderer: {rendererKind === 'webgl2' ? 'WebGL2' : 'Canvas2D'} · OpenAlgo 2.3.2</div>
          <button type="button" onClick={toggleReplay}>{replayState?.playing ? 'Pause replay' : replayActive ? 'Play replay' : 'Chart replay'}</button>
          <button type="button" onClick={exportChartSvg}>Export SVG</button>
          <button type="button" onClick={() => widgetRef.current?.chart.downloadScreenshot(`sire-${symbol}-${widgetRef.current?.interval() || 'chart'}.png`)}>Capture PNG</button>
          <button type="button" onClick={() => widgetRef.current?.chart.fitContent()}>Fit history</button>
          <button type="button" onClick={() => widgetRef.current?.chart.resetScale()}>Reset view</button>
          <button type="button" onClick={() => widgetRef.current?.openSettings()}>Chart settings</button>
          <button type="button" onClick={() => widgetRef.current?.openIndicatorPicker()}>Indicators</button>
          <button type="button" onClick={() => widgetRef.current?.openObjects()}>Objects</button>
          <button type="button" onClick={toggleTpo}>{tpoEnabled ? 'Hide TPO Profile' : 'Market Profile (TPO)'}</button>
          {replayActive && <><button type="button" onClick={() => replayRef.current?.stepBack()}>Step back</button><button type="button" onClick={() => replayRef.current?.step()}>Step</button><button type="button" onClick={stopReplay}>Exit replay</button></>}
          <div className="sire-advanced-tools__compare"><input value={compareQuery} onChange={event => setCompareQuery(event.target.value)} placeholder="Compare Synthetic Index" /><button type="button" onClick={() => { void addCompare(compareQuery.trim()); setCompareQuery(''); }}>Add</button></div>
          {comparisons.map(item => <button key={item} type="button" onClick={() => removeCompare(item)}>Remove {item}</button>)}
        </div>}
      </div>
      {drawRackOpen && (
        <div className="sire-draw-rack" role="dialog" aria-label="Drawing tools">
          <div className="sire-draw-rack__rail">
            <button className="sire-draw-rack__close" type="button" aria-label="Close drawing tools" onClick={() => setDrawRackOpen(false)}>×</button>
            {visibleGroups.map((group, index) => (
              <button
                key={group.label}
                type="button"
                className={`sire-draw-rack__group${index === drawGroup ? ' is-active' : ''}`}
                onClick={() => setDrawGroup(index)}
                title={group.label}
                aria-label={group.label}
              >
                <span className="sire-draw-rack__group-icon">
                  {(() => {
                    const Icon = universalIcons[group.tools[0]] ?? MousePointer2;
                    return <Icon size={21} strokeWidth={1.8} />;
                  })()}
                </span>
                <span className="sire-draw-rack__group-label">{group.label}</span>
              </button>
            ))}
          </div>
          {currentGroup && (
            <div className="sire-draw-rack__panel">
              <div className="sire-draw-rack__panel-head">
                <strong>{currentGroup.label}</strong>
                <button type="button" onClick={() => setDrawRackOpen(false)} aria-label="Close">×</button>
              </div>
              <div className="sire-draw-rack__tools">
                {currentGroup.tools.map(toolId => {
                  if (toolId === '__cursor__') {
                    return (
                      <button
                        key="cursor"
                        type="button"
                        className={`sire-draw-rack__tool${activeDrawTool === null ? ' is-active' : ''}`}
                        title="Cursor"
                        onClick={() => {
                          widgetRef.current?.draw.setTool(null);
                          setActiveDrawTool(null);
                        }}
                      >
                        <span className="sire-draw-rack__tool-icon"><MousePointer2 size={24} strokeWidth={1.8} /></span>
                        <span>Cursor</span>
                      </button>
                    );
                  }
                  const tool = registeredDrawingTools().find(item => item.id === toolId);
                  if (!tool) return null;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      className={`sire-draw-rack__tool${activeDrawTool === tool.id ? ' is-active' : ''}`}
                      title={tool.name}
                      onClick={() => {
                        widgetRef.current?.draw.setTool(tool.id);
                        setActiveDrawTool(tool.id);
                      }}
                    >
                      <span className="sire-draw-rack__tool-icon">{(() => { const Icon = universalIcons[tool.id] ?? MousePointer2; return <Icon size={23} strokeWidth={1.8} />; })()}</span>
                      <span>{tool.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="sire-bottom-glass-bar">
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
      </div>
    </div>
  );
}
