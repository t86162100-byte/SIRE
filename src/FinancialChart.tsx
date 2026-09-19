import { useEffect, useRef } from 'react';
import { registerInterval } from 'openalgo-charts';
import { createWidget, type Widget } from 'openalgo-charts/widget';
import { derivMarketData } from './derivMarketData';
import './financialChart.css';

type Instrument = { symbol: string; name: string; pipSize?: number };
type Tick = { symbol: string; quote: number; epoch: number };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

type Props = {
  symbol: string;
  isActive?: boolean;
  liveTick?: Tick | null;
  instruments: Instrument[];
  onSelectInstrument: (instrument: Instrument) => void;
  onWidgetReady?: (widget: Widget) => void;
  onWidgetDestroyed?: (widget: Widget) => void;
  onInstrumentTap?: () => void;
};

const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60,
  '2m': 120,
  '3m': 180,
  '5m': 300,
  '10m': 600,
  '15m': 900,
  '20m': 1200,
  '30m': 1800,
  '45m': 2700,
  '1h': 3600,
  '2h': 7200,
  '3h': 10800,
  '4h': 14400,
  '6h': 21600,
  '8h': 28800,
  '12h': 43200,
  '1d': 86400,
  '1w': 604800,
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
    .filter(bar =>
      Number.isFinite(bar.time) &&
      Number.isFinite(bar.open) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close),
    )
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
  const latestBarRef = useRef<Candle | null>(null);
  const loadingHistoryRef = useRef(false);
  const exhaustedRef = useRef(false);
  const unsubscribeLiveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    symbolRef.current = symbol;
  }, [symbol]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let destroyed = false;

    const loadHistory = async (end?: number): Promise<Candle[]> => {
      const currentSymbol = symbolRef.current;
      const interval = intervalRef.current;
      const response = await derivMarketData.history(currentSymbol, secondsFor(interval), end, 5000);
      const bars = toCandles(response);

      if (bars.length) {
        oldestRef.current = bars[0].time;
        latestBarRef.current = bars[bars.length - 1];
        exhaustedRef.current = false;
      } else if (end !== undefined) {
        exhaustedRef.current = true;
      }

      return bars;
    };

    const feed = {
      getBars: async (request: { symbol: string; interval: string; from?: number; to?: number }) => {
        intervalRef.current = request.interval;
        const end = Number.isFinite(request.to) ? Number(request.to) : undefined;
        const bars = await loadHistory(end);
        console.info('[SIRE][Deriv history]', {
          symbol: request.symbol,
          interval: request.interval,
          requestedEnd: end ?? 'latest',
          returned: bars.length,
          oldest: bars[0]?.time ?? null,
          newest: bars[bars.length - 1]?.time ?? null,
        });
        return bars;
      },

      subscribeBars: (
        request: { symbol: string; interval: string },
        onBar: (bar: Candle) => void,
      ) => {
        const interval = secondsFor(request.interval);
        let last: Candle | null = latestBarRef.current;

        const remove = derivMarketData.onTick(tick => {
          if (tick.symbol !== request.symbol || !Number.isFinite(tick.quote)) return;

          const bucket = Math.floor(tick.epoch / interval) * interval;
          if (!last || bucket > last.time) {
            last = {
              time: bucket,
              open: tick.quote,
              high: tick.quote,
              low: tick.quote,
              close: tick.quote,
            };
          } else if (bucket === last.time) {
            last = {
              ...last,
              high: Math.max(last.high, tick.quote),
              low: Math.min(last.low, tick.quote),
              close: tick.quote,
            };
          } else {
            return;
          }

          latestBarRef.current = last;
          onBar(last);
        });

        void derivMarketData.subscribe(request.symbol).catch(error => {
          console.warn('[SIRE][Deriv live] subscription failed', error);
        });

        return () => remove();
      },
    };

    const widget = createWidget(host, {
      symbol,
      interval: '1m',
      intervals: Object.keys(INTERVAL_SECONDS),
      persist: false,
      timezone: 'Africa/Lagos',
      feed,
      loading: {
        pageSize: 5000,
      },
      topbar: {
        symbol: true,
        interval: true,
        chartType: true,
        indicators: true,
        drawings: true,
        settings: true,
      },
    });

    widgetRef.current = widget;

    const loadOlder = () => {
      if (destroyed || loadingHistoryRef.current || exhaustedRef.current) return;
      const oldest = oldestRef.current;
      if (!Number.isFinite(oldest)) return;

      loadingHistoryRef.current = true;
      void loadHistory(Math.floor((oldest as number) - 1))
        .then(bars => {
          if (destroyed || !bars.length) return;
          const older = bars.filter(bar => bar.time < (oldestRef.current ?? Infinity));
          if (!older.length) {
            exhaustedRef.current = true;
            return;
          }

          const prepend = (widget.series as any).prependData;
          if (typeof prepend === 'function') {
            prepend.call(widget.series, older);
          } else {
            const current = widget.series.getData?.() ?? [];
            widget.series.setData([...older, ...current].sort((a: Candle, b: Candle) => a.time - b.time));
          }

          oldestRef.current = older[0].time;
          console.info('[SIRE][Deriv older history]', {
            symbol: symbolRef.current,
            interval: intervalRef.current,
            requestedEnd: oldest - 1,
            returned: older.length,
            oldest: older[0].time,
            newest: older[older.length - 1].time,
          });
        })
        .catch(error => {
          console.warn('[SIRE][Deriv older history] request failed; retry remains available', error);
        })
        .finally(() => {
          loadingHistoryRef.current = false;
        });
    };

    widget.chart.setHistoryLoader(loadOlder);
    onWidgetReady?.(widget);

    const stopInterval = widget.on('interval', (event: { interval: string }) => {
      intervalRef.current = event.interval;
      oldestRef.current = null;
      latestBarRef.current = null;
      exhaustedRef.current = false;
    });

    const stopSymbol = widget.on('symbol', (event: { symbol: string }) => {
      symbolRef.current = event.symbol;
      oldestRef.current = null;
      latestBarRef.current = null;
      exhaustedRef.current = false;

      const instrument = instruments.find(item => item.symbol === event.symbol);
      if (instrument) onSelectInstrument(instrument);
    });

    return () => {
      destroyed = true;
      unsubscribeLiveRef.current?.();
      unsubscribeLiveRef.current = null;
      stopInterval?.();
      stopSymbol?.();
      onWidgetDestroyed?.(widget);
      widget.destroy();
      widgetRef.current = null;
      oldestRef.current = null;
      latestBarRef.current = null;
    };
  }, []);

  useEffect(() => {
    symbolRef.current = symbol;
    const widget = widgetRef.current;
    if (!widget || widget.symbol() === symbol) return;
    oldestRef.current = null;
    latestBarRef.current = null;
    exhaustedRef.current = false;
    widget.setSymbol?.(symbol);
  }, [symbol]);

  return (
    <div
      ref={hostRef}
      className="sire-financial-chart financial-chart-host"
      onDoubleClick={onInstrumentTap}
      onContextMenu={event => event.preventDefault()}
      data-sire-market-data="deriv-direct"
    />
  );
}
