import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Eye, History, Lock, Minus, MoreHorizontal, Pause, Play, RotateCcw, Settings2, SkipBack, SkipForward, Trash2, Wrench, X } from 'lucide-react';
import { registerInterval, ReplayController, registeredIndicators, type ReplayState } from 'openalgo-charts';
import { registeredDrawingTools } from 'openalgo-charts/draw';
import 'openalgo-charts/indicators';
import 'openalgo-charts/draw';
import 'openalgo-charts/trade';
import 'openalgo-charts/transform';
import 'openalgo-charts/profile';
import 'openalgo-charts/webgl';
import { createWidget, type Widget } from 'openalgo-charts/widget';
import './financialChart.css';

type Instrument = { symbol: string; name: string; pipSize?: number };
type Props = {
  symbol: string;
  isActive?: boolean;
  instruments: Instrument[];
  onSelectInstrument: (instrument: Instrument) => void;
  onWidgetReady?: (widget: Widget) => void;
  onWidgetDestroyed?: (widget: Widget) => void;
  onInstrumentTap?: () => void;
};

const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60, '2m': 120, '3m': 180, '5m': 300, '10m': 600, '15m': 900, '20m': 1200,
  '30m': 1800, '45m': 2700, '1h': 3600, '2h': 7200, '3h': 10800, '4h': 14400,
  '6h': 21600, '8h': 28800, '12h': 43200, '1d': 86400, '1w': 604800,
};
const CHART_INTERVALS = Object.keys(INTERVAL_SECONDS);
for (const [code, seconds] of Object.entries(INTERVAL_SECONDS)) {
  if (!['1m', '5m', '15m', '1h', '1d', '1w'].includes(code)) registerInterval({ code, bucketing: { mode: 'interval', seconds } });
}
const CHART_TYPES = [
  { id: 'candlestick', label: 'Candles' }, { id: 'hollow-candle', label: 'Hollow Candles' },
  { id: 'volume-candle', label: 'Volume Candles' }, { id: 'bar', label: 'Bars (OHLC)' },
  { id: 'high-low', label: 'High-Low' }, { id: 'line', label: 'Line' },
  { id: 'line-markers', label: 'Line + Markers' }, { id: 'step', label: 'Step Line' },
  { id: 'area', label: 'Area' }, { id: 'hlc-area', label: 'HLC Area' },
  { id: 'baseline', label: 'Baseline' }, { id: 'columns', label: 'Columns' }, { id: 'histogram', label: 'Histogram' },
] as const;
const REPLAY_SPEEDS = [0.5, 1, 2, 5, 10] as const;
const replaySpeedLabel = (speed: number) => `${speed}×`;
function resolveTrendLinePoints(sourceBars: any[], visibleRange: any, tool: string) {
  if (!Array.isArray(sourceBars) || sourceBars.length < 2) return [];
  const from = visibleRange && Number.isFinite(Number(visibleRange.from)) ? Math.max(0, Math.floor(Number(visibleRange.from))) : 0;
  const to = visibleRange && Number.isFinite(Number(visibleRange.to)) ? Math.min(sourceBars.length - 1, Math.ceil(Number(visibleRange.to))) : sourceBars.length - 1;
  const bars = sourceBars.slice(from, to + 1).filter((bar: any) =>
    Number.isFinite(Number(bar?.high)) && Number.isFinite(Number(bar?.low)) && bar?.time !== undefined
  );
  if (bars.length < 2) return [];

  if (tool === 'horizontal-line') {
    const price = Number(bars[bars.length - 1].close ?? bars[bars.length - 1].high);
    return [{ time: bars[0].time, price }, { time: bars[bars.length - 1].time, price }];
  }

  if (bars.length < 6) {
    return [
      { time: bars[0].time, price: Number(bars[0].close ?? bars[0].high) },
      { time: bars[bars.length - 1].time, price: Number(bars[bars.length - 1].close ?? bars[bars.length - 1].low) },
    ];
  }

  // Determine the dominant direction from closes, then anchor the line to actual swing
  // highs for a downtrend or swing lows for an uptrend. This prevents a model from
  // inventing time/price coordinates and avoids drawing through the middle of candles.
  const n = bars.length;
  const meanX = (n - 1) / 2;
  const meanY = bars.reduce((sum: number, bar: any) => sum + Number(bar.close ?? ((Number(bar.high) + Number(bar.low)) / 2)), 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i += 1) {
    const y = Number(bars[i].close ?? ((Number(bars[i].high) + Number(bars[i].low)) / 2));
    num += (i - meanX) * (y - meanY);
    den += (i - meanX) * (i - meanX);
  }
  const slope = den ? num / den : 0;
  const down = slope < 0;
  const radius = Math.max(2, Math.min(5, Math.floor(n / 40)));
  const pivots: Array<{ i: number; price: number }> = [];

  for (let i = radius; i < n - radius; i += 1) {
    const price = down ? Number(bars[i].high) : Number(bars[i].low);
    const window = bars.slice(i - radius, i + radius + 1).map((bar: any) => down ? Number(bar.high) : Number(bar.low));
    const extreme = down ? Math.max(...window) : Math.min(...window);
    if (Math.abs(price - extreme) <= Math.max(1e-9, Math.abs(price) * 1e-10)) pivots.push({ i, price });
  }

  // Pick the strongest pair of pivots that forms a clean trendline. For a downtrend,
  // highs should stay at or below the line; for an uptrend, lows should stay at or above it.
  if (pivots.length >= 2) {
    let best: { score: number; first: typeof pivots[number]; last: typeof pivots[number] } | null = null;
    const tolerance = Math.max(1e-8, (Math.max(...bars.map((b: any) => Number(b.high))) - Math.min(...bars.map((b: any) => Number(b.low)))) * 0.015);
    for (let a = 0; a < pivots.length - 1; a += 1) {
      for (let b = a + 1; b < pivots.length; b += 1) {
        const first = pivots[a], last = pivots[b];
        if (last.i - first.i < Math.max(3, Math.floor(n * 0.08))) continue;
        const pairSlope = (last.price - first.price) / (last.i - first.i);
        if (down && pairSlope >= 0) continue;
        if (!down && pairSlope <= 0) continue;
        let touches = 0, violations = 0, error = 0;
        for (const pivot of pivots) {
          const expected = first.price + pairSlope * (pivot.i - first.i);
          const distance = pivot.price - expected;
          if (Math.abs(distance) <= tolerance) touches += 1;
          if (down ? distance > tolerance : distance < -tolerance) violations += 1;
          error += Math.min(Math.abs(distance), tolerance * 4);
        }
        const spanBonus = (last.i - first.i) / n;
        const score = touches * 8 + spanBonus * 4 - violations * 12 - error / Math.max(tolerance, 1e-9);
        if (!best || score > best.score) best = { score, first, last };
      }
    }
    if (best) {
      return [
        { time: bars[best.first.i].time, price: best.first.price },
        { time: bars[best.last.i].time, price: best.last.price },
      ];
    }

    const first = pivots[0];
    const last = pivots[pivots.length - 1];
    return [
      { time: bars[first.i].time, price: first.price },
      { time: bars[last.i].time, price: last.price },
    ];
  }

  const split = Math.floor(n / 2);
  const firstIndex = down
    ? bars.slice(0, split).reduce((best: number, bar: any, i: number) => Number(bar.high) > Number(bars[best].high) ? i : best, 0)
    : bars.slice(0, split).reduce((best: number, bar: any, i: number) => Number(bar.low) < Number(bars[best].low) ? i : best, 0);
  const secondBars = bars.slice(split);
  const secondLocal = down
    ? secondBars.reduce((best: number, bar: any, i: number) => Number(bar.high) > Number(secondBars[best].high) ? i : best, 0)
    : secondBars.reduce((best: number, bar: any, i: number) => Number(bar.low) < Number(secondBars[best].low) ? i : best, 0);
  const lastIndex = split + secondLocal;
  return [
    { time: bars[firstIndex].time, price: down ? Number(bars[firstIndex].high) : Number(bars[firstIndex].low) },
    { time: bars[lastIndex].time, price: down ? Number(bars[lastIndex].high) : Number(bars[lastIndex].low) },
  ];
}

function resolveRectanglePoints(sourceBars: any[], visibleRange: any) {
  if (!Array.isArray(sourceBars) || sourceBars.length < 2) return [];
  const from = visibleRange && Number.isFinite(Number(visibleRange.from)) ? Math.max(0, Math.floor(Number(visibleRange.from))) : 0;
  const to = visibleRange && Number.isFinite(Number(visibleRange.to)) ? Math.min(sourceBars.length - 1, Math.ceil(Number(visibleRange.to))) : sourceBars.length - 1;
  const visible = sourceBars.slice(from, to + 1).filter((bar: any) =>
    Number.isFinite(Number(bar?.high)) && Number.isFinite(Number(bar?.low)) && bar?.time !== undefined
  );
  if (visible.length < 2) return [];
  const windowSize = Math.max(8, Math.min(40, Math.floor(visible.length * 0.28)));
  const zone = visible.slice(-windowSize);
  const low = Math.min(...zone.map((bar: any) => Number(bar.low)));
  const high = Math.max(...zone.map((bar: any) => Number(bar.high)));
  const first = zone[0];
  const last = zone[zone.length - 1];
  return [
    { time: first.time, price: low },
    { time: last.time, price: high },
  ];
}

type DiagnosticLocation = { file: string; line: number; column: number; functionName?: string };
type ChartDiagnostic = DerivFeedDiagnostic & { id: number; timestamp: number; stack?: string; location?: DiagnosticLocation; operation?: string };

function parseDiagnosticLocation(stack?: string): DiagnosticLocation | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n').map(line => line.trim()).filter(Boolean);
  for (const frame of lines) {
    const v8 = frame.match(/^at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    const firefox = frame.match(/^(.*?)@(.+?):(\d+):(\d+)$/);
    const match = v8 || firefox;
    if (!match) continue;
    const functionName = v8 ? (v8[1] || '').trim() : (firefox ? (firefox[1] || '').trim() : '');
    const file = v8 ? v8[2] : firefox![2];
    const line = Number(v8 ? v8[3] : firefox![3]);
    const column = Number(v8 ? v8[4] : firefox![4]);
    if (file && Number.isFinite(line) && Number.isFinite(column)) return { file, line, column, functionName: functionName || undefined };
  }
  return undefined;
}

type SourceMapSegment = { generatedColumn:number; source?:number; originalLine?:number; originalColumn?:number; name?:number };
function decodeBase64Vlq(value:string){const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let result=0,shift=0;for(const char of value){const digit=chars.indexOf(char);if(digit<0)throw new Error('Invalid source-map VLQ digit.');result+=(digit&31)*2**shift;shift+=5;if(!(digit&32))return(result&1)?-(result>>1):result>>1;}throw new Error('Incomplete source-map VLQ segment.');}
function decodeSourceMapLine(encoded:string,previous:{source:number;originalLine:number;originalColumn:number;name:number}){const segments:SourceMapSegment[]=[];let generatedColumn=0,source=previous.source,originalLine=previous.originalLine,originalColumn=previous.originalColumn,name=previous.name;for(const raw of encoded.split(',')){if(!raw)continue;const values:number[]=[];let token='';for(const char of raw){token+=char;try{values.push(decodeBase64Vlq(token));token='';}catch{}}if(token||!values.length)continue;generatedColumn+=values[0];if(values.length>=4){source+=values[1];originalLine+=values[2];originalColumn+=values[3];if(values.length>=5)name+=values[4];segments.push({generatedColumn,source,originalLine,originalColumn,name});}}previous.source=source;previous.originalLine=originalLine;previous.originalColumn=originalColumn;previous.name=name;return segments;}
async function resolveSourceMappedLocation(location?:DiagnosticLocation):Promise<DiagnosticLocation|undefined>{if(!location||typeof window==='undefined'||!/\/assets\/[^/]+\.js$/i.test(location.file))return location;try{const bundleUrl=new URL(location.file,window.location.href);const mapUrl=new URL(bundleUrl.href+'.map');const response=await fetch(mapUrl.href,{credentials:'same-origin',cache:'force-cache'});if(!response.ok)return location;const map=await response.json();if(map?.version!==3||typeof map.mappings!=='string'||!Array.isArray(map.sources))return location;const lineIndex=Math.max(0,location.line-1);const lines=map.mappings.split(';');if(lineIndex>=lines.length)return location;const state={source:0,originalLine:0,originalColumn:0,name:0};let segments:SourceMapSegment[]=[];for(let i=0;i<=lineIndex;i++)segments=decodeSourceMapLine(lines[i]||'',state);const target=Math.max(0,location.column-1);const segment=[...segments].reverse().find(item=>item.generatedColumn<=target&&item.source!==undefined&&item.originalLine!==undefined&&item.originalColumn!==undefined);if(!segment||segment.source===undefined||segment.originalLine===undefined||segment.originalColumn===undefined)return location;const sourceUrl=new URL(String(map.sources[segment.source]||''),new URL(String(map.sourceRoot||'./'),mapUrl.href));const sourcePath=new URL(sourceUrl.href).pathname;const sourceMarker=sourcePath.indexOf('/src/');return{file:sourceMarker>=0?sourcePath.slice(sourceMarker+1):sourcePath,line:segment.originalLine+1,column:segment.originalColumn+1,functionName:location.functionName};}catch{return location;}}

function diagnosticErrorDetails(error: unknown, operation?: string) {
  const stack = error instanceof Error ? error.stack : undefined;
  return { stack, location: parseDiagnosticLocation(stack), operation };
}

function analyzeChartHealth(events: ChartDiagnostic[], snapshot: { bars: number; tickAgeMs: number | null; width: number; height: number; hasCanvas: boolean; hasPrimarySeries: boolean }) {
  const latest = [...events].reverse();
  const find = (code: string) => latest.find(event => event.code === code);
  const runtime = find('CHART_FRONTEND_ERROR') || find('CHART_UNHANDLED_REJECTION');
  if (runtime) return { state: 'ISSUE', subsystem: 'Browser/runtime', cause: runtime.message, evidence: 'SIRE captured the browser exception directly.', next: 'Use the copied error/stack entry to locate the exact failing component or source line.' };
  if (find('CHART_ZERO_SIZE')) return { state: 'ISSUE', subsystem: 'Layout/DOM', cause: 'The chart container has no usable dimensions.', evidence: snapshot.width + '×' + snapshot.height + 'px was measured.', next: 'Fix the parent layout or visibility before debugging market data.' };
  if (!snapshot.hasCanvas) return { state: 'ISSUE', subsystem: 'Chart renderer', cause: 'No chart canvas is mounted.', evidence: 'The chart host contains no canvas element.', next: 'Inspect widget creation, renderer initialization and teardown.' };
  if (!snapshot.hasPrimarySeries) return { state: 'ISSUE', subsystem: 'OpenAlgo chart API', cause: 'The primary price series is unavailable through widget.chart.', evidence: 'SIRE could not obtain widget.chart.primarySeries().', next: 'Inspect the installed OpenAlgo Charts API/version and object shape.' };
  if (find('HISTORY_PAGE_EMPTY') && snapshot.bars > 0) {
    const event = find('HISTORY_PAGE_EMPTY')!;
    return {
      state: 'HEALTHY',
      subsystem: 'OpenAlgo history controller',
      cause: 'OpenAlgo reached the oldest history available from Deriv for this instrument and timeframe.',
      evidence: event.detail || 'Deriv returned no older candles for OpenAlgo\'s requested cursor.',
      next: 'No further history is available from the provider for this timeframe.',
    };
  }
  if (find('HISTORY_PAGE_LOADED') && snapshot.bars > 0) { const event = find('HISTORY_PAGE_LOADED')!; return { state: 'HEALTHY', subsystem: 'OpenAlgo history controller', cause: `${snapshot.bars} candles are currently retained by OpenAlgo.`, evidence: event.detail || 'OpenAlgo dataController loaded and merged an older history page.', next: 'Keep panning left; OpenAlgo owns the next-page request, cursor, merge and viewport anchoring.' }; }
  if (snapshot.bars === 0 || find('HISTORY_EMPTY') || find('HISTORY_LOAD_FAILED')) { const event = find('HISTORY_LOAD_FAILED') || find('HISTORY_EMPTY'); return { state: 'ISSUE', subsystem: 'Deriv history', cause: event?.message || 'No historical candles are available.', evidence: event?.detail || 'The primary series contains zero usable OHLC bars.', next: 'Check the SIRE history endpoint, Deriv response and symbol/granularity validation.' }; }
  if (find('LIVE_TICK_SUBSCRIPTION_FAILED')) { const event = find('LIVE_TICK_SUBSCRIPTION_FAILED')!; return { state: 'ISSUE', subsystem: 'Deriv live transport', cause: event.message, evidence: event.detail || 'The live subscription did not complete.', next: 'Check the /deriv/ws proxy, Deriv public WebSocket and subscription response.' }; }
  if (find('LIVE_TICK_STALE') || (snapshot.tickAgeMs !== null && snapshot.tickAgeMs > 10000)) return { state: 'ISSUE', subsystem: 'Deriv live transport', cause: 'The live tick stream is stale.', evidence: snapshot.tickAgeMs === null ? 'No live tick timestamp exists.' : Math.round(snapshot.tickAgeMs / 1000) + 's since the last tick.', next: 'Check the browser→SIRE WebSocket→Deriv path and reconnect state.' };
  if (find('LIVE_RENDER_LAG')) { const event = find('LIVE_RENDER_LAG')!; return { state: 'ISSUE', subsystem: 'Live chart update', cause: 'Fresh Deriv ticks are arriving but the primary series is not reflecting the latest price.', evidence: event.detail || 'The fresh quote and chart close differ.', next: 'Inspect tick-to-bar conversion and the series.update path.' }; }
  if (snapshot.bars > 0 && snapshot.hasPrimarySeries && snapshot.hasCanvas && (snapshot.tickAgeMs === null || snapshot.tickAgeMs < 10000)) return { state: 'HEALTHY', subsystem: 'End-to-end chart', cause: 'No active chart fault is detected.', evidence: snapshot.bars + ' candles loaded; series and canvas are present; live data is not stale.', next: 'Continue monitoring. New faults will be appended to the persistent log.' };
  return { state: 'CHECKING', subsystem: 'Chart health monitor', cause: 'SIRE is still checking the chart.', evidence: 'Layout, renderer, history, live transport and price updates are being checked.', next: 'Keep diagnostics open while the checks run.' };
}

function diagnosticLabel(level: ChartDiagnostic['level']) { return level === 'error' ? 'ERROR' : level === 'warning' ? 'WARNING' : 'OK'; }

function diagnosticText(event: ChartDiagnostic) {
  const when = new Date(event.timestamp).toISOString();
  const location = event.location ? `\nLocation: ${event.location.file}:${event.location.line}:${event.location.column}${event.location.functionName ? ` (${event.location.functionName})` : ''}` : '';
  const operation = event.operation ? `\nOperation: ${event.operation}` : '';
  const stack = event.stack ? `\nStack:\n${event.stack}` : '';
  return `[${when}] ${diagnosticLabel(event.level)} · ${event.code}\n${event.message}${event.detail ? `\nDetail: ${event.detail}` : ''}${operation}${location}${stack}`;
}

async function copyDiagnosticText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

function ChartDiagnosticsPanel({ open, events, symbol, interval, quoteAgeMs, bars, renderer, width, height, hasCanvas, hasPrimarySeries, onClose, onRetry }: { open: boolean; events: ChartDiagnostic[]; symbol: string; interval: string; quoteAgeMs: number | null; bars: number; renderer: string; width: number; height: number; hasCanvas: boolean; hasPrimarySeries: boolean; onClose: () => void; onRetry: () => void }) {
  const [copiedId, setCopiedId] = useState<number | 'all' | null>(null);
  if (!open) return null;
  const activeError = [...events].reverse().find(event => event.level === 'error');
  const liveText = quoteAgeMs === null ? 'No live tick received yet' : Math.round(quoteAgeMs / 1000) + 's since last live tick';
  const diagnosis = analyzeChartHealth(events, { bars, tickAgeMs: quoteAgeMs, width, height, hasCanvas, hasPrimarySeries });
  const historyOlder = events.filter(event => event.code === 'HISTORY_PAGE_LOADED').length;
  const historyRequests = events.filter(event => event.code === 'HISTORY_PAGE_REQUESTED').length;
  const allText = events.map(diagnosticText).join('\n\n');
  const copy = async (id: number | 'all', value: string) => { if (await copyDiagnosticText(value)) { setCopiedId(id); window.setTimeout(() => setCopiedId(current => current === id ? null : current), 1400); } };
  return <div className="sire-chart-diagnostics" role="dialog" aria-label="Chart diagnostics">
    <div className="sire-chart-diagnostics__head"><div><strong>Chart diagnostics</strong><small>{symbol} · {interval} · {events.length} log entries · continuous monitoring</small></div><div className="sire-chart-diagnostics__head-actions"><button type="button" className="sire-chart-diagnostics__copy-all" onClick={() => void copy('all', allText)} disabled={!events.length}>{copiedId === 'all' ? 'Copied' : 'Copy all'}</button><button type="button" onClick={onClose} aria-label="Close chart diagnostics">×</button></div></div>
    <div className={'sire-chart-diagnostics__diagnosis is-' + diagnosis.state.toLowerCase()}><div><b>{diagnosis.state === 'HEALTHY' ? 'Chart is healthy' : diagnosis.state === 'ISSUE' ? 'Issue identified' : 'Checking chart'}</b><span>{diagnosis.subsystem}</span></div><strong>What is happening: </strong>{diagnosis.cause}<small><b>Evidence:</b> {diagnosis.evidence}</small><small><b>Next check:</b> {diagnosis.next}</small></div>
    <div className="sire-chart-diagnostics__metrics"><span>History <b>{bars}</b></span><span>Older pages <b>{historyOlder}</b> / {historyRequests}</span><span>Live <b>{liveText}</b></span><span>Renderer <b>{renderer}</b></span><span>Canvas <b>{width}×{height}</b></span><span>Series <b>{hasPrimarySeries ? 'OK' : 'Missing'}</b></span></div>
    {activeError && <div className="sire-chart-diagnostics__active"><b>{diagnosticLabel(activeError.level)} · {activeError.code}</b><span>{activeError.message}</span>{activeError.detail && <small>Why: {activeError.detail}</small>}{activeError.location && <small><b>Location:</b> {activeError.location.file}:{activeError.location.line}:{activeError.location.column}{activeError.location.functionName ? ` · ${activeError.location.functionName}` : ''}</small>}{activeError.operation && <small><b>Operation:</b> {activeError.operation}</small>}<button type="button" onClick={onRetry}>Retry chart data</button></div>}
    <div className="sire-chart-diagnostics__list">{events.length ? events.map(event => <div key={event.id} className={'sire-chart-diagnostics__event is-' + event.level}><div><b>{diagnosticLabel(event.level)} · {event.code}</b><time>{new Date(event.timestamp).toLocaleTimeString()}</time><button type="button" className="sire-chart-diagnostics__copy" onClick={() => void copy(event.id, diagnosticText(event))}>{copiedId === event.id ? 'Copied' : 'Copy'}</button></div><span>{event.message}</span>{event.detail && <small>{event.detail}</small>}{event.operation && <small><b>Operation:</b> {event.operation}</small>}{event.location && <small><b>Location:</b> {event.location.file}:{event.location.line}:{event.location.column}{event.location.functionName ? ` · ${event.location.functionName}` : ''}</small>}{event.stack && <details className="sire-chart-diagnostics__stack"><summary>Call stack</summary><pre>{event.stack}</pre></details>}</div>) : <div className="sire-chart-diagnostics__empty">No chart faults detected. Monitoring all chart layers continuously.</div>}</div>
  </div>;
}
import { createDerivDataFeed, DERIV_INTERVAL_SECONDS, tickToBar, type DerivBar, type DerivInstrument, type DerivFeedDiagnostic } from './derivMarketData';

export { type DerivInstrument, type DerivBar } from './derivMarketData';

export default function FinancialChart({ symbol, isActive = false, instruments, onSelectInstrument, onWidgetReady, onWidgetDestroyed, onInstrumentTap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawRackOpen, setDrawRackOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [compareQuery, setCompareQuery] = useState('');
  const [comparisons, setComparisons] = useState<string[]>([]);
  const [replayActive, setReplayActive] = useState(false);
  const [replayState, setReplayState] = useState<ReplayState | null>(null);
  const [replaySetupOpen, setReplaySetupOpen] = useState(false);
  const [replayStartInput, setReplayStartInput] = useState('');
  const [replayEndInput, setReplayEndInput] = useState('');
  const [replayRangeError, setReplayRangeError] = useState<string | null>(null);
  const [replayDraftSpeed, setReplayDraftSpeed] = useState(1);
  const [replayStartMin, setReplayStartMin] = useState('');
  const [replayNow, setReplayNow] = useState('');
  const replaySpeedRef = useRef(1);
  const replayStartInputRef = useRef('');
  const replayEndInputRef = useRef('');
  const [rendererKind, setRendererKind] = useState<'canvas2d' | 'webgl2'>('canvas2d');
  const [tpoEnabled, setTpoEnabled] = useState(false);
  const [marketQuote, setMarketQuote] = useState<{ price: number; percent: number } | null>(null);
  const lastLiveQuoteRef = useRef<{ symbol: string; price: number; epoch: number } | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ChartDiagnostic[]>([]);
  const diagnosticsRef = useRef<ChartDiagnostic[]>([]);
  const diagnosticIdRef = useRef(0);
  diagnosticsRef.current = diagnostics;
  const lastTickAtRef = useRef<number | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [selectedDrawing, setSelectedDrawing] = useState<{ id: string; sourceId: string; name: string; visible: boolean; locked: boolean } | null>(null);
  const [selectedDrawingPosition, setSelectedDrawingPosition] = useState<{ left: number; top: number } | null>(null);
  const [selectedIndicator, setSelectedIndicator] = useState<{ id: string; name: string; paneIndex: number } | null>(null);
  const [selectedIndicatorPosition, setSelectedIndicatorPosition] = useState<{ left: number; top: number } | null>(null);
  const selectedIndicatorRef = useRef<{ id: string; name: string; paneIndex: number } | null>(null);
  const [swipeInstrumentIndex, setSwipeInstrumentIndex] = useState(() => Math.max(0, instruments.findIndex(item => item.symbol === symbol)));
  const swipeStartYRef = useRef<number | null>(null);
  const swipeAccumulatedRef = useRef(0);
  const swipeAnimatingRef = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const timeframeHoldTimerRef = useRef<number | null>(null);
  const timeframeHoldTriggeredRef = useRef(false);
  const timeframeSwipeStartYRef = useRef(0);
  const timeframeSwipeAccumulatedRef = useRef(0);
  const timeframeSwipeAnimatingRef = useRef(false);
  const [timeframeOpen, setTimeframeOpen] = useState(false);
  const [activeTimeframe, setActiveTimeframe] = useState('1m');
  const [swipeAnimation, setSwipeAnimation] = useState<'up' | 'down' | null>(null);
  const widgetRef = useRef<Widget | null>(null);
  const replayRef = useRef<ReplayController | null>(null);
  const replayModeRef = useRef(false);
  const replayCleanupRef = useRef<(() => void) | null>(null);
  const drawingInspectionRef = useRef<{ symbol: string; timeframe: string; capturedAt: number; id: string } | null>(null);

  const dataFeedRef = useRef<ReturnType<typeof createDerivDataFeed> | null>(null);
  const instrumentsRef = useRef(instruments);
  const onSelectInstrumentRef = useRef(onSelectInstrument);
  const symbolRef = useRef(symbol);
  const timeframeRef = useRef(activeTimeframe);
  const initialViewportContextRef = useRef('');
  instrumentsRef.current = instruments;
  onSelectInstrumentRef.current = onSelectInstrument;
  symbolRef.current = symbol;
  timeframeRef.current = activeTimeframe;
  replayStartInputRef.current = replayStartInput;
  replayEndInputRef.current = replayEndInput;

  const marketInstrument = instruments.find(item => item.symbol === symbol);
  const marketInstrumentName = marketInstrument?.name || symbol;

  const reportDiagnostic = (event: DerivFeedDiagnostic & { stack?: string; location?: DiagnosticLocation; operation?: string }) => {
    const now = Date.now();
    const item: ChartDiagnostic = { ...event, id: ++diagnosticIdRef.current, timestamp: now };
    const add = (resolved: ChartDiagnostic) => {
      setDiagnostics(current => {
        const last = current[current.length - 1];
        if (last && last.code === resolved.code && last.message === resolved.message && now - last.timestamp < 5000) return current;
        return [...current, resolved];
      });
      if (resolved.level === 'error') setDiagnosticsOpen(true);
    };
    if (item.location?.file && /\/assets\/[^/]+\.js$/i.test(item.location.file)) {
      void resolveSourceMappedLocation(item.location).then(location => add({ ...item, location }));
    } else {
      add(item);
    }
  };

  const getChartTimeScale = (chart: any) => {
    const value = chart?.timeScale;
    if (typeof value === 'function') return value.call(chart);
    return value;
  };

  const formatMarketPrice = (price: number) => {
    if (!Number.isFinite(price)) return '—';
    const pipSize = Number(marketInstrument?.pipSize);
    const decimals = Number.isFinite(pipSize) && pipSize > 0
      ? Math.max(0, Math.min(8, Math.ceil(-Math.log10(pipSize))))
      : 2;
    return price.toFixed(decimals);
  };

  useEffect(() => {
    const nextIndex = instruments.findIndex(item => item.symbol === symbol);
    if (nextIndex >= 0) setSwipeInstrumentIndex(nextIndex);
  }, [instruments, symbol]);

  const compactInstrumentName = (name: string) => {
    const first = name.trim().split(/\s+/)[0] || symbol;
    return `${first.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 5)}_`;
  };

  const swipeInstrument = (direction: 1 | -1) => {
    if (!instruments.length) return;
    const currentIndex = Math.max(0, instruments.findIndex(item => item.symbol === symbol));
    const nextIndex = Math.max(0, Math.min(instruments.length - 1, currentIndex + direction));
    const next = instruments[nextIndex];
    if (next && next.symbol !== symbol) onSelectInstrument(next);
  };

  const triggerSwipeStep = (direction: 1 | -1) => {
    if (!instruments.length) return;
    const currentIndex = Math.max(0, instruments.findIndex(item => item.symbol === symbol));
    const nextIndex = Math.max(0, Math.min(instruments.length - 1, currentIndex + direction));
    if (nextIndex === currentIndex) return;
    setSwipeAnimation(direction > 0 ? 'up' : 'down');
    swipeInstrument(direction);
    window.setTimeout(() => setSwipeAnimation(null), 320);
  };

  const clearTimeframeHold = () => {
    if (timeframeHoldTimerRef.current !== null) {
      window.clearTimeout(timeframeHoldTimerRef.current);
      timeframeHoldTimerRef.current = null;
    }
  };

  const selectTimeframe = (interval: string) => {
    const widget = widgetRef.current;
    if (!widget) return;
    setActiveTimeframe(interval);
    setTimeframeOpen(false);
    widget.setInterval(interval);
  };

  const handleTimeframePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    timeframeSwipeStartYRef.current = event.clientY;
    timeframeSwipeAccumulatedRef.current = 0;
    timeframeHoldTriggeredRef.current = false;
    clearTimeframeHold();
    timeframeHoldTimerRef.current = window.setTimeout(() => {
      timeframeHoldTriggeredRef.current = true;
      setTimeframeOpen(true);
    }, 600);
  };

  const handleTimeframePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (timeframeHoldTriggeredRef.current) return;
    const delta = event.clientY - timeframeSwipeStartYRef.current;
    if (Math.abs(delta) >= 8) clearTimeframeHold();
    if (Math.abs(delta) < 45 || timeframeSwipeAnimatingRef.current) return;
    const direction: 1 | -1 = delta < 0 ? 1 : -1;
    const currentIndex = CHART_INTERVALS.indexOf(activeTimeframe);
    const nextIndex = Math.max(0, Math.min(CHART_INTERVALS.length - 1, currentIndex + direction));
    if (nextIndex !== currentIndex) {
      timeframeSwipeAnimatingRef.current = true;
      selectTimeframe(CHART_INTERVALS[nextIndex]);
      window.setTimeout(() => { timeframeSwipeAnimatingRef.current = false; }, 280);
    }
    timeframeSwipeStartYRef.current = event.clientY;
    timeframeSwipeAccumulatedRef.current = 0;
  };

  const handleTimeframePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    clearTimeframeHold();
    timeframeHoldTriggeredRef.current = false;
    timeframeSwipeStartYRef.current = 0;
    timeframeSwipeAccumulatedRef.current = 0;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const clearInstrumentHold = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handleInstrumentPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    swipeStartYRef.current = event.clientY;
    swipeAccumulatedRef.current = 0;
    holdTriggeredRef.current = false;
    clearInstrumentHold();
    holdTimerRef.current = window.setTimeout(() => {
      if (swipeStartYRef.current !== null) {
        holdTriggeredRef.current = true;
        onInstrumentTap?.();
      }
    }, 600);
  };

  const handleInstrumentPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStartYRef.current;
    if (start === null) return;
    const delta = event.clientY - start;
    if (Math.abs(delta) >= 18 && !holdTriggeredRef.current) clearInstrumentHold();
    if (Math.abs(delta) < 55 || swipeAnimatingRef.current || holdTriggeredRef.current) return;
    triggerSwipeStep(delta < 0 ? 1 : -1);
    swipeAnimatingRef.current = true;
    swipeStartYRef.current = event.clientY;
    swipeAccumulatedRef.current = 0;
    window.setTimeout(() => { swipeAnimatingRef.current = false; }, 320);
  };

  const handleInstrumentPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    clearInstrumentHold();
    swipeStartYRef.current = null;
    swipeAccumulatedRef.current = 0;
    holdTriggeredRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const syncReplayState = () => {
    const replay = replayRef.current;
    if (!replay) return;
    setReplayState(replay.state());
  };

  const clearReplayListeners = () => {
    replayCleanupRef.current?.();
    replayCleanupRef.current = null;
  };

  const resetReplayUi = () => {
    replayRef.current = null;
    replayModeRef.current = false;
    widgetRef.current?.dataController?.setPaused(false);
    setReplayActive(false);
    setReplayState(null);
    setReplaySetupOpen(false);
  };

  const stopReplay = () => {
    const replay = replayRef.current;
    if (replay) {
      // ReplayController restores the exact pre-replay series and viewport.
      // Its stop must happen before live delivery is resumed.
      replay.stop();
    }
    clearReplayListeners();
    resetReplayUi();
  };

  const toggleReplay = () => {
    const replay = replayRef.current;
    if (replay) {
      if (replay.state().playing) replay.pause();
      else replay.play({ speed: replaySpeedRef.current });
      syncReplayState();
      return;
    }

    setReplayRangeError(null);
    refreshReplayBounds();
    setReplaySetupOpen(open => !open);
  };

  const replayStep = () => {
    replayRef.current?.step();
    syncReplayState();
  };

  const replayStepBack = () => {
    replayRef.current?.stepBack();
    syncReplayState();
  };

  const replayJumpStart = () => {
    replayRef.current?.seek(0);
    syncReplayState();
  };

  const replayJumpEnd = () => {
    const replay = replayRef.current;
    if (!replay) return;
    replay.seek(Math.max(0, replay.state().total - 1));
    syncReplayState();
  };

  const replaySeek = (index: number) => {
    replayRef.current?.seek(index);
    syncReplayState();
  };

  const setReplaySpeed = (speed: number) => {
    replaySpeedRef.current = speed;
    setReplayDraftSpeed(speed);
    const replay = replayRef.current;
    if (replay?.state().playing) replay.play({ speed });
    syncReplayState();
  };

  const formatReplayInputTime = (epoch: number) => {
    const date = new Date(epoch * 1000);
    const pad = (value: number) => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  };

  const refreshReplayBounds = () => {
    const widget = widgetRef.current;
    const series = widget?.chart.primarySeries();
    const seriesBars = (series?.getData?.() || []) as DerivBar[];
    const sorted = [...seriesBars]
      .filter(bar => Number.isFinite(bar?.time))
      .sort((a, b) => a.time - b.time);

    const oldest = sorted[0]?.time;
    const latestLoaded = sorted[sorted.length - 1]?.time;
    const now = Math.floor(Date.now() / 1000);
    const latest = Math.min(now, latestLoaded ?? now);

    if (!Number.isFinite(oldest) || !Number.isFinite(latest) || latest <= (oldest as number)) {
      setReplayRangeError('No usable historical candles are loaded yet.');
      return false;
    }

    const minText = formatReplayInputTime(oldest as number);
    const maxText = formatReplayInputTime(latest as number);
    setReplayStartMin(minText);
    setReplayNow(maxText);

    const parse = (value: string) => {
      const ms = value ? new Date(value).getTime() : NaN;
      return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    };

    const currentStart = parse(replayStartInput) ?? (oldest as number);
    const currentEnd = parse(replayEndInput) ?? latest;
    const cappedStart = Math.max(oldest as number, Math.min(latest, currentStart));
    const cappedEnd = Math.max(cappedStart, Math.min(latest, currentEnd));

    setReplayStartInput(formatReplayInputTime(cappedStart));
    setReplayEndInput(formatReplayInputTime(cappedEnd));
    return true;
  };

  const startReplayFromInputs = async (fromBeginning: boolean, _toLatest: boolean) => {
    setReplayRangeError(null);

    const widget = widgetRef.current;
    if (!widget) {
      setReplayRangeError('Chart is still loading.');
      return;
    }

    const series = widget.chart.primarySeries();
    if (!series?.getData) {
      setReplayRangeError('Chart history is not available for replay yet.');
      return;
    }

    // A new replay always replaces the previous controller cleanly.
    if (replayRef.current) stopReplay();

    let allBars = (series.getData() || []) as DerivBar[];
    if (!allBars.length) {
      try {
        await widget.reload();
        allBars = (series.getData() || []) as DerivBar[];
      } catch (error) {
        setReplayRangeError(error instanceof Error ? error.message : 'Unable to load chart history for replay.');
        return;
      }
    }

    // ReplayController expects a stable, chronological session. Keep one bar
    // per timestamp and never mutate the array after handing it to OpenAlgo.
    const byTime = new Map<number, DerivBar>();
    for (const bar of allBars) {
      if (
        Number.isFinite(bar?.time) &&
        Number.isFinite(bar?.open) &&
        Number.isFinite(bar?.high) &&
        Number.isFinite(bar?.low) &&
        Number.isFinite(bar?.close)
      ) {
        byTime.set(bar.time, { ...bar });
      }
    }
    allBars = [...byTime.values()].sort((a, b) => a.time - b.time);

    if (allBars.length < 2) {
      setReplayRangeError('Not enough chart history is loaded for replay.');
      return;
    }

    const parseReplayTime = (value: string) => {
      if (!value) return null;
      const ms = new Date(value).getTime();
      return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    };

    const leftEdge = allBars[0].time;
    const latestLoadedTime = allBars[allBars.length - 1].time;
    const now = Math.floor(Date.now() / 1000);
    const latestAllowedTime = Math.min(now, latestLoadedTime);

    const requestedStart = fromBeginning ? leftEdge : parseReplayTime(replayStartInputRef.current);
    if (!fromBeginning && replayStartInputRef.current && requestedStart === null) {
      setReplayRangeError('Invalid replay start date/time.');
      return;
    }

    const requestedEnd = parseReplayTime(replayEndInputRef.current) ?? latestAllowedTime;
    if (replayEndInputRef.current && requestedEnd === null) {
      setReplayRangeError('Invalid replay end date/time.');
      return;
    }

    const startTime = Math.max(leftEdge, Math.min(latestAllowedTime, requestedStart ?? leftEdge));
    const endTime = Math.max(startTime, Math.min(latestAllowedTime, requestedEnd));

    if (endTime <= startTime) {
      setReplayRangeError('Replay end must be after the replay start.');
      return;
    }

    // ReplayController's startIndex is the visible playhead inside the FULL
    // session. Passing only the selected slice with startIndex=0 would leave
    // the chart with a one-bar prefix at replay start, and can also leave the
    // widget's logical viewport anchored outside that prefix. Keep the loaded
    // history through the selected end as the replay session and point the
    // controller at the selected start bar.
    const sessionBars = allBars.filter(bar => bar.time <= endTime);
    const startIndex = sessionBars.findIndex(bar => bar.time >= startTime);
    if (startIndex < 0 || sessionBars.length <= startIndex || sessionBars.length < 2) {
      setReplayRangeError('Not enough loaded history exists in the selected replay range.');
      return;
    }

    // OpenAlgo's managed-data guidance requires the data controller to stay
    // paused for the entire replay lifetime. ReplayController then owns the
    // primary series, indicators, time axis and viewport until stop().
    // OpenAlgo ReplayController snapshots the chart viewport before replay
    // starts and preserves barSpacing/rightOffset while it advances the
    // playhead. Do not force a logical range here: when the playhead is near
    // the beginning of the session, clamping a range to state.index makes only
    // a handful of candles fill the whole chart and they appear oversized.
    widget.dataController?.setPaused(true);
    replayModeRef.current = true;

    let replay: ReplayController | null = null;
    try {
      const handleState = (state: ReplayState) => {
        // ReplayController owns the viewport during replay. We only mirror its
        // state into SIRE's transport UI.
        setReplayState(state);
      };
      const offStart = widget.chart.on('replay:start', handleState);
      const offFrame = widget.chart.on('replay:frame', handleState);
      const offPlay = widget.chart.on('replay:play', handleState);
      const offPause = widget.chart.on('replay:pause', handleState);
      const offEnd = widget.chart.on('replay:end', handleState);
      const offStop = widget.chart.on('replay:stop', () => {
        clearReplayListeners();
        resetReplayUi();
      });

      replayCleanupRef.current = () => {
        offStart();
        offFrame();
        offPlay();
        offPause();
        offEnd();
        offStop();
      };

      replay = new ReplayController(widget.chart, {
        series,
        bars: sessionBars,
        startIndex,
        barMs: 1000,
        speed: replaySpeedRef.current,
        onFrame: handleState,
      });

      replayRef.current = replay;
      setReplayActive(true);
      setReplaySetupOpen(false);
      setReplayState(replay.state());
    } catch (error) {
      clearReplayListeners();
      replayModeRef.current = false;
      widget.dataController?.setPaused(false);
      setReplayState(null);
      setReplayActive(false);
      setReplayRangeError(error instanceof Error ? error.message : 'OpenAlgo replay could not be started.');
    }
  };

  useEffect(() => {
    if (!replaySetupOpen || replayActive) return;
    refreshReplayBounds();
  }, [replaySetupOpen, replayActive, symbol, activeTimeframe]);

  const toggleTpo = () => setTpoEnabled(value => !value);

  useEffect(() => {
    if (!drawRackOpen) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawRackOpen(false); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [drawRackOpen]);

  useEffect(() => {
    if (!containerRef.current) return;
    const host = containerRef.current;
    let widget: Widget;
    try {
      const feed = dataFeedRef.current || createDerivDataFeed(quote => {
        if (quote.symbol !== symbolRef.current) return;
        lastTickAtRef.current = Date.now();
        lastLiveQuoteRef.current = quote;
        if (replayModeRef.current) return;
        const series = widgetRef.current?.chart.primarySeries();
        const bars = (series?.getData?.() || []) as DerivBar[];
        const previous = bars[bars.length - 1] || null;
        const seconds = DERIV_INTERVAL_SECONDS[timeframeRef.current] || 60;
        const next = tickToBar(previous, quote.epoch, quote.price, seconds);
        if (series?.update) series.update(next);
        // Keep the live bar count/axis chrome on the same hot path as the price.
        // The chart engine coalesces update() calls into the next render frame, so
        // both the forming candle and its price metadata move together.
        const previousClosed = bars.length > 1 ? bars[bars.length - 2] : null;
        const percent = previousClosed?.close ? ((quote.price - previousClosed.close) / previousClosed.close) * 100 : 0;
        setMarketQuote({ price: quote.price, percent });
        // Healthy tick updates are intentionally not logged individually; the monitor checks their effect on the chart.
      }, reportDiagnostic);
      dataFeedRef.current = feed;
      widget = createWidget(host, {
        symbol,
        exchange: 'DERIV',
        feed,
        interval: '1m',
        intervals: CHART_INTERVALS,
        chartType: 'candlestick',
        theme: 'dark',
        renderer: 'canvas2d',
        navigation: { mousePan: 'both', defaultVisibleBars: 10 },
        lookbackBars: 500,
        animZoom: true,
        animAutoscale: true,
        branding: false,
        rail: true,
        persist: `sire-${symbol}`,
        topbar: false,
        statusline: true,
        indicators: true,
        mobile: 'never',
        timezone: 'Africa/Lagos',
        axisChrome: { sessionClock: true, barCountdown: true },
        // OpenAlgo's public chart option controls the actual canvas indicator legend stack.
        legendOffset: { top: 540, left: 8 },
        symbolSearch: async (query: string) => instrumentsRef.current
          .filter(item => `${item.name} ${item.symbol}`.toLowerCase().includes(query.trim().toLowerCase()))
          .slice(0, 50)
          .map(item => ({ symbol: item.symbol, name: item.name })),
      });
      const pitchBlackTheme = { ...widget.chart.theme(), background: '#000000' };
      widget.setTheme(pitchBlackTheme);
      widget.chart.applyOptions({ canvas: { background: '#000000' } });
      widget.chart.setAutoScale?.(true);
      widget.chart.resetScale?.();
      widget.chart.applyOptions({ crosshair: { mode: 'normal' } });
      setRendererKind(widget.chart.rendererKind);
      const offRenderer = widget.chart.on('renderer:fallback', () => { setRendererKind('canvas2d'); reportDiagnostic({ level: 'warning', code: 'CHART_RENDERER_FALLBACK', message: 'Chart renderer fell back to Canvas 2D.', detail: 'The requested renderer was unavailable, so the chart switched rendering backends.' }); });
      widgetRef.current = widget;
      setActiveTimeframe(widget.interval());
      const offInterval = widget.on('interval', (event: { interval: string }) => {
        if (replayRef.current) stopReplay();
        setActiveTimeframe(event.interval);
        timeframeRef.current = event.interval;
        initialViewportContextRef.current = '';
        setMarketQuote(null);
        lastTickAtRef.current = null;
        lastLiveQuoteRef.current = null;
        reportDiagnostic({ level: 'info', code: 'CHART_CONTEXT_CHANGED', message: 'Chart context changed to ' + symbol + '; preserving the existing diagnostic history.', detail: 'The issue log continues across instrument changes and timeframes.' });
      });
      const offSymbol = widget.on('symbol', (event: { symbol: string }) => {
        if (replayRef.current) stopReplay();
        const instrument = instrumentsRef.current.find(item => item.symbol === event.symbol);
        if (instrument && instrument.symbol !== symbolRef.current) {
          symbolRef.current = instrument.symbol;
          initialViewportContextRef.current = '';
          onSelectInstrumentRef.current(instrument);
        }
      });
      const syncQuoteFromSeries = () => {
        const live = lastLiveQuoteRef.current;
        if (live && live.symbol === symbolRef.current && Math.floor(Date.now() / 1000) - live.epoch < 10) return;
        const bars = (widget.chart.primarySeries()?.getData?.() || []) as DerivBar[];
        const last = bars[bars.length - 1];
        if (!last || !Number.isFinite(last.close)) return;
        const previous = bars.length > 1 ? bars[bars.length - 2] : null;
        const percent = previous?.close ? ((last.close - previous.close) / previous.close) * 100 : 0;
        setMarketQuote({ price: last.close, percent });
      };
      const offData = widget.on('data', (event: any) => {
        if (event?.error) {
          const error = event.error instanceof Error ? event.error : new Error(String(event.error));
          reportDiagnostic({ level: 'error', code: 'CHART_DATA_ERROR', message: 'Chart data load failed: ' + error.message, detail: 'The chart data controller reported a history/load failure.', ...diagnosticErrorDetails(error, 'openalgo widget data event') });
        }
        syncQuoteFromSeries();

        // OpenAlgo owns the loaded history. This only establishes a readable initial viewport;
        // it does not change the retained history or loading window.
        const series = widget.chart.primarySeries();
        const bars = (series?.getData?.() || []) as DerivBar[];
        const contextKey = `${symbolRef.current}:${timeframeRef.current}`;
        if (!event?.error && bars.length > 0 && initialViewportContextRef.current !== contextKey) {
          initialViewportContextRef.current = contextKey;
          const visibleBars = timeframeRef.current === '1d' || timeframeRef.current === '1w' ? 32 : 40;
          window.requestAnimationFrame(() => {
            if (widgetRef.current !== widget) return;
            const currentSeries = widget.chart.primarySeries();
            const currentBars = (currentSeries?.getData?.() || []) as DerivBar[];
            if (!currentBars.length) return;
            const to = currentBars.length - 1;
            const from = Math.max(0, to - visibleBars + 1);
            getChartTimeScale(widget.chart)?.setVisibleLogicalRange?.({ from, to });
          });
        }
      });

      // OpenAlgo Charts dataController owns history paging, retention, merging and viewport anchoring.
      const updateDrawingOverlay = (drawing: any) => {
        if (!drawing) { setSelectedDrawingPosition(null); return; }
        const rect = host.getBoundingClientRect();
        setSelectedDrawingPosition({ left: Math.max(90, rect.width / 2), top: Math.max(90, rect.height / 2 - 70) });
      };
      const updateIndicatorOverlay = (indicator: { id: string; name: string; paneIndex: number } | null) => {
        if (!indicator) { setSelectedIndicatorPosition(null); return; }
        const rect = host.getBoundingClientRect();
        setSelectedIndicatorPosition({ left: Math.max(8, Math.min(rect.width - 92, 8 + Math.max(46, indicator.name.length * 6.5 + 8))), top: 14 });
      };
      const offIndicatorObjects = widget.objects.subscribe(objects => {
        positionOverlayIndicatorLegends();
        const current = selectedIndicatorRef.current;
        if (!current) return;
        const item = objects.find(object => object.kind === 'indicator' && object.id === current.id);
        if (!item) {
          selectedIndicatorRef.current = null;
          setSelectedIndicator(null);
          setSelectedIndicatorPosition(null);
          return;
        }
        const next = { id: item.id, name: item.name, paneIndex: item.paneIndex };
        selectedIndicatorRef.current = next;
        setSelectedIndicator(next);
        updateIndicatorOverlay(next);
      });
      const offDrawingObjects = widget.objects.subscribe(objects => {
        const drawing = objects.find(object => object.kind === 'drawing' && object.selected);
        setSelectedDrawing(drawing ? {
          id: drawing.id, sourceId: drawing.sourceId, name: drawing.name,
          visible: drawing.visible, locked: drawing.locked === true,
        } : null);
        updateDrawingOverlay(drawing);
      });
      const offDrawingSelect = widget.chart.on('drawing:select', () => {
        const drawing = widget.objects.selection?.().find?.((item: any) => item?.kind === 'drawing');
        if (drawing) updateDrawingOverlay(drawing);
      });
      onWidgetReady?.(widget);
      return () => {
        replayRef.current?.stop();
        clearReplayListeners();
        replayRef.current = null;
        replayModeRef.current = false;
        widget.dataController?.setPaused(false);
        offSymbol?.(); offInterval?.(); offRenderer?.(); offData?.();
        offIndicatorObjects?.(); offDrawingObjects?.(); offDrawingSelect?.();
        dataFeedRef.current?.close?.();
        dataFeedRef.current = null;
        onWidgetDestroyed?.(widget); widget.destroy(); widgetRef.current = null;
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportDiagnostic({ level: 'error', code: 'CHART_WIDGET_INIT_FAILED', message: 'OpenAlgo widget failed to initialize: ' + message, detail: 'Widget construction threw before the chart could finish initializing.', ...diagnosticErrorDetails(error, 'createWidget') });
      host.textContent = `OpenAlgo widget failed to initialize: ${message}`;
      host.style.padding = '24px'; host.style.boxSizing = 'border-box'; host.style.color = '#ff8080';
      host.style.background = '#080808'; host.style.fontFamily = 'monospace'; host.style.fontSize = '14px';
      throw error;
    }
  }, []);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget || widget.isDestroyed || !symbol) return;
    if (widget.symbol() === symbol) return;

    if (replayRef.current) {
      replayRef.current.stop();
      replayRef.current = null;
      replayModeRef.current = false;
      clearReplayListeners();
      widget.dataController?.setPaused(false);
      setReplayActive(false);
      setReplayState(null);
    }

    initialViewportContextRef.current = '';
    setMarketQuote(null);
    lastTickAtRef.current = null;
    lastLiveQuoteRef.current = null;

    try {
      widget.setSymbol(symbol, 'DERIV');
      if (widget.symbol() !== symbol) {
        reportDiagnostic({
          level: 'error',
          code: 'CHART_SYMBOL_CHANGE_FAILED',
          message: 'Chart did not accept instrument change to ' + symbol + '.',
          detail: 'The SIRE instrument selector changed state, but the OpenAlgo chart widget did not switch its primary market-data symbol.',
        });
      }
    } catch (error) {
      reportDiagnostic({
        level: 'error',
        code: 'CHART_SYMBOL_CHANGE_FAILED',
        message: 'Chart instrument change failed: ' + (error instanceof Error ? error.message : String(error)),
        detail: 'The OpenAlgo chart widget threw while switching its primary market-data symbol.',
      });
    }
  }, [symbol]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const onWindowError = (event: ErrorEvent) => {
      const error = event.error instanceof Error ? event.error : new Error(event.message || 'A frontend error occurred while the chart was running.');
      reportDiagnostic({ level: 'error', code: 'CHART_FRONTEND_ERROR', message: event.message || error.message, detail: 'SIRE captured the browser exception directly.', ...diagnosticErrorDetails(error, 'window.error') });
    };
    const onUnhandled = (event: PromiseRejectionEvent) => {
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Unknown rejection'));
      reportDiagnostic({ level: 'error', code: 'CHART_UNHANDLED_REJECTION', message: 'An unhandled chart promise failed: ' + error.message, detail: 'SIRE captured an unhandled promise rejection.', ...diagnosticErrorDetails(error, 'window.unhandledrejection') });
    };
    window.addEventListener('error', onWindowError); window.addEventListener('unhandledrejection', onUnhandled);
    const timer = window.setInterval(() => {
      const widget = widgetRef.current; const series = widget?.chart?.primarySeries(); const bars = (series?.getData?.() || []) as DerivBar[]; const rect = host.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) { reportDiagnostic({ level: 'error', code: 'CHART_ZERO_SIZE', message: 'The chart container has no usable size.', detail: 'Measured ' + Math.round(rect.width) + '×' + Math.round(rect.height) + 'px.' }); return; }
      if (!bars.length) {
        const recentHistoryRequest = diagnosticsRef.current.some(event =>
          (event.code === 'HISTORY_REQUEST_STARTED' || event.code === 'HISTORY_PAGE_REQUESTED') &&
          Date.now() - event.timestamp < 15000
        );
        if (recentHistoryRequest) {
          reportDiagnostic({
            level: 'info',
            code: 'CHART_WAITING_FOR_HISTORY',
            message: 'Waiting for OpenAlgo history data.',
            detail: 'The OpenAlgo dataController has an active history request; the empty primary series is expected until that request completes.',
          });
        } else {
          reportDiagnostic({
            level: 'error',
            code: 'CHART_NO_CANDLES',
            message: 'No historical candles are currently loaded.',
            detail: 'The price pane has no primary OHLC data to render and no active OpenAlgo history request is in progress.',
          });
        }
        return;
      }
      const instrument = instrumentsRef.current.find(item => item.symbol === symbolRef.current); const marketClosed = instrument?.exchangeOpen === 0 || instrument?.tradingSuspended === 1; const tickAge = lastTickAtRef.current === null ? null : Date.now() - lastTickAtRef.current;
      if (!marketClosed && tickAge === null) reportDiagnostic({ level: 'warning', code: 'LIVE_PRICE_NOT_RECEIVED', message: 'No live price has been received yet.', detail: 'History is present, but the Deriv tick stream has not delivered a quote.' });
      if (!marketClosed && tickAge !== null && tickAge > 10000) reportDiagnostic({ level: 'error', code: 'LIVE_TICK_STALE', message: 'Live price updates are stale: ' + Math.round(tickAge / 1000) + 's since the last tick.', detail: 'The live tick stream or the SIRE-to-chart delivery path stopped updating.' });
      const live = lastLiveQuoteRef.current; const last = bars[bars.length - 1];
      if (live && tickAge !== null && tickAge < 5000 && Math.abs(last.close - live.price) > Math.max(Math.abs(live.price) * 1e-8, 1e-10)) reportDiagnostic({ level: 'warning', code: 'LIVE_RENDER_LAG', message: 'A fresh live tick arrived, but the chart candle has not caught up.', detail: 'Live price=' + live.price + '; chart close=' + last.close + '. The chart rendering/data-update path is lagging.' });
      if (!Number.isFinite(last.close)) reportDiagnostic({ level: 'error', code: 'CANDLE_PRICE_INVALID', message: 'The latest candle contains an invalid close price.', detail: 'The price pane cannot safely render this OHLC value.' });
      if (!host.querySelector('canvas')) reportDiagnostic({ level: 'error', code: 'CHART_CANVAS_MISSING', message: 'The chart has data but no canvas renderer is present.', detail: 'The chart surface is missing from the DOM.' });
    }, 2500);
    return () => { window.clearInterval(timer); window.removeEventListener('error', onWindowError); window.removeEventListener('unhandledrejection', onUnhandled); };
  }, [symbol]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Keep the bridge available while this chart component remains mounted.
    // GPT requests can be issued from the chat surface while the chart tab is
    // not the foreground tab; tying the bridge lifetime to isActive caused
    // valid chart-control commands to time out with no browser error.
    const controls = {
      execute: async (operations: any[]) => {
        const widget = widgetRef.current;
        const chart: any = widget?.chart;
        if (!widget || !chart || widget.isDestroyed) throw new Error('Active chart is not ready.');
        const results: any[] = [];
        const scale = () => getChartTimeScale(chart);
        const logical = () => scale()?.getVisibleLogicalRange?.() || chart.getVisibleLogicalRange?.() || null;
        const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));
        const drawingSnapshot = () => {
          const draw: any = (widget as any).draw;
          const list = typeof draw?.drawings === 'function' ? draw.drawings() : [];
          return (Array.isArray(list) ? list : []).map((item: any) => ({
            id: item.id,
            tool: item.tool,
            name: String(registeredDrawingTools().find((tool: any) => tool.id === item.tool)?.name || item.tool),
            paneIndex: item.paneIndex,
            points: Array.isArray(item.points) ? item.points.map((point: any) => ({ time: Number(point.time), price: Number(point.price) })) : [],
            style: item.style || {},
            text: item.text || null,
            props: item.props || null,
            locked: item.locked === true,
            visible: item.visible !== false,
            zIndex: Number(item.zIndex ?? 0),
            createdAt: item.createdAt ?? null,
          }));
        };
        const verifyDrawingRendered = (drawing: any) => {
          const rect = host.getBoundingClientRect();
          const paneIndex = Number.isInteger(Number(drawing?.paneIndex)) ? Number(drawing.paneIndex) : 0;
          const points = Array.isArray(drawing?.points) ? drawing.points : [];
          const mapped = points.map((point: any) => ({
            time: Number(point.time),
            price: Number(point.price),
            x: Number(chart.timeToCoordinate?.(Number(point.time))),
            y: Number(chart.priceToCoordinate?.(Number(point.price), paneIndex)),
          }));
          const coordinatesValid = mapped.length > 0 && mapped.every((point: any) =>
            Number.isFinite(point.x) && Number.isFinite(point.y)
          );
          const coordinatesVisible = coordinatesValid && mapped.every((point: any) =>
            point.x >= -2 && point.x <= rect.width + 2 &&
            point.y >= -2 && point.y <= rect.height + 2
          );
          return {
            coordinates: mapped,
            coordinatesValid,
            coordinatesVisible,
            visible: drawing?.visible !== false,
            zIndex: Number(drawing?.zIndex ?? 0),
            paneIndex,
          };
        };
        const normalizeDrawingTool = (value: any) => {
          const raw = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
          const aliases: Record<string, string> = {
            trendline: 'trend-line',
            'trend-line': 'trend-line',
            horizontal: 'horizontal-line',
            'horizontal-line': 'horizontal-line',
            vertical: 'vertical-line',
            'vertical-line': 'vertical-line',
            ray: 'ray',
            channel: 'parallel-channel',
            'parallel-channel': 'parallel-channel',
            rectangle: 'rectangle',
            fibonacci: 'fib-retracement',
            fib: 'fib-retracement',
            'fib-retracement': 'fib-retracement',
            text: 'text',
            label: 'text',
            'text-label': 'text',
          };
          return aliases[raw] || raw;
        };
        const drawingInspection = (op: any) => {
          const maxBars = Math.max(1, Math.min(300, Math.floor(Number(op?.maxBars) || 150)));
          const bars = ((chart.primarySeries?.()?.getData?.() || []) as any[]).filter((bar: any) =>
            Number.isFinite(Number(bar?.time)) &&
            Number.isFinite(Number(bar?.open)) &&
            Number.isFinite(Number(bar?.high)) &&
            Number.isFinite(Number(bar?.low)) &&
            Number.isFinite(Number(bar?.close))
          );
          const range = logical();
          const from = range && Number.isFinite(Number(range.from)) ? Math.max(0, Math.floor(Number(range.from))) : 0;
          const to = range && Number.isFinite(Number(range.to)) ? Math.min(bars.length - 1, Math.ceil(Number(range.to))) : bars.length - 1;
          if (bars.length < 2 || to < from) throw new Error('Not enough chart bars are available to inspect drawing coordinates.');
          const visibleBars = bars.slice(from, to + 1);
          const stride = Math.max(1, Math.ceil(visibleBars.length / maxBars));
          const selected = visibleBars.filter((_bar: any, index: number) => index % stride === 0 || index === visibleBars.length - 1);
          const actualBars = selected.map((bar: any, index: number) => {
            const sourceIndex = from + visibleBars.indexOf(bar);
            return {
              index: sourceIndex,
              time: Number(bar.time),
              open: Number(bar.open),
              high: Number(bar.high),
              low: Number(bar.low),
              close: Number(bar.close),
              coordinates: {
                x: Number(chart.timeToCoordinate?.(Number(bar.time))),
                openY: chart.priceToCoordinate?.(Number(bar.open), 0),
                highY: chart.priceToCoordinate?.(Number(bar.high), 0),
                lowY: chart.priceToCoordinate?.(Number(bar.low), 0),
                closeY: chart.priceToCoordinate?.(Number(bar.close), 0),
              },
            };
          });
          const first = visibleBars[0];
          const last = visibleBars[visibleBars.length - 1];
          const inspection = {
            id: 'draw-inspect-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            symbol: widget.symbol(),
            timeframe: widget.interval(),
            capturedAt: Date.now(),
            visibleRange: range,
            visibleBarCount: visibleBars.length,
            timeRange: { from: Number(first.time), to: Number(last.time) },
            priceRange: {
              low: Math.min(...visibleBars.map((bar: any) => Number(bar.low))),
              high: Math.max(...visibleBars.map((bar: any) => Number(bar.high))),
            },
            bars: actualBars,
            coordinateSystem: {
              timeUnit: 'UTC seconds',
              priceUnit: 'chart price',
              xUnit: 'container media pixels',
              yUnit: 'container media pixels',
              mapping: 'chart.timeToCoordinate(time), chart.priceToCoordinate(price, paneIndex)',
            },
            drawingTools: registeredDrawingTools().map((tool: any) => ({ id: tool.id, name: tool.name, points: tool.points, freehand: Boolean(tool.freehand) })),
          };
          drawingInspectionRef.current = { symbol: inspection.symbol, timeframe: inspection.timeframe, capturedAt: inspection.capturedAt, id: inspection.id };
          return { action: 'inspect_drawing_context', ok: true, inspection };
        };
        const indicatorSnapshot = () => {
          const bars = ((chart.primarySeries?.()?.getData?.() || []) as any[]);
          return (chart.indicators?.() || []).map((item: any) => {
            const rawValues = typeof item.values === 'function' ? item.values() : {};
            const values: Record<string, any> = {};
            for (const [plotKey, column] of Object.entries(rawValues || {})) {
              const series = Array.isArray(column) ? column as any[] : [];
              const recentStart = Math.max(0, series.length - 20);
              let latestFiniteIndex = -1;
              for (let i = series.length - 1; i >= 0; i -= 1) if (Number.isFinite(Number(series[i]))) { latestFiniteIndex = i; break; }
              values[plotKey] = {
                latest: latestFiniteIndex >= 0 ? Number(series[latestFiniteIndex]) : null,
                latestTime: latestFiniteIndex >= 0 ? (bars[latestFiniteIndex]?.time ?? null) : null,
                recent: series.slice(recentStart).map((value: any, offset: number) => ({
                  time: bars[recentStart + offset]?.time ?? null,
                  value: Number.isFinite(Number(value)) ? Number(value) : null,
                })),
              };
            }
            const settings = typeof item.settings === 'function' ? item.settings() : {};
            const dataStatus = typeof item.dataStatus === 'function' ? item.dataStatus() : null;
            const allFinite = Object.values(rawValues || {}).some((column: any) => Array.isArray(column) && column.some((value: any) => Number.isFinite(Number(value))));
            const descriptor = registeredIndicators().find((candidate: any) => String(candidate?.id || '') === String(item.indicatorId || ''));
            const placement = String(descriptor?.placement || '');
            return { id: item.id, indicatorId: item.indicatorId, name: item.name, placement, paneIndex: item.paneIndex, visible: typeof item.visible === 'function' ? item.visible() : true, settings, values, dataStatus, rendered: allFinite && (typeof item.visible !== 'function' || item.visible()) };
          });
        };
        const findIndicator = (op: any) => {
          const list = chart.indicators?.() || [];
          const instanceId = String(op?.instanceId || '').trim();
          if (instanceId) {
            const found = list.find((item: any) => item.id === instanceId);
            if (!found) throw new Error('Indicator instance not found: ' + instanceId);
            return found;
          }
          const query = String(op?.indicatorId || op?.name || '').trim().toLowerCase();
          const matches = list.filter((item: any) => item.indicatorId.toLowerCase() === query || item.name.toLowerCase() === query || item.name.toLowerCase().includes(query));
          if (!matches.length) throw new Error('Indicator not found: ' + query);
          if (matches.length > 1) throw new Error('Multiple ' + query + ' indicator instances exist; specify instanceId.');
          return matches[0];
        };
        const resolveIndicatorId = (op: any) => {
          const query = String(op?.indicatorId || op?.name || '').trim().toLowerCase();
          const descriptor = registeredIndicators().find((item: any) =>
            String(item?.id || '').toLowerCase() === query ||
            String(item?.name || item?.label || item?.title || '').toLowerCase() === query ||
            String(item?.name || item?.label || item?.title || '').toLowerCase().includes(query)
          );
          if (!descriptor?.id) throw new Error('Indicator is not registered in OpenAlgo Charts: ' + query);
          return String(descriptor.id);
        };
        const replaySnapshot = () => {
          const replay = replayRef.current;
          const state = replay?.state?.() || null;
          const series = chart.primarySeries?.();
          const bars = (series?.getData?.() || []) as any[];
          const last = bars[bars.length - 1] || null;
          const rect = host.getBoundingClientRect();
          const lastX = last && Number.isFinite(Number(last.time)) ? Number(chart.timeToCoordinate?.(Number(last.time))) : NaN;
          const lastY = last && Number.isFinite(Number(last.close)) ? Number(chart.priceToCoordinate?.(Number(last.close), 0)) : NaN;
          return {
            active: Boolean(replay),
            state,
            symbol: widget.symbol(),
            timeframe: widget.interval(),
            renderedBars: bars.length,
            renderedLastBar: last ? {
              time: Number(last.time),
              open: Number(last.open),
              high: Number(last.high),
              low: Number(last.low),
              close: Number(last.close),
            } : null,
            lastBarCoordinates: { x: lastX, y: lastY },
            viewport: {
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              lastBarVisible: Number.isFinite(lastX) && Number.isFinite(lastY) &&
                lastX >= -2 && lastX <= rect.width + 2 &&
                lastY >= -2 && lastY <= rect.height + 2,
            },
            replayMode: replayModeRef.current,
            dataPaused: widget.dataController?.getState?.()?.paused ?? null,
            configuredStart: replayStartInputRef.current || null,
            configuredEnd: replayEndInputRef.current || null,
          };
        };
        const parseReplayCommandTime = (value: any) => {
          if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
          const text = String(value ?? '').trim();
          if (!text) return null;
          const numeric = Number(text);
          if (Number.isFinite(numeric)) return Math.floor(numeric);
          const ms = new Date(text).getTime();
          return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
        };
        const setReplayInputTime = (which: 'start' | 'end', value: any) => {
          const epoch = parseReplayCommandTime(value);
          if (epoch === null) throw new Error('Replay ' + which + ' requires a Unix timestamp in seconds or a valid ISO date/time.');
          const text = formatReplayInputTime(epoch);
          if (which === 'start') {
            replayStartInputRef.current = text;
            setReplayStartInput(text);
          } else {
            replayEndInputRef.current = text;
            setReplayEndInput(text);
          }
          return { epoch, input: text };
        };
        const replayRenderVerification = () => {
          const snapshot = replaySnapshot();
          const state = snapshot.state;
          if (!snapshot.active || !state) {
            return { ok: false, active: false, rendered: false, reason: 'Replay is not active.', snapshot };
          }
          const expectedCount = Number(state.index) + 1;
          const renderedCount = Number(snapshot.renderedBars);
          const expectedTime = state.bar ? Number((state.bar as any).time) : null;
          const actualTime = snapshot.renderedLastBar?.time ?? null;
          const countMatches = renderedCount === expectedCount;
          const timeMatches = expectedTime === null || actualTime === expectedTime;
          const visible = snapshot.viewport.lastBarVisible;
          const rendered = countMatches && timeMatches && visible;
          return {
            ok: rendered,
            active: true,
            rendered,
            countMatches,
            timeMatches,
            visible,
            expectedCount,
            renderedCount,
            expectedTime,
            actualTime,
            snapshot,
          };
        };
        const executeOne = async (op: any) => {
          const rawAction = String(op?.action || '');
          // Accept the canonical SIRE action names plus the older drawing
          // command shape that some model turns may still produce. The
          // runtime always converts it to the verified DrawingController API.
          const action = rawAction === 'create' ? 'add_drawing' : rawAction;
          const legacyProps = op?.toolProperties && typeof op.toolProperties === 'object' ? op.toolProperties : {};
          if (action === 'start_replay') {
            const fromBeginning = op?.fromBeginning === true;
            if (op?.startTime !== undefined || op?.start !== undefined) setReplayInputTime('start', op.startTime ?? op.start);
            if (op?.endTime !== undefined || op?.end !== undefined) setReplayInputTime('end', op.endTime ?? op.end);
            if (Number.isFinite(Number(op?.speed))) setReplaySpeed(Number(op.speed));
            if (replayRef.current) stopReplay();
            await startReplayFromInputs(fromBeginning, true);
            const snapshot = replaySnapshot();
            if (!snapshot.active || !snapshot.state) throw new Error('Replay did not become active after start.');
            return { action, ok: true, ...snapshot, render: replayRenderVerification() };
          }
          if (action === 'stop_replay') {
            if (!replayRef.current) return { action, ok: true, alreadyStopped: true, ...replaySnapshot() };
            stopReplay();
            await wait(40);
            return { action, ok: true, ...replaySnapshot() };
          }
          if (action === 'pause_replay') {
            const replay = replayRef.current;
            if (!replay) throw new Error('Replay is not active.');
            replay.pause();
            syncReplayState();
            return { action, ok: true, ...replaySnapshot(), render: replayRenderVerification() };
          }
          if (action === 'resume_replay') {
            const replay = replayRef.current;
            if (!replay) throw new Error('Replay is not active.');
            replay.play({ speed: replaySpeedRef.current });
            syncReplayState();
            return { action, ok: true, ...replaySnapshot(), render: replayRenderVerification() };
          }
          if (action === 'set_replay_start' || action === 'set_replay_end') {
            const which = action === 'set_replay_start' ? 'start' : 'end';
            const value = op?.time ?? op?.timestamp ?? op?.value;
            const changed = setReplayInputTime(which, value);
            if (which === 'start' && replayEndInputRef.current) {
              const end = parseReplayCommandTime(replayEndInputRef.current);
              if (end !== null && changed.epoch > end) throw new Error('Replay start cannot be later than replay end.');
            }
            if (which === 'end' && replayStartInputRef.current) {
              const start = parseReplayCommandTime(replayStartInputRef.current);
              if (start !== null && changed.epoch < start) throw new Error('Replay end cannot be earlier than replay start.');
            }
            if (replayRef.current) {
              stopReplay();
              await startReplayFromInputs(false, true);
            } else {
              refreshReplayBounds();
            }
            return { action, ok: true, configured: changed, ...replaySnapshot() };
          }
          if (action === 'move_replay_position') {
            const replay = replayRef.current;
            if (!replay) throw new Error('Replay is not active.');
            const current = replay.state();
            let index: number;
            if (op?.index !== undefined) {
              index = Math.floor(Number(op.index));
            } else if (op?.bars !== undefined) {
              index = current.index + Math.floor(Number(op.bars));
            } else {
              const time = parseReplayCommandTime(op?.time ?? op?.timestamp ?? op?.position);
              if (time === null) throw new Error('move_replay_position requires index, bars, or a timestamp.');
              const bars = ((chart.primarySeries?.()?.getData?.() || []) as any[]);
              const sessionTotal = current.total;
              const session = bars.slice(0, sessionTotal);
              let best = 0;
              let bestDistance = Infinity;
              session.forEach((bar: any, i: number) => {
                const distance = Math.abs(Number(bar.time) - time);
                if (distance < bestDistance) { best = i; bestDistance = distance; }
              });
              index = best;
            }
            if (!Number.isFinite(index)) throw new Error('Replay position must be a finite index, bar offset, or timestamp.');
            replay.seek(index);
            syncReplayState();
            return { action, ok: true, ...replaySnapshot(), render: replayRenderVerification() };
          }
          if (action === 'set_replay_speed') {
            const speed = Number(op?.speed ?? op?.value);
            if (!Number.isFinite(speed) || speed <= 0 || speed > 100) throw new Error('Replay speed must be greater than 0 and no more than 100.');
            setReplaySpeed(speed);
            return { action, ok: true, speed: replaySpeedRef.current, ...replaySnapshot() };
          }
          if (action === 'read_replay_position') {
            const snapshot = replaySnapshot();
            return {
              action, ok: true, active: snapshot.active,
              position: snapshot.state ? {
                index: snapshot.state.index,
                total: snapshot.state.total,
                time: snapshot.state.bar ? Number((snapshot.state.bar as any).time) : null,
                bar: snapshot.state.bar || null,
              } : null,
              renderedLastBar: snapshot.renderedLastBar,
              render: snapshot.active ? replayRenderVerification() : null,
            };
          }
          if (action === 'read_replay_state') {
            return { action, ok: true, ...replaySnapshot() };
          }
          if (action === 'verify_replay_rendered') {
            const verification = replayRenderVerification();
            if (!verification.ok) throw new Error('Replay candle rendering verification failed: ' + JSON.stringify(verification));
            return { action, ok: true, ...verification };
          }
          if (action === 'switch_instrument') {
            const query = String(op?.symbol || op?.name || '').trim().toLowerCase();
            const instrument = instrumentsRef.current.find(item => item.symbol.toLowerCase() === query || item.name.toLowerCase() === query || item.name.toLowerCase().includes(query));
            if (!instrument) throw new Error('Instrument not found in the active SIRE instrument catalogue: ' + String(op?.symbol || op?.name || ''));
            widget.setSymbol(instrument.symbol, 'DERIV');
            await wait(150);
            if (widget.symbol() !== instrument.symbol) throw new Error('Chart did not accept instrument ' + instrument.symbol + '.');
            return { action, ok: true, symbol: widget.symbol(), name: instrument.name };
          }
          if (action === 'switch_timeframe') {
            const interval = String(op?.interval || '').trim();
            if (!CHART_INTERVALS.includes(interval)) throw new Error('Unsupported timeframe: ' + interval);
            widget.setInterval(interval);
            await wait(100);
            if (widget.interval() !== interval) throw new Error('Chart did not accept timeframe ' + interval + '.');
            return { action, ok: true, interval: widget.interval() };
          }
          if (action === 'inspect_drawing_context') {
            return drawingInspection(op);
          }
          if (action === 'read_drawings') {
            return { action, ok: true, drawings: drawingSnapshot(), selectedIds: typeof (widget as any).draw?.selection === 'function' ? (widget as any).draw.selection() : [] };
          }
          if (action === 'add_drawing') {
            const inspected = drawingInspectionRef.current;
            if (!inspected || inspected.symbol !== widget.symbol() || inspected.timeframe !== widget.interval() || Date.now() - inspected.capturedAt > 60000) {
              throw new Error('Drawing creation requires a fresh inspect_drawing_context result for the current chart before anchors can be created.');
            }
            const draw: any = (widget as any).draw;
            if (!draw || typeof draw.add !== 'function') throw new Error('OpenAlgo DrawingController is not available on the active chart.');
            const tool = normalizeDrawingTool(op?.drawingTool || op?.tool || op?.toolName || legacyProps?.tool || legacyProps?.toolName);
            const descriptor: any = registeredDrawingTools().find((item: any) => item.id === tool);
            if (!descriptor) throw new Error('Drawing tool is not registered in OpenAlgo Charts: ' + tool);
            const rawPoints = Array.isArray(op?.points) ? op.points : (Array.isArray(legacyProps?.points) ? legacyProps.points : []);
            let points = rawPoints.map((point: any) => ({ time: Number(point.time), price: Number(point.price) }));
            // OpenAlgo's horizontal-line and vertical-line are one-anchor
            // tools. Accept a two-endpoint horizontal/vertical command by
            // collapsing it to the first real anchor instead of silently
            // rejecting a valid price/time level described in an older shape.
            if (!points.length || points.some((point: any) => !Number.isFinite(point.time) || !Number.isFinite(point.price))) throw new Error('add_drawing requires real finite {time, price} anchor coordinates.');
            if ((tool === 'horizontal-line' || tool === 'vertical-line') && points.length >= 1 && descriptor.points === 1) points = [points[0]];
            if (descriptor.points > 0 && points.length !== descriptor.points) throw new Error(descriptor.name + ' requires exactly ' + descriptor.points + ' anchor point(s); received ' + points.length + '.');
            const input: any = {
              tool,
              points,
              paneIndex: Number.isInteger(op?.paneIndex) ? Math.max(0, Number(op.paneIndex)) : 0,
              style: (op?.style && typeof op.style === 'object' ? op.style : (legacyProps?.style && typeof legacyProps.style === 'object' ? legacyProps.style : {})),
            };
            if (op?.text && typeof op.text === 'object') input.text = op.text;
            else if (legacyProps?.text && typeof legacyProps.text === 'object') input.text = legacyProps.text;
            if (op?.props && typeof op.props === 'object') input.props = op.props;
            else if (legacyProps?.props && typeof legacyProps.props === 'object') input.props = legacyProps.props;
            if (op?.locked === true) input.locked = true;
            if (op?.visible === false) input.visible = false;
            if (Number.isFinite(Number(op?.zIndex))) input.zIndex = Number(op.zIndex);
            const created = draw.add(input);
            // A drawing existing in the controller is not enough: the user must
            // actually be able to see it on the active chart. Keep it above the
            // series and give the renderer a couple of frames before verifying.
            if (typeof draw.bringAboveSeries === 'function') draw.bringAboveSeries(created.id);
            else if (typeof draw.setZIndex === 'function') draw.setZIndex(created.id, Math.max(1, Number(input.zIndex ?? 1)));
            await wait(80);
            await new Promise<void>(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
            const current = typeof draw.get === 'function' ? draw.get(created.id) : null;
            if (!current) throw new Error('Drawing was accepted but is not present in the DrawingController.');
            const snapshot = drawingSnapshot().find((item: any) => item.id === created.id);
            if (!snapshot) throw new Error('Drawing was created but could not be verified from the chart runtime.');
            const rendered = verifyDrawingRendered(snapshot);
            if (!rendered.visible) {
              if (typeof draw.update === 'function') draw.update(created.id, { visible: true });
              await wait(30);
            }
            const finalSnapshot = drawingSnapshot().find((item: any) => item.id === created.id);
            const finalRendered = verifyDrawingRendered(finalSnapshot);
            if (!finalSnapshot || !finalRendered.coordinatesValid || !finalRendered.coordinatesVisible || finalSnapshot.visible === false) {
              throw new Error('Drawing exists in the chart model but is not visibly rendered in the active chart viewport.');
            }
            return { action, ok: true, drawing: finalSnapshot, rendered: finalRendered, inspectionId: inspected.id };
          }
          if (action === 'remove_drawing') {
            const draw: any = (widget as any).draw;
            const id = String(op?.drawingId || '').trim();
            if (!id) throw new Error('remove_drawing requires drawingId.');
            const existing = typeof draw?.get === 'function' ? draw.get(id) : null;
            if (!existing) throw new Error('Drawing not found: ' + id);
            const removed = typeof draw.remove === 'function' ? draw.remove(id) : (draw.removeMany?.([id]), true);
            if (removed === false) throw new Error('Drawing could not be removed: ' + id);
            await wait(30);
            if (typeof draw.get === 'function' && draw.get(id)) throw new Error('Drawing ' + id + ' is still present after removal.');
            return { action, ok: true, removedDrawingId: id };
          }
          if (action === 'modify_drawing') {
            const draw: any = (widget as any).draw;
            const id = String(op?.drawingId || '').trim();
            if (!id) throw new Error('modify_drawing requires drawingId.');
            if (typeof draw?.get !== 'function' || !draw.get(id)) throw new Error('Drawing not found: ' + id);
            const patch: any = {};
            if (Array.isArray(op?.points)) {
              patch.points = op.points.map((point: any) => ({ time: Number(point.time), price: Number(point.price) }));
              if (patch.points.some((point: any) => !Number.isFinite(point.time) || !Number.isFinite(point.price))) throw new Error('modify_drawing points must contain finite real chart coordinates.');
            }
            if (op?.style && typeof op.style === 'object') patch.style = op.style;
            if (op?.text && typeof op.text === 'object') patch.text = op.text;
            if (op?.props && typeof op.props === 'object') patch.props = op.props;
            if (typeof op?.locked === 'boolean') patch.locked = op.locked;
            if (typeof op?.visible === 'boolean') patch.visible = op.visible;
            if (Number.isFinite(Number(op?.zIndex))) patch.zIndex = Number(op.zIndex);
            if (!Object.keys(patch).length) throw new Error('modify_drawing requires points, style, text, props, locked, visible, or zIndex.');
            if (typeof draw.update !== 'function' || draw.update(id, patch) === false) throw new Error('Drawing could not be modified: ' + id);
            await wait(30);
            const updated = drawingSnapshot().find((item: any) => item.id === id);
            if (!updated) throw new Error('Drawing disappeared after modification: ' + id);
            return { action, ok: true, drawing: updated };
          }
          if (action === 'add_indicator') {
            const indicatorId = resolveIndicatorId(op);
            const settings = op?.settings && typeof op.settings === 'object' ? op.settings : {};
            const options: any = {};
            const descriptor = registeredIndicators().find((candidate: any) => String(candidate?.id || '') === indicatorId);
            const placement = String(descriptor?.placement || '');
            // OpenAlgo declares oscillator/study indicators with placement='pane'.
            // A pane indicator must never be forced into price pane 0: doing so makes
            // values such as MACD's zero line participate in the price autoscale.
            if (placement === 'pane') {
              if (Number.isInteger(op?.paneIndex) && Number(op.paneIndex) > 0) options.paneIndex = Number(op.paneIndex);
            } else if (Number.isInteger(op?.paneIndex) && Number(op.paneIndex) >= 0) {
              options.paneIndex = Number(op.paneIndex);
            }
            const indicator = Object.keys(options).length ? chart.addIndicator(indicatorId, settings, options) : chart.addIndicator(indicatorId, settings);
            await wait(50);
            const current = (chart.indicators?.() || []).find((item: any) => item.id === indicator.id);
            if (!current) throw new Error('Indicator was added but is not present in the chart indicator registry.');
            const snapshot = indicatorSnapshot().find((item: any) => item.id === current.id);
            if (!snapshot?.rendered) throw new Error('Indicator ' + current.name + ' was added but did not render a finite value on the chart.');
            if (placement === 'pane' && Number(current.paneIndex) === 0) throw new Error('Pane indicator ' + current.name + ' was incorrectly placed in the price pane.');
            return { action, ok: true, indicator: snapshot };
          }
          if (action === 'remove_indicator') {
            const indicator = findIndicator(op);
            const instanceId = indicator.id;
            const removed = chart.removeIndicator?.(instanceId);
            if (removed === false) throw new Error('Chart could not remove indicator ' + instanceId + '.');
            await wait(30);
            if ((chart.indicators?.() || []).some((item: any) => item.id === instanceId)) throw new Error('Indicator ' + instanceId + ' is still present after removal.');
            return { action, ok: true, removedInstanceId: instanceId };
          }
          if (action === 'modify_indicator') {
            const indicator = findIndicator(op);
            const settings = op?.settings && typeof op.settings === 'object' ? op.settings : {};
            if (!Object.keys(settings).length) throw new Error('modify_indicator requires a non-empty settings object.');
            indicator.setSettings(settings);
            await wait(50);
            const current = (chart.indicators?.() || []).find((item: any) => item.id === indicator.id);
            const snapshot = indicatorSnapshot().find((item: any) => item.id === indicator.id);
            if (!current || !snapshot) throw new Error('Indicator disappeared while applying settings.');
            for (const [key, value] of Object.entries(settings)) if ((current.settings?.() || {})[key] !== value) throw new Error('Indicator setting ' + key + ' was not applied.');
            if (!snapshot.rendered) throw new Error('Indicator ' + current.name + ' no longer has a rendered finite value after the settings change.');
            return { action, ok: true, indicator: snapshot };
          }
          if (action === 'move_indicator') {
            const indicator = findIndicator(op);
            const paneIndex = Math.max(0, Math.floor(Number(op?.paneIndex)));
            if (!Number.isFinite(paneIndex)) throw new Error('move_indicator requires paneIndex.');
            const moved = chart.moveIndicator?.(indicator.id, paneIndex);
            if (moved === false) throw new Error('Chart could not move indicator ' + indicator.id + ' to pane ' + paneIndex + '.');
            await wait(30);
            const current = (chart.indicators?.() || []).find((item: any) => item.id === indicator.id);
            if (!current || current.paneIndex !== paneIndex) throw new Error('Indicator did not move to pane ' + paneIndex + '.');
            return { action, ok: true, indicator: indicatorSnapshot().find((item: any) => item.id === indicator.id) };
          }
          if (action === 'set_indicator_visibility') {
            const indicator = findIndicator(op);
            if (typeof op?.visible !== 'boolean') throw new Error('set_indicator_visibility requires visible true or false.');
            indicator.setVisible(op.visible);
            await wait(20);
            if (indicator.visible?.() !== op.visible) throw new Error('Indicator visibility did not change.');
            return { action, ok: true, indicator: indicatorSnapshot().find((item: any) => item.id === indicator.id) };
          }
          if (action === 'read_indicators') {
            return { action, ok: true, indicators: indicatorSnapshot() };
          }
          if (action === 'set_chart_type') {
            const chartType = String(op?.chartType || '').trim();
            if (!CHART_TYPES.some(item => item.id === chartType)) throw new Error('Unsupported chart type: ' + chartType);
            widget.setChartType(chartType);
            if (widget.chartType() !== chartType) throw new Error('Chart did not accept chart type ' + chartType + '.');
            return { action, ok: true, chartType: widget.chartType() };
          }
          if (action === 'zoom') {
            const range = logical();
            if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) throw new Error('Chart has no usable visible range to zoom.');
            const factor = Math.max(1.05, Math.min(10, Number(op?.factor) || 2));
            const center = (range.from + range.to) / 2;
            const span = (range.to - range.from) / (String(op?.direction || 'in') === 'out' ? 1 / factor : factor);
            chart.setVisibleLogicalRange({ from: center - span / 2, to: center + span / 2 });
            return { action, ok: true, visibleRange: chart.getVisibleLogicalRange?.() || scale()?.getVisibleLogicalRange?.() || null };
          }
          if (action === 'pan') {
            const range = logical();
            if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) throw new Error('Chart has no usable visible range to pan.');
            const bars = Math.max(1, Math.min(100000, Math.abs(Number(op?.bars) || 10)));
            const direction = String(op?.direction || 'right') === 'left' ? -1 : 1;
            chart.setVisibleLogicalRange({ from: range.from + direction * bars, to: range.to + direction * bars });
            return { action, ok: true, visibleRange: chart.getVisibleLogicalRange?.() || scale()?.getVisibleLogicalRange?.() || null };
          }
          if (action === 'move_to_time') {
            const time = Number(op?.time);
            if (!Number.isFinite(time)) throw new Error('move_to_time requires a Unix timestamp in seconds.');
            const dataLayer = chart.dataLayer;
            const index = dataLayer?.timeToIndexFloat?.(time);
            if (!Number.isFinite(index)) throw new Error('Requested time is outside the chart data coverage.');
            const range = logical();
            const span = range && Number.isFinite(range.to - range.from) && range.to > range.from ? range.to - range.from : 40;
            chart.setVisibleLogicalRange({ from: index - span / 2, to: index + span / 2 });
            return { action, ok: true, time, visibleRange: chart.getVisibleLogicalRange?.() || scale()?.getVisibleLogicalRange?.() || null };
          }
          if (action === 'reset_view') {
            chart.resetScale?.();
            return { action, ok: true };
          }
          if (action === 'fit_data') {
            chart.fitContent?.();
            return { action, ok: true };
          }
          if (action === 'open_pane') {
            const paneIndex = Math.max(0, Math.floor(Number(op?.paneIndex) || 0));
            const panes = chart.panes?.() || [];
            if (paneIndex >= panes.length) throw new Error('Pane ' + paneIndex + ' does not exist.');
            const ok = chart.maximizePane?.(paneIndex);
            if (ok === false) throw new Error('Chart could not maximize pane ' + paneIndex + '.');
            return { action, ok: true, paneIndex, maximizedPane: chart.maximizedPane?.() ?? null };
          }
          if (action === 'close_pane') {
            const current = chart.maximizedPane?.();
            if (current === null || current === undefined) return { action, ok: true, maximizedPane: null };
            const ok = chart.maximizePane?.(current);
            if (ok === false) throw new Error('Chart could not restore the maximized pane.');
            return { action, ok: true, restoredPane: current, maximizedPane: chart.maximizedPane?.() ?? null };
          }
          if (action === 'open_settings') {
            const opened = widget.openSettings?.();
            if (opened === false) throw new Error('Chart settings dialog is not available.');
            return { action, ok: true, opened: opened !== false };
          }
          if (action === 'set_theme') {
            const theme = String(op?.theme || '').trim();
            if (theme !== 'dark' && theme !== 'light') throw new Error('Theme must be dark or light.');
            widget.setTheme(theme);
            if (widget.theme?.() !== theme) throw new Error('Chart theme did not change to ' + theme + '.');
            return { action, ok: true, theme: widget.theme() };
          }
          if (action === 'set_timezone') {
            const timezone = String(op?.timezone || '').trim();
            if (!timezone) throw new Error('set_timezone requires an IANA timezone.');
            chart.setTimezone?.(timezone);
            return { action, ok: true, timezone: chart.timezone?.() || timezone };
          }
          if (action === 'set_grid') {
            const settings = op?.settings && typeof op.settings === 'object' ? op.settings : {};
            chart.setGridOptions?.(settings);
            return { action, ok: true, grid: chart.gridOptions?.() || settings };
          }
          if (action === 'set_price_scale') {
            const settings = op?.settings && typeof op.settings === 'object' ? op.settings : {};
            const scope = settings.scope === 'axes' || settings.scope === 'all' ? settings.scope : 'primary';
            const patch = { ...settings };
            delete patch.scope;
            chart.setPriceScaleOptions?.(patch, scope);
            return { action, ok: true, priceScale: chart.priceScaleOptions?.() || patch };
          }
          if (action === 'set_crosshair') {
            const mode = String(op?.settings?.mode || '').trim();
            if (mode !== 'normal' && mode !== 'magnet') throw new Error('Crosshair mode must be normal or magnet.');
            chart.applyOptions?.({ crosshairMode: mode });
            return { action, ok: true, crosshairMode: chart.crosshairMode?.() || mode };
          }
          throw new Error('Unsupported chart control action: ' + action);
        };
        for (const operation of Array.isArray(operations) ? operations.slice(0, 10) : []) results.push(await executeOne(operation));
        const state = chart.getState?.() || {};
        return {
          ok: true,
          results,
          verification: {
            symbol: widget.symbol(),
            timeframe: widget.interval(),
            chartType: widget.chartType(),
            visibleRange: chart.getVisibleLogicalRange?.() || scale()?.getVisibleLogicalRange?.() || null,
            paneCount: (chart.panes?.() || []).length,
            maximizedPane: chart.maximizedPane?.() ?? null,
            chartState: state,
            indicators: indicatorSnapshot(),
            drawings: drawingSnapshot(),
            verifiedAt: Date.now(),
          },
        };
      },
    };
    (window as any).__sireChartControl = controls;
    return () => {
      if ((window as any).__sireChartControl === controls) delete (window as any).__sireChartControl;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const publish = () => {
      const widget = widgetRef.current;
      const chart = widget?.chart;
      const series = chart?.primarySeries?.();
      const bars = (series?.getData?.() || []) as DerivBar[];
      const visible = (chart?.timeScale as any)?.getVisibleLogicalRange?.();
      const drawings = typeof (widget as any)?.draw?.drawings === 'function'
        ? (widget as any).draw.drawings().slice(-100).map((item: any) => ({ id: item.id, kind: 'drawing', tool: item.tool, name: registeredDrawingTools().find((tool: any) => tool.id === item.tool)?.name || item.tool, selected: (widget as any).draw.selection?.().includes(item.id) || false, visible: item.visible !== false, locked: item.locked === true, points: Array.isArray(item.points) ? item.points.slice(0, 8) : undefined, paneIndex: item.paneIndex }))
        : ((widget?.objects as any)?.list?.() || []).slice(-100).map((item: any) => ({ id: item.id, kind: item.kind, tool: item.tool, name: item.name, selected: item.selected, visible: item.visible, locked: item.locked, points: Array.isArray(item.points) ? item.points.slice(0, 8) : undefined, paneIndex: item.paneIndex }));
      const indicators = (chart?.indicators?.() || []).map((item: any) => {
        const rawValues = typeof item.values === 'function' ? item.values() : {};
        const values: Record<string, any> = {};
        for (const [plotKey, column] of Object.entries(rawValues || {})) {
          const series = Array.isArray(column) ? column as any[] : [];
          const recentStart = Math.max(0, series.length - 20);
          let latestIndex = -1;
          for (let i = series.length - 1; i >= 0; i -= 1) if (Number.isFinite(Number(series[i]))) { latestIndex = i; break; }
          values[plotKey] = {
            latest: latestIndex >= 0 ? Number(series[latestIndex]) : null,
            latestTime: latestIndex >= 0 ? (bars[latestIndex]?.time ?? null) : null,
            recent: series.slice(recentStart).map((value: any, offset: number) => ({ time: bars[recentStart + offset]?.time ?? null, value: Number.isFinite(Number(value)) ? Number(value) : null })),
          };
        }
        return { id: item.id, indicatorId: item.indicatorId, name: item.name, paneIndex: item.paneIndex, visible: typeof item.visible === 'function' ? item.visible() : true, settings: typeof item.settings === 'function' ? item.settings() : {}, values, dataStatus: typeof item.dataStatus === 'function' ? item.dataStatus() : null, rendered: Object.values(values).some((entry: any) => Number.isFinite(Number(entry.latest))) };
      });
      const last = bars[bars.length - 1];
      const context = {
        symbol: symbolRef.current,
        name: instrumentsRef.current.find(item => item.symbol === symbolRef.current)?.name || symbolRef.current,
        timeframe: timeframeRef.current,
        chartMode: chart?.primarySeriesInfo?.()?.type || 'candlestick',
        latestPrice: Number.isFinite(last?.close) ? last.close : null,
        latestBar: last || null,
        liveMarketData: dataFeedRef.current?.getLiveState?.() || null,
        chartBars: bars.length,
        recentBars: bars.slice(-500),
        visibleBars: visible ? Math.max(0, Math.ceil(Number(visible.to) - Number(visible.from) + 1)) : null,
        visibleRange: visible || null,
        activeIndicators: indicators,
        availableIndicatorIds: registeredIndicators().map((item: any) => String(item?.id || '').trim()).filter(Boolean),
        availableIndicators: registeredIndicators().map((item: any) => ({ id: String(item?.id || '').trim(), name: String(item?.name || item?.label || item?.title || '').trim() })).filter((item: any) => item.id),
        chartDiagnostics: diagnosticsRef.current,
        drawings,
        replay: replayRef.current?.state?.() || null,
        chartState: chart?.getState?.() || null,
        capabilities: { tiers: ['base', 'indicators', 'draw', 'trade', 'transform', 'webgl', 'widget'], indicators: true, drawings: true, tradingVisualization: true, replay: true, transforms: true, screenshots: true, svgExport: true, sharedAiContext: true, verifiedActions: true },
        agentContract: { version: 2, sourceOfTruth: 'openalgo-runtime', read: ['symbol','timeframe','bars','recentBars','visibleRange','indicators','drawings','replay','chartState','liveMarketData'], write: ['instrument','timeframe','chartType','indicator','drawing','priceLine','visibleRange','scale','timezone','theme','replay','screenshot','svg'], rule: 'agents request intent; chart runtime resolves real data and verifies the result' },
        publishedAt: Date.now(),
      };
      const store = ((window as any).__sireChartContexts ||= {});
      store[symbolRef.current] = context;
    };
    publish();
    const timer = window.setInterval(publish, 1000);
    return () => window.clearInterval(timer);
  }, [symbol]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const positionRail = () => {
      const rail = host.querySelector<HTMLElement>('.oac-rail');
      if (!rail) return;
      rail.classList.toggle('sire-oac-rail--closed', !drawRackOpen);
      rail.setAttribute('aria-hidden', String(!drawRackOpen));
      if (!drawRackOpen) { rail.style.removeProperty('--sire-rail-top'); return; }
      const quote = host.querySelector<HTMLElement>('.sire-market-quote');
      const hostRect = host.getBoundingClientRect();
      const quoteRect = quote?.getBoundingClientRect();
      const quoteBottom = quoteRect ? quoteRect.bottom - hostRect.top : 0;
      const widget = widgetRef.current;
      const mainPaneIndicators = widget?.objects.list?.().filter((item: any) => item?.kind === 'indicator' && Number(item?.paneIndex) === 0 && item?.visible !== false) ?? [];
      const indicatorLegendBottom = mainPaneIndicators.length ? 6 + mainPaneIndicators.length * 24 + 4 : 0;
      rail.style.setProperty('--sire-rail-top', `${Math.max(0, Math.ceil(Math.max(quoteBottom + 8, indicatorLegendBottom)))}px`);
    };
    positionRail();
    const observer = new MutationObserver(() => window.requestAnimationFrame(positionRail));
    observer.observe(host, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(positionRail);
    resizeObserver.observe(host);
    const onResize = () => positionRail();
    window.addEventListener('resize', onResize);
    return () => { observer.disconnect(); resizeObserver.disconnect(); window.removeEventListener('resize', onResize); host.querySelector<HTMLElement>('.oac-rail')?.style.removeProperty('--sire-rail-top'); };
  }, [drawRackOpen, symbol, instruments]);

  return (
    <div ref={containerRef} className={`sire-financial-chart${drawRackOpen ? ' sire-draw-rack-open' : ''}${isActive ? ' sire-toolbar-owner' : ''}`}>
      <button type="button" className={'sire-chart-diagnostics-button' + (diagnostics.some(event => event.level === 'error') ? ' has-error' : '')} onClick={() => setDiagnosticsOpen(open => !open)} aria-label="Open chart diagnostics" title="Chart diagnostics"><Wrench size={14} />{diagnostics.some(event => event.level === 'error') ? 'ISSUE' : 'OK'}</button>
      <ChartDiagnosticsPanel open={diagnosticsOpen} events={diagnostics} symbol={symbol} interval={activeTimeframe} quoteAgeMs={lastTickAtRef.current === null ? null : Date.now() - lastTickAtRef.current} bars={((widgetRef.current?.chart?.primarySeries()?.getData?.() || []) as DerivBar[]).length} renderer={rendererKind} width={Math.round(containerRef.current?.getBoundingClientRect().width || 0)} height={Math.round(containerRef.current?.getBoundingClientRect().height || 0)} hasCanvas={!!containerRef.current?.querySelector('canvas')} hasPrimarySeries={!!widgetRef.current?.chart?.primarySeries?.()} onClose={() => setDiagnosticsOpen(false)} onRetry={() => { setDiagnostics([]); lastTickAtRef.current = null; lastLiveQuoteRef.current = null; setMarketQuote(null); void widgetRef.current?.reload?.(); }} />
      <div className="sire-market-quote" aria-label={`Selected ${marketInstrumentName}`}>
        <strong className="sire-market-quote__name">{marketInstrumentName}</strong>
        <div className="sire-market-quote__value-row">
          <span className="sire-market-quote__price">{marketQuote ? formatMarketPrice(marketQuote.price) : '—'}</span>
          <span className={`sire-market-quote__change ${marketQuote && marketQuote.percent > 0 ? 'is-positive' : marketQuote && marketQuote.percent < 0 ? 'is-negative' : 'is-neutral'}`}>
            {marketQuote ? `${marketQuote.percent >= 0 ? '+' : ''}${marketQuote.percent.toFixed(2)}%` : '—'}
          </span>
        </div>
      </div>
      <button type="button" className="sire-chart-settings-button" aria-label="Chart settings" title="Chart settings" onClick={() => widgetRef.current?.openSettings()}><MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" /></button>
      {replayActive && replayState && (
        <div className="sire-replay-transport" role="dialog" aria-label="Chart replay controls">
          <div className="sire-replay-head">
            <span className="sire-replay-badge"><History size={13} strokeWidth={2.1} aria-hidden="true" /> REPLAY</span>
            <span className="sire-replay-clock">{replayState.bar ? new Date(replayState.bar.time * 1000 + 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ') : ''}</span>
            <span className="sire-replay-count">{replayState.index + 1}/{replayState.total}</span>
          </div>
          <div className="sire-replay-progress-row">
            <button type="button" onClick={replayJumpStart} aria-label="Jump to replay start" title="Start"><SkipBack size={15} /></button>
            <input type="range" min="0" max={Math.max(0, replayState.total - 1)} step="1" value={Math.min(replayState.index, Math.max(0, replayState.total - 1))} onChange={event => replaySeek(Number(event.target.value))} aria-label="Replay position" title="Scrub replay" />
            <button type="button" onClick={replayJumpEnd} aria-label="Jump to replay end" title="End"><SkipForward size={15} /></button>
          </div>
          <div className="sire-replay-transport-row">
            <button type="button" onClick={replayStepBack} aria-label="Previous replay bar" title="Previous"><ChevronLeft size={17} /></button>
            <button type="button" className="sire-replay-play" onClick={toggleReplay} aria-label={replayState.playing ? 'Pause replay' : 'Play replay'} title={replayState.playing ? 'Pause' : 'Play'}>{replayState.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
            <button type="button" onClick={replayStep} aria-label="Next replay bar" title="Next"><ChevronRight size={17} /></button>
            <button type="button" onClick={stopReplay} aria-label="Exit replay" title="Exit replay"><X size={17} /></button>
            <button type="button" onClick={() => replaySeek(Math.max(0, replayState.index - 10))} aria-label="Back ten bars" title="Back 10 bars"><RotateCcw size={15} /></button>
          </div>
          <div className="sire-replay-speed-row">
            {REPLAY_SPEEDS.map(speed => (
              <button key={speed} type="button" className={replaySpeedRef.current === speed ? 'active' : ''} onClick={() => setReplaySpeed(speed)} title={`Speed ${replaySpeedLabel(speed)}`}>{replaySpeedLabel(speed)}</button>
            ))}
          </div>
        </div>
      )}
      {replaySetupOpen && !replayActive && (
        <div className="sire-replay-setup" role="dialog" aria-label="Set replay range">
          <div className="sire-replay-setup-row">
            <input aria-label="Replay start date and time" type="datetime-local" min={replayStartMin || undefined} max={replayEndInput || replayNow || undefined} value={replayStartInput} onChange={event => {
              const value = event.target.value;
              const bounded = replayStartMin && value < replayStartMin ? replayStartMin : (replayNow && value > replayNow ? replayNow : value);
              setReplayStartInput(bounded);
              if (replayEndInput && bounded > replayEndInput) setReplayEndInput(bounded);
            }} title="Replay start" />
            <span aria-hidden="true">→</span>
            <input aria-label="Replay end date and time" type="datetime-local" min={replayStartInput || replayStartMin || undefined} max={replayNow || undefined} value={replayEndInput} onChange={event => {
              const value = event.target.value;
              const bounded = replayNow && value > replayNow ? replayNow : value;
              setReplayEndInput(bounded);
              if (replayStartInput && bounded < replayStartInput) setReplayStartInput(bounded);
            }} title="Replay end" />
          </div>
          <div className="sire-replay-quick-row">
            <button type="button" onClick={() => startReplayFromInputs(true, true)} aria-label="Replay from beginning to latest" title="Beginning to latest">⏮▶</button>
            <button type="button" onClick={() => startReplayFromInputs(false, true)} aria-label="Replay selected start to latest" title="Start to latest">▶⏭</button>
            <button type="button" onClick={() => startReplayFromInputs(false, true)} aria-label="Replay from selected start to current time" title="Start to current time">▶⏱</button>
            <button type="button" onClick={() => setReplaySetupOpen(false)} aria-label="Close replay setup" title="Close">×</button>
          </div>
          {replayRangeError && <div className="sire-replay-error">{replayRangeError}</div>}
          <div className="sire-replay-speed-row">
            {REPLAY_SPEEDS.map(speed => (
              <button key={speed} type="button" className={replayDraftSpeed === speed ? 'active' : ''} onClick={() => { setReplayDraftSpeed(speed); setReplaySpeed(speed); }} title={`Speed ${replaySpeedLabel(speed)}`}>{replaySpeedLabel(speed)}</button>
            ))}
          </div>
        </div>
      )}
      {selectedIndicator && (
        <div
          className="sire-indicator-selection-bar"
          role="toolbar"
          aria-label={`Selected indicator: ${selectedIndicator.name}`}
          style={selectedIndicatorPosition ? { left: selectedIndicatorPosition.left, top: selectedIndicatorPosition.top } : undefined}
          onPointerDown={event => event.stopPropagation()}
        >
          <button
            type="button"
            className="sire-indicator-selection-button"
            aria-label="Indicator settings"
            title="Indicator settings"
            onClick={() => widgetRef.current?.objects.openSettings(selectedIndicator.id)}
          >
            <Settings2 size={15} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sire-indicator-selection-button sire-indicator-selection-obj"
            aria-label="Open objects"
            title="Objects"
            onClick={() => widgetRef.current?.openObjects()}
          >
            <span aria-hidden="true">OBJ</span>
          </button>
          <button
            type="button"
            className="sire-indicator-selection-button sire-indicator-selection-delete"
            aria-label="Delete indicator"
            title="Delete indicator"
            onClick={() => {
              const widget = widgetRef.current;
              if (!widget) return;
              widget.objects.remove(selectedIndicator.id);
              selectedIndicatorRef.current = null;
              setSelectedIndicator(null);
              setSelectedIndicatorPosition(null);
            }}
          >
            <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
      {selectedDrawing && (
        <div
          className="sire-drawing-selection-bar"
          role="toolbar"
          aria-label={`Selected drawing: ${selectedDrawing.name}`}
          style={selectedDrawingPosition ? { left: selectedDrawingPosition.left, top: selectedDrawingPosition.top } : undefined}
        >
          <button
            type="button"
            className="sire-drawing-selection-button"
            aria-label={selectedDrawing.visible ? 'Hide drawing' : 'Show drawing'}
            title={selectedDrawing.visible ? 'Hide drawing' : 'Show drawing'}
            onClick={() => {
              const widget = widgetRef.current;
              if (!widget) return;
              widget.objects.setVisible(selectedDrawing.id, !selectedDrawing.visible);
            }}
          >
            <Eye size={16} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`sire-drawing-selection-button sire-drawing-selection-lock${selectedDrawing.locked ? ' is-locked' : ''}`}
            aria-label={selectedDrawing.locked ? 'Unlock drawing' : 'Lock drawing'}
            title={selectedDrawing.locked ? 'Unlock drawing' : 'Lock drawing'}
            onClick={() => {
              const widget = widgetRef.current;
              if (!widget) return;
              widget.objects.setLocked(selectedDrawing.id, !selectedDrawing.locked);
            }}
          >
            <Lock size={16} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sire-drawing-selection-button"
            aria-label="Drawing settings"
            title="Drawing settings"
            onClick={() => widgetRef.current?.objects.openSettings(selectedDrawing.id)}
          >
            <MoreHorizontal size={19} strokeWidth={2.1} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sire-drawing-selection-button"
            aria-label="Focus drawing"
            title="Focus drawing"
            onClick={() => widgetRef.current?.objects.focus(selectedDrawing.id)}
          >
            <span className="sire-drawing-focus-glyph" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sire-drawing-selection-button sire-drawing-selection-delete"
            aria-label="Delete drawing"
            title="Delete drawing"
            onClick={() => {
              const widget = widgetRef.current;
              if (!widget) return;
              widget.objects.remove(selectedDrawing.id);
            }}
          >
            <Minus size={17} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="sire-bottom-glass-bar">
        <div className="sire-bottom-scroll-track">
        <div
          onPointerDown={handleInstrumentPointerDown}
          onPointerMove={handleInstrumentPointerMove}
          onPointerUp={handleInstrumentPointerEnd}
          onPointerCancel={handleInstrumentPointerEnd}
          onContextMenu={event => event.preventDefault()}
          className={`sire-bottom-instrument-swipe${swipeAnimation ? ` is-swiping-${swipeAnimation}` : ''}`}
          title="Swipe up or down to change instrument"
        >
          <span className="sire-bottom-instrument-prev">{compactInstrumentName(instruments[Math.max(0, swipeInstrumentIndex - 1)]?.name || '')}</span>
          <strong>{compactInstrumentName(instruments[swipeInstrumentIndex]?.name || symbol)}</strong>
          <span className="sire-bottom-instrument-next">{compactInstrumentName(instruments[Math.min(instruments.length - 1, swipeInstrumentIndex + 1)]?.name || '')}</span>
        </div>
        <div
          className="sire-bottom-timeframe"
          onPointerDown={handleTimeframePointerDown}
          onPointerMove={handleTimeframePointerMove}
          onPointerUp={handleTimeframePointerEnd}
          onPointerCancel={handleTimeframePointerEnd}
          onContextMenu={event => event.preventDefault()}
          title="Tap and hold to choose timeframe"
        >
          <strong>{activeTimeframe}</strong>
        </div>
        <button
          type="button"
          className="sire-bottom-indicator-button"
          aria-label="Open indicators"
          title="Indicators"
          onClick={() => widgetRef.current?.openIndicatorPicker()}
        >
          <span className="sire-bottom-indicator-icon" aria-hidden="true">ƒ</span>
        </button>
        <button
          type="button"
          className="sire-bottom-replay-button"
          aria-label={replayActive ? (replayState?.playing ? 'Pause replay' : 'Play replay') : 'Open replay'}
          title={replayActive ? (replayState?.playing ? 'Pause replay' : 'Play replay') : 'Replay'}
          onClick={toggleReplay}
        >
          <span aria-hidden="true">{replayActive ? (replayState?.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />) : <History size={20} />}</span>
        </button>
        <button
          type="button"
          className="sire-bottom-tools-button"
          aria-label={drawRackOpen ? 'Close OpenAlgo drawing tools' : 'Open OpenAlgo drawing tools'}
          aria-expanded={drawRackOpen}
          title={drawRackOpen ? 'Close OpenAlgo tools' : 'OpenAlgo drawing tools'}
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
          className="sire-bottom-obj-button"
          aria-label="Open objects"
          title="Objects"
          onClick={() => widgetRef.current?.openObjects()}
        >
          <span aria-hidden="true">OBJ</span>
        </button>
        <button
          type="button"
          className="sire-bottom-more-button"
          aria-label="More chart options"
          aria-expanded={moreMenuOpen}
          title="More"
          onClick={() => setMoreMenuOpen(open => !open)}
        >
          <MoreHorizontal size={22} strokeWidth={2.1} aria-hidden="true" />
        </button>
        {timeframeOpen && (
          <div className="sire-bottom-timeframe-menu">
            {CHART_INTERVALS.map(interval => (
              <button
                key={interval}
                type="button"
                className={interval === activeTimeframe ? 'active' : ''}
                onClick={() => selectTimeframe(interval)}
              >
                {interval}
              </button>
            ))}
          </div>
        )}
        {moreMenuOpen && typeof document !== 'undefined' && createPortal(
          <div className="sire-bottom-more-menu" role="menu" aria-label="More chart options">
            <div className="sire-bottom-more-menu__section">
              <div className="sire-bottom-more-menu__title">Chart type</div>
              <div className="sire-bottom-more-menu__chart-types">
                {CHART_TYPES.map(type => (
                  <button key={type.id} type="button" onClick={() => { widgetRef.current?.setChartType(type.id); setMoreMenuOpen(false); }}>
                    {type.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sire-bottom-more-menu__section">
              <div className="sire-bottom-more-menu__title">Theme / Chart</div>
              <div className="sire-bottom-more-menu__actions">
                <button type="button" onClick={() => { widgetRef.current?.openSettings(); setMoreMenuOpen(false); }}>Open theme / chart settings</button>
              </div>
            </div>
          </div>,
          document.body
        )}
        </div>
      </div>
    </div>
  );
}

