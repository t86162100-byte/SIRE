import { useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';

type Tick = { epoch: number; quote: number };
type Candle = { time: Time; open: number; high: number; low: number; close: number };
type Props = { symbol: string; liveTick: Tick | null };

const DERIV_ENDPOINTS = [
  'wss://api.derivws.com/trading/v1/options/ws/public',
  'wss://ws.binaryws.com/websockets/v3',
];

function bucket(epoch: number, seconds: number) { return Math.floor(epoch / seconds) * seconds; }

function aggregateTicks(ticks: Tick[], seconds: number) {
  const sorted = [...ticks].filter(t => Number.isFinite(t.epoch) && Number.isFinite(t.quote)).sort((a, b) => a.epoch - b.epoch);
  const candles = new Map<number, Candle>();
  const volumes = new Map<number, number>();
  for (const tick of sorted) {
    const time = bucket(tick.epoch, seconds);
    const current = candles.get(time);
    if (!current) candles.set(time, { time: time as Time, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote });
    else { current.high = Math.max(current.high, tick.quote); current.low = Math.min(current.low, tick.quote); current.close = tick.quote; }
    volumes.set(time, (volumes.get(time) || 0) + 1);
  }
  return {
    candles: Array.from(candles.values()).sort((a, b) => Number(a.time) - Number(b.time)),
    volumes: Array.from(volumes.entries()).map(([time, value]) => ({ time: time as Time, value })).sort((a, b) => Number(a.time) - Number(b.time)),
  };
}

async function openSocket() {
  for (const endpoint of DERIV_ENDPOINTS) {
    try {
      return await new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(endpoint);
        const timer = window.setTimeout(() => { socket.close(); reject(new Error('timeout')); }, 8000);
        socket.onopen = () => { window.clearTimeout(timer); resolve(socket); };
        socket.onerror = () => { window.clearTimeout(timer); reject(new Error('connection failed')); };
      });
    } catch { /* try the next endpoint */ }
  }
  throw new Error('Unable to connect to Deriv history endpoint');
}

async function loadHistory(symbol: string): Promise<Tick[]> {
  const ws = await openSocket();
  try {
    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const reqId = Math.floor(Math.random() * 900000000) + 100000000;
      const timer = window.setTimeout(() => { ws.close(); reject(new Error('history request timed out')); }, 10000);
      const onMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as Record<string, unknown>;
          if (Number(data.req_id) !== reqId) return;
          window.clearTimeout(timer); ws.removeEventListener('message', onMessage);
          if (data.error) { const error = data.error as Record<string, unknown>; reject(new Error(String(error.message || 'Deriv history error'))); return; }
          resolve(data);
        } catch { window.clearTimeout(timer); ws.removeEventListener('message', onMessage); reject(new Error('Invalid history response')); }
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ ticks_history: symbol, count: 1500, end: 'latest', style: 'ticks', req_id: reqId }));
    });
    const history = response.history as Record<string, unknown> | undefined;
    const prices = Array.isArray(history?.prices) ? history.prices as unknown[] : [];
    const times = Array.isArray(history?.times) ? history.times as unknown[] : [];
    return times.map((time, index) => ({ epoch: Number(time), quote: Number(prices[index]) })).filter(t => Number.isFinite(t.epoch) && Number.isFinite(t.quote));
  } finally { ws.close(); }
}

export default function FinancialChart({ symbol, liveTick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ticksRef = useRef<Tick[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [timeframe, setTimeframe] = useState(60);
  const [historyError, setHistoryError] = useState(false);

  useEffect(() => {
    ticksRef.current = [];
    setTicks([]);
    setHistoryError(false);
    let cancelled = false;
    void loadHistory(symbol).then(data => { if (!cancelled) { ticksRef.current = data; setTicks(data); } }).catch(() => { if (!cancelled) setHistoryError(true); });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    if (!liveTick || !Number.isFinite(liveTick.epoch) || !Number.isFinite(liveTick.quote)) return;
    ticksRef.current = [...ticksRef.current.slice(-4000), liveTick];
    setTicks(ticksRef.current);
  }, [liveTick]);

  const aggregated = useMemo(() => aggregateTicks(ticks, timeframe), [ticks, timeframe]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#090d12' }, textColor: '#7f8b99' },
      grid: { vertLines: { color: 'rgba(110,123,138,0.08)' }, horzLines: { color: 'rgba(110,123,138,0.08)' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(170,180,194,0.35)', width: 1, style: 2 }, horzLine: { color: 'rgba(170,180,194,0.35)', width: 1, style: 2 } },
      rightPriceScale: { borderColor: 'rgba(110,123,138,0.15)', scaleMargins: { top: 0.08, bottom: 0.18 } },
      timeScale: { borderColor: 'rgba(110,123,138,0.15)', timeVisible: true, secondsVisible: false, rightOffset: 6 },
      localization: { priceFormatter: price => price.toLocaleString(undefined, { maximumFractionDigits: 8 }) },
    });
    const candles = chart.addSeries(CandlestickSeries, { upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444' });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', base: 0 });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    chartRef.current = chart; candleRef.current = candles; volumeRef.current = volume;
    return () => { chart.remove(); chartRef.current = null; candleRef.current = null; volumeRef.current = null; };
  }, []);

  useEffect(() => {
    candleRef.current?.setData(aggregated.candles);
    volumeRef.current?.setData(aggregated.volumes);
    if (aggregated.candles.length) chartRef.current?.timeScale().fitContent();
  }, [aggregated]);

  return (
    <div className="financial-chart-card">
      <div className="financial-chart-toolbar">
        <div className="chart-title"><span>PRICE</span><b>{symbol}</b><small>TradingView Lightweight Charts</small></div>
        <div className="chart-timeframes">{[[60, '1m'], [300, '5m'], [900, '15m']].map(([seconds, label]) => <button key={seconds} className={timeframe === seconds ? 'active' : ''} onClick={() => setTimeframe(seconds as number)}>{label}</button>)}</div>
      </div>
      <div ref={containerRef} className="financial-chart-canvas" />
      {historyError && <div className="chart-status">Live data is available; historical candles could not be loaded yet.</div>}
      {!ticks.length && <div className="chart-loading">Waiting for market ticks…</div>}
    </div>
  );
}
