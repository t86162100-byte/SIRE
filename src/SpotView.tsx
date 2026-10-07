import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, LoaderCircle, Search, Star, SlidersHorizontal, CandlestickChart, MoreHorizontal } from 'lucide-react';
import './spot.css';

type Props = { wallet?: string; onConnect?: () => void };
type Side = 'Buy' | 'Sell';
type OrderType = 'Market' | 'Limit' | 'Stop-limit' | 'Trigger';

type SireSpotMarket = {
  symbol:string; name:string; baseAsset:string; quote:string; status:string;
  logoUrl?:string; price?:number; priceChangePercent?:number; bid?:number; ask?:number; assetName?:string
};
type Snapshot = { price?: number; bid?: number; ask?: number; percent?: number };

const money = (value:number, digits=2) =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';

function baseOf(item?: SireSpotMarket|null) {
  return String(item?.baseAsset || item?.symbol || '').replace(/(USDT|USDC|FDUSD|BTC|ETH|BNB)$/,'');
}

function formatPrice(value:number) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return value < 1 ? money(value, 6) : money(value, 2);
}

export default function SpotView({ wallet, onConnect }: Props) {
  const [instruments, setInstruments] = useState<SireSpotMarket[]>([]);
  const [selected, setSelected] = useState<SireSpotMarket | null>(null);
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [side, setSide] = useState<Side>('Buy');
  const [orderType, setOrderType] = useState<OrderType>('Market');
  const [orderTypeOpen, setOrderTypeOpen] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mobilePanel, setMobilePanel] = useState<'Trade'|'Chart'>('Trade');
  const [bookMode, setBookMode] = useState<'Order book'|'Trades'>('Order book');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/sire/spot/catalog?t=' + Date.now(), { cache:'no-store' })
      .then(response => response.json())
      .then(payload => {
        if (cancelled) return;
        if (!payload?.ok || !Array.isArray(payload?.markets)) throw new Error(payload?.error || 'Unable to load SIRE Spot markets.');
        const spot = payload.markets.filter((item:SireSpotMarket) => item.status === 'TRADING' && item.quote === 'USDT');
        setInstruments(spot);
        setSelected(current => current || spot.find(item => item.symbol === 'BTCUSDT') || spot[0] || null);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const price = Number(selected.price);
    setSnapshot({
      price: Number.isFinite(price) ? price : undefined,
      bid: Number.isFinite(Number(selected.bid)) ? Number(selected.bid) : undefined,
      ask: Number.isFinite(Number(selected.ask)) ? Number(selected.ask) : undefined,
      percent: Number.isFinite(Number(selected.priceChangePercent)) ? Number(selected.priceChangePercent) : undefined,
    });
  }, [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return instruments.filter(item => !q || item.symbol.toLowerCase().includes(q) || String(item.name).toLowerCase().includes(q)).slice(0,80);
  }, [instruments, search]);

  const marketPrice = Number(snapshot.price || selected?.price || 0);
  const effectivePrice = orderType === 'Market' ? marketPrice : Number(price);
  const total = Number(quantity) > 0 && effectivePrice > 0 ? Number(quantity) * effectivePrice : 0;
  const base = baseOf(selected);
  const change = Number(snapshot.percent || 0);
  const isUp = change >= 0;
  const bid = Number(snapshot.bid || marketPrice);
  const ask = Number(snapshot.ask || marketPrice);
  const spread = bid > 0 && ask > 0 ? Math.max(ask - bid, 0) : 0;

  const setPercent = (pct:number) => {
    if (!marketPrice) return;
    setPrice(String((marketPrice * (1 + pct / 100)).toFixed(marketPrice < 1 ? 8 : 2)));
  };

  const submit = () => {
    setError(wallet ? 'SIRE Spot execution is being connected to the SIRE order engine.' : 'Connect your SIRE Wallet to place Spot orders.');
    if (!wallet) onConnect?.();
  };

  return <div className="sire-spot-shell">
    <main className="sire-spot-workspace">
      <section className="sire-spot-trade-panel">
        <div className="sire-spot-trade-content">
          <button type="button" className="sire-spot-instrument-pill" onClick={() => setPickerOpen(true)} aria-label="Select spot instrument">
            <span className="sire-spot-instrument-logo">
              <img src={selected?.logoUrl || ''} alt="" onError={e => { e.currentTarget.style.display='none'; }} />
              {!selected?.logoUrl && <span>{base.slice(0,1) || '?'}</span>}
            </span>
            <span className="sire-spot-instrument-copy">
              <b>{selected ? base + '/' + selected.quote : 'Select pair'}</b>
              <small>{selected?.name || 'Choose instrument'}</small>
            </span>
            <ChevronDown size={15}/>
          </button>

          <div className="sire-spot-side-row">
            <button type="button" className={side === 'Buy' ? 'active buy' : ''} onClick={() => setSide('Buy')}>Buy</button>
            <button type="button" className={side === 'Sell' ? 'active sell' : ''} onClick={() => setSide('Sell')}>Sell</button>
          </div>

          <div className="sire-spot-order-type-wrap">
            <button type="button" className="sire-spot-order-type-select" aria-label="Select order type" onClick={() => setOrderTypeOpen(v => !v)}>
              <span>{orderType}</span><ChevronDown size={14}/>
            </button>
            {orderTypeOpen && <div className="sire-spot-order-type-menu">
              {(['Market','Limit','Stop-limit','Trigger'] as OrderType[]).map(type => <button key={type} type="button" className={orderType === type ? 'active' : ''} onClick={() => { setOrderType(type); setOrderTypeOpen(false); }}>{type}</button>)}
            </div>}
          </div>

          <div className="sire-spot-total-card">
            <span>Total</span>
            <button type="button" aria-label="Select quote currency"><span>USDT</span><ChevronDown size={14}/></button>
          </div>
          {orderType === 'Limit' && <label className="sire-spot-input">
            <span>Price</span><input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value.replace(/[^0-9.]/g,''))} placeholder={marketPrice ? String(marketPrice) : '0.00'} /><em>USDT</em>
          </label>}

          <div className="sire-spot-amount-progress" aria-label="Amount">
            <div className="sire-spot-amount-track"><span style={{width: `${Math.min(100, Math.max(0, Number(quantity) * 100))}%`}} /></div>
            <div className="sire-spot-amount-diamonds">
              {[0,25,50,75,100].map(p => <button key={p} type="button" aria-label={`${p}%`} className={Number(quantity) * 100 >= p ? 'active' : ''} onClick={() => setQuantity(String(p / 100))}><i /></button>)}
            </div>
          </div>

          <div className="sire-spot-balance"><span>Available</span><b>0.00 USDT</b><button type="button" onClick={onConnect}>+</button></div>

          {orderType === 'Limit' && <div className="sire-spot-price-shortcuts">{[-1,0,1].map(p => <button key={p} type="button" onClick={() => setPercent(p)}>{p === 0 ? 'Market' : (p > 0 ? '+' : '') + p + '%'}</button>)}</div>}

          <div className="sire-spot-order-summary">
            <div><span>Est. fee</span><b>— USDT</b></div>
          </div>

          <button type="button" className="sire-spot-submit" onClick={submit}>Connect wallet</button>
          {error && <div className="sire-spot-error">{error}</div>}
        </div>
      </section>

      <aside className="sire-spot-book-card">
        <div className="sire-spot-book-tabs">
          <button className={bookMode === 'Order book' ? 'active' : ''} type="button" onClick={() => setBookMode('Order book')}>Order book</button>
          <button className={bookMode === 'Trades' ? 'active' : ''} type="button" onClick={() => setBookMode('Trades')}>Trades</button>
        </div>
        {bookMode === 'Order book' ? <div className="sire-spot-book">
          <div className="sire-spot-book-head"><span>Price (USDT)</span><span>Amount ({base || 'BTC'})</span></div>
          <div className="sire-spot-book-side asks">
            {[4,3,2,1].map((n,i) => <div key={n}><span>{formatPrice(ask + (i+1)*spread)}</span><b>{(0.00006*n).toFixed(5)}</b></div>)}
          </div>
          <div className="sire-spot-book-mid"><strong>{formatPrice(marketPrice)}</strong><span>{isUp ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%</span></div>
          <div className="sire-spot-book-side bids">
            {[1,2,3,4,5].map((n,i) => <div key={n}><span>{formatPrice(Math.max(0, bid - (i+1)*spread))}</span><b>{(0.00007*n).toFixed(5)}</b></div>)}
          </div>
          <div className="sire-spot-depth"><span>Buy 31%</span><i><b></b></i><span>Sell 69%</span></div>
        </div> : <div className="sire-spot-trades-empty">Recent trades will appear here.</div>}
      </aside>
    </main>

    {pickerOpen && <div className="sire-spot-picker-backdrop" onClick={() => setPickerOpen(false)}>
      <section className="sire-spot-picker" onClick={e => e.stopPropagation()}>
        <div className="sire-spot-picker-head"><strong>Select spot pair</strong><button type="button" onClick={() => setPickerOpen(false)}>×</button></div>
        <div className="sire-spot-search"><Search size={15}/><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search BTC, ETH, SOL…" /></div>
        <div className="sire-spot-picker-list">{filtered.map(item => <button key={item.symbol} type="button" onClick={() => { setSelected(item); setPickerOpen(false); setSearch(''); }}><span>{item.baseAsset}/{item.quote}</span><small>{item.symbol}</small><b>{item.price ? formatPrice(Number(item.price)) : '—'}</b></button>)}</div>
      </section>
    </div>}

    {loading && <div className="sire-spot-loading"><LoaderCircle className="sire-spin" size={17}/> Loading markets…</div>}
  </div>;
}
