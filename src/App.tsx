import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createLinkGroup, type LinkGroup } from 'openalgo-charts';
import { Search, SlidersHorizontal, X, ChevronDown } from 'lucide-react';
import ResearchLab from './ResearchLab';
import HomeView from './HomeView';
import FinancialChart from './FinancialChart';
import { fetchDerivInstruments, type DerivInstrument } from './derivMarketData';
import { fetchBinanceInstruments, fetchBinancePriceSnapshot, subscribeBinanceTick, type BinanceInstrument } from './binanceMarketData';
import { SireErrorScreen } from './SireErrorBoundary';
import './nativeTerminal.css';
import { MarketInstrumentCard } from './marketCardDesigns';

type MarketProvider = 'DERIV' | 'BINANCE';
export type Instrument = Partial<DerivInstrument> & Partial<BinanceInstrument> & {
  id: string;
  provider: MarketProvider;
  providerLabel: string;
  exchange?: string;
  marketType: string;
  category: string;
  displaySymbol: string;
  price?: number;
  bid?: number;
  ask?: number;
  logoUrl: string;
  providerLogoUrl: string;
  change24h?: number;
  priceChangePercent?: number;
  volume24h?: number;
  tradeCount24h?: number;
  listedAt?: number;
  onboardDate?: number;
  circulatingSupply?: number;
  marketCap?: number;
  newListing?: boolean;
  change7d?: number;
  priceChange7d?: number;
  high24h?: number;
  low24h?: number;
  open24h?: number;
  marketCap?: number;
  fdv?: number;
  openInterest?: number;
  fundingRate?: number;
  nextFundingTime?: number;
  markPrice?: number;
  indexPrice?: number;
  impliedVolatility?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
  peRatio?: number;
  dividendYield?: number;
  aum?: number;
  nav?: number;
  premiumDiscount?: number;
  expenseRatio?: number;
  yield?: number;
  ytm?: number;
  ytw?: number;
  ytc?: number;
  couponRate?: number;
  maturity?: string | number;
  creditRating?: string;
  leverage?: number;
  liquidity?: number;
  holders?: number;
  apr?: number;
  fees24h?: number;
  volume1d?: number;
  volume30d?: number;
  probability?: number;
  dailyVolume?: number;
  beta?: number;
  volatility?: number;
};

const makeLogoFallback = (label: string) => {
  const text = String(label || '?').slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><circle cx="64" cy="64" r="62" fill="#20242b"/><text x="64" y="69" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="42" font-weight="900" fill="#fff">${text}</text></svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
};

const makeAssetLogoFallback = (item: Instrument) => makeLogoFallback(item.displaySymbol || item.symbol);

const MARKET_TOP_GROUPS = ['CRYPTO', 'TRADE FI', 'ALPHA'] as const;
const BINANCE_TOP_GROUPS = MARKET_TOP_GROUPS;

const MARKET_SUBGROUPS: Record<string, readonly string[]> = {
  CRYPTO: ['Spot', 'Futures'],
  'TRADE FI': ['Stocks', 'Futures', 'Spot'],
};

const MARKET_SUBSUBGROUPS: Record<string, readonly string[]> = {
  'CRYPTO::Spot': ['ALL', 'USDT', 'USDC', 'U', 'USD', 'BNB', 'BTC', 'FIAT', 'BTCC', 'ETH', 'ALTs'],
  'CRYPTO::Futures': ['USDT-M', 'COIN-M', 'Margin'],
  'TRADE FI::Stocks': ['U.S. stock', 'ETFs'],
  'TRADE FI::Futures': ['Commodities', 'ETFs', 'Stocks', 'Fx', 'Pre-IPO'],
  'TRADE FI::Spot': ['bStocks', 'tCommodities'],
  'ALPHA::Alpha': ['Point+', 'Tokenized Securities', 'BSC', 'Robinhood', 'Ethereum', 'Solana', 'Base', 'Arbitrum', 'Sonic', 'Sui', 'TRON'],
};

const MARKET_LEAF_FILTERS: Record<string, readonly string[]> = {
  'CRYPTO::Futures::USDT-M': ['All', 'New', 'Crypto', 'DeFi', 'Metavers', 'Payment', 'PoW', 'Storage', 'NFT', 'TradFi', 'Index', 'Pre-IPO', 'USDC', 'Chinese', 'Alpha', 'AI', 'Layer-1', 'RWA', 'Layer-2', 'Gaming', 'Meme', 'Infrastructure'],
  'CRYPTO::Futures::COIN-M': ['All', 'PoW', 'Storage', 'Layer-1', 'Layer-2', 'Meme', 'Infrastructure', 'Payment'],
  'CRYPTO::Futures::Margin': ['ETH', 'XAU', 'BTC', 'XAG', 'SOL', 'XRP', 'DOGE'],
};

const visibleMarketTopGroups = (_provider: 'ALL' | MarketProvider) => MARKET_TOP_GROUPS;
const sourceDisplayName = (value: string) => value === 'DERIV' ? 'Deriv' : value === 'BINANCE' ? 'Binance' : value;
const sourceLogoUrl = (value: string) => value === 'BINANCE' ? 'https://www.binance.com/favicon.ico' : 'https://deriv.com/favicon.ico';

const normalizeMarketLabel = (value: unknown) =>
  String(value || '').trim().toLowerCase().replace(/[\\s_-]+/g, ' ');

const hasMarketValue = (item: Instrument, target: string) => {
  const needle = normalizeMarketLabel(target);
  const values = [
    (item as any).marketGroup,
    (item as any).marketType,
    (item as any).category,
    (item as any).marketSubcategory,
    (item as any).marketSubSubcategory,
    (item as any).marketFilter,
    (item as any).instrumentType,
    (item as any).instrumentSubtype,
    (item as any).settlement,
    (item as any).quote,
    (item as any).baseAsset,
    ...(Array.isArray((item as any).marketFilters) ? (item as any).marketFilters : []),
  ].map(normalizeMarketLabel).filter(Boolean);
  return values.some(value => value === needle || value.includes(needle) || needle.includes(value));
};

const matchesMarketTopGroup = (item: Instrument, group: string) => {
  const marketGroup = normalizeMarketLabel((item as any).marketGroup);
  const category = normalizeMarketLabel(item.category);
  const instrumentType = normalizeMarketLabel((item as any).instrumentType);
  if (group === 'CRYPTO') return marketGroup === 'crypto' || category === 'crypto' || instrumentType.includes('crypto') || item.provider === 'BINANCE' && marketGroup === 'alpha';
  if (group === 'TRADE FI') return marketGroup === 'tradfi' || marketGroup === 'trade fi' || category === 'tradfi' || category === 'stocks' || category === 'forex' || category === 'commodities';
  if (group === 'ALPHA') return category === 'alpha' || marketGroup === 'alpha' || instrumentType === 'alpha';
  return false;
};

const matchesMarketSubgroup = (item: Instrument, group: string, subgroup: string) => {
  const target = normalizeMarketLabel(subgroup);
  if (group === 'CRYPTO' && subgroup === 'Spot') return normalizeMarketLabel(item.marketType) === 'spot';
  if (group === 'CRYPTO' && subgroup === 'Futures') return normalizeMarketLabel(item.marketType) === 'futures';
  if (group === 'TRADE FI' && subgroup === 'Stocks') return normalizeMarketLabel((item as any).marketType) === 'stocks' || normalizeMarketLabel(item.category) === 'stocks';
  if (group === 'TRADE FI' && subgroup === 'Futures') return normalizeMarketLabel((item as any).marketType) === 'futures' && matchesMarketTopGroup(item, 'TRADE FI');
  if (group === 'TRADE FI' && subgroup === 'Spot') return normalizeMarketLabel((item as any).marketType) === 'spot' && matchesMarketTopGroup(item, 'TRADE FI');
  return hasMarketValue(item, target);
};

const matchesMarketSubSubgroup = (item: Instrument, group: string, subgroup: string, subSubgroup: string) => {
  const target = normalizeMarketLabel(subSubgroup);
  if (target === 'all') return true;
  if (group === 'CRYPTO' && subgroup === 'Spot') {
    const quote = normalizeMarketLabel((item as any).quote);
    if (['usdt','usdc','u','usd','bnb','btc','btcc','eth'].includes(target)) return quote === target;
    if (target === 'fiat') return ['eur','gbp','aud','brl','try','rub','zar','ngn','jpy','pln','ron','uah'].includes(quote);
    if (target === 'alts') return quote === 'alts';
    return false;
  }
  if (group === 'CRYPTO' && subgroup === 'Futures') {
    return normalizeMarketLabel((item as any).marketSubcategory) === target ||
      normalizeMarketLabel((item as any).settlement) === target ||
      (target === 'margin' && Boolean((item as any).margin));
  }
  if (group === 'TRADE FI') return hasMarketValue(item, target);
  if (group === 'ALPHA') return hasMarketValue(item, target);
  return hasMarketValue(item, target);
};

const matchesMarketLeaf = (item: Instrument, group: string, subgroup: string, subSubgroup: string, leaf: string) => {
  const target = normalizeMarketLabel(leaf);
  if (target === 'all') return true;
  const filters = Array.isArray((item as any).marketFilters) ? (item as any).marketFilters : [];
  const values = [
    ...filters,
    (item as any).marketSubSubcategory,
    (item as any).instrumentSubtype,
    (item as any).marketFilter,
    (item as any).category,
    (item as any).marketType,
  ].map(normalizeMarketLabel);
  if (target === 'new') return Boolean((item as any).newListing);
  if (subSubgroup === 'Margin') {
    const base = normalizeMarketLabel((item as any).baseAsset);
    return base === target || values.some(value => value === target);
  }
  return values.some(value => value === target || value.includes(target) || target.includes(value));
};

const makeProviderLogoFallback = (_item: Instrument) => 'https://deriv.com/favicon.ico';

const chooseInitialMarketInstrument = (items: Instrument[]) =>
  items.find(item => item.provider === 'BINANCE' && item.symbol === 'BTCUSDT') ||
  items.find(item => item.provider === 'BINANCE' && item.marketType === 'Spot') ||
  items.find(item => item.provider === 'DERIV' && item.exchangeOpen !== 0 && item.tradingSuspended !== 1) ||
  items[0] || null;

export default function App() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [derivLoading, setDerivLoading] = useState(true);
  const [derivError, setDerivError] = useState('');
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<'ALL' | MarketProvider>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [marketSubcategoryFilter, setMarketSubcategoryFilter] = useState<string>('ALL');
  const [marketSubSubcategoryFilter, setMarketSubSubcategoryFilter] = useState<string>('ALL');
  const [marketLeafFilter, setMarketLeafFilter] = useState<string>('ALL');
  const [exchangeDrawerOpen, setExchangeDrawerOpen] = useState(false);
  const [quoteScrollTop, setQuoteScrollTop] = useState(0);
  const deferredSearch = useDeferredValue(search);
  const [instrumentSearchOpen, setInstrumentSearchOpen] = useState(false);
  const [instrumentSearchMode, setInstrumentSearchMode] = useState<'main' | 'multi'>('main');
  const [researchLabOpen, setResearchLabOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false);
  const [chartLayout, setChartLayout] = useState<1 | 2>(1);
  const [activeChartIndex, setActiveChartIndex] = useState(0);
  const [linked, setLinked] = useState(false);
  const [multiChartOpen, setMultiChartOpen] = useState(false);
  const [multiChartInstrument, setMultiChartInstrument] = useState('');
  const [multiChartPosition, setMultiChartPosition] = useState<'up' | 'down' | 'left' | 'right'>('right');
  const [chartSymbols, setChartSymbols] = useState<string[]>([]);
  const linkGroupRef = useRef<LinkGroup | null>(null);
  const catalogueShuffleSeedRef = useRef(0x51f15e1d);

  const liveInstruments = instruments;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [derivResult, binanceResult] = await Promise.allSettled([fetchDerivInstruments(), fetchBinanceInstruments()]);
      if (cancelled) return;
      const normalized: Instrument[] = [];
      if (derivResult.status === 'fulfilled') {
        normalized.push(...derivResult.value.map(item => ({
          ...item, id:'DERIV:'+item.symbol, provider:'DERIV' as MarketProvider, providerLabel:'Deriv',
          marketType:item.category === 'synthetic' ? 'Synthetic Indices' : item.category,
          category:item.category === 'synthetic' ? 'Synthetic Indices' : item.category,
          displaySymbol:item.name || item.symbol, logoUrl:makeLogoFallback(item.symbol),
          providerLogoUrl:'https://deriv.com/favicon.ico',
        })) as Instrument[]);
      }
      if (binanceResult.status === 'fulfilled') {
        normalized.push(...binanceResult.value.map(item => ({
          ...item, id:'BINANCE:'+item.marketType+':'+item.symbol, provider:'BINANCE' as MarketProvider,
          providerLabel:'Binance', displaySymbol:item.symbol, logoUrl:makeLogoFallback(item.baseAsset || item.symbol),
          providerLogoUrl:'https://www.binance.com/favicon.ico',
        })) as Instrument[]);
      }
      const unique = normalized.filter((item,index,all)=>item.id && all.findIndex(x=>x.id===item.id)===index);
      setInstruments(unique);
      const initial=chooseInitialMarketInstrument(unique);
      setSelected(initial);
      setChartSymbols(initial ? [initial.symbol] : []);
      if (!unique.length) {
        const errors = [derivResult,binanceResult].filter((x:any)=>x.status==='rejected').map((x:any)=>x.reason?.message || String(x.reason));
        setDerivError(errors.join(' | ') || 'No market instruments are currently available.');
      } else setDerivError('');
      setDerivLoading(false);
    };
    void load();
    return () => { cancelled=true; };
  }, []);
  useEffect(() => {
    let cancelled=false;
    void fetchBinancePriceSnapshot().then(ticks => {
      if(cancelled) return;
      const byKey=new Map(ticks.map(t=>[t.symbol,t]));
      setInstruments(current=>current.map(item=>{
        if(item.provider!=='BINANCE') return item;
        const tick=byKey.get(item.symbol);
        if(!tick) return item;
        return {...item,price:tick.price,change24h:tick.percent,priceChangePercent:tick.percent,high24h:tick.high,low24h:tick.low,volume24h:tick.volume};
      }));
    }).catch(()=>{});
    return()=>{cancelled=true;};
  }, []);
  useEffect(() => {
    const binance = instruments.filter(item=>item.provider==='BINANCE');
    if (!binance.length) return;
    const pending = new Map<string, any>();
    const unsubscribers = binance.map(item => subscribeBinanceTick(item, tick => {
      pending.set(item.id, tick);
    }));
    const timer = window.setInterval(() => {
      if (!pending.size) return;
      const updates = new Map(pending);
      pending.clear();
      setInstruments(current => current.map(item => {
        const tick=updates.get(item.id);
        if (!tick) return item;
        return {...item,price:tick.price,change24h:tick.percent,priceChangePercent:tick.percent,high24h:tick.high,low24h:tick.low,volume24h:tick.volume};
      }));
    }, 250);
    return () => { window.clearInterval(timer); unsubscribers.forEach(fn=>fn()); };
  }, [instruments.length, instruments.map(item=>item.provider==='BINANCE' ? item.id : '').filter(Boolean).join('|')]);

  useEffect(() => {
    if (!instruments.length) return;
    setChartSymbols(current => Array.from(
      { length: chartLayout },
      (_, index) => current[index] || (index === 0
        ? (selected?.provider === 'DERIV' ? selected.symbol : (chooseInitialMarketInstrument(instruments)?.symbol || chartableInstruments[0]?.symbol || instruments[0].symbol))
        : chartableInstruments[index % Math.max(1, chartableInstruments.length)]?.symbol || ''),
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
  }, [linked]);

  useEffect(() => () => { linkGroupRef.current?.destroy(); linkGroupRef.current = null; }, []);

  useEffect(() => {
    const openHome = () => setHomeOpen(true);
    const closeHome = () => setHomeOpen(false);
    window.addEventListener('sire:open-home', openHome);
    window.addEventListener('sire:close-home', closeHome);
    return () => {
      window.removeEventListener('sire:open-home', openHome);
      window.removeEventListener('sire:close-home', closeHome);
    };
  }, []);

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

  const randomizedInstruments = useMemo(() => {
    const seed = catalogueShuffleSeedRef.current >>> 0;
    const score = (id: string) => {
      let hash = (seed ^ 0x9e3779b9) >>> 0;
      for (let i = 0; i < id.length; i += 1) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 0x85ebca6b) >>> 0;
        hash ^= hash >>> 13;
      }
      hash = Math.imul(hash ^ (hash >>> 16), 0xc2b2ae35) >>> 0;
      return (hash ^ (hash >>> 16)) >>> 0;
    };
    return instruments
      .map((item, index) => ({ item, index, randomScore: score(item.id || (item.provider + ':' + item.symbol + ':' + index)) }))
      .sort((a, b) => a.randomScore - b.randomScore || a.index - b.index)
      .map(entry => entry.item);
  }, [liveInstruments]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return randomizedInstruments.filter(item => {
      const providerMatch = providerFilter === 'ALL' || item.provider === providerFilter;
      const topMatch = categoryFilter === 'ALL' || matchesMarketTopGroup(item, categoryFilter);
      const subgroupMatch = categoryFilter === 'ALL' || marketSubcategoryFilter === 'ALL' || matchesMarketSubgroup(item, categoryFilter, marketSubcategoryFilter);
      const subSubgroupMatch = categoryFilter === 'ALL' || marketSubcategoryFilter === 'ALL' || marketSubSubcategoryFilter === 'ALL'
        ? true
        : matchesMarketSubSubgroup(item, categoryFilter, marketSubcategoryFilter, marketSubSubcategoryFilter);
      const leafMatch = categoryFilter === 'ALL' || marketSubcategoryFilter === 'ALL' || marketSubSubcategoryFilter === 'ALL' || marketLeafFilter === 'ALL'
        ? true
        : matchesMarketLeaf(item, categoryFilter, marketSubcategoryFilter, marketSubSubcategoryFilter, marketLeafFilter);
      const searchMatch = !q || [item.name, item.symbol, item.providerLabel, item.marketType, item.category].map(value => String(value ?? '')).join(' ').toLowerCase().includes(q);
      return providerMatch && topMatch && subgroupMatch && subSubgroupMatch && leafMatch && searchMatch;
    });
  }, [randomizedInstruments, deferredSearch, providerFilter, categoryFilter, marketSubcategoryFilter, marketSubSubcategoryFilter, marketLeafFilter]);

  const chartableInstruments = useMemo(() => liveInstruments.filter(item => item.provider === 'DERIV' || item.provider === 'BINANCE'), [liveInstruments]);
  const quoteWindow = useMemo(() => {
    const rowHeight = 88;
    const buffer = 18;
    const start = Math.max(0, Math.floor(quoteScrollTop / rowHeight) - buffer);
    const end = Math.min(filtered.length, Math.ceil((quoteScrollTop + window.innerHeight) / rowHeight) + buffer);
    return { start, end, items: filtered.slice(start, end), top: start * rowHeight, bottom: Math.max(0, (filtered.length - end) * rowHeight) };
  }, [filtered, quoteScrollTop]);

  const selectInstrument = (item: Instrument) => {
    setSelected(item);
    setSearch('');
    if (chartableInstruments.some(candidate => candidate.id === item.id)) {
      setChartSymbols(current => current.length
        ? current.map((value, index) => index === 0 ? item.symbol : value)
        : [item.symbol]);
    }
  };

  const openInstrumentPicker = (mode: 'main' | 'multi') => {
    setInstrumentSearchMode(mode);
    setSearch('');
    setProviderFilter('ALL');
    setInstrumentSearchOpen(true);
  };

  if (!derivLoading && (!instruments.length || !selected)) {
    return <SireErrorScreen
      source="SIRE startup validation"
      message={derivError || "No market provider returned a usable instrument catalogue yet. Retrying startup."}
    />;
  }

  const chartItems = chartSymbols.slice(0, chartLayout);
  const openMultiChartManager = () => {
    setMultiChartInstrument(chartSymbols[1] || chartableInstruments[1]?.symbol || chartableInstruments[0]?.symbol || '');
    setMultiChartOpen(true);
  };
  const confirmMultiChart = () => {
    if (!multiChartInstrument) return;
    setChartSymbols(current => [current[0] || selected?.symbol || chartableInstruments[0]?.symbol || multiChartInstrument, multiChartInstrument]);
    setChartLayout(2);
    setMultiChartOpen(false);
  };
  const removeSelectedChart = () => {
    if (chartLayout !== 2) return;
    const selectedIndex = Math.min(activeChartIndex, 1);
    const remainingSymbol = chartSymbols[selectedIndex === 0 ? 1 : 0] || selected?.symbol || chartableInstruments[0]?.symbol || '';
    setChartSymbols([remainingSymbol]);
    setChartLayout(1);
    setActiveChartIndex(0);
    setSelected(chartableInstruments.find(item => item.symbol === remainingSymbol) || selected);
    setMultiChartOpen(false);
  };
  const makeSecondMainChart = () => {
    if (!chartSymbols[1]) return;
    setChartSymbols(current => [current[1], current[0] || current[1]]);
    setActiveChartIndex(0);
    setSelected(chartableInstruments.find(item => item.symbol === chartSymbols[1]) || selected);
    setMultiChartOpen(false);
  };
  if (homeOpen) {
    return <HomeView instruments={liveInstruments} onSelectInstrument={item => { const match = liveInstruments.find(candidate => candidate.id === item.id); if (match) selectInstrument(match); }} />;
  }

  return <main className={`native-terminal-shell${researchLabOpen ? ' sire-research-open' : ''}`}>

    <div className="native-terminal-body">
      <aside className="native-symbol-sidebar symbol-sidebar"><div className="sidebar-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" /></div><div className="sidebar-meta"><span>{derivLoading ? "LOADING MARKETS" : derivError ? "MARKET ERROR" : "ALL MARKETS"}</span><b>{instruments.length}</b></div>
        <div className="sire-market-filter-head">
          <div className="sire-market-filter-title">
            <span>MARKET FILTERS</span>
            <small>{providerFilter === 'ALL' ? 'All markets' : sourceDisplayName(providerFilter)}</small>
          </div>
          <button
            type="button"
            className={`sire-market-exchange-trigger${providerFilter !== 'ALL' ? ' active' : ''}`}
            aria-expanded={exchangeDrawerOpen}
            onClick={() => setExchangeDrawerOpen(true)}
          >
            <SlidersHorizontal size={14} />
            <span>Sources</span>
            {providerFilter !== 'ALL' && <em>1</em>}
            <ChevronDown size={13} />
          </button>
        </div>

        <div className="sire-market-filter-stack">
          <div className="sire-market-top-groups" role="tablist" aria-label="Market groups">
            {visibleMarketTopGroups(providerFilter).map(group => (
              <button
                key={group}
                type="button"
                role="tab"
                aria-selected={categoryFilter === group}
                className={categoryFilter === group ? 'active' : ''}
                onClick={() => {
                  setCategoryFilter(group);
                  setMarketSubcategoryFilter('ALL');
                  setMarketSubSubcategoryFilter('ALL');
                          setMarketLeafFilter('ALL');
                          setMarketLeafFilter('ALL');
                  setMarketLeafFilter('ALL');
                }}
              >
                <span>{group}</span>
                <i aria-hidden="true" />
              </button>
            ))}
          </div>

          {Boolean(MARKET_SUBGROUPS[categoryFilter]) && (
            <div className="sire-market-subgroups" role="tablist" aria-label={categoryFilter + ' subcategories'}>
              {(MARKET_SUBGROUPS[categoryFilter] || []).map(subgroup => (
                <button
                  key={subgroup}
                  type="button"
                  role="tab"
                  aria-selected={marketSubcategoryFilter === subgroup}
                  className={marketSubcategoryFilter === subgroup ? 'active' : ''}
                  onClick={() => {
                    setMarketSubcategoryFilter(subgroup);
                    setMarketSubSubcategoryFilter('ALL');
                    setMarketLeafFilter('ALL');
                  }}
                >
                  {subgroup}
                </button>
              ))}
            </div>
          )}

          {Boolean(MARKET_SUBGROUPS[categoryFilter]) &&
            marketSubcategoryFilter !== 'ALL' &&
            (MARKET_SUBSUBGROUPS[categoryFilter + '::' + marketSubcategoryFilter] || []).length > 0 && (
              <div className="sire-market-subsubgroups" role="tablist" aria-label={marketSubcategoryFilter + ' filters'}>
                {(MARKET_SUBSUBGROUPS[categoryFilter + '::' + marketSubcategoryFilter] || []).map(subSubgroup => (
                  <button
                    key={subSubgroup}
                    type="button"
                    role="tab"
                    aria-selected={marketSubSubcategoryFilter === subSubgroup}
                    className={marketSubSubcategoryFilter === subSubgroup ? 'active' : ''}
                    onClick={() => setMarketSubSubcategoryFilter(subSubgroup)}
                  >
                    {subSubgroup}
                  </button>
                ))}
              </div>
            )}
          {categoryFilter === 'ALPHA' && (
            <div className="sire-market-subsubgroups" role="tablist" aria-label="Alpha filters">
              {(MARKET_SUBSUBGROUPS['ALPHA::Alpha'] || []).map(filter => (
                <button key={filter} type="button" role="tab" aria-selected={marketSubSubcategoryFilter === filter}
                  className={marketSubSubcategoryFilter === filter ? 'active' : ''}
                  onClick={() => { setMarketSubcategoryFilter('Alpha'); setMarketSubSubcategoryFilter(filter); setMarketLeafFilter('ALL'); }}>
                  {filter}
                </button>
              ))}
            </div>
          )}
          {categoryFilter === 'CRYPTO' && marketSubcategoryFilter === 'Futures' && marketSubSubcategoryFilter !== 'ALL' &&
            (MARKET_LEAF_FILTERS['CRYPTO::Futures::' + marketSubSubcategoryFilter] || []).length > 0 && (
            <div className="sire-market-subsubgroups" role="tablist" aria-label={marketSubSubcategoryFilter + ' filters'}>
              {(MARKET_LEAF_FILTERS['CRYPTO::Futures::' + marketSubSubcategoryFilter] || []).map(filter => (
                <button key={filter} type="button" role="tab" aria-selected={marketLeafFilter === filter}
                  className={marketLeafFilter === filter ? 'active' : ''}
                  onClick={() => setMarketLeafFilter(filter)}>
                  {filter}
                </button>
              ))}
            </div>
          )}
        </div>

        {exchangeDrawerOpen && (
          <div className="sire-exchange-drawer-backdrop" role="presentation" onClick={() => setExchangeDrawerOpen(false)}>
            <section className="sire-exchange-drawer" role="dialog" aria-modal="true" aria-label="Select market source" onClick={event => event.stopPropagation()}>
              <div className="sire-exchange-drawer-head">
                <div>
                  <span>MARKET VENUES</span>
                  <strong>Select market source</strong>
                  <small>Choose a venue without leaving the market view.</small>
                </div>
                <button type="button" className="sire-exchange-drawer-close" aria-label="Close exchange drawer" onClick={() => setExchangeDrawerOpen(false)}>
                  <X size={17} />
                </button>
              </div>

              <div className="sire-exchange-drawer-search">
                <Search size={14} />
                <input
                  aria-label="Search market sources"
                  placeholder="Search market sources"
                  onChange={event => {
                    const query = event.target.value.trim().toLowerCase();
                    document.querySelectorAll<HTMLElement>('.sire-exchange-option').forEach(option => {
                      option.style.display = !query || option.dataset.exchangeName?.includes(query) ? '' : 'none';
                    });
                  }}
                />
              </div>

              <div className="sire-exchange-grid">
                {MARKET_SOURCES.map(provider => {
                  const label = sourceDisplayName(provider);
                  return (
                    <button
                      key={provider}
                      type="button"
                      data-exchange-name={label.toLowerCase()}
                      className={`sire-exchange-option${providerFilter === provider ? ' active' : ''}`}
                      onClick={() => {
                        setProviderFilter(provider);
                        if (provider === 'BINANCE') {
                          setCategoryFilter('CRYPTO');
                          setMarketSubcategoryFilter('Spot');
                          setMarketSubSubcategoryFilter('ALL');
                          setMarketLeafFilter('ALL');
                        } else if (provider === 'DERIV') {
                          setCategoryFilter('OTHERS');
                          setMarketSubcategoryFilter('Synthetic Indices');
                          setMarketSubSubcategoryFilter('ALL');
                        } else {
                          setCategoryFilter('ALL');
                          setMarketSubcategoryFilter('ALL');
                          setMarketSubSubcategoryFilter('ALL');
                          setMarketLeafFilter('ALL');
                        }
                        setExchangeDrawerOpen(false);
                      }}
                    >
                      <span className="sire-exchange-option-logo">
                        <img
                          src={provider === 'ALL' ? '/sire-logo.svg' : sourceLogoUrl(provider)}
                          alt=""
                          loading="lazy"
                          onError={event => {
                            const image = event.currentTarget;
                            image.onerror = null;
                            image.src = makeLogoFallback(label);
                          }}
                        />
                      </span>
                      <span className="sire-exchange-option-copy">
                        <b>{label}</b>
                        <small>{provider === 'ALL' ? 'Combined market' : 'Market venue'}</small>
                      </span>
                      {providerFilter === provider && <span className="sire-exchange-option-check">✓</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

{derivError && <div className="sire-deriv-error">{derivError}</div>}<div className="native-symbol-list symbol-list" onScroll={event => setQuoteScrollTop(event.currentTarget.scrollTop)}><div style={{height: quoteWindow.top}} aria-hidden="true" /><div className="sire-quote-window">{quoteWindow.items.map(item => <MarketInstrumentCard key={item.id} item={item} active={selected?.id === item.id} onSelect={selectInstrument} group={categoryFilter} subgroup={marketSubcategoryFilter} subSubgroup={marketSubSubcategoryFilter} />)}</div><div style={{height: quoteWindow.bottom}} aria-hidden="true" /></div></aside>
      <section className="native-chart-panel">
        <div className={`sire-chart-grid sire-chart-grid--${chartLayout}${chartLayout === 2 ? ` sire-chart-grid--${multiChartPosition}` : ''}`} onContextMenu={event => event.preventDefault()}>
          {chartItems.map((chartSymbol, index) => <div className={`sire-chart-cell${activeChartIndex === index ? ' sire-chart-cell--active' : ''}`} key={index} onPointerDown={() => setActiveChartIndex(index)}>{chartSymbol && <FinancialChart
            symbol={chartSymbol}
            isActive={activeChartIndex === index}
            instruments={chartableInstruments.map(item => ({ symbol: item.symbol, name: item.name, pipSize: item.pipSize, provider: item.provider, exchange: item.exchange, marketType: item.marketType, category: item.category }))}
            onInstrumentTap={() => openInstrumentPicker('main')}
            onSelectInstrument={item => {
              setChartSymbols(current => current.map((value, slot) => slot === index ? item.symbol : value));
              if (index === 0) setSelected(current => current?.symbol === item.symbol ? current : instruments.find(candidate => candidate.symbol === item.symbol && candidate.provider === item.provider) || current);
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
              {filtered.slice(0, 120).map(item => <button key={item.id} type="button" onClick={() => { if (instrumentSearchMode === 'multi') { setMultiChartInstrument(item.symbol); setSearch(''); setInstrumentSearchOpen(false); } else { selectInstrument(item); setInstrumentSearchOpen(false); } }}>
                <span className="quote-asset-logo-wrap"><img className="quote-asset-logo" src={item.logoUrl || makeAssetLogoFallback(item)} alt="" onError={event => { const image=event.currentTarget; image.onerror=null; image.src=makeLogoFallback(item.displaySymbol || item.symbol); }} /></span><span className="quote-instrument-name"><b>{String(item.displaySymbol || item.symbol).toUpperCase()}</b><small>{String(item.name || item.displaySymbol || item.symbol).toUpperCase()}</small></span><span className="quote-broker"><span className="quote-provider-logo-wrap"><img className="quote-provider-logo" src={makeProviderLogoFallback(item)} alt="" onError={event => { const image = event.currentTarget; image.onerror = null; image.src = makeLogoFallback(item.providerLabel || item.provider); }} /></span><b>{String(item.providerLabel || item.provider).toUpperCase()}</b><small>{String(item.marketType || item.category || 'Market')}</small></span>
              </button>)}
            </div>
          </div>
        </div>}      </section>
    </div>
    {researchLabOpen && <ResearchLab symbol={chartSymbols[activeChartIndex] || selected?.symbol || ''} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onClose={() => setResearchLabOpen(false)} onSelectInstrument={symbol => { const item = instruments.find(candidate => candidate.symbol === symbol); if (item) selectInstrument(item); }} />}
  </main>;
}