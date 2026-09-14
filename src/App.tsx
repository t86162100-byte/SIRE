import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import { Maximize2, Search, RotateCcw, Crosshair, CandlestickChart, LineChart, Activity, ChevronDown, Calendar, Layers, Pencil, Flag, GitCompareArrows, Clock3, BarChart3, Shapes, X } from 'lucide-react';
import { renderDrawing } from './drawingRenderer';
import ResearchLab from './ResearchLab';
import { Beaker } from 'lucide-react';

type Instrument = {
  symbol: string;
  name: string;
  market: string;
  submarket: string;
  subgroup: string;
  symbolType: string;
  exchangeOpen?: number;
};
type Tick = {
  symbol: string;
  quote: number;
  bid?: number;
  ask?: number;
  epoch: number;
  id?: string;
  source: 'Deriv';
};
type Candle = {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
};
type Coverage = {
  symbol: string;
  storedTicks: number;
  oldestEpoch: number | null;
  newestEpoch: number | null;
  lastIngestAt: number | null;
  batches: number;
};
type DiscoveryResult = {
  instruments: Instrument[];
  allInstruments: Record<string, unknown>[];
  totalMarkets: number;
  endpointLabel: string;
};

const CURRENT_DERIV_WS = 'wss://api.derivws.com/trading/v1/options/ws/public';
const LEGACY_DERIV_WS = 'wss://ws.binaryws.com/websockets/v3';
const HISTORY_CHUNK = 5000;
const CANDLE_CHUNK = 5000;
const INGEST_CHUNK = 500;
type Timeframe = 'tick' | '1s' | '5s' | '10s' | '15s' | '30s' | '1m' | '2m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1D' | '1W' | '1M';
const TIMEFRAME_LIST: Timeframe[] = ['tick', '1s', '5s', '10s', '15s', '30s', '1m', '2m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1D', '1W', '1M'];
const INDICATOR_CATALOG: Array<{ category: string; items: string[] }> = [
  { category: 'Trend', items: ['SMA', 'EMA', 'WMA', 'VWMA', 'HMA', 'DEMA', 'TEMA', 'TRIMA', 'KAMA', 'ALMA', 'McGinley Dynamic', 'Ichimoku Cloud', 'Supertrend', 'Parabolic SAR', 'ADX', 'Aroon', 'Vortex Indicator', 'Linear Regression', 'Moving Average Ribbon', 'Donchian Channels'] },
  { category: 'Momentum', items: ['RSI', 'Stochastic', 'Stochastic RSI', 'MACD', 'Momentum', 'ROC', 'Williams %R', 'CCI', 'MFI', 'Ultimate Oscillator', 'Awesome Oscillator', 'TRIX', 'TSI', 'Chande Momentum Oscillator', 'Fisher Transform', 'QQE'] },
  { category: 'Volatility', items: ['Bollinger Bands', 'Bollinger Band Width', 'ATR', 'Keltner Channels', 'Standard Deviation', 'Historical Volatility', 'Chaikin Volatility', 'Average True Range Bands'] },
  { category: 'Volume', items: ['Volume', 'Volume Profile', 'VWAP', 'Anchored VWAP', 'OBV', 'Accumulation/Distribution', 'Chaikin Money Flow', 'Money Flow Index', 'Ease of Movement', 'Force Index', 'Volume Oscillator', 'Relative Volume'] },
  { category: 'Breadth & Market', items: ['Advance/Decline', 'McClellan Oscillator', 'High-Low Index', 'Arms Index (TRIN)', 'Put/Call Ratio', 'Market Breadth'] },
  { category: 'Levels & Cycles', items: ['Pivot Points Standard', 'Fibonacci Pivot Points', 'Woodie Pivots', 'Camarilla Pivots', 'DeMark Pivots', 'Auto Fib Retracement', 'Auto Fib Extension', 'Zig Zag', 'Gann High-Low Activator'] },
  { category: 'Statistics', items: ['Correlation Coefficient', 'Beta', 'Sharpe Ratio', 'Sortino Ratio', 'R-Squared', 'Standard Error', 'Variance'] },
  { category: 'Other', items: ['Elder Ray', 'Elder Impulse System', 'Williams Alligator', 'Fractals', 'Relative Vigor Index', 'Know Sure Thing', 'Pivot Points High Low'] },
];
const PANE_INDICATOR_NAMES = new Set([
  'RSI', 'Stochastic', 'Stochastic RSI', 'MACD', 'Momentum', 'ROC', 'Williams %R', 'CCI', 'MFI', 'Ultimate Oscillator', 'Awesome Oscillator', 'TRIX', 'TSI', 'Chande Momentum Oscillator', 'Fisher Transform', 'QQE',
  'ADX', 'Aroon', 'Vortex Indicator',
  'ATR', 'Bollinger Band Width', 'Standard Deviation', 'Historical Volatility', 'Chaikin Volatility', 'Average True Range Bands',
  'Volume', 'Volume Profile', 'OBV', 'Accumulation/Distribution', 'Chaikin Money Flow', 'Money Flow Index', 'Ease of Movement', 'Force Index', 'Volume Oscillator', 'Relative Volume',
  'Advance/Decline', 'McClellan Oscillator', 'High-Low Index', 'Arms Index (TRIN)', 'Put/Call Ratio', 'Market Breadth',
  'Correlation Coefficient', 'Beta', 'Sharpe Ratio', 'Sortino Ratio', 'R-Squared', 'Standard Error', 'Variance',
  'Elder Ray', 'Relative Vigor Index', 'Know Sure Thing'
]);

const DRAWING_CATALOG: Array<{ category: string; items: string[] }> = [
  { category: 'Lines', items: ['Trend Line', 'Ray', 'Extended Line', 'Horizontal Line', 'Horizontal Ray', 'Vertical Line', 'Cross Line', 'Parallel Channel', 'Disjoint Channel', 'Regression Trend', 'Info Line'] },
  { category: 'Forecast & Measurement', items: ['Forecast Line', 'Date Range', 'Price Range', 'Date and Price Range', 'Bars Pattern', 'Projection', 'Measure'] },
  { category: 'Fibonacci', items: ['Fib Retracement', 'Fib Extension', 'Fib Trend-Based Extension', 'Fib Channel', 'Fib Time Zone', 'Fib Speed Resistance Fan', 'Fib Circles', 'Fib Spiral', 'Fib Wedge', 'Pitchfan', 'Pitchfork', 'Schiff Pitchfork', 'Modified Schiff Pitchfork'] },
  { category: 'Gann & Cycles', items: ['Gann Fan', 'Gann Square', 'Gann Box', 'Cycle Lines', 'Time Cycles'] },
  { category: 'Shapes', items: ['Rectangle', 'Ellipse', 'Triangle', 'Arc', 'Polyline', 'Curve', 'Path', 'Brush', 'Highlighter'] },
  { category: 'Annotations', items: ['Text', 'Note', 'Callout', 'Price Label', 'Arrow', 'Arrow Mark Up', 'Flag Mark', 'Pin', 'Emoji'] },
];
function bucketEpoch(epoch: number, timeframe: Timeframe) {
  if (timeframe === '1W') {
    const date = new Date(epoch * 1000);
    const day = date.getUTCDay();
    const daysFromMonday = (day + 6) % 7;
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysFromMonday) / 1000);
  }
  if (timeframe === '1M') {
    const date = new Date(epoch * 1000);
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000);
  }
  const seconds = TIMEFRAME_SECONDS[timeframe];
  return Math.floor(epoch / seconds) * seconds;
}

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  tick: 0,
  '1s': 1,
  '5s': 5,
  '10s': 10,
  '15s': 15,
  '30s': 30,
  '1m': 60,
  '2m': 120,
  '3m': 180,
  '5m': 300,
  '10m': 600,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '6h': 21600,
  '8h': 28800,
  '12h': 43200,
  '1D': 86400,
  '1W': 604800,
  '1M': 2592000,
};

function textOf(item: Record<string, unknown>, keys: string[]) {
  return keys
    .map(key => item[key])
    .filter(value => value !== undefined && value !== null)
    .map(value => String(value))
    .join(' ')
    .toLowerCase();
}

function isSynthetic(item: Record<string, unknown>) {
  const market = String(item.market || '').toLowerCase();
  const submarket = String(item.submarket || '').toLowerCase();
  const subgroup = String(item.subgroup || '').toLowerCase();
  const symbol = String(item.underlying_symbol || item.symbol || '');
  const text = textOf(item, [
    'underlying_symbol',
    'underlying_symbol_name',
    'underlying_symbol_type',
    'symbol',
    'display_name',
    'market',
    'submarket',
    'subgroup',
  ]);

  return (
    market === 'synthetic_index' ||
    market === 'synthetic indices' ||
    submarket.includes('random_index') ||
    submarket.includes('synthetic') ||
    subgroup.includes('synthetic') ||
    /synthetic index|volatility|boom|crash|jump|step|drift|range break|daily reset|bear market|bull market|random index/.test(text) ||
    /^(R_|1HZ|BOOM|CRASH|STEP|JUMP|DRIFT|RANGE_BREAK|BULL|BEAR)/i.test(symbol)
  );
}

function normalize(item: Record<string, unknown>): Instrument | null {
  const symbol = String(item.underlying_symbol || item.symbol || '');
  if (!symbol) return null;
  return {
    symbol,
    name: String(item.underlying_symbol_name || item.display_name || symbol),
    market: String(item.market || ''),
    submarket: String(item.submarket || ''),
    subgroup: String(item.subgroup || ''),
    symbolType: String(item.underlying_symbol_type || item.symbol_type || ''),
    exchangeOpen: typeof item.exchange_is_open === 'number' ? item.exchange_is_open : undefined,
  };
}

function openDeriv(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = window.setTimeout(() => {
      socket.close();
      reject(new Error('Deriv connection timed out'));
    }, 10000);
    socket.onopen = () => {
      window.clearTimeout(timer);
      resolve(socket);
    };
    socket.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`Unable to connect to ${url.includes('binaryws') ? 'legacy' : 'current'} Deriv market-data endpoint`));
    };
  });
}

function requestOnce(ws: WebSocket, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const reqId = Math.floor(Math.random() * 900000000) + 100000000;
    const timer = window.setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error('Deriv request timed out'));
    }, 12000);
    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>;
        if (Number(data.req_id) !== reqId) return;
        window.clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        if (data.error) {
          const error = data.error as Record<string, unknown>;
          reject(new Error(String(error.message || 'Deriv API error')));
          return;
        }
        resolve(data);
      } catch {
        window.clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        reject(new Error('Invalid Deriv response'));
      }
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ ...request, req_id: reqId }));
  });
}

async function discoverFrom(endpoint: string, label: string): Promise<DiscoveryResult> {
  const ws = await openDeriv(endpoint);
  try {
    const request: Record<string, unknown> = { active_symbols: 'brief' };
    if (endpoint === LEGACY_DERIV_WS) request.product_type = 'basic';
    const data = await requestOnce(ws, request);
    const all = Array.isArray(data.active_symbols) ? data.active_symbols : [];
    const allRecords = all
      .filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
    const instruments = allRecords
      .filter(isSynthetic)
      .map(normalize)
      .filter((item: Instrument | null): item is Instrument => Boolean(item));
    const unique = Array.from(new Map(instruments.map(item => [item.symbol, item])).values())
      .sort((a, b) => a.name.localeCompare(b.name));
    return { instruments: unique, allInstruments: allRecords, totalMarkets: allRecords.length, endpointLabel: label };
  } finally {
    ws.close();
  }
}

async function discoverCatalogue(): Promise<DiscoveryResult> {
  let legacyError = '';
  try {
    const legacy = await discoverFrom(LEGACY_DERIV_WS, 'Deriv public market-data API');
    if (legacy.instruments.length > 0) return legacy;
    legacyError = `Deriv returned ${legacy.totalMarkets} active markets but no Synthetic Indices matched`;
  } catch (error) {
    legacyError = error instanceof Error ? error.message : String(error);
  }

  try {
    const current = await discoverFrom(CURRENT_DERIV_WS, 'Deriv current public API fallback');
    if (current.instruments.length > 0) return current;
    throw new Error(`Current API returned ${current.totalMarkets} active markets but no Synthetic Indices matched`);
  } catch (error) {
    const currentError = error instanceof Error ? error.message : String(error);
    throw new Error(`${legacyError}; current fallback: ${currentError}`);
  }
}

async function ingestTicks(symbol: string, ticks: Tick[]) {
  for (let i = 0; i < ticks.length; i += INGEST_CHUNK) {
    await api.post('/api/sire/ingest', {
      symbol,
      source: 'Deriv',
      ticks: ticks.slice(i, i + INGEST_CHUNK),
    });
  }
}

function formatQuote(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function App() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Connecting to Deriv…');
  const [lastError, setLastError] = useState('');
  const [endpointLabel, setEndpointLabel] = useState('');
  const [totalMarkets, setTotalMarkets] = useState(0);
  const [latest, setLatest] = useState<Tick | null>(null);
  const [history, setHistory] = useState<Tick[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [acquiring, setAcquiring] = useState(false);
  const [acquiredCount, setAcquiredCount] = useState(0);
  const [liveTicks, setLiveTicks] = useState(0);
  const [connectionNonce, setConnectionNonce] = useState(0);
  const [instrumentMenuOpen, setInstrumentMenuOpen] = useState(false);
  const [chartMode, setChartMode] = useState<'candles' | 'line' | 'ticks'>('candles');
  const [timeframe, setTimeframe] = useState<Timeframe>('1s');
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [chartLayout, setChartLayout] = useState<1 | 2 | 4>(1);
  const [comparisonSymbol, setComparisonSymbol] = useState('');
  const [comparisonCandles, setComparisonCandles] = useState<Candle[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  const [showSma, setShowSma] = useState(false);
  const [showEma, setShowEma] = useState(false);
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [drawingMenuOpen, setDrawingMenuOpen] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<string[]>([]);
  const [indicatorSettings, setIndicatorSettings] = useState<Record<string, { period: number }>>({});
  const [selectedIndicatorName, setSelectedIndicatorName] = useState<string | null>(null);
  const [selectedDrawingTool, setSelectedDrawingTool] = useState('');
  type Drawing = { id: number; kind: 'horizontal' | 'trend'; tool: string; p1: number; p2?: number; e1: number; e2?: number; visible: boolean; locked: boolean; color?: 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'white'; width?: 1 | 2 | 3 };
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedDrawingId, setSelectedDrawingId] = useState<number | null>(null);
  const [drawingEditOpen, setDrawingEditOpen] = useState(false);
  const [magnetMode, setMagnetMode] = useState(true);
  const [drawingPreviewPoint, setDrawingPreviewPoint] = useState<{ price: number; epoch: number } | null>(null);
  const [drawingDrag, setDrawingDrag] = useState<{ id: number; point: 'p1' | 'p2' } | null>(null);
  const [markers, setMarkers] = useState<Array<{ id: number; epoch: number; price: number; label: string }>>([]);
  const [drawingMode, setDrawingMode] = useState<'none' | 'horizontal' | 'trend'>('none');
  const [researchLabOpen, setResearchLabOpen] = useState(false);
  const [dateInput, setDateInput] = useState('');
  const [jumpMessage, setJumpMessage] = useState('');
  const [selectedInspection, setSelectedInspection] = useState<{ epoch: number; price: number; candle?: Candle } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [chartOffset, setChartOffset] = useState(0);
  const [chartPoint, setChartPoint] = useState<{ x: number; y: number } | null>(null);
  const lastDrawingTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const crosshairDragRef = useRef(false);
  const [autoScale, setAutoScale] = useState(true);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const drawingStartRef = useRef<{ price: number; epoch: number } | null>(null);
  const dragRef = useRef<{ x: number; offset: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number; offset: number } | null>(null);
  const chartGestureFrame = useRef<number | null>(null);
  const pendingGesture = useRef<{ type: 'drag' | 'pinch'; x?: number; distance?: number } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const liveBuffer = useRef<Tick[]>([]);
  const seen = useRef(new Set<string>());
  const candleEndRef = useRef<number | 'latest'>('latest');
  const timeframeRef = useRef(timeframe);

  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  const loadCatalog = useCallback(async () => {
    setStatus('Discovering Deriv Synthetic Indices…');
    setLastError('');
    const result = await discoverCatalogue();
    setInstruments(result.instruments);
    setTotalMarkets(result.totalMarkets);
    try {
      await api.post('/api/sire/catalogue/sync', { instruments: result.allInstruments });
    } catch (syncError) {
      setLastError(syncError instanceof Error ? `Catalogue discovered but persistence failed: ${syncError.message}` : 'Catalogue discovered but persistence failed');
    }
    setEndpointLabel(result.endpointLabel);
    setSelected(current => current && result.instruments.some(item => item.symbol === current.symbol) ? current : result.instruments[0] || null);
    if (result.instruments.length === 0) {
      setStatus(`Deriv connected · 0 Synthetic Indices · ${result.totalMarkets} active markets inspected`);
      setLastError('Deriv returned active symbols, but the Synthetic Index classifier found none. The raw catalogue count is shown for diagnosis.');
    } else {
      setStatus(`Deriv online · ${result.instruments.length} Synthetic Indices discovered`);
    }
  }, []);

  const loadCoverage = useCallback(async (symbol: string) => {
    try {
      const [coverageResponse, historyResponse] = await Promise.all([
        api.get(`/api/sire/coverage?symbol=${encodeURIComponent(symbol)}`),
        api.get(`/api/sire/history?symbol=${encodeURIComponent(symbol)}&limit=5000`),
      ]);
      setCoverage(coverageResponse.data.coverage || null);
      const persisted = Array.isArray(historyResponse.data.ticks) ? historyResponse.data.ticks as Tick[] : [];
      setHistory(prev => {
        const merged = [...prev, ...persisted];
        const unique = new Map(merged.map(tick => [`${tick.epoch}:${tick.quote}`, tick]));
        return Array.from(unique.values()).sort((a, b) => a.epoch - b.epoch).slice(-100000);
      });
      const newest = persisted[persisted.length - 1];
      if (newest) setLatest(current => !current || newest.epoch >= current.epoch ? newest : current);
    } catch (error) {
      setCoverage(null);
      setLastError(error instanceof Error ? error.message : 'Unable to load persisted market data');
    }
  }, []);

  useEffect(() => {
    void loadCatalog().catch((error: Error) => {
      setStatus('Deriv connection failed');
      setLastError(error.message);
    });
  }, [loadCatalog, connectionNonce]);

  const updateLiveCandle = useCallback((tick: Tick) => {
    const activeTimeframe = timeframeRef.current;
    if (activeTimeframe === 'tick') return;
    const epoch = bucketEpoch(tick.epoch, activeTimeframe);
    const price = tick.quote;
    setCandles(prev => {
      const matchingIndex = prev.findIndex(candle => candle.epoch === epoch);
      if (matchingIndex >= 0) {
        const current = prev[matchingIndex];
        const next = prev.slice();
        next[matchingIndex] = {
          ...current,
          high: Math.max(current.high, price),
          low: Math.min(current.low, price),
          close: price,
        };
        return next;
      }
      const last = prev[prev.length - 1];
      if (!last || epoch > last.epoch) {
        return [...prev, { epoch, open: price, high: price, low: price, close: price }].slice(-100000);
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    let disposed = false;
    let reconnectTimer = 0;
    setLatest(null);
    setHistory([]);
    setLiveTicks(0);
    liveBuffer.current = [];
    seen.current = new Set();
    void loadCoverage(selected.symbol);

    const connect = async () => {
      try {
        const ws = await openDeriv(CURRENT_DERIV_WS).catch(() => openDeriv(LEGACY_DERIV_WS));
        if (disposed) {
          ws.close();
          return;
        }
        wsRef.current = ws;
        setStatus(`Live · ${selected.name}`);
        ws.send(JSON.stringify({ ticks: selected.symbol, subscribe: 1 }));
        ws.addEventListener('message', event => {
          if (disposed) return;
          try {
            const data = JSON.parse(event.data) as Record<string, unknown>;
            if (data.error) {
              const error = data.error as Record<string, unknown>;
              setLastError(String(error.message || 'Deriv stream error'));
              return;
            }
            if (data.msg_type !== 'tick' || !data.tick || typeof data.tick !== 'object') return;
            const rawTick = data.tick as Record<string, unknown>;
            const tick: Tick = {
              symbol: String(rawTick.symbol || rawTick.underlying_symbol || selected.symbol),
              quote: Number(rawTick.quote),
              bid: Number.isFinite(Number(rawTick.bid)) ? Number(rawTick.bid) : undefined,
              ask: Number.isFinite(Number(rawTick.ask)) ? Number(rawTick.ask) : undefined,
              epoch: Number(rawTick.epoch),
              id: rawTick.id ? String(rawTick.id) : undefined,
              source: 'Deriv',
            };
            if (!Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) return;
            const key = `${tick.symbol}:${tick.epoch}:${tick.quote}`;
            if (seen.current.has(key)) return;
            seen.current.add(key);
            liveBuffer.current.push(tick);
            setLatest(tick);
            setLiveTicks(value => value + 1);
            updateLiveCandle(tick);
            setHistory(prev => {
              const merged = [...prev, tick];
              const unique = new Map(merged.map(item => [`${item.epoch}:${item.quote}`, item]));
              return Array.from(unique.values()).sort((a, b) => a.epoch - b.epoch).slice(-100000);
            });
            if (liveBuffer.current.length >= INGEST_CHUNK) {
              const batch = liveBuffer.current.splice(0, INGEST_CHUNK);
              void ingestTicks(selected.symbol, batch).then(() => loadCoverage(selected.symbol)).catch(() => undefined);
            }
          } catch {
            setLastError('Invalid live tick received from Deriv');
          }
        });
        ws.addEventListener('close', () => {
          if (!disposed) {
            setStatus(`Reconnecting · ${selected.name}`);
            reconnectTimer = window.setTimeout(connect, 1500);
          }
        });
      } catch (error) {
        if (!disposed) {
          setLastError(error instanceof Error ? error.message : 'Live Deriv stream failed');
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      }
    };

    void connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      if (liveBuffer.current.length) void ingestTicks(selected.symbol, liveBuffer.current.splice(0));
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [selected, loadCoverage]);

  const acquireHistory = useCallback(async (backfill: boolean) => {
    if (!selected || acquiring) return;
    setAcquiring(true);
    setLastError('');
    setAcquiredCount(0);
    let end: number | 'latest' = backfill
      ? Math.max(1, Math.floor(history[0]?.epoch || Date.now() / 1000) - 1)
      : 'latest';
    let total = 0;
    let ws: WebSocket | null = null;
    const pageSize = 5000;
    const maxPages = backfill ? 200 : 1;

    const rebuildCandles = (ticks: Tick[]) => {
      const seconds = timeframe === 'tick' ? 1 : TIMEFRAME_SECONDS[timeframe];
      const map = new Map<number, Candle>();
      for (const tick of ticks) {
        const epoch = Math.floor(tick.epoch / seconds) * seconds;
        const current = map.get(epoch);
        if (!current) map.set(epoch, { epoch, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote });
        else map.set(epoch, { epoch, open: current.open, high: Math.max(current.high, tick.quote), low: Math.min(current.low, tick.quote), close: tick.quote });
      }
      setCandles(Array.from(map.values()).sort((a, b) => a.epoch - b.epoch).slice(-100000));
    };

    try {
      ws = await openDeriv(CURRENT_DERIV_WS).catch(() => openDeriv(LEGACY_DERIV_WS));
      for (let page = 0; page < maxPages; page += 1) {
        let data: Record<string, unknown> | null = null;
        let requestError: unknown = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            data = await requestOnce(ws, {
              ticks_history: selected.symbol,
              end,
              count: pageSize,
              style: 'ticks',
              adjust_start_time: 1,
            });
            requestError = null;
            break;
          } catch (error) {
            requestError = error;
            if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
          }
        }
        if (!data) throw requestError instanceof Error ? requestError : new Error('Deriv historical tick request failed');
        const historyNode = data.history && typeof data.history === 'object' ? data.history as Record<string, unknown> : {};
        const prices = Array.isArray(historyNode.prices) ? historyNode.prices : [];
        const times = Array.isArray(historyNode.times) ? historyNode.times : [];
        const incoming: Tick[] = prices.map((price, index) => ({
          symbol: selected.symbol,
          quote: Number(price),
          epoch: Number(times[index]),
          source: 'Deriv' as const,
        })).filter(tick => Number.isFinite(tick.quote) && Number.isFinite(tick.epoch));
        incoming.sort((a, b) => a.epoch - b.epoch);
        if (!incoming.length) throw new Error(`Deriv returned no historical ticks for ${selected.symbol}`);

        await ingestTicks(selected.symbol, incoming);
        total += incoming.length;
        setAcquiredCount(total);
        setHistory(prev => {
          const merged = [...prev, ...incoming];
          const unique = new Map(merged.map(tick => [`${tick.epoch}:${tick.quote}`, tick]));
          const next = Array.from(unique.values()).sort((a, b) => a.epoch - b.epoch).slice(-100000);
          rebuildCandles(next);
          return next;
        });

        const oldest = incoming[0].epoch;
        if (!backfill || incoming.length < pageSize || oldest <= 1) break;
        end = Math.max(1, oldest - 1);
      }
      await loadCoverage(selected.symbol);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Historical tick acquisition failed');
    } finally {
      ws?.close();
      setAcquiring(false);
    }
  }, [selected, acquiring, timeframe, history, loadCoverage]);

  const loadChartHistory = useCallback(async (symbol: string, frame: Timeframe) => {
    if (frame === 'tick') return;
    let ws: WebSocket | null = null;
    try {
      setLastError('');
      ws = await openDeriv(CURRENT_DERIV_WS).catch(() => openDeriv(LEGACY_DERIV_WS));
      const seconds = TIMEFRAME_SECONDS[frame];
      const useDirectCandles = seconds >= 60 && frame !== '1W' && frame !== '1M';
      const request: Record<string, unknown> = useDirectCandles
        ? {
            ticks_history: symbol,
            end: 'latest',
            count: 1000,
            style: 'candles',
            granularity: seconds,
            adjust_start_time: 1,
          }
        : {
            ticks_history: symbol,
            end: 'latest',
            count: frame === '1W' || frame === '1M' ? 1500 : HISTORY_CHUNK,
            style: frame === '1W' || frame === '1M' ? 'candles' : 'ticks',
            ...(frame === '1W' || frame === '1M' ? { granularity: 86400 } : {}),
            adjust_start_time: 1,
          };
      const data = await requestOnce(ws, request);
      if (useDirectCandles || frame === '1W' || frame === '1M') {
        const raw = Array.isArray(data.candles) ? data.candles as Array<Record<string, unknown>> : [];
        const daily = raw.map(candle => ({
          epoch: Number(candle.epoch),
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
        })).filter(candle => Object.values(candle).every(Number.isFinite)).sort((a, b) => a.epoch - b.epoch);
        if (!daily.length) throw new Error(`Deriv returned no candles for ${symbol} at ${frame}`);
        if (frame === '1W' || frame === '1M') {
          const map = new Map<number, Candle>();
          for (const candle of daily) {
            const epoch = bucketEpoch(candle.epoch, frame);
            const current = map.get(epoch);
            if (!current) map.set(epoch, { epoch, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
            else map.set(epoch, { epoch, open: current.open, high: Math.max(current.high, candle.high), low: Math.min(current.low, candle.low), close: candle.close });
          }
          setCandles(Array.from(map.values()).sort((a, b) => a.epoch - b.epoch).slice(-500));
        } else {
          setCandles(daily.slice(-1000));
        }
        return;
      }
      const historyNode = data.history && typeof data.history === 'object' ? data.history as Record<string, unknown> : {};
      const prices = Array.isArray(historyNode.prices) ? historyNode.prices : [];
      const times = Array.isArray(historyNode.times) ? historyNode.times : [];
      const ticks = prices.map((price, index) => ({
        symbol,
        quote: Number(price),
        epoch: Number(times[index]),
        source: 'Deriv' as const,
      })).filter(tick => Number.isFinite(tick.quote) && Number.isFinite(tick.epoch));
      if (!ticks.length) throw new Error(`Deriv returned no ticks for ${symbol} at ${frame}`);
      const map = new Map<number, Candle>();
      for (const tick of ticks) {
        const epoch = bucketEpoch(tick.epoch, frame);
        const current = map.get(epoch);
        if (!current) map.set(epoch, { epoch, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote });
        else map.set(epoch, { epoch, open: current.open, high: Math.max(current.high, tick.quote), low: Math.min(current.low, tick.quote), close: tick.quote });
      }
      setCandles(Array.from(map.values()).sort((a, b) => a.epoch - b.epoch).slice(-1000));
    } catch (error) {
      setCandles([]);
      setLastError(error instanceof Error ? error.message : `Unable to load ${frame} Deriv chart history`);
    } finally {
      ws?.close();
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    timeframeRef.current = timeframe;
    setCandles([]);
    setChartOffset(0);
    candleEndRef.current = 'latest';
    if (timeframe === 'tick') void acquireHistory(false);
    else void loadChartHistory(selected.symbol, timeframe);
  }, [selected, timeframe, loadChartHistory]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? instruments.filter(item => `${item.name} ${item.symbol}`.toLowerCase().includes(q)) : instruments;
  }, [instruments, search]);

  const latestDelta = latest && history.length > 1 ? latest.quote - history[history.length - 2].quote : 0;
  const historicalLoaded = timeframe === 'tick' ? history.length > 0 : candles.length > 0;
  const range = timeframe === 'tick' && history.length
    ? `${new Date(history[0].epoch * 1000).toLocaleString()} → ${new Date(history[history.length - 1].epoch * 1000).toLocaleString()}`
    : candles.length
      ? `${new Date(candles[0].epoch * 1000).toLocaleString()} → ${new Date(candles[candles.length - 1].epoch * 1000).toLocaleString()}`
      : 'No local sample yet';

  const chartBars = useMemo(() => {
    if (timeframe !== 'tick') {
      return candles.map(candle => ({ ...candle, quote: candle.close }));
    }
    const source = history.slice().sort((a, b) => a.epoch - b.epoch);
    if (!source.length) return [] as Array<{ epoch: number; open: number; high: number; low: number; close: number; quote: number }>;
    return source.map(tick => ({ epoch: tick.epoch, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote, quote: tick.quote }));
  }, [history, candles, timeframe]);

  const visibleBars = useMemo(() => {
    // Keep hundreds of candles visible at normal zoom while retaining enough loaded ticks
    // for the selected timeframe to represent a meaningful historical window.
    const count = Math.max(80, Math.min(360, Math.round(180 * zoom)));
    const end = Math.max(0, chartBars.length - chartOffset);
    // The newest candle always occupies the final slot. Individual live ticks
    // update that candle in place; only a new timeframe bucket advances the
    // viewport, so ticks cannot push the whole chart left.
    return chartBars.slice(Math.max(0, end - count), end);
  }, [chartBars, zoom, chartOffset]);

  const chartGeometry = useMemo(() => {
    if (!visibleBars.length) return null;
    const rawMin = Math.min(...visibleBars.map(bar => bar.low));
    const rawMax = Math.max(...visibleBars.map(bar => bar.high));
    const span = Math.max(rawMax - rawMin, Math.abs(rawMax || 1) * 0.000001);
    const pad = span * 0.08;
    if (autoScale) return { min: rawMin - pad, max: rawMax + pad };
    const fixed = chartBars.slice(Math.max(0, chartBars.length - Math.min(chartBars.length, 500)));
    const fixedMin = fixed.length ? Math.min(...fixed.map(bar => bar.low)) : rawMin;
    const fixedMax = fixed.length ? Math.max(...fixed.map(bar => bar.high)) : rawMax;
    const fixedSpan = Math.max(fixedMax - fixedMin, Math.abs(fixedMax || 1) * 0.000001);
    return { min: fixedMin - fixedSpan * 0.08, max: fixedMax + fixedSpan * 0.08 };
  }, [visibleBars, chartBars, autoScale]);

  const flushChartGesture = useCallback(() => {
    chartGestureFrame.current = null;
    const gesture = pendingGesture.current;
    pendingGesture.current = null;
    if (!gesture) return;
    if (gesture.type === 'pinch' && pinchRef.current && gesture.distance) {
      const nextZoom = pinchRef.current.zoom * gesture.distance / pinchRef.current.distance;
      setZoom(Number(Math.max(0.55, Math.min(2.8, nextZoom)).toFixed(2)));
      return;
    }
    if (gesture.type === 'drag' && dragRef.current && gesture.x !== undefined) {
      const delta = gesture.x - dragRef.current.x;
      setChartOffset(Math.max(0, Math.min(Math.max(0, chartBars.length - 1), dragRef.current.offset + delta / 2.6)));
    }
  }, [chartBars.length]);

  const scheduleChartGesture = useCallback((gesture: { type: 'drag' | 'pinch'; x?: number; distance?: number }) => {
    pendingGesture.current = gesture;
    if (chartGestureFrame.current === null) chartGestureFrame.current = window.requestAnimationFrame(flushChartGesture);
  }, [flushChartGesture]);

  const snapPricePoint = useCallback((point: { epoch: number; price: number; candle?: Candle }) => {
    if (!magnetMode || !point.candle) return point;
    const levels = [point.candle.open, point.candle.high, point.candle.low, point.candle.close];
    const span = chartGeometry ? Math.max(chartGeometry.max - chartGeometry.min, Math.abs(point.price) * 0.000001) : Math.abs(point.price) * 0.01;
    const tolerance = span * 0.018;
    const nearest = levels.reduce((best, value) => Math.abs(value - point.price) < Math.abs(best - point.price) ? value : best, point.price);
    return Math.abs(nearest - point.price) <= tolerance ? { ...point, price: nearest } : point;
  }, [magnetMode, chartGeometry]);

  const getPlotRect = useCallback(() => {
    const stage = chartRef.current?.getBoundingClientRect();
    if (!stage) return null;
    return { left: 8, top: 12, width: Math.max(1, stage.width - 64), height: Math.max(1, stage.height - 38) };
  }, []);

  const priceAtPoint = useCallback((x: number, y: number, snap = true) => {
    if (!chartGeometry || !visibleBars.length) return null;
    const plot = getPlotRect();
    if (!plot) return null;
    const px = Math.max(0, Math.min(plot.width, x - plot.left));
    const py = Math.max(0, Math.min(plot.height, y - plot.top));
    const price = chartGeometry.max - (py / plot.height) * (chartGeometry.max - chartGeometry.min);
    const index = Math.max(0, Math.min(visibleBars.length - 1, Math.round((px / plot.width) * Math.max(0, visibleBars.length - 1))));
    const point = { epoch: visibleBars[index].epoch, price, candle: visibleBars[index] };
    return snap ? snapPricePoint(point) : point;
  }, [chartGeometry, visibleBars, snapPricePoint, getPlotRect]);

  const findDrawingHit = useCallback((x: number, y: number) => {
    if (!chartRef.current || !chartGeometry) return null;
    const rect = chartRef.current.getBoundingClientRect();
    const range = Math.max(chartGeometry.max - chartGeometry.min, Number.EPSILON);
    const tolerance = Math.max(11, Math.min(18, rect.width * 0.028));
    const plot = getPlotRect();
    if (!plot) return null;
    const pointX = (epoch: number) => {
      const found = visibleBars.findIndex(bar => bar.epoch >= epoch);
      const index = found < 0 ? visibleBars.length - 1 : found;
      return visibleBars.length <= 1 ? plot.left + plot.width / 2 : plot.left + index / Math.max(1, visibleBars.length - 1) * plot.width;
    };
    const pointY = (price: number) => plot.top + (chartGeometry.max - price) / range * plot.height;
    for (let i = drawings.length - 1; i >= 0; i -= 1) {
      const drawing = drawings[i];
      if (!drawing.visible || drawing.locked) continue;
      const x1 = pointX(drawing.e1);
      const y1 = pointY(drawing.p1);
      if (Math.hypot(x - x1, y - y1) <= tolerance) return { id: drawing.id, point: 'p1' as const };
      if (drawing.p2 !== undefined && drawing.e2 !== undefined) {
        const x2 = pointX(drawing.e2);
        const y2 = pointY(drawing.p2);
        if (Math.hypot(x - x2, y - y2) <= tolerance) return { id: drawing.id, point: 'p2' as const };
        const t = Math.max(0, Math.min(1, (x - plot.left) / Math.max(1, plot.width)));
        if (Math.abs(y - (y1 + (y2 - y1) * t)) <= Math.max(8, plot.height * 0.018)) return { id: drawing.id, point: 'p1' as const };
      }
    }
    return null;
  }, [drawings, chartGeometry, visibleBars, getPlotRect]);

  const singlePointTools = useMemo(() => new Set(['Horizontal Line', 'Horizontal Ray', 'Vertical Line', 'Text', 'Note', 'Callout', 'Price Label', 'Arrow Mark Up', 'Flag Mark', 'Pin', 'Emoji', 'Cycle Lines', 'Time Cycles']), []);

  const updateDrawing = useCallback((id: number, patch: Partial<Drawing>) => {
    setDrawings(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const straightenSelectedDrawing = useCallback(() => {
    if (selectedDrawingId === null) return;
    setDrawings(prev => prev.map(item => item.id === selectedDrawingId && item.p2 !== undefined && item.e2 !== undefined ? { ...item, p2: item.p1 } : item));
  }, [selectedDrawingId]);

  const verticalizeSelectedDrawing = useCallback(() => {
    if (selectedDrawingId === null) return;
    setDrawings(prev => prev.map(item => item.id === selectedDrawingId && item.p2 !== undefined && item.e2 !== undefined ? { ...item, e2: item.e1 } : item));
  }, [selectedDrawingId]);

  const flipSelectedDrawing = useCallback(() => {
    if (selectedDrawingId === null) return;
    setDrawings(prev => prev.map(item => item.id === selectedDrawingId && item.p2 !== undefined && item.e2 !== undefined ? { ...item, p1: item.p2, p2: item.p1, e1: item.e2, e2: item.e1 } : item));
  }, [selectedDrawingId]);

  const commitDrawingPoint = useCallback((point: { epoch: number; price: number }) => {
    if (drawingMode === 'none') return;
    const tool = selectedDrawingTool || (drawingMode === 'horizontal' ? 'Horizontal Line' : 'Trend Line');
    if (drawingMode === 'horizontal' || singlePointTools.has(tool)) {
      setDrawings(prev => [...prev, { id: Date.now(), kind: 'horizontal', tool, p1: point.price, e1: point.epoch, visible: true, locked: false, color: 'blue', width: 1 }]);
      drawingStartRef.current = null;
      setDrawingPreviewPoint(null);
      setDrawingMode('none');
      setSelectedDrawingId(null);
      setShowCrosshair(false);
      return;
    }
    if (!drawingStartRef.current) {
      drawingStartRef.current = { price: point.price, epoch: point.epoch };
      setDrawingPreviewPoint(point);
      return;
    }
    const start = drawingStartRef.current;
    setDrawings(prev => [...prev, { id: Date.now(), kind: 'trend', tool, p1: start.price, p2: point.price, e1: start.epoch, e2: point.epoch, visible: true, locked: false, color: 'blue', width: 1 }]);
    drawingStartRef.current = null;
    setDrawingPreviewPoint(null);
    setDrawingMode('none');
    setSelectedDrawingId(null);
    setShowCrosshair(false);
  }, [drawingMode, selectedDrawingTool, singlePointTools]);

  const handleChartClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (drawingMode !== 'none') {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const handleChartPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drawingMode === 'none' && showCrosshair) {
      event.preventDefault();
      event.stopPropagation();
      const rect = chartRef.current?.getBoundingClientRect();
      if (rect) {
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const now = performance.now();
        const previous = lastDrawingTapRef.current;
        const isDoubleTap = Boolean(previous && now - previous.time <= 360);
        if (isDoubleTap) {
          lastDrawingTapRef.current = null;
          crosshairDragRef.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }
        const currentPoint = chartPoint;
        const grabbedCrosshair = Boolean(currentPoint && Math.hypot(x - currentPoint.x, y - currentPoint.y) <= 28);
        crosshairDragRef.current = grabbedCrosshair;
        if (!currentPoint) {
          const point = priceAtPoint(x, y, false);
          if (point) {
            setChartPoint({ x, y });
            setSelectedInspection(point);
          }
        }
        lastDrawingTapRef.current = { time: now, x, y };
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (drawingMode !== 'none') {
      event.preventDefault();
      event.stopPropagation();
      const rect = chartRef.current?.getBoundingClientRect();
      if (rect) {
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const point = priceAtPoint(x, y, false);
        const now = performance.now();
        const previous = lastDrawingTapRef.current;
        const isDoubleTap = Boolean(previous && now - previous.time <= 360);
        const tool = selectedDrawingTool || (drawingMode === 'horizontal' ? 'Horizontal Line' : 'Trend Line');
        const isMultiPointTool = drawingMode !== 'horizontal' && !singlePointTools.has(tool);

        if (isDoubleTap) {
          // Double-tap is a command anywhere on the chart. It must use the
          // already placed crosshair/inspection point, never the tap location.
          lastDrawingTapRef.current = null;
          crosshairDragRef.current = false;
          const committed = selectedInspection ?? drawingPreviewPoint;
          if (committed) commitDrawingPoint({ epoch: committed.epoch, price: committed.price });
        } else {
          // A single tap can place the crosshair only when none exists, or begin
          // an explicit drag when the user actually touched the crosshair.
          // Tapping anywhere else is intentionally ignored.
          const currentPoint = chartPoint;
          const distanceFromCrosshair = currentPoint ? Math.hypot(x - currentPoint.x, y - currentPoint.y) : Infinity;
          const grabbedCrosshair = Boolean(currentPoint && distanceFromCrosshair <= 24);
          crosshairDragRef.current = grabbedCrosshair;
          if (!currentPoint && point) {
            setChartPoint({ x, y });
            setSelectedInspection(point);
            if (isMultiPointTool) setDrawingPreviewPoint(null);
          } else if (grabbedCrosshair && point) {
            setSelectedInspection(point);
            if (isMultiPointTool) setDrawingPreviewPoint(null);
          }
          lastDrawingTapRef.current = { time: now, x, y };
        }
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const rect = chartRef.current?.getBoundingClientRect();
    if (rect && drawingMode === 'none') {
      const hit = findDrawingHit(event.clientX - rect.left, event.clientY - rect.top);
      if (hit) {
        setSelectedDrawingId(hit.id);
        setDrawingEditOpen(true);
        const selected = drawings.find(item => item.id === hit.id);
        if (selected && !selected.locked) setDrawingDrag({ id: hit.id, point: hit.point });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      setSelectedDrawingId(null);
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size === 1) {
      dragRef.current = { x: event.clientX, offset: chartOffset };
    } else if (pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());
      pinchRef.current = { distance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)), zoom, offset: chartOffset };
      dragRef.current = null;
    }
  };
  const handleChartPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drawingDrag && pointersRef.current.size <= 1) {
      const rect = chartRef.current?.getBoundingClientRect();
      const point = rect ? priceAtPoint(event.clientX - rect.left, event.clientY - rect.top, false) : null;
      if (rect) setChartPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      if (point) setDrawings(prev => prev.map(item => item.id === drawingDrag.id ? { ...item, [drawingDrag.point]: point.price, [drawingDrag.point === 'p1' ? 'e1' : 'e2']: point.epoch } : item));
      return;
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const rect = chartRef.current?.getBoundingClientRect();
    if (rect) {
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      // Once placed, the crosshair is stationary. Only an explicit drag that
      // starts on the crosshair is allowed to move it. Drawing mode does not
      // change this rule: taps elsewhere are reserved for the double-tap command.
      if (crosshairDragRef.current) {
        setChartPoint({ x, y });
        const inspected = priceAtPoint(x, y);
        if (inspected) {
          setSelectedInspection(inspected);
          if (drawingMode !== 'none') setDrawingPreviewPoint(inspected);
        }
      }
    }
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const points = Array.from(pointersRef.current.values());
      const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
      scheduleChartGesture({ type: 'pinch', distance });
      return;
    }
    if (dragRef.current && !showCrosshair) scheduleChartGesture({ type: 'drag', x: event.clientX });
  };
  const jumpToDateTime = useCallback(() => {
    if (!dateInput || !chartBars.length) return;
    const target = new Date(dateInput).getTime() / 1000;
    if (!Number.isFinite(target)) return;
    const nearest = chartBars.reduce((best, bar, index) => Math.abs(bar.epoch - target) < Math.abs(chartBars[best].epoch - target) ? index : best, 0);
    const count = Math.max(80, Math.min(360, Math.round(180 * zoom)));
    setChartOffset(Math.max(0, chartBars.length - nearest - Math.floor(count / 2)));
    setJumpMessage(`Jumped to ${new Date(chartBars[nearest].epoch * 1000).toLocaleString()}`);
  }, [dateInput, chartBars, zoom]);

  const stepHistory = useCallback((direction: -1 | 1) => {
    const step = Math.max(1, Math.floor((Math.max(80, Math.min(360, Math.round(180 * zoom)))) / 4));
    setChartOffset(value => Math.max(0, Math.min(Math.max(0, chartBars.length - 1), value + direction * step)));
  }, [chartBars.length, zoom]);

  const addMarker = useCallback(() => {
    if (!selectedInspection) return;
    setMarkers(prev => [...prev, { id: Date.now(), epoch: selectedInspection.epoch, price: selectedInspection.price, label: `M${prev.length + 1}` }]);
  }, [selectedInspection]);

  const loadComparison = useCallback(async (symbol: string) => {
    if (!symbol || symbol === selected?.symbol || timeframe === 'tick') return;
    try {
      const ws = await openDeriv(CURRENT_DERIV_WS).catch(() => openDeriv(LEGACY_DERIV_WS));
      const data = await requestOnce(ws, { ticks_history: symbol, end: 'latest', count: CANDLE_CHUNK, style: 'candles', granularity: TIMEFRAME_SECONDS[timeframe] });
      ws.close();
      const raw = Array.isArray(data.candles) ? data.candles as Array<Record<string, unknown>> : [];
      setComparisonCandles(raw.map(candle => ({ epoch: Number(candle.epoch), open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close) })).filter(c => Object.values(c).every(Number.isFinite)).sort((a, b) => a.epoch - b.epoch));
      setShowComparison(true);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Comparison history failed');
    }
  }, [selected, timeframe]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedDrawingId !== null) {
        event.preventDefault();
        setDrawings(prev => prev.filter(item => item.id !== selectedDrawingId));
        setSelectedDrawingId(null);
      }
      if (event.key === 'Escape') { setDrawingMode('none'); drawingStartRef.current = null; setSelectedDrawingId(null); setDrawingDrag(null); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedDrawingId]);

  const handleChartPointerUp = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (event) pointersRef.current.delete(event.pointerId);
    crosshairDragRef.current = false;
    setDrawingDrag(null);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 1 && !showCrosshair) {
      const remaining = Array.from(pointersRef.current.values())[0];
      dragRef.current = { x: remaining.x, offset: chartOffset };
    } else {
      dragRef.current = null;
    }
  };
  const indicatorEnginePaths = useMemo(() => {
    if (!activeIndicators.length || !visibleBars.length) return [] as Array<{ name: string; path: string }>;
    const close = visibleBars.map(bar => bar.close);
    return activeIndicators.filter(name => !PANE_INDICATOR_NAMES.has(name) && name !== 'SMA' && name !== 'EMA').map(name => {
      const values = visibleBars.map((bar, i) => {
        const start = Math.max(0, i - 13);
        const win = close.slice(start, i + 1);
        const mean = win.reduce((a, b) => a + b, 0) / win.length;
        const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length;
        const high = Math.max(...visibleBars.slice(start, i + 1).map(b => b.high));
        const low = Math.min(...visibleBars.slice(start, i + 1).map(b => b.low));
        const gain = win.slice(1).reduce((s, v, j) => s + Math.max(0, v - win[j]), 0) / Math.max(1, win.length - 1);
        const loss = win.slice(1).reduce((s, v, j) => s + Math.max(0, win[j] - v), 0) / Math.max(1, win.length - 1);
        const rsi = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
        const key = name.toLowerCase();
        if (key.includes('rsi') || key.includes('stochastic') || key.includes('williams') || key.includes('mfi')) return rsi;
        if (key.includes('bollinger')) return mean + Math.sqrt(variance) * 2;
        if (key.includes('atr') || key.includes('volatility') || key.includes('range')) return high - low;
        if (key.includes('vwap')) return visibleBars.slice(0, i + 1).reduce((s, b) => s + (b.high + b.low + b.close) / 3, 0) / (i + 1);
        if (key.includes('roc')) return ((close[i] / (close[Math.max(0, i - 14)] || close[i])) - 1) * 100;
        if (key.includes('momentum')) return close[i] - close[Math.max(0, i - 1)];
        if (key.includes('variance') || key.includes('standard deviation')) return Math.sqrt(variance);
        if (key.includes('macd')) return close[i] - mean;
        return mean;
      });
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = Math.max(max - min, 1e-9);
      const path = values.map((value, i) => { const x = visibleBars.length === 1 ? 50 : i / (visibleBars.length - 1) * 100; const y = 10 + (100 - (value - min) / span * 100) * .8; return `${i === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`; }).join(' ');
      return { name, path };
    });
  }, [activeIndicators, visibleBars]);

  const indicatorPanePaths = useMemo(() => {
    if (!activeIndicators.length || !visibleBars.length) return [] as Array<{ name: string; path: string; zeroLine?: boolean }>;
    const close = visibleBars.map(bar => bar.close);
    const emaSeries = (period: number) => {
      const alpha = 2 / (period + 1);
      let ema = close[0] || 0;
      return close.map((value, index) => {
        ema = index === 0 ? value : value * alpha + ema * (1 - alpha);
        return ema;
      });
    };
    const valuesFor = (name: string) => {
      const key = name.toLowerCase();
      const values: number[] = [];
      const ema12 = emaSeries(12);
      const ema26 = emaSeries(26);
      for (let i = 0; i < visibleBars.length; i += 1) {
        const period = indicatorSettings[name]?.period ?? 14;
        const start = Math.max(0, i - period + 1);
        const window = close.slice(start, i + 1);
        const highs = visibleBars.slice(start, i + 1).map(bar => bar.high);
        const lows = visibleBars.slice(start, i + 1).map(bar => bar.low);
        const mean = window.reduce((sum, value) => sum + value, 0) / Math.max(1, window.length);
        const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, window.length);
        const gain = window.slice(1).reduce((sum, value, j) => sum + Math.max(0, value - window[j]), 0) / Math.max(1, window.length - 1);
        const loss = window.slice(1).reduce((sum, value, j) => sum + Math.max(0, window[j] - value), 0) / Math.max(1, window.length - 1);
        const rsi = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
        const range = Math.max(...highs) - Math.min(...lows);
        const previousClose = close[Math.max(0, i - 1)];
        const trueRange = Math.max(visibleBars[i].high - visibleBars[i].low, Math.abs(visibleBars[i].high - previousClose), Math.abs(visibleBars[i].low - previousClose));
        if (key === 'rsi' || key.includes('stochastic rsi') || key.includes('stochastic') || key.includes('williams')) values.push(key.includes('williams') ? -100 + rsi : rsi);
        else if (key === 'macd') values.push(ema12[i] - ema26[i]);
        else if (key.includes('momentum')) values.push(close[i] - close[Math.max(0, i - 10)]);
        else if (key === 'roc') values.push(((close[i] / (close[Math.max(0, i - 12)] || close[i])) - 1) * 100);
        else if (key === 'cci') values.push(range === 0 ? 0 : (close[i] - mean) / Math.sqrt(Math.max(variance, 1e-12)) * 66.67);
        else if (key === 'mfi') values.push(rsi);
        else if (key.includes('atr') || key.includes('volatility') || key.includes('range')) values.push(trueRange);
        else if (key.includes('variance') || key.includes('standard deviation')) values.push(Math.sqrt(variance));
        else if (key === 'volume' || key.includes('volume') || key.includes('obv') || key.includes('force index') || key.includes('ease of movement')) values.push(range);
        else if (key === 'adx' || key.includes('aroon') || key.includes('vortex')) values.push(Math.min(100, Math.abs(close[i] - mean) / Math.max(Math.sqrt(variance), 1e-9) * 20));
        else if (key === 'elder ray') values.push(close[i] - mean);
        else if (key.includes('sharpe') || key.includes('sortino') || key.includes('r-squared') || key.includes('correlation') || key.includes('beta')) values.push((close[i] - mean) / Math.max(Math.sqrt(variance), 1e-9));
        else values.push(rsi);
      }
      return values;
    };
    return activeIndicators.filter(name => PANE_INDICATOR_NAMES.has(name)).map(name => {
      const values = valuesFor(name);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = Math.max(max - min, 1e-9);
      const path = values.map((value, index) => {
        const x = visibleBars.length === 1 ? 50 : (index / (visibleBars.length - 1)) * 100;
        const y = 92 - ((value - min) / span) * 78;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`;
      }).join(' ');
      return { name, path, zeroLine: min < 0 && max > 0 };
    });
  }, [activeIndicators, indicatorSettings, visibleBars]);

  const comparisonPath = useMemo(() => {
    if (!showComparison || !comparisonCandles.length || !visibleBars.length || !chartGeometry) return '';
    const byEpoch = new Map(comparisonCandles.map(c => [c.epoch, c.close]));
    const points = visibleBars.map(bar => ({ epoch: bar.epoch, value: byEpoch.get(bar.epoch) }));
    const first = points.find(point => point.value !== undefined)?.value;
    if (first === undefined || first === 0) return '';
    const base = visibleBars[0]?.close || 1;
    return points.map((point, index) => {
      const value = point.value === undefined ? (index ? points[index - 1].value : first) : point.value;
      const normalized = base * (Number(value) / first);
      const x = visibleBars.length === 1 ? 50 : (index / (visibleBars.length - 1)) * 100;
      const y = 100 - ((normalized - chartGeometry.min) / (chartGeometry.max - chartGeometry.min)) * 100;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`;
    }).join(' ');
  }, [showComparison, comparisonCandles, visibleBars, chartGeometry]);

  const movingAverage = useCallback((source: typeof visibleBars, period: number, exponential: boolean) => {
    if (!source.length) return '';
    let ema = source[0].close;
    const alpha = 2 / (period + 1);
    return source.map((bar, index) => {
      if (exponential) ema = index === 0 ? bar.close : (bar.close * alpha) + (ema * (1 - alpha));
      const start = Math.max(0, index - period + 1);
      const simple = source.slice(start, index + 1).reduce((sum, item) => sum + item.close, 0) / (index - start + 1);
      const value = exponential ? ema : simple;
      const x = source.length === 1 ? 50 : (index / (source.length - 1)) * 100;
      const y = 100 - ((value - (chartGeometry?.min ?? value)) / ((chartGeometry?.max ?? value + 1) - (chartGeometry?.min ?? value))) * 100;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`;
    }).join(' ');
  }, [chartGeometry]);

  const smaPath = showSma && chartGeometry ? movingAverage(visibleBars, 20, false) : '';
  const emaPath = showEma && chartGeometry ? movingAverage(visibleBars, 20, true) : '';

  const chartPath = visibleBars.length && chartGeometry
    ? visibleBars.map((bar, index) => {
        const x = visibleBars.length === 1 ? 50 : (index / (visibleBars.length - 1)) * 100;
        const y = 100 - ((bar.close - chartGeometry.min) / (chartGeometry.max - chartGeometry.min)) * 100;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`;
      }).join(' ')
    : '';

  return (
    <>
    <main className="terminal-shell">
      <header className="terminal-topbar">
        <div className="brand-block"><div className="brand-mark">S</div><div><b>SIRE</b><span>MARKET RESEARCH TERMINAL</span></div></div>
        <button className="instrument-picker" onClick={() => setInstrumentMenuOpen(value => !value)} aria-label="Change instrument">
          <span><strong>{selected?.name || 'Select instrument'}</strong><small>{selected?.symbol || 'Synthetic Index'} · Deriv</small></span>
          <ChevronDown size={16} />
        </button>
        <div className="live-state"><span className="live-dot" />{status.startsWith('Live') ? 'LIVE' : status.replace('Deriv ', '')}</div>
      </header>

      {instrumentMenuOpen && (
        <div className="instrument-overlay" onClick={() => setInstrumentMenuOpen(false)}>
          <div className="instrument-sheet" onClick={event => event.stopPropagation()}>
            <div className="sheet-head"><div><span>CHANGE INSTRUMENT</span><b>{instruments.length} Synthetic Indices</b></div><button onClick={() => setInstrumentMenuOpen(false)}>Done</button></div>
            <div className="sheet-search"><Search size={15} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search instrument or symbol" /></div>
            <div className="sheet-list">
              {filtered.map(item => (
                <button key={item.symbol} className={`sheet-row ${selected?.symbol === item.symbol ? 'active' : ''}`} onClick={() => { setSelected(item); setInstrumentMenuOpen(false); }}>
                  <span><b>{item.name}</b><small>{item.symbol}</small></span><em>{selected?.symbol === item.symbol ? 'SELECTED' : item.exchangeOpen === 0 ? 'OFF' : 'LIVE'}</em>
                </button>
              ))}
              {!filtered.length && <div className="empty-state">No instruments found.</div>}
            </div>
          </div>
        </div>
      )}

      <div className="terminal-body">
        <aside className="symbol-sidebar">
          <div className="sidebar-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" /></div>
          <div className="sidebar-meta"><span>DERIV SYNTHETIC</span><b>{filtered.length}</b></div>
          <div className="symbol-list">
            {filtered.map(item => (
              <button key={item.symbol} className={`symbol-row ${selected?.symbol === item.symbol ? 'active' : ''}`} onClick={() => setSelected(item)} aria-label={`Select ${item.name}`}>
                <span><b>{item.name}</b><small>{item.symbol}</small></span><em>{item.exchangeOpen === 0 ? 'OFF' : '●'}</em>
              </button>
            ))}
            {!filtered.length && <div className="empty-state">No instruments found.</div>}
          </div>
          <button className="catalogue-refresh" onClick={() => setConnectionNonce(value => value + 1)}><RotateCcw size={13} /> Refresh catalogue</button>
        </aside>

        <section className="chart-terminal">
          <div className="chart-toolbar">
            <div className="tool-group chart-types">
              <button className={chartMode === 'candles' ? 'tool-active' : ''} onClick={() => setChartMode('candles')} title="Candlestick"><CandlestickChart size={15} /></button>
              <button className={chartMode === 'line' ? 'tool-active' : ''} onClick={() => setChartMode('line')} title="Line"><LineChart size={15} /></button>
              <button className={chartMode === 'ticks' ? 'tool-active' : ''} onClick={() => setChartMode('ticks')} title="Tick"><Activity size={15} /></button>
            </div>
            <div className="timeframes">
              {TIMEFRAME_LIST.map(frame => <button key={frame} className={timeframe === frame ? 'tool-active' : ''} onClick={() => { setTimeframe(frame); setChartOffset(0); }}>{frame}</button>)}
            </div>
            <div className="chart-tools">
              <button className={showCrosshair ? 'tool-active' : ''} onClick={() => setShowCrosshair(value => !value)} title="Crosshair"><Crosshair size={15} /></button>
              <button className={autoScale ? 'tool-active' : ''} onClick={() => setAutoScale(value => !value)} title="Auto / Linear price scale">A/L</button>
              <button onClick={() => { setZoom(1); setChartOffset(0); setAutoScale(true); }} title="Reset view"><RotateCcw size={15} /></button>
              <button onClick={() => setZoom(value => Math.min(2.8, Number((value + 0.25).toFixed(2))))}>+</button>
              <button onClick={() => setZoom(value => Math.max(0.55, Number((value - 0.25).toFixed(2))))}>−</button>
              <button onClick={() => void acquireHistory(false)} disabled={!selected || acquiring}>5K</button>
              <button className="history-button" onClick={() => void acquireHistory(true)} disabled={!selected || acquiring}>{acquiring ? `${acquiredCount.toLocaleString()}` : 'HISTORY'}</button>
              <button title="Time navigation" onClick={() => stepHistory(-1)}><Clock3 size={15} /></button>
              <button title="Forward in history" onClick={() => stepHistory(1)}>›</button>
              <button title="Date/time selection" onClick={() => document.getElementById('sire-date-jump')?.focus()}><Calendar size={15} /></button>
              <button title="1 chart" className={chartLayout === 1 ? 'tool-active' : ''} onClick={() => setChartLayout(1)}>1</button>
              <button title="2 charts" className={chartLayout === 2 ? 'tool-active' : ''} onClick={() => setChartLayout(2)}>2</button>
              <button title="4 charts" className={chartLayout === 4 ? 'tool-active' : ''} onClick={() => setChartLayout(4)}>4</button>
              <button title="SMA 20" className={showSma ? 'tool-active' : ''} onClick={() => setShowSma(value => !value)}>SMA</button>
              <button title="EMA 20" className={showEma ? 'tool-active' : ''} onClick={() => setShowEma(value => !value)}>EMA</button>
              <button title="Technical indicators" className={indicatorMenuOpen ? 'tool-active' : ''} onClick={() => { setIndicatorMenuOpen(value => !value); setDrawingMenuOpen(false); }}><BarChart3 size={15} /></button>
              <button title="Comparison" className={showComparison ? 'tool-active' : ''} onClick={() => setShowComparison(value => !value)}><GitCompareArrows size={15} /></button>
              <button title="Drawing tools" className={drawingMenuOpen ? 'tool-active' : ''} onClick={() => { setDrawingMenuOpen(value => !value); setIndicatorMenuOpen(false); }}><Shapes size={15} /></button>
              <button title="Horizontal drawing" className={drawingMode === 'horizontal' ? 'tool-active' : ''} onClick={() => { setSelectedDrawingTool('Horizontal Line'); setDrawingMode(value => value === 'horizontal' ? 'none' : 'horizontal'); }}><Layers size={15} /></button>
              <button title="Trend drawing" className={drawingMode === 'trend' ? 'tool-active' : ''} onClick={() => { setSelectedDrawingTool('Trend Line'); setDrawingMode(value => value === 'trend' ? 'none' : 'trend'); }}><Pencil size={15} /></button>
              <button title="Add marker at crosshair" onClick={addMarker}><Flag size={15} /></button>
              <button title="Magnet snapping" className={magnetMode ? 'tool-active' : ''} onClick={() => setMagnetMode(value => !value)}>⌁</button>
              <button title="Delete selected drawing" disabled={selectedDrawingId === null} onClick={() => { if (selectedDrawingId !== null) { setDrawings(prev => prev.filter(item => item.id !== selectedDrawingId)); setSelectedDrawingId(null); } }}>⌫</button>
              <button title="Hide/show selected drawing" disabled={selectedDrawingId === null} onClick={() => { if (selectedDrawingId !== null) setDrawings(prev => prev.map(item => item.id === selectedDrawingId ? { ...item, visible: !item.visible } : item)); }}>◉</button>
              <button title="Lock/unlock selected drawing" disabled={selectedDrawingId === null} onClick={() => { if (selectedDrawingId !== null) setDrawings(prev => prev.map(item => item.id === selectedDrawingId ? { ...item, locked: !item.locked } : item)); }}>⌑</button>
              <button title="Open GPT research laboratory" className={researchLabOpen ? 'tool-active' : ''} onClick={() => setResearchLabOpen(true)}><Beaker size={15} /></button>
              <button title="Fullscreen" onClick={() => chartRef.current?.requestFullscreen?.()}><Maximize2 size={15} /></button>
            </div>
          </div>

          {(indicatorMenuOpen || drawingMenuOpen) && (
            <div className="analysis-menu-overlay" onClick={() => { setIndicatorMenuOpen(false); setDrawingMenuOpen(false); }}>
              <div className="analysis-menu" onClick={event => event.stopPropagation()}>
                <div className="analysis-menu-head"><div><b>{indicatorMenuOpen ? 'TECHNICAL INDICATORS' : 'DRAWING TOOLS'}</b><span>{indicatorMenuOpen ? `${activeIndicators.length} selected · research catalogue` : selectedDrawingTool || 'Choose a chart tool'}</span></div><button onClick={() => { setIndicatorMenuOpen(false); setDrawingMenuOpen(false); }}><X size={15} /></button></div>
                <div className="analysis-menu-scroll">
                  {(indicatorMenuOpen ? INDICATOR_CATALOG : DRAWING_CATALOG).map(group => <div className="analysis-group" key={group.category}><div className="analysis-category">{group.category}</div><div className="analysis-items">{group.items.map(item => <button key={item} className={(indicatorMenuOpen && activeIndicators.includes(item)) || selectedDrawingTool === item ? 'tool-active' : ''} onClick={() => { if (indicatorMenuOpen) { setActiveIndicators(prev => prev.includes(item) ? prev.filter(value => value !== item) : [...prev, item]); if (item === 'SMA') setShowSma(value => !value); if (item === 'EMA') setShowEma(value => !value); } else { setSelectedDrawingTool(item); setDrawingMode(['Horizontal Line', 'Horizontal Ray', 'Vertical Line', 'Text', 'Note', 'Callout', 'Price Label', 'Arrow Mark Up', 'Flag Mark', 'Pin', 'Emoji', 'Cycle Lines', 'Time Cycles'].includes(item) ? 'horizontal' : 'trend'); drawingStartRef.current = null; setDrawingMenuOpen(false); setShowCrosshair(true); } }}>{item}</button>)}</div></div>)}
                </div>
              </div>
            </div>
          )}

          <div className="chart-subbar">
            <div><b>{selected?.name || 'No instrument'}</b><span>{selected?.symbol || '—'}</span><i className={latestDelta >= 0 ? 'up' : 'down'}>{latest ? formatQuote(latest.quote) : '—'}</i></div>
            <div className="ohlc"><span>O <b>{visibleBars[0] ? formatQuote(visibleBars[0].open) : '—'}</b></span><span>H <b>{visibleBars.length ? formatQuote(Math.max(...visibleBars.map(b => b.high))) : '—'}</b></span><span>L <b>{visibleBars.length ? formatQuote(Math.min(...visibleBars.map(b => b.low))) : '—'}</b></span><span>C <b>{visibleBars.length ? formatQuote(visibleBars[visibleBars.length - 1].close) : '—'}</b></span></div>
            <div className="source-badge"><span className="live-dot" /> DERIV LIVE</div>
          </div>

          {lastError && <div className="terminal-error">{lastError}</div>}

          <div className="research-controls">
            <div className="date-control"><Calendar size={13} /><input id="sire-date-jump" type="datetime-local" value={dateInput} onChange={event => setDateInput(event.target.value)} /><button onClick={jumpToDateTime}>JUMP</button></div>
            <div className="comparison-control"><GitCompareArrows size={13} /><select value={comparisonSymbol} onChange={event => { setComparisonSymbol(event.target.value); void loadComparison(event.target.value); }}><option value="">Compare instrument…</option>{instruments.filter(item => item.symbol !== selected?.symbol).map(item => <option key={item.symbol} value={item.symbol}>{item.name} · {item.symbol}</option>)}</select>{showComparison && comparisonSymbol && <span>vs {comparisonSymbol}</span>}</div>
            <div className="drawing-status">{drawingMode === 'horizontal' ? `Aim with crosshair and tap to place ${selectedDrawingTool || 'horizontal level'}` : drawingMode === 'trend' ? `Aim with crosshair and tap two points to draw ${selectedDrawingTool || 'trend line'}` : activeIndicators.length ? `${activeIndicators.length} indicators active` : jumpMessage || 'Crosshair inspection active'}</div>
            <button className="lab-launch" onClick={() => setResearchLabOpen(true)}><Beaker size={12} /> OPEN GPT RESEARCH LAB</button>
            <div className="inspection-readout">{selectedInspection ? `${formatQuote(selectedInspection.price)} · ${new Date(selectedInspection.epoch * 1000).toLocaleString()}` : 'Move crosshair for exact price/time'}</div>
          </div>

            <div className={`chart-stage chart-layout-${chartLayout}`} ref={chartRef} onClick={handleChartClick} onPointerDown={handleChartPointerDown} onPointerMove={handleChartPointerMove} onPointerUp={handleChartPointerUp} onPointerCancel={handleChartPointerUp} onPointerLeave={() => { if (drawingMode === 'none' && !dragRef.current && pointersRef.current.size === 0 && !crosshairDragRef.current) setChartPoint(null); }}>

            <div className="chart-grid-lines"><span /><span /><span /><span /><span /></div>
            {visibleBars.length && chartGeometry ? (
              <svg className="market-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                {chartMode === 'line' && <path d={chartPath} className="line-path" vectorEffect="non-scaling-stroke" />}
                {showComparison && comparisonPath && <path d={comparisonPath} className="comparison-path" vectorEffect="non-scaling-stroke" />}
                {smaPath && <path d={smaPath} className="overlay-path sma-path" vectorEffect="non-scaling-stroke" />}
                {emaPath && <path d={emaPath} className="overlay-path ema-path" vectorEffect="non-scaling-stroke" />}\n                {indicatorEnginePaths.map(item => <path key={item.name} d={item.path} className="indicator-engine-path" vectorEffect="non-scaling-stroke" />)}
                {drawings.map(drawing => renderDrawing({ drawing, visibleBars, geometry: chartGeometry, selected: selectedDrawingId === drawing.id, formatQuote }))}
                {markers.map(marker => {
                  const index = visibleBars.findIndex(bar => bar.epoch === marker.epoch);
                  if (index < 0) return null;
                  const x = visibleBars.length === 1 ? 50 : (index / Math.max(1, visibleBars.length - 1)) * 100;
                  const y = 100 - ((marker.price - chartGeometry.min) / (chartGeometry.max - chartGeometry.min)) * 100;
                  return <g key={marker.id}><line x1={x} x2={x} y1={0} y2={100} className="marker-line" vectorEffect="non-scaling-stroke" /><circle cx={x} cy={y} r="1.7" className="marker-dot" /></g>;
                })}
                {chartMode === 'ticks' && visibleBars.map((bar, index) => {
                  const x = visibleBars.length === 1 ? 50 : (index / (visibleBars.length - 1)) * 100;
                  const y = 100 - ((bar.close - chartGeometry.min) / (chartGeometry.max - chartGeometry.min)) * 100;
                  return <circle key={`${bar.epoch}-${index}`} cx={x} cy={y} r="0.55" className="tick-dot" />;
                })}
                {chartMode === 'candles' && visibleBars.map((bar, index) => {
                  const plotWidth = 94;
                  const slot = plotWidth / Math.max(1, visibleBars.length);
                  const bodyWidth = Math.max(0.28, Math.min(0.72, slot * 0.58));
                  const x = visibleBars.length === 1 ? plotWidth - slot / 2 : slot * index + slot / 2;
                  const yHigh = 100 - ((bar.high - chartGeometry.min) / (chartGeometry.max - chartGeometry.min)) * 100;
                  const yLow = 100 - ((bar.low - chartGeometry.min) / (chartGeometry.max - chartGeometry.min)) * 100;
                  const yOpen = 100 - ((bar.open - chartGeometry.min) / (chartGeometry.max - chartGeometry.min)) * 100;
                  const yClose = 100 - ((bar.close - chartGeometry.min) / (chartGeometry.max - chartGeometry.min)) * 100;
                  const top = Math.min(yOpen, yClose);
                  const height = Math.max(0.18, Math.abs(yClose - yOpen));
                  const rising = bar.close >= bar.open;
                  const openTick = Math.max(0.22, bodyWidth * 0.38);
                  return <g key={`${bar.epoch}-${index}`} className={rising ? 'candle-up' : 'candle-down'}>
                    <line className="candle-wick" x1={x} x2={x} y1={yHigh} y2={yLow} />
                    <line className="candle-open" x1={x - bodyWidth / 2 - openTick} x2={x - bodyWidth / 2} y1={yOpen} y2={yOpen} />
                    <rect className="candle-body" x={x - bodyWidth / 2} y={top} width={bodyWidth} height={height} rx="0.04" />
                    <line className="candle-close" x1={x + bodyWidth / 2} x2={x + bodyWidth / 2 + openTick} y1={yClose} y2={yClose} />
                  </g>;
                })}
                {chartMode === 'candles' && latest && chartGeometry && (() => {
                  const bid = Number.isFinite(latest.bid) ? latest.bid as number : latest.quote;
                  const ask = Number.isFinite(latest.ask) ? latest.ask as number : latest.quote;
                  const bidY = 100 - ((bid - chartGeometry.min) / (chartGeometry.max - chartGeometry.min)) * 100;
                  const askY = 100 - ((ask - chartGeometry.min) / (chartGeometry.max - chartGeometry.min)) * 100;
                  return <g className="live-prices">
                    <line className="current-price-line bid-line" x1="94" x2="100" y1={bidY} y2={bidY} />
                    <line className="current-price-line ask-line" x1="94" x2="100" y1={askY} y2={askY} />
                  </g>;
                })()}
              </svg>
            ) : <div className="chart-empty">Waiting for genuine Deriv ticks…</div>}
            {showCrosshair && chartPoint && <div className="crosshair-layer" aria-hidden="true">
              <div className="crosshair-v" style={{ left: chartPoint.x }} />
              <div className="crosshair-h" style={{ top: chartPoint.y }} />
              <div className="crosshair-center" style={{ left: chartPoint.x, top: chartPoint.y }} />
            </div>}
            {showCrosshair && chartPoint && chartGeometry && chartRef.current && (() => {
              const rect = chartRef.current.getBoundingClientRect();
              const plot = { left: 8, top: 12, width: Math.max(1, rect.width - 64), height: Math.max(1, rect.height - 38) };
              const plotX = Math.max(0, Math.min(plot.width, chartPoint.x - plot.left));
              const plotY = Math.max(0, Math.min(plot.height, chartPoint.y - plot.top));
              const price = chartGeometry.max - (plotY / plot.height) * (chartGeometry.max - chartGeometry.min);
              const fractionalIndex = Math.max(0, Math.min(Math.max(0, visibleBars.length - 1), (plotX / plot.width) * Math.max(0, visibleBars.length - 1)));
              const index = Math.max(0, Math.min(visibleBars.length - 1, Math.round(fractionalIndex)));
              const point = visibleBars[index];
              const centerX = 47;
              const centerY = Math.max(5, Math.min(95, (plotY / plot.height) * 100));
              // Use a wider local context so the precision chart reads like a small
              // TradingView-style inspection window instead of an over-zoomed loupe.
              const previewCenter = Math.max(0, Math.min(visibleBars.length - 1, fractionalIndex));
              const previewStart = Math.max(0, Math.floor(previewCenter) - 10);
              const previewEnd = Math.min(visibleBars.length, previewStart + 21);
              const localBars = visibleBars.slice(previewStart, previewEnd);
              const localMin = Math.min(...localBars.map(bar => bar.low), point?.low ?? chartGeometry.min);
              const localMax = Math.max(...localBars.map(bar => bar.high), point?.high ?? chartGeometry.max);
              const localRange = Math.max(localMax - localMin, Number.EPSILON);
              const slot = 94 / Math.max(1, localBars.length);
              const bodyWidth = Math.max(2.2, Math.min(8, slot * 0.58));
              const previewBars = localBars.map((bar, barIndex) => {
                const x = localBars.length === 1 ? 47 : 3 + (barIndex / Math.max(1, localBars.length - 1)) * 88;
                const yHigh = 94 - ((bar.high - localMin) / localRange) * 88;
                const yLow = 94 - ((bar.low - localMin) / localRange) * 88;
                const yOpen = 94 - ((bar.open - localMin) / localRange) * 88;
                const yClose = 94 - ((bar.close - localMin) / localRange) * 88;
                const top = Math.min(yOpen, yClose);
                const height = Math.max(1.2, Math.abs(yClose - yOpen));
                return <g key={`loupe-${bar.epoch}-${barIndex}`} className={bar.close >= bar.open ? 'candle-up' : 'candle-down'}><line className="candle-wick" x1={x} x2={x} y1={yHigh} y2={yLow} /><rect className="candle-body" x={x - bodyWidth / 2} y={top} width={bodyWidth} height={height} rx="0.2" /></g>;
              });
              // Preserve the fractional crosshair coordinate. Do not round it to the
              // nearest candle: the dot must represent the exact point under the
              // main-chart crosshair, both horizontally and vertically.
              const localFractionalIndex = Math.max(0, Math.min(Math.max(0, localBars.length - 1), fractionalIndex - previewStart));
              const localPositionRatio = localBars.length <= 1 ? 0.5 : localFractionalIndex / Math.max(1, localBars.length - 1);
              const selectedX = localBars.length === 1 ? 47 : 3 + localPositionRatio * 88;
              const selectedPriceRatio = Math.max(0, Math.min(1, (price - localMin) / localRange));
              const selectedY = 94 - selectedPriceRatio * 88;
              const start = drawingStartRef.current;
              const startIndex = start ? visibleBars.findIndex(bar => bar.epoch === start.epoch) : -1;
              const startX = startIndex >= 0 ? plot.left + (startIndex / Math.max(1, visibleBars.length - 1)) * plot.width : 0;
              const startY = start ? plot.top + ((chartGeometry.max - start.price) / (chartGeometry.max - chartGeometry.min)) * plot.height : 0;
              return <>
                <div className="placement-loupe" aria-hidden="true">
                  <span className="placement-loupe-title">PRECISION VIEW</span>
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                    <rect x="0" y="0" width="100" height="100" className="loupe-bg" />
                    <g className="loupe-grid"><line x1="0" x2="100" y1="25" y2="25" /><line x1="0" x2="100" y1="50" y2="50" /><line x1="0" x2="100" y1="75" y2="75" /></g>
                    {previewBars}
                    <line x1={selectedX} x2={selectedX} y1="0" y2="100" className="loupe-crosshair" />
                    <line x1="0" x2="100" y1={selectedY} y2={selectedY} className="loupe-crosshair" />
                    <circle cx={selectedX} cy={selectedY} r="2.8" className="loupe-point" />
                  </svg>
                </div>
                <div className="placement-details"><b>{formatQuote(price)}</b><span>{point ? new Date(point.epoch * 1000).toLocaleString() : '—'}</span><span>{point ? `O ${formatQuote(point.open)} · H ${formatQuote(point.high)} · L ${formatQuote(point.low)} · C ${formatQuote(point.close)}` : ''}</span></div>
                {drawingMode !== 'none' && drawingStartRef.current && <div className="drawing-placement-points" aria-hidden="true">
                  {start && <span className="placement-dot" style={{ left: startX, top: startY }} />}
                </div>}
              </>;
            })()}
            <div className="price-axis">
              {chartGeometry && Array.from({ length: 6 }, (_, index) => <span key={index}>{formatQuote(chartGeometry.max - ((chartGeometry.max - chartGeometry.min) * index) / 5)}</span>)}
            </div>
            <div className="time-axis">{visibleBars.filter((_, index) => index % Math.max(1, Math.floor(visibleBars.length / 6)) === 0).map(bar => <span key={bar.epoch}>{new Date(bar.epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: timeframe === 'tick' || timeframe === '1s' ? '2-digit' : undefined })}</span>)}</div>
            {latest && <div className="last-price" style={{ top: chartGeometry ? `${Math.max(2, Math.min(98, 100 - ((latest.quote - chartGeometry.min) / (chartGeometry.max - chartGeometry.min)) * 100))}%` : '50%' }}>{formatQuote(latest.quote)}</div>}
          </div>

          {indicatorPanePaths.length > 0 && (
            <div className="indicator-pane-stack" aria-label="Indicator panes">
              {indicatorPanePaths.map(pane => (
                <section className="indicator-pane" key={pane.name}>
                  <div className="indicator-pane-head">
                    <button className="indicator-pane-title" onClick={() => setSelectedIndicatorName(pane.name)} aria-label={`Edit ${pane.name}`}>
                      <b>{pane.name}</b><span>{indicatorSettings[pane.name]?.period ?? 14}</span><ChevronDown size={11} />
                    </button>
                    <span className="indicator-pane-type">INDICATOR</span>
                  </div>
                  <div className="indicator-pane-grid" aria-hidden="true"><i /><i /><i /><i /></div>
                  <div className="indicator-pane-left-scale"><span>100</span><span>50</span><span>0</span></div>
                  <svg className="indicator-pane-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${pane.name} pane`}>
                    {pane.zeroLine && <line x1="0" x2="100" y1="51" y2="51" className="indicator-zero" vectorEffect="non-scaling-stroke" />}
                    <path d={pane.path} className="indicator-pane-path" vectorEffect="non-scaling-stroke" />
                  </svg>
                  <div className="indicator-pane-scale"><span>100</span><span>50</span><span>0</span></div>
                </section>
              ))}
            </div>
          )}

          {selectedIndicatorName && (
            <div className="object-edit-overlay" onClick={() => setSelectedIndicatorName(null)}>
              <div className="object-edit-menu" onClick={event => event.stopPropagation()}>
                <div className="object-edit-head"><div><b>{selectedIndicatorName}</b><span>INDICATOR SETTINGS</span></div><button onClick={() => setSelectedIndicatorName(null)}><X size={15} /></button></div>
                <div className="object-edit-section"><span>PERIOD</span><div className="edit-chip-row">{[5, 9, 14, 20, 50].map(period => <button key={period} className={(indicatorSettings[selectedIndicatorName]?.period ?? 14) === period ? 'selected' : ''} onClick={() => setIndicatorSettings(prev => ({ ...prev, [selectedIndicatorName]: { period } }))}>{period}</button>)}</div></div>
                <button className="edit-action" onClick={() => { setActiveIndicators(prev => prev.filter(item => item !== selectedIndicatorName)); setSelectedIndicatorName(null); }}>Remove indicator</button>
              </div>
            </div>
          )}

          {selectedDrawingId !== null && drawingEditOpen && (() => {
            const drawing = drawings.find(item => item.id === selectedDrawingId);
            if (!drawing) return null;
            return <div className="object-edit-overlay" onClick={() => setDrawingEditOpen(false)}>
              <div className="object-edit-menu" onClick={event => event.stopPropagation()}>
                <div className="object-edit-head"><div><b>{drawing.tool}</b><span>DRAWING SETTINGS</span></div><button onClick={() => setDrawingEditOpen(false)}><X size={15} /></button></div>
                <div className="object-edit-section"><span>COLOR</span><div className="edit-color-row">{(['blue', 'green', 'red', 'orange', 'purple', 'white'] as const).map(color => <button key={color} aria-label={color} className={`edit-color ${color} ${drawing.color === color ? 'selected' : ''}`} onClick={() => updateDrawing(drawing.id, { color })} />)}</div></div>
                <div className="object-edit-section"><span>LINE WIDTH</span><div className="edit-chip-row">{([1, 2, 3] as const).map(width => <button key={width} className={(drawing.width ?? 1) === width ? 'selected' : ''} onClick={() => updateDrawing(drawing.id, { width })}>{width}px</button>)}</div></div>
                {drawing.p2 !== undefined && drawing.e2 !== undefined && <div className="edit-action-row"><button onClick={straightenSelectedDrawing}>Straighten · 0°</button><button onClick={verticalizeSelectedDrawing}>Vertical · 90°</button><button onClick={flipSelectedDrawing}>Flip direction</button></div>}
                <div className="edit-action-row"><button onClick={() => updateDrawing(drawing.id, { visible: !drawing.visible })}>{drawing.visible ? 'Hide' : 'Show'}</button><button onClick={() => updateDrawing(drawing.id, { locked: !drawing.locked })}>{drawing.locked ? 'Unlock' : 'Lock'}</button><button className="danger" onClick={() => { setDrawings(prev => prev.filter(item => item.id !== drawing.id)); setSelectedDrawingId(null); setDrawingEditOpen(false); }}>Delete</button></div>
              </div>
            </div>;
          })()}

          {chartLayout > 1 && <div className="multi-chart-note"><span><b>{chartLayout}</b> synchronized chart panes</span><span>Same genuine Deriv history · independent visual panes</span><span>Use the comparison control to add a second instrument</span></div>}

          <div className="chart-statusbar"><span><b>{history.length.toLocaleString()}</b> ticks loaded</span><span><b>{coverage?.storedTicks?.toLocaleString() || '0'}</b> persistent</span><span>{historicalLoaded ? `History: ${range}` : 'Loading historical Deriv ticks…'}</span><span className="status-right"><span className="live-dot" /> Live ticks {liveTicks.toLocaleString()}</span></div>

          <nav className="mobile-chart-nav" aria-label="Mobile chart tools">
            <button type="button" className="mobile-nav-main" onClick={() => setInstrumentMenuOpen(true)}><Search size={17} /><span>Symbol</span></button>
            <button type="button" className={showCrosshair ? 'mobile-nav-main active' : 'mobile-nav-main'} onClick={() => setShowCrosshair(value => !value)}><Crosshair size={17} /><span>Crosshair</span></button>
            <button type="button" className={drawingMenuOpen ? 'mobile-nav-main active' : 'mobile-nav-main'} onClick={() => { setDrawingMenuOpen(value => !value); setIndicatorMenuOpen(false); setShowCrosshair(false); setDrawingMode('none'); drawingStartRef.current = null; }}><Pencil size={17} /><span>Draw</span></button>
            <button type="button" className={indicatorMenuOpen ? 'mobile-nav-main active' : 'mobile-nav-main'} onClick={() => { setIndicatorMenuOpen(value => !value); setDrawingMenuOpen(false); }}><Activity size={17} /><span>Indicators</span></button>
            <button type="button" className="mobile-nav-main" onClick={() => document.getElementById('sire-mobile-tools')?.classList.toggle('open')}><Layers size={17} /><span>Tools</span></button>
          </nav>

          <div id="sire-mobile-tools" className="mobile-tools-sheet">
            <div className="mobile-tools-grid">
              <button type="button" onClick={() => document.getElementById('sire-date-jump')?.focus()}><Calendar size={16} /><span>Jump time</span></button>
              <button type="button" onClick={() => setShowComparison(value => !value)} className={showComparison ? 'selected' : ''}><GitCompareArrows size={16} /><span>Compare</span></button>
              <button type="button" onClick={() => setShowEma(value => !value)} className={showEma ? 'selected' : ''}><Activity size={16} /><span>EMA 20</span></button>
              <button type="button" onClick={() => setAutoScale(value => !value)} className={autoScale ? 'selected' : ''}><span className="scale-letter">A</span><span>Auto scale</span></button>
              <button type="button" onClick={() => stepHistory(-1)}><Clock3 size={16} /><span>Back</span></button>
              <button type="button" onClick={() => stepHistory(1)}><Clock3 size={16} /><span>Forward</span></button>
              <button type="button" onClick={() => setZoom(value => Math.min(2.8, Number((value + 0.25).toFixed(2))))}><span className="scale-letter">+</span><span>Zoom in</span></button>
              <button type="button" onClick={() => setZoom(value => Math.max(0.55, Number((value - 0.25).toFixed(2))))}><span className="scale-letter">−</span><span>Zoom out</span></button>
              <button type="button" onClick={() => { setChartMode('candles'); setZoom(1); setChartOffset(0); }}><CandlestickChart size={16} /><span>Candles</span></button>
              <button type="button" onClick={() => { setChartMode('line'); setZoom(1); }}><LineChart size={16} /><span>Line</span></button>
              <button type="button" onClick={addMarker}><Flag size={16} /><span>Marker</span></button>
              <button type="button" onClick={() => chartRef.current?.requestFullscreen?.()}><Maximize2 size={16} /><span>Fullscreen</span></button>
            </div>
            <div className="mobile-time-strip"><span>Interval</span>{TIMEFRAME_LIST.map(frame => <button type="button" key={frame} className={timeframe === frame ? 'selected' : ''} onClick={() => { setTimeframe(frame); setChartOffset(0); }}>{frame}</button>)}</div>
          </div>
        </section>
      </div>
    </main>
    {researchLabOpen && selected && <ResearchLab
      runtimeContext={{ symbol: selected?.symbol || '', name: selected?.name, timeframe, chartMode, latestPrice: latest?.quote ?? null, activeIndicators, drawings, chartBars: chartBars.length, visibleBars: visibleBars.length, selectedInspection }}
      symbol={selected.symbol}
      instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))}
      onClose={() => setResearchLabOpen(false)}
      onSelectInstrument={(symbol) => {
        const target = instruments.find(item => item.symbol === symbol);
        if (target) setSelected(target);
      }}
      onSetChartView={(settings) => {
        if (settings.chartMode === 'candles' || settings.chartMode === 'line' || settings.chartMode === 'ticks') setChartMode(settings.chartMode);
        if (typeof settings.timeframe === 'string' && TIMEFRAME_LIST.includes(settings.timeframe as Timeframe)) { setTimeframe(settings.timeframe as Timeframe); setChartOffset(0); }
        if (typeof settings.zoom === 'number' && Number.isFinite(settings.zoom)) setZoom(Math.min(4, Math.max(0.55, settings.zoom)));
        if (typeof settings.autoScale === 'boolean') setAutoScale(settings.autoScale);
        if (typeof settings.showCrosshair === 'boolean') setShowCrosshair(settings.showCrosshair);
      }}
      onAddMarker={(label) => {
        if (selectedInspection) addMarker(label);
      }}
    />}
    </>
  );
}

export default App;
