import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, LoaderCircle, Search } from 'lucide-react';
import './spot.css';

type Props = { wallet?: string; onConnect?: () => void };

type Side = 'Buy' | 'Sell';
type OrderType = 'Market' | 'Limit';

type SireSpotMarket = { symbol:string; name:string; baseAsset:string; quote:string; status:string; logoUrl?:string; price?:number; priceChangePercent?:number; assetName?:string };
type Snapshot = { price?: number; bid?: number; ask?: number; percent?: number };

const money = (value:number, digits=2) =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';

function baseOf(item?: SireSpotMarket|null) {
  return String(item?.baseAsset || item?.symbol || '').replace(/(USDT|USDC|FDUSD|BTC|ETH|BNB)$/,'');
}

export default function SpotView({ wallet, onConnect }: Props) {
  const [instruments, setInstruments] = useState<SireSpotMarket[]>([]);
  const [selected, setSelected] = useState<SireSpotMarket | null>(null);
  const [search, setSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [side, setSide] = useState<Side>('Buy');
  const [orderType, setOrderType] = useState<OrderType>('Market');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const setPercent = (pct:number) => {
    if (!marketPrice) return;
    setPrice(String((marketPrice * (1 + pct / 100)).toFixed(marketPrice < 1 ? 8 : 2)));
  };

  return <div className="sire-spot-shell">
    <header className="sire-spot-head">
      <div>
        <span>SIRE SPOT</span>
        <strong>Spot trading</strong>
        <small>Trade SIRE Spot pairs with reference market data from CoinGecko.</small>
      </div>
      <div className="sire-spot-account">
        <span className={wallet ? 'online' : ''} />
        {wallet ? wallet.slice(0,6) + '…' + wallet.slice(-4) : 'Exchange not connected'}
      </div>
    </header>

    <div className="sire-spot-layout">
      <section className="sire-spot-ticket">
        <div className="sire-spot-pair-row">
          <button className="sire-spot-pair" type="button" onClick={() => setPickerOpen(true)}>
            <span className="sire-spot-logo"><img src={selected?.logoUrl || ''} alt="" onError={e => { e.currentTarget.style.display='none'; }} /></span>
            <span><b>{selected?.symbol || 'Select pair'}</b><small>{selected?.name || 'USDT spot market'}</small></span>
            <ChevronDown size={15}/>
          </button>
          <div className="sire-spot-market-price">
            <span>Last price</span>
            <strong>{marketPrice ? '$' + money(marketPrice, marketPrice < 1 ? 6 : 2) : '—'}</strong>
            <small>{Number.isFinite(snapshot.percent) ? ((snapshot.percent! >= 0 ? '+' : '') + money(snapshot.percent!, 2) + '%') : 'Live market'}</small>
          </div>
        </div>

        <div className="sire-spot-side" role="tablist">
          {(['Buy','Sell'] as Side[]).map(value => <button key={value} type="button" className={side === value ? 'active ' + value.toLowerCase() : ''} onClick={() => setSide(value)}>{value}</button>)}
        </div>

        <div className="sire-spot-order-types">
          {(['Market','Limit'] as OrderType[]).map(value => <button key={value} type="button" className={orderType === value ? 'active' : ''} onClick={() => setOrderType(value)}>{value}</button>)}
        </div>

        {orderType === 'Limit' && <div className="sire-spot-field">
          <div><label>Price</label><span>USDT</span></div>
          <input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value.replace(/[^0-9.]/g,''))} placeholder={marketPrice ? String(marketPrice) : '0.00'} />
          <div className="sire-spot-shortcuts">
            {[-1,0,1].map(p => <button key={p} type="button" onClick={() => setPercent(p)}>{p === 0 ? 'Market' : (p > 0 ? '+' : '') + p + '%'}</button>)}
          </div>
        </div>}

        <div className="sire-spot-field">
          <div><label>Amount</label><span>{base}</span></div>
          <input inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value.replace(/[^0-9.]/g,''))} placeholder="0.00" />
          <div className="sire-spot-percentages">{[25,50,75,100].map(p => <button key={p} type="button" onClick={() => setQuantity(String(Math.max(0, p / 100)))}>{p}%</button>)}</div>
        </div>

        <div className="sire-spot-summary">
          <div><span>Order value</span><b>{total ? money(total, 2) + ' USDT' : '—'}</b></div>
          <div><span>Best bid / ask</span><b>{snapshot.bid ? money(snapshot.bid, snapshot.bid < 1 ? 6 : 2) : '—'} / {snapshot.ask ? money(snapshot.ask, snapshot.ask < 1 ? 6 : 2) : '—'}</b></div>
        </div>

        <button type="button" className={'sire-spot-submit ' + side.toLowerCase()} onClick={() => {
          setError(wallet ? 'SIRE Spot execution is being connected to the SIRE order engine.' : 'Connect your SIRE Wallet to place Spot orders.');
          if (!wallet) onConnect?.();
        }}>
          {side} {base || 'Asset'}
        </button>
        {error && <div className="sire-spot-error">{error}</div>}
      </section>

      <aside className="sire-spot-market-panel">
        <div className="sire-spot-panel-head"><div><span>MARKETS</span><strong>Spot pairs</strong></div><button type="button" onClick={() => setPickerOpen(true)}><Search size={14}/></button></div>
        {loading ? <div className="sire-spot-loading"><LoaderCircle className="sire-spin" size={18}/> Loading pairs…</div> : <div className="sire-spot-list">{instruments.slice(0,40).map(item => <button key={item.symbol} type="button" className={selected?.symbol === item.symbol ? 'active' : ''} onClick={() => setSelected(item)}><span>{item.baseAsset}/{item.quote}</span><b>{item.price ? money(Number(item.price), Number(item.price) < 1 ? 6 : 2) : '—'}</b></button>)}</div>}
      </aside>
    </div>

    {pickerOpen && <div className="sire-spot-picker-backdrop" onClick={() => setPickerOpen(false)}>
      <section className="sire-spot-picker" onClick={e => e.stopPropagation()}>
        <div className="sire-spot-picker-head"><strong>Select spot pair</strong><button type="button" onClick={() => setPickerOpen(false)}>×</button></div>
        <div className="sire-spot-search"><Search size={15}/><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search BTC, ETH, SOL…" /></div>
        <div className="sire-spot-picker-list">{filtered.map(item => <button key={item.symbol} type="button" onClick={() => { setSelected(item); setPickerOpen(false); setSearch(''); }}><span>{item.baseAsset}/{item.quote}</span><small>{item.symbol}</small></button>)}</div>
      </section>
    </div>}
  </div>;
}
