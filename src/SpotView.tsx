import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, LoaderCircle, Search, Star, SlidersHorizontal, CandlestickChart, MoreHorizontal } from 'lucide-react';
import './spot.css';

type Props = { wallet?: string; initialSymbol?: string; onConnect?: () => void };
type Side = 'Buy' | 'Sell';
type OrderType = 'Market' | 'Limit' | 'Stop-limit' | 'Trigger';

type SireSpotMarket = {
  symbol:string; name:string; baseAsset:string; quote:string; status:string;
  marketType?:string; marketSubcategory?:string; category?:string;
  logoUrl?:string; price?:number; priceChangePercent?:number; bid?:number; ask?:number; assetName?:string
};
type Snapshot = { price?: number; bid?: number; ask?: number; percent?: number };
type BookLevel = { price:number; quantity:number; orders?:number };
type SpotBook = { asks:BookLevel[]; bids:BookLevel[]; lastTrade?:{price:number;quantity:number;time:number}|null; source?:string };
type SpotBalance = { asset:string; available:number; locked:number };

const money = (value:number, digits=2) =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';

function baseOf(item?: SireSpotMarket|null) {
  return String(item?.baseAsset || item?.symbol || '').replace(/(USDT|USDC|FDUSD)$/,'');
}

function formatPrice(value:number) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return value < 1 ? money(value, 6) : money(value, 2);
}

async function readJsonResponse(response:Response, label:string):Promise<any> {
  const raw = await response.text();
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!response.ok) {
    let detail = '';
    try { const parsed = JSON.parse(raw); detail = parsed?.error || parsed?.message || ''; } catch {}
    throw new Error(detail || label + ' returned HTTP ' + response.status);
  }
  if (!contentType.includes('application/json')) {
    const preview = raw.trim().slice(0, 80).replace(/\s+/g, ' ');
    throw new Error(label + ' returned a non-JSON response' + (preview ? ': ' + preview : '.'));
  }
  try { return JSON.parse(raw); }
  catch { throw new Error(label + ' returned invalid JSON.'); }
}

export default function SpotView({ wallet, initialSymbol, onConnect }: Props) {
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
  const [book, setBook] = useState<SpotBook>({ asks:[], bids:[], lastTrade:null });
  const [balances, setBalances] = useState<SpotBalance[]>([]);
  const [, setSubVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mobilePanel, setMobilePanel] = useState<'Trade'|'Chart'>('Trade');
  const [bookView, setBookView] = useState<'both'|'asks'|'bids'>('both');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/sire/bitget/catalog?t=' + Date.now(), { cache:'no-store', headers:{Accept:'application/json'} })
      .then(response => readJsonResponse(response,'Bitget catalog'))
      .then(payload => {
        if (cancelled) return;
        if (!payload?.ok || !Array.isArray(payload?.instruments)) throw new Error(payload?.error || 'Unable to load Bitget Spot markets.');
        const spot = payload.instruments.filter((item:SireSpotMarket) => item.status === 'TRADING' && item.marketType === 'Spot' && item.quote === 'USDT');
        setInstruments(spot);
        setSelected(current => current || spot.find(item => item.symbol === initialSymbol) || spot.find(item => item.symbol === 'BTCUSDT') || spot[0] || null);
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [initialSymbol]);

  useEffect(() => {
    if (!selected) return;
    setSnapshot({
      price: Number.isFinite(Number(selected.price)) ? Number(selected.price) : undefined,
      bid: Number.isFinite(Number(selected.bid)) ? Number(selected.bid) : undefined,
      ask: Number.isFinite(Number(selected.ask)) ? Number(selected.ask) : undefined,
      percent: Number.isFinite(Number(selected.priceChangePercent)) ? Number(selected.priceChangePercent) : undefined,
    });
    setBook({asks:[],bids:[],lastTrade:null});
    let cancelled = false;
    const category = String(selected.marketType || 'Spot').toUpperCase() === 'MARGIN' ? 'SPOT' : 'SPOT';
    fetch('/api/sire/bitget/orderbook?category=' + category + '&symbol=' + encodeURIComponent(selected.symbol) + '&limit=25', {cache:'no-store', headers:{Accept:'application/json'}})
      .then(r=>readJsonResponse(r,'Bitget order book')).then(p => {
        if(!cancelled && p?.ok) setBook({
          asks:Array.isArray(p.asks)?p.asks:[], bids:Array.isArray(p.bids)?p.bids:[],
          lastTrade:null, source:p.source
        });
      }).catch(()=>{});
    return () => { cancelled = true; };
  }, [selected]);

  useEffect(() => {
    if (!selected || typeof WebSocket === 'undefined') return;
    let closed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(protocol + '//' + window.location.host + '/ws');
      socket.onopen = () => {
        const instType = selected.marketType === 'Margin' ? 'spot' : 'spot';
        socket?.send(JSON.stringify({type:'bitget.market.subscribe',subscriptions:[{instType,symbol:selected.symbol}]}));
      };
      socket.onmessage = event => {
        try {
          const msg = JSON.parse(String(event.data || '{}'));
          if (msg?.type !== 'bitget.market.update') return;
          const payload = msg.payload || {};
          if (String(payload.symbol || '').toUpperCase() !== selected.symbol.toUpperCase()) return;
          if (payload.type === 'ticker') {
            setSnapshot({
              price:Number.isFinite(Number(payload.price)) ? Number(payload.price) : undefined,
              bid:Number.isFinite(Number(payload.bid)) ? Number(payload.bid) : undefined,
              ask:Number.isFinite(Number(payload.ask)) ? Number(payload.ask) : undefined,
              percent:Number.isFinite(Number(payload.change24h)) ? Number(payload.change24h) * 100 : undefined
            });
          } else if (payload.type === 'depth') {
            setBook({
              asks:Array.isArray(payload.asks)?payload.asks.map((x:any)=>({price:Number(x[0]),quantity:Number(x[1])})):[],
              bids:Array.isArray(payload.bids)?payload.bids.map((x:any)=>({price:Number(x[0]),quantity:Number(x[1])})):[],
              lastTrade:null, source:'BITGET_WS'
            });
          }
          setSubVersion(v => v + 1);
        } catch {}
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => { closed = true; if(retry) clearTimeout(retry); try { socket?.close(); } catch {} };
  }, [selected?.symbol, selected?.marketType]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/sire/bitget/account', {cache:'no-store', headers:{Accept:'application/json'}})
      .then(r=>readJsonResponse(r,'Bitget account')).then(p=>{
        if(cancelled || !p?.ok) return;
        setBalances(Array.isArray(p.assets) ? p.assets.map((a:any)=>({asset:String(a.coin||''),available:Number(a.available||0),locked:Number(a.locked||0)})) : []);
      }).catch(()=>{});
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return instruments.filter(item => !q || item.symbol.toLowerCase().includes(q) || String(item.name).toLowerCase().includes(q)).slice(0,80);
  }, [instruments, search]);

  const marketPrice = Number(book.lastTrade?.price || snapshot.price || selected?.price || 0);
  const askDepthMax = Math.max(0, ...book.asks.slice(0, 5).map(level => Number(level.quantity) || 0));
  const bidDepthMax = Math.max(0, ...book.bids.slice(0, 5).map(level => Number(level.quantity) || 0));
  const bid = Number(book.bids[0]?.price || snapshot.bid || 0);
  const ask = Number(book.asks[0]?.price || snapshot.ask || 0);
  const effectivePrice = orderType === 'Market' ? (side === 'Buy' ? ask || marketPrice : bid || marketPrice) : Number(price);
  const base = baseOf(selected);
  const baseBalance = balances.find(b => b.asset === base)?.available || 0;
  const quoteBalance = balances.find(b => b.asset === 'USDT')?.available || 0;
  const balanceForSide = side === 'Buy' ? quoteBalance : baseBalance;
  const fraction = Math.min(1, Math.max(0, Number(quantity) || 0));
  const tradeQuantity = side === 'Buy' ? (effectivePrice > 0 ? (balanceForSide * fraction) / effectivePrice : 0) : balanceForSide * fraction;
  const total = tradeQuantity > 0 && effectivePrice > 0 ? tradeQuantity * effectivePrice : 0;
  const change = Number(snapshot.percent || 0);
  const isUp = change >= 0;

  const setPercent = (pct:number) => {
    if (!marketPrice) return;
    setPrice(String((marketPrice * (1 + pct / 100)).toFixed(marketPrice < 1 ? 8 : 2)));
  };

  const submit = async () => {
    setError('');
    if (orderType !== 'Market' && orderType !== 'Limit') { setError('This order type is not executable yet. Use Market or Limit.'); return; }
    if (fraction <= 0) { setError('Choose an order amount first.'); return; }
    if (!effectivePrice || !tradeQuantity) { setError('There is no executable SIRE Spot price/liquidity for this order.'); return; }
    try {
      const response = await fetch('/api/sire/bitget/order', {
        method:'POST', headers:{'content-type':'application/json','accept':'application/json'},
        body:JSON.stringify({
          category:selected?.marketType === 'Margin' ? 'MARGIN' : 'SPOT',
          symbol:selected?.symbol,
          side:side.toLowerCase(),
          orderType:orderType.toLowerCase(),
          qty:orderType === 'Market' && side === 'Buy' ? total : tradeQuantity,
          ...(orderType === 'Limit' ? {price:Number(price)} : {}),
          clientOid:(globalThis.crypto?.randomUUID?.() || ('sire-' + Date.now() + '-' + Math.random().toString(36).slice(2))).slice(0,32)
        })
      });
      const payload = await response.json().catch(()=>({}));
      if (!response.ok || !payload?.ok) throw new Error(String(payload?.error || 'SIRE Spot order was rejected.'));
      setQuantity('');
      if (payload?.averagePrice) setPrice(String(payload.averagePrice));
      const [bookResponse, accountResponse] = await Promise.all([
        fetch('/api/sire/bitget/orderbook?category=' + (selected?.marketType === 'Margin' ? 'SPOT' : 'SPOT') + '&symbol=' + encodeURIComponent(selected?.symbol || '') + '&limit=25', {cache:'no-store', headers:{Accept:'application/json'}}),
        fetch('/api/sire/bitget/account', {cache:'no-store', headers:{Accept:'application/json'}})
      ]);
      const [nextBook,nextAccount] = await Promise.all([
        readJsonResponse(bookResponse,'Bitget order book'),
        readJsonResponse(accountResponse,'Bitget account')
      ]);
      if(nextBook?.ok) setBook({asks:nextBook.asks||[],bids:nextBook.bids||[],lastTrade:null,source:nextBook.source});
      if(nextAccount?.ok) setBalances((nextAccount.assets||[]).map((a:any)=>({asset:String(a.coin||''),available:Number(a.available||0),locked:Number(a.locked||0)})));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return <div className="sire-spot-shell">
    <main className="sire-spot-workspace">
      <section className="sire-spot-trade-panel">
        <div className="sire-spot-trade-content">
          <button type="button" className="sire-spot-instrument-pill" onClick={() => { setPickerOpen(false); window.dispatchEvent(new CustomEvent('sire:open-market-for-spot')); }} aria-label="Select spot instrument">
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
            <button type="button" aria-label="Select quote currency"><span>{money(total, total < 1 ? 6 : 2)} USDT</span><ChevronDown size={14}/></button>
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

          <div className="sire-spot-balance"><span>Available</span><b>{money(balanceForSide, balanceForSide < 1 ? 6 : 2)} {side === 'Buy' ? 'USDT' : (base || 'BTC')}</b><button type="button" onClick={onConnect}>+</button></div>

          {orderType === 'Limit' && <div className="sire-spot-price-shortcuts">{[-1,0,1].map(p => <button key={p} type="button" onClick={() => setPercent(p)}>{p === 0 ? 'Market' : (p > 0 ? '+' : '') + p + '%'}</button>)}</div>}

          <div className="sire-spot-order-summary">
            <div><span>Est. fee</span><b>{total ? money(total * 0.001, total < 1 ? 6 : 2) + ' USDT' : '— USDT'}</b></div>
          </div>

          <button type="button" className="sire-spot-submit" onClick={submit}>Place order</button>
          {error && <div className="sire-spot-error">{error}</div>}
        </div>
      </section>

      <aside className="sire-spot-book-card">
        <div className="sire-spot-book">
          <div className="sire-spot-book-controls" aria-label="Order book display"><button type="button" className={`active ${bookView}`} onClick={() => setBookView(bookView === 'both' ? 'bids' : bookView === 'bids' ? 'asks' : 'both')} aria-label="Cycle order book display"><i /><i /></button></div>
          <div className="sire-spot-book-head"><span>Price (USDT)</span><span>Amount ({base || 'BTC'})</span></div>
          <div className={`sire-spot-book-side asks ${bookView === 'bids' ? 'is-hidden' : ''}`}>
            {book.asks.slice(0,4).reverse().map((level,i) => <div key={'a'+i} style={{'--depth-width': String(Math.max(2, Math.min(100, askDepthMax ? ((Number(level.quantity) || 0) / askDepthMax) * 100 : 2))) + '%' } as any}><span>{formatPrice(level.price)}</span><b>{money(level.quantity, level.quantity < 1 ? 6 : 4)}</b></div>)}
            {book.asks.length === 0 && <div><span>—</span><b>—</b></div>}
          </div>
          <div className="sire-spot-book-mid"><strong>{formatPrice(marketPrice)}</strong><span>{isUp ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%</span></div>
          <div className={`sire-spot-book-side bids ${bookView === 'asks' ? 'is-hidden' : ''}`}>
            {book.bids.slice(0,5).map((level,i) => <div key={'b'+i} style={{'--depth-width': String(Math.max(2, Math.min(100, bidDepthMax ? ((Number(level.quantity) || 0) / bidDepthMax) * 100 : 2))) + '%' } as any}><span>{formatPrice(level.price)}</span><b>{money(level.quantity, level.quantity < 1 ? 6 : 4)}</b></div>)}
            {book.bids.length === 0 && <div><span>—</span><b>—</b></div>}
          </div>
          <div className="sire-spot-depth"><span>Buy {book.bids.length ? 'LIVE' : '—'}</span><i><b></b></i><span>Sell {book.asks.length ? 'LIVE' : '—'}</span></div><button type="button" className="sire-spot-book-step" aria-label="Price step"><span>0.01</span><ChevronDown size={11}/></button>
        </div>
      </aside>
    </main>

    {false && pickerOpen && <div className="sire-spot-picker-backdrop" onClick={() => setPickerOpen(false)}>
      <section className="sire-spot-picker" onClick={e => e.stopPropagation()}>
        <div className="sire-spot-picker-head"><strong>Select spot pair</strong><button type="button" onClick={() => setPickerOpen(false)}>×</button></div>
        <div className="sire-spot-search"><Search size={15}/><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search BTC, ETH, SOL…" /></div>
        <div className="sire-spot-picker-list">{filtered.map(item => <button key={item.symbol} type="button" onClick={() => { setSelected(item); setPickerOpen(false); setSearch(''); }}><span>{item.baseAsset}/{item.quote}</span><small>{item.symbol}</small><b>{item.price ? formatPrice(Number(item.price)) : '—'}</b></button>)}</div>
      </section>
    </div>}

    {loading && <div className="sire-spot-loading"><LoaderCircle className="sire-spin" size={17}/> Loading markets…</div>}
  </div>;
}
