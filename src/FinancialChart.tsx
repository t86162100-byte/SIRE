import { useEffect, useRef } from 'react';
import 'openalgo-charts/indicators';
import 'openalgo-charts/draw';
import 'openalgo-charts/profile';
import 'openalgo-charts/trade';
import 'openalgo-charts/transform';
import 'openalgo-charts/webgl';
import { createWidget, type Widget } from 'openalgo-charts/widget';
import './financialChart.css';

type Tick = { symbol: string; quote: number; epoch: number };
type HistoryResponse = Record<string, unknown>;
type HistoryRequester = (request: Record<string, unknown>) => Promise<HistoryResponse>;
type Instrument = { symbol: string; name: string };
type Props = { symbol: string; liveTick: Tick | null; requestHistory: HistoryRequester; instruments: Instrument[]; onSelectInstrument: (instrument: Instrument) => void };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

const INTERVAL_SECONDS: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1d': 86400, '1w': 604800 };
const intervalSeconds = (interval: string) => INTERVAL_SECONDS[interval] ?? 60;

function parseCandles(data: HistoryResponse): Candle[] | null {
  if (!Array.isArray(data.candles)) return null;
  const candles = data.candles.map((item: unknown) => {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    return { time: Number(raw.epoch), open: Number(raw.open), high: Number(raw.high), low: Number(raw.low), close: Number(raw.close) };
  }).filter((c): c is Candle => Boolean(c) && Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
  return candles.length ? candles.sort((a, b) => a.time - b.time) : null;
}

function parseTicks(data: HistoryResponse) {
  const history = data.history as Record<string, unknown> | undefined;
  const prices = Array.isArray(history?.prices) ? history.prices : [];
  const times = Array.isArray(history?.times) ? history.times : [];
  if (!prices.length || !times.length) return null;
  return prices.map((price, index) => ({ epoch: Number(times[index]), quote: Number(price) })).filter(x => Number.isFinite(x.epoch) && Number.isFinite(x.quote));
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

async function requestBars(symbol: string, interval: string, requestHistory: HistoryRequester): Promise<Candle[]> {
  const seconds = intervalSeconds(interval);
  const result = await requestHistory({ ticks_history: symbol, end: 'latest', count: 1500, style: 'candles', granularity: seconds });
  const candles = parseCandles(result);
  if (candles) return candles;
  const ticks = parseTicks(result);
  if (ticks?.length) return aggregateTicks(ticks, seconds);
  throw new Error('Deriv returned no chart history');
}

export default function FinancialChart({ symbol, liveTick, requestHistory, instruments, onSelectInstrument }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<Widget | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const subscriberRef = useRef<((bar: Candle) => void) | null>(null);
  const requestHistoryRef = useRef(requestHistory);
  const instrumentsRef = useRef(instruments);
  const onSelectInstrumentRef = useRef(onSelectInstrument);
  const symbolRef = useRef(symbol);
  requestHistoryRef.current = requestHistory;
  instrumentsRef.current = instruments;
  onSelectInstrumentRef.current = onSelectInstrument;
  symbolRef.current = symbol;

  useEffect(() => {
    if (!containerRef.current) return;
    // DEBUG: give the host itself a guaranteed viewport-sized box before OpenAlgo initializes.
    const host = containerRef.current;
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '100vw';
    host.style.height = '100vh';
    host.style.zIndex = '9998';
    host.style.display = 'block';
    host.style.visibility = 'visible';
    host.style.opacity = '1';
    const feed = {
      async getBars(req: { symbol: string; interval: string }) {
        const bars = await requestBars(req.symbol, req.interval, requestHistoryRef.current);
        candlesRef.current = bars;
        return bars;
      },
      subscribeBars(req: { symbol: string; interval: string }, onBar: (bar: Candle) => void) {
        subscriberRef.current = bar => { if (req.symbol === symbolRef.current) onBar(bar); };
        return () => { subscriberRef.current = null; };
      },
    };
    let widget: Widget;
    try {
      widget = createWidget(host, {
      feed,
      symbol,
      exchange: 'Deriv Synthetic Indices',
      interval: '1m',
      chartType: 'candlestick',
      theme: 'dark',
      renderer: 'auto',
      rail: true,
      topbar: true,
      statusline: true,
      indicators: true,
      mobile: 'always',
      symbolSearch: async (query: string) => instrumentsRef.current
        .filter(item => `${item.name} ${item.symbol}`.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 50)
        .map(item => ({ symbol: item.symbol, name: item.name })),
    });
    widgetRef.current = widget;
    // DEBUG: force the OpenAlgo widget into the viewport center so we can rule out host layout/positioning issues.
    widget.root.style.position = 'fixed';
    widget.root.style.left = '50%';
    widget.root.style.top = '50%';
    widget.root.style.width = '100vw';
    widget.root.style.height = '100vh';
    widget.root.style.transform = 'translate(-50%, -50%)';
    widget.root.style.zIndex = '9999';
    widget.root.dataset.sireDebugCentered = 'true';

    const offSymbol = widget.on('symbol', (event: { symbol: string }) => {
      const instrument = instrumentsRef.current.find(item => item.symbol === event.symbol);
      if (instrument && instrument.symbol !== symbolRef.current) onSelectInstrumentRef.current(instrument);
    });
    const offData = widget.on('data', (event: { bars?: Candle[] }) => {
      if (Array.isArray(event.bars)) candlesRef.current = event.bars;
    });
    return () => {
      offSymbol?.();
      offData?.();
      subscriberRef.current = null;
      widget.destroy();
      widgetRef.current = null;
      candlesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const widget = widgetRef.current;
    if (widget && widget.symbol() !== symbol) widget.setSymbol(symbol, 'Deriv Synthetic Indices');
  }, [symbol]);

  useEffect(() => {
    const tick = liveTick;
    if (!tick || tick.symbol !== symbol || !Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) return;
    const widget = widgetRef.current;
    if (!widget) return;
    const seconds = intervalSeconds(widget.interval());
    const time = Math.floor(tick.epoch / seconds) * seconds;
    const last = candlesRef.current[candlesRef.current.length - 1];
    const bar: Candle = last?.time === time
      ? { ...last, high: Math.max(last.high, tick.quote), low: Math.min(last.low, tick.quote), close: tick.quote }
      : { time, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote };
    if (last?.time === time) candlesRef.current[candlesRef.current.length - 1] = bar;
    else { candlesRef.current.push(bar); if (candlesRef.current.length > 1500) candlesRef.current.shift(); }
    subscriberRef.current?.(bar);
  }, [liveTick, symbol]);

  return <div ref={containerRef} className="sire-financial-chart" />;
}
