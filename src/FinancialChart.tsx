import { useEffect, useMemo, useRef, useState } from 'react';
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
  getToolRegistry,
  type Anchor,
  type IDrawing,
} from 'lightweight-charts-drawing';
import './financialChart.css';

type Tick = { symbol: string; quote: number; epoch: number };
type HistoryResponse = Record<string, unknown>;
type HistoryRequester = (request: Record<string, unknown>) => Promise<HistoryResponse>;
type Props = { symbol: string; liveTick: Tick | null; requestHistory: HistoryRequester };
type Candle = { time: UTCTimestamp; open: number; high: number; low: number; close: number };

const PERIODS = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1H', seconds: 3600 },
];

const DRAWING_CATEGORIES = [
  { key: 'line', label: 'Lines' },
  { key: 'channel', label: 'Channels' },
  { key: 'fibonacci', label: 'Fibonacci' },
  { key: 'pitchfork', label: 'Pitchforks' },
  { key: 'gann', label: 'Gann' },
  { key: 'forecasting', label: 'Forecast' },
  { key: 'shape', label: 'Shapes' },
  { key: 'annotation', label: 'Annotations' },
] as const;

const registry = getToolRegistry();

function aggregate(ticks: Tick[], seconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const tick of ticks) {
    if (!Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) continue;
    const bucket = Math.floor(tick.epoch / seconds) * seconds;
    const current = buckets.get(bucket);
    if (!current) buckets.set(bucket, { time: bucket as UTCTimestamp, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote });
    else {
      current.high = Math.max(current.high, tick.quote);
      current.low = Math.min(current.low, tick.quote);
      current.close = tick.quote;
    }
  }
  return [...buckets.values()].sort((a, b) => Number(a.time) - Number(b.time));
}

function parseHistory(data: HistoryResponse, symbol: string): Tick[] | null {
  const history = data.history as Record<string, unknown> | undefined;
  const prices = Array.isArray(history?.prices) ? history.prices : [];
  const times = Array.isArray(history?.times) ? history.times : [];
  if (!prices.length || !times.length) return null;
  return prices.map((price, index) => ({ symbol, quote: Number(price), epoch: Number(times[index]) })).filter(tick => Number.isFinite(tick.quote) && Number.isFinite(tick.epoch));
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

async function loadHistory(symbol: string, seconds: number, request: HistoryRequester): Promise<{ candles: Candle[]; ticks: Tick[] }> {
  const result = await request({ ticks_history: symbol, end: 'latest', count: 1500, style: 'candles', granularity: seconds });
  const directCandles = parseCandles(result);
  if (directCandles) return { candles: directCandles, ticks: [] };
  const ticks = parseHistory(result, symbol);
  if (ticks?.length) return { candles: aggregate(ticks, seconds), ticks };
  throw new Error('Deriv returned no chart history');
}

export default function FinancialChart({ symbol, liveTick, requestHistory }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const drawingManagerRef = useRef<DrawingManager | null>(null);
  const previewDrawingRef = useRef<IDrawing | null>(null);
  const pendingAnchorsRef = useRef<Anchor[]>([]);
  const drawingIdCounterRef = useRef(0);
  const candlesRef = useRef<Candle[]>([]);
  const selectedPeriod = useRef(60);
  const requestGeneration = useRef(0);
  const historyLoadingRef = useRef(false);
  const latestTickRef = useRef<Tick | null>(null);
  const previousSymbolRef = useRef(symbol);
  const activeToolRef = useRef<string | null>(null);
  const symbolRef = useRef(symbol);
  const [period, setPeriod] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drawingCategory, setDrawingCategory] = useState('line');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [drawingCount, setDrawingCount] = useState(0);

  const toolsByCategory = useMemo(() => {
    const map = new Map<string, { type: string; name: string; requiredAnchors: number }[]>();
    for (const definition of registry.getAll()) {
      const list = map.get(definition.category) ?? [];
      list.push({ type: definition.type, name: definition.name, requiredAnchors: definition.requiredAnchors });
      map.set(definition.category, list);
    }
    return map;
  }, []);

  const resetViewport = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale('right').applyOptions({ autoScale: true });
    chart.timeScale().fitContent();
  };

  const updateWithTick = (tick: Tick, seconds: number) => {
    const series = seriesRef.current;
    if (!series || tick.symbol !== symbol || !Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) return;
    const bucket = Math.floor(tick.epoch / seconds) * seconds as UTCTimestamp;
    const last = candlesRef.current[candlesRef.current.length - 1];
    const next: Candle = last && last.time === bucket
      ? { ...last, high: Math.max(last.high, tick.quote), low: Math.min(last.low, tick.quote), close: tick.quote }
      : { time: bucket, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote };
    if (last && last.time === bucket) candlesRef.current[candlesRef.current.length - 1] = next;
    else candlesRef.current.push(next);
    if (candlesRef.current.length > 1500) candlesRef.current.shift();
    series.update(next);

    const y = series.priceToCoordinate(next.close);
    const height = containerRef.current?.clientHeight ?? 0;
    if (y == null || y < -20 || (height > 0 && y > height + 20)) {
      chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
    }
  };

  const saveDrawings = () => {
    const manager = drawingManagerRef.current;
    if (!manager || typeof window === 'undefined') return;
    const drawings = manager.exportDrawings().filter(drawing => drawing.id !== '__sire_preview__');
    window.localStorage.setItem(`sire:drawings:${symbolRef.current}`, JSON.stringify(drawings));
    setDrawingCount(drawings.length);
  };

  const loadDrawings = () => {
    const manager = drawingManagerRef.current;
    if (!manager || typeof window === 'undefined') return;
    manager.clearAll();
    pendingAnchorsRef.current = [];
    previewDrawingRef.current = null;
    try {
      const raw = window.localStorage.getItem(`sire:drawings:${symbolRef.current}`);
      if (!raw) {
        setDrawingCount(0);
        return;
      }
      const data = JSON.parse(raw) as Array<{ id: string; type: string; anchors: Anchor[]; style: unknown; options: unknown }>;
      for (const item of data) {
        const drawing = registry.createDrawing(item.type, item.id, item.anchors, item.style as any, item.options as any);
        if (drawing) manager.addDrawing(drawing);
      }
      setDrawingCount(manager.getAllDrawings().length);
    } catch {
      setDrawingCount(0);
    }
  };

  const cancelDrawing = () => {
    const manager = drawingManagerRef.current;
    if (previewDrawingRef.current && manager) {
      manager.removeDrawing(previewDrawingRef.current.id);
      previewDrawingRef.current = null;
    }
    pendingAnchorsRef.current = [];
    if (manager) manager.setActiveTool(null);
    activeToolRef.current = null;
    setActiveTool(null);
  };

  const createPreview = (toolType: string, mouseAnchor: Anchor) => {
    const manager = drawingManagerRef.current;
    if (!manager) return;
    const definition = registry.get(toolType);
    if (!definition) return;
    const previewAnchors = [...pendingAnchorsRef.current];
    while (previewAnchors.length < definition.requiredAnchors) previewAnchors.push({ ...mouseAnchor });
    if (previewDrawingRef.current) manager.removeDrawing(previewDrawingRef.current.id);
    const preview = registry.createDrawing(toolType, '__sire_preview__', previewAnchors, {
      lineColor: '#60a5fa',
      lineWidth: 2,
      fillColor: 'rgba(96,165,250,.12)',
    });
    if (!preview) return;
    previewDrawingRef.current = preview;
    manager.addDrawing(preview);
  };

  const selectDrawingTool = (toolType: string) => {
    const manager = drawingManagerRef.current;
    if (!manager || !registry.has(toolType)) return;
    if (activeToolRef.current === toolType) {
      cancelDrawing();
      return;
    }
    if (previewDrawingRef.current) manager.removeDrawing(previewDrawingRef.current.id);
    pendingAnchorsRef.current = [];
    previewDrawingRef.current = null;
    manager.deselectAll();
    manager.setActiveTool(toolType);
    activeToolRef.current = toolType;
    setActiveTool(toolType);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#090d12' }, textColor: '#8995a5', attributionLogo: true },
      grid: { vertLines: { color: 'rgba(120,135,150,.08)' }, horzLines: { color: 'rgba(120,135,150,.08)' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(150,165,180,.35)' }, horzLine: { color: 'rgba(150,165,180,.35)' } },
      rightPriceScale: { borderColor: 'rgba(120,135,150,.18)', autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: 'rgba(120,135,150,.18)', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: '#22c55e', downColor: '#ef4444', borderUpColor: '#22c55e', borderDownColor: '#ef4444', wickUpColor: '#22c55e', wickDownColor: '#ef4444', priceLineVisible: true, lastValueVisible: true });
    const manager = new DrawingManager();
    manager.attach(chart, series, containerRef.current);
    drawingManagerRef.current = manager;
    chartRef.current = chart;
    seriesRef.current = series;

    const handleDrawingClick = (event: MouseEvent) => {
      const toolType = activeToolRef.current;
      if (!toolType || !containerRef.current) return;
      const definition = registry.get(toolType);
      if (!definition) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const time = chart.timeScale().coordinateToTime(x);
      const price = series.coordinateToPrice(y);
      if (time === null || price === null) return;
      const anchor: Anchor = { time, price };
      pendingAnchorsRef.current.push(anchor);
      if (pendingAnchorsRef.current.length >= definition.requiredAnchors) {
        if (previewDrawingRef.current) manager.removeDrawing(previewDrawingRef.current.id);
        previewDrawingRef.current = null;
        const id = `sire-drawing-${Date.now()}-${drawingIdCounterRef.current++}`;
        const drawing = registry.createDrawing(toolType, id, [...pendingAnchorsRef.current], {
          lineColor: '#60a5fa',
          lineWidth: 2,
          fillColor: 'rgba(96,165,250,.12)',
        });
        if (drawing) {
          manager.addDrawing(drawing);
          manager.selectDrawing(drawing.id);
          setDrawingCount(manager.getAllDrawings().filter(item => item.id !== '__sire_preview__').length);
        }
        pendingAnchorsRef.current = [];
        manager.setActiveTool(null);
        activeToolRef.current = null;
        setActiveTool(null);
        saveDrawings();
      } else {
        createPreview(toolType, anchor);
      }
    };

    const handleDrawingMove = (event: MouseEvent) => {
      if (!activeToolRef.current || !pendingAnchorsRef.current.length || !containerRef.current || !previewDrawingRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const time = chart.timeScale().coordinateToTime(x);
      const price = series.coordinateToPrice(y);
      if (time === null || price === null) return;
      previewDrawingRef.current.updateAnchor(pendingAnchorsRef.current.length, { time, price });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelDrawing();
      if ((event.key === 'Delete' || event.key === 'Backspace') && !activeToolRef.current) {
        const selected = manager.getSelectedDrawing();
        if (selected) {
          manager.removeDrawing(selected.id);
          saveDrawings();
          setDrawingCount(manager.getAllDrawings().length);
        }
      }
    };

    containerRef.current.addEventListener('click', handleDrawingClick);
    containerRef.current.addEventListener('mousemove', handleDrawingMove);
    window.addEventListener('keydown', handleKeyDown);
    loadDrawings();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      containerRef.current?.removeEventListener('click', handleDrawingClick);
      containerRef.current?.removeEventListener('mousemove', handleDrawingMove);
      manager.detach();
      chart.remove();
      drawingManagerRef.current = null;
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    symbolRef.current = symbol;
    if (previousSymbolRef.current === symbol) return;
    cancelDrawing();
    previousSymbolRef.current = symbol;
    loadDrawings();
  }, [symbol]);

  const fetchHistory = (nextPeriod: number) => {
    const generation = ++requestGeneration.current;
    if (!symbol || !seriesRef.current) return;
    historyLoadingRef.current = true;
    setLoading(true);
    setError('');
    loadHistory(symbol, nextPeriod, requestHistory).then(({ candles }) => {
      if (generation !== requestGeneration.current || !seriesRef.current) return;
      candlesRef.current = candles;
      seriesRef.current.setData(candles);
      resetViewport();
      const pendingTick = latestTickRef.current;
      if (pendingTick && pendingTick.symbol === symbol) updateWithTick(pendingTick, nextPeriod);
    }).catch(error => {
      if (generation === requestGeneration.current) setError(error instanceof Error ? error.message : 'Unable to load chart history from Deriv');
    }).finally(() => {
      if (generation === requestGeneration.current) {
        historyLoadingRef.current = false;
        setLoading(false);
      }
    });
  };

  useEffect(() => {
    fetchHistory(selectedPeriod.current);
    return () => {
      requestGeneration.current += 1;
      historyLoadingRef.current = false;
    };
  }, [symbol, requestHistory]);

  useEffect(() => {
    latestTickRef.current = liveTick;
    if (!liveTick || liveTick.symbol !== symbol || !seriesRef.current || historyLoadingRef.current) return;
    updateWithTick(liveTick, selectedPeriod.current);
  }, [liveTick, symbol]);

  useEffect(() => {
    const manager = drawingManagerRef.current;
    if (!manager) return;
    const offAdded = manager.on('drawing:added', event => {
      if (event.drawingId !== '__sire_preview__') setDrawingCount(manager.getAllDrawings().filter(drawing => drawing.id !== '__sire_preview__').length);
    });
    const offRemoved = manager.on('drawing:removed', event => {
      if (event.drawingId !== '__sire_preview__') setDrawingCount(manager.getAllDrawings().filter(drawing => drawing.id !== '__sire_preview__').length);
    });
    const offUpdated = manager.on('drawing:updated', () => saveDrawings());
    return () => { offAdded(); offRemoved(); offUpdated(); };
  }, [symbol]);

  const changePeriod = (seconds: number) => {
    if (seconds === selectedPeriod.current && !loading) return;
    selectedPeriod.current = seconds;
    setPeriod(seconds);
    fetchHistory(seconds);
  };

  const fitChart = () => resetViewport();
  const goLive = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale('right').applyOptions({ autoScale: true });
    chart.timeScale().scrollToRealtime();
  };

  const currentTools = toolsByCategory.get(drawingCategory) ?? [];
  const activeToolName = registry.get(activeTool ?? '')?.name;

  return <div className="sire-financial-chart">
    <div className="sire-chart-controls">
      <div className="sire-chart-periods">{PERIODS.map(item => <button key={item.seconds} className={period === item.seconds ? 'active' : ''} onClick={() => changePeriod(item.seconds)}>{item.label}</button>)}</div>
      <button onClick={goLive}>LIVE</button>
      <button onClick={fitChart}>FIT</button>
    </div>
    <div className="sire-drawing-toolbar">
      <button className={activeTool ? 'active' : ''} onClick={() => cancelDrawing()} title="Select / cancel drawing tool">SELECT</button>
      <select value={drawingCategory} onChange={event => setDrawingCategory(event.target.value)} aria-label="Drawing category">
        {DRAWING_CATEGORIES.map(category => <option key={category.key} value={category.key}>{category.label}</option>)}
      </select>
      <select value={activeTool ?? ''} onChange={event => event.target.value ? selectDrawingTool(event.target.value) : cancelDrawing()} aria-label="Drawing tool">
        <option value="">Choose tool…</option>
        {currentTools.map(tool => <option key={tool.type} value={tool.type}>{tool.name}</option>)}
      </select>
      {activeToolName && <span className="sire-drawing-active">{activeToolName} · click {registry.get(activeTool!)?.requiredAnchors ?? 0} point{(registry.get(activeTool!)?.requiredAnchors ?? 0) === 1 ? '' : 's'}</span>}
      <span className="sire-drawing-count">{drawingCount} drawing{drawingCount === 1 ? '' : 's'}</span>
    </div>
    <div ref={containerRef} className="sire-chart-canvas" />
    {loading && <div className="sire-chart-status">Loading market history…</div>}
    {error && <div className="sire-chart-status error">{error}</div>}
  </div>;
}
