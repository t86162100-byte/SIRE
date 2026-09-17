import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, CrosshairMode, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import './financialChart.css';

type Tick = { symbol: string; quote: number; epoch: number };
type Props = { symbol: string; liveTick: Tick | null };
type Candle = { time: UTCTimestamp; open: number; high: number; low: number; close: number };
const HISTORY_WS = 'wss://ws.binaryws.com/websockets/v3';
const PERIODS = [{ label: '1m', seconds: 60 }, { label: '5m', seconds: 300 }, { label: '15m', seconds: 900 }, { label: '1H', seconds: 3600 }];

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

function requestHistory(symbol: string): Promise<Tick[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HISTORY_WS);
    const timer = window.setTimeout(() => { ws.close(); reject(new Error('Chart history request timed out')); }, 12000);
    ws.onerror = () => { window.clearTimeout(timer); ws.close(); reject(new Error('Unable to load chart history from Deriv')); };
    ws.onopen = () => ws.send(JSON.stringify({ ticks_history: symbol, end: 'latest', count: 2500, style: 'ticks', req_id: 71 }));
    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>;
        if (Number(data.req_id) !== 71) return;
        window.clearTimeout(timer); ws.close();
        if (data.error) throw new Error(String((data.error as Record<string, unknown>).message || 'Deriv history error'));
        const history = data.history as Record<string, unknown> | undefined;
        const prices = Array.isArray(history?.prices) ? history.prices : [];
        const times = Array.isArray(history?.times) ? history.times : [];
        resolve(prices.map((price, index) => ({ symbol, quote: Number(price), epoch: Number(times[index]) })).filter(t => Number.isFinite(t.quote) && Number.isFinite(t.epoch)));
      } catch (error) { window.clearTimeout(timer); ws.close(); reject(error instanceof Error ? error : new Error('Invalid Deriv chart history')); }
    };
  });
}

export default function FinancialChart({ symbol, liveTick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const rawTicks = useRef<Tick[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const selectedPeriod = useRef(60);
  const [period, setPeriod] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#090d12' }, textColor: '#8995a5', attributionLogo: true },
      grid: { vertLines: { color: 'rgba(120,135,150,.08)' }, horzLines: { color: 'rgba(120,135,150,.08)' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(150,165,180,.35)' }, horzLine: { color: 'rgba(150,165,180,.35)' } },
      rightPriceScale: { borderColor: 'rgba(120,135,150,.18)', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: 'rgba(120,135,150,.18)', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: '#22c55e', downColor: '#ef4444', borderUpColor: '#22c55e', borderDownColor: '#ef4444', wickUpColor: '#22c55e', wickDownColor: '#ef4444', priceLineVisible: true, lastValueVisible: true });
    chartRef.current = chart; seriesRef.current = series;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!symbol || !seriesRef.current) return;
    setLoading(true); setError(''); rawTicks.current = []; candlesRef.current = []; seriesRef.current.setData([]);
    requestHistory(symbol).then(ticks => {
      if (cancelled || !seriesRef.current) return;
      rawTicks.current = ticks;
      candlesRef.current = aggregate(ticks, selectedPeriod.current);
      seriesRef.current.setData(candlesRef.current);
      chartRef.current?.timeScale().fitContent();
    }).catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : 'Unable to load chart history'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    if (!liveTick || liveTick.symbol !== symbol || !seriesRef.current) return;
    rawTicks.current.push(liveTick);
    if (rawTicks.current.length > 5000) rawTicks.current.splice(0, rawTicks.current.length - 5000);
    const seconds = selectedPeriod.current;
    const bucket = Math.floor(liveTick.epoch / seconds) * seconds as UTCTimestamp;
    const last = candlesRef.current[candlesRef.current.length - 1];
    const next: Candle = last && last.time === bucket
      ? { ...last, high: Math.max(last.high, liveTick.quote), low: Math.min(last.low, liveTick.quote), close: liveTick.quote }
      : { time: bucket, open: liveTick.quote, high: liveTick.quote, low: liveTick.quote, close: liveTick.quote };
    if (last && last.time === bucket) candlesRef.current[candlesRef.current.length - 1] = next;
    else candlesRef.current.push(next);
    if (candlesRef.current.length > 5000) candlesRef.current.shift();
    seriesRef.current.update(next);
  }, [liveTick, symbol]);

  const changePeriod = (seconds: number) => {
    selectedPeriod.current = seconds; setPeriod(seconds);
    candlesRef.current = aggregate(rawTicks.current, seconds);
    seriesRef.current?.setData(candlesRef.current);
    chartRef.current?.timeScale().fitContent();
  };

  return <div className="sire-financial-chart">
    <div className="sire-chart-controls"><div className="sire-chart-periods">{PERIODS.map(item => <button key={item.seconds} className={period === item.seconds ? 'active' : ''} onClick={() => changePeriod(item.seconds)}>{item.label}</button>)}</div><button onClick={() => chartRef.current?.timeScale().scrollToRealtime()}>LIVE</button><button onClick={() => chartRef.current?.timeScale().fitContent()}>FIT</button></div>
    <div ref={containerRef} className="sire-chart-canvas" />
    {loading && <div className="sire-chart-status">Loading market history…</div>}
    {error && <div className="sire-chart-status error">{error}</div>}
  </div>;
}
