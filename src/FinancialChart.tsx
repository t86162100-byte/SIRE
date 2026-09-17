import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, CrosshairMode, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import './financialChart.css';

type Tick = { symbol: string; quote: number; epoch: number };
type Props = { symbol: string; liveTick: Tick | null };
type Candle = { time: UTCTimestamp; open: number; high: number; low: number; close: number };
type HistoryResponse = Record<string, unknown>;

const HISTORY_ENDPOINTS = [
  'wss://api.derivws.com/trading/v1/options/ws/public',
  'wss://ws.binaryws.com/websockets/v3',
] as const;
const PERIODS = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1H', seconds: 3600 },
];

function aggregate(ticks: Tick[], seconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const tick of ticks) {
    if (!Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) continue;
    const bucket = Math.floor(tick.epoch / seconds) * seconds;
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { time: bucket as UTCTimestamp, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote });
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
    .map((price, index) => ({ symbol, quote: Number(price), epoch: Number(times[index]) }))
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
    .filter((candle): candle is Candle => Boolean(candle) && Number.isFinite(Number(candle.time)) && Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close));
  return candles.length ? candles.sort((a, b) => Number(a.time) - Number(b.time)) : null;
}

function requestHistory(symbol: string, seconds: number): Promise<{ candles: Candle[]; ticks: Tick[] }> {
  const requestId = Math.floor(Math.random() * 900000000) + 100000000;
  let lastError: Error | null = null;

  return new Promise(async (resolve, reject) => {
    for (const endpoint of HISTORY_ENDPOINTS) {
      try {
        const result = await new Promise<HistoryResponse>((innerResolve, innerReject) => {
          const ws = new WebSocket(endpoint);
          let settled = false;
          const timer = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            ws.close();
            innerReject(new Error('Deriv chart history request timed out'));
          }, 12000);

          const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            ws.close();
            callback();
          };

          ws.onerror = () => finish(() => innerReject(new Error(`Unable to connect to Deriv chart history endpoint (${endpoint.includes('binaryws') ? 'legacy' : 'current'})`)));
          ws.onclose = () => {
            if (!settled) finish(() => innerReject(new Error('Deriv chart history connection closed')));
          };
          ws.onopen = () => {
            ws.send(JSON.stringify({
              ticks_history: symbol,
              end: 'latest',
              count: 500,
              style: 'candles',
              granularity: seconds,
              subscribe: 0,
              req_id: requestId,
            }));
          };
          ws.onmessage = event => {
            try {
              const data = JSON.parse(event.data) as HistoryResponse;
              if (data.error) {
                const error = data.error as Record<string, unknown>;
                finish(() => innerReject(new Error(String(error.message || 'Deriv chart history error'))));
                return;
              }
              if (data.msg_type !== 'candles' && data.msg_type !== 'history') return;
              // The socket is dedicated to this one request, so accept the response even if a newer API response omits req_id.
              if (data.req_id !== undefined && Number(data.req_id) !== requestId) return;
              finish(() => innerResolve(data));
            } catch {
              finish(() => innerReject(new Error('Invalid Deriv chart history response')));
            }
          };
        });

        const directCandles = parseCandles(result);
        if (directCandles) {
          resolve({ candles: directCandles, ticks: [] });
          return;
        }
        const ticks = parseHistory(result, symbol);
        if (ticks?.length) {
          resolve({ candles: aggregate(ticks, seconds), ticks });
          return;
        }
        throw new Error('Deriv returned no chart history');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    reject(lastError || new Error('Unable to load chart history from Deriv'));
  });
}

export default function FinancialChart({ symbol, liveTick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const selectedPeriod = useRef(60);
  const requestGeneration = useRef(0);
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
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  const loadHistory = (nextPeriod: number) => {
    const generation = ++requestGeneration.current;
    if (!symbol || !seriesRef.current) return;
    setLoading(true);
    setError('');
    candlesRef.current = [];
    seriesRef.current.setData([]);
    requestHistory(symbol, nextPeriod).then(({ candles }) => {
      if (generation !== requestGeneration.current || !seriesRef.current) return;
      candlesRef.current = candles;
      seriesRef.current.setData(candles);
      chartRef.current?.timeScale().fitContent();
    }).catch(error => {
      if (generation === requestGeneration.current) setError(error instanceof Error ? error.message : 'Unable to load chart history from Deriv');
    }).finally(() => {
      if (generation === requestGeneration.current) setLoading(false);
    });
  };

  useEffect(() => {
    loadHistory(selectedPeriod.current);
    return () => { requestGeneration.current += 1; };
  }, [symbol]);

  useEffect(() => {
    if (!liveTick || liveTick.symbol !== symbol || !seriesRef.current) return;
    const seconds = selectedPeriod.current;
    const bucket = Math.floor(liveTick.epoch / seconds) * seconds as UTCTimestamp;
    const last = candlesRef.current[candlesRef.current.length - 1];
    const next: Candle = last && last.time === bucket
      ? { ...last, high: Math.max(last.high, liveTick.quote), low: Math.min(last.low, liveTick.quote), close: liveTick.quote }
      : { time: bucket, open: liveTick.quote, high: liveTick.quote, low: liveTick.quote, close: liveTick.quote };
    if (last && last.time === bucket) candlesRef.current[candlesRef.current.length - 1] = next;
    else candlesRef.current.push(next);
    if (candlesRef.current.length > 1000) candlesRef.current.shift();
    seriesRef.current.update(next);
  }, [liveTick, symbol]);

  const changePeriod = (seconds: number) => {
    selectedPeriod.current = seconds;
    setPeriod(seconds);
    loadHistory(seconds);
  };

  return <div className="sire-financial-chart">
    <div className="sire-chart-controls"><div className="sire-chart-periods">{PERIODS.map(item => <button key={item.seconds} className={period === item.seconds ? 'active' : ''} onClick={() => changePeriod(item.seconds)}>{item.label}</button>)}</div><button onClick={() => chartRef.current?.timeScale().scrollToRealtime()}>LIVE</button><button onClick={() => chartRef.current?.timeScale().fitContent()}>FIT</button></div>
    <div ref={containerRef} className="sire-chart-canvas" />
    {loading && <div className="sire-chart-status">Loading market history…</div>}
    {error && <div className="sire-chart-status error">{error}</div>}
  </div>;
}
