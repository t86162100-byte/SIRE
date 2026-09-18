import { useEffect, useMemo, useRef, useState } from 'react';
import 'openalgo-charts/indicators';
import 'openalgo-charts/draw';
import { DRAWING_TOOL_ICONS, iconSvg, registeredDrawingTools } from 'openalgo-charts/draw';
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
type DrawGroup = { label: string; tools: string[] };

const DRAW_RACK_GROUPS: DrawGroup[] = [
  { label: 'Cursor', tools: ['__cursor__'] },
  { label: 'Trend line', tools: ['trend-line', 'ray', 'extended-line', 'horizontal-line', 'horizontal-ray', 'vertical-line', 'cross-line', 'arrow'] },
  { label: 'Channels', tools: ['parallel-channel'] },
  { label: 'Fibonacci & Gann', tools: ['fib-retracement', 'fib-extension', 'fib-channel', 'fib-time-zone', 'fib-fan', 'gann-fan', 'gann-box', 'cyclic-lines', 'time-cycles', 'sine-line'] },
  { label: 'Patterns', tools: ['path', 'polyline', 'triangle', 'rotated-rectangle', 'double-curve'] },
  { label: 'Forecast & measure', tools: ['forecast', 'price-range', 'date-range', 'measure', 'long-position', 'short-position'] },
  { label: 'Shapes', tools: ['rectangle', 'ellipse', 'circle', 'arc', 'curve', 'highlighter', 'brush'] },
  { label: 'Annotation', tools: ['text', 'note', 'price-note', 'callout', 'comment', 'balloon', 'signpost', 'table', 'price-label', 'flag-mark'] },
  { label: 'Arrows & marks', tools: ['arrow-up', 'arrow-down', 'arrow-left', 'arrow-right'] },
];

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
  const [drawRackOpen, setDrawRackOpen] = useState(false);
  const [drawGroup, setDrawGroup] = useState(1);
  const [activeDrawTool, setActiveDrawTool] = useState<string | null>(null);
  const availableDrawTools = useMemo(() => new Set(['__cursor__', ...registeredDrawingTools().map(tool => tool.id)]), []);
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
    const host = containerRef.current;
    if (!host) return;
    const onDrawButton = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLElement>('[data-mobile-action="draw"]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      setDrawRackOpen(open => !open);
    };
    host.addEventListener('click', onDrawButton, true);
    return () => host.removeEventListener('click', onDrawButton, true);
  }, []);

  useEffect(() => {
    if (!drawRackOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawRackOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [drawRackOpen]);

  useEffect(() => {
    if (!drawRackOpen) return;
    const host = containerRef.current;
    if (!host) return;
    const onToolEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ tool?: string | null }>).detail;
      setActiveDrawTool(detail?.tool ?? null);
    };
    const off = host.addEventListener('draw:tool', onToolEvent as EventListener);
    return () => host.removeEventListener('draw:tool', onToolEvent as EventListener);
  }, [drawRackOpen]);

  useEffect(() => {
    if (!containerRef.current) return;
    const host = containerRef.current;
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
    const pitchBlackTheme = { ...widget.chart.theme(), background: '#000000' };
    widget.setTheme(pitchBlackTheme);
    widget.chart.applyOptions({ canvas: { background: '#000000' } });
    widgetRef.current = widget;
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
    } catch (error) {
      host.textContent = `OpenAlgo widget failed to initialize: ${error instanceof Error ? error.message : String(error)}`;
      host.style.padding = '24px';
      host.style.boxSizing = 'border-box';
      host.style.color = '#ff8080';
      host.style.background = '#080808';
      host.style.fontFamily = 'monospace';
      host.style.fontSize = '14px';
      throw error;
    }
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

  const visibleGroups = DRAW_RACK_GROUPS.map(group => ({
    ...group,
    tools: group.tools.filter(id => availableDrawTools.has(id)),
  })).filter(group => group.tools.length > 0);

  const currentGroup = visibleGroups[Math.min(drawGroup, Math.max(visibleGroups.length - 1, 0))] ?? visibleGroups[0];

  return (
    <div ref={containerRef} className={`sire-financial-chart${drawRackOpen ? ' sire-draw-rack-open' : ''}`}>
      {drawRackOpen && (
        <div className="sire-draw-rack" role="dialog" aria-label="Drawing tools">
          <div className="sire-draw-rack__rail">
            <button className="sire-draw-rack__close" type="button" aria-label="Close drawing tools" onClick={() => setDrawRackOpen(false)}>×</button>
            {visibleGroups.map((group, index) => (
              <button
                key={group.label}
                type="button"
                className={`sire-draw-rack__group${index === drawGroup ? ' is-active' : ''}`}
                onClick={() => setDrawGroup(index)}
                title={group.label}
                aria-label={group.label}
              >
                <span className="sire-draw-rack__group-icon">
                  {group.tools[0] === '__cursor__'
                    ? <span className="sire-draw-rack__cursor-glyph">＋</span>
                    : DRAWING_TOOL_ICONS[group.tools[0]] && <span dangerouslySetInnerHTML={{ __html: iconSvg(group.tools[0], { size: 22 }) }} />}
                </span>
                <span className="sire-draw-rack__group-label">{group.label}</span>
              </button>
            ))}
          </div>
          {currentGroup && (
            <div className="sire-draw-rack__panel">
              <div className="sire-draw-rack__panel-head">
                <strong>{currentGroup.label}</strong>
                <button type="button" onClick={() => setDrawRackOpen(false)} aria-label="Close">×</button>
              </div>
              <div className="sire-draw-rack__tools">
                {currentGroup.tools.map(toolId => {
                  if (toolId === '__cursor__') {
                    return (
                      <button
                        key="cursor"
                        type="button"
                        className={`sire-draw-rack__tool${activeDrawTool === null ? ' is-active' : ''}`}
                        title="Cursor"
                        onClick={() => {
                          widgetRef.current?.draw.setTool(null);
                          setActiveDrawTool(null);
                        }}
                      >
                        <span className="sire-draw-rack__tool-icon sire-draw-rack__cursor-glyph">＋</span>
                        <span>Cursor</span>
                      </button>
                    );
                  }
                  const tool = registeredDrawingTools().find(item => item.id === toolId);
                  if (!tool) return null;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      className={`sire-draw-rack__tool${activeDrawTool === tool.id ? ' is-active' : ''}`}
                      title={tool.name}
                      onClick={() => {
                        widgetRef.current?.draw.setTool(tool.id);
                        setActiveDrawTool(tool.id);
                      }}
                    >
                      <span className="sire-draw-rack__tool-icon" dangerouslySetInnerHTML={{ __html: iconSvg(tool.id, { size: 24 }) }} />
                      <span>{tool.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
