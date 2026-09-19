import { useEffect, useRef, useState } from 'react';
import { createChart, registerInterval, type Chart } from 'openalgo-charts';
import { derivMarketData } from './derivMarketData';
import './financialChart.css';

type Instrument = { symbol: string; name: string; pipSize?: number };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

type Props = {
  symbol: string;
  instruments: Instrument[];
  onSelectInstrument: (instrument: Instrument) => void;
  onWidgetReady?: (chart: Chart) => void;
  onWidgetDestroyed?: (chart: Chart) => void;
  onInstrumentTap?: () => void;
};

const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60, '2m': 120, '3m': 180, '5m': 300, '10m': 600, '15m': 900,
  '20m': 1200, '30m': 1800, '45m': 2700, '1h': 3600, '2h': 7200,
  '3h': 10800, '4h': 14400, '6h': 21600, '8h': 28800, '12h': 43200,
  '1d': 86400, '1w': 604800,
};

for (const [code, seconds] of Object.entries(INTERVAL_SECONDS)) {
  if (!['1m', '5m', '15m', '1h', '1d', '1w'].includes(code)) {
    registerInterval({ code, bucketing: { mode: 'interval', seconds } });
  }
}

const secondsFor = (interval: string) => INTERVAL_SECONDS[interval] ?? 60;

function toCandles(response: Record<string, unknown>): Candle[] {
  const rows = Array.isArray(response.candles) ? response.candles : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    .map(row => ({
      time: Number(row.epoch),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number.isFinite(Number(row.volume)) ? Number(row.volume) : undefined,
    }))
    .filter(bar => [bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);
}

export default function FinancialChart({
  symbol,
  instruments,
  onSelectInstrument,
  onWidgetReady,
  onWidgetDestroyed,
  onInstrumentTap,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const seriesRef = useRef<ReturnType<Chart['addSeries']> | null>(null);
  const symbolRef = useRef(symbol);
  const intervalRef = useRef('1m');
  const oldestRef = useRef<number | null>(null);
  const liveCandleRef = useRef<Candle | null>(null);
  const liveUnsubscribeRef = useRef<(() => void) | null>(null);
  const liveSubscriptionIdRef = useRef<string | null>(null);
  const destroyedRef = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => { symbolRef.current = symbol; }, [symbol]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    destroyedRef.current = false;
    setError('');

    let chart: Chart;
    let series: ReturnType<Chart['addSeries']>;
    try {
      // Use OpenAlgo's base chart engine directly. This is still the same
      // openalgo-charts library; it removes only the widget chrome so there
      // is no second UI/data lifecycle involved in rendering the candles.
      // Use the documented base-engine construction path exactly: the host
      // supplies the dimensions and OpenAlgo owns the canvas inside it.
      chart = createChart(host, { timezone: 'UTC' });
      series = chart.addSeries('candlestick');
      chartRef.current = chart;
      seriesRef.current = series;
      onWidgetReady?.(chart);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[SIRE][Chart] OpenAlgo chart failed to mount', e);
      setError(`Chart failed to open: ${message}`);
      return () => {};
    }

    const setBars = (bars: Candle[]) => {
      if (destroyedRef.current) return;
      series.setData(bars);
      if (bars.length) chart.timeScale.fitContent(160);
      oldestRef.current = bars[0]?.time ?? null;
      liveCandleRef.current = bars[bars.length - 1] ?? null;
    };

    const loadHistory = async (end?: number): Promise<Candle[]> => {
      const response = await derivMarketData.history(
        symbolRef.current,
        secondsFor(intervalRef.current),
        end,
        5000,
      );
      const bars = toCandles(response);
      if (!bars.length) throw new Error(`Deriv returned no candles for ${symbolRef.current}.`);
      return bars;
    };

    const reload = async () => {
      try {
        setError('');
        const bars = await loadHistory();
        setBars(bars);
        console.info('[SIRE][Deriv candles]', {
          symbol: symbolRef.current,
          interval: intervalRef.current,
          returned: bars.length,
          oldest: bars[0]?.time ?? null,
          newest: bars[bars.length - 1]?.time ?? null,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('[SIRE][Deriv candles] history failed', e);
        setError(`Chart data failed: ${message}`);
      }
    };

    const stopLive = () => {
      liveUnsubscribeRef.current?.();
      liveUnsubscribeRef.current = null;
      const id = liveSubscriptionIdRef.current;
      liveSubscriptionIdRef.current = null;
      if (id) void derivMarketData.forget(id).catch(() => undefined);
    };

    const startLive = async () => {
      stopLive();
      const removeTick = derivMarketData.onTick(tick => {
        if (destroyedRef.current || tick.symbol !== symbolRef.current || !Number.isFinite(tick.quote)) return;
        const interval = secondsFor(intervalRef.current);
        const bucket = Math.floor(tick.epoch / interval) * interval;
        const previous = liveCandleRef.current;
        const next = !previous || bucket > previous.time
          ? { time: bucket, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote }
          : bucket === previous.time
            ? { ...previous, high: Math.max(previous.high, tick.quote), low: Math.min(previous.low, tick.quote), close: tick.quote }
            : previous;
        if (next === previous) return;
        liveCandleRef.current = next;
        series.update(next);
      });
      liveUnsubscribeRef.current = removeTick;
      try {
        const response = await derivMarketData.subscribe(symbolRef.current);
        const id = response.subscription?.id;
        if (id !== undefined) liveSubscriptionIdRef.current = String(id);
      } catch (e) {
        console.warn('[SIRE][Deriv live] subscription failed', e);
      }
    };

    chart.setHistoryLoader(() => {
      const oldest = oldestRef.current;
      if (!Number.isFinite(oldest)) return;
      void loadHistory(Math.floor((oldest as number) - 1))
        .then(older => {
          if (destroyedRef.current) return;
          const current = series.getData();
          const merged = [...older, ...current].sort((a, b) => a.time - b.time);
          const unique = Array.from(new Map(merged.map(bar => [bar.time, bar])).values());
          series.setData(unique);
          oldestRef.current = unique[0]?.time ?? oldestRef.current;
        })
        .catch(e => {
          console.warn('[SIRE][Deriv older candles] failed', e);
        })
        .finally(() => chart.historyLoadComplete());
    });

    void reload();
    void startLive();

    return () => {
      destroyedRef.current = true;
      stopLive();
      onWidgetDestroyed?.(chart);
      chart.destroy();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    symbolRef.current = symbol;
    const chart = chartRef.current;
    if (!chart) return;

    void (async () => {
      try {
        setError('');
        const response = await derivMarketData.history(symbol, secondsFor(intervalRef.current), undefined, 5000);
        const bars = toCandles(response);
        if (!bars.length) throw new Error(`Deriv returned no candles for ${symbol}.`);
        const series = seriesRef.current;
        if (!series || destroyedRef.current) return;
        series.setData(bars);
        chart.timeScale.fitContent(160);
        oldestRef.current = bars[0].time;
        liveCandleRef.current = bars[bars.length - 1];
      } catch (e) {
        if (destroyedRef.current) return;
        setError(`Chart data failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, [symbol]);

  return (
    <div
      ref={hostRef}
      className="sire-financial-chart financial-chart-host"
      onDoubleClick={onInstrumentTap}
      onContextMenu={event => event.preventDefault()}
      data-sire-market-data="deriv-direct"
    >
      {error && <div className="sire-chart-runtime-error">{error}</div>}
    </div>
  );
}
