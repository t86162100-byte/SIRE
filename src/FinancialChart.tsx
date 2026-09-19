import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, History, MoreHorizontal, Pause, Play, Wrench, X } from 'lucide-react';
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
  const [activeTimeframe, setActiveTimeframe] = useState('1m');
  const [timeframeOpen, setTimeframeOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [drawRackOpen, setDrawRackOpen] = useState(false);
  const [marketQuote, setMarketQuote] = useState<{ price: number; percent: number } | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);

  const compactInstrumentName = (name: string) => {
    const first = name.trim().split(/\s+/)[0] || symbol;
    return `${first.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 5)}_`;
  };

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
      const latest = bars[bars.length - 1];
      const previous = bars[bars.length - 2];
      if (latest) {
        const percent = previous && previous.close !== 0
          ? ((latest.close - previous.close) / previous.close) * 100
          : 0;
        setMarketQuote({ price: latest.close, percent });
      }
    };

    const loadHistory = async (end?: number): Promise<Candle[]> => {
      const response = await derivMarketData.history(
        symbolRef.current,
        secondsFor(intervalRef.current),
        end,
        end === undefined ? 300 : 1000,
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
        const previousClose = previous?.close ?? next.open;
        const percent = previousClose !== 0 ? ((next.close - previousClose) / previousClose) * 100 : 0;
        setMarketQuote({ price: next.close, percent });
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
        const response = await derivMarketData.history(symbol, secondsFor(intervalRef.current), undefined, 300);
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

  const instrumentIndex = Math.max(0, instruments.findIndex(item => item.symbol === symbol));
  const previousInstrument = instruments[Math.max(0, instrumentIndex - 1)];
  const nextInstrument = instruments[Math.min(Math.max(0, instruments.length - 1), instrumentIndex + 1)];

  return (
    <div
      ref={hostRef}
      className="sire-financial-chart sire-toolbar-owner financial-chart-host"
      onContextMenu={event => event.preventDefault()}
      data-sire-market-data="deriv-direct"
    >
      {error && <div className="sire-chart-runtime-error">{error}</div>}

      <div className="sire-market-quote" aria-label={`Selected ${symbol}`}>
        <strong className="sire-market-quote__name">{instruments.find(item => item.symbol === symbol)?.name || symbol}</strong>
        <div className="sire-market-quote__value-row">
          <span className="sire-market-quote__price">{marketQuote ? marketQuote.price.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}</span>
          <span className={`sire-market-quote__change ${marketQuote && marketQuote.percent > 0 ? 'is-positive' : marketQuote && marketQuote.percent < 0 ? 'is-negative' : 'is-neutral'}`}>
            {marketQuote ? `${marketQuote.percent >= 0 ? '+' : ''}${marketQuote.percent.toFixed(2)}%` : '—'}
          </span>
        </div>
      </div>

      <button
        type="button"
        className="sire-chart-settings-button"
        aria-label="Chart settings"
        title="Chart settings"
        onClick={() => setMoreMenuOpen(open => !open)}
      >
        <MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>

      <div className="sire-bottom-glass-bar">
        <div className="sire-bottom-scroll-track">
          <div
            className="sire-bottom-instrument-swipe"
            title="Change instrument"
            onClick={onInstrumentTap}
          >
            <span className="sire-bottom-instrument-prev">{compactInstrumentName(previousInstrument?.name || '')}</span>
            <strong>{compactInstrumentName(instruments.find(item => item.symbol === symbol)?.name || symbol)}</strong>
            <span className="sire-bottom-instrument-next">{compactInstrumentName(nextInstrument?.name || '')}</span>
          </div>

          <div
            className="sire-bottom-timeframe"
            title="Choose timeframe"
            onClick={() => setTimeframeOpen(open => !open)}
          >
            <strong>{activeTimeframe}</strong>
          </div>

          <button type="button" className="sire-bottom-indicator-button" aria-label="Indicators" title="Indicators">
            <span className="sire-bottom-indicator-icon" aria-hidden="true">ƒ</span>
          </button>

          <button
            type="button"
            className="sire-bottom-replay-button"
            aria-label="Replay"
            title="Replay"
            onClick={() => setReplayOpen(open => !open)}
          >
            {replayOpen ? <Pause size={18} fill="currentColor" /> : <History size={20} />}
          </button>

          <button
            type="button"
            className="sire-bottom-tools-button"
            aria-label="Open OpenAlgo drawing tools"
            title="OpenAlgo drawing tools"
            onClick={() => setDrawRackOpen(open => !open)}
          >
            <Wrench size={22} strokeWidth={1.8} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="sire-bottom-multichart-button"
            aria-label="Open multi-chart manager"
            title="Multi-chart"
            onClick={() => window.dispatchEvent(new CustomEvent('sire:open-multichart'))}
          >
            <span className="sire-bottom-multichart-icon" aria-hidden="true"><span /><span /><span /></span>
          </button>

          <button
            type="button"
            className="sire-bottom-more-button"
            aria-label="More chart options"
            title="More chart options"
            onClick={() => setMoreMenuOpen(open => !open)}
          >
            <MoreHorizontal size={23} strokeWidth={2} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="sire-bottom-obj-button"
            aria-label="Objects"
            title="Objects"
          >
            <span aria-hidden="true">OBJ</span>
          </button>

          {timeframeOpen && (
            <div className="sire-bottom-timeframe-menu">
              {Object.keys(INTERVAL_SECONDS).map(interval => (
                <button
                  key={interval}
                  type="button"
                  className={interval === activeTimeframe ? 'active' : ''}
                  onClick={() => {
                    setActiveTimeframe(interval);
                    setTimeframeOpen(false);
                  }}
                >
                  {interval}
                </button>
              ))}
            </div>
          )}

          {moreMenuOpen && (
            <div className="sire-bottom-more-menu" role="menu" aria-label="Chart options">
              <div className="sire-bottom-more-menu__section">
                <div className="sire-bottom-more-menu__title">Chart type</div>
                <div className="sire-bottom-more-menu__chart-types">
                  {[
                    ['candlestick', 'Candles'],
                    ['hollow-candle', 'Hollow Candles'],
                    ['bar', 'Bars (OHLC)'],
                    ['line', 'Line'],
                    ['area', 'Area'],
                    ['baseline', 'Baseline'],
                  ].map(([id, label]) => (
                    <button key={id} type="button" role="menuitemradio" aria-checked={id === 'candlestick'}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="sire-bottom-more-menu__section sire-bottom-more-menu__actions">
                <button type="button" role="menuitem">Market Profile</button>
                <button type="button" role="menuitem">Capture PNG</button>
                <button type="button" role="menuitem">Export SVG</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {drawRackOpen && (
        <div
          className="sire-advanced-tools"
          aria-label="OpenAlgo drawing tools"
          style={{ left: 8, top: 58, right: 'auto' }}
        >
          <button type="button" onClick={() => setDrawRackOpen(false)}>OpenAlgo tools</button>
        </div>
      )}

      {replayOpen && (
        <div className="sire-replay-transport" role="dialog" aria-label="Chart replay controls">
          <div className="sire-replay-head">
            <span className="sire-replay-badge"><History size={13} /> REPLAY</span>
            <span className="sire-replay-clock">{activeTimeframe}</span>
            <span className="sire-replay-count">LIVE</span>
          </div>
          <div className="sire-replay-transport-row">
            <button type="button" aria-label="Previous"><ChevronLeft size={17} /></button>
            <button type="button" className="sire-replay-play" aria-label="Play"><Play size={16} fill="currentColor" /></button>
            <button type="button" aria-label="Next"><ChevronRight size={17} /></button>
            <button type="button" aria-label="Close replay" onClick={() => setReplayOpen(false)}><X size={17} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
