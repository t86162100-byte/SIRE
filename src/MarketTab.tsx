import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal, Star, X } from 'lucide-react';

type MarketInstrument = {
  id: string;
  symbol: string;
  displaySymbol?: string;
  name?: string;
  provider?: string;
  providerLabel?: string;
  marketType?: string;
  category?: string;
  base?: string;
  quote?: string;
  price?: number;
  change24h?: number;
  priceChangePercent?: number;
  volume24h?: number;
  marketCap?: number;
  listedAt?: number;
  onboardDate?: number;
  newListing?: boolean;
  logoUrl?: string;
  exchange?: string;
  [key: string]: unknown;
};

type Props = {
  instruments: MarketInstrument[];
  onSelectInstrument: (item: MarketInstrument) => void;
};

type ClassName = 'Crypto' | 'TradFi' | 'Onchain' | 'Prediction' | 'Other';
type ViewName = 'All' | 'Favorites' | 'Hot' | 'New' | 'Gainers' | 'Losers' | 'Volume' | 'Market Cap';

const cryptoBranches = {
  Spot: { groups: { Quote: ['All', 'USDT', 'USDC', 'USD', 'BTC', 'ETH', 'BNB', 'FIAT', 'Other'], 'Asset Type': ['Exchange Token', 'Stablecoin', 'DeFi', 'Meme', 'AI', 'Gaming', 'RWA', 'Infrastructure', 'Layer-1', 'Layer-2', 'Other'] } },
  Margin: { groups: { Quote: ['All', 'USDT', 'USDC', 'USD', 'BTC', 'ETH', 'FIAT', 'Other'], 'Asset Type': ['Exchange Token', 'Stablecoin', 'DeFi', 'Meme', 'AI', 'Other'] } },
  Futures: { groups: { Perpetual: ['All', 'USDT-M', 'USDC-M', 'USD', 'Coin-M', 'Other'], Delivery: ['All', 'USDT', 'USDC', 'USD', 'Coin', 'Other'] } },
  Options: { groups: { Contract: ['All', 'Calls', 'Puts', 'Expiry', 'Strike', 'Underlying', 'Other'] } },
} as const;

const tradfiBranches = {
  Stocks: ['All', 'U.S.', 'International', 'ADR', 'Preferred', 'Other'],
  ETFs: ['All', 'Equity', 'Bond', 'Commodity', 'Crypto', 'Index', 'Other'],
  Futures: ['All', 'Equity', 'Index', 'Commodity', 'FX', 'Other'],
  Forex: ['All', 'Major', 'Minor', 'Exotic', 'Other'],
  Commodities: ['All', 'Energy', 'Metals', 'Agriculture', 'Other'],
  Indices: ['All', 'U.S.', 'Europe', 'Asia', 'Global', 'Other'],
  Bonds: ['All', 'Government', 'Corporate', 'Municipal', 'Other'],
  Funds: ['All', 'Mutual Funds', 'Money Market', 'Index Funds', 'Other'],
  CFD: ['All', 'Stocks', 'Forex', 'Indices', 'Commodities', 'Metals', 'Other'],
} as const;

const onchainBranches = {
  DEX: ['All', 'Ethereum', 'BNB Chain', 'Solana', 'Base', 'Arbitrum', 'Avalanche', 'Polygon', 'Sui', 'TRON', 'Optimism', 'Other'],
  Tokens: ['All', 'DeFi', 'Meme', 'AI', 'Gaming', 'RWA', 'NFT', 'Infrastructure', 'Layer-1', 'Layer-2', 'Stablecoin', 'Other'],
} as const;

const predictionBranches = ['All', 'Sports', 'Politics', 'Finance', 'Crypto', 'Economics', 'Other'] as const;
const otherBranches = ['Tokenized Assets', 'Synthetic', 'Baskets', 'Structured Products', 'Leveraged Tokens', 'Index Products', 'Exchange-Specific'] as const;

const classBranches: Record<ClassName, string[]> = {
  Crypto: Object.keys(cryptoBranches),
  TradFi: Object.keys(tradfiBranches),
  Onchain: Object.keys(onchainBranches),
  Prediction: ['All'],
  Other: ['All'],
};

const textOf = (item: MarketInstrument) => [
  item.symbol, item.displaySymbol, item.name, item.provider, item.providerLabel,
  item.marketType, item.category, item.exchange, item.base, item.quote,
  (item as any).marketFilter, (item as any).marketSubcategory,
  Array.isArray((item as any).marketFilters) ? (item as any).marketFilters.join(' ') : '',
].filter(Boolean).join(' ').toLowerCase();

const normalizeClass = (item: MarketInstrument): ClassName => {
  const raw = textOf(item);
  if (raw.includes('prediction') || ['POLYMARKET', 'KALSHI', 'OPINION'].includes(String(item.provider).toUpperCase())) return 'Prediction';
  if (raw.includes('onchain') || ['UNISWAP','CURVE','PANCAKESWAP','SUSHISWAP','RAYDIUM','JUPITER','ORCA','AERODROME','TRADERJOE','ONEINCH','COWSWAP','BALANCER'].includes(String(item.provider).toUpperCase())) return 'Onchain';
  if (raw.includes('tradfi') || /stocks?|etf|forex|commodity|commodities|indices?|bonds?|funds?|cfds?|cfd/.test(raw)) return 'TradFi';
  if (raw.includes('crypto') || /binance|bitget|gate|bybit|okx|kraken|coinbase|kucoin|mexc|bitfinex|htx|deriv/.test(raw)) return 'Crypto';
  return 'Other';
};

const normalizeType = (item: MarketInstrument) => {
  const raw = textOf(item);
  if (/option/.test(raw)) return 'Options';
  if (/perpetual|perps/.test(raw)) return 'Futures';
  if (/future|delivery/.test(raw)) return 'Futures';
  if (/margin/.test(raw)) return 'Margin';
  if (/spot/.test(raw)) return 'Spot';
  if (/stock|share/.test(raw)) return 'Stocks';
  if (/etf/.test(raw)) return 'ETFs';
  if (/forex|fx/.test(raw)) return 'Forex';
  if (/commodity|commodities/.test(raw)) return 'Commodities';
  if (/index|indices/.test(raw)) return 'Indices';
  if (/bond/.test(raw)) return 'Bonds';
  if (/fund/.test(raw)) return 'Funds';
  if (/cfd/.test(raw)) return 'CFD';
  if (/dex/.test(raw)) return 'DEX';
  if (/token/.test(raw)) return 'Tokens';
  return String(item.marketType || item.category || 'Other');
};

const matchesLeaf = (item: MarketInstrument, leaf: string, type: string) => {
  if (leaf === 'All') return true;
  const raw = textOf(item);
  const quote = String(item.quote || '').toUpperCase();
  const upper = leaf.toUpperCase();
  if (['USDT','USDC','USD','BTC','ETH','BNB','FIAT'].includes(upper)) return quote === upper || raw.includes(upper.toLowerCase());
  if (leaf === 'Other') return true;
  if (leaf === 'U.S.') return /\b(us|u\.s\.?|united states|nyse|nasdaq)\b/i.test(raw);
  if (leaf === 'International') return /international|global|non-us/i.test(raw);
  if (leaf === 'Calls') return /call/i.test(raw);
  if (leaf === 'Puts') return /put/i.test(raw);
  if (leaf === 'USDT-M') return /usdt.?m|usdt.?futures|usdt.?perpetual/i.test(raw);
  if (leaf === 'USDC-M') return /usdc.?m|usdc.?futures|usdc.?perpetual/i.test(raw);
  if (leaf === 'Coin-M') return /coin.?m|coin.?futures/i.test(raw);
  if (leaf === 'Perpetual') return /perpetual|perps/i.test(raw);
  if (leaf === 'Delivery') return /delivery|dated future/i.test(raw);
  return raw.includes(leaf.toLowerCase()) || raw.includes(leaf.toLowerCase().replace(/\s+/g, ''));
};

const formatPrice = (value?: number) => {
  if (!Number.isFinite(value)) return '—';
  const n = Number(value);
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return n.toLocaleString(undefined, { maximumSignificantDigits: 6 });
};

const formatCompact = (value?: number) => {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(Number(value));
};

const getChange = (item: MarketInstrument) => {
  const n = Number(item.change24h ?? item.priceChangePercent);
  return Number.isFinite(n) ? n : undefined;
};

export default function MarketTab({ instruments, onSelectInstrument }: Props) {
  const [marketClass, setMarketClass] = useState<ClassName>('Crypto');
  const [branch, setBranch] = useState('Spot');
  const [group, setGroup] = useState('Quote');
  const [leaf, setLeaf] = useState('All');
  const [view, setView] = useState<ViewName>('All');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sire-market-favorites') || '[]');
      if (Array.isArray(saved)) setFavorites(new Set(saved.map(String)));
    } catch {}
  }, []);

  const toggleFavorite = (id: string) => {
    setFavorites(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('sire-market-favorites', JSON.stringify([...next]));
      return next;
    });
  };

  const branchOptions = classBranches[marketClass];
  const groups = marketClass === 'Crypto' && branch in cryptoBranches
    ? Object.keys(cryptoBranches[branch as keyof typeof cryptoBranches].groups)
    : [];
  const leafOptions = useMemo(() => {
    if (marketClass === 'Crypto' && branch in cryptoBranches) {
      const data = cryptoBranches[branch as keyof typeof cryptoBranches].groups as Record<string, readonly string[]>;
      return data[group] ? [...data[group]] : [];
    }
    if (marketClass === 'TradFi' && branch in tradfiBranches) return [...tradfiBranches[branch as keyof typeof tradfiBranches]];
    if (marketClass === 'Onchain' && branch in onchainBranches) return [...onchainBranches[branch as keyof typeof onchainBranches]];
    if (marketClass === 'Prediction') return [...predictionBranches];
    if (marketClass === 'Other') return [...otherBranches];
    return ['All'];
  }, [marketClass, branch, group]);

  const setClass = (next: ClassName) => {
    setMarketClass(next);
    setBranch(classBranches[next][0]);
    setGroup(next === 'Crypto' ? 'Quote' : '');
    setLeaf('All');
    setView('All');
  };

  const setBranchSafe = (next: string) => {
    setBranch(next);
    setGroup(marketClass === 'Crypto' ? (next === 'Futures' ? 'Perpetual' : next === 'Options' ? 'Contract' : 'Quote') : '');
    setLeaf('All');
  };

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    let rows = instruments.filter(item => {
      const cls = normalizeClass(item);
      const type = normalizeType(item);
      if (marketClass !== cls) return false;
      if (branch !== 'All' && type !== branch) return false;
      if (leaf !== 'All' && !matchesLeaf(item, leaf, type)) return false;
      if (q && !textOf(item).includes(q)) return false;
      return true;
    });
    if (view === 'Favorites') rows = rows.filter(item => favorites.has(item.id));
    if (view === 'New') rows = rows.filter(item => Boolean(item.newListing) || Number(item.listedAt || item.onboardDate || 0) > Date.now() - 30 * 86400000);
    if (view === 'Gainers') rows = rows.filter(item => (getChange(item) ?? -Infinity) > 0).sort((a,b) => (getChange(b) ?? -Infinity) - (getChange(a) ?? -Infinity));
    if (view === 'Losers') rows = rows.filter(item => (getChange(item) ?? Infinity) < 0).sort((a,b) => (getChange(a) ?? Infinity) - (getChange(b) ?? Infinity));
    if (view === 'Volume') rows = [...rows].sort((a,b) => Number(b.volume24h || 0) - Number(a.volume24h || 0));
    if (view === 'Market Cap') rows = [...rows].sort((a,b) => Number(b.marketCap || 0) - Number(a.marketCap || 0));
    if (view === 'Hot') rows = [...rows].sort((a,b) => Number(b.volume24h || 0) - Number(a.volume24h || 0));
    return rows;
  }, [instruments, marketClass, branch, leaf, view, deferredSearch, favorites]);

  const chooseView = (next: ViewName) => setView(next);

  return <section className="sire-market-screen">
    <div className="sire-market-topbar">
      <label className="sire-market-search"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search markets" /><kbd>/</kbd></label>
    </div>

    <div className="sire-market-rail">
      <div className="sire-market-viewbar">
        <div className="sire-market-chips sire-market-view-chips">
          {(['All','Favorites','Hot','New','Gainers','Losers','Volume','Market Cap'] as ViewName[]).map(item => <button key={item} className={view === item ? 'active' : ''} onClick={() => chooseView(item)}>{item === 'Favorites' && <Star size={13}/>} {item}</button>)}
        </div>
      </div>

      <div className="sire-market-majorbar">
        <div className="sire-market-major-scroll">
          {(['Crypto','TradFi','Onchain','Prediction','Other'] as ClassName[]).map(item => (
            <button key={item} type="button" className={marketClass === item ? 'active' : ''} onClick={() => setClass(item)}>{item}</button>
          ))}
        </div>
      </div>

      <div className="sire-market-typebar">
        <div className="sire-market-type-scroll">
          {branchOptions.map(item => (
            <button key={item} type="button" className={branch === item ? 'active' : ''} onClick={() => setBranchSafe(item)}>{item}</button>
          ))}
        </div>
        <button type="button" className="sire-market-more-filter" aria-label="Open market filters" onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal size={14}/><span>Filters</span>
        </button>
      </div>
    </div>

    <div className="sire-market-results-head">
      <div><strong>{view === 'All' ? branch : view}</strong><span>{filtered.length.toLocaleString()} instruments</span></div>
      <span>{marketClass}{branch !== 'All' ? ' · ' + branch : ''}{leaf !== 'All' ? ' · ' + leaf : ''}</span>
    </div>

    <div className="sire-market-list">
      <div className="sire-market-list-head"><span>ASSET</span><span>MARKET</span><span>EXCHANGE</span><span>PRICE</span><span>24H</span><span>VOLUME</span></div>
      {filtered.length === 0 ? <div className="sire-market-empty"><strong>No instruments in this view</strong><span>Try another market class, instrument, or filter.</span></div> :
        filtered.slice(0, 500).map(item => {
          const change = getChange(item);
          return <div key={item.id} className="sire-market-row" role="button" tabIndex={0} onClick={() => onSelectInstrument(item)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectInstrument(item); } }}>
            <span className="sire-market-asset">
              <button type="button" className="sire-market-star" aria-label={favorites.has(item.id) ? 'Remove favorite' : 'Add favorite'} onClick={e => { e.stopPropagation(); toggleFavorite(item.id); }}>{favorites.has(item.id) ? <Star size={14} fill="currentColor"/> : <Star size={14}/>}</button>
              <span className="sire-market-logo"><img src={item.logoUrl || '/sire-logo.svg'} alt="" onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = '/sire-logo.svg'; }}/></span>
              <span><b>{String(item.displaySymbol || item.symbol).toUpperCase()}</b><small>{String(item.name || item.symbol).toUpperCase()}</small></span>
            </span>
            <span className="sire-market-type">{normalizeType(item)}</span>
            <span className="sire-market-exchange">{String(item.providerLabel || item.provider || item.exchange || '—')}</span>
            <span className="sire-market-price">{formatPrice(item.price)}</span>
            <span className={change === undefined ? 'sire-market-change neutral' : change >= 0 ? 'sire-market-change positive' : 'sire-market-change negative'}>{change === undefined ? '—' : (change >= 0 ? '+' : '') + change.toFixed(2) + '%'}</span>
            <span className="sire-market-volume">{formatCompact(item.volume24h)}</span>
          </div>;
        })}
    </div>

    {filtersOpen && <div className="sire-market-drawer-backdrop" onClick={() => setFiltersOpen(false)}>
      <aside className="sire-market-drawer" onClick={e => e.stopPropagation()}>
        <div className="sire-market-drawer-head"><div><small>FILTERS</small><strong>Market</strong></div><button type="button" onClick={() => setFiltersOpen(false)}><X size={18}/></button></div>
        <div className="sire-market-drawer-section"><span>Market class</span>{(['Crypto','TradFi','Onchain','Prediction','Other'] as ClassName[]).map(item => <button key={item} className={marketClass === item ? 'active' : ''} onClick={() => setClass(item)}>{item}</button>)}</div>
        <div className="sire-market-drawer-section"><span>Instrument</span>{branchOptions.map(item => <button key={item} className={branch === item ? 'active' : ''} onClick={() => setBranchSafe(item)}>{item}</button>)}</div>
        {groups.length > 0 && <div className="sire-market-drawer-section"><span>{group === 'Contract' ? 'Contract' : 'Category'}</span>{groups.map(item => <button key={item} className={group === item ? 'active' : ''} onClick={() => { setGroup(item); setLeaf('All'); }}>{item}</button>)}</div>}
        <div className="sire-market-drawer-section"><span>{groups.length > 0 ? group : 'Category'}</span>{leafOptions.map(item => <button key={item} className={leaf === item ? 'active' : ''} onClick={() => setLeaf(item)}>{item}</button>)}</div>
        <div className="sire-market-drawer-footer"><button type="button" onClick={() => { setMarketClass('Crypto'); setBranch('Spot'); setGroup('Quote'); setLeaf('All'); setView('All'); }}>Reset</button><button type="button" className="primary" onClick={() => setFiltersOpen(false)}>Done</button></div>
      </aside>
    </div>}
  </section>;
}
