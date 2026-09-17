import { useEffect, useRef, useState } from 'react';
import { createChart, darkTheme, type Chart } from 'openalgo-charts';
import './financialChart.css';

type Tick = { symbol: string; quote: number; epoch: number };
type HistoryResponse = Record<string, unknown>;
type HistoryRequester = (request: Record<string, unknown>) => Promise<HistoryResponse>;
type Props = { symbol: string; liveTick: Tick | null; requestHistory: HistoryRequester };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type Period = { label: string; seconds: number };

const PERIODS: Period[] = [
  { label: '1m', seconds: 60 }, { label: '2m', seconds: 120 }, { label: '3m', seconds: 180 },
  { label: '5m', seconds: 300 }, { label: '10m', seconds: 600 }, { label: '15m', seconds: 900 },
  { label: '20m', seconds: 1200 }, { label: '30m', seconds: 1800 }, { label: '45m', seconds: 2700 },
  { label: '1H', seconds: 3600 }, { label: '2H', seconds: 7200 }, { label: '3H', seconds: 10800 },
  { label: '4H', seconds: 14400 }, { label: '6H', seconds: 21600 }, { label: '8H', seconds: 28800 },
  { label: '12H', seconds: 43200 }, { label: '1D', seconds: 86400 }, { label: '2D', seconds: 172800 },
  { label: '3D', seconds: 259200 }, { label: '1W', seconds: 604800 }, { label: '1M', seconds: 2592000 },
];

const PITCH_BLACK_THEME = {
  ...darkTheme,
  background: '#000000',
  grid: '#111111',
  axisText: '#8a8a8a',
  axisLine: '#242424',
  paneSeparator: '#161616',
  crosshair: '#555555',
  crosshairLabelBackground: '#161616',
  upColor: '#26a69a',
  wickUpColor: '#26a69a',
  downColor: '#ef5350',
  wickDownColor: '#ef5350',
  lastPriceUp: '#26a69a',
  lastPriceDown: '#ef5350',
  lastPriceText: '#ffffff',
};

function parseCandles(data: HistoryResponse): Candle[] | null {
  if (!Array.isArray(data.candles)) return null;
  const candles = data.candles.map((item: unknown) => {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    return { time: Number(raw.epoch), open: Number(raw.open), high: Number(raw.high), low: Number(raw.low), close: Number(raw.close) };
  }).filter((candle): candle is Candle => Boolean(candle) && Number.isFinite(candle.time) && Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close));
  return candles.length ? candles.sort((a, b) => a.time - b.time) : null;
}

function parseTicks(data: HistoryResponse): { epoch: number; quote: number }[] | null {
  const history = data.history as Record<string, unknown> | undefined;
  const prices = Array.isArray(history?.prices) ? history.prices : [];
  const times = Array.isArray(history?.times) ? history.times : [];
  if (!prices.length || !times.length) return null;
  return prices.map((price, index) => ({ epoch: Number(times[index]), quote: Number(price) })).filter(item => Number.isFinite(item.epoch) && Number.isFinite(item.quote));
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

async function loadHistory(symbol: string, seconds: number, request: HistoryRequester): Promise<Candle[]> {
  const result = await request({ ticks_history: symbol, end: 'latest', count: 1500, style: 'candles', granularity: seconds });
  const candles = parseCandles(result);
  if (candles) return candles;
  const ticks = parseTicks(result);
  if (ticks?.length) return aggregateTicks(ticks, seconds);
  throw new Error('Deriv returned no chart history');
}

export default function FinancialChart({ symbol, liveTick, requestHistory }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const seriesRef = useRef<any>(null);
  const candlesRef = useRef<Candle[]>([]);
  const periodRef = useRef(PERIODS[0].seconds);
  const generationRef = useRef(0);
  const latestTickRef = useRef<Tick | null>(null);
  const symbolRef = useRef(symbol);
  const [period, setPeriod] = useState(PERIODS[0].seconds);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const updateTick = (tick: Tick, seconds: number) => {
    const series = seriesRef.current;
    if (!series || tick.symbol !== symbolRef.current || !Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) return;
    const time = Math.floor(tick.epoch / seconds) * seconds;
    const last = candlesRef.current[candlesRef.current.length - 1];
    const next: Candle = last?.time === time
      ? { ...last, high: Math.max(last.high, tick.quote), low: Math.min(last.low, tick.quote), close: tick.quote }
      : { time, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote };
    if (last?.time === time) candlesRef.current[candlesRef.current.length - 1] = next;
    else candlesRef.current.push(next);
    if (candlesRef.current.length > 1500) candlesRef.current.shift();
    series.update(next);
  };

  useEffect(() => {
    symbolRef.current = symbol;
    latestTickRef.current = null;
  }, [symbol]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      theme: PITCH_BLACK_THEME,
      timezone: 'Africa/Lagos',
      branding: false,
      navigation: { mousePan: 'both', defaultVisibleBars: 120 },
      crosshair: { mode: 'normal' },
      grid: { vertical: true, horizontal: true },
    });
    const series = chart.addSeries('candlestick');
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.destroy();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!symbol || !seriesRef.current) return;
    periodRef.current = period;
    setLoading(true);
    setError('');
    loadHistory(symbol, period, requestHistory)
      .then(candles => {
        if (generation !== generationRef.current || !seriesRef.current) return;
        candlesRef.current = candles;
        seriesRef.current.setData(candles);
        const pending = latestTickRef.current;
        if (pending?.symbol === symbol) updateTick(pending, period);
      })
      .catch(reason => {
        if (generation === generationRef.current) setError(reason instanceof Error ? reason.message : 'Unable to load chart history from Deriv');
      })
      .finally(() => {
        if (generation === generationRef.current) setLoading(false);
      });
    return () => { generationRef.current += 1; };
  }, [symbol, period, requestHistory]);

  useEffect(() => {
    latestTickRef.current = liveTick;
    if (liveTick?.symbol === symbolRef.current) updateTick(liveTick, periodRef.current);
  }, [liveTick]);

  return (
    <div className="sire-financial-chart">
      <div className="sire-chart-periods" role="toolbar" aria-label="Chart timeframe">
        {PERIODS.map(item => (
          <button key={item.label} type="button" className={period === item.seconds ? 'active' : ''} onClick={() => setPeriod(item.seconds)}>{item.label}</button>
        ))}
      </div>
      <div ref={containerRef} className="sire-chart-canvas" />
      {(loading || error) && <div className={`sire-chart-status${error ? ' error' : ''}`}>{error || `Loading ${symbol} history...`}</div>}
    </div>
  );
}
