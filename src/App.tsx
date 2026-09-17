import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Beaker } from 'lucide-react';
import ResearchLab from './ResearchLab';
import FinancialChart from './FinancialChart';
import { derivMarketData, type DerivInstrument, type DerivTick, type DerivResponse } from './derivMarketData';
import './nativeTerminal.css';

type Tick = DerivTick;

export default function App() {
  const [instruments, setInstruments] = useState<DerivInstrument[]>([]);
  const [selected, setSelected] = useState<DerivInstrument | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Connecting to Deriv…');
  const [lastError, setLastError] = useState('');
  const [latest, setLatest] = useState<Tick | null>(null);
  const [researchLabOpen, setResearchLabOpen] = useState(false);
  const selectedRef = useRef<DerivInstrument | null>(null);

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setStatus('Connecting to Deriv…');
        setLastError('');
        const list = await derivMarketData.getSyntheticIndices();
        if (!mounted) return;
        setInstruments(list);
        setSelected(current => current && list.some(item => item.symbol === current.symbol) ? current : list[0]);
        setStatus(`Deriv connected · ${list.length} Synthetic Indices`);
      } catch (error) {
        if (!mounted) return;
        setStatus('Deriv connection failed');
        setLastError(error instanceof Error ? error.message : String(error));
      }
    };
    void load();
    const removeStatus = derivMarketData.onStatus(next => {
      if (!mounted) return;
      if (next === 'connecting') setStatus('Connecting to Deriv…');
      if (next === 'connected') setStatus(selectedRef.current ? `LIVE · ${selectedRef.current.name}` : 'Deriv connected');
      if (next === 'closed') setStatus('Reconnecting to Deriv…');
      if (next === 'error') setStatus('Deriv connection error');
    });
    return () => { mounted = false; removeStatus(); };
  }, []);

  useEffect(() => {
    setLatest(null);
    if (!selected) return;
    let mounted = true;
    setLastError('');
    setStatus(`Connecting · ${selected.name}`);
    const removeTick = derivMarketData.onTick(tick => {
      if (!mounted || tick.symbol !== selected.symbol) return;
      setLatest(tick);
      setStatus(`LIVE · ${selected.name}`);
    });
    void derivMarketData.request({ forget_all: 'ticks' })
      .catch(() => undefined)
      .then(() => derivMarketData.subscribe(selected.symbol))
      .catch(error => { if (mounted) setLastError(error instanceof Error ? error.message : String(error)); });
    return () => { mounted = false; removeTick(); };
  }, [selected?.symbol]);

  const requestHistory = useCallback(async (request: Record<string, unknown>): Promise<DerivResponse> => {
    if (typeof request.ticks_history === 'string') return derivMarketData.history(String(request.ticks_history), Number(request.granularity || 60));
    return derivMarketData.request(request);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? instruments.filter(item => `${item.name} ${item.symbol}`.toLowerCase().includes(q)) : instruments;
  }, [instruments, search]);

  const selectInstrument = (item: DerivInstrument) => { setSelected(item); setSearch(''); };

  return (
    <main className="native-terminal-shell">
      <header className="native-terminal-topbar">
        <div className="brand-block"><div className="brand-mark">S</div><div><b>SIRE</b><span>MARKET RESEARCH TERMINAL</span></div></div>
        <div className="native-live-state"><span className="live-dot" />{status.startsWith('LIVE') ? 'LIVE' : status}</div>
      </header>

      <div className="native-terminal-body">
        <aside className="native-symbol-sidebar"><div className="sidebar-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" /></div><div className="sidebar-meta"><span>DERIV SYNTHETIC</span><b>{instruments.length}</b></div><div className="native-symbol-list">{filtered.slice(0, 150).map(item => <button key={item.symbol} className={selected?.symbol === item.symbol ? 'active' : ''} onClick={() => selectInstrument(item)}><span><b>{item.name}</b><small>{item.symbol}</small></span><i>{item.exchangeOpen === 0 ? 'OFF' : 'LIVE'}</i></button>)}</div></aside>
        <section className="native-chart-panel"><div className="native-chart-toolbar"><div className="native-timeframes" /><div className="native-chart-actions"><button title="Open GPT research laboratory" onClick={() => setResearchLabOpen(true)}><Beaker size={14} /></button></div></div>{lastError && <div className="native-error-banner">{lastError}</div>}{selected && <FinancialChart symbol={selected.symbol} liveTick={latest} requestHistory={requestHistory} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onSelectInstrument={item => { const match = instruments.find(candidate => candidate.symbol === item.symbol); if (match) selectInstrument(match); }} />}</section>
      </div>

      {researchLabOpen && <ResearchLab symbol={selected?.symbol || ''} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onClose={() => setResearchLabOpen(false)} onSelectInstrument={symbol => { const item = instruments.find(candidate => candidate.symbol === symbol); if (item) setSelected(item); }} />}
    </main>
  );
}
