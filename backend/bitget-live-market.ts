import { WebSocket } from 'ws';

const BITGET_WS_URL = 'wss://ws.bitget.com/v3/ws/public';
const PING_MS = 25_000;
const RECONNECT_MS = 2_000;

type SubKey = string;
type Client = { send:(data:string)=>void; close?:()=>void };

type LiveEvent = {
  provider:'BITGET';
  type:'ticker'|'depth';
  instType:string;
  symbol:string;
  timestamp:number;
  exchangeTimestamp?:number;
  seq?:string;
  pseq?:string;
  action?:string;
  price?:number;
  bid?:number;
  ask?:number;
  bidSize?:number;
  askSize?:number;
  change24h?:number;
  volume24h?:number;
  quoteVolume24h?:number;
  high24h?:number;
  low24h?:number;
  bids?:Array<[number,number]>;
  asks?:Array<[number,number]>;
  source:'BITGET_WS';
};

const upstreamSubscriptions = new Set<SubKey>();
const clients = new Map<Client, Set<SubKey>>();
const diagnosticKeys = new Set<SubKey>();
const stats = new Map<SubKey,{ticks:number;depthUpdates:number;lastTickAt:number|null;lastBookAt:number|null;lastSeq:string|null;lastPseq:string|null;lastPrice:number|null}>();

let upstream: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let pingTimer: NodeJS.Timeout | null = null;
let connectPromise: Promise<void> | null = null;

const keyOf = (instType:string,symbol:string) => String(instType).toLowerCase()+':'+String(symbol).toUpperCase();
const safeNumber = (v:any) => { const n=Number(v); return Number.isFinite(n) ? n : undefined; };

function statFor(key:SubKey){
  let stat=stats.get(key);
  if(!stat){stat={ticks:0,depthUpdates:0,lastTickAt:null,lastBookAt:null,lastSeq:null,lastPseq:null,lastPrice:null};stats.set(key,stat);}
  return stat;
}

function broadcast(event:LiveEvent){
  const key=keyOf(event.instType,event.symbol);
  const raw=JSON.stringify({v:1,type:'bitget.market.update',payload:event});
  for(const [client,subs] of clients){
    if(subs.has(key)){
      try{client.send(raw);}catch{}
    }
  }
}

function logDiagnostic(event:LiveEvent){
  if(!diagnosticKeys.has(keyOf(event.instType,event.symbol))) return;
  const stat=statFor(keyOf(event.instType,event.symbol));
  const interesting = event.type==='depth' ? event.seq : event.price;
  if((stat.ticks+stat.depthUpdates)<=3 || ((stat.ticks+stat.depthUpdates)%25===0)){
    console.log('[BITGET LIVE DIAG]',JSON.stringify({
      instType:event.instType,
      symbol:event.symbol,
      type:event.type,
      timestamp:event.timestamp,
      exchangeTimestamp:event.exchangeTimestamp??null,
      seq:event.seq??null,
      pseq:event.pseq??null,
      action:event.action??null,
      price:event.price??null,
      bid:event.bid??null,
      ask:event.ask??null,
      updates:stat.ticks+stat.depthUpdates,
      marker:interesting??null
    }));
  }
}

function ingest(message:any){
  if(message?.event==='error' || message?.code && message?.code!=='00000'){
    console.warn('[BITGET LIVE WS]',JSON.stringify({event:message?.event,code:message?.code,msg:message?.msg}));
    return;
  }
  if(message?.event==='subscribe') return;
  const arg=message?.arg;
  const instType=String(arg?.instType||'').toLowerCase();
  const symbol=String(arg?.symbol||'').toUpperCase();
  const topic=String(arg?.topic||'').toLowerCase();
  if(!instType || !symbol || !topic || !Array.isArray(message?.data)) return;
  for(const row of message.data){
    const ts=safeNumber(row?.ts) ?? safeNumber(message?.ts) ?? Date.now();
    const key=keyOf(instType,symbol);
    const stat=statFor(key);
    if(topic==='ticker'){
      const event:LiveEvent={
        provider:'BITGET',type:'ticker',instType,symbol,timestamp:Date.now(),
        exchangeTimestamp:ts,price:safeNumber(row?.lastPr),bid:safeNumber(row?.bidPr),ask:safeNumber(row?.askPr),
        bidSize:safeNumber(row?.bidSz),askSize:safeNumber(row?.askSz),change24h:safeNumber(row?.change24h),
        volume24h:safeNumber(row?.baseVolume),quoteVolume24h:safeNumber(row?.quoteVolume),
        high24h:safeNumber(row?.high24h),low24h:safeNumber(row?.low24h),source:'BITGET_WS'
      };
      stat.ticks++; stat.lastTickAt=event.timestamp; stat.lastPrice=event.price??stat.lastPrice;
      broadcast(event); logDiagnostic(event);
    }else if(topic==='books' || topic==='books50' || topic==='books5' || topic==='books1'){
      const bids=Array.isArray(row?.b)?row.b.map((x:any)=>[Number(x?.[0]),Number(x?.[1])] as [number,number]).filter((x:any)=>Number.isFinite(x[0])&&Number.isFinite(x[1])):[];
      const asks=Array.isArray(row?.a)?row.a.map((x:any)=>[Number(x?.[0]),Number(x?.[1])] as [number,number]).filter((x:any)=>Number.isFinite(x[0])&&Number.isFinite(x[1])):[];
      const event:LiveEvent={
        provider:'BITGET',type:'depth',instType,symbol,timestamp:Date.now(),
        exchangeTimestamp:ts,seq:row?.seq!=null?String(row.seq):undefined,pseq:row?.pseq!=null?String(row.pseq):undefined,
        action:String(message?.action||''),bids,asks,bid:bids[0]?.[0],ask:asks[0]?.[0],source:'BITGET_WS'
      };
      stat.depthUpdates++; stat.lastBookAt=event.timestamp; stat.lastSeq=event.seq??stat.lastSeq; stat.lastPseq=event.pseq??stat.lastPseq;
      broadcast(event); logDiagnostic(event);
    }
  }
}

async function connectUpstream(){
  if(upstream?.readyState===WebSocket.OPEN) return;
  if(connectPromise) return connectPromise;
  connectPromise=new Promise<void>((resolve)=>{
    const socket=new WebSocket(BITGET_WS_URL);
    upstream=socket;
    let opened=false;
    const timer=setTimeout(()=>{if(!opened){try{socket.close()}catch{}}},15_000);
    socket.on('open',()=>{
      opened=true;clearTimeout(timer);resolve();
      if(pingTimer) clearInterval(pingTimer);
      pingTimer=setInterval(()=>{if(socket.readyState===WebSocket.OPEN) socket.send('ping')},PING_MS);
      syncSubscriptions();
    });
    socket.on('message',data=>{const raw=String(data);if(raw==='pong')return;try{ingest(JSON.parse(raw))}catch{}});
    socket.on('error',error=>console.warn('[BITGET LIVE WS]',error instanceof Error?error.message:String(error)));
    socket.on('close',()=>{
      clearTimeout(timer);
      if(pingTimer){clearInterval(pingTimer);pingTimer=null;}
      if(upstream===socket) upstream=null;
      if(upstreamSubscriptions.size && !reconnectTimer) reconnectTimer=setTimeout(()=>{reconnectTimer=null;void connectUpstream()},RECONNECT_MS);
    });
  }).finally(()=>{connectPromise=null});
  return connectPromise;
}

function syncSubscriptions(){
  if(!upstream || upstream.readyState!==WebSocket.OPEN) return;
  const args=[...upstreamSubscriptions].map(key=>{
    const [instType,symbol]=key.split(':');
    return {instType,topic:'ticker',symbol};
  }).concat([...upstreamSubscriptions].map(key=>{
    const [instType,symbol]=key.split(':');
    return {instType,topic:'books5',symbol};
  }));
  if(args.length) upstream.send(JSON.stringify({op:'subscribe',args}));
}

function sendSubscriptionChanges(keys:string[],op:'subscribe'|'unsubscribe'){
  if(!upstream || upstream.readyState!==WebSocket.OPEN || !keys.length) return;
  const args=keys.map(key=>{
    const [instType,symbol]=key.split(':');
    return {instType,topic:'ticker',symbol};
  }).concat(keys.map(key=>{
    const [instType,symbol]=key.split(':');
    return {instType,topic:'books5',symbol};
  }));
  upstream.send(JSON.stringify({op,args}));
}

export async function bitgetMarketSubscribe(client:Client, subscriptions:Array<{instType:string;symbol:string}>){
  const set=clients.get(client) || new Set<SubKey>();
  const added:string[]=[];
  for(const item of subscriptions||[]){
    const instType=String(item?.instType||'').toLowerCase();
    const symbol=String(item?.symbol||'').toUpperCase();
    if(!['spot','usdt-futures','coin-futures','usdc-futures'].includes(instType)||!symbol) continue;
    const key=keyOf(instType,symbol);
    set.add(key);
    if(!upstreamSubscriptions.has(key)){upstreamSubscriptions.add(key);added.push(key);}
  }
  clients.set(client,set);
  if(added.length) { await connectUpstream(); sendSubscriptionChanges(added,'subscribe'); }
}

export function bitgetMarketUnsubscribe(client:Client, subscriptions:Array<{instType:string;symbol:string}>){
  const set=clients.get(client);
  if(!set)return;
  const removed:string[]=[];
  for(const item of subscriptions||[]){
    const key=keyOf(String(item?.instType||''),String(item?.symbol||''));
    set.delete(key);
    if(![...clients.values()].some(other=>other.has(key)) && !diagnosticKeys.has(key)){
      upstreamSubscriptions.delete(key);removed.push(key);
    }
  }
  if(removed.length)sendSubscriptionChanges(removed,'unsubscribe');
}

export function bitgetMarketDisconnect(client:Client){
  const set=clients.get(client);
  clients.delete(client);
  if(!set)return;
  const removed:string[]=[];
  for(const key of set){
    if(![...clients.values()].some(other=>other.has(key))&&!diagnosticKeys.has(key)){upstreamSubscriptions.delete(key);removed.push(key);}
  }
  if(removed.length)sendSubscriptionChanges(removed,'unsubscribe');
}

export async function startBitgetLiveDiagnostics(candidates:Array<{instType:string;symbol:string}>){
  const selected=candidates.slice(0,8);
  for(const item of selected){
    const key=keyOf(item.instType,item.symbol);
    diagnosticKeys.add(key);upstreamSubscriptions.add(key);
  }
  if(selected.length) await connectUpstream();
  console.log('[BITGET LIVE DIAG] subscriptions',JSON.stringify(selected));
}

export function bitgetLiveStatus(){
  const diagnostics=[...diagnosticKeys].map(key=>({key,...statFor(key)}));
  return {ok:true,connected:upstream?.readyState===WebSocket.OPEN,subscriptionCount:upstreamSubscriptions.size,clientCount:clients.size,diagnostics};
}
