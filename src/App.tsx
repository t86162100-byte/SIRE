import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import { Search, RotateCcw, ChevronDown, Activity, Beaker } from 'lucide-react';
import ResearchLab from './ResearchLab';
import FinancialChart from './FinancialChart';

type Instrument = { symbol: string; name: string; market: string; submarket: string; subgroup: string; symbolType: string; exchangeOpen?: number };
type Tick = { symbol: string; quote: number; bid?: number; ask?: number; epoch: number; id?: string; source: 'Deriv' };
type DiscoveryResult = { instruments: Instrument[]; allInstruments: Record<string, unknown>[]; totalMarkets: number; endpointLabel: string };

// Deriv's open-source WebSocket examples use this public market-data endpoint.
// No account token is required for active_symbols/ticks/ticks_history.
const DERIV_PUBLIC_WS = 'wss://ws.binaryws.com/websockets/v3';
const INGEST_CHUNK = 500;

function textOf(item: Record<string, unknown>, keys: string[]) {
  return keys.map(key => item[key]).filter(value => value !== undefined && value !== null).map(value => String(value)).join(' ').toLowerCase();
}

function isSynthetic(item: Record<string, unknown>) {
  const market = String(item.market || '').toLowerCase();
  const submarket = String(item.submarket || '').toLowerCase();
  const subgroup = String(item.subgroup || '').toLowerCase();
  const symbol = String(item.symbol || item.underlying_symbol || '');
  const symbolType = String(item.symbol_type || item.underlying_symbol_type || '').toLowerCase();
  const text = textOf(item, ['symbol', 'display_name', 'symbol_type', 'market', 'submarket', 'subgroup', 'underlying_symbol', 'underlying_symbol_name', 'underlying_symbol_type']);

  return market === 'synthetic_index' || market === 'synthetic indices' || symbolType === 'synthetic_index' || submarket.includes('random_index') || submarket.includes('synthetic') || subgroup.includes('synthetic') || /synthetic index|volatility|boom|crash|jump|step|drift|range break|daily reset|bear market|bull market|random index/.test(text) || /^(R_|1HZ|BOOM|CRASH|STEP|JUMP|DRIFT|RANGE_BREAK|BULL|BEAR)/i.test(symbol);
}

function normalize(item: Record<string, unknown>): Instrument | null {
  const symbol = String(item.symbol || item.underlying_symbol || '');
  if (!symbol) return null;
  return {
    symbol,
    name: String(item.display_name || item.underlying_symbol_name || symbol),
    market: String(item.market || ''),
    submarket: String(item.submarket || ''),
    subgroup: String(item.subgroup || ''),
    symbolType: String(item.symbol_type || item.underlying_symbol_type || ''),
    exchangeOpen: typeof item.exchange_is_open === 'number' ? item.exchange_is_open : undefined,
  };
}

function openDeriv(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(DERIV_PUBLIC_WS);
    const timer = window.setTimeout(() => { socket.close(); reject(new Error('Deriv public WebSocket timed out')); }, 10000);
    socket.onopen = () => { window.clearTimeout(timer); resolve(socket); };
    socket.onerror = () => { window.clearTimeout(timer); reject(new Error('Unable to connect to Deriv public market-data endpoint')); };
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

async function discoverCatalogue(): Promise<DiscoveryResult> {
  const ws = await openDeriv();
  try {
    // Keep this request compatible with Deriv's open-source/legacy API examples.
    const data = await requestOnce(ws, { active_symbols: 'full', product_type: 'basic' });
    const all = Array.isArray(data.active_symbols) ? data.active_symbols : [];
    const allRecords = all.filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
    const instruments = allRecords.filter(isSynthetic).map(normalize).filter((item): item is Instrument => Boolean(item));
    const unique = Array.from(new Map(instruments.map(item => [item.symbol, item])).values()).sort((a, b) => a.name.localeCompare(b.name));
    if (!unique.length) throw new Error(`Deriv returned ${allRecords.length} active markets but no Synthetic Indices matched`);
    return { instruments: unique, allInstruments: allRecords, totalMarkets: allRecords.length, endpointLabel: 'Deriv open-source WebSocket API' };
  } finally {
    ws.close();
  }
}

async function ingestTicks(symbol: string, ticks: Tick[]) {
  for (let i = 0; i < ticks.length; i += INGEST_CHUNK) {
    await api.post('/api/sire/ingest', { symbol, source: 'Deriv', ticks: ticks.slice(i, i + INGEST_CHUNK) });
  }
}

function formatQuote(value: number) { return value.toLocaleString(undefined, { maximumFractionDigits: 8 }); }

export default function App() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Connecting to Deriv…');
  const [lastError, setLastError] = useState('');
  const [endpointLabel, setEndpointLabel] = useState('');
  const [totalMarkets, setTotalMarkets] = useState(0);
  const [latest, setLatest] = useState<Tick | null>(null);
  const [chartTick, setChartTick] = useState<Tick | null>(null);
  const [liveTicks, setLiveTicks] = useState(0);
  const [connectionNonce, setConnectionNonce] = useState(0);
  const [instrumentMenuOpen, setInstrumentMenuOpen] = useState(false);
  const [researchLabOpen, setResearchLabOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const liveBuffer = useRef<Tick[]>([]);
  const seen = useRef(new Set<string>());

  const loadCatalog = useCallback(async () => {
    setStatus('Discovering Deriv Synthetic Indices…');
    setLastError('');
    const result = await discoverCatalogue();
    setInstruments(result.instruments);
    setTotalMarkets(result.totalMarkets);
    setEndpointLabel(result.endpointLabel);
    try {
      await api.post('/api/sire/catalogue/sync', { instruments: result.allInstruments });
    } catch (error) {
      setLastError(error instanceof Error ? `Catalogue discovered but persistence failed: ${error.message}` : 'Catalogue discovered but persistence failed');
    }
    setSelected(current => current && result.instruments.some(item => item.symbol === current.symbol) ? current : result.instruments[0] || null);
    setStatus(`Deriv online · ${result.instruments.length} Synthetic Indices discovered`);
  }, []);

  useEffect(() => {
    void loadCatalog().catch((error: Error) => { setStatus('Deriv connection failed'); setLastError(error.message); });
  }, [loadCatalog, connectionNonce]);

  useEffect(() => {
    if (!selected) return;
    let disposed = false;
    let reconnectTimer = 0;
    setLatest(null); setChartTick(null); setLiveTicks(0); liveBuffer.current = []; seen.current = new Set();

    const connect = async () => {
      try {
        const ws = await openDeriv();
        if (disposed) { ws.close(); return; }
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
            setLatest(tick); setChartTick(tick); setLiveTicks(value => value + 1);
            if (liveBuffer.current.length >= INGEST_CHUNK) {
              const batch = liveBuffer.current.splice(0, INGEST_CHUNK);
              void ingestTicks(selected.symbol, batch).catch(() => undefined);
            }
          } catch {
            setLastError('Invalid live tick received from Deriv');
          }
        });
        ws.addEventListener('close', () => {
          if (!disposed) { setStatus(`Reconnecting · ${selected.name}`); reconnectTimer = window.setTimeout(connect, 1500); }
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
      wsRef.current?.close(); wsRef.current = null;
    };
  }, [selected]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? instruments.filter(item => `${item.name} ${item.symbol}`.toLowerCase().includes(query)) : instruments;
  }, [instruments, search]);

  return (
    <>
      <main className="terminal-shell">
        <header className="terminal-topbar"><div className="brand-block"><div className="brand-mark">S</div><div><b>SIRE</b><span>MARKET RESEARCH TERMINAL</span></div></div><button className="instrument-picker" onClick={() => setInstrumentMenuOpen(value => !value)} aria-label="Change instrument"><span><strong>{selected?.name || 'Select instrument'}</strong><small>{selected?.symbol || 'Synthetic Index'} · Deriv</small></span><ChevronDown size={16} /></button><div className="live-state"><span className="live-dot" />{status.startsWith('Live') ? 'LIVE' : status.replace('Deriv ', '')}</div></header>
        {instrumentMenuOpen && <div className="instrument-overlay" onClick={() => setInstrumentMenuOpen(false)}><div className="instrument-sheet" onClick={event => event.stopPropagation()}><div className="sheet-head"><div><span>CHANGE INSTRUMENT</span><b>{instruments.length} Synthetic Indices</b></div><button onClick={() => setInstrumentMenuOpen(false)}>Done</button></div><div className="sheet-search"><Search size={15} /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search instrument or symbol" /></div><div className="sheet-list">{filtered.map(item => <button key={item.symbol} className={`sheet-row ${selected?.symbol === item.symbol ? 'active' : ''}`} onClick={() => { setSelected(item); setInstrumentMenuOpen(false); }}><span><b>{item.name}</b><small>{item.symbol}</small></span><em>{selected?.symbol === item.symbol ? 'SELECTED' : item.exchangeOpen === 0 ? 'OFF' : 'LIVE'}</em></button>)}{!filtered.length && <div className="empty-state">No instruments found.</div>}</div></div></div>}
        <div className="terminal-body">
          <aside className="symbol-sidebar"><div className="sidebar-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" /></div><div className="sidebar-meta"><span>DERIV SYNTHETIC</span><b>{filtered.length}</b></div><div className="symbol-list">{filtered.map(item => <button key={item.symbol} className={`symbol-row ${selected?.symbol === item.symbol ? 'active' : ''}`} onClick={() => setSelected(item)} aria-label={`Select ${item.name}`}><span><b>{item.name}</b><small>{item.symbol}</small></span><em>{item.exchangeOpen === 0 ? 'OFF' : '●'}</em></button>)}{!filtered.length && <div className="empty-state">No instruments found.</div>}</div><button className="catalogue-refresh" onClick={() => setConnectionNonce(value => value + 1)}><RotateCcw size={13} /> Refresh catalogue</button></aside>
          <section className="market-workspace" aria-label="Market workspace">
            <div className="market-summary"><div><span>SELECTED MARKET</span><strong>{selected?.name || 'No instrument selected'}</strong><small>{selected?.symbol || '—'}</small></div><div><span>LAST QUOTE</span><strong>{latest ? formatQuote(latest.quote) : '—'}</strong><small>{latest ? new Date(latest.epoch * 1000).toLocaleString() : 'Waiting for live data'}</small></div><div><span>LIVE UPDATES</span><strong>{liveTicks.toLocaleString()}</strong><small>{endpointLabel || `${totalMarkets} Deriv markets`}</small></div></div>
            {lastError && <div className="terminal-error">{lastError}</div>}
            {selected ? <FinancialChart symbol={selected.symbol} liveTick={chartTick ? { epoch: chartTick.epoch, quote: chartTick.quote } : null} /> : <div className="market-empty-state"><Activity size={28} /><b>Market data is ready</b><span>Select an instrument to open its live financial chart.</span><button className="lab-launch" onClick={() => setResearchLabOpen(true)}><Beaker size={13} /> OPEN SIRE RESEARCH</button></div>}
          </section>
        </div>
      </main>
      {researchLabOpen && selected && <ResearchLab symbol={selected.symbol} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onClose={() => setResearchLabOpen(false)} onSelectInstrument={symbol => { const target = instruments.find(item => item.symbol === symbol); if (target) setSelected(target); }} />}
    </>
  );
}
