import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  DrawingManager,
  InteractionHandler,
  getToolRegistry,
  type Anchor,
  type DrawingToolDefinition,
  type IDrawing,
  type SerializedDrawing,
} from 'lightweight-charts-drawing';
import './financialChart.css';

type Tick = { symbol: string; quote: number; epoch: number };
type HistoryResponse = Record<string, unknown>;
type HistoryRequester = (request: Record<string, unknown>) => Promise<HistoryResponse>;
type Props = { symbol: string; liveTick: Tick | null; requestHistory: HistoryRequester };
type Candle = { time: UTCTimestamp; open: number; high: number; low: number; close: number };

type DrawingGroup = { key: string; label: string; tools: DrawingToolDefinition[] };

const PERIODS = [
  { label: '1m', seconds: 60 }, { label: '2m', seconds: 120 }, { label: '3m', seconds: 180 }, { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 }, { label: '15m', seconds: 900 }, { label: '20m', seconds: 1200 }, { label: '30m', seconds: 1800 },
  { label: '45m', seconds: 2700 }, { label: '1H', seconds: 3600 }, { label: '2H', seconds: 7200 }, { label: '3H', seconds: 10800 },
  { label: '4H', seconds: 14400 }, { label: '6H', seconds: 21600 }, { label: '8H', seconds: 28800 }, { label: '12H', seconds: 43200 },
  { label: '1D', seconds: 86400 }, { label: '2D', seconds: 172800 }, { label: '3D', seconds: 259200 }, { label: '1W', seconds: 604800 },
  { label: '1M', seconds: 2592000 },
];

const CATEGORY_LABELS: Record<string, string> = {
  line: 'Lines', shape: 'Shapes', channel: 'Channels', fibonacci: 'Fibonacci', pitchfork: 'Pitchforks', gann: 'Gann',
  forecasting: 'Forecast', annotation: 'Annotations', measurement: 'Measurement',
};

const registry = getToolRegistry();
const DRAWING_GROUPS: DrawingGroup[] = registry.getCategories().map(category => ({
  key: category,
  label: CATEGORY_LABELS[category] ?? category,
  tools: registry.getByCategory(category),
}));

function aggregate(ticks: Tick[], seconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const tick of ticks) {
    if (!Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) continue;
    const bucket = Math.floor(tick.epoch / seconds) * seconds;
    const current = buckets.get(bucket);
    if (!current) buckets.set(bucket, { time: bucket as UTCTimestamp, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote });
    else { current.high = Math.max(current.high, tick.quote); current.low = Math.min(current.low, tick.quote); current.close = tick.quote; }
  }
  return [...buckets.values()].sort((a, b) => Number(a.time) - Number(b.time));
}

function parseHistory(data: HistoryResponse, symbol: string): Tick[] | null {
  const history = data.history as Record<string, unknown> | undefined;
  const prices = Array.isArray(history?.prices) ? history.prices : [];
  const times = Array.isArray(history?.times) ? history.times : [];
  if (!prices.length || !times.length) return null;
  return prices.map((price, index) => ({ symbol, quote: Number(price), epoch: Number(times[index]) }))
    .filter(tick => Number.isFinite(tick.quote) && Number.isFinite(tick.epoch));
}

function parseCandles(data: HistoryResponse): Candle[] | null {
  if (!Array.isArray(data.candles)) return null;
  const candles = data.candles.map((item: unknown) => {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    return { time: Number(raw.epoch) as UTCTimestamp, open: Number(raw.open), high: Number(raw.high), low: Number(raw.low), close: Number(raw.close) };
  }).filter((candle): candle is Candle => Boolean(candle) && Number.isFinite(Number(candle.time)) && Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close));
  return candles.length ? candles.sort((a, b) => Number(a.time) - Number(b.time)) : null;
}

async function loadHistory(symbol: string, seconds: number, request: HistoryRequester): Promise<Candle[]> {
  const result = await request({ ticks_history: symbol, end: 'latest', count: 1500, style: 'candles', granularity: seconds });
  const directCandles = parseCandles(result);
  if (directCandles) return directCandles;
  const ticks = parseHistory(result, symbol);
  if (ticks?.length) return aggregate(ticks, seconds);
  throw new Error('Deriv returned no chart history');
}

function drawingStyle(tool: DrawingToolDefinition) {
  return { lineColor: tool.defaultStyle?.lineColor ?? '#60a5fa', lineWidth: tool.defaultStyle?.lineWidth ?? 2, fillColor: tool.defaultStyle?.fillColor ?? 'rgba(96,165,250,.10)', labelColor: tool.defaultStyle?.labelColor ?? '#60a5fa', showLabels: tool.defaultStyle?.showLabels ?? true };
}

export default function FinancialChart({ symbol, liveTick, requestHistory }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const managerRef = useRef<DrawingManager | null>(null);
  const interactionRef = useRef<InteractionHandler | null>(null);
  const previewRef = useRef<IDrawing | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const selectedPeriod = useRef(60);
  const requestGeneration = useRef(0);
  const historyLoadingRef = useRef(false);
  const latestTickRef = useRef<Tick | null>(null);
  const symbolRef = useRef(symbol);
  const previousSymbolRef = useRef(symbol);
  const drawingIdRef = useRef(0);
  const activeToolRef = useRef<string | null>(null);
  const [period, setPeriod] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drawingGroup, setDrawingGroup] = useState(DRAWING_GROUPS[0]?.key ?? 'line');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [drawingCount, setDrawingCount] = useState(0);

  const countDrawings = () => managerRef.current?.getAllDrawings().filter(drawing => drawing.id !== '__sire_preview__').length ?? 0;

  const saveDrawings = () => {
    const manager = managerRef.current;
    if (!manager || typeof window === 'undefined') return;
    try {
      const drawings = manager.exportDrawings().filter(drawing => drawing.id !== '__sire_preview__');
      window.localStorage.setItem(`sire:drawings:${symbolRef.current}`, JSON.stringify(drawings));
      setDrawingCount(drawings.length);
    } catch { /* Persistence must never interrupt chart interaction. */ }
  };

  const loadDrawings = (targetSymbol: string) => {
    const manager = managerRef.current;
    if (!manager || typeof window === 'undefined') return;
    manager.clearAll();
    try {
      const raw = window.localStorage.getItem(`sire:drawings:${targetSymbol}`);
      if (!raw) { setDrawingCount(0); return; }
      const data = JSON.parse(raw) as SerializedDrawing[];
      manager.importDrawings(data, (type, serialized) => registry.createDrawing(type, serialized.id, serialized.anchors, serialized.style, serialized.options));
      setDrawingCount(countDrawings());
    } catch { setDrawingCount(0); }
  };

  const resetViewport = () => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    series.priceScale().applyOptions({ autoScale: true });
    chart.timeScale().fitContent();
  };

  const updateWithTick = (tick: Tick, seconds: number) => {
    const series = seriesRef.current;
    if (!series || tick.symbol !== symbolRef.current || !Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) return;
    const bucket = Math.floor(tick.epoch / seconds) * seconds as UTCTimestamp;
    const last = candlesRef.current[candlesRef.current.length - 1];
    const next: Candle = last && last.time === bucket ? { ...last, high: Math.max(last.high, tick.quote), low: Math.min(last.low, tick.quote), close: tick.quote } : { time: bucket, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote };
    if (last && last.time === bucket) candlesRef.current[candlesRef.current.length - 1] = next; else candlesRef.current.push(next);
    if (candlesRef.current.length > 1500) candlesRef.current.shift();
    series.update(next);
  };

  const chartAnchorFromPoint = (x: number, y: number): Anchor | null => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return null;
    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time === null || price === null || !Number.isFinite(price)) return null;
    return { time, price };
  };

  const removePreview = () => {
    const manager = managerRef.current;
    if (manager && previewRef.current) manager.removeDrawing(previewRef.current.id);
    previewRef.current = null;
  };

  const updatePreview = (handler: InteractionHandler, previewAnchor?: Anchor) => {
    const manager = managerRef.current;
    const toolType = handler.getAnchors().length ? activeToolRef.current : null;
    if (!manager || !toolType) return;
    const definition = registry.get(toolType);
    if (!definition) return;
    const anchors = handler.getAnchors();
    const preview = handler.getPreviewAnchor() ?? previewAnchor;
    if (!preview) return;
    const previewAnchors = [...anchors];
    while (previewAnchors.length < definition.requiredAnchors) previewAnchors.push({ ...preview });
    removePreview();
    const drawing = registry.createDrawing(toolType, '__sire_preview__', previewAnchors, drawingStyle(definition), definition.defaultOptions);
    if (drawing) { previewRef.current = drawing; manager.addDrawing(drawing); }
  };

  const cancelActiveTool = () => {
    interactionRef.current?.onKeyDown('Escape');
    interactionRef.current = null;
    removePreview();
    managerRef.current?.setActiveTool(null);
    activeToolRef.current = null;
    setActiveTool(null);
  };

  const startTool = (type: string) => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const manager = managerRef.current;
    const definition = registry.get(type);
    if (!chart || !series || !manager || !definition) return;
    cancelActiveTool();
    manager.deselectAll();
    manager.setActiveTool(type);
    activeToolRef.current = type;
    setActiveTool(type);
    let handler: InteractionHandler;
    handler = new InteractionHandler({
      requiredAnchors: definition.requiredAnchors,
      pixelToChart: point => chartAnchorFromPoint(point.x, point.y),
      onAnchorAdded: anchor => updatePreview(handler, anchor),
      onPreviewMove: anchor => updatePreview(handler, anchor),
      onComplete: () => {
        const anchors = handler.getAnchors();
        removePreview();
        const id = `sire-drawing-${Date.now()}-${++drawingIdRef.current}`;
        const drawing = registry.createDrawing(type, id, anchors, drawingStyle(definition), definition.defaultOptions);
        if (drawing) { manager.addDrawing(drawing); manager.selectDrawing(id); }
        handler.reset(); interactionRef.current = null; manager.setActiveTool(null); activeToolRef.current = null; setActiveTool(null); setDrawingCount(countDrawings()); saveDrawings();
      },
      onCancel: () => { removePreview(); interactionRef.current = null; manager.setActiveTool(null); activeToolRef.current = null; setActiveTool(null); },
    });
    interactionRef.current = handler;
  };

  const handlePlacementEvent = (event: MouseEvent) => {
    const handler = interactionRef.current;
    const container = containerRef.current;
    if (!handler || !container || handler.getState() !== 'placing') return;
    const rect = container.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const anchor = chartAnchorFromPoint(point.x, point.y);
    handler.onMouseDown({ point, time: anchor?.time ?? null, price: anchor?.price ?? null, srcEvent: event });
  };

  const handlePlacementMove = (event: MouseEvent) => {
    const handler = interactionRef.current;
    const container = containerRef.current;
    if (!handler || !container || handler.getState() !== 'placing') return;
    const rect = container.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const anchor = chartAnchorFromPoint(point.x, point.y);
    handler.onMouseMove({ point, time: anchor?.time ?? null, price: anchor?.price ?? null, srcEvent: event });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#090d12' }, textColor: '#8995a5', attributionLogo: true },
      grid: { vertLines: { color: 'rgba(120,135,150,.08)' }, horzLines: { color: 'rgba(120,135,150,.08)' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(150,165,180,.35)' }, horzLine: { color: 'rgba(150,165,180,.35)' } },
      rightPriceScale: { borderColor: 'rgba(120,135,150,.18)', autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: 'rgba(120,135,150,.18)', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7, fixLeftEdge: false, fixRightEdge: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true },
      kineticScroll: { mouse: true, touch: true },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: '#22c55e', downColor: '#ef4444', borderUpColor: '#22c55e', borderDownColor: '#ef4444', wickUpColor: '#22c55e', wickDownColor: '#ef4444', priceLineVisible: true, lastValueVisible: true });
    const manager = new DrawingManager();
    manager.attach(chart, series, container);
    // DrawingManager is an overlay/primitive manager; explicitly re-assert the
    // chart's native navigation settings after attaching it so drawing interaction
    // cannot accidentally change the host chart's scroll/scale behavior.
    chart.applyOptions({
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true },
      kineticScroll: { mouse: true, touch: true },
    });
    series.priceScale().applyOptions({ autoScale: true });
    chartRef.current = chart; seriesRef.current = series; managerRef.current = manager;

    const handleDrawingEvent = (event: { drawingId?: string }) => {
      if (event.drawingId === '__sire_preview__') return;
      setDrawingCount(countDrawings());
      if (event.drawingId && !event.drawingId.startsWith('__sire_preview__')) saveDrawings();
    };
    const unsubAdded = manager.on('drawing:added', handleDrawingEvent);
    const unsubRemoved = manager.on('drawing:removed', handleDrawingEvent);
    const unsubUpdated = manager.on('drawing:updated', handleDrawingEvent);
    container.addEventListener('click', handlePlacementEvent);
    container.addEventListener('mousemove', handlePlacementMove);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelActiveTool();
      if ((event.key === 'Delete' || event.key === 'Backspace') && !interactionRef.current) {
        const selected = manager.getSelectedDrawing();
        if (selected) { manager.removeDrawing(selected.id); saveDrawings(); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    loadDrawings(symbolRef.current);
    return () => {
      unsubAdded(); unsubRemoved(); unsubUpdated(); container.removeEventListener('click', handlePlacementEvent); container.removeEventListener('mousemove', handlePlacementMove); window.removeEventListener('keydown', handleKeyDown);
      interactionRef.current = null; previewRef.current = null; manager.detach(); chart.remove(); managerRef.current = null; chartRef.current = null; seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    symbolRef.current = symbol;
    if (previousSymbolRef.current === symbol) return;
    previousSymbolRef.current = symbol; cancelActiveTool(); loadDrawings(symbol);
  }, [symbol]);

  const fetchHistory = (nextPeriod: number) => {
    const generation = ++requestGeneration.current;
    if (!symbol || !seriesRef.current) return;
    historyLoadingRef.current = true; setLoading(true); setError('');
    loadHistory(symbol, nextPeriod, requestHistory).then(candles => {
      if (generation !== requestGeneration.current || !seriesRef.current) return;
      candlesRef.current = candles;
      seriesRef.current.setData(candles);
      resetViewport();
      const pendingTick = latestTickRef.current;
      if (pendingTick && pendingTick.symbol === symbol) updateWithTick(pendingTick, nextPeriod);
    }).catch(reason => {
      if (generation === requestGeneration.current) setError(reason instanceof Error ? reason.message : 'Unable to load chart history from Deriv');
    }).finally(() => {
      if (generation === requestGeneration.current) { historyLoadingRef.current = false; setLoading(false); }
    });
  };

  useEffect(() => { fetchHistory(selectedPeriod.current); return () => { requestGeneration.current += 1; historyLoadingRef.current = false; }; }, [symbol, requestHistory]);
  useEffect(() => { latestTickRef.current = liveTick; if (!liveTick || liveTick.symbol !== symbol || !seriesRef.current || historyLoadingRef.current) return; updateWithTick(liveTick, selectedPeriod.current); }, [liveTick, symbol]);

  const changePeriod = (seconds: number) => { if (seconds === selectedPeriod.current && !loading) return; selectedPeriod.current = seconds; setPeriod(seconds); cancelActiveTool(); fetchHistory(seconds); };
  const goLive = () => { const chart = chartRef.current; if (!chart) return; chart.priceScale('right').applyOptions({ autoScale: true }); chart.timeScale().scrollToRealtime(); };
  const fitChart = () => resetViewport();
  const currentGroup = DRAWING_GROUPS.find(group => group.key === drawingGroup) ?? DRAWING_GROUPS[0];

  return (
    <div className="sire-financial-chart">
      <div className="sire-chart-controls"><div className="sire-chart-periods" aria-label="Chart timeframe">{PERIODS.map(item => <button key={item.seconds} className={period === item.seconds ? 'active' : ''} onClick={() => changePeriod(item.seconds)} title={`${item.label} timeframe`}>{item.label}</button>)}</div><button onClick={goLive}>LIVE</button><button onClick={fitChart}>FIT</button></div>
      <div className="sire-drawing-toolbar" aria-label="Drawing tools"><div className="sire-drawing-groups">{DRAWING_GROUPS.map(group => <button key={group.key} className={drawingGroup === group.key ? 'active' : ''} onClick={() => { cancelActiveTool(); setDrawingGroup(group.key); }} title={`${group.label} tools`}>{group.label}</button>)}</div><div className="sire-drawing-tools" aria-label={`${currentGroup?.label ?? 'Drawing'} tools`}>{currentGroup?.tools.map(tool => <button key={tool.type} className={activeTool === tool.type ? 'active' : ''} onClick={() => startTool(tool.type)} title={tool.label}>{tool.label}</button>)}</div><div className="sire-drawing-active">{activeTool ? `Placing: ${activeTool}` : 'Select a tool'}</div><div className="sire-drawing-count">{drawingCount} drawings</div></div>
      {loading && <div className="sire-chart-status">Loading {symbol}…</div>}
      {error && <div className="sire-chart-status error">{error}</div>}
      <div ref={containerRef} className="sire-chart-canvas" aria-label={`${symbol} price chart`} />
    </div>
  );
}
