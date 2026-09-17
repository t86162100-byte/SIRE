import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import { Calendar, ChevronDown, Maximize2, Search, RotateCcw, Beaker } from 'lucide-react';
import ResearchLab from './ResearchLab';
import NativeMarketChart from './NativeMarketChart';
import { TRADING_VIEW_RESOLUTIONS, resolutionInfo, resolutionLabel, type TradingViewResolution } from './chart/tradingViewResolutions';
import './nativeTerminal.css';

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
type Candle = { epoch: number; open: number; high: number; low: number; close: number };

const CURRENT_DERIV_WS = 'wss://api.derivws.com/trading/v1/options/ws/public';
const LEGACY_DERIV_WS = 'wss://ws.binaryws.com/websockets/v3';
const INGEST_CHUNK = 500;
const HISTORY_CHUNK = 5000;

function textOf(item: Record<string, unknown>, keys: string[]) {
  return keys.map(key => item[key]).filter(value => value !== undefined && value !== null).map(String).join(' ').toLowerCase();
}

function isSynthetic(item: Record<string, unknown>) {
  const market = String(item.market || '').toLowerCase();
  const submarket = String(item.submarket || '').toLowerCase();
  const subgroup = String(item.subgroup || '').toLowerCase();
  const symbol = String(item.underlying_symbol || item.symbol || '');
  const text = textOf(item, ['underlying_symbol', 'underlying_symbol_name', 'underlying_symbol_type', 'symbol', 'display_name', 'market', 'submarket', 'subgroup']);
  return market === 'synthetic_index' || market === 'synthetic indices' || submarket.includes('random_index') || submarket.includes('synthetic') || subgroup.includes('synthetic') || /synthetic index|volatility|boom|crash|jump|step|drift|range break|daily reset|bear market|bull market|random index/.test(text) || /^(R_|1HZ|BOOM|CRASH|STEP|JUMP|DRIFT|RANGE_BREAK|BULL|BEAR)/i.test(symbol);
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

function bucketEpoch(epoch: number, resolution: TradingViewResolution) {
  if (resolution === '1W') {
    const date = new Date(epoch * 1000);
    const day = date.getUTCDay();
    const daysFromMonday = (day + 6) % 7;
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysFromMonday) / 1000);
  }
  if (resolution === '1M') {
    const date = new Date(epoch * 1000);
    return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000);
  }
  const seconds = resolutionInfo(resolution).seconds;
  if (seconds <= 0) return Math.floor(epoch);
  return Math.floor(epoch / seconds) * seconds;
}

function formatQuote(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function openDeriv(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = window.setTimeout(() => { socket.close(); reject(new Error('Deriv connection timed out')); }, 10000);
    socket.onopen = () => { window.clearTimeout(timer); resolve(socket); };
    socket.onerror = () => { window.clearTimeout(timer); reject(new Error(`Unable to connect to ${url.includes('binaryws') ? 'legacy' : 'current'} Deriv market-data endpoint`)); };
  });
}

function requestOnce(ws: WebSocket, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const reqId = Math.floor(Math.random() * 900000000) + 100000000;
    const timer = window.setTimeout(() => { ws.removeEventListener('message', onMessage); reject(new Error('Deriv request timed out')); }, 12000);
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

async function discoverCatalogue() {
  const endpoints = [[LEGACY_DERIV_WS, 'Deriv public market-data API'], [CURRENT_DERIV_WS, 'Deriv current public API fallback']] as const;
  let lastError = '';
  for (const [endpoint, label] of endpoints) {
    try {
      const ws = await openDeriv(endpoint);
      try {
        const request: Record<string, unknown> = { active_symbols: 'brief' };
        if (endpoint === LEGACY_DERIV_WS) request.product_type = 'basic';
        const data = await requestOnce(ws, request);
        const records = (Array.isArray(data.active_symbols) ? data.active_symbols : []).filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
        const instruments = Array.from(new Map(records.filter(isSynthetic).map(normalize).filter((item): item is Instrument => Boolean(item)).map(item => [item.symbol, item])).values()).sort((a, b) => a.name.localeCompare(b.name));
        if (instruments.length) return { instruments, allInstruments: records, totalMarkets: records.length, endpointLabel: label };
        lastError = `Deriv returned ${records.length} active markets but no Synthetic Indices matched`;
      } finally {
        ws.close();
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError || 'Unable to discover Deriv instruments');
}

async function ingestTicks(symbol: string, ticks: Tick[]) {
  for (let i = 0; i < ticks.length; i += INGEST_CHUNK) {
    await api.post('/api/sire/ingest', { symbol, source: 'Deriv', ticks: ticks.slice(i, i + INGEST_CHUNK) });
  }
}

function aggregateTicks(ticks: Tick[], resolution: TradingViewResolution): Candle[] {
  const map = new Map<number, Candle>();
  for (const tick of ticks.slice().sort((a, b) => a.epoch - b.epoch)) {
    const epoch = bucketEpoch(tick.epoch, resolution);
    const current = map.get(epoch);
    if (!current) map.set(epoch, { epoch, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote });
    else map.set(epoch, { epoch, open: current.open, high: Math.max(current.high, tick.quote), low: Math.min(current.low, tick.quote), close: tick.quote });
  }
  return Array.from(map.values()).sort((a, b) => a.epoch - b.epoch).slice(-1500);
}

export default function App() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Connecting to Deriv…');
  const [lastError, setLastError] = useState('');
  const [latest, setLatest] = useState<Tick | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [timeframe, setTimeframe] = useState<TradingViewResolution>('1');
  const [instrumentMenuOpen, setInstrumentMenuOpen] = useState(false);
  const [researchLabOpen, setResearchLabOpen] = useState(false);
  const [dateInput, setDateInput] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [connectionNonce, setConnectionNonce] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const liveBuffer = useRef<Tick[]>([]);
  const seen = useRef(new Set<string>());
  const timeframeRef = useRef(timeframe);

  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  const loadCatalog = useCallback(async () => {
    setStatus('Discovering Deriv Synthetic Indices…');
    setLastError('');
    const result = await discoverCatalogue();
    setInstruments(result.instruments);
    try {
      await api.post('/api/sire/catalogue/sync', { instruments: result.allInstruments });
    } catch {
      // Non-blocking catalogue sync.
    }
    setSelected(current => current && result.instruments.some(item => item.symbol === current.symbol) ? current : result.instruments[0] || null);
    setStatus(`Deriv online · ${result.instruments.length} Synthetic Indices`);
  }, []);

  useEffect(() => {
    void loadCatalog().catch(error => {
      setStatus('Deriv connection failed');
      setLastError(error instanceof Error ? error.message : String(error));
    });
  }, [loadCatalog, connectionNonce]);

  const loadChartHistory = useCallback(async (symbol: string, resolution: TradingViewResolution) => {
    setLoadingHistory(true);
    setLastError('');
    let ws: WebSocket | null = null;
    try {
      ws = await openDeriv(CURRENT_DERIV_WS).catch(() => openDeriv(LEGACY_DERIV_WS));
      const seconds = resolutionInfo(resolution).seconds;
      if (resolution === '1T' || seconds < 60) {
        const data = await requestOnce(ws, { ticks_history: symbol, end: 'latest', count: HISTORY_CHUNK, style: 'ticks', adjust_start_time: 1 });
        const historyNode = data.history && typeof data.history === 'object' ? data.history as Record<string, unknown> : {};
        const prices = Array.isArray(historyNode.prices) ? historyNode.prices : [];
        const times = Array.isArray(historyNode.times) ? historyNode.times : [];
        const ticks: Tick[] = prices
          .map((price, index) => ({ symbol, quote: Number(price), epoch: Number(times[index]), source: 'Deriv' as const }))
          .filter(tick => Number.isFinite(tick.quote) && Number.isFinite(tick.epoch));
        setCandles(aggregateTicks(ticks, resolution));
      } else {
        const direct = resolution !== '1W' && resolution !== '1M';
        const data = await requestOnce(ws, {
          ticks_history: symbol,
          end: 'latest',
          count: direct ? 1000 : 1500,
          style: 'candles',
          granularity: direct ? seconds : 86400,
          adjust_start_time: 1,
        });
        const raw = Array.isArray(data.candles) ? data.candles as Array<Record<string, unknown>> : [];
        const candlesFromDeriv = raw
          .map(candle => ({ epoch: Number(candle.epoch), open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close) }))
          .filter(candle => Object.values(candle).every(Number.isFinite))
          .sort((a, b) => a.epoch - b.epoch);
        if (!candlesFromDeriv.length) throw new Error(`Deriv returned no candles for ${symbol} at ${resolutionLabel(resolution)}`);

        if (resolution === '1W' || resolution === '1M') {
          const map = new Map<number, Candle>();
          for (const candle of candlesFromDeriv) {
            const epoch = bucketEpoch(candle.epoch, resolution);
            const current = map.get(epoch);
            if (!current) map.set(epoch, { epoch, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
            else map.set(epoch, { epoch, open: current.open, high: Math.max(current.high, candle.high), low: Math.min(current.low, candle.low), close: candle.close });
          }
          setCandles(Array.from(map.values()).sort((a, b) => a.epoch - b.epoch).slice(-500));
        } else {
          setCandles(candlesFromDeriv.slice(-1000));
        }
      }
    } catch (error) {
      setCandles([]);
      setLastError(error instanceof Error ? error.message : `Unable to load ${resolutionLabel(resolution)} history`);
    } finally {
      ws?.close();
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLatest(null);
    setCandles([]);
    liveBuffer.current = [];
    seen.current = new Set();
    void loadChartHistory(selected.symbol, timeframe);
  }, [selected, timeframe, loadChartHistory]);

  const updateLiveCandle = useCallback((tick: Tick) => {
    const resolution = timeframeRef.current;
    const epoch = bucketEpoch(tick.epoch, resolution);
    setCandles(prev => {
      const index = prev.findIndex(candle => candle.epoch === epoch);
      if (index >= 0) {
        const next = prev.slice();
        const current = next[index];
        next[index] = { ...current, high: Math.max(current.high, tick.quote), low: Math.min(current.low, tick.quote), close: tick.quote };
        return next;
      }
      return [...prev, { epoch, open: tick.quote, high: tick.quote, low: tick.quote, close: tick.quote }]
        .sort((a, b) => a.epoch - b.epoch)
        .slice(-1500);
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    let disposed = false;
    let reconnectTimer = 0;

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
            const raw = data.tick as Record<string, unknown>;
            const tick: Tick = {
              symbol: String(raw.symbol || raw.underlying_symbol || selected.symbol),
              quote: Number(raw.quote),
              bid: Number.isFinite(Number(raw.bid)) ? Number(raw.bid) : undefined,
              ask: Number.isFinite(Number(raw.ask)) ? Number(raw.ask) : undefined,
              epoch: Number(raw.epoch),
              id: raw.id ? String(raw.id) : undefined,
              source: 'Deriv',
            };
            if (!Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) return;
            const key = `${tick.symbol}:${tick.epoch}:${tick.quote}`;
            if (seen.current.has(key)) return;
            seen.current.add(key);
            liveBuffer.current.push(tick);
            setLatest(tick);
            updateLiveCandle(tick);
            if (liveBuffer.current.length >= INGEST_CHUNK) {
              const batch = liveBuffer.current.splice(0, INGEST_CHUNK);
              void ingestTicks(selected.symbol, batch).catch(() => undefined);
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
  }, [selected, updateLiveCandle]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? instruments.filter(item => `${item.name} ${item.symbol}`.toLowerCase().includes(q)) : instruments;
  }, [instruments, search]);

  const currentCandle = candles[candles.length - 1];
  const latestDelta = latest && candles.length > 1 ? latest.quote - candles[candles.length - 2].close : 0;

  const jumpToDateTime = () => {
    if (!dateInput || !candles.length) return;
    const target = new Date(dateInput).getTime() / 1000;
    if (!Number.isFinite(target)) return;
    const nearest = candles.reduce((best, candle, index) => Math.abs(candle.epoch - target) < Math.abs(candles[best].epoch - target) ? index : best, 0);
    setStatus(`Jump target · ${new Date(candles[nearest].epoch * 1000).toLocaleString()}`);
  };

  return (
    <main className="native-terminal-shell">
      <header className="native-terminal-topbar">
        <div className="brand-block"><div className="brand-mark">S</div><div><b>SIRE</b><span>MARKET RESEARCH TERMINAL</span></div></div>
        <button className="native-instrument-picker" onClick={() => setInstrumentMenuOpen(value => !value)}>
          <span><strong>{selected?.name || 'Select instrument'}</strong><small>{selected?.symbol || 'Synthetic Index'} · Deriv</small></span>
          <ChevronDown size={16} />
        </button>
        <div className="native-live-state"><span className="live-dot" />{status.startsWith('Live') ? 'LIVE' : status}</div>
      </header>

      {instrumentMenuOpen && <div className="native-instrument-overlay" onClick={() => setInstrumentMenuOpen(false)}><div className="native-instrument-sheet" onClick={event => event.stopPropagation()}>
        <div className="sheet-head"><div><span>CHANGE INSTRUMENT</span><b>{instruments.length} Synthetic Indices</b></div><button onClick={() => setInstrumentMenuOpen(false)}>Done</button></div>
        <div className="sheet-search"><Search size={15} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search instrument or symbol" /></div>
        <div className="sheet-list">
          {filtered.map(item => <button key={item.symbol} className={`sheet-row ${selected?.symbol === item.symbol ? 'active' : ''}`} onClick={() => { setSelected(item); setInstrumentMenuOpen(false); }}><span><b>{item.name}</b><small>{item.symbol}</small></span><em>{selected?.symbol === item.symbol ? 'SELECTED' : item.exchangeOpen === 0 ? 'OFF' : 'LIVE'}</em></button>)}
          {!filtered.length && <div className="empty-state">No instruments found.</div>}
        </div>
      </div></div>}

      <div className="native-terminal-body"><aside className="native-symbol-sidebar">
        <div className="sidebar-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" /></div>
        <div className="sidebar-meta"><span>DERIV SYNTHETIC</span><b>{instruments.length}</b></div>
        <div className="native-symbol-list">{filtered.slice(0, 100).map(item => <button key={item.symbol} className={selected?.symbol === item.symbol ? 'active' : ''} onClick={() => setSelected(item)}><span><b>{item.name}</b><small>{item.symbol}</small></span><i>{item.exchangeOpen === 0 ? 'OFF' : 'LIVE'}</i></button>)}</div>
      </aside>

        <section className="native-chart-panel">
          <div className="native-chart-toolbar">
            <div className="native-timeframes">{TRADING_VIEW_RESOLUTIONS.map(option => <button key={option.value} className={timeframe === option.value ? 'active' : ''} onClick={() => setTimeframe(option.value)}>{option.label}</button>)}</div>
            <div className="native-chart-actions"><button title="Reload history" onClick={() => selected && void loadChartHistory(selected.symbol, timeframe)}><RotateCcw size={14} /></button><button title="Fullscreen" onClick={() => document.querySelector('.native-chart-stage')?.requestFullscreen?.()}><Maximize2 size={14} /></button><button title="Open GPT research laboratory" onClick={() => setResearchLabOpen(true)}><Beaker size={14} /></button></div>
          </div>
          <div className="native-chart-subbar"><div><b>{selected?.name || 'No instrument'}</b><span>{selected?.symbol || '—'}</span></div><div className="native-ohlc"><span>O <b>{currentCandle ? formatQuote(currentCandle.open) : '—'}</b></span><span>H <b>{currentCandle ? formatQuote(currentCandle.high) : '—'}</b></span><span>L <b>{currentCandle ? formatQuote(currentCandle.low) : '—'}</b></span><span>C <b>{latest ? formatQuote(latest.quote) : currentCandle ? formatQuote(currentCandle.close) : '—'}</b></span></div><div className={latestDelta >= 0 ? 'up' : 'down'}>{latest ? formatQuote(latest.quote) : '—'}</div></div>
          {lastError && <div className="native-chart-error">{lastError}</div>}
          <div className="native-research-controls"><div className="date-control"><Calendar size={13} /><input type="datetime-local" value={dateInput} onChange={event => setDateInput(event.target.value)} /><button onClick={jumpToDateTime}>JUMP</button></div><span>{loadingHistory ? `Loading ${resolutionLabel(timeframe)} history…` : 'TradingView chart navigation active'}</span><span>Drag the right price scale to vertically stretch the chart.</span></div>
          <div className="native-chart-stage"><NativeMarketChart candles={candles} latest={latest} autoScale timeframe={timeframe} timeframeOptions={TRADING_VIEW_RESOLUTIONS} onTimeframeChange={setTimeframe} /></div>
        </section>
      </div>

      {researchLabOpen && selected && <ResearchLab symbol={selected.symbol} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onClose={() => setResearchLabOpen(false)} onSelectInstrument={symbol => { const next = instruments.find(item => item.symbol === symbol); if (next) setSelected(next); setResearchLabOpen(false); }} runtimeContext={{ symbol: selected.symbol, name: selected.name, timeframe, latestPrice: latest?.quote ?? null, chartMode: 'candles', chartBars: candles.length, visibleBars: candles.length }} />}
      <button className="native-reconnect" onClick={() => setConnectionNonce(value => value + 1)} aria-label="Reconnect to Deriv">Reconnect</button>
    </main>
  );
}
