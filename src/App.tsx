import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Beaker } from 'lucide-react';
import { api } from '@appdeploy/client';
import ResearchLab from './ResearchLab';
import FinancialChart from './FinancialChart';
import './nativeTerminal.css';

type Instrument = { symbol: string; name: string; market: string; submarket: string; subgroup: string; symbolType: string; exchangeOpen?: number };
type Tick = { symbol: string; quote: number; bid?: number; ask?: number; epoch: number; id?: string; source: 'Deriv' };
type DerivResponse = Record<string, unknown>;
type DerivEndpoint = { url: string; label: string; legacy: boolean };

const DERIV_APP_ID = String((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_DERIV_APP_ID || '1089');
const DERIV_ENDPOINTS: DerivEndpoint[] = [
  { url: 'wss://api.derivws.com/trading/v1/options/ws/public', label: 'Deriv public API', legacy: false },
  { url: 'wss://ws.derivws.com/websockets/v3', label: 'Deriv WebSocket v3', legacy: true },
  { url: 'wss://ws.binaryws.com/websockets/v3', label: 'Deriv legacy WebSocket v3', legacy: true },
  { url: `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(DERIV_APP_ID)}`, label: 'Deriv WebSocket v3 (App ID)', legacy: true },
  { url: `wss://ws.binaryws.com/websockets/v3?app_id=${encodeURIComponent(DERIV_APP_ID)}`, label: 'Deriv legacy WebSocket v3 (App ID)', legacy: true },
];
const INGEST_CHUNK = 500;

function textOf(item: Record<string, unknown>, keys: string[]) { return keys.map(key => item[key]).filter(value => value !== undefined && value !== null).map(String).join(' ').toLowerCase(); }
function isSynthetic(item: Record<string, unknown>) { const market = String(item.market || '').toLowerCase(); const submarket = String(item.submarket || '').toLowerCase(); const subgroup = String(item.subgroup || '').toLowerCase(); const symbol = String(item.underlying_symbol || item.symbol || ''); const text = textOf(item, ['underlying_symbol', 'underlying_symbol_name', 'underlying_symbol_type', 'symbol', 'display_name', 'market', 'submarket', 'subgroup']); return market === 'synthetic_index' || market === 'synthetic indices' || submarket.includes('random_index') || submarket.includes('synthetic') || subgroup.includes('synthetic') || /synthetic index|volatility|boom|crash|jump|step|drift|range break|daily reset|bear market|bull market|random index/.test(text) || /^(R_|1HZ|BOOM|CRASH|STEP|JUMP|DRIFT|RANGE_BREAK|BULL|BEAR)/i.test(symbol); }
function normalize(item: Record<string, unknown>): Instrument | null { const symbol = String(item.underlying_symbol || item.symbol || ''); if (!symbol) return null; return { symbol, name: String(item.underlying_symbol_name || item.display_name || symbol), market: String(item.market || ''), submarket: String(item.submarket || ''), subgroup: String(item.subgroup || ''), symbolType: String(item.underlying_symbol_type || item.symbol_type || ''), exchangeOpen: typeof item.exchange_is_open === 'number' ? item.exchange_is_open : undefined }; }

function openDeriv(endpoint: DerivEndpoint): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint.url);
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* ignore */ }
      reject(new Error(`${endpoint.label} connection timed out`));
    }, 10000);
    socket.onopen = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(socket);
    };
    socket.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { socket.close(); } catch { /* ignore */ }
      reject(new Error(`${endpoint.label} WebSocket handshake failed`));
    };
    socket.onclose = event => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new Error(`${endpoint.label} closed before connection (code ${event.code}${event.reason ? `, ${event.reason}` : ''})`));
    };
  });
}

function requestOnce(ws: WebSocket, request: Record<string, unknown>): Promise<DerivResponse> {
  return new Promise((resolve, reject) => {
    const reqId = Math.floor(Math.random() * 900000000) + 100000000;
    const timer = window.setTimeout(() => { ws.removeEventListener('message', onMessage); reject(new Error('Deriv request timed out')); }, 12000);
    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as DerivResponse;
        if (Number(data.req_id) !== reqId) return;
        window.clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        if (data.error) {
          const error = data.error as Record<string, unknown>;
          reject(new Error(String(error.message || 'Deriv API error')));
          return;
        }
        if (Array.isArray(data.errors) && data.errors.length) {
          const first = data.errors[0] as Record<string, unknown>;
          reject(new Error(String(first?.message || 'Deriv API error')));
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
    try { ws.send(JSON.stringify({ ...request, req_id: reqId })); }
    catch (error) { window.clearTimeout(timer); ws.removeEventListener('message', onMessage); reject(error instanceof Error ? error : new Error(String(error))); }
  });
}

async function discoverCatalogue() {
  const errors: string[] = [];
  for (const endpoint of DERIV_ENDPOINTS) {
    let ws: WebSocket | null = null;
    try {
      ws = await openDeriv(endpoint);
      const requests = endpoint.legacy
        ? [{ active_symbols: 'brief' }, { active_symbols: 'brief', product_type: 'basic' }]
        : [{ active_symbols: 'brief' }];
      let data: DerivResponse | null = null;
      let records: Record<string, unknown>[] = [];
      for (const request of requests) {
        data = await requestOnce(ws, request);
        records = (Array.isArray(data.active_symbols) ? data.active_symbols : []).filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
        if (records.length) break;
      }
      const instruments = Array.from(new Map(records.filter(isSynthetic).map(normalize).filter((item): item is Instrument => Boolean(item)).map(item => [item.symbol, item])).values()).sort((a, b) => a.name.localeCompare(b.name));
      if (instruments.length) return { instruments, allInstruments: records, endpoint };
      errors.push(`${endpoint.label}: ${records.length} active markets returned but no Synthetic Indices matched`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      if (ws) ws.close();
    }
  }
  throw new Error(`Unable to connect to Deriv market-data endpoints. ${errors.join(' | ')}`);
}

async function ingestTicks(symbol: string, ticks: Tick[]) { for (let i = 0; i < ticks.length; i += INGEST_CHUNK) await api.post('/api/sire/ingest', { symbol, source: 'Deriv', ticks: ticks.slice(i, i + INGEST_CHUNK) }); }

export default function App() {
  const [instruments, setInstruments] = useState<Instrument[]>([]); const [selected, setSelected] = useState<Instrument | null>(null); const [search, setSearch] = useState(''); const [status, setStatus] = useState('Connecting to Deriv…'); const [lastError, setLastError] = useState(''); const [latest, setLatest] = useState<Tick | null>(null); const [instrumentMenuOpen, setInstrumentMenuOpen] = useState(false); const [researchLabOpen, setResearchLabOpen] = useState(false); const [connectionNonce, setConnectionNonce] = useState(0); const wsRef = useRef<WebSocket | null>(null); const endpointRef = useRef<DerivEndpoint | null>(null); const liveBuffer = useRef<Tick[]>([]); const seen = useRef(new Set<string>());

  const loadCatalog = useCallback(async () => { setStatus('Discovering Deriv Synthetic Indices…'); setLastError(''); const result = await discoverCatalogue(); setInstruments(result.instruments); endpointRef.current = result.endpoint; try { await api.post('/api/sire/catalogue/sync', { instruments: result.allInstruments }); } catch { /* non-blocking */ } setSelected(current => current && result.instruments.some(item => item.symbol === current.symbol) ? current : result.instruments[0] || null); setStatus(`Deriv online · ${result.instruments.length} Synthetic Indices · ${result.endpoint.label}`); }, []);
  useEffect(() => { void loadCatalog().catch(error => { setStatus('Deriv connection failed'); setLastError(error instanceof Error ? error.message : String(error)); }); }, [loadCatalog, connectionNonce]);

  const requestDerivHistory = useCallback(async (request: Record<string, unknown>): Promise<DerivResponse> => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) return requestOnce(ws, request);
      await new Promise(resolve => window.setTimeout(resolve, 200));
    }
    throw new Error('Deriv market-data connection is not ready');
  }, []);

  useEffect(() => {
    if (!selected) return;
    let disposed = false; let reconnectTimer = 0;
    const connect = async () => {
      const candidates = endpointRef.current ? [endpointRef.current, ...DERIV_ENDPOINTS.filter(item => item.url !== endpointRef.current?.url)] : DERIV_ENDPOINTS;
      try {
        let ws: WebSocket | null = null; let activeEndpoint: DerivEndpoint | null = null; const connectionErrors: string[] = [];
        for (const endpoint of candidates) {
          try { ws = await openDeriv(endpoint); activeEndpoint = endpoint; break; }
          catch (error) { connectionErrors.push(error instanceof Error ? error.message : String(error)); }
        }
        if (!ws || !activeEndpoint) throw new Error(connectionErrors.join(' | ') || 'No Deriv endpoint available');
        if (disposed) { ws.close(); return; }
        wsRef.current = ws; endpointRef.current = activeEndpoint; setStatus(`Live · ${selected.name} · ${activeEndpoint.label}`);

        ws.addEventListener('message', event => {
          if (disposed) return;
          try {
            const data = JSON.parse(event.data) as Record<string, unknown>;
            if (data.error) { const error = data.error as Record<string, unknown>; setLastError(String(error.message || 'Deriv stream error')); return; }
            if (Array.isArray(data.errors) && data.errors.length) { const first = data.errors[0] as Record<string, unknown>; setLastError(String(first?.message || 'Deriv stream error')); return; }
            if (data.msg_type !== 'tick' || !data.tick || typeof data.tick !== 'object') return;
            const raw = data.tick as Record<string, unknown>;
            const tick: Tick = { symbol: String(raw.symbol || raw.underlying_symbol || selected.symbol), quote: Number(raw.quote), bid: Number.isFinite(Number(raw.bid)) ? Number(raw.bid) : undefined, ask: Number.isFinite(Number(raw.ask)) ? Number(raw.ask) : undefined, epoch: Number(raw.epoch), id: raw.id ? String(raw.id) : undefined, source: 'Deriv' };
            if (!Number.isFinite(tick.quote) || !Number.isFinite(tick.epoch)) return;
            const key = `${tick.symbol}:${tick.epoch}:${tick.quote}`; if (seen.current.has(key)) return; seen.current.add(key); liveBuffer.current.push(tick); setLatest(tick);
            if (liveBuffer.current.length >= INGEST_CHUNK) { const batch = liveBuffer.current.splice(0, INGEST_CHUNK); void ingestTicks(selected.symbol, batch).catch(() => undefined); }
          } catch { setLastError('Invalid live tick received from Deriv'); }
        });

        ws.addEventListener('close', event => { if (!disposed) { if (wsRef.current === ws) wsRef.current = null; setStatus(`Reconnecting · ${selected.name}`); setLastError(`Deriv WebSocket closed (code ${event.code}${event.reason ? `: ${event.reason}` : ''})`); reconnectTimer = window.setTimeout(connect, 1500); } });
        ws.addEventListener('error', () => { if (!disposed) setLastError(`Deriv WebSocket error on ${activeEndpoint?.label || 'active endpoint'}`); });

        try { ws.send(JSON.stringify({ ticks: selected.symbol, subscribe: 1, req_id: Math.floor(Math.random() * 900000000) + 100000000 })); }
        catch (error) { setLastError(error instanceof Error ? error.message : String(error)); throw error; }
      } catch (error) {
        if (!disposed) { setLastError(error instanceof Error ? error.message : 'Live Deriv stream failed'); setStatus(`Reconnecting · ${selected.name}`); reconnectTimer = window.setTimeout(connect, 2500); }
      }
    };
    void connect();
    return () => { disposed = true; window.clearTimeout(reconnectTimer); if (liveBuffer.current.length) void ingestTicks(selected.symbol, liveBuffer.current.splice(0)); if (wsRef.current) { wsRef.current.close(); wsRef.current = null; } };
  }, [selected]);

  useEffect(() => { setLatest(null); seen.current = new Set(); }, [selected?.symbol]);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return q ? instruments.filter(item => `${item.name} ${item.symbol}`.toLowerCase().includes(q)) : instruments; }, [instruments, search]);
  return <main className="native-terminal-shell">
    <header className="native-terminal-topbar"><div className="brand-block"><div className="brand-mark">S</div><div><b>SIRE</b><span>MARKET RESEARCH TERMINAL</span></div></div><button className="native-instrument-picker" onClick={() => setInstrumentMenuOpen(value => !value)}><span><strong>{selected?.name || 'Select instrument'}</strong><small>{selected?.symbol || 'Synthetic Index'} · Deriv</small></span><ChevronDown size={16} /></button><div className="native-live-state"><span className="live-dot" />{status.startsWith('Live') ? 'LIVE' : status}</div></header>
    {instrumentMenuOpen && <div className="native-instrument-overlay" onClick={() => setInstrumentMenuOpen(false)}><div className="native-instrument-sheet" onClick={event => event.stopPropagation()}><div className="sheet-head"><div><span>CHANGE INSTRUMENT</span><b>{instruments.length} Synthetic Indices</b></div><button onClick={() => setInstrumentMenuOpen(false)}>Done</button></div><div className="sheet-search"><Search size={15} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search instrument or symbol" /></div><div className="sheet-list">{filtered.map(item => <button key={item.symbol} className={`sheet-row ${selected?.symbol === item.symbol ? 'active' : ''}`} onClick={() => { setSelected(item); setInstrumentMenuOpen(false); }}><span><b>{item.name}</b><small>{item.symbol}</small></span><em>{selected?.symbol === item.symbol ? 'SELECTED' : item.exchangeOpen === 0 ? 'OFF' : 'LIVE'}</em></button>)}{!filtered.length && <div className="empty-state">No instruments found.</div>}</div></div></div>}
    <div className="native-terminal-body"><aside className="native-symbol-sidebar"><div className="sidebar-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" /></div><div className="sidebar-meta"><span>DERIV SYNTHETIC</span><b>{instruments.length}</b></div><div className="native-symbol-list">{filtered.slice(0, 100).map(item => <button key={item.symbol} className={selected?.symbol === item.symbol ? 'active' : ''} onClick={() => setSelected(item)}><span><b>{item.name}</b><small>{item.symbol}</small></span><i>{item.exchangeOpen === 0 ? 'OFF' : 'LIVE'}</i></button>)}</div></aside>
      <section className="native-chart-panel"><div className="native-chart-toolbar"><div className="native-timeframes" /><div className="native-chart-actions"><button title="Open GPT research laboratory" onClick={() => setResearchLabOpen(true)}><Beaker size={14} /></button></div></div><div className="native-chart-subbar"><div><b>{selected?.name || 'No instrument'}</b><span>{selected?.symbol || '—'}</span></div><div className="native-ohlc"><span>Bid <b>{latest?.bid !== undefined ? latest.bid.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}</b></span><span>Ask <b>{latest?.ask !== undefined ? latest.ask.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}</b></span></div><div>{latest ? latest.quote.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}</div></div>{lastError && <div className="native-chart-error">{lastError}</div>}<div className="native-chart-stage" aria-label="Chart workspace">{selected && <FinancialChart symbol={selected.symbol} liveTick={latest} requestHistory={requestDerivHistory} />}</div></section>
    </div>
    {researchLabOpen && selected && <ResearchLab symbol={selected.symbol} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onClose={() => setResearchLabOpen(false)} onSelectInstrument={symbol => { const next = instruments.find(item => item.symbol === symbol); if (next) setSelected(next); setResearchLabOpen(false); }} />}
    <button className="native-reconnect" onClick={() => setConnectionNonce(value => value + 1)} aria-label="Reconnect to Deriv">Reconnect</button>
  </main>;
}
