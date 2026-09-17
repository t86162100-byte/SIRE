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
import { createLineToolsPlugin } from 'lightweight-charts-line-tools-core';
import {
  LineToolArrow,
  LineToolCallout,
  LineToolCrossLine,
  LineToolExtendedLine,
  LineToolHorizontalLine,
  LineToolHorizontalRay,
  LineToolRay,
  LineToolTrendLine,
  LineToolVerticalLine,
} from 'lightweight-charts-line-tools-lines';
import { LineToolRectangle } from 'lightweight-charts-line-tools-rectangle';
import { LineToolFibRetracement } from 'lightweight-charts-line-tools-fib-retracement';
import { LineToolParallelChannel } from 'lightweight-charts-line-tools-parallel-channel';
import { LineToolPriceRange } from 'lightweight-charts-line-tools-price-range';
import { LineToolText } from 'lightweight-charts-line-tools-text';
import './financialChart.css';

type Tick = { symbol: string; quote: number; epoch: number };
type HistoryResponse = Record<string, unknown>;
type HistoryRequester = (request: Record<string, unknown>) => Promise<HistoryResponse>;
type Props = { symbol: string; liveTick: Tick | null; requestHistory: HistoryRequester };
type Candle = { time: UTCTimestamp; open: number; high: number; low: number; close: number };
type LineToolsApi = ReturnType<typeof createLineToolsPlugin>;

type ToolGroup = {
  key: string;
  label: string;
  tools: { type: string; label: string }[];
};

const PERIODS = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1H', seconds: 3600 },
];

// These are existing Lightweight Charts V5 line-tool plugins. SIRE only registers
// and exposes them; drawing, hit-testing, dragging, snapping and persistence are
// handled by the external line-tools core/plugin packages.
const TOOL_GROUPS: ToolGroup[] = [
  {
    key: 'lines',
    label: 'Lines',
    tools: [
      { type: 'TrendLine', label: 'Trend line' },
      { type: 'Ray', label: 'Ray' },
      { type: 'ExtendedLine', label: 'Extended line' },
      { type: 'HorizontalLine', label: 'Horizontal line' },
      { type: 'HorizontalRay', label: 'Horizontal ray' },
      { type: 'VerticalLine', label: 'Vertical line' },
      { type: 'CrossLine', label: 'Cross line' },
      { type: 'Arrow', label: 'Arrow' },
      { type: 'Callout', label: 'Callout' },
    ],
  },
  {
    key: 'fibonacci',
    label: 'Fibonacci',
    tools: [{ type: 'FibRetracement', label: 'Fib retracement' }],
  },
  {
    key: 'channels',
    label: 'Channels',
    tools: [{ type: 'ParallelChannel', label: 'Parallel channel' }],
  },
  {
    key: 'shapes',
    label: 'Shapes',
    tools: [{ type: 'Rectangle', label: 'Rectangle' }],
  },
  {
    key: 'measurement',
    label: 'Measurement',
    tools: [{ type: 'PriceRange', label: 'Price range' }],
  },
  {
    key: 'annotation',
    label: 'Annotations',
    tools: [{ type: 'Text', label: 'Text' }],
  },
];

function aggregate(ticks: Tick[], seconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const tick of ticks) {
    if (!Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) continue;
    const bucket = Math.floor(tick.epoch / seconds) * seconds;
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, {
        time: bucket as UTCTimestamp,
        open: tick.quote,
        high: tick.quote,
        low: tick.quote,
        close: tick.quote,
      });
    } else {
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
  return prices
    .map((price, index) => ({
      symbol,
      quote: Number(price),
      epoch: Number(times[index]),
    }))
    .filter(tick => Number.isFinite(tick.quote) && Number.isFinite(tick.epoch));
}

function parseCandles(data: HistoryResponse): Candle[] | null {
  if (!Array.isArray(data.candles)) return null;
  const candles = data.candles
    .map((item: unknown) => {
      if (!item || typeof item !== 'object') return null;
      const raw = item as Record<string, unknown>;
      return {
        time: Number(raw.epoch) as UTCTimestamp,
        open: Number(raw.open),
        high: Number(raw.high),
        low: Number(raw.low),
        close: Number(raw.close),
      };
    })
    .filter(
      (candle): candle is Candle =>
        Boolean(candle) &&
        Number.isFinite(Number(candle.time)) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close),
    );
  return candles.length ? candles.sort((a, b) => Number(a.time) - Number(b.time)) : null;
}

async function loadHistory(
  symbol: string,
  seconds: number,
  request: HistoryRequester,
): Promise<Candle[]> {
  const result = await request({
    ticks_history: symbol,
    end: 'latest',
    count: 1500,
    style: 'candles',
    granularity: seconds,
  });
  const directCandles = parseCandles(result);
  if (directCandles) return directCandles;
  const ticks = parseHistory(result, symbol);
  if (ticks?.length) return aggregate(ticks, seconds);
  throw new Error('Deriv returned no chart history');
}

function registerTools(lineTools: LineToolsApi) {
  lineTools.registerLineTool('TrendLine', LineToolTrendLine);
  lineTools.registerLineTool('Ray', LineToolRay);
  lineTools.registerLineTool('ExtendedLine', LineToolExtendedLine);
  lineTools.registerLineTool('HorizontalLine', LineToolHorizontalLine);
  lineTools.registerLineTool('HorizontalRay', LineToolHorizontalRay);
  lineTools.registerLineTool('VerticalLine', LineToolVerticalLine);
  lineTools.registerLineTool('CrossLine', LineToolCrossLine);
  lineTools.registerLineTool('Arrow', LineToolArrow);
  lineTools.registerLineTool('Callout', LineToolCallout);
  lineTools.registerLineTool('FibRetracement', LineToolFibRetracement);
  lineTools.registerLineTool('ParallelChannel', LineToolParallelChannel);
  lineTools.registerLineTool('Rectangle', LineToolRectangle);
  lineTools.registerLineTool('PriceRange', LineToolPriceRange);
  lineTools.registerLineTool('Text', LineToolText);
}

function countSerializedDrawings(lineTools: LineToolsApi): number {
  try {
    const raw = lineTools.exportLineTools();
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

export default function FinancialChart({ symbol, liveTick, requestHistory }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineToolsRef = useRef<LineToolsApi | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const selectedPeriod = useRef(60);
  const requestGeneration = useRef(0);
  const historyLoadingRef = useRef(false);
  const latestTickRef = useRef<Tick | null>(null);
  const symbolRef = useRef(symbol);
  const previousSymbolRef = useRef(symbol);
  const [period, setPeriod] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toolGroup, setToolGroup] = useState('lines');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [drawingCount, setDrawingCount] = useState(0);

  const saveDrawings = () => {
    const lineTools = lineToolsRef.current;
    if (!lineTools || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        `sire:drawings:${symbolRef.current}`,
        lineTools.exportLineTools(),
      );
      setDrawingCount(countSerializedDrawings(lineTools));
    } catch {
      // Local persistence is best-effort; the chart remains fully usable.
    }
  };

  const loadDrawings = (targetSymbol: string) => {
    const lineTools = lineToolsRef.current;
    if (!lineTools || typeof window === 'undefined') return;
    lineTools.removeAllLineTools();
    try {
      const raw = window.localStorage.getItem(`sire:drawings:${targetSymbol}`);
      if (raw) lineTools.importLineTools(raw);
      setDrawingCount(countSerializedDrawings(lineTools));
    } catch {
      setDrawingCount(0);
    }
  };

  const resetViewport = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale('right').applyOptions({ autoScale: true });
    chart.timeScale().fitContent();
  };

  const updateWithTick = (tick: Tick, seconds: number) => {
    const series = seriesRef.current;
    if (
      !series ||
      tick.symbol !== symbolRef.current ||
      !Number.isFinite(tick.quote) ||
      !Number.isFinite(tick.epoch)
    ) return;

    const bucket = Math.floor(tick.epoch / seconds) * seconds as UTCTimestamp;
    const last = candlesRef.current[candlesRef.current.length - 1];
    const next: Candle = last && last.time === bucket
      ? {
          ...last,
          high: Math.max(last.high, tick.quote),
          low: Math.min(last.low, tick.quote),
          close: tick.quote,
        }
      : {
          time: bucket,
          open: tick.quote,
          high: tick.quote,
          low: tick.quote,
          close: tick.quote,
        };

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

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#090d12' },
        textColor: '#8995a5',
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: 'rgba(120,135,150,.08)' },
        horzLines: { color: 'rgba(120,135,150,.08)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(150,165,180,.35)' },
        horzLine: { color: 'rgba(150,165,180,.35)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(120,135,150,.18)',
        autoScale: true,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: 'rgba(120,135,150,.18)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 7,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceLineVisible: true,
      lastValueVisible: true,
    });

    const lineTools = createLineToolsPlugin(chart, series);
    registerTools(lineTools);
    lineToolsRef.current = lineTools;
    chartRef.current = chart;
    seriesRef.current = series;

    const handleAfterEdit = () => {
      setActiveTool(null);
      saveDrawings();
    };
    const handleSingleClick = () => {
      setDrawingCount(countSerializedDrawings(lineTools));
    };

    lineTools.subscribeLineToolsAfterEdit(handleAfterEdit);
    lineTools.subscribeLineToolsSingleClick(handleSingleClick);
    loadDrawings(symbolRef.current);

    return () => {
      lineTools.unsubscribeLineToolsAfterEdit(handleAfterEdit);
      lineTools.unsubscribeLineToolsSingleClick(handleSingleClick);
      lineTools.destroy();
      chart.remove();
      lineToolsRef.current = null;
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    symbolRef.current = symbol;
    if (previousSymbolRef.current === symbol) return;
    previousSymbolRef.current = symbol;
    setActiveTool(null);
    loadDrawings(symbol);
  }, [symbol]);

  const fetchHistory = (nextPeriod: number) => {
    const generation = ++requestGeneration.current;
    if (!symbol || !seriesRef.current) return;

    historyLoadingRef.current = true;
    setLoading(true);
    setError('');

    loadHistory(symbol, nextPeriod, requestHistory)
      .then(candles => {
        if (generation !== requestGeneration.current || !seriesRef.current) return;
        candlesRef.current = candles;
        seriesRef.current.setData(candles);
        resetViewport();
        const pendingTick = latestTickRef.current;
        if (pendingTick && pendingTick.symbol === symbol) updateWithTick(pendingTick, nextPeriod);
      })
      .catch(reason => {
        if (generation === requestGeneration.current) {
          setError(reason instanceof Error ? reason.message : 'Unable to load chart history from Deriv');
        }
      })
      .finally(() => {
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

  const changePeriod = (seconds: number) => {
    if (seconds === selectedPeriod.current && !loading) return;
    selectedPeriod.current = seconds;
    setPeriod(seconds);
    setActiveTool(null);
    fetchHistory(seconds);
  };

  const startTool = (type: string) => {
    const lineTools = lineToolsRef.current;
    if (!lineTools) return;
    setActiveTool(type);
    // The core owns the complete interaction lifecycle: placement, ghosting,
    // snapping, selection and dragging. No SIRE click/drag engine is involved.
    lineTools.addLineTool(type);
  };

  const deleteSelected = () => {
    const lineTools = lineToolsRef.current;
    if (!lineTools) return;
    lineTools.removeSelectedLineTools();
    saveDrawings();
  };

  const fitChart = () => resetViewport();

  const goLive = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale('right').applyOptions({ autoScale: true });
    chart.timeScale().scrollToRealtime();
  };

  const currentGroup = TOOL_GROUPS.find(group => group.key === toolGroup) ?? TOOL_GROUPS[0];

  return (
    <div className="sire-financial-chart">
      <div className="sire-chart-controls">
        <div className="sire-chart-periods">
          {PERIODS.map(item => (
            <button
              key={item.seconds}
              className={period === item.seconds ? 'active' : ''}
              onClick={() => changePeriod(item.seconds)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button onClick={goLive}>LIVE</button>
        <button onClick={fitChart}>FIT</button>
      </div>

      <div className="sire-drawing-toolbar">
        <select value={toolGroup} onChange={event => setToolGroup(event.target.value)} aria-label="Drawing category">
          {TOOL_GROUPS.map(group => (
            <option key={group.key} value={group.key}>{group.label}</option>
          ))}
        </select>
        <select
          value=""
          onChange={event => event.target.value && startTool(event.target.value)}
          aria-label="Drawing tool"
        >
          <option value="">{activeTool ? `${activeTool} · press Esc to cancel` : 'Choose tool…'}</option>
          {currentGroup.tools.map(tool => (
            <option key={tool.type} value={tool.type}>{tool.label}</option>
          ))}
        </select>
        <button onClick={deleteSelected} title="Delete selected drawing">DELETE</button>
        <span className="sire-drawing-count">
          {drawingCount} drawing{drawingCount === 1 ? '' : 's'}
        </span>
      </div>

      <div ref={containerRef} className="sire-chart-canvas" />
      {loading && <div className="sire-chart-status">Loading market history…</div>}
      {error && <div className="sire-chart-status error">{error}</div>}
    </div>
  );
}
