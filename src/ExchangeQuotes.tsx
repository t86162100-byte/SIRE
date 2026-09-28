import { useEffect, useMemo, useState } from 'react';

type Instrument = {
  id: string;
  symbol: string;
  base: string;
  quote: string;
  name: string;
  category: 'spot' | 'margin' | 'perpetual' | 'futures';
  status: 'online' | 'offline';
};

type Catalogue = {
  id: 'bittrex' | 'coinex' | 'htx';
  name: string;
  status: 'online' | 'unavailable';
  message?: string;
  instruments: Instrument[];
  fetchedAt: number;
};

const CATEGORY_ORDER: Instrument['category'][] = ['spot', 'margin', 'perpetual', 'futures'];
const CATEGORY_LABEL: Record<Instrument['category'], string> = {
  spot: 'Spot',
  margin: 'Margin',
  perpetual: 'Perpetual',
  futures: 'Futures',
};

function logoText(name: string) {
  return name === 'CoinEx' ? 'CX' : name === 'HTX' ? 'HTX' : 'BX';
}

export default function ExchangeQuotes() {
  const [catalogues, setCatalogues] = useState<Catalogue[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/sire/exchanges/catalogue', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Exchange catalogue request failed.');
      setCatalogues(Array.isArray(data.catalogues) ? data.catalogues : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const query = search.trim().toLowerCase();
  const visible = useMemo(() => catalogues.map(catalogue => ({
    ...catalogue,
    instruments: catalogue.instruments.filter(item =>
      !query || `${item.symbol} ${item.name} ${item.base} ${item.quote} ${item.category}`.toLowerCase().includes(query)
    ),
  })), [catalogues, query]);

  return <section className="sire-exchange-quotes">
    <style>{`
      .sire-exchange-quotes{display:none;position:fixed;inset:0 0 62px;z-index:20;background:#050608;overflow:hidden;box-sizing:border-box;padding:14px 14px 12px}
      #root.sire-tab-quote .sire-exchange-quotes{display:flex;flex-direction:column}
      #root.sire-tab-quote .native-terminal-body{display:none!important}
      .sire-exchange-head{width:min(920px,100%);margin:0 auto 10px;flex:0 0 auto}
      .sire-exchange-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
      .sire-exchange-title strong{font-size:20px;font-weight:900;letter-spacing:-.02em}
      .sire-exchange-title small{opacity:.48;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
      .sire-exchange-search{height:44px;border:1px solid rgba(255,255,255,.1);border-radius:16px;background:rgba(255,255,255,.035);display:flex;align-items:center;padding:0 14px;box-sizing:border-box}
      .sire-exchange-search input{width:100%;border:0;outline:0;background:transparent;color:#fff;font:600 14px system-ui,sans-serif}
      .sire-exchange-scroll{width:min(920px,100%);margin:0 auto;overflow-y:auto;overscroll-behavior:contain;min-height:0;padding:2px 1px 20px;scrollbar-width:thin}
      .sire-exchange-source{margin:0 0 18px}
      .sire-exchange-source-head{display:flex;align-items:center;gap:10px;margin:5px 2px 9px}
      .sire-exchange-logo{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.16);font-size:11px;font-weight:950;letter-spacing:-.04em}
      .sire-exchange-source-head>div:nth-child(2){min-width:0;flex:1}
      .sire-exchange-source-head b{display:block;font-size:15px;font-weight:900}
      .sire-exchange-source-head small{display:block;margin-top:2px;font-size:9px;opacity:.46;font-weight:800;letter-spacing:.07em;text-transform:uppercase}
      .sire-exchange-count{font-size:10px;opacity:.5;font-weight:800}
      .sire-exchange-unavailable{padding:12px 14px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.025);font-size:11px;line-height:1.45;opacity:.65}
      .sire-exchange-category{margin:0 0 10px}
      .sire-exchange-category-label{font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;opacity:.42;margin:0 3px 6px}
      .sire-exchange-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}
      .sire-exchange-card{min-height:72px;border:1px solid rgba(255,255,255,.08);border-radius:17px;background:rgba(255,255,255,.025);display:grid;grid-template-columns:50px minmax(0,1fr) auto;align-items:center;gap:11px;padding:10px 12px;box-sizing:border-box}
      .sire-exchange-coin{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);font-size:13px;font-weight:950;overflow:hidden}
      .sire-exchange-card-main{min-width:0}
      .sire-exchange-card-main b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px;font-weight:900}
      .sire-exchange-card-main small{display:block;margin-top:3px;font-size:10px;opacity:.45;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .sire-exchange-broker{text-align:right;max-width:78px}
      .sire-exchange-broker b{display:block;font-size:10px;font-weight:900;opacity:.78}
      .sire-exchange-broker small{display:block;margin-top:4px;font-size:8px;opacity:.4;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
      .sire-exchange-empty,.sire-exchange-error{padding:20px;text-align:center;font-size:12px;opacity:.55}
      @media(max-width:520px){.sire-exchange-quotes{padding:10px 10px 8px}.sire-exchange-grid{grid-template-columns:1fr}.sire-exchange-card{min-height:68px}.sire-exchange-scroll{padding-bottom:24px}}
    `}</style>
    <div className="sire-exchange-head">
      <div className="sire-exchange-title"><div><strong>Markets</strong><small>Independent exchange catalogues</small></div><small>{catalogues.reduce((n,c)=>n+c.instruments.length,0)} instruments</small></div>
      <label className="sire-exchange-search"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search symbol, asset or category" /></label>
    </div>
    <div className="sire-exchange-scroll">
      {loading && <div className="sire-exchange-empty">Loading exchange catalogues…</div>}
      {!loading && error && <div className="sire-exchange-error">{error}</div>}
      {!loading && !error && visible.map(catalogue => <section className="sire-exchange-source" key={catalogue.id}>
        <div className="sire-exchange-source-head">
          <div className="sire-exchange-logo">{logoText(catalogue.name)}</div>
          <div><b>{catalogue.name}</b><small>{catalogue.status === 'online' ? 'Live public catalogue' : 'Trading unavailable'}</small></div>
          <span className="sire-exchange-count">{catalogue.instruments.length}</span>
        </div>
        {catalogue.status === 'unavailable'
          ? <div className="sire-exchange-unavailable">{catalogue.message || 'No live instrument catalogue is available.'}</div>
          : CATEGORY_ORDER.map(category => {
              const items = catalogue.instruments.filter(item => item.category === category);
              if (!items.length) return null;
              return <div className="sire-exchange-category" key={category}>
                <div className="sire-exchange-category-label">{CATEGORY_LABEL[category]} · {items.length}</div>
                <div className="sire-exchange-grid">{items.map(item => <article className="sire-exchange-card" key={item.id}>
                  <div className="sire-exchange-coin">{item.base.slice(0, 4)}</div>
                  <div className="sire-exchange-card-main"><b>{item.base}/{item.quote}</b><small>{item.symbol}</small></div>
                  <div className="sire-exchange-broker"><b>{catalogue.name}</b><small>{item.status === 'online' ? CATEGORY_LABEL[item.category] : 'Offline'}</small></div>
                </article>)}</div>
              </div>;
            })}
      </section>)}
      {!loading && !error && visible.every(c => c.instruments.length === 0 && c.status === 'online') && <div className="sire-exchange-empty">No instruments match “{search}”.</div>}
    </div>
  </section>;
}
