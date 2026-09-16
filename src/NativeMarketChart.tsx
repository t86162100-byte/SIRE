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

type Candle = { epoch: number; open: number; high: number; low: number; close: number };
type Props = { candles: Candle[]; latest?: { epoch: number; quote: number; bid?: number; ask?: number } | null; autoScale?: boolean };

function toSeriesData(candles: Candle[]): CandlestickData[] {
  const sorted = candles.filter(candle => Number.isFinite(candle.epoch) && Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close)).slice().sort((a, b) => a.epoch - b.epoch);
  const unique: CandlestickData[] = [];
  let lastTime = -1;
  for (const candle of sorted) {
    const time = Math.floor(candle.epoch) as UTCTimestamp;
    if (Number(time) <= lastTime) continue;
    unique.push({ time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
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
      layout: { background: { color: '#090d12' }, textColor: '#9aa5b1', attributionLogo: false },
      grid: { vertLines: { color: '#151b23' }, horzLines: { color: '#151b23' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#66717f', width: 1, style: 3, labelBackgroundColor: '#202833' }, horzLine: { color: '#66717f', width: 1, style: 3, labelBackgroundColor: '#202833' } },
      rightPriceScale: { visible: true, borderVisible: true, borderColor: '#29313c', textColor: '#b5bec9', ticksVisible: true, minimumWidth: 76, autoScale },
      timeScale: { visible: true, borderVisible: true, timeVisible: true, secondsVisible: true, rightOffset: 6, barSpacing: 8, minBarSpacing: 2 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: true, mouseWheel: true, pinch: true },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: '#22c55e', downColor: '#ef4444', borderUpColor: '#22c55e', borderDownColor: '#ef4444', wickUpColor: '#22c55e', wickDownColor: '#ef4444', priceLineVisible: true, lastValueVisible: true, priceLineWidth: 1 });
    chartRef.current = chart;
    seriesRef.current = series;
    initializedRef.current = true;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; initializedRef.current = false; firstDataRef.current = false; };
  }, [autoScale]);

  useEffect(() => {
    if (!initializedRef.current || !seriesRef.current) return;
    const data = toSeriesData(candles);
    seriesRef.current.setData(data);
    if (!firstDataRef.current && data.length) { chartRef.current?.timeScale().fitContent(); firstDataRef.current = true; }
  }, [candles]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !latest || !candles.length) return;
    const last = candles[candles.length - 1];
    const latestTime = Math.floor(latest.epoch);
    const candleTime = Math.floor(last.epoch);
    if (latestTime < candleTime) return;
    series.update({ time: candleTime as UTCTimestamp, open: last.open, high: Math.max(last.high, latest.quote), low: Math.min(last.low, latest.quote), close: latest.quote });
  }, [latest, candles]);

  useEffect(() => {
    const surface = hostRef.current?.parentElement;
    if (!surface) return;
    let startY = 0;
    let startX = 0;
    let tracking = false;
    const updateLabel = () => {
      const label = surface.querySelector<HTMLElement>('.native-bottom-instrument-name');
      const source = document.querySelector<HTMLElement>('.native-instrument-picker strong');
      if (label) label.textContent = source?.textContent?.trim() || 'Select instrument';
    };
    const changeInstrument = (direction: 1 | -1) => {
      const picker = document.querySelector<HTMLButtonElement>('.native-instrument-picker');
      if (!picker) return;
      picker.click();
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('.native-instrument-sheet .sheet-row'));
        const active = rows.findIndex(row => row.classList.contains('active'));
        if (active < 0 || !rows.length) return;
        const next = active + direction;
        if (next >= 0 && next < rows.length) rows[next].click();
        window.setTimeout(updateLabel, 0);
      }));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      startX = event.clientX;
      startY = event.clientY;
      tracking = true;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      const dy = event.clientY - startY;
      const dx = event.clientX - startX;
      if (Math.abs(dy) < 45 || Math.abs(dy) < Math.abs(dx) * 1.2) return;
      changeInstrument(dy < 0 ? 1 : -1);
    };
    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointerup', onPointerUp);
    const observer = new MutationObserver(updateLabel);
    const pickerText = document.querySelector('.native-instrument-picker strong');
    if (pickerText) observer.observe(pickerText, { childList: true, characterData: true, subtree: true });
    updateLabel();
    return () => {
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointerup', onPointerUp);
      observer.disconnect();
    };
  }, []);

  return <div className="native-chart-touch-surface">
    <div ref={hostRef} className="sire-native-chart" aria-label="SIRE native market chart" />
    <div className="native-bottom-glass-bar" aria-hidden="true"><span className="native-bottom-instrument-name">Select instrument</span></div>
  </div>;
}
