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

const marketViews = ['All', 'Favorites', 'Hot', 'New', 'Gainers', 'Losers', 'Volume', 'Market Cap'];

const findNode = (labels: string[]) => {
  let level = taxonomy;
  let current: Node | undefined;
  for (const label of labels) {
    current = level.find(item => item.label === label);
    if (!current) return undefined;
    level = current.children || [];
  }
  return current;
};

const firstChild = (label: string) => taxonomy.find(item => item.label === label)?.children?.[0]?.label || 'All';

export default function MarketTab({ instruments, onSelectInstrument }: MarketTabProps) {
  const [marketClass, setMarketClass] = useState('Crypto');
  const [instrumentType, setInstrumentType] = useState('Spot');
  const [path, setPath] = useState<string[]>(['Crypto', 'Spot', 'All']);
  const [view, setView] = useState('All');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const classNode = findNode([marketClass]);
  const typeNodes = classNode?.children || [];
  const activeType = typeNodes.find(item => item.label === instrumentType) || typeNodes[0];
  const branchNodes = activeType?.children || [];
  const selectedNode = findNode(path);
  const childNodes = selectedNode?.children || [];

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cryptoCategories = ['crypto'];
    const tradFiCategories = ['stocks', 'forex', 'commodities', 'indices'];
    return instruments
      .filter(item => !q || `${item.name} ${item.symbol}`.toLowerCase().includes(q))
      .filter(item => marketClass === 'Crypto'
        ? cryptoCategories.includes(String(item.category).toLowerCase())
        : marketClass === 'TradFi'
          ? tradFiCategories.includes(String(item.category).toLowerCase())
          : true)
      .slice(0, 250);
  }, [instruments, marketClass, search]);

  const selectClass = (label: string) => {
    const type = firstChild(label);
    setMarketClass(label);
    setInstrumentType(type);
    setPath([label, type, 'All']);
    setView('All');
  };

  const selectType = (label: string) => {
    setInstrumentType(label);
    setPath([marketClass, label, 'All']);
    setView('All');
  };

  const selectBranch = (label: string) => {
    const next = [marketClass, instrumentType, label];
    setPath(next);
  };

  const selectChild = (label: string) => {
    setPath([...path.slice(0, -1), label]);
  };

  const reset = () => {
    setMarketClass('Crypto');
    setInstrumentType('Spot');
    setPath(['Crypto', 'Spot', 'All']);
    setView('All');
    setSearch('');
    setFilterOpen(false);
  };

  const breadcrumb = path.join(' / ');

  return (
    <section className="sire-market-v2">
      <div className="sire-market-v2-top">
        <div className="sire-market-v2-brand">
          <span className="sire-market-v2-eyebrow">SIRE</span>
          <div>
            <h1>Market</h1>
            <p>Discover and compare instruments across the SIRE market universe.</p>
          </div>
        </div>
        <div className="sire-market-v2-actions">
          <span className="sire-market-v2-count">{instruments.length.toLocaleString()} instruments</span>
          <button type="button" className="sire-market-v2-icon" onClick={() => setFilterOpen(value => !value)} aria-label="Open filters" aria-expanded={filterOpen}>
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </div>

      <div className="sire-market-v2-command">
        <Search size={16} />
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search markets, symbols or instruments" />
        {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}
        <kbd>/</kbd>
      </div>

      <div className="sire-market-v2-body">
        <div className="sire-market-v2-classbar">
          {taxonomy.map(item => (
            <button key={item.label} type="button" className={marketClass === item.label ? 'active' : ''} onClick={() => selectClass(item.label)}>
              {item.label}
            </button>
          ))}
        </div>

        <div className="sire-market-v2-typebar">
          <span className="sire-market-v2-label">INSTRUMENT</span>
          <div>
            {typeNodes.map(item => (
              <button key={item.label} type="button" className={instrumentType === item.label ? 'active' : ''} onClick={() => selectType(item.label)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sire-market-v2-filterbox">
          <div className="sire-market-v2-filterhead">
            <div>
              <span className="sire-market-v2-label">FILTERS</span>
              <strong>{breadcrumb}</strong>
            </div>
            <button type="button" onClick={reset}>Reset</button>
          </div>
          <div className="sire-market-v2-filterrow">
            {branchNodes.map(item => (
              <button key={item.label} type="button" className={path[2] === item.label ? 'active' : ''} onClick={() => selectBranch(item.label)}>
                {item.label}
                {item.children?.length ? <ChevronRight size={13} /> : null}
              </button>
            ))}
          </div>
          {childNodes.length > 0 && (
            <div className="sire-market-v2-subfilter">
              <span>{path[path.length - 1]}</span>
              <div>
                {childNodes.map(item => (
                  <button key={item.label} type="button" className={path[path.length - 1] === item.label ? 'active' : ''} onClick={() => selectChild(item.label)}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sire-market-v2-viewbar">
          <div>
            <span className="sire-market-v2-label">MARKET VIEWS</span>
            {marketViews.map(item => (
              <button key={item} type="button" className={view === item ? 'active' : ''} onClick={() => setView(item)}>
                {item === 'Favorites' ? <Star size={12} fill="currentColor" /> : null}
                {item}
              </button>
            ))}
          </div>
          <button type="button" className="sire-market-v2-filter-toggle" onClick={() => setFilterOpen(value => !value)}>
            Filters <ChevronDown size={13} className={filterOpen ? 'rotated' : ''} />
          </button>
        </div>

        <div className="sire-market-v2-table">
          <div className="sire-market-v2-tablehead">
            <span>MARKET</span>
            <span>PRICE</span>
            <span>24H</span>
          </div>
          <div className="sire-market-v2-tablebody">
            {rows.length > 0 ? rows.map(item => (
              <button key={item.symbol} type="button" className="sire-market-v2-row" onClick={() => onSelectInstrument(item)}>
                <span className="sire-market-v2-marketcell">
                  <span className="sire-market-v2-logo">{item.symbol.slice(0, 1).toUpperCase()}</span>
                  <span>
                    <b>{item.name}</b>
                    <small>{item.symbol}</small>
                  </span>
                </span>
                <span className="sire-market-v2-price">—</span>
                <span className="sire-market-v2-change">—</span>
              </button>
            )) : (
              <div className="sire-market-v2-empty">
                <strong>No connected instruments match this view.</strong>
                <span>The filter is available in the SIRE taxonomy; live values appear when a supported provider supplies them.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {filterOpen && (
        <aside className="sire-market-v2-drawer">
          <div className="sire-market-v2-drawerhead">
            <div><span className="sire-market-v2-label">MARKET FILTER</span><strong>{breadcrumb}</strong></div>
            <button type="button" onClick={() => setFilterOpen(false)} aria-label="Close filters"><X size={16} /></button>
          </div>
          <div className="sire-market-v2-drawersection">
            <span>Market class</span>
            <div>{taxonomy.map(item => <button key={item.label} type="button" className={marketClass === item.label ? 'active' : ''} onClick={() => selectClass(item.label)}>{item.label}</button>)}</div>
          </div>
          <div className="sire-market-v2-drawersection">
            <span>Instrument</span>
            <div>{typeNodes.map(item => <button key={item.label} type="button" className={instrumentType === item.label ? 'active' : ''} onClick={() => selectType(item.label)}>{item.label}</button>)}</div>
          </div>
          <button type="button" className="sire-market-v2-reset" onClick={reset}>Reset all filters</button>
        </aside>
      )}
    </section>
  );
}
