import { useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, CrosshairMode, createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';

type Tick = { epoch: number; quote: number };
type Candle = { time: Time; open: number; high: number; low: number; close: number };
type Props = { symbol: string; liveTick: Tick | null };

type DerivCandle = { epoch: number; open: number; high: number; low: number; close: number };
const DERIV_PUBLIC_WS = 'wss://ws.binaryws.com/websockets/v3';
const HISTORY_PAGE_SIZE = 5000;
const MAX_HISTORY_CANDLES = 100000;

function bucket(epoch: number, seconds: number) { return Math.floor(epoch / seconds) * seconds; }

function aggregateCandles(candles: DerivCandle[], seconds: number) {
  const grouped = new Map<number, Candle>();
  for (const candle of [...candles].sort((a, b) => a.epoch - b.epoch)) {
    const time = bucket(candle.epoch, seconds);
    const current = grouped.get(time);
    if (!current) {
      grouped.set(time, { time: time as Time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    } else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
    }
  }
  return Array.from(grouped.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

function mergeLiveTick(candles: DerivCandle[], tick: Tick, seconds: number) {
  const time = bucket(tick.epoch, seconds);
  const next = [...candles];
  const last = next[next.length - 1];
  if (!last || last.epoch !== time) {
    next.push({ epoch: time, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote });
  } else {
    last.high = Math.max(last.high, tick.quote);
    last.low = Math.min(last.low, tick.quote);
    last.close = tick.quote;
  }
  return next;
}

function openDeriv(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(DERIV_PUBLIC_WS);
    const timer = window.setTimeout(() => { socket.close(); reject(new Error('Deriv public WebSocket timed out')); }, 10000);
    socket.onopen = () => { window.clearTimeout(timer); resolve(socket); };
    socket.onerror = () => { window.clearTimeout(timer); reject(new Error('Unable to connect to Deriv public market-data endpoint')); };
  });
}

function requestOnce(ws: WebSocket, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const reqId = Math.floor(Math.random() * 900000000) + 100000000;
    const timer = window.setTimeout(() => { ws.removeEventListener('message', onMessage); reject(new Error('Deriv history request timed out')); }, 15000);
    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>;
        if (Number(data.req_id) !== reqId) return;
        window.clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        if (data.error) {
          const error = data.error as Record<string, unknown>;
          reject(new Error(String(error.message || 'Deriv history error')));
          return;
        }
        resolve(data);
      } catch {
        window.clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        reject(new Error('Invalid Deriv history response'));
      }
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ ...request, req_id: reqId }));
  });
}

async function loadAllHistory(symbol: string): Promise<DerivCandle[]> {
  const ws = await openDeriv();
  const result = new Map<number, DerivCandle>();
  let end: number | 'latest' = 'latest';

  try {
    while (result.size < MAX_HISTORY_CANDLES) {
      const response = await requestOnce(ws, {
        ticks_history: symbol,
        start: 0,
        end,
        count: HISTORY_PAGE_SIZE,
        style: 'candles',
        granularity: 60,
        subscribe: 0,
      });
      const raw = Array.isArray(response.candles) ? response.candles : [];
      const page = raw.map((item: unknown) => {
        const value = item as Record<string, unknown>;
        return { epoch: Number(value.epoch), open: Number(value.open), high: Number(value.high), low: Number(value.low), close: Number(value.close) };
      }).filter(c => [c.epoch, c.open, c.high, c.low, c.close].every(Number.isFinite));

      if (!page.length) break;
      for (const candle of page) result.set(candle.epoch, candle);

      const oldest = Math.min(...page.map(c => c.epoch));
      if (page.length < HISTORY_PAGE_SIZE || !Number.isFinite(oldest) || oldest <= 0 || end === oldest) break;
      end = oldest - 60;
    }
  } finally {
    ws.close();
  }

  return Array.from(result.values()).sort((a, b) => a.epoch - b.epoch);
}

export default function FinancialChart({ symbol, liveTick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const baseHistoryRef = useRef<DerivCandle[]>([]);
  const [history, setHistory] = useState<DerivCandle[]>([]);
  const [timeframe, setTimeframe] = useState(60);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError('');
    baseHistoryRef.current = [];
    setHistory([]);
    void loadAllHistory(symbol).then(data => {
      if (cancelled) return;
      baseHistoryRef.current = data;
      setHistory(data);
      setHistoryLoading(false);
    }).catch(error => {
      if (cancelled) return;
      setHistoryLoading(false);
      setHistoryError(error instanceof Error ? error.message : 'Historical candles could not be loaded');
    });
    return () => { cancelled = true; };
  }, [symbol]);

  useEffect(() => {
    if (!liveTick || !Number.isFinite(liveTick.epoch) || !Number.isFinite(liveTick.quote)) return;
    setHistory(current => mergeLiveTick(current, liveTick, 60));
  }, [liveTick]);

  const candles = useMemo(() => aggregateCandles(history, timeframe), [history, timeframe]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#090d12' }, textColor: '#7f8b99' },
      grid: { vertLines: { color: 'rgba(110,123,138,0.08)' }, horzLines: { color: 'rgba(110,123,138,0.08)' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(170,180,194,0.35)', width: 1, style: 2 }, horzLine: { color: 'rgba(170,180,194,0.35)', width: 1, style: 2 } },
      rightPriceScale: { borderColor: 'rgba(110,123,138,0.15)', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: 'rgba(110,123,138,0.15)', timeVisible: true, secondsVisible: false, rightOffset: 6 },
      localization: { priceFormatter: price => price.toLocaleString(undefined, { maximumFractionDigits: 8 }) },
    });
    const candlesSeries = chart.addSeries(CandlestickSeries, { upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444' });
    chartRef.current = chart;
    candleRef.current = candlesSeries;
    return () => { chart.remove(); chartRef.current = null; candleRef.current = null; };
  }, []);

  useEffect(() => {
    candleRef.current?.setData(candles);
    if (candles.length) chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return (
    <div className="financial-chart-card">
      <div className="financial-chart-toolbar">
        <div className="chart-title"><span>PRICE</span><b>{symbol}</b><small>Deriv open-source WebSocket · Historical candles</small></div>
        <div className="chart-timeframes">{[[60, '1m'], [300, '5m'], [900, '15m']].map(([seconds, label]) => <button key={seconds} className={timeframe === seconds ? 'active' : ''} onClick={() => setTimeframe(seconds as number)}>{label}</button>)}</div>
      </div>
      <div ref={containerRef} className="financial-chart-canvas" />
      {historyLoading && <div className="chart-status">Loading historical candles from Deriv…</div>}
      {historyError && <div className="chart-status">{historyError}</div>}
      {!historyLoading && !historyError && !candles.length && <div className="chart-loading">Waiting for market candles…</div>}
    </div>
  );
}
