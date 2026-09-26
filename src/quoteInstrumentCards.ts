const STYLE_ID = 'sire-quote-instrument-cards-style';
const WS_URLS = [
  'wss://api.derivws.com/trading/v1/options/ws/public',
  'wss://ws.binaryws.com/websockets/v3',
];

type QuoteState = { quote: number; previous?: number; bid?: number; ask?: number; epoch?: number };
const quotes = new Map<string, QuoteState>();
let socket: WebSocket | null = null;
let socketUrlIndex = 0;
let reconnectTimer = 0;
let observer: MutationObserver | null = null;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .sire-tab-quote .symbol-list .symbol-row {
      position:relative!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;grid-template-rows:auto 18px!important;
      align-items:start!important;gap:0 10px!important;min-height:80px!important;height:80px!important;padding:10px 12px!important;border-radius:16px!important;
      border:1px solid rgba(255,255,255,.09)!important;background:rgba(15,17,22,.46)!important;
      -webkit-backdrop-filter:blur(18px) saturate(135%)!important;backdrop-filter:blur(18px) saturate(135%)!important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 10px 28px rgba(0,0,0,.18)!important;overflow:hidden!important;
      transition:border-color .22s ease,box-shadow .22s ease,transform .16s ease!important;
    }
    .sire-tab-quote .symbol-list .symbol-row::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;border:1px solid transparent;opacity:.9;transition:border-color .22s ease,box-shadow .22s ease!important}
    .sire-tab-quote .symbol-list .symbol-row[data-price-state="up"]::before{border-color:rgba(45,235,139,.88);box-shadow:0 0 16px rgba(45,235,139,.34),0 0 34px rgba(45,235,139,.14) inset}
    .sire-tab-quote .symbol-list .symbol-row[data-price-state="down"]::before{border-color:rgba(255,72,88,.88);box-shadow:0 0 16px rgba(255,72,88,.34),0 0 34px rgba(255,72,88,.14) inset}
    .sire-tab-quote .symbol-list .symbol-row[data-price-state="flat"]::before{border-color:rgba(110,150,255,.32)}
    .sire-tab-quote .symbol-list .symbol-row>span:first-child{grid-column:1;grid-row:1;min-width:0;display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:3px!important;text-align:left!important}
    .sire-tab-quote .symbol-list .symbol-row>span:first-child b{display:block!important;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px!important;font-weight:850!important;line-height:1.15!important}
    .sire-tab-quote .symbol-list .symbol-row>span:first-child small{font-size:10px!important;opacity:.52!important;letter-spacing:.04em!important}
    .sire-tab-quote .symbol-list .symbol-row .sire-quote-price{grid-column:2;grid-row:1;align-self:start;text-align:right;min-width:72px;font-size:15px!important;font-weight:900!important;line-height:1.15!important;font-variant-numeric:tabular-nums;white-space:nowrap}
    .sire-tab-quote .symbol-list .symbol-row[data-price-state="up"] .sire-quote-price{color:#52f39a!important}
    .sire-tab-quote .symbol-list .symbol-row[data-price-state="down"] .sire-quote-price{color:#ff6674!important}
    .sire-tab-quote .symbol-list .symbol-row[data-price-state="flat"] .sire-quote-price{color:rgba(245,249,255,.92)!important}
    .sire-tab-quote .symbol-list .symbol-row .sire-quote-details{position:absolute!important;left:12px!important;right:12px!important;bottom:7px!important;display:flex;align-items:center;gap:10px;min-height:12px!important;color:rgba(235,240,250,.58);font-size:9px;font-weight:650;letter-spacing:.02em;font-variant-numeric:tabular-nums;line-height:12px!important;white-space:nowrap}
    .sire-tab-quote .symbol-list .symbol-row .sire-quote-details b{color:rgba(235,240,250,.9);font-weight:800}
    .sire-tab-quote .symbol-list .symbol-row>em{display:none!important}
    .sire-tab-quote .symbol-list{flex:1 1 0!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-y!important}
    .sire-tab-quote .symbol-list .symbol-row{touch-action:pan-y!important}
    .sire-tab-quote .sire-market-providers{max-width:760px;width:100%;margin:0 auto 8px;display:flex;gap:5px;overflow-x:auto;scrollbar-width:none;touch-action:pan-x}.sire-tab-quote .sire-market-providers::-webkit-scrollbar{display:none}
    .sire-tab-quote .sire-market-providers button{border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.035);color:rgba(235,240,250,.62);border-radius:999px;padding:5px 9px;font-size:10px;font-weight:750;white-space:nowrap}
    .sire-tab-quote .sire-market-providers button.active{background:rgba(255,255,255,.10);color:#fff;border-color:rgba(255,255,255,.18)}
    .sire-tab-quote .quote-instrument-name{display:flex!important;flex-direction:row!important;align-items:center!important;gap:6px!important}
    .sire-tab-quote .quote-asset-logo{width:24px!important;height:24px!important;flex:0 0 24px!important;object-fit:contain!important;border-radius:50%!important;background:rgba(255,255,255,.05)!important;padding:3px!important;box-sizing:border-box!important}
    .sire-tab-quote .quote-instrument-name b{min-width:0}
    .sire-tab-quote .quote-status-dot{display:inline-block!important;flex:0 0 auto;width:7px!important;height:7px!important;border-radius:50%!important}
    .sire-tab-quote .quote-status-dot--live{background:#28e36f!important;box-shadow:0 0 7px rgba(40,227,111,.65)!important}
    .sire-tab-quote .quote-status-dot--off{background:#f2c94c!important;box-shadow:0 0 7px rgba(242,201,76,.45)!important}
  `;
  document.head.appendChild(style);
}

function formatPrice(value:number|undefined){return Number.isFinite(value)?Number(value).toLocaleString(undefined,{maximumFractionDigits:8}):'—'}
function symbolsFromRows(){return Array.from(document.querySelectorAll<HTMLButtonElement>('.sire-tab-quote .symbol-list .symbol-row[data-provider="DERIV"]')).map(row=>(row.querySelector('small')?.textContent||'').trim().split(' · ')[0]).filter(Boolean)}
function ensureCardParts(row:HTMLButtonElement){
  let price=row.querySelector<HTMLElement>('.sire-quote-price');
  let details=row.querySelector<HTMLElement>('.sire-quote-details');
  if(!price){price=document.createElement('strong');price.className='sire-quote-price';price.textContent='—';row.appendChild(price)}
  if(!details){details=document.createElement('div');details.className='sire-quote-details';details.innerHTML='<span>Bid <b>—</b></span><span>Ask <b>—</b></span>';row.appendChild(details)}
  return {price,details};
}
function decorateRows(){
  document.querySelectorAll<HTMLButtonElement>('.sire-tab-quote .symbol-list .symbol-row').forEach(row=>{
    const {price,details}=ensureCardParts(row); const symbol=(row.querySelector('small')?.textContent||'').trim().split(' · ')[0]; const state=symbol?quotes.get(symbol):undefined;
    if(!state){
      const staticPrice=Number(row.dataset.price);
      const staticBid=Number(row.dataset.bid);
      const staticAsk=Number(row.dataset.ask);
      if(Number.isFinite(staticPrice)){
        const nextPrice=formatPrice(staticPrice);
        if(price.textContent!==nextPrice)price.textContent=nextPrice;
        row.dataset.priceState='flat';
        const nextDetails=`<span>Bid <b>${formatPrice(staticBid||staticPrice)}</b></span><span>Ask <b>${formatPrice(staticAsk||staticPrice)}</b></span>`;
        if(details.innerHTML!==nextDetails)details.innerHTML=nextDetails;
      } else {
        if(price.textContent!=='—')price.textContent='—';
        row.removeAttribute('data-price-state');
      }
      return
    }
    const nextPrice=formatPrice(state.quote);if(price.textContent!==nextPrice)price.textContent=nextPrice;
    const delta=state.previous===undefined?0:state.quote-state.previous;const nextState=delta>0?'up':delta<0?'down':'flat';if(row.dataset.priceState!==nextState)row.dataset.priceState=nextState;
    const nextDetails=`<span>Bid <b>${formatPrice(state.bid??state.quote)}</b></span><span>Ask <b>${formatPrice(state.ask??state.quote)}</b></span>`;
    if(details.innerHTML!==nextDetails)details.innerHTML=nextDetails;
  });
}
function closeSocket(){if(socket){const current=socket;socket=null;try{current.close()}catch{}}}
function connect(){
  if(!document.querySelector('.sire-tab-quote .symbol-list'))return;
  if(socket&&(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING))return;
  const url=WS_URLS[socketUrlIndex];try{socket=new WebSocket(url)}catch{socket=null;return}
  socket.onopen=()=>{Array.from(new Set(symbolsFromRows())).forEach(symbol=>{try{socket?.send(JSON.stringify({ticks:symbol,subscribe:1}))}catch{}})};
  socket.onmessage=event=>{try{
    const data=JSON.parse(event.data) as Record<string,unknown>;
    if(data.error){const error=data.error as Record<string,unknown>;const message=String(error.message||'').toLowerCase();if(message.includes('not authorized')||message.includes('not supported')||message.includes('invalid')||message.includes('ticks')){socketUrlIndex=(socketUrlIndex+1)%WS_URLS.length;closeSocket();window.clearTimeout(reconnectTimer);reconnectTimer=window.setTimeout(connect,250)}return}
    if(data.msg_type!=='tick'||!data.tick||typeof data.tick!=='object')return;
    const tick=data.tick as Record<string,unknown>;const symbol=String(tick.symbol||tick.underlying_symbol||'');const quote=Number(tick.quote);if(!symbol||!Number.isFinite(quote))return;
    const old=quotes.get(symbol);quotes.set(symbol,{quote,previous:old?.quote,bid:Number.isFinite(Number(tick.bid))?Number(tick.bid):undefined,ask:Number.isFinite(Number(tick.ask))?Number(tick.ask):undefined,epoch:Number.isFinite(Number(tick.epoch))?Number(tick.epoch):undefined});decorateRows();
  }catch{}};
  socket.onclose=()=>{socket=null;window.clearTimeout(reconnectTimer);reconnectTimer=window.setTimeout(connect,1800)};
  socket.onerror=()=>{socketUrlIndex=(socketUrlIndex+1)%WS_URLS.length;try{socket?.close()}catch{}};
}
function install(){installStyles();decorateRows();connect();if(!observer){observer=new MutationObserver(()=>{decorateRows();connect()});observer.observe(document.body,{childList:true,subtree:true})}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();

// React can mount Quote before or after its tab class is applied. Re-check briefly so the first visit is fully hydrated.
const rootObserver=new MutationObserver(()=>{if(document.getElementById('root')?.classList.contains('sire-tab-quote')){decorateRows();connect()}});
rootObserver.observe(document.getElementById('root')||document.documentElement,{attributes:true,attributeFilter:['class']});
window.setInterval(()=>{if(document.getElementById('root')?.classList.contains('sire-tab-quote')){decorateRows();connect()}},300);
