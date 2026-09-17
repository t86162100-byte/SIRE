import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import { DrawingManager, TrendLine } from 'lightweight-charts-drawing';

type Candle = { epoch: number; open: number; high: number; low: number; close: number; volume?: number };
type Props = { candles: Candle[]; className?: string };
type Point = { time: Time; price: number };

function toChartData(candles: Candle[]) {
  return candles
    .filter((c) => [c.epoch, c.open, c.high, c.low, c.close].every(Number.isFinite))
    .slice()
    .sort((a, b) => a.epoch - b.epoch)
    .reduce<Array<{ time: Time; open: number; high: number; low: number; close: number }>>((out, c) => {
      const time = Math.floor(c.epoch);
      if (out.length && Number(out[out.length - 1].time) === time) return out;
      out.push({ time, open: c.open, high: c.high, low: c.low, close: c.close });
      return out;
    }, []);
}

/**
 * Isolated migration prototype. It is intentionally not wired into the existing
 * SIRE chart yet: first we prove candles, real trend-line anchors, selection,
 * and drag editing on the new engine before replacing the current implementation.
 */
export default function LightweightMarketChart({ candles, className }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const managerRef = useRef<DrawingManager | null>(null);
  const nextAnchorRef = useRef<Point[]>([]);
  const drawingModeRef = useRef<'pan' | 'trend-line'>('pan');
  const [drawingMode, setDrawingMode] = useState<'pan' | 'trend-line'>('pan');
  const [anchorCount, setAnchorCount] = useState(0);
  const data = useMemo(() => toChartData(candles), [candles]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#090d12' }, textColor: '#9aa5b1' },
      grid: {
        vertLines: { color: 'rgba(86, 99, 114, 0.16)' },
        horzLines: { color: 'rgba(86, 99, 114, 0.16)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#66717f', style: 2, width: 1 },
        horzLine: { color: '#66717f', style: 2, width: 1 },
      },
      rightPriceScale: { borderColor: 'rgba(116, 129, 144, 0.35)', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: 'rgba(116, 129, 144, 0.35)',
        rightOffset: 6,
        barSpacing: 8,
        minBarSpacing: 2,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#20b26b',
      downColor: '#e05252',
      borderVisible: true,
      borderUpColor: '#20b26b',
      borderDownColor: '#e05252',
      wickUpColor: '#20b26b',
      wickDownColor: '#e05252',
    });

    const manager = new DrawingManager();
    manager.attach(chart, series, host);
    chartRef.current = chart;
    seriesRef.current = series;
    managerRef.current = manager;

    const onClick = (param: any) => {
      if (drawingModeRef.current !== 'trend-line' || !param.point || param.time === undefined) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price === null) return;

      nextAnchorRef.current = [...nextAnchorRef.current, { time: param.time, price }];
      const count = nextAnchorRef.current.length;
      setAnchorCount(count);

      if (count === 2) {
        manager.addDrawing(
          new TrendLine(`sire-trend-${Date.now()}`, nextAnchorRef.current, {
            lineColor: '#5da9ff',
            lineWidth: 2,
          }),
        );
        nextAnchorRef.current = [];
        setAnchorCount(0);
        drawingModeRef.current = 'pan';
        setDrawingMode('pan');
      }
    };

    chart.subscribeClick(onClick);
    chart.timeScale().fitContent();

    return () => {
      chart.unsubscribeClick(onClick);
      manager.clearAll();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      managerRef.current = null;
      nextAnchorRef.current = [];
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(data);
  }, [data]);

  const selectTrendLine = () => {
    nextAnchorRef.current = [];
    setAnchorCount(0);
    const next = drawingModeRef.current === 'trend-line' ? 'pan' : 'trend-line';
    drawingModeRef.current = next;
    setDrawingMode(next);
  };

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 240, background: '#090d12' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, padding: 6, border: '1px solid rgba(72,110,150,.45)', borderRadius: 10, background: 'rgba(9,14,21,.92)', backdropFilter: 'blur(12px)' }}>
        <button type="button" onClick={selectTrendLine} style={{ minHeight: 40, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(100,130,160,.45)', background: drawingMode === 'trend-line' ? 'rgba(93,169,255,.18)' : 'transparent', color: '#d8e1eb', touchAction: 'manipulation' }}>
          Trend line
        </button>
        {drawingMode === 'trend-line' ? <span style={{ color: '#9aa5b1', fontSize: 12 }}>{anchorCount === 0 ? 'Select first point' : 'Select second point'}</span> : null}
      </div>
    </div>
  );
}
