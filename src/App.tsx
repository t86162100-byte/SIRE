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
  const [instrumentSearchOpen, setInstrumentSearchOpen] = useState(false);
  const [status, setStatus] = useState('Connecting to Deriv…');
  const [lastError, setLastError] = useState('');
  const [latestBySymbol, setLatestBySymbol] = useState<Record<string, Tick>>({});
  const [researchLabOpen, setResearchLabOpen] = useState(false);
  const selectedRef = useRef<DerivInstrument | null>(null);
  const [chartLayout, setChartLayout] = useState<1 | 2>(1);
  const [activeChartIndex, setActiveChartIndex] = useState(0);
  const [linked, setLinked] = useState(false);
  const [multiChartOpen, setMultiChartOpen] = useState(false);
  const [multiChartInstrument, setMultiChartInstrument] = useState('');
  const [multiChartPosition, setMultiChartPosition] = useState<'up' | 'down' | 'left' | 'right'>('right');
  const [chartSymbols, setChartSymbols] = useState<string[]>([]);
  const linkGroupRef = useRef<LinkGroup | null>(null);

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => {
    if (!instruments.length) return;
    setChartSymbols(current => Array.from({ length: chartLayout }, (_, index) => current[index] || (index === 0 ? (selected?.symbol || instruments[0].symbol) : instruments[index % instruments.length].symbol)));
  }, [chartLayout, instruments, selected?.symbol]);
  useEffect(() => {
    setActiveChartIndex(current => Math.min(current, chartLayout - 1));
  }, [chartLayout]);
  useEffect(() => {
    // Keep charts completely independent unless Link is explicitly enabled.
    linkGroupRef.current?.destroy();
    linkGroupRef.current = linked
      ? createLinkGroup({ crosshair: true, viewport: true, symbol: true })
      : null;
    return () => {};
  }, [linked]);
  useEffect(() => () => { linkGroupRef.current?.destroy(); linkGroupRef.current = null; }, []);
  useEffect(() => {
    const openMultiChart = () => setMultiChartOpen(true);
    window.addEventListener('sire:open-multichart', openMultiChart);
    return () => window.removeEventListener('sire:open-multichart', openMultiChart);
  }, []);

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
    if (!chartSymbols.length) return;
    let mounted = true;
    setLastError('');
    const removeTick = derivMarketData.onTick(tick => {
      if (!mounted || !chartSymbols.includes(tick.symbol)) return;
      setLatestBySymbol(current => ({ ...current, [tick.symbol]: tick }));
      if (tick.symbol === chartSymbols[0]) setStatus(`LIVE · ${instruments.find(item => item.symbol === tick.symbol)?.name || tick.symbol}`);
    });
    const subscribeAll = async () => {
      try {
        await derivMarketData.request({ forget_all: 'ticks' });
        for (const chartSymbol of [...new Set(chartSymbols)]) await derivMarketData.subscribe(chartSymbol);
      } catch (error) {
        if (mounted) setLastError(error instanceof Error ? error.message : String(error));
      }
    };
    void subscribeAll();
    return () => { mounted = false; removeTick(); };
  }, [chartSymbols.join('|'), instruments]);

  const requestHistory = useCallback(async (request: Record<string, unknown>): Promise<DerivResponse> => {
    if (typeof request.ticks_history === 'string') {
      const start = Number.isFinite(Number(request.start)) ? Number(request.start) : undefined;
      const rawEnd = request.end;
      const end = rawEnd === 'latest' || rawEnd === undefined ? 'latest' : Number.isFinite(Number(rawEnd)) ? Number(rawEnd) : 'latest';
      const count = Number.isFinite(Number(request.count)) ? Number(request.count) : 5000;
      return derivMarketData.history(String(request.ticks_history), Number(request.granularity || 60), start, end, count);
    }
    return derivMarketData.request(request);
  }, []);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return q ? instruments.filter(item => `${item.name} ${item.symbol}`.toLowerCase().includes(q)) : instruments; }, [instruments, search]);
  const selectInstrument = (item: DerivInstrument) => { setSelected(item); setSearch(''); setChartSymbols(current => current.length ? current.map((value, index) => index === 0 ? item.symbol : value) : [item.symbol]); };

  const chartItems = chartSymbols.slice(0, chartLayout);
  const openMultiChartManager = () => {
    setMultiChartInstrument(chartSymbols[1] || instruments[1]?.symbol || instruments[0]?.symbol || '');
    setMultiChartOpen(true);
  };
  const confirmMultiChart = () => {
    if (!multiChartInstrument) return;
    setChartSymbols(current => [current[0] || selected?.symbol || instruments[0]?.symbol || multiChartInstrument, multiChartInstrument]);
    setChartLayout(2);
    setMultiChartOpen(false);
  };
  const removeSelectedChart = () => {
    if (chartLayout !== 2) return;
    const selectedIndex = Math.min(activeChartIndex, 1);
    const remainingSymbol = chartSymbols[selectedIndex === 0 ? 1 : 0] || selected?.symbol || instruments[0]?.symbol || '';
    setChartSymbols([remainingSymbol]);
    setChartLayout(1);
    setActiveChartIndex(0);
    setSelected(instruments.find(item => item.symbol === remainingSymbol) || selected);
    setMultiChartOpen(false);
  };
  const makeSecondMainChart = () => {
    if (!chartSymbols[1]) return;
    setChartSymbols(current => [current[1], current[0] || current[1]]);
    setActiveChartIndex(0);
    setSelected(instruments.find(item => item.symbol === chartSymbols[1]) || selected);
    setMultiChartOpen(false);
  };
  return <main className={`native-terminal-shell${researchLabOpen ? ' sire-research-open' : ''}`}>
    <div className="native-terminal-body">
      <aside className="native-symbol-sidebar"><div className="sidebar-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" /></div><div className="sidebar-meta"><span>DERIV SYNTHETIC</span><b>{instruments.length}</b></div><div className="native-symbol-list">{filtered.slice(0, 150).map(item => <button key={item.symbol} className={selected?.symbol === item.symbol ? 'active' : ''} onClick={() => selectInstrument(item)}><span><b>{item.name}</b><small>{item.symbol}</small></span><i>{item.exchangeOpen === 0 ? 'OFF' : 'LIVE'}</i></button>)}</div></aside>
      <section className="native-chart-panel">
        {lastError && <div className="native-error-banner">{lastError}</div>}
        <div className="sire-workspace-toolbar"><span>SIRE · OpenAlgo</span><button type="button" className={linked ? 'active' : ''} onClick={() => setLinked(value => !value)}>Link</button></div>
        <div className={`sire-chart-grid sire-chart-grid--${chartLayout}${chartLayout === 2 ? ` sire-chart-grid--${multiChartPosition}` : ''}`} onContextMenu={event => event.preventDefault()}>
          {chartItems.map((chartSymbol, index) => <div className={`sire-chart-cell${activeChartIndex === index ? ' sire-chart-cell--active' : ''}`} key={index} onPointerDown={() => setActiveChartIndex(index)}>{chartSymbol && <FinancialChart
            symbol={chartSymbol}
            isActive={activeChartIndex === index}
            liveTick={latestBySymbol[chartSymbol] || null}
            requestHistory={requestHistory}
            instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name, pipSize: item.pipSize }))}
            onInstrumentTap={() => setInstrumentSearchOpen(true)}
            onSelectInstrument={item => {
              setChartSymbols(current => current.map((value, slot) => slot === index ? item.symbol : value));
              if (index === 0) setSelected(current => current?.symbol === item.symbol ? current : instruments.find(candidate => candidate.symbol === item.symbol) || current);
            }}
            onWidgetReady={widget => {
              if (!linked) return;
              const group = linkGroupRef.current || createLinkGroup({ crosshair: true, viewport: true, symbol: true });
              linkGroupRef.current = group;
              group.add(widget.chart, {
                symbol: chartSymbol,
                onSymbol: next => setChartSymbols(current => current.map((value, slot) => slot === index ? next : value)),
              });
            }}
            onWidgetDestroyed={widget => linkGroupRef.current?.remove(widget.chart)}
          />}</div>)}
        </div>
        {multiChartOpen && <div className="sire-multichart-overlay" onContextMenu={event => event.preventDefault()}>
          <div className="sire-multichart-panel">
            <div className="sire-multichart-head"><div><strong>Multi-chart</strong><small>{chartLayout === 2 ? 'Manage the second window' : 'Add a second window'}</small></div><button type="button" onClick={() => setMultiChartOpen(false)} aria-label="Close multi-chart manager">×</button></div>
            <label className="sire-multichart-field"><span>Instrument</span><select value={multiChartInstrument} onChange={event => setMultiChartInstrument(event.target.value)}>{instruments.map(item => <option key={item.symbol} value={item.symbol}>{item.name} · {item.symbol}</option>)}</select></label>
            <div className="sire-multichart-field"><span>New window position</span><div className="sire-multichart-directions">{(['up','down','left','right'] as const).map(position => <button key={position} type="button" className={multiChartPosition === position ? 'active' : ''} onClick={() => setMultiChartPosition(position)}>{position === 'up' ? '↑ Up' : position === 'down' ? '↓ Down' : position === 'left' ? '← Left' : '→ Right'}</button>)}</div></div>
            <div className="sire-multichart-actions">{chartLayout === 2 && <button type="button" className="danger" onClick={removeSelectedChart}>Delete selected</button>}<button type="button" className="primary" onClick={confirmMultiChart}>{chartLayout === 2 ? 'Apply' : 'Confirm'}</button></div>
          </div>
        </div>}
        {instrumentSearchOpen && <div className="sire-instrument-search-overlay" onContextMenu={event => event.preventDefault()}>
          <div className="sire-instrument-search-panel">
            <div className="sire-instrument-search-head">
              <strong>Instruments</strong>
              <button type="button" onClick={() => setInstrumentSearchOpen(false)} aria-label="Close instrument search">×</button>
            </div>
            <div className="sire-instrument-search-input">
              <Search size={16} />
              <input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search instruments" />
            </div>
            <div className="sire-instrument-search-list">
              {filtered.slice(0, 150).map(item => <button key={item.symbol} type="button" onClick={() => { selectInstrument(item); setInstrumentSearchOpen(false); }}>
                <span><b>{item.name}</b><small>{item.symbol}</small></span><i>{item.exchangeOpen === 0 ? 'OFF' : 'LIVE'}</i>
              </button>)}
            </div>
          </div>
        </div>}      </section>
    </div>
    {researchLabOpen && <ResearchLab symbol={selected?.symbol || ''} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onClose={() => setResearchLabOpen(false)} onSelectInstrument={symbol => { const item = instruments.find(candidate => candidate.symbol === symbol); if (item) setSelected(item); }} />}
  </main>;
}
