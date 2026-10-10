import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createLinkGroup, type LinkGroup } from 'openalgo-charts';
import { Search, SlidersHorizontal, X, ChevronDown } from 'lucide-react';
import ResearchLab from './ResearchLab';
import HomeView from './HomeView';
import FinancialChart from './FinancialChart';
import { fetchDerivInstruments, type DerivInstrument } from './derivMarketData';
import { type BitgetInstrument } from './bitgetMarketData';
import { SireErrorScreen } from './SireErrorBoundary';
import './nativeTerminal.css';
import { MarketInstrumentCard } from './marketCardDesigns';
import TradeView from './TradeView';
import SireWalletPanel from './SireWalletPanel';
import './sireWalletPanel.css';

type MarketProvider = 'DERIV' | 'BITGET';
type AppTab = 'home' | 'market' | 'trade' | 'discover' | 'portfolio';
export type Instrument = Partial<DerivInstrument> & Partial<BitgetInstrument> & {
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
  quoteVolume?: number;
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
  assetId?: string;
  assetLogoUrl?: string;
  chain?: string;
  chainName?: string;
  chainSymbol?: string;
  chainId?: string;
  chainLogoUrl?: string;
  contractAddress?: string;
  metadataSource?: string;
};

const makeLogoFallback = (label: string) => {
  const text = String(label || '?').slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><circle cx="64" cy="64" r="62" fill="#20242b"/><text x="64" y="69" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="42" font-weight="900" fill="#fff">${text}</text></svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
};

const makeAssetLogoFallback = (item: Instrument) => makeLogoFallback(item.displaySymbol || item.symbol);

const MARKET_TOP_GROUPS = ['CRYPTO'] as const;
const MARKET_SOURCES: readonly MarketProvider[] = ['BITGET'];

const MARKET_SUBGROUPS: Record<string, readonly string[]> = { CRYPTO: ['Spot', 'Futures', 'Margin'] };

const MARKET_SUBSUBGROUPS: Record<string, readonly string[]> = {
  'CRYPTO::Spot': ['ALL', 'New', 'Key Assets', 'Pre-IPO', 'Stocks', 'ETF', 'Metals', '0 fee', 'Stablecoin', 'AI', 'Meme', 'Solana ecosystem', 'RWA', 'GameFi', 'DeFi', 'NFT', 'Payment', 'DePIN'],
  'CRYPTO::Futures': ['ALL', 'New', 'Key Assets', 'Pre-IPO', 'Stocks', 'ETF', 'Metals', 'Commodity', 'US Preferred Stocks', 'Stablecoin', 'AI', 'Meme', 'Solana ecosystem', 'GameFi', 'DeFi', 'NFT', 'Payment', 'DePIN', 'Pre-market'],
  'CRYPTO::Margin': ['Key Asset', 'Stablecoin', 'AI', 'Meme', 'Solana ecosystem', 'RWA', 'GameFi', 'DeFi', 'NFT', 'Payment', 'DePIN'],
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
const sourceDisplayName = (value: string) => value === 'DERIV' ? 'Deriv' : value === 'BITGET' ? 'Bitget' : value;
const sourceLogoUrl = (value: string) => value === 'BITGET' ? 'https://www.bitget.com/favicon.ico' : 'https://deriv.com/favicon.ico';

const normalizeMarketLabel = (value: unknown) =>
  String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');

const quoteBucketForFilter = (quote: unknown) => { const q = String(quote || '').toUpperCase(); if (['EUR','GBP','AUD','BRL','TRY','RUB','ZAR','NGN','JPY','PLN','RON','UAH','CHF','CAD','HKD','SGD','MXN','ARS'].includes(q)) return 'fiat'; if (['USDT','USDC','U','USD','BNB','BTC','BTCC','ETH'].includes(q)) return q.toLowerCase(); return 'alts'; };

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

const isBitget = (item: Instrument) => item.provider === 'BITGET';

const matchesMarketTopGroup = (item: Instrument, group: string) => {
  const marketGroup = normalizeMarketLabel((item as any).marketGroup);
  const category = normalizeMarketLabel(item.category);
  const instrumentType = normalizeMarketLabel((item as any).instrumentType);
  if (group === 'CRYPTO') return isBitget(item)
    ? marketGroup === 'crypto'
    : (marketGroup === 'crypto' || category === 'crypto' || instrumentType.includes('crypto'));
  if (group === 'TRADE FI') return isBitget(item)
    ? marketGroup === 'tradfi' || marketGroup === 'trade fi'
    : (marketGroup === 'tradfi' || marketGroup === 'trade fi' || category === 'tradfi' || category === 'stocks' || category === 'forex' || category === 'commodities');
  if (group === 'ALPHA') return category === 'alpha' || marketGroup === 'alpha' || instrumentType === 'alpha';
  return false;
};

const matchesMarketSubgroup = (item: Instrument, group: string, subgroup: string) => {
  const target = normalizeMarketLabel(subgroup);
  if (group === 'CRYPTO' && subgroup === 'Spot') {
    return matchesMarketTopGroup(item, 'CRYPTO') &&
      normalizeMarketLabel(item.marketType) === 'spot';
  }
  if (group === 'CRYPTO' && subgroup === 'Futures') {
    return matchesMarketTopGroup(item, 'CRYPTO') &&
      normalizeMarketLabel(item.marketType) === 'futures';
  }
  if (group === 'CRYPTO' && subgroup === 'Margin') {
    return matchesMarketTopGroup(item, 'CRYPTO') && normalizeMarketLabel(item.marketType) === 'margin';
  }
  if (group === 'TRADE FI' && subgroup === 'Stocks') {
    return matchesMarketTopGroup(item, 'TRADE FI') &&
      normalizeMarketLabel(item.marketType) === 'stocks';
  }
  if (group === 'TRADE FI' && subgroup === 'Futures') {
    return matchesMarketTopGroup(item, 'TRADE FI') &&
      normalizeMarketLabel(item.marketType) === 'futures';
  }
  if (group === 'TRADE FI' && subgroup === 'Spot') {
    return matchesMarketTopGroup(item, 'TRADE FI') &&
      normalizeMarketLabel(item.marketType) === 'spot';
  }
  return matchesMarketTopGroup(item, group) && hasMarketValue(item, target);
};

const matchesMarketSubSubgroup = (item: Instrument, group: string, subgroup: string, subSubgroup: string) => {
  const target = normalizeMarketLabel(subSubgroup);
  if (target === 'all') return true;
  if (group === 'CRYPTO' && subgroup === 'Spot') {
    const symbolType = normalizeMarketLabel((item as any).symbolType);
    const values = (Array.isArray((item as any).marketFilters) ? (item as any).marketFilters : []).map(normalizeMarketLabel);
    if (target === 'new') return Boolean((item as any).newListing);
    if (target === 'stocks') return symbolType === 'stock' || Boolean((item as any).isReality);
    if (target === 'etf') return values.includes('etf');
    if (target === 'metals') return symbolType === 'metal';
    if (target === 'pre ipo') return values.includes('pre ipo') || Boolean((item as any).preIpo);
    if (target === '0 fee') return Boolean((item as any).zeroFee);
    if (target === 'stablecoin') return Boolean((item as any).stablecoin);
    return values.some(value => value === target || value.includes(target));
  }
  if (group === 'CRYPTO' && subgroup === 'Futures') {
    if (item.provider === 'BITGET') {
      const values = (Array.isArray((item as any).marketFilters) ? (item as any).marketFilters : []).map(normalizeMarketLabel);
      const symbolType = normalizeMarketLabel((item as any).symbolType);
      if (target === 'pre market') return Boolean((item as any).preMarket);
      if (target === 'stocks' || target === 'us preferred stocks') return symbolType === 'stock';
      if (target === 'etf') return values.includes('etf');
      if (target === 'metals') return symbolType === 'metal';
      if (target === 'commodity') return symbolType === 'commodity';
      if (target === 'new') return Boolean((item as any).newListing);
      if (target === 'pre ipo') return values.includes('pre ipo') || Boolean((item as any).preIpo);
      if (target === 'stablecoin') return Boolean((item as any).stablecoin);
      return values.some(value => value === target || value.includes(target));
    }
    return false;
  }
  if (group === 'CRYPTO' && subgroup === 'Margin') {
    const values = (Array.isArray((item as any).marketFilters) ? (item as any).marketFilters : []).map(normalizeMarketLabel);
    return values.some(value => value === target || value.includes(target));
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

const loadBitgetCatalog = async (reason: string): Promise<BitgetInstrument[]> => {
  const url = '/api/sire/bitget/catalog?source=' + encodeURIComponent(reason) + '&t=' + Date.now();
  console.info('[SIRE BITGET] catalog request starting', { reason, url });
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  const instruments = Array.isArray(payload?.instruments) ? payload.instruments as BitgetInstrument[] : [];
  console.info('[SIRE BITGET] catalog response', {
    reason,
    ok: response.ok && payload?.ok === true,
    status: response.status,
    count: instruments.length,
    source: payload?.source,
    diagnostics: payload?.diagnostics,
  });
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Bitget native catalog is unavailable.');
  }
  if (!instruments.length) {
    throw new Error('Bitget native catalog returned zero instruments.');
  }
  return instruments;
};

const chooseInitialMarketInstrument = (items: Instrument[]) =>
  items.find(item => item.provider === 'BITGET' && item.symbol === 'BTCUSDT') ||
  items.find(item => item.provider === 'BITGET' && item.marketType === 'Spot') ||
  items.find(item => item.provider === 'DERIV' && item.exchangeOpen !== 0 && item.tradingSuspended !== 1) ||
  items[0] || null;

export default function App() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [derivLoading, setDerivLoading] = useState(true);
  const [derivError, setDerivError] = useState('');
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<'ALL' | MarketProvider>('BITGET');
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
  const [homeOpen, setHomeOpen] = useState(true);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [spotReturnToTrade, setSpotReturnToTrade] = useState(false);
  const [chartLayout, setChartLayout] = useState<1 | 2>(1);
  const [activeChartIndex, setActiveChartIndex] = useState(0);
  const [linked, setLinked] = useState(false);
  const [multiChartOpen, setMultiChartOpen] = useState(false);
  const [multiChartInstrument, setMultiChartInstrument] = useState('');
  const [multiChartPosition, setMultiChartPosition] = useState<'up' | 'down' | 'left' | 'right'>('right');
  const [chartSymbols, setChartSymbols] = useState<string[]>([]);
  const linkGroupRef = useRef<LinkGroup | null>(null);
  const catalogueShuffleSeedRef = useRef(0x51f15e1d);
  const bitgetMarketSocketRef = useRef<WebSocket | null>(null);
  const bitgetMarketDesiredRef = useRef<Set<string>>(new Set());

  const liveInstruments = instruments;

  useEffect(() => {
    const consumeSpotReturn = () => setSpotReturnToTrade(false);
    window.addEventListener('sire:spot-return-consumed', consumeSpotReturn);
    return () => window.removeEventListener('sire:spot-return-consumed', consumeSpotReturn);
  }, []);

  useEffect(() => {
    const openSpotMarketPicker = () => {
      setTradeOpen(false);
      setActiveTab('market');
      setSpotReturnToTrade(true);
      window.dispatchEvent(new CustomEvent('sire:navigate-tab', { detail: { tab: 'market' } }));
      setProviderFilter('BITGET');
      setCategoryFilter('CRYPTO');
      setMarketSubcategoryFilter('Spot');
      setMarketSubSubcategoryFilter('ALL');
      setMarketLeafFilter('ALL');
      setSearch('');
    };
    window.addEventListener('sire:open-market-for-spot', openSpotMarketPicker);
    return () => window.removeEventListener('sire:open-market-for-spot', openSpotMarketPicker);
  }, []);

  useEffect(() => {
    const openTrade = () => setTradeOpen(true);
    window.addEventListener('sire:open-trade', openTrade);
    return () => window.removeEventListener('sire:open-trade', openTrade);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const applyBitget = (items: BitgetInstrument[]) => {
      if (cancelled) return;
      const normalized = items.map(item => ({
        ...item,
        id:'BITGET:'+item.marketType+':'+item.symbol,
        provider:'BITGET' as MarketProvider,
        providerLabel:'Bitget',
        displaySymbol:item.symbol,
        logoUrl:item.logoUrl || makeLogoFallback(item.baseAsset || item.symbol),
        providerLogoUrl:item.providerLogoUrl || 'https://www.bitget.com/favicon.ico',
      })) as Instrument[];
      setInstruments(current => {
        const deriv = current.filter(item => item.provider !== 'BITGET');
        return [...deriv, ...normalized].filter((item,index,all) => item.id && all.findIndex(x=>x.id===item.id)===index);
      });
      setSelected(current => current && current.provider === 'BITGET' ? current : chooseInitialMarketInstrument(normalized));
      setChartSymbols(current => current.length ? current : [chooseInitialMarketInstrument(normalized)?.symbol || '']);
      setDerivError('');
      setDerivLoading(false);
    };

    const loadBitget = async () => {
      try {
        const items = await loadBitgetCatalog('startup');
        applyBitget(items);
      } catch (error) {
        if (cancelled) return;
        console.error('[SIRE BITGET] startup catalogue failed', error);
        setDerivError(error instanceof Error ? error.message : String(error));
        setDerivLoading(false);
      }
    };

    const loadDeriv = async () => {
      try {
        const items = await fetchDerivInstruments();
        if (cancelled) return;
        const deriv = items.map(item => ({
          ...item, id:'DERIV:'+item.symbol, provider:'DERIV' as MarketProvider, providerLabel:'Deriv',
          marketType:item.category === 'synthetic' ? 'Synthetic Indices' : item.category,
          category:item.category === 'synthetic' ? 'Synthetic Indices' : item.category,
          displaySymbol:item.name || item.symbol, logoUrl:makeLogoFallback(item.symbol),
          providerLogoUrl:'https://deriv.com/favicon.ico',
        })) as Instrument[];
        setInstruments(current => [...deriv, ...current.filter(item => item.provider !== 'DERIV')]);
      } catch (error) {
        console.warn('[SIRE DERIV] startup catalogue failed', error);
      }
    };

    void loadBitget();
    void loadDeriv();
    return () => { cancelled=true; };
  }, []);
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
    const onTabChanged = (event: Event) => {
      const tab = String((event as CustomEvent).detail?.tab || '');
      if (!['home', 'market', 'trade', 'discover', 'portfolio'].includes(tab)) return;
      const nextTab = tab as AppTab;
      setActiveTab(nextTab);
      setHomeOpen(nextTab === 'home');
      setTradeOpen(nextTab === 'trade');
      setResearchLabOpen(nextTab === 'discover');
    };
    window.addEventListener('sire:tab-changed', onTabChanged);
    return () => window.removeEventListener('sire:tab-changed', onTabChanged);
  }, []);

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

  const chartableInstruments = useMemo(() => liveInstruments.filter(item => item.provider === 'DERIV' || item.provider === 'BITGET'), [liveInstruments]);
  const bitgetLiveKey = (item: Instrument) => {
    if (item.provider !== 'BITGET') return null;
    const market = String(item.marketSubcategory || '').toUpperCase();
    const instType = item.marketType === 'Spot' || item.marketType === 'Margin' ? 'spot' : market === 'USDT-M' ? 'usdt-futures' : market === 'COIN-M' ? 'coin-futures' : market === 'USDC-M' ? 'usdc-futures' : null;
    return instType && item.symbol ? instType + ':' + String(item.symbol).toUpperCase() : null;
  };

  const quoteWindow = useMemo(() => {
    const rowHeight = 88;
    const buffer = 18;
    const start = Math.max(0, Math.floor(quoteScrollTop / rowHeight) - buffer);
    const end = Math.min(filtered.length, Math.ceil((quoteScrollTop + window.innerHeight) / rowHeight) + buffer);
    return { start, end, items: filtered.slice(start, end), top: start * rowHeight, bottom: Math.max(0, (filtered.length - end) * rowHeight) };
  }, [filtered, quoteScrollTop]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let closed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (closed) return;
      socket = new WebSocket(protocol + '//' + window.location.host + '/ws');
      bitgetMarketSocketRef.current = socket;
    const sendDesired = () => {
      const subscriptions = [...bitgetMarketDesiredRef.current].map(key => {
        const parts = key.split(':');
        return { instType: parts[0], symbol: parts[1] };
      });
      if (socket?.readyState === WebSocket.OPEN && subscriptions.length) {
        socket?.send(JSON.stringify({ type:'bitget.market.subscribe', subscriptions }));
      }
    };
      socket.onopen = sendDesired;
      socket.onmessage = event => {
      try {
        const message = JSON.parse(String(event.data));
        if (message?.type !== 'bitget.market.update') return;
        const payload = message.payload || {};
        const instType = String(payload.instType || '').toLowerCase();
        const symbol = String(payload.symbol || '').toUpperCase();
        const targetMarket = instType === 'spot' ? 'Spot' : instType === 'usdt-futures' ? 'USDT-M' : instType === 'coin-futures' ? 'COIN-M' : instType === 'usdc-futures' ? 'USDC-M' : '';
        if (!symbol || !targetMarket) return;
        setInstruments(current => current.map(item => {
          if (item.provider !== 'BITGET' || String(item.symbol || '').toUpperCase() !== symbol) return item;
          const itemMarket = item.marketType === 'Spot' ? 'Spot' : String(item.marketSubcategory || '').toUpperCase();
          if (itemMarket !== targetMarket && !(targetMarket === 'Spot' && item.marketType === 'Margin')) return item;
          const next = { ...item } as Instrument & Record<string, unknown>;
          next.liveTimestamp = payload.timestamp;
          next.liveExchangeTimestamp = payload.exchangeTimestamp;
          next.liveSeq = payload.seq;
          next.livePseq = payload.pseq;
          next.liveSource = 'BITGET_WS';
          if (payload.type === 'ticker') {
            if (Number.isFinite(Number(payload.price))) next.price = Number(payload.price);
            if (Number.isFinite(Number(payload.bid))) next.bid = Number(payload.bid);
            if (Number.isFinite(Number(payload.ask))) next.ask = Number(payload.ask);
            if (Number.isFinite(Number(payload.change24h))) {
              next.change24h = Number(payload.change24h) * 100;
              next.priceChangePercent = Number(payload.change24h) * 100;
            }
            if (Number.isFinite(Number(payload.volume24h))) next.volume24h = Number(payload.volume24h);
            if (Number.isFinite(Number(payload.quoteVolume24h))) next.quoteVolume = Number(payload.quoteVolume24h);
            if (Number.isFinite(Number(payload.high24h))) next.high24h = Number(payload.high24h);
            if (Number.isFinite(Number(payload.low24h))) next.low24h = Number(payload.low24h);
          } else if (payload.type === 'depth') {
            if (Number.isFinite(Number(payload.bid))) next.bid = Number(payload.bid);
            if (Number.isFinite(Number(payload.ask))) next.ask = Number(payload.ask);
          }
          return next;
        }));
      } catch {}
    };
      socket.onclose = () => {
        if (bitgetMarketSocketRef.current === socket) bitgetMarketSocketRef.current = null;
        if (!closed) retry = setTimeout(connect, 1000);
      };
      socket.onerror = () => { try { socket?.close(); } catch {} };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (bitgetMarketSocketRef.current === socket) bitgetMarketSocketRef.current = null;
      try { socket?.close(); } catch {}
    };
  }, []);

  useEffect(() => {
    const next = new Set<string>();
    quoteWindow.items.forEach(item => {
      const key = bitgetLiveKey(item);
      if (key) next.add(key);
    });
    const previous = bitgetMarketDesiredRef.current;
    const added = [...next].filter(key => !previous.has(key));
    const removed = [...previous].filter(key => !next.has(key));
    bitgetMarketDesiredRef.current = next;
    const socket = bitgetMarketSocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      if (added.length) socket.send(JSON.stringify({ type:'bitget.market.subscribe', subscriptions: added.map(key => {
        const parts = key.split(':'); return { instType: parts[0], symbol: parts[1] };
      }) }));
      if (removed.length) socket.send(JSON.stringify({ type:'bitget.market.unsubscribe', subscriptions: removed.map(key => {
        const parts = key.split(':'); return { instType: parts[0], symbol: parts[1] };
      }) }));
    }
  }, [quoteWindow.items]);

  const selectInstrument = (item: Instrument) => {
    setSelected(item);
    setSearch('');
    // Spot pair selection is a navigation handoff, not a chart selection.
    // Do this first so choosing a Spot instrument cannot mutate the chart state.
    if (spotReturnToTrade && item.provider === 'BITGET' && normalizeMarketLabel(item.marketType) === 'spot') {
      setTradeOpen(true);
      setActiveTab('trade');
      window.dispatchEvent(new CustomEvent('sire:navigate-tab', { detail: { tab: 'trade' } }));
      return;
    }
    // Selecting an instrument from the Market tab must stay in Market.
    if (activeTab === 'market') return;
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
  if (activeTab === 'home') {
    return <HomeView instruments={liveInstruments} onNavigate={tab => setActiveTab(tab)} onSelectInstrument={item => {
      const match = liveInstruments.find(candidate => candidate.id === item.id);
      if (match) selectInstrument(match);
    }} />;
  }

  if (activeTab === 'trade' || tradeOpen) {
    const ethUsdt = liveInstruments.find(item => item.provider === 'BITGET' && String(item.symbol || '').toUpperCase() === 'ETHUSDT');
    return <TradeView referencePrice={Number(ethUsdt?.price || 0)} referenceChange={Number(ethUsdt?.priceChangePercent ?? ethUsdt?.change24h ?? 0)} forceSpot={spotReturnToTrade} spotSymbol={spotReturnToTrade ? selected?.symbol : undefined} />;
  }

  if (activeTab === 'portfolio') {
    return <SireWalletPanel initialOpen />;
  }

  if (activeTab === 'discover') {
    return <ResearchLab symbol={chartSymbols[activeChartIndex] || selected?.symbol || ''} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onClose={() => {
      setResearchLabOpen(false);
      window.dispatchEvent(new CustomEvent('sire:navigate-tab', { detail: { tab: 'home' } }));
    }} onSelectInstrument={symbol => {
      const item = instruments.find(candidate => candidate.symbol === symbol);
      if (item) selectInstrument(item);
    }} />;
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
                        if (provider === 'BITGET') {
                          setCategoryFilter('CRYPTO');
                          setMarketSubcategoryFilter('Spot');
                          setMarketSubSubcategoryFilter('ALL');
                          setMarketLeafFilter('ALL');
                          void loadBitgetCatalog('source-selector').then(bitgetItems => {
                          setInstruments(current => {
                            const deriv = current.filter(item => item.provider !== 'BITGET');
                            const normalized = bitgetItems.map(item => ({
                              ...item,
                              id: 'BITGET:' + item.marketType + ':' + item.symbol,
                              provider: 'BITGET' as MarketProvider,
                              providerLabel: 'Bitget',
                              displaySymbol: item.symbol,
                              logoUrl: makeLogoFallback(item.baseAsset || item.symbol),
                              providerLogoUrl: 'https://www.bitget.com/favicon.ico',
                            })) as Instrument[];
                            return [...deriv, ...normalized];
                          });
                          setDerivError('');
                        }).catch(error => {
                          const message = error instanceof Error ? error.message : String(error);
                          console.error('[SIRE BITGET] source selector failed', message);
                          setDerivError(message);
                        });
                        } else if (provider === 'DERIV') {
                          setCategoryFilter('ALL');
                          setMarketSubcategoryFilter('ALL');
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
                <span className="quote-asset-logo-wrap"><img className="quote-asset-logo" src={item.logoUrl || makeAssetLogoFallback(item)} alt="" onError={event => { const image=event.currentTarget; image.onerror=null; image.src=makeLogoFallback(item.displaySymbol || item.symbol); }} /></span><span className="quote-instrument-name"><b>{String(item.displaySymbol || item.symbol).toUpperCase()}</b><small>{String(item.name || item.displaySymbol || item.symbol).toUpperCase()}</small></span><span className="quote-broker"><span className="quote-provider-logo-wrap"><img className="quote-provider-logo" src={sourceLogoUrl(item.provider)} alt="" onError={event => { const image = event.currentTarget; image.onerror = null; image.src = makeLogoFallback(item.providerLabel || item.provider); }} /></span><b>{String(item.providerLabel || item.provider).toUpperCase()}</b><small>{String(item.marketType || item.category || 'Market')}</small></span>
              </button>)}
            </div>
          </div>
        </div>}      </section>
    </div>
    <SireWalletPanel />
    {researchLabOpen && <ResearchLab symbol={chartSymbols[activeChartIndex] || selected?.symbol || ''} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onClose={() => setResearchLabOpen(false)} onSelectInstrument={symbol => { const item = instruments.find(candidate => candidate.symbol === symbol); if (item) selectInstrument(item); }} />}
  </main>;
}