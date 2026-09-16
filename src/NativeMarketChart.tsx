import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
} from 'lightweight-charts';
import 'lightweight-charts/dist/lightweight-charts.css';

type Candle = {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Props = {
  candles: Candle[];
  latest?: { epoch: number; quote: number; bid?: number; ask?: number } | null;
  autoScale?: boolean;
};

function toSeriesData(candles: Candle[]): CandlestickData[] {
  const sorted = candles
    .filter(candle => Number.isFinite(candle.epoch) && Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close))
    .slice()
    .sort((a, b) => a.epoch - b.epoch);

  const unique: CandlestickData[] = [];
  let lastTime = -1;
  for (const candle of sorted) {
    const time = Math.floor(candle.epoch) as UTCTimestamp;
    if (Number(time) <= lastTime) continue;
    unique.push({
      time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
    lastTime = Number(time);
  }
  return unique;
}

export default function NativeMarketChart({ candles, latest, autoScale = true }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const initializedRef = useRef(false);
  const firstDataRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { color: '#090d12' },
        textColor: '#9aa5b1',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: '#151b23' },
        horzLines: { color: '#151b23' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#66717f', width: 1, style: 3, labelBackgroundColor: '#202833' },
        horzLine: { color: '#66717f', width: 1, style: 3, labelBackgroundColor: '#202833' },
      },
      rightPriceScale: {
        visible: true,
        borderVisible: true,
        borderColor: '#29313c',
        textColor: '#b5bec9',
        ticksVisible: true,
        minimumWidth: 76,
        autoScale,
      },
      timeScale: {
        visible: true,
        borderVisible: true,
        borderColor: '#29313c',
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 6,
        barSpacing: 8,
        minBarSpacing: 2,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: true,
        mouseWheel: true,
        pinch: true,
        mode: true,
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
      priceLineWidth: 1,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    initializedRef.current = true;

    const resizeObserver = new ResizeObserver(() => chart.resize(host.clientWidth, host.clientHeight));
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      initializedRef.current = false;
      firstDataRef.current = false;
    };
  }, [autoScale]);

  useEffect(() => {
    if (!initializedRef.current || !seriesRef.current) return;
    const data = toSeriesData(candles);
    seriesRef.current.setData(data);

    if (!firstDataRef.current && data.length) {
      chartRef.current?.timeScale().fitContent();
      firstDataRef.current = true;
    }
  }, [candles]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !latest || !candles.length) return;

    const last = candles[candles.length - 1];
    const latestTime = Math.floor(latest.epoch);
    const candleTime = Math.floor(last.epoch);
    if (latestTime < candleTime) return;

    series.update({
      time: candleTime as UTCTimestamp,
      open: last.open,
      high: Math.max(last.high, latest.quote),
      low: Math.min(last.low, latest.quote),
      close: latest.quote,
    });
  }, [latest, candles]);

  return <div ref={hostRef} className="sire-native-chart" aria-label="SIRE native market chart" />;
}
