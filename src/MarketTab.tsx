import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, SlidersHorizontal, Star, X } from 'lucide-react';
import type { DerivInstrument } from './derivMarketData';

type MarketTabProps = {
  instruments: DerivInstrument[];
  onSelectInstrument: (item: DerivInstrument) => void;
};

type Node = { label: string; children?: Node[] };

const taxonomy: Node[] = [
  { label: 'Crypto', children: [
    { label: 'Spot', children: [
      { label: 'All' },
      { label: 'Quote', children: ['USDT','USDC','USD','BTC','ETH','BNB','FIAT','Other'].map(label => ({ label })) },
      { label: 'Asset Type', children: ['Exchange Token','Stablecoin','DeFi','Meme','AI','Gaming','RWA','Infrastructure','Layer-1','Layer-2','Other'].map(label => ({ label })) },
    ]},
    { label: 'Margin', children: [
      { label: 'All' },
      { label: 'Quote', children: ['USDT','USDC','USD','BTC','ETH','FIAT','Other'].map(label => ({ label })) },
      { label: 'Asset Type', children: ['Exchange Token','Stablecoin','DeFi','Meme','AI','Other'].map(label => ({ label })) },
    ]},
    { label: 'Futures', children: [
      { label: 'All' },
      { label: 'Perpetual', children: ['All','USDT-M','USDC-M','USD','Coin-M','Other'].map(label => ({ label })) },
      { label: 'Delivery', children: ['All','USDT','USDC','USD','Coin','Other'].map(label => ({ label })) },
    ]},
    { label: 'Options', children: ['All','Calls','Puts','Expiry','Strike','Underlying','Other'].map(label => ({ label })) },
  ]},
  { label: 'TradFi', children: [
    { label: 'Stocks', children: ['All','U.S.','International','ADR','Preferred','Other'].map(label => ({ label })) },
    { label: 'ETFs', children: ['All','Equity','Bond','Commodity','Crypto','Index','Other'].map(label => ({ label })) },
    { label: 'Futures', children: [
      { label: 'All' }, { label: 'Equity' }, { label: 'Index' },
      { label: 'Commodity', children: ['All','Energy','Metals','Agriculture','Other'].map(label => ({ label })) },
      { label: 'FX' }, { label: 'Other' },
    ]},
    { label: 'Forex', children: ['All','Major','Minor','Exotic','Other'].map(label => ({ label })) },
    { label: 'Commodities', children: ['All','Energy','Metals','Agriculture','Other'].map(label => ({ label })) },
    { label: 'Indices', children: ['All','U.S.','Europe','Asia','Global','Other'].map(label => ({ label })) },
    { label: 'Bonds', children: ['All','Government','Corporate','Municipal','Other'].map(label => ({ label })) },
    { label: 'Funds', children: ['All','Mutual Funds','Money Market','Index Funds','Other'].map(label => ({ label })) },
    { label: 'CFD', children: ['All','Stocks','Forex','Indices','Commodities','Metals','Other'].map(label => ({ label })) },
  ]},
  { label: 'Onchain', children: [
    { label: 'DEX', children: ['All','Ethereum','BNB Chain','Solana','Base','Arbitrum','Avalanche','Polygon','Sui','TRON','Optimism','Other'].map(label => ({ label })) },
    { label: 'Tokens', children: ['All','DeFi','Meme','AI','Gaming','RWA','NFT','Infrastructure','Layer-1','Layer-2','Stablecoin','Other'].map(label => ({ label })) },
  ]},
  { label: 'Prediction', children: ['All','Sports','Politics','Finance','Crypto','Economics','Other'].map(label => ({ label })) },
  { label: 'Other', children: ['Tokenized Assets','Synthetic','Baskets','Structured Products','Leveraged Tokens','Index Products','Exchange-Specific'].map(label => ({ label })) },
];

const dynamicViews = ['Favorites', 'Hot', 'New', 'Gainers', 'Losers', 'Volume', 'Market Cap'];

function node(labels: string[], root: Node[]): Node | undefined {
  let current = root;
  let found: Node | undefined;
  for (const label of labels) {
    found = current.find(item => item.label === label);
    if (!found) return undefined;
    current = found.children || [];
  }
  return found;
}

function categoryMatches(item: DerivInstrument, path: string[]) {
  const category = String(item.category || '').toLowerCase();
  const last = path[path.length - 1]?.toLowerCase() || '';
  if (path[0] === 'TradFi') {
    if (last === 'stocks') return category === 'stocks';
    if (last === 'forex' || last === 'fx') return category === 'forex';
    if (last === 'commodities' || ['energy','metals','agriculture'].includes(last)) return category === 'commodities';
    if (last === 'indices' || ['u.s.','europe','asia','global'].includes(last)) return category === 'indices';
  }
  if (path[0] === 'Crypto') return category === 'crypto';
  if (path[0] === 'Other' && last === 'synthetic') return category === 'synthetic';
  return false;
}

export default function MarketTab({ instruments, onSelectInstrument }: MarketTabProps) {
  const [marketClass, setMarketClass] = useState('Crypto');
  const [instrumentType, setInstrumentType] = useState('Spot');
  const [path, setPath] = useState<string[]>(['Crypto','Spot','All']);
  const [view, setView] = useState('All');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const classNode = node([marketClass], taxonomy);
  const typeNodes = classNode?.children || [];
  const selectedTypeNode = typeNodes.find(item => item.label === instrumentType) || typeNodes[0];
  const branch = selectedTypeNode?.children || [];
  const pathNode = node(path, taxonomy);
  const nextNodes = pathNode?.children || [];

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return instruments
      .filter(item => !q || `${item.name} ${item.symbol}`.toLowerCase().includes(q))
      .filter(item => marketClass === 'Crypto' ? item.category === 'crypto' : marketClass === 'TradFi' ? ['stocks','forex','commodities','indices'].includes(item.category) : true)
      .slice(0, 150);
  }, [instruments, marketClass, search]);

  const chooseClass = (label: string) => {
    const firstType = taxonomy.find(item => item.label === label)?.children?.[0]?.label || 'All';
    setMarketClass(label);
    setInstrumentType(firstType);
    setPath(firstType === 'All' ? [label] : [label, firstType, 'All']);
    setView('All');
  };

  const chooseType = (label: string) => {
    setInstrumentType(label);
    setPath([marketClass, label, 'All']);
    setView('All');
  };

  const chooseBranch = (label: string) => {
    const next = [...path.slice(0, 2), label];
    setPath(next);
  };

  const chooseNested = (label: string) => setPath([...path, label]);

  const reset = () => {
    setMarketClass('Crypto');
    setInstrumentType('Spot');
    setPath(['Crypto','Spot','All']);
    setView('All');
    setSearch('');
  };

  return <section className="sire-market-tab">
    <header className="sire-market-head">
      <div>
        <div className="sire-market-kicker">SIRE</div>
        <h1>Market</h1>
        <p>One market view across every supported venue.</p>
      </div>
      <div className="sire-market-head-actions">
        <button type="button" className="sire-market-icon-btn" aria-label="Filters" onClick={() => setFilterOpen(value => !value)}><SlidersHorizontal size={17} /></button>
      </div>
    </header>

    <div className="sire-market-search">
      <Search size={16} />
      <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search markets, symbols or instruments" />
      {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}
    </div>

    <div className="sire-market-scroll">
      <div className="sire-market-row-label">MARKET</div>
      <div className="sire-market-chips">
        {taxonomy.map(item => <button key={item.label} type="button" className={marketClass === item.label ? 'active' : ''} onClick={() => chooseClass(item.label)}>{item.label}</button>)}
      </div>

      <div className="sire-market-row-label">INSTRUMENT</div>
      <div className="sire-market-chips">
        {typeNodes.map(item => <button key={item.label} type="button" className={instrumentType === item.label ? 'active' : ''} onClick={() => chooseType(item.label)}>{item.label}</button>)}
      </div>

      {branch.length > 0 && <div className="sire-market-filter-panel">
        <div className="sire-market-filter-head"><span>FILTER</span><span className="sire-market-breadcrumb">{path.join('  /  ')}</span></div>
        <div className="sire-market-chips sire-market-chips--dense">
          {branch.map(item => <button key={item.label} type="button" className={path[path.length - 1] === item.label ? 'active' : ''} onClick={() => chooseBranch(item.label)}>{item.label}{item.children?.length ? <ChevronRight size={12} /> : null}</button>)}
        </div>
        {nextNodes.length > 0 && <div className="sire-market-nested">
          <div className="sire-market-nested-title">{path[path.length - 1]}</div>
          <div className="sire-market-chips sire-market-chips--dense">
            {nextNodes.map(item => <button key={item.label} type="button" className={path[path.length - 1] === item.label ? 'active' : ''} onClick={() => chooseNested(item.label)}>{item.label}</button>)}
          </div>
        </div>}
      </div>}

      <div className="sire-market-row-label">MARKET VIEWS</div>
      <div className="sire-market-chips sire-market-chips--views">
        {dynamicViews.map(item => <button key={item} type="button" className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item === 'Favorites' && <Star size={12} fill="currentColor" />}{item}</button>)}
      </div>

      <div className="sire-market-list-head"><span>INSTRUMENT</span><span>PRICE</span><span>24H</span></div>
      <div className="sire-market-list">
        {rows.length ? rows.map(item => <button key={item.symbol} type="button" className="sire-market-item" onClick={() => onSelectInstrument(item)}>
          <span className="sire-market-symbol"><span className="sire-market-logo">{item.symbol.slice(0,1)}</span><span><b>{item.name}</b><small>{item.symbol}</small></span></span>
          <span className="sire-market-price">—</span>
          <span className="sire-market-change sire-market-change--neutral">—</span>
        </button>) : <div className="sire-market-empty"><strong>No connected live instruments in this filter.</strong><span>The filter remains available for providers that support this market type.</span></div>}
      </div>
    </div>

    {filterOpen && <div className="sire-market-filter-drawer">
      <div className="sire-market-drawer-head"><div><strong>Filter path</strong><small>{path.join(' / ')}</small></div><button type="button" onClick={() => setFilterOpen(false)} aria-label="Close filter panel"><X size={17} /></button></div>
      <button type="button" className="sire-market-reset" onClick={reset}>Reset to Crypto / Spot / All</button>
      <div className="sire-market-drawer-note">Structural filters describe the instrument. Market Views are dynamic and do not change the underlying taxonomy.</div>
    </div>}
  </section>;
}
