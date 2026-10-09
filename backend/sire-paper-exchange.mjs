const CATEGORIES = new Set(['SPOT','MARGIN','USDT-FUTURES','COIN-FUTURES','USDC-FUTURES']);
const FUTURES = new Set(['USDT-FUTURES','COIN-FUTURES','USDC-FUTURES']);
const TERMINAL = new Set(['filled','cancelled','rejected']);

let sequence = 0;
const orders = new Map();
const triggers = new Map();
const positions = new Map();
const leverage = new Map();
const clientIds = new Map();
const balances = new Map([['USDT', 100000], ['USDC', 100000], ['BTC', 10], ['ETH', 100], ['SOL', 10000]]);
const now = () => Date.now();
const positive = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(label + ' must be greater than zero.');
  return n;
};
const categoryOf = value => String(value || 'SPOT').toUpperCase();
const symbolOf = value => String(value || '').trim().toUpperCase();
const oidOf = value => String(value || '').trim().slice(0, 32) || 'SIRE_PAPER_' + now() + '_' + (++sequence);
const idOf = prefix => 'PAPER_' + prefix + '_' + now() + '_' + (++sequence);
const quoteOf = symbol => ['USDT','USDC','BTC','ETH'].find(q => symbol.endsWith(q)) || 'USDT';
const baseOf = symbol => symbol.slice(0, -quoteOf(symbol).length);
function serial(row) { return row ? { ...row } : null; }
function applyFill(order, price, quantity) {
  const qty = Math.min(order.remaining, quantity);
  if (qty <= 0) return;
  order.filledQty += qty;
  order.remaining = Math.max(0, order.qty - order.filledQty);
  order.avgPrice = order.filledQty ? ((order.avgPrice * (order.filledQty - qty)) + price * qty) / order.filledQty : price;
  order.status = order.remaining <= 1e-12 ? 'filled' : 'partially_filled';
  order.updatedAt = now();
  order.fills.push({ price, qty, fee: price * qty * 0.0006, time: now() });
  if (FUTURES.has(order.category)) {
    const key = order.category + ':' + order.symbol + ':' + (order.posSide || (order.side === 'buy' ? 'long' : 'short'));
    const prior = positions.get(key) || { category: order.category, symbol: order.symbol, posSide: order.posSide || (order.side === 'buy' ? 'long' : 'short'), total: 0, avgPrice: 0, leverage: 10, marginMode: order.marginMode || 'crossed', unrealisedPnl: 0 };
    const closing = order.tradeSide === 'close' || order.reduceOnly === 'yes';
    if (closing) prior.total = Math.max(0, prior.total - qty);
    else {
      prior.avgPrice = prior.total ? ((prior.avgPrice * prior.total) + price * qty) / (prior.total + qty) : price;
      prior.total += qty;
    }
    positions.set(key, prior);
  } else {
    const base = baseOf(order.symbol), quote = quoteOf(order.symbol);
    if (order.side === 'buy') { balances.set(quote, (balances.get(quote) || 0) - price * qty); balances.set(base, (balances.get(base) || 0) + qty); }
    else { balances.set(base, (balances.get(base) || 0) - qty); balances.set(quote, (balances.get(quote) || 0) + price * qty); }
  }
}
export function paperReset() {
  sequence = 0; orders.clear(); triggers.clear(); positions.clear(); leverage.clear(); clientIds.clear();
  balances.clear(); for (const [k,v] of [['USDT',100000],['USDC',100000],['BTC',10],['ETH',100],['SOL',10000]]) balances.set(k,v);
  return { ok:true, mode:'PAPER', reset:true };
}
export function paperPlaceOrder(input, market = {}) {
  const category = categoryOf(input?.category), symbol = symbolOf(input?.symbol), side = String(input?.side || '').toLowerCase(), orderType = String(input?.orderType || '').toLowerCase();
  if (!CATEGORIES.has(category)) throw new Error('Unsupported paper category.');
  if (!/^[A-Z0-9_]{3,32}$/.test(symbol)) throw new Error('A valid symbol is required.');
  if (!['buy','sell'].includes(side)) throw new Error('Side must be buy or sell.');
  if (!['market','limit'].includes(orderType)) throw new Error('Order type must be market or limit.');
  const qty = positive(input?.qty, 'Quantity');
  const price = orderType === 'limit' ? positive(input?.price, 'Limit price') : positive(side === 'buy' ? (market.ask || market.price) : (market.bid || market.price), 'Paper market price');
  const clientOid = oidOf(input?.clientOid);
  if (clientIds.has(clientOid)) return { ok:true, mode:'PAPER', duplicate:true, order:serial(orders.get(clientIds.get(clientOid))) };
  const row = { orderId:idOf('ORDER'), clientOid, category, symbol, side, orderType, price:orderType==='limit'?price:null, qty, remaining:qty, filledQty:0, avgPrice:0, status:'new', tradeSide:String(input?.tradeSide||'open'), posSide:String(input?.posSide||'').toLowerCase(), marginMode:String(input?.marginMode||'crossed'), reduceOnly:String(input?.reduceOnly||'no'), timeInForce:String(input?.timeInForce||'gtc'), createdAt:now(), updatedAt:now(), fills:[] };
  orders.set(row.orderId,row); clientIds.set(clientOid,row.orderId);
  if (orderType === 'market') applyFill(row, price, qty);
  else {
    const ask=Number(market.ask||market.price||0), bid=Number(market.bid||market.price||0);
    if ((side==='buy' && ask>0 && price>=ask) || (side==='sell' && bid>0 && price<=bid)) applyFill(row, side==='buy'?ask:bid, qty);
  }
  return { ok:true, mode:'PAPER', order:serial(row) };
}
export function paperPlaceTrigger(input) {
  const category=categoryOf(input?.category), symbol=symbolOf(input?.symbol), side=String(input?.side||'').toLowerCase(), qty=positive(input?.qty,'Trigger quantity');
  if (!CATEGORIES.has(category)) throw new Error('Unsupported paper category.');
  if (!/^[A-Z0-9_]{3,32}$/.test(symbol)||!['buy','sell'].includes(side)) throw new Error('Invalid trigger symbol or side.');
  const row={orderId:idOf('TRIGGER'),clientOid:oidOf(input?.clientOid),category,symbol,side,qty,triggerPrice:positive(input?.triggerPrice,'Trigger price'),orderType:String(input?.orderType||'market').toLowerCase(),planType:String(input?.planType||'normal_plan'),status:'live',isTrigger:true,createdAt:now(),updatedAt:now()};
  if (!['market','limit'].includes(row.orderType)) throw new Error('Trigger execution must be market or limit.');
  if (row.orderType==='limit') row.price=positive(input?.price,'Trigger limit price');
  triggers.set(row.orderId,row);
  return {ok:true,mode:'PAPER',order:serial(row)};
}
export function paperCancelOrder(input) {
  const row=[...orders.values()].find(o=>o.orderId===String(input?.orderId||'')||o.clientOid===String(input?.clientOid||''));
  if(!row) throw new Error('Paper order not found.');
  if(TERMINAL.has(row.status)) return {ok:true,mode:'PAPER',order:serial(row),alreadyTerminal:true};
  row.status='cancelled';row.updatedAt=now();
  return {ok:true,mode:'PAPER',order:serial(row)};
}
export function paperModifyOrder(input) {
  const row=[...orders.values()].find(o=>o.orderId===String(input?.orderId||'')||o.clientOid===String(input?.clientOid||''));
  if(!row) throw new Error('Paper order not found.');
  if(TERMINAL.has(row.status)) throw new Error('Cannot modify a terminal paper order.');
  if(input?.qty!=null&&input.qty!==''){const qty=positive(input.qty,'Quantity');if(qty<row.filledQty)throw new Error('New quantity cannot be below already-filled quantity.');row.qty=qty;row.remaining=qty-row.filledQty;}
  if(input?.price!=null&&input.price!=='')row.price=positive(input.price,'Limit price');
  row.updatedAt=now();return {ok:true,mode:'PAPER',order:serial(row)};
}
export function paperCancelTrigger(input) {
  const row=[...triggers.values()].find(o=>o.orderId===String(input?.orderId||'')||o.clientOid===String(input?.clientOid||''));
  if(!row) throw new Error('Paper trigger order not found.');
  if(row.status!=='live')return {ok:true,mode:'PAPER',order:serial(row),alreadyTerminal:true};
  row.status='cancelled';row.updatedAt=now();return {ok:true,mode:'PAPER',order:serial(row)};
}
export function paperModifyTrigger(input) {
  const row=[...triggers.values()].find(o=>o.orderId===String(input?.orderId||'')||o.clientOid===String(input?.clientOid||''));
  if(!row||row.status!=='live')throw new Error('Live paper trigger order not found.');
  if(input?.triggerPrice!=null&&input.triggerPrice!=='')row.triggerPrice=positive(input.triggerPrice,'Trigger price');
  if(input?.price!=null&&input.price!=='')row.price=positive(input.price,'Trigger limit price');
  row.updatedAt=now();return {ok:true,mode:'PAPER',order:serial(row)};
}
export function paperCancelAll(category, symbol='') {
  const c=categoryOf(category), s=symbolOf(symbol);let cancelled=0;
  for(const row of orders.values())if(row.category===c&&(!s||row.symbol===s)&&!TERMINAL.has(row.status)){row.status='cancelled';row.updatedAt=now();cancelled++;}
  for(const row of triggers.values())if(row.category===c&&(!s||row.symbol===s)&&row.status==='live'){row.status='cancelled';row.updatedAt=now();cancelled++;}
  return {ok:true,mode:'PAPER',category:c,cancelled,failed:0};
}
export function paperListOrders(category, symbol='', history=false) {
  const c=categoryOf(category), s=symbolOf(symbol);
  const rows=[...orders.values()].filter(o=>o.category===c&&(!s||o.symbol===s));
  return {ok:true,mode:'PAPER',category:c,orders:rows.filter(o=>history?TERMINAL.has(o.status):!TERMINAL.has(o.status)).map(serial)};
}
export function paperListTriggers(category, symbol='') {
  const c=categoryOf(category), s=symbolOf(symbol);
  return {ok:true,mode:'PAPER',orders:[...triggers.values()].filter(o=>o.category===c&&(!s||o.symbol===s)&&o.status==='live').map(serial)};
}
export function paperPositions(category, symbol='') {
  const c=categoryOf(category), s=symbolOf(symbol);
  return {ok:true,mode:'PAPER',category:c,positions:[...positions.values()].filter(p=>p.category===c&&(!s||p.symbol===s)&&p.total>0).map(p=>({...p,total:String(p.total),avgPrice:String(p.avgPrice),leverage:String(p.leverage),unrealisedPnl:String(p.unrealisedPnl)}))};
}
export function paperAccount() {
  return {ok:true,mode:'PAPER',accountEquity:100000,assets:[...balances.entries()].map(([coin,available])=>({coin,available:String(available),locked:'0'}))};
}
export function paperSetLeverage(input) {
  const category=categoryOf(input?.category), symbol=symbolOf(input?.symbol), value=positive(input?.leverage,'Leverage');
  if(!FUTURES.has(category)||!symbol||value>125)throw new Error('Invalid paper futures leverage.');
  leverage.set(category+':'+symbol,value);
  for(const [key,p] of positions)if(key.startsWith(category+':'+symbol+':'))p.leverage=value;
  return {ok:true,mode:'PAPER',category,symbol,leverage:value};
}
export function paperOrderHistory() { return [...orders.values()].map(serial); }
