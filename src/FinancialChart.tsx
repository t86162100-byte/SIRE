import { useEffect, useRef, useState } from 'react';
import { registerInterval } from 'openalgo-charts';
import { createWidget, type Widget } from 'openalgo-charts/widget';
import { derivMarketData } from './derivMarketData';
import './financialChart.css';

type Instrument = { symbol: string; name: string; pipSize?: number };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

type Props = {
  symbol: string;
  instruments: Instrument[];
  onSelectInstrument: (instrument: Instrument) => void;
  onWidgetReady?: (widget: Widget) => void;
  onWidgetDestroyed?: (widget: Widget) => void;
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
  const widgetRef = useRef<Widget | null>(null);
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

    const setBars = (widget: Widget, bars: Candle[]) => {
      if (destroyedRef.current) return;
      widget.series.setData(bars);
      if (bars.length) widget.chart.timeScale.fitContent(160);
      oldestRef.current = bars[0]?.time ?? null;
      liveCandleRef.current = bars[bars.length - 1] ?? null;
    };

    const loadHistory = async (widget: Widget, end?: number): Promise<Candle[]> => {
      const response = await derivMarketData.history(symbolRef.current, secondsFor(intervalRef.current), end, 5000);
      const bars = toCandles(response);
      if (!bars.length) throw new Error(`Deriv returned no candles for ${symbolRef.current}.`);
      return bars;
    };

    let widget: Widget;
    try {
      // Deliberately do not pass an OpenAlgo feed here. OpenAlgo can render a
      // chart directly from widget.series.setData(), which removes the data
      // controller/cache layer from SIRE and makes Deriv the only data source.
      widget = createWidget(host, {
        symbol,
        interval: '1m',
        intervals: Object.keys(INTERVAL_SECONDS),
        chartType: 'candlestick',
        theme: 'dark',
        persist: false,
        mobile: 'auto',
        topbar: true,
        statusline: true,
      });
      widgetRef.current = widget;
      onWidgetReady?.(widget);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[SIRE][Chart] OpenAlgo widget failed to mount', e);
      setError(`Chart failed to open: ${message}`);
      return () => {};
    }

    const reload = async () => {
      try {
        setError('');
        const bars = await loadHistory(widget);
        setBars(widget, bars);
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
        widget.series.update(next);
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

    const stopInterval = widget.on('interval', () => {
      intervalRef.current = widget.interval();
      liveCandleRef.current = null;
      void reload();
    });

    const stopSymbol = widget.on('symbol', event => {
      symbolRef.current = event.symbol;
      const instrument = instruments.find(item => item.symbol === event.symbol);
      if (instrument) onSelectInstrument(instrument);
      liveCandleRef.current = null;
      void reload();
      void startLive();
    });

    widget.chart.setHistoryLoader(() => {
      const oldest = oldestRef.current;
      if (!Number.isFinite(oldest)) return;
      void loadHistory(widget, Math.floor((oldest as number) - 1))
        .then(older => {
          if (destroyedRef.current) return;
          const current = widget.series.getData();
          const merged = [...older, ...current].sort((a, b) => a.time - b.time);
          const unique = Array.from(new Map(merged.map(bar => [bar.time, bar])).values());
          widget.series.setData(unique);
          oldestRef.current = unique[0]?.time ?? oldestRef.current;
        })
        .catch(e => console.warn('[SIRE][Deriv older candles] failed', e))
        .finally(() => widget.chart.historyLoadComplete());
    });

    void reload();
    void startLive();

    return () => {
      destroyedRef.current = true;
      stopLive();
      stopInterval?.();
      stopSymbol?.();
      onWidgetDestroyed?.(widget);
      widget.destroy();
      widgetRef.current = null;
    };
  }, []);

  useEffect(() => {
    symbolRef.current = symbol;
    const widget = widgetRef.current;
    if (!widget || widget.symbol() === symbol) return;
    liveCandleRef.current = null;
    widget.setSymbol?.(symbol);
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
