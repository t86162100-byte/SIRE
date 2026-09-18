import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { createLinkGroup, type LinkGroup } from 'openalgo-charts';
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
  const [chartLayout, setChartLayout] = useState<1 | 2 | 4>(1);
  const [linked, setLinked] = useState(true);
  const [chartSymbols, setChartSymbols] = useState<string[]>([]);
  const linkGroupRef = useRef<LinkGroup | null>(null);

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => {
    if (!instruments.length) return;
    setChartSymbols(current => Array.from({ length: chartLayout }, (_, index) => current[index] || (index === 0 ? (selected?.symbol || instruments[0].symbol) : instruments[index % instruments.length].symbol)));
  }, [chartLayout, instruments, selected?.symbol]);
  useEffect(() => {
    if (!linkGroupRef.current) linkGroupRef.current = createLinkGroup({ crosshair: true, viewport: true, symbol: linked });
    else linkGroupRef.current.setOptions({ crosshair: true, viewport: true, symbol: linked });
    return () => {};
  }, [linked]);
  useEffect(() => () => { linkGroupRef.current?.destroy(); linkGroupRef.current = null; }, []);
  useEffect(() => {
    const open = () => setResearchLabOpen(true);
    window.addEventListener('sire:open-research', open);
    return () => window.removeEventListener('sire:open-research', open);
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => { try { setStatus('Connecting to Deriv…'); setLastError(''); const list = await derivMarketData.getSyntheticIndices(); if (!mounted) return; setInstruments(list); setSelected(current => current && list.some(item => item.symbol === current.symbol) ? current : list[0]); setStatus(`Deriv connected · ${list.length} Synthetic Indices`); } catch (error) { if (!mounted) return; setStatus('Deriv connection failed'); setLastError(error instanceof Error ? error.message : String(error)); } };
    void load();
    const removeStatus = derivMarketData.onStatus(next => { if (!mounted) return; if (next === 'connecting') setStatus('Connecting to Deriv…'); if (next === 'connected') setStatus(selectedRef.current ? `LIVE · ${selectedRef.current.name}` : 'Deriv connected'); if (next === 'closed') setStatus('Reconnecting to Deriv…'); if (next === 'error') setStatus('Deriv connection error'); });
    return () => { mounted = false; removeStatus(); };
  }, []);

  useEffect(() => {
    setLatest(null); if (!selected) return; let mounted = true; setLastError(''); setStatus(`Connecting · ${selected.name}`);
    const removeTick = derivMarketData.onTick(tick => { if (!mounted || tick.symbol !== selected.symbol) return; setLatest(tick); setStatus(`LIVE · ${selected.name}`); });
    void derivMarketData.request({ forget_all: 'ticks' }).catch(() => undefined).then(() => derivMarketData.subscribe(selected.symbol)).catch(error => { if (mounted) setLastError(error instanceof Error ? error.message : String(error)); });
    return () => { mounted = false; removeTick(); };
  }, [selected?.symbol]);

  const requestHistory = useCallback(async (request: Record<string, unknown>): Promise<DerivResponse> => typeof request.ticks_history === 'string' ? derivMarketData.history(String(request.ticks_history), Number(request.granularity || 60)) : derivMarketData.request(request), []);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return q ? instruments.filter(item => `${item.name} ${item.symbol}`.toLowerCase().includes(q)) : instruments; }, [instruments, search]);
  const selectInstrument = (item: DerivInstrument) => { setSelected(item); setSearch(''); };

  const chartItems = chartSymbols.slice(0, chartLayout);
  return <main className={`native-terminal-shell${researchLabOpen ? ' sire-research-open' : ''}`}>
    <div className="native-terminal-body">
      <aside className="native-symbol-sidebar"><div className="sidebar-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" /></div><div className="sidebar-meta"><span>DERIV SYNTHETIC</span><b>{instruments.length}</b></div><div className="native-symbol-list">{filtered.slice(0, 150).map(item => <button key={item.symbol} className={selected?.symbol === item.symbol ? 'active' : ''} onClick={() => selectInstrument(item)}><span><b>{item.name}</b><small>{item.symbol}</small></span><i>{item.exchangeOpen === 0 ? 'OFF' : 'LIVE'}</i></button>)}</div></aside>
      <section className="native-chart-panel">
        {lastError && <div className="native-error-banner">{lastError}</div>}
        <div className="sire-workspace-toolbar"><span>SIRE · OpenAlgo</span><button type="button" className={chartLayout === 1 ? 'active' : ''} onClick={() => setChartLayout(1)}>1</button><button type="button" className={chartLayout === 2 ? 'active' : ''} onClick={() => setChartLayout(2)}>2</button><button type="button" className={chartLayout === 4 ? 'active' : ''} onClick={() => setChartLayout(4)}>4</button><button type="button" className={linked ? 'active' : ''} onClick={() => setLinked(value => !value)}>Link</button></div>
        <div className={`sire-chart-grid sire-chart-grid--${chartLayout}`}>
          {chartItems.map((chartSymbol, index) => <div className="sire-chart-cell" key={index}>{chartSymbol && <FinancialChart symbol={chartSymbol} liveTick={index === 0 ? latest : null} requestHistory={requestHistory} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onSelectInstrument={item => setChartSymbols(current => current.map((value, slot) => slot === index ? item.symbol : value))} onWidgetReady={widget => { const group = linkGroupRef.current || createLinkGroup({ crosshair: true, viewport: true, symbol: linked }); linkGroupRef.current = group; group.add(widget.chart, { symbol: chartSymbol, onSymbol: next => setChartSymbols(current => current.map((value, slot) => slot === index ? next : value)) }); }} />}</div>)}
        </div>
      </section>
    </div>
    {researchLabOpen && <ResearchLab symbol={selected?.symbol || ''} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onClose={() => setResearchLabOpen(false)} onSelectInstrument={symbol => { const item = instruments.find(candidate => candidate.symbol === symbol); if (item) setSelected(item); }} />}
  </main>;
}
