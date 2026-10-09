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
type ScheduleJob = {id:string;kind:string;state:string;spec?:any;totalSlices:number;completedSlices:number;lastError?:string|null};

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
  const [orderType,setOrderType]=useState('Market');
  const [orderDrawer,setOrderDrawer]=useState(false);
  const [timeInForce,setTimeInForce]=useState<'Post only'|'IOC'|'FOK'>('Post only');
  const [timeInForceDrawer,setTimeInForceDrawer]=useState(false);
  const [triggerSource,setTriggerSource]=useState<'Market price'|'Index price'|'Mark price'>('Market price');
  const [triggerSourceDrawer,setTriggerSourceDrawer]=useState(false);
  const [executeType,setExecuteType]=useState<'Limit'|'Market'>('Limit');
  const [executeTypeDrawer,setExecuteTypeDrawer]=useState(false);
  const [triggerPrice,setTriggerPrice]=useState('');
  const [trailingSource,setTrailingSource]=useState<'Market'|'Index'|'Limit'>('Market');
  const [trailingSourceDrawer,setTrailingSourceDrawer]=useState(false);
  const [trailVarianceMode,setTrailVarianceMode]=useState<'By percentage (%)'|'By spread (USDT)'>('By percentage (%)');
  const [trailVarianceDrawer,setTrailVarianceDrawer]=useState(false);
  const [trailVariance,setTrailVariance]=useState('1');
  const [activationPrice,setActivationPrice]=useState('');
  const [splitSettingsDrawer,setSplitSettingsDrawer]=useState(false);
  const [qtyPerOrder,setQtyPerOrder]=useState('0.001');
  const [splitOrderCount,setSplitOrderCount]=useState('10');
  const [orderPreferences,setOrderPreferences]=useState<'Faster execution'|'Fixed distance'|'Fixed price'>('Faster execution');
  const [orderPreferencesDrawer,setOrderPreferencesDrawer]=useState(false);
  const [queueType,setQueueType]=useState<'Queue 1'|'Counterparty 1'>('Queue 1');
  const [queueDrawer,setQueueDrawer]=useState(false);
  const [priceLimitEnabled,setPriceLimitEnabled]=useState(false);
  const [twapHours,setTwapHours]=useState('1');
  const [twapMinutes,setTwapMinutes]=useState('0');
  const [twapFrequency,setTwapFrequency]=useState('30s');
  const [twapFrequencyDrawer,setTwapFrequencyDrawer]=useState(false);
  const [twapAdvanced,setTwapAdvanced]=useState(false);
  const [slippageEnabled,setSlippageEnabled]=useState(false);
  const [qty,setQty]=useState('');
  const [qtyPercent,setQtyPercent]=useState(0);
  const [price,setPrice]=useState('');
  const [leverage,setLeverage]=useState('10');
  const [marginMode,setMarginMode]=useState<'Cross'|'Isolated'>('Cross');
  const [reduceOnly,setReduceOnly]=useState(false);
  const [snapshot,setSnapshot]=useState<{price?:number;bid?:number;ask?:number;percent?:number}>({});
  const [book,setBook]=useState<Book>({asks:[],bids:[]});
  const [positions,setPositions]=useState<Position[]>([]);
  const [schedules,setSchedules]=useState<ScheduleJob[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [bookView,setBookView]=useState<'both'|'asks'|'bids'>('both');

  const category=contractTab==='USDT-M'?'USDT-FUTURES':contractTab==='COIN-M'?'COIN-FUTURES':'USDC-FUTURES';
  const refreshSchedules=async()=>{try{const p=await fetch('/api/sire/bitget/schedules',{cache:'no-store',headers:{Accept:'application/json'}}).then(r=>readJson(r,'Futures schedules'));setSchedules(Array.isArray(p?.jobs)?p.jobs:[])}catch{}};
  const controlSchedule=async(id:string,action:'pause'|'resume'|'cancel')=>{try{await fetch('/api/sire/bitget/schedules/'+encodeURIComponent(id)+'/'+action,{method:'POST',headers:{Accept:'application/json'}}).then(r=>readJson(r,'Schedule '+action));await refreshSchedules()}catch(e){setError(e instanceof Error?e.message:String(e))}};
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
  useEffect(()=>{void refreshSchedules();const timer=setInterval(()=>void refreshSchedules(),3000);return()=>clearInterval(timer)},[]);

  const applyLeverage=async(next:string)=>{setLeverage(next);if(!selected)return;try{await fetch('/api/sire/bitget/leverage',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({category,symbol:selected.symbol,leverage:next,marginMode:marginMode.toLowerCase()})}).then(r=>readJson(r,'Bitget leverage'))}catch(e){setError(e instanceof Error?e.message:String(e))}};

  const submit=async(orderSide: 'Long'|'Short'=side, orderAction: 'Open'|'Close'=action, orderReduceOnly=reduceOnly)=>{
    setError('');if(!selected)return;
    const n=Number(qty);if(!Number.isFinite(n)||n<=0){setError('Enter a valid contract quantity.');return}
    const isClose=orderAction==='Close'||orderReduceOnly;
    const isTrigger=orderType==='Trigger order'||orderType==='Trailing stop order';
    const limitBasedOrder=orderType==='Limit'||orderType==='Advanced limit order'||(isTrigger&&executeType==='Limit');
    if(limitBasedOrder&&(!Number(price)||Number(price)<=0)){setError('Enter a valid limit price.');return}
    if(isTrigger&&(!Number(triggerPrice)||Number(triggerPrice)<=0)){setError('Enter a valid trigger price.');return}
    if(orderType==='Trailing stop order'&&(!Number(trailVariance)||Number(trailVariance)<=0)){setError('Enter a valid trailing callback rate.');return}
    if(orderType==='TWAP'){setError('TWAP scheduler is not enabled yet; no orders were submitted.');return}
    if(orderType==='Iceberg order'){setError('Iceberg scheduler is not enabled yet; no orders were submitted.');return}
    if(orderType==='Split large order'){setError('Split-order scheduler is not enabled yet; no orders were submitted.');return}
    setBusy(true);
    try{
      const orderSideValue=orderSide==='Long'?(isClose?'sell':'buy'):(isClose?'buy':'sell');
      if(algorithmic){
        const perQty=Number(qtyPerOrder);if(!Number.isFinite(perQty)||perQty<=0)throw new Error('Enter a valid quantity per order.');
        const durationSeconds=Number(twapHours||0)*3600+Number(twapMinutes||0)*60;
        const frequencySeconds=Number(String(twapFrequency).replace(/[^0-9]/g,''))||30;
        const preference=orderPreferences;
        const scheduledOrderType=orderType==='Iceberg order'&&preference!=='Faster execution'?'limit':'market';
        if(orderType==='TWAP'&&durationSeconds<60)throw new Error('TWAP duration must be at least 1 minute.');
        if(scheduledOrderType==='limit'&&(!Number(price)||Number(price)<=0))throw new Error('Enter the limit price for this Iceberg preference.');
        const schedulePayload:any={kind:orderType==='TWAP'?'twap':orderType==='Iceberg order'?'iceberg':'split',category,symbol:selected.symbol,side:orderSideValue,posSide:orderSide.toLowerCase(),marginMode:marginMode==='Cross'?'crossed':'isolated',reduceOnly:isClose||reduceOnly,orderType:scheduledOrderType,totalQty:n,perOrderQty:perQty,intervalSeconds:orderType==='TWAP'?frequencySeconds:5,durationSeconds:Math.max(60,durationSeconds),sliceCount:Number(splitOrderCount),price:scheduledOrderType==='limit'?Number(price):undefined,timeInForce:'gtc',preference,queueType,priceLimitEnabled};
        const created=await fetch('/api/sire/bitget/schedules',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(schedulePayload)}).then(r=>readJson(r,'Create Futures schedule'));
        if(!created?.ok)throw new Error(created?.error||'Could not create schedule.');
        setError('Schedule '+String(created.job?.id||'created').slice(0,8)+' started.');setQty('');setQtyPercent(0);await refreshSchedules();return;
      }
      const payload:any={category,symbol:selected.symbol,side:orderSideValue,orderType:limitBasedOrder?'limit':'market',qty:String(n),price:limitBasedOrder?String(price):undefined,posSide:orderSide.toLowerCase(),tradeSide:isClose?'close':'open',marginMode:marginMode==='Cross'?'crossed':'isolated',reduceOnly:isClose?'yes':'no',timeInForce:orderType==='Advanced limit order'?({'Post only':'post_only','IOC':'ioc','FOK':'fok'} as any)[timeInForce]:'gtc',slippagePercent:slippageEnabled&&orderType==='Market'?0.5:undefined,referencePrice:slippageEnabled&&orderType==='Market'?marketPrice:undefined};
      if(isTrigger){
        payload.planType=orderType==='Trailing stop order'?'track_plan':'normal_plan';
        payload.triggerPrice=triggerPrice;
        payload.triggerType=triggerSource==='Mark price'?'mark_price':'fill_price';
        payload.orderType=executeType.toLowerCase();
        payload.price=executeType==='Limit'?String(price):undefined;
        if(orderType==='Trailing stop order')payload.callbackRatio=trailVariance;
        const result=await fetch('/api/sire/bitget/order/trigger',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)}).then(r=>readJson(r,'Bitget trigger order'));
        if(!result?.ok)throw new Error(result?.error||'Trigger order failed.');
      }else{
        const result=await fetch('/api/sire/bitget/order',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)}).then(r=>readJson(r,'Bitget futures order'));
        if(!result?.ok)throw new Error(result?.error||'Futures order failed.');
      }
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
          <button type="button" onClick={()=>setOrderDrawer(true)}><span>Order</span><b>{orderType}</b><ChevronDown size={12}/></button>
        </div>

        {orderType==='Advanced limit order'&&<button type="button" className="sire-futures-tif-card" onClick={()=>setTimeInForceDrawer(true)}><span><small>Time in force</small><b>{timeInForce}</b></span><ChevronDown size={13}/></button>}
        {orderType==='Iceberg order'&&<>
          <button type="button" className="sire-futures-plain-select sire-futures-iceberg-split-trigger" onClick={()=>setSplitSettingsDrawer(true)}><span>Qty. per order</span><ChevronDown size={13}/></button>
          <label className="sire-futures-input sire-futures-iceberg-quantity"><span>Quantity</span><input aria-label="Iceberg quantity" inputMode="decimal" value={qtyPerOrder} onChange={e=>setQtyPerOrder(e.target.value.replace(/[^0-9.]/g,''))}/><span className="sire-futures-quantity-unit"><b>{selected?.baseAsset||'BTC'}</b></span></label>
          <button type="button" className="sire-futures-plain-select sire-futures-iceberg-preferences-trigger" onClick={()=>setOrderPreferencesDrawer(true)}><span>{orderPreferences}</span><ChevronDown size={13}/></button>
          <button type="button" className="sire-futures-tif-card sire-futures-iceberg-queue" onClick={()=>setQueueDrawer(true)}><span>{queueType}</span><ChevronDown size={13}/></button>
        </>}
        {orderType==='Trailing stop order'&&<><div className="sire-futures-plain-label">Activation price</div><div className="sire-futures-tif-card sire-futures-trigger-card sire-futures-trailing-source-card"><span className="sire-futures-trailing-price-label">Price</span><input aria-label="Activation price" inputMode="decimal" value={activationPrice} onChange={e=>setActivationPrice(e.target.value.replace(/[^0-9.]/g,''))} placeholder="Enter price"/><button type="button" onClick={()=>setTrailingSourceDrawer(true)}>{trailingSource}<ChevronDown size={13}/></button></div><button type="button" className="sire-futures-plain-select" onClick={()=>setTrailVarianceDrawer(true)}><span>Trail variance – {trailVarianceMode}</span><ChevronDown size={13}/></button><div className="sire-futures-trailing-variance-card"><span className="sire-futures-trailing-percent">{trailVarianceMode==='By percentage (%)'?'%':'USDT'}</span><span className="sire-futures-trailing-variance-title">Trail variance</span><input aria-label="Trail variance" inputMode="decimal" value={trailVariance} onChange={e=>setTrailVariance(e.target.value.replace(/[^0-9.]/g,''))}/></div><div className="sire-futures-trailing-presets">{(trailVarianceMode==='By percentage (%)'?['1%','5%','10%']:['1','5','10']).map(v=><button type="button" key={v} className={trailVariance===(trailVarianceMode==='By percentage (%)'?v.replace('%',''):v)?'active':''} onClick={()=>setTrailVariance(v.replace('%',''))}>{v}</button>)}</div></>}
        {orderType==='TWAP'&&<>
          <label className="sire-futures-input sire-futures-twap-quantity"><span>Quantity</span><input aria-label="TWAP total quantity" inputMode="decimal" value={qty} onChange={e=>setQty(e.target.value.replace(/[^0-9.]/g,''))}/><span className="sire-futures-quantity-unit"><b>{selected?.baseAsset||'BTC'}</b></span></label>
          <div className="sire-futures-slider sire-futures-twap-slider"><div className="sire-futures-range-track"><input type="range" min="0" max="100" step="1" value={qtyPercent} onChange={e=>{const v=Number(e.target.value);setQtyPercent(v);setQty(v===0?'':String(v))}}/><div className="sire-futures-range-marks">{[0,25,50,75,100].map(v=><button key={v} type="button" className={qtyPercent===v?'active':''} aria-label={v+'%'} onClick={()=>{setQtyPercent(v);setQty(v===0?'':String(v))}}><i/></button>)}</div></div></div>
          <div className="sire-futures-plain-label sire-futures-twap-running-label">Total running time</div>
          <div className="sire-futures-twap-time-row"><label><input aria-label="Hours" inputMode="numeric" value={twapHours} onChange={e=>setTwapHours(e.target.value.replace(/[^0-9]/g,''))}/><span>h</span></label><label><input aria-label="Minutes" inputMode="numeric" value={twapMinutes} onChange={e=>setTwapMinutes(e.target.value.replace(/[^0-9]/g,''))}/><span>m</span></label></div>
          <button type="button" className="sire-futures-tif-card sire-futures-twap-frequency" onClick={()=>setTwapFrequencyDrawer(true)}><span>Frequency</span><span className="sire-futures-twap-frequency-value">{twapFrequency}<ChevronDown size={12}/></span></button>
          <label className="sire-futures-input sire-futures-twap-per-order"><span>Per order</span><input aria-label="Quantity per order" inputMode="decimal" value={qtyPerOrder} onChange={e=>setQtyPerOrder(e.target.value.replace(/[^0-9.]/g,''))}/><span className="sire-futures-quantity-unit"><b>{selected?.baseAsset||'BTC'}</b></span></label>
        </>}
        {(orderType==='Limit'||orderType==='Advanced limit order')&&<div className={'sire-futures-price-row '+(orderType==='Advanced limit order'?'single-price':'')}>
          <label><span>Price</span><input inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value.replace(/[^0-9.]/g,''))}/><em>USDT</em></label>
          {orderType==='Limit'&&<button type="button" onClick={()=>setPrice(priceFmt(marketPrice).replace(/,/g,''))}>BBO</button>}
        </div>}
        {orderType!=='TWAP'&&<><label className="sire-futures-input"><span>Quantity</span><input inputMode="decimal" value={qty} onChange={e=>setQty(e.target.value.replace(/[^0-9.]/g,''))}/><span className="sire-futures-quantity-unit"><b>{selected?.baseAsset||'BTC'}</b><ChevronDown size={11}/></span></label>
        <div className="sire-futures-slider">
          <div className="sire-futures-range-track">
            <input type="range" min="0" max="100" step="1" value={qtyPercent} onChange={e=>{const v=Number(e.target.value);setQtyPercent(v);setQty(v===0?'':String(v))}}/>
            <div className="sire-futures-range-marks">
              {[0,25,50,75,100].map(v=><button key={v} type="button" className={qtyPercent===v?'active':''} aria-label={v+'%'} onClick={()=>{setQtyPercent(v);setQty(v===0?'':String(v))}}><i/></button>)}
            </div>
          </div>
        </div></>}

        <div className="sire-futures-toggle-stack">
          {orderType==='TWAP'?<label className="sire-futures-inline-toggle"><input type="checkbox" checked={twapAdvanced} onChange={e=>setTwapAdvanced(e.target.checked)} aria-label="Toggle advanced"/><span>Advanced</span></label>:orderType==='Iceberg order'?<label className="sire-futures-inline-toggle"><input type="checkbox" checked={priceLimitEnabled} onChange={e=>setPriceLimitEnabled(e.target.checked)} aria-label="Toggle price limit"/><span>Price limit</span></label>:<>
          {orderType==='Market'&&<label className="sire-futures-inline-toggle"><input type="checkbox" checked={slippageEnabled} onChange={e=>setSlippageEnabled(e.target.checked)} aria-label="Toggle slippage protection"/><span>Slippage</span>{slippageEnabled&&<b>0.5%</b>}</label>}
          <label className="sire-futures-inline-toggle"><input type="checkbox" aria-label="Toggle TP/SL"/><span>TP/SL</span></label>
          <label className="sire-futures-inline-toggle"><input type="checkbox" checked={reduceOnly} onChange={e=>setReduceOnly(e.target.checked)} aria-label="Toggle Reduce Only"/><span>Reduce Only</span></label></>}
        </div>
        <div className="sire-futures-costs">
          <div className="sire-futures-action-block">
            <div className="sire-futures-action-meta"><span>Max</span><b>—</b></div>
            <div className="sire-futures-action-meta"><span>Cost</span><b>—</b></div>
            <button disabled={busy} type="button" className="sire-futures-open-long" onClick={()=>{setSide('Long');setAction('Open');setReduceOnly(false);void submit('Long','Open',false)}}>Open long</button>
          </div>
          <div className="sire-futures-action-block">
            <div className="sire-futures-action-meta"><span>Max</span><b>—</b></div>
            <div className="sire-futures-action-meta"><span>Cost</span><b>—</b></div>
            <button disabled={busy} type="button" className="sire-futures-open-short" onClick={()=>{setSide('Short');setAction('Open');setReduceOnly(false);void submit('Short','Open',false)}}>Open short</button>
          </div>
        </div>
        {error&&<div className="sire-futures-error">{error}</div>}
        {schedules.filter(j=>['running','paused','cancel_requested'].includes(j.state)).slice(0,3).map(j=><div className="sire-futures-error" key={j.id}><span>{j.kind.toUpperCase()} · {j.state} · {j.completedSlices}/{j.totalSlices}</span>{j.lastError&&<small> {j.lastError}</small>}<span style={{float:'right',display:'inline-flex',gap:6}}>{j.state==='running'&&<button type="button" onClick={()=>void controlSchedule(j.id,'pause')}>Pause</button>}{j.state==='paused'&&<button type="button" onClick={()=>void controlSchedule(j.id,'resume')}>Resume</button>}<button type="button" onClick={()=>void controlSchedule(j.id,'cancel')}>Cancel</button></span></div>)}
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




    {twapFrequencyDrawer&&<div className="sire-futures-order-backdrop" onClick={()=>setTwapFrequencyDrawer(false)}><section className="sire-futures-order-drawer sire-futures-choice-drawer" role="dialog" aria-modal="true" aria-label="Select TWAP frequency" onClick={e=>e.stopPropagation()}><div className="sire-futures-order-drawer-head"><strong>Frequency</strong><button type="button" aria-label="Close frequency drawer" onClick={()=>setTwapFrequencyDrawer(false)}>×</button></div>{['5s','10s','20s','30s','60s'].map(item=><button type="button" key={item} className={'sire-futures-order-option '+(twapFrequency===item?'selected':'')} onClick={()=>{setTwapFrequency(item);setTwapFrequencyDrawer(false)}}><span className="sire-futures-order-option-copy"><b>{item}</b></span><i aria-hidden="true">{twapFrequency===item?'✓':''}</i></button>)}</section></div>}{splitSettingsDrawer&&<div className="sire-futures-order-backdrop" onClick={()=>setSplitSettingsDrawer(false)}><section className="sire-futures-order-drawer sire-futures-choice-drawer sire-futures-iceberg-drawer" role="dialog" aria-modal="true" aria-label="Split settings" onClick={e=>e.stopPropagation()}><div className="sire-futures-order-drawer-head"><strong>Split settings</strong><button type="button" aria-label="Close split settings" onClick={()=>setSplitSettingsDrawer(false)}>×</button></div><label className="sire-futures-iceberg-setting"><span><b>Qty. per order</b><small>Set the quantity for each sub-order.</small></span><input aria-label="Quantity per order" inputMode="decimal" value={qtyPerOrder} onChange={e=>setQtyPerOrder(e.target.value.replace(/[^0-9.]/g,''))}/></label><label className="sire-futures-iceberg-setting"><span><b>No. of split orders</b><small>Set the total number of split orders.</small></span><input aria-label="Number of split orders" inputMode="numeric" value={splitOrderCount} onChange={e=>setSplitOrderCount(e.target.value.replace(/[^0-9]/g,''))}/></label><button type="button" className="sire-futures-iceberg-done" onClick={()=>setSplitSettingsDrawer(false)}>Confirm</button></section></div>}
        {orderPreferencesDrawer&&<div className="sire-futures-order-backdrop" onClick={()=>setOrderPreferencesDrawer(false)}><section className="sire-futures-order-drawer sire-futures-choice-drawer" role="dialog" aria-modal="true" aria-label="Order preferences" onClick={e=>e.stopPropagation()}><div className="sire-futures-order-drawer-head"><strong>Order preferences</strong><button type="button" aria-label="Close order preferences" onClick={()=>setOrderPreferencesDrawer(false)}>×</button></div>{[{name:'Faster execution' as const,description:'Ensures that each order is placed at the best price, with the prices continuously adjusted as the market changes to enable faster execution.'},{name:'Fixed distance' as const,description:'Distance from Bid 1/Ask 1. Ensures that each order is placed at a fixed distance from the best price, with the prices continuously adjusted as the market changes to achieve a better execution price.'},{name:'Fixed price' as const,description:'Each sub-order is placed at a fixed price.'}].map(item=><button type="button" key={item.name} className={'sire-futures-order-option '+(orderPreferences===item.name?'selected':'')} onClick={()=>{setOrderPreferences(item.name);setOrderPreferencesDrawer(false)}}><span className="sire-futures-order-option-copy"><b>{item.name}</b><small>{item.description}</small></span><i aria-hidden="true">{orderPreferences===item.name?'✓':''}</i></button>)}</section></div>}
        {queueDrawer&&<div className="sire-futures-order-backdrop" onClick={()=>setQueueDrawer(false)}><section className="sire-futures-order-drawer sire-futures-choice-drawer" role="dialog" aria-modal="true" aria-label="Select queue" onClick={e=>e.stopPropagation()}><div className="sire-futures-order-drawer-head"><strong>Queue preference</strong><button type="button" aria-label="Close queue preferences" onClick={()=>setQueueDrawer(false)}>×</button></div>{(['Queue 1','Counterparty 1'] as const).map(item=><button type="button" key={item} className={'sire-futures-order-option '+(queueType===item?'selected':'')} onClick={()=>{setQueueType(item);setQueueDrawer(false)}}><span className="sire-futures-order-option-copy"><b>{item}</b></span><i aria-hidden="true">{queueType===item?'✓':''}</i></button>)}</section></div>}
        {trailingSourceDrawer&&<div className="sire-futures-order-backdrop" onClick={()=>setTrailingSourceDrawer(false)}><section className="sire-futures-order-drawer sire-futures-choice-drawer" role="dialog" aria-modal="true" aria-label="Select activation price source" onClick={e=>e.stopPropagation()}><div className="sire-futures-order-drawer-head"><strong>Activation price</strong><button type="button" aria-label="Close activation price drawer" onClick={()=>setTrailingSourceDrawer(false)}>×</button></div>{[{name:'Market' as const,description:'Use the latest traded market price.'},{name:'Index' as const,description:'Use the reference index price.'},{name:'Limit' as const,description:'Set a specific activation price.'}].map(item=><button type="button" key={item.name} className={'sire-futures-order-option '+(trailingSource===item.name?'selected':'')} onClick={()=>{setTrailingSource(item.name);setTrailingSourceDrawer(false)}}><span className="sire-futures-order-option-copy"><b>{item.name}</b><small>{item.description}</small></span><i aria-hidden="true">{trailingSource===item.name?'✓':''}</i></button>)}</section></div>}{trailVarianceDrawer&&<div className="sire-futures-order-backdrop" onClick={()=>setTrailVarianceDrawer(false)}><section className="sire-futures-order-drawer sire-futures-choice-drawer" role="dialog" aria-modal="true" aria-label="Choose trail variance" onClick={e=>e.stopPropagation()}><div className="sire-futures-order-drawer-head"><strong>Trail variance</strong><button type="button" aria-label="Close trail variance drawer" onClick={()=>setTrailVarianceDrawer(false)}>×</button></div>{[{name:'By percentage (%)' as const,description:'Trigger price based on the percentage distance from the highest/lowest'},{name:'By spread (USDT)' as const,description:'Trigger price based on the absolute difference from the highest/lowest'}].map(item=><button type="button" key={item.name} className={'sire-futures-order-option '+(trailVarianceMode===item.name?'selected':'')} onClick={()=>{setTrailVarianceMode(item.name);setTrailVariance('1');setTrailVarianceDrawer(false)}}><span className="sire-futures-order-option-copy"><b>{item.name}</b><small>{item.description}</small></span><i aria-hidden="true">{trailVarianceMode===item.name?'✓':''}</i></button>)}</section></div>}{triggerSourceDrawer&&<div className="sire-futures-order-backdrop" onClick={()=>setTriggerSourceDrawer(false)}>
      <section className="sire-futures-order-drawer sire-futures-choice-drawer" role="dialog" aria-modal="true" aria-label="Select trigger price" onClick={e=>e.stopPropagation()}>
        <div className="sire-futures-order-drawer-head"><strong>Trigger price</strong><button type="button" aria-label="Close trigger price drawer" onClick={()=>setTriggerSourceDrawer(false)}>×</button></div>
        {[
          {name:'Market price' as const,description:'Trigger using the latest traded market price.'},
          {name:'Index price' as const,description:'Trigger using the reference index price.'},
          {name:'Mark price' as const,description:'Trigger using the futures mark price.'}
        ].map(item=><button type="button" key={item.name} className={'sire-futures-order-option '+(triggerSource===item.name?'selected':'')} onClick={()=>{setTriggerSource(item.name);setTriggerSourceDrawer(false)}}>
          <span className="sire-futures-order-option-copy"><b>{item.name}</b><small>{item.description}</small></span><i aria-hidden="true">{triggerSource===item.name?'✓':''}</i>
        </button>)}
      </section>
    </div>}
    {executeTypeDrawer&&<div className="sire-futures-order-backdrop" onClick={()=>setExecuteTypeDrawer(false)}>
      <section className="sire-futures-order-drawer sire-futures-choice-drawer" role="dialog" aria-modal="true" aria-label="Select execution order type" onClick={e=>e.stopPropagation()}>
        <div className="sire-futures-order-drawer-head"><strong>Execute price</strong><button type="button" aria-label="Close execution type drawer" onClick={()=>setExecuteTypeDrawer(false)}>×</button></div>
        {[
          {name:'Limit' as const,description:'Place a limit order when the trigger condition is reached.'},
          {name:'Market' as const,description:'Place a market order when the trigger condition is reached.'}
        ].map(item=><button type="button" key={item.name} className={'sire-futures-order-option '+(executeType===item.name?'selected':'')} onClick={()=>{setExecuteType(item.name);setExecuteTypeDrawer(false)}}>
          <span className="sire-futures-order-option-copy"><b>{item.name}</b><small>{item.description}</small></span><i aria-hidden="true">{executeType===item.name?'✓':''}</i>
        </button>)}
      </section>
    </div>}

    {timeInForceDrawer&&<div className="sire-futures-order-backdrop" onClick={()=>setTimeInForceDrawer(false)}>
      <section className="sire-futures-order-drawer sire-futures-tif-drawer" role="dialog" aria-modal="true" aria-label="Choose time in force" onClick={e=>e.stopPropagation()}>
        <div className="sire-futures-order-drawer-head"><strong>Time in force</strong><button type="button" aria-label="Close time in force drawer" onClick={()=>setTimeInForceDrawer(false)}>×</button></div>
        {[
          {name:'Post only' as const,description:'The order will remain as a maker order and will be automatically canceled when the order matches an existing order.'},
          {name:'IOC' as const,description:'Execute immediately and cancel the unfilled portion.'},
          {name:'FOK' as const,description:'The order will either be executed immediately in full or automatically canceled.'}
        ].map(item=><button type="button" key={item.name} className={'sire-futures-order-option '+(timeInForce===item.name?'selected':'')} onClick={()=>{setTimeInForce(item.name);setTimeInForceDrawer(false)}}>
          <span className="sire-futures-order-option-copy"><b>{item.name}</b><small>{item.description}</small></span><i aria-hidden="true">{timeInForce===item.name?'✓':''}</i>
        </button>)}
      </section>
    </div>}

    {orderDrawer&&<div className="sire-futures-order-backdrop" onClick={()=>setOrderDrawer(false)}>
      <section className="sire-futures-order-drawer" role="dialog" aria-modal="true" aria-label="Choose order type" onClick={e=>e.stopPropagation()}>
        <div className="sire-futures-order-drawer-head"><strong>Order type</strong><button type="button" aria-label="Close order type drawer" onClick={()=>setOrderDrawer(false)}>×</button></div>
        <div className="sire-futures-order-group-title">Basic order</div>
        {[
          {name:'Limit order',description:'Buy or sell at the specified price or better.'},
          {name:'Market order',description:'Buy or sell immediately at the best market price.'}
        ].map(item=><button type="button" key={item.name} className={'sire-futures-order-option '+((orderType===item.name.replace(' order','')||orderType===item.name)?'selected':'')} onClick={()=>{setOrderType(item.name==='Limit order'?'Limit':'Market');setOrderDrawer(false)}}>
          <span className="sire-futures-order-option-copy"><b>{item.name}</b><small>{item.description}</small></span><i aria-hidden="true">{(orderType===(item.name==='Limit order'?'Limit':'Market'))?'✓':''}</i>
        </button>)}
        <div className="sire-futures-order-group-title">Advanced order</div>
        {[
          {name:'Advanced limit order',description:'Includes Post Only, Fill or Kill (FOK), and Immediate or Cancel (IOC).'},
          {name:'Trigger order',description:'When the preset target price is reached, it triggers a limit or market order.'},
          {name:'Trailing stop order',description:'During a market pullback, it triggers a limit or market order when the set trail variance is reached.'}
        ].map(item=><button type="button" key={item.name} className={'sire-futures-order-option '+(orderType===item.name?'selected':'')} onClick={()=>{setOrderType(item.name);setOrderDrawer(false)}}>
          <span className="sire-futures-order-option-copy"><b>{item.name}</b><small>{item.description}</small></span><i aria-hidden="true">{orderType===item.name?'✓':''}</i>
        </button>)}
        <div className="sire-futures-order-group-title">Split large order</div>
        {[
          {name:'Iceberg order',description:'Split large orders to reduce slippage.'},
          {name:'TWAP',description:'Triggers limit or market orders at custom time intervals.'}
        ].map(item=><button type="button" key={item.name} className={'sire-futures-order-option '+(orderType===item.name?'selected':'')} onClick={()=>{setOrderType(item.name);setOrderDrawer(false)}}>
          <span className="sire-futures-order-option-copy"><b>{item.name}</b><small>{item.description}</small></span><i aria-hidden="true">{orderType===item.name?'✓':''}</i>
        </button>)}
      </section>
    </div>}

    {picker&&<div className="sire-futures-picker-backdrop" onClick={()=>setPicker(false)}><section className="sire-futures-picker" onClick={e=>e.stopPropagation()}>
      <div className="sire-futures-picker-head"><strong>Select futures contract</strong><button onClick={()=>setPicker(false)}>×</button></div>
      <div className="sire-futures-search"><Search size={14}/><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search BTC, ETH, SOL…"/></div>
      <div className="sire-futures-list">{filtered.slice(0,120).map(item=><button key={item.symbol} onClick={()=>{setSelected(item);setPicker(false);setSearch('')}}><span><b>{item.symbol}</b><small>{item.name}</small></span><strong>{item.price?priceFmt(Number(item.price)):'—'}</strong></button>)}</div>
    </section></div>}
    {loading&&<div className="sire-futures-loading"><LoaderCircle className="sire-spin" size={15}/> Loading futures…</div>}
  </div>;
}
