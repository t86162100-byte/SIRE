import { getSpotBook } from './sire-spot-engine.ts';

export type LiquidityLevel = { price:number; quantity:number };
export type LiquiditySnapshot = {
  symbol:string;
  bids:LiquidityLevel[];
  asks:LiquidityLevel[];
  source:string;
  receivedAt:number;
};

function symbolOf(value:string){
  const s=String(value||'').trim().toUpperCase();
  if(!/^[A-Z0-9]{4,30}$/.test(s)) throw new Error('Invalid Spot symbol.');
  return s;
}

function cleanLevels(value:any){
  if(!Array.isArray(value)) return [];
  return value.map((x:any)=>({price:Number(x?.price),quantity:Number(x?.quantity)}))
    .filter((x:any)=>Number.isFinite(x.price)&&x.price>0&&Number.isFinite(x.quantity)&&x.quantity>0);
}

export function spotLiquidityStatus(){
  const provider=String(process.env.SIRE_SPOT_LIQUIDITY_PROVIDER||'disabled').trim().toLowerCase();
  const configured=provider==='external-http' && Boolean(String(process.env.SIRE_SPOT_LIQUIDITY_URL||'').trim());
  return {
    configured,
    provider: configured ? 'external-http' : 'disabled',
    mode: configured ? 'BOOTSTRAP_EXTERNAL' : 'SIRE_ONLY',
    note: configured
      ? 'External liquidity is an adapter only; SIRE remains the order, account and settlement authority.'
      : 'No external liquidity provider is configured. SIRE does not fabricate liquidity.'
  };
}

async function externalSnapshot(symbol:string,depth:number):Promise<LiquiditySnapshot|null>{
  const status=spotLiquidityStatus();
  if(!status.configured) return null;
  const base=String(process.env.SIRE_SPOT_LIQUIDITY_URL||'').trim().replace(/\/$/,'');
  const url=new URL('/v1/liquidity/book',base);
  url.searchParams.set('symbol',symbol);
  url.searchParams.set('depth',String(Math.max(1,Math.min(100,Math.floor(Number(depth)||20)))));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),3000);
  try{
    const headers:any={accept:'application/json'};
    const token=String(process.env.SIRE_SPOT_LIQUIDITY_TOKEN||'').trim();
    if(token) headers.authorization='Bearer '+token;
    const response=await fetch(url,{headers,signal:controller.signal});
    if(!response.ok) throw new Error('Liquidity provider returned HTTP '+response.status);
    const body:any=await response.json();
    return {symbol,bids:cleanLevels(body?.bids),asks:cleanLevels(body?.asks),source:'external-http',receivedAt:Date.now()};
  }finally{clearTimeout(timer);}
}

export async function getRoutedSpotLiquidity(symbolInput:string,depth=20){
  const symbol=symbolOf(symbolInput);
  const native=await getSpotBook(symbol,depth);
  const external=await externalSnapshot(symbol,depth);
  if(!external) return {...native,liquidityMode:'SIRE_ONLY',external:null};
  const asks=[...native.asks,...external.asks].sort((a,b)=>a.price-b.price).slice(0,depth);
  const bids=[...native.bids,...external.bids].sort((a,b)=>b.price-a.price).slice(0,depth);
  return {...native,asks,bids,liquidityMode:'ROUTED',external:{provider:external.source,receivedAt:external.receivedAt}};
}
