import { useEffect, useMemo, useRef, useState } from 'react';
import { createLinkGroup, type LinkGroup } from 'openalgo-charts';
import { Search } from 'lucide-react';
import ResearchLab from './ResearchLab';
import FinancialChart from './FinancialChart';
import { normalizeDerivInstrument, sortDerivInstruments, type DerivInstrument } from './derivMarketData';
import { SireErrorScreen } from './SireErrorBoundary';
import './nativeTerminal.css';

type Instrument = DerivInstrument;

const chooseInitialDerivInstrument = (items: DerivInstrument[]) =>
  items.find(item => item.exchangeOpen !== 0 && item.tradingSuspended !== 1) || items[0] || null;

export default function App() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [derivLoading, setDerivLoading] = useState(true);
  const [derivError, setDerivError] = useState('');
  const [search, setSearch] = useState('');
  const [instrumentSearchOpen, setInstrumentSearchOpen] = useState(false);
  const [instrumentSearchMode, setInstrumentSearchMode] = useState<'main' | 'multi'>('main');
  const [researchLabOpen, setResearchLabOpen] = useState(false);
  const [chartLayout, setChartLayout] = useState<1 | 2>(1);
  const [activeChartIndex, setActiveChartIndex] = useState(0);
  const [linked, setLinked] = useState(false);
  const [multiChartOpen, setMultiChartOpen] = useState(false);
  const [multiChartInstrument, setMultiChartInstrument] = useState('');
  const [multiChartPosition, setMultiChartPosition] = useState<'up' | 'down' | 'left' | 'right'>('right');
  const [chartSymbols, setChartSymbols] = useState<string[]>([]);
  const linkGroupRef = useRef<LinkGroup | null>(null);


  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;

    const startup = async (): Promise<DerivInstrument[]> => {
      const maxAttempts = 3;
      const retryDelaysMs = [0, 2500, 5000];

      let lastError = 'Deriv market catalogue failed to load.';
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (cancelled) throw new Error('SIRE startup cancelled.');
        if (retryDelaysMs[attempt - 1] > 0) {
          await new Promise<void>(resolve => {
            retryTimer = window.setTimeout(() => {
              retryTimer = null;
              resolve();
            }, retryDelaysMs[attempt - 1]);
          });
        }

        try {
          console.info('[DERIV STARTUP] requesting market-data health', { attempt, maxAttempts });
          const healthResponse = await fetch('/api/sire/deriv/health', {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          });
          let health: any = null;
          try { health = await healthResponse.json(); } catch {}
          if (!healthResponse.ok || !health?.ok) {
            lastError = `Deriv startup health check failed at ${health?.stage || 'unknown stage'}: ${health?.error || `HTTP ${healthResponse.status}`}`;
            console.warn('[DERIV STARTUP] health attempt failed', { attempt, maxAttempts, error: lastError, health });
            continue;
          }
          if (!Array.isArray(health?.activeSymbols)) {
            lastError = 'Deriv startup health check connected successfully but did not return the active instrument catalogue.';
            console.warn('[DERIV STARTUP] active-symbol catalogue missing', { attempt, maxAttempts });
            continue;
          }

          const items = health.activeSymbols
            .map((item: any) => normalizeDerivInstrument(item))
            .filter(Boolean) as DerivInstrument[];
          if (!items.length) {
            lastError = 'Deriv returned an empty active-symbol catalogue.';
            console.warn('[DERIV STARTUP] active-symbol catalogue empty', { attempt, maxAttempts });
            continue;
          }

          return sortDerivInstruments(items);
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Deriv market catalogue failed to load.';
          console.warn('[DERIV STARTUP] health request failed', { attempt, maxAttempts, error: lastError });
        }
      }

      throw new Error(lastError);
    };

    startup().then(items => {
      if (cancelled) return;
      const next = items;
      const initial = chooseInitialDerivInstrument(next);
      if (!initial) throw new Error('Deriv returned an empty active-symbol catalogue.');
      setDerivError('');
      setDerivLoading(false);
      setInstruments(next);
      setSelected(current => current && next.some(item => item.symbol === current.symbol) ? current : initial);
      setChartSymbols(current => current.length ? current : [initial.symbol]);
    }).catch(error => {
      if (cancelled || error?.message === 'SIRE startup cancelled.') return;
      console.error('[DERIV MARKET DATA] active symbol discovery failed', error);
      setDerivLoading(false);
      setDerivError(error instanceof Error ? error.message : 'Deriv market catalogue failed to load.');
      setInstruments([]);
      setSelected(null);
      setChartSymbols([]);
    });

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    if (!instruments.length) return;
    setChartSymbols(current => Array.from(
      { length: chartLayout },
      (_, index) => current[index] || (index === 0
        ? (selected?.symbol || chooseInitialDerivInstrument(instruments)?.symbol || instruments[0].symbol)
        : instruments[index % instruments.length].symbol),
    ));
  }, [chartLayout, selected?.symbol]);

  useEffect(() => {
    setActiveChartIndex(current => Math.min(current, chartLayout - 1));
  }, [chartLayout]);

  useEffect(() => {
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
    const onAgentChartAction = (event: Event) => {
      const detail = (event as CustomEvent).detail as Record<string, unknown> | undefined;
      if (!detail) return;
      const action = String(detail.__sireAction || detail.type || '');
      if (action === 'set_multi_chart') {
        const requestedLayout = Number(detail.layout ?? detail.count ?? 1);
        const layout = requestedLayout >= 2 ? 2 : 1;
        const requestedSymbols = Array.isArray(detail.symbols) ? detail.symbols.map(value => String(value)).filter(Boolean) : [];
        setChartLayout(layout as 1 | 2);
        if (requestedSymbols.length) setChartSymbols(current => layout === 2
          ? [requestedSymbols[0] || current[0] || selected?.symbol || instruments[0]?.symbol || '', requestedSymbols[1] || current[1] || instruments[1]?.symbol || '']
          : [requestedSymbols[0] || current[0] || selected?.symbol || instruments[0]?.symbol || '']);
        if (detail.position === 'up' || detail.position === 'down' || detail.position === 'left' || detail.position === 'right') {
          setMultiChartPosition(detail.position);
        }
      } else if (action === 'set_chart_linking') {
        setLinked(Boolean(detail.enabled));
      }
    };
    window.addEventListener('sire:agent-chart-action', onAgentChartAction);
    return () => window.removeEventListener('sire:agent-chart-action', onAgentChartAction);
  }, [instruments, selected?.symbol]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? instruments.filter(item => `${item.name} ${item.symbol}`.toLowerCase().includes(q))
      : instruments;
  }, [instruments, search]);

  const selectInstrument = (item: Instrument) => {
    setSelected(item);
    setSearch('');
    setChartSymbols(current => current.length
      ? current.map((value, index) => index === 0 ? item.symbol : value)
      : [item.symbol]);
  };

  const openInstrumentPicker = (mode: 'main' | 'multi') => {
    setInstrumentSearchMode(mode);
    setSearch('');
    setInstrumentSearchOpen(true);
  };

  if (derivLoading) {
    return <SireErrorScreen
      source="SIRE startup"
      message="Waiting for Deriv market data and the active instrument catalogue. The interface is blocked until startup data is available."
    />;
  }

  if (derivError) {
    return <SireErrorScreen
      source="Deriv market-data startup"
      message={derivError}
    />;
  }


  if (!instruments.length || !selected) {
    return <SireErrorScreen
      source="SIRE startup validation"
      message="Deriv startup completed without a usable instrument catalogue or selected instrument."
    />;
  }

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
      <aside className="native-symbol-sidebar"><div className="sidebar-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" /></div><div className="sidebar-meta"><span>{derivLoading ? "LOADING DERIV" : derivError ? "DERIV ERROR" : "INSTRUMENTS"}</span><b>{instruments.length}</b></div>{derivError && <div className="sire-deriv-error">{derivError}</div>}<div className="native-symbol-list">{filtered.map(item => <button key={item.symbol} className={selected?.symbol === item.symbol ? 'active' : ''} onClick={() => selectInstrument(item)}><span><b>{item.name}</b><small>{item.symbol}</small></span><i>{item.exchangeOpen === 0 ? 'OFF' : 'LIVE'}</i></button>)}</div></aside>
      <section className="native-chart-panel">
        <div className={`sire-chart-grid sire-chart-grid--${chartLayout}${chartLayout === 2 ? ` sire-chart-grid--${multiChartPosition}` : ''}`} onContextMenu={event => event.preventDefault()}>
          {chartItems.map((chartSymbol, index) => <div className={`sire-chart-cell${activeChartIndex === index ? ' sire-chart-cell--active' : ''}`} key={index} onPointerDown={() => setActiveChartIndex(index)}>{chartSymbol && <FinancialChart
            symbol={chartSymbol}
            isActive={activeChartIndex === index}
            instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name, pipSize: item.pipSize }))}
            onInstrumentTap={() => openInstrumentPicker('main')}
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
            <div className="sire-multichart-field"><span>Chart linking</span><button type="button" className={`sire-multichart-link-toggle${linked ? ' active' : ''}`} onClick={() => setLinked(value => !value)} aria-pressed={linked}>{linked ? 'Link · On' : 'Link · Off'}</button></div><div className="sire-multichart-field"><span>Instrument</span><button type="button" className="sire-multichart-instrument-picker" onClick={() => openInstrumentPicker('multi')}><span>{instruments.find(item => item.symbol === multiChartInstrument)?.name || 'Select instrument'} · {multiChartInstrument || 'Choose'}</span><span aria-hidden="true">⌄</span></button></div>
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
              {filtered.map(item => <button key={item.symbol} type="button" onClick={() => { if (instrumentSearchMode === 'multi') { setMultiChartInstrument(item.symbol); setSearch(''); setInstrumentSearchOpen(false); } else { selectInstrument(item); setInstrumentSearchOpen(false); } }}>
                <span><b>{item.name}</b><small>{item.symbol}</small></span><i>{item.exchangeOpen === 0 ? 'OFF' : 'LIVE'}</i>
              </button>)}
            </div>
          </div>
        </div>}      </section>
    </div>
    {researchLabOpen && <ResearchLab symbol={chartSymbols[activeChartIndex] || selected?.symbol || ''} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onClose={() => setResearchLabOpen(false)} onSelectInstrument={symbol => { const item = instruments.find(candidate => candidate.symbol === symbol); if (item) selectInstrument(item); }} />}
  </main>;
}
