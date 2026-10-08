import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, LoaderCircle, Search, SlidersHorizontal } from 'lucide-react';
import './futures.css';

type Props = { initialSymbol?: string };
type FuturesMarket = {
  symbol:string; name:string; baseAsset:string; quote:string; status:string;
  marketType?:string; marketSubcategory?:string; category?:string; logoUrl?:string;
  price?:number; priceChangePercent?:number; bid?:number; ask?:number;
};
type Level = { price:number; quantity:number };
type Book = { asks:Level[]; bids:Level[] };
type Position = { symbol:string; posSide?:string; total?:string; available?:string; avgPrice?:string; markPrice?:string; leverage?:string; unrealisedPnl?:string; liquidationPrice?:string; marginMode?:string };

const money=(v:number,d=2)=>Number.isFinite(v)?v.toLocaleString(undefined,{maximumFractionDigits:d}):'—';
const priceFmt=(v:number)=>Number.isFinite(v)?v.toLocaleString(undefined,{minimumFractionDigits:v<1?6:2,maximumFractionDigits:v<1?8:2}):'—';
const readJson=async(r:Response,label:string)=>{const raw=await r.text();let p:any=null;try{p=JSON.parse(raw)}catch{}if(!r.ok)throw new Error(p?.error||label+' returned HTTP '+r.status);if(!p)throw new Error(label+' returned invalid JSON.');return p;};

export default function FuturesView({initialSymbol}:Props){
  const [markets,setMarkets]=useState<FuturesMarket[]>([]);
  const [selected,setSelected]=useState<FuturesMarket|null>(null);
  const [search,setSearch]=useState('');
  const [picker,setPicker]=useState(false);
  const [contractTab,setContractTab]=useState<'USDT-M'|'COIN-M'|'USDC-M'>('USDT-M');
  const [side,setSide]=useState<'Long'|'Short'>('Long');
  const [action,setAction]=useState<'Open'|'Close'>('Open');
  const [orderType,setOrderType]=useState<'Market'|'Limit'>('Market');
  const [qty,setQty]=useState('');
  const [qtyPercent,setQtyPercent]=useState(0);
  const [price,setPrice]=useState('');
  const [leverage,setLeverage]=useState('10');
  const [marginMode,setMarginMode]=useState<'Cross'|'Isolated'>('Cross');
  const [reduceOnly,setReduceOnly]=useState(false);
  const [snapshot,setSnapshot]=useState<{price?:number;bid?:number;ask?:number;percent?:number}>({});
  const [book,setBook]=useState<Book>({asks:[],bids:[]});
  const [positions,setPositions]=useState<Position[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [bookView,setBookView]=useState<'both'|'asks'|'bids'>('both');

  const category=contractTab==='USDT-M'?'USDT-FUTURES':contractTab==='COIN-M'?'COIN-FUTURES':'USDC-FUTURES';
  const filtered=useMemo(()=>markets.filter(m=>!search||m.symbol.toLowerCase().includes(search.toLowerCase())||m.name.toLowerCase().includes(search.toLowerCase())),[markets,search]);
  const activePosition=positions.find(p=>p.symbol===selected?.symbol && Number(p.total||0)>0);
  const marketPrice=Number(snapshot.price||selected?.price||0);
  const bid=Number(book.bids[0]?.price||snapshot.bid||0);
  const ask=Number(book.asks[0]?.price||snapshot.ask||0);
  const effectivePrice=orderType==='Market'?(side==='Long'?ask||marketPrice:bid||marketPrice):Number(price);
  const change=Number(snapshot.percent||selected?.priceChangePercent||0);
  const maxDepthAsk=Math.max(0,...book.asks.slice(0,5).map(x=>x.quantity));
  const maxDepthBid=Math.max(0,...book.bids.slice(0,5).map(x=>x.quantity));

  useEffect(()=>{let cancelled=false;setLoading(true);setError('');
    fetch('/api/sire/bitget/catalog?t='+Date.now(),{cache:'no-store',headers:{Accept:'application/json'}}).then(r=>readJson(r,'Bitget catalog')).then(p=>{
      if(cancelled)return;
      const all=(Array.isArray(p?.instruments)?p.instruments:[]).filter((m:FuturesMarket)=>m.status==='TRADING'&&m.marketType==='Futures');
      setMarkets(all);
      const wanted=initialSymbol?all.find(m=>m.symbol===initialSymbol):null;
      setSelected(wanted||all.find(m=>m.marketSubcategory==='USDT-M'&&m.symbol==='BTCUSDT')||all.find(m=>m.marketSubcategory==='USDT-M')||all[0]||null);
    }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:String(e))}).finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[initialSymbol]);

  useEffect(()=>{if(!selected)return;
    const sub=String(selected.marketSubcategory||contractTab).toUpperCase();
    if(sub==='COIN-M')setContractTab('COIN-M'); else if(sub==='USDC-M')setContractTab('USDC-M'); else setContractTab('USDT-M');
  },[selected?.symbol]);

  useEffect(()=>{const list=markets.filter(m=>m.marketSubcategory===contractTab);if(!selected||selected.marketSubcategory!==contractTab)setSelected(list.find(m=>m.symbol==='BTCUSDT')||list[0]||null)},[contractTab,markets]);

  useEffect(()=>{if(!selected)return;let cancelled=false;
    setBook({asks:[],bids:[]});setSnapshot({price:selected.price,bid:selected.bid,ask:selected.ask,percent:selected.priceChangePercent});
    fetch('/api/sire/bitget/orderbook?category='+category+'&symbol='+encodeURIComponent(selected.symbol)+'&limit=25',{cache:'no-store',headers:{Accept:'application/json'}}).then(r=>readJson(r,'Bitget order book')).then(p=>{if(!cancelled&&p?.ok)setBook({asks:Array.isArray(p.asks)?p.asks.map((x:any)=>({price:Number(x.price),quantity:Number(x.quantity)})):[],bids:Array.isArray(p.bids)?p.bids.map((x:any)=>({price:Number(x.price),quantity:Number(x.quantity)})):[]})}).catch(()=>{});
    return()=>{cancelled=true};
  },[selected?.symbol,category]);

  useEffect(()=>{if(!selected)return;let closed=false,socket:WebSocket|null=null,retry:any;
    const instType=category==='USDT-FUTURES'?'usdt-futures':category==='COIN-FUTURES'?'coin-futures':'usdc-futures';
    const connect=()=>{if(closed)return;const protocol=location.protocol==='https:'?'wss:':'ws:';socket=new WebSocket(protocol+'//'+location.host+'/ws');
      socket.onopen=()=>socket?.send(JSON.stringify({type:'bitget.market.subscribe',subscriptions:[{instType,symbol:selected.symbol}]}));
      socket.onmessage=e=>{try{const msg=JSON.parse(String(e.data||'{}'));if(msg?.type!=='bitget.market.update')return;const p=msg.payload||{};if(String(p.symbol||'').toUpperCase()!==selected.symbol.toUpperCase())return;if(p.type==='ticker')setSnapshot({price:Number(p.price),bid:Number(p.bid),ask:Number(p.ask),percent:Number(p.change24h)*100});if(p.type==='depth')setBook({asks:Array.isArray(p.asks)?p.asks.map((x:any)=>({price:Number(x[0]),quantity:Number(x[1])})):[],bids:Array.isArray(p.bids)?p.bids.map((x:any)=>({price:Number(x[0]),quantity:Number(x[1])})):[]})}catch{}};
      socket.onclose=()=>{if(!closed)retry=setTimeout(connect,1000)};
    };connect();return()=>{closed=true;if(retry)clearTimeout(retry);try{socket?.close()}catch{}};
  },[selected?.symbol,category]);

  const refreshPositions=()=>{if(!selected)return;fetch('/api/sire/bitget/positions?category='+category+'&symbol='+encodeURIComponent(selected.symbol),{cache:'no-store',headers:{Accept:'application/json'}}).then(r=>readJson(r,'Bitget positions')).then(p=>setPositions(Array.isArray(p?.positions)?p.positions:[])).catch(()=>{})};
  useEffect(()=>{refreshPositions()},[selected?.symbol,category]);

  const applyLeverage=async(next:string)=>{setLeverage(next);if(!selected)return;try{await fetch('/api/sire/bitget/leverage',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({category,symbol:selected.symbol,leverage:next,marginMode:marginMode.toLowerCase()})}).then(r=>readJson(r,'Bitget leverage'))}catch(e){setError(e instanceof Error?e.message:String(e))}};

  const submit=async()=>{
    setError('');if(!selected)return;
    const n=Number(qty);if(!Number.isFinite(n)||n<=0){setError('Enter a valid contract quantity.');return}
    if(orderType==='Limit'&&(!Number(price)||Number(price)<=0)){setError('Enter a valid limit price.');return}
    setBusy(true);
    try{
      const isClose=action==='Close'||reduceOnly;
      const payload={category,symbol:selected.symbol,side:side==='Long'?(isClose?'sell':'buy'):(isClose?'buy':'sell'),orderType:orderType.toLowerCase(),qty:String(n),price:orderType==='Limit'?String(price):undefined,posSide:side.toLowerCase(),marginMode:marginMode.toLowerCase(),reduceOnly:isClose?'yes':'no'};
      const result=await fetch('/api/sire/bitget/order',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)}).then(r=>readJson(r,'Bitget futures order'));
      if(!result?.ok)throw new Error(result?.error||'Futures order failed.');
      setQty('');setQtyPercent(0);refreshPositions();
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  };

  return <div className="sire-futures-shell">
    <main className="sire-futures-workspace">
      <section className="sire-futures-trade">
        <div className="sire-futures-head">
          <button className="sire-futures-instrument" onClick={()=>setPicker(true)}>
            <span className="sire-futures-logo">{selected?.baseAsset?.slice(0,1)||'F'}</span>
            <span><b>{selected?.symbol||'Select contract'}</b><small>{selected?.name||'Futures contract'}</small></span><ChevronDown size={14}/>
          </button>
          
        </div>

        <div className="sire-futures-settings-row">
          <button className="sire-futures-setting-card" onClick={()=>setMarginMode(marginMode==='Cross'?'Isolated':'Cross')}>
            <b>{marginMode}</b>
          </button>
          <button className="sire-futures-setting-card" onClick={()=>{const next=leverage==='10'?'20':leverage==='20'?'5':'10';void applyLeverage(next)}}>
            <b>{leverage}×</b>
          </button>
        </div>

        <div className="sire-futures-order-tabs">
          <button className={action==='Open'?'active':''} onClick={()=>{setAction('Open');setReduceOnly(false)}}>Open</button>
          <button className={action==='Close'?'active':''} onClick={()=>{setAction('Close');setReduceOnly(true)}}>Close</button>
        </div>

        <div className="sire-futures-control-row">
          <button onClick={()=>setOrderType(orderType==='Market'?'Limit':'Market')}><span>Order</span><b>{orderType}</b><ChevronDown size={12}/></button>
        </div>

        <div className="sire-futures-price-row">
          <label><span>Price</span><input inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value.replace(/[^0-9.]/g,''))}/><em>USDT</em></label>
          <button type="button" onClick={()=>setPrice(priceFmt(marketPrice).replace(/,/g,''))}>BBO</button>
        </div>
        <label className="sire-futures-input"><span>Quantity</span><input inputMode="decimal" value={qty} onChange={e=>setQty(e.target.value.replace(/[^0-9.]/g,''))}/><span className="sire-futures-quantity-unit"><b>{selected?.baseAsset||'BTC'}</b><ChevronDown size={11}/></span></label>
        <div className="sire-futures-slider">
          <div className="sire-futures-range-track">
            <input type="range" min="0" max="100" step="1" value={qtyPercent} onChange={e=>{const v=Number(e.target.value);setQtyPercent(v);setQty(v===0?'':String(v))}}/>
            <div className="sire-futures-range-marks">
              {[0,25,50,75,100].map(v=><button key={v} type="button" className={qtyPercent===v?'active':''} aria-label={v+'%'} onClick={()=>{setQtyPercent(v);setQty(v===0?'':String(v))}}><i/></button>)}
            </div>
          </div>
        </div>

        <div className="sire-futures-tpsl-row">
          <button type="button">TP/SL</button>
          <label><input type="checkbox" checked={reduceOnly} onChange={e=>setReduceOnly(e.target.checked)}/><span>Reduce Only</span></label>
        </div>
        <div className="sire-futures-available"><span>Avbl</span><b>—</b></div>
        <button disabled={busy} className={'sire-futures-submit '+(side==='Long'?'long':'short')} onClick={submit}>{busy?<LoaderCircle className="sire-spin" size={15}/>:null}{action} {side}</button>
        {error&&<div className="sire-futures-error">{error}</div>}
      </section>

      <aside className="sire-futures-book-card">
        <div className="sire-futures-contract-switcher">
          <select value={contractTab} onChange={e=>setContractTab(e.target.value as 'USDT-M'|'COIN-M'|'USDC-M')} aria-label="Futures contract type">
            <option value="USDT-M">USDT-M</option>
            <option value="COIN-M">COIN-M</option>
            <option value="USDC-M">USDC-M</option>
          </select>
          <ChevronDown size={13} aria-hidden="true"/>
        </div>
        <div className="sire-futures-book-controls"><button onClick={()=>setBookView(bookView==='both'?'bids':bookView==='bids'?'asks':'both')}><SlidersHorizontal size={12}/><span>Book</span></button><span>LIVE</span></div>
        <div className="sire-futures-book-head"><span>Price (USDT)</span><span>Size</span></div>
        <div className={'sire-futures-book-side asks '+(bookView==='bids'?'hidden':'')}>{book.asks.slice(0,6).reverse().map((x,i)=><div key={i} style={{'--depth-width':(maxDepthAsk?Math.max(3,Math.min(100,x.quantity/maxDepthAsk*100)):3)+'%'} as any}><span>{priceFmt(x.price)}</span><b>{money(x.quantity,4)}</b></div>)}</div>
        <div className="sire-futures-mid"><strong>{priceFmt(marketPrice)}</strong><span className={change>=0?'up':'down'}>{change>=0?'▲':'▼'} {Math.abs(change).toFixed(2)}%</span></div>
        <div className={'sire-futures-book-side bids '+(bookView==='asks'?'hidden':'')}>{book.bids.slice(0,6).map((x,i)=><div key={i} style={{'--depth-width':(maxDepthBid?Math.max(3,Math.min(100,x.quantity/maxDepthBid*100)):3)+'%'} as any}><span>{priceFmt(x.price)}</span><b>{money(x.quantity,4)}</b></div>)}</div>
        <div className="sire-futures-book-foot"><span>Bid {bid?priceFmt(bid):'—'}</span><span>Ask {ask?priceFmt(ask):'—'}</span></div>
      </aside>
    </main>

    {picker&&<div className="sire-futures-picker-backdrop" onClick={()=>setPicker(false)}><section className="sire-futures-picker" onClick={e=>e.stopPropagation()}>
      <div className="sire-futures-picker-head"><strong>Select futures contract</strong><button onClick={()=>setPicker(false)}>×</button></div>
      <div className="sire-futures-search"><Search size={14}/><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search BTC, ETH, SOL…"/></div>
      <div className="sire-futures-list">{filtered.slice(0,120).map(item=><button key={item.symbol} onClick={()=>{setSelected(item);setPicker(false);setSearch('')}}><span><b>{item.symbol}</b><small>{item.name}</small></span><strong>{item.price?priceFmt(Number(item.price)):'—'}</strong></button>)}</div>
    </section></div>}
    {loading&&<div className="sire-futures-loading"><LoaderCircle className="sire-spin" size={15}/> Loading futures…</div>}
  </div>;
}
