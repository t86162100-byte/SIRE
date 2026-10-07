import { createHmac } from 'node:crypto';

export type ExternalSpotRequest = {
  provider:string;
  symbol:string;
  side:'BUY'|'SELL';
  quantity:number;
  orderType:'MARKET'|'LIMIT';
  limitPrice?:number;
  clientOrderId:string;
};

export type ExternalSpotQuote = {
  provider:string;
  symbol:string;
  side:'BUY'|'SELL';
  quantity:number;
  price:number;
  total:number;
  expiresAt?:number;
  quoteId?:string;
};

export type ExternalSpotFill = {
  provider:string;
  externalOrderId:string;
  symbol:string;
  side:'BUY'|'SELL';
  price:number;
  quantity:number;
  fee?:number;
  feeAsset?:string;
  status:'FILLED'|'PARTIAL'|'REJECTED'|'PENDING';
};

function urlFor(provider:string){
  const key=provider==='WINTERMUTE' ? 'SIRE_LIQUIDITY_WINTERMUTE_EXECUTION_URL' : 'SIRE_LIQUIDITY_EXECUTION_URL';
  return String(process.env[key]||'').trim().replace(/\/$/,'');
}

function tokenFor(provider:string){
  const key=provider==='WINTERMUTE' ? 'SIRE_LIQUIDITY_WINTERMUTE_TOKEN' : 'SIRE_LIQUIDITY_TOKEN';
  return String(process.env[key]||'').trim();
}

async function callProvider(provider:string,path:string,body:any){
  const base=urlFor(provider);
  if(!base) throw new Error(`External execution for ${provider} is not configured.`);
  const token=tokenFor(provider);
  const payload=JSON.stringify(body);
  const secret=String(process.env.SIRE_LIQUIDITY_SIGNING_SECRET||'').trim();
  const signature=secret ? createHmac('sha256',secret).update(payload).digest('hex') : '';
  const response=await fetch(base+path,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      Accept:'application/json',
      ...(token ? {Authorization:`Bearer ${token}`} : {}),
      ...(signature ? {'X-SIRE-Signature':signature} : {}),
    },
    body:payload,
    signal:AbortSignal.timeout(10000),
  });
  const raw=await response.text();
  let data:any={};
  try{data=raw?JSON.parse(raw):{};}catch{data={raw};}
  if(!response.ok) throw new Error(`${provider} execution gateway rejected request (${response.status}): ${String(data?.error||data?.message||raw).slice(0,500)}`);
  return data;
}

function positiveNumber(value:any,name:string){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0) throw new Error(`Invalid ${name} from liquidity provider.`);
  return n;
}

export async function externalSpotQuote(request:ExternalSpotRequest):Promise<ExternalSpotQuote>{
  const data=await callProvider(request.provider,'/v1/quote',request);
  const price=positiveNumber(data?.price,'quote price');
  const quantity=positiveNumber(data?.quantity ?? request.quantity,'quote quantity');
  const total=positiveNumber(data?.total ?? price*quantity,'quote total');
  return {provider:request.provider,symbol:request.symbol,side:request.side,quantity,price,total,expiresAt:Number(data?.expiresAt)||undefined,quoteId:data?.quoteId?String(data.quoteId):undefined};
}

export async function externalSpotExecute(request:ExternalSpotRequest):Promise<ExternalSpotFill[]>{
  const data=await callProvider(request.provider,'/v1/orders',request);
  const fills=Array.isArray(data?.fills)?data.fills:[data];
  return fills.map((fill:any)=>{
    const status=String(fill?.status||data?.status||'FILLED').toUpperCase();
    if(!['FILLED','PARTIAL','REJECTED','PENDING'].includes(status)) throw new Error('Invalid external execution status.');
    if(status==='PENDING') throw new Error('External provider returned a pending order; synchronous SIRE settlement requires a final fill or explicit cancel before settlement.');
    return {
      provider:request.provider,
      externalOrderId:String(fill?.externalOrderId||data?.externalOrderId||''),
      symbol:request.symbol,
      side:request.side,
      price:positiveNumber(fill?.price,'fill price'),
      quantity:positiveNumber(fill?.quantity,'fill quantity'),
      fee:Number.isFinite(Number(fill?.fee))?Number(fill.fee):undefined,
      feeAsset:fill?.feeAsset?String(fill.feeAsset):undefined,
      status:status as ExternalSpotFill['status']
    };
  });
}
