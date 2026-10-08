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

const BITGET_BASE='https://api.bitget.com';

function positiveNumber(value:any,name:string){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0) throw new Error(`Invalid ${name} from liquidity provider.`);
  return n;
}

function bitgetConfig(){
  const apiKey=String(process.env.BITGET_API_KEY||'').trim();
  const secret=String(process.env.BITGET_API_SECRET||'').trim();
  const passphrase=String(process.env.BITGET_API_PASSPHRASE||'').trim();
  if(!apiKey||!secret||!passphrase) throw new Error('Bitget execution is not configured. BITGET_API_KEY, BITGET_API_SECRET and BITGET_API_PASSPHRASE are required.');
  return {apiKey,secret,passphrase,base:String(process.env.BITGET_API_BASE_URL||BITGET_BASE).trim().replace(/\/$/,'')};
}

function clientOid(value:string){
  const raw=String(value||'').replace(/[^0-9A-Za-z_:#\-+ ]/g,'').slice(0,32);
  return raw||`SIRE_${Date.now()}`.slice(0,32);
}

function sign(secret:string,timestamp:string,method:string,path:string,body:string){
  return createHmac('sha256',secret).update(timestamp+method.toUpperCase()+path+body).digest('base64');
}

async function bitgetRequest(method:'GET'|'POST',path:string,body?:any){
  const {apiKey,secret,passphrase,base}=bitgetConfig();
  const payload=method==='POST' ? JSON.stringify(body??{}) : '';
  const timestamp=String(Date.now());
  const signature=sign(secret,timestamp,method,path,payload);
  const response=await fetch(base+path,{
    method,
    headers:{
      'ACCESS-KEY':apiKey,
      'ACCESS-SIGN':signature,
      'ACCESS-TIMESTAMP':timestamp,
      'ACCESS-PASSPHRASE':passphrase,
      'Content-Type':'application/json',
      Accept:'application/json'
    },
    ...(method==='POST'?{body:payload}:{}),
    signal:AbortSignal.timeout(10000)
  });
  const raw=await response.text();
  let data:any={};
  try{data=raw?JSON.parse(raw):{};}catch{data={raw};}
  if(!response.ok || data?.code!=='00000'){
    throw new Error(`Bitget API rejected request (${response.status}/${String(data?.code||'unknown')}): ${String(data?.msg||raw).slice(0,500)}`);
  }
  return data;
}

async function bitgetPublic(path:string){
  const response=await fetch(BITGET_BASE+path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(5000)});
  const raw=await response.text();
  const data=raw?JSON.parse(raw):{};
  if(!response.ok||data?.code!=='00000') throw new Error(`Bitget market-data request failed: ${String(data?.msg||raw).slice(0,300)}`);
  return data;
}

async function bitgetSpotPrice(symbol:string){
  const data=await bitgetPublic(`/api/v3/market/tickers?category=SPOT&symbol=${encodeURIComponent(symbol)}`);
  const row=Array.isArray(data?.data)?data.data[0]:data?.data;
  return positiveNumber(row?.lastPrice??row?.last,'Bitget market price');
}

export async function bitgetAuthenticatedHealth(){
  try{
    const [assetsData,infoData,settingsData]=await Promise.all([
      bitgetRequest('GET','/api/v3/account/assets'),
      bitgetRequest('GET','/api/v3/account/info'),
      bitgetRequest('GET','/api/v3/account/settings')
    ]);
    const assets=Array.isArray(assetsData?.data?.assets)?assetsData.data.assets:[];
    const permissions=Array.isArray(infoData?.data?.permissions)?infoData.data.permissions.map((x:any)=>String(x)):[]; 
    const permType=String(infoData?.data?.permType||'');
    const accountMode=String(settingsData?.data?.accountMode||'');
    const accountLevel=String(settingsData?.data?.accountLevel||'');
    const utaManagement=permissions.includes('uta_mgt');
    const utaTrading=permissions.includes('uta_trade');
    return {
      ok:true,
      authenticated:true,
      detail:'Bitget authenticated API connection is working.',
      accountEquity:assetsData?.data?.accountEquity??null,
      assetCount:assets.length,
      permType,
      permissions,
      utaManagement,
      utaTrading,
      tradingReady:permType==='read-and-write' && utaManagement && utaTrading,
      accountMode,
      accountLevel
    };
  }catch(e){
    return {ok:false,authenticated:false,detail:e instanceof Error?e.message:String(e)};
  }
}

export async function bitgetMarketOrderBook(category:string,symbol:string,limit=25){
  const requested=String(category||'SPOT').toUpperCase();
  const actual=requested==='MARGIN'?'SPOT':requested;
  if(!['SPOT','USDT-FUTURES','COIN-FUTURES','USDC-FUTURES'].includes(actual)) throw new Error('Unsupported Bitget market category.');
  const safeLimit=Math.max(1,Math.min(100,Math.floor(Number(limit)||25)));
  const data=await bitgetPublic('/api/v3/market/orderbook?category='+encodeURIComponent(actual)+'&symbol='+encodeURIComponent(String(symbol).toUpperCase())+'&limit='+safeLimit);
  const row=data?.data||{};
  return {
    ok:true,source:'BITGET_REST',category:requested,symbol:String(symbol).toUpperCase(),
    ts:Number(row?.ts)||Date.now(),
    asks:Array.isArray(row?.a)?row.a.map((x:any)=>({price:Number(x?.[0]),quantity:Number(x?.[1])})).filter((x:any)=>Number.isFinite(x.price)&&Number.isFinite(x.quantity)) : [],
    bids:Array.isArray(row?.b)?row.b.map((x:any)=>({price:Number(x?.[0]),quantity:Number(x?.[1])})).filter((x:any)=>Number.isFinite(x.price)&&Number.isFinite(x.quantity)) : []
  };
}

export async function bitgetOwnerAccount(){
  const data=await bitgetRequest('GET','/api/v3/account/assets');
  return {ok:true,accountEquity:data?.data?.accountEquity??null,usdtEquity:data?.data?.usdtEquity??null,assets:Array.isArray(data?.data?.assets)?data.data.assets:[]};
}

export async function bitgetOwnerPlaceOrder(input:any){
  const category=String(input?.category||'SPOT').toUpperCase();
  const symbol=String(input?.symbol||'').trim().toUpperCase();
  const side=String(input?.side||'').trim().toLowerCase();
  const orderType=String(input?.orderType||'').trim().toLowerCase();
  const qty=positiveNumber(input?.qty,'order quantity');
  const price=input?.price==null||input?.price===''?undefined:positiveNumber(input.price,'order price');
  if(!['SPOT','MARGIN','USDT-FUTURES','COIN-FUTURES','USDC-FUTURES'].includes(category)) throw new Error('Unsupported Bitget order category.');
  if(!symbol) throw new Error('A Bitget symbol is required.');
  if(!['buy','sell'].includes(side)) throw new Error('Order side must be buy or sell.');
  if(!['market','limit'].includes(orderType)) throw new Error('Order type must be market or limit.');
  if(orderType==='limit'&&!price) throw new Error('Limit price is required.');
  const oid=clientOid(String(input?.clientOid||''));
  const body:any={category,symbol,side,orderType,qty:String(qty),clientOid:oid};
  if(category.endsWith('FUTURES')){
    const posSide=String(input?.posSide||'').trim().toLowerCase();
    const marginMode=String(input?.marginMode||'crossed').trim().toLowerCase();
    if(posSide && !['long','short'].includes(posSide)) throw new Error('Futures position side must be long or short.');
    if(!['crossed','isolated'].includes(marginMode)) throw new Error('Futures margin mode must be crossed or isolated.');
    if(posSide) body.posSide=posSide;
    body.marginMode=marginMode;
    if(String(input?.reduceOnly||'').toLowerCase()==='yes') body.reduceOnly='yes';
  }
  if(orderType==='limit'){body.price=String(price);body.timeInForce='gtc';}
  else body.timeInForce='ioc';
  const placed=await bitgetRequest('POST','/api/v3/trade/place-order',body);
  return {ok:true,provider:'BITGET',category,symbol,side,orderType,qty,price:price??null,orderId:String(placed?.data?.orderId||''),clientOid:String(placed?.data?.clientOid||oid)};
}

export async function bitgetOwnerFuturesPositions(category:string='USDT-FUTURES',symbol=''){
  const safeCategory=String(category||'USDT-FUTURES').toUpperCase();
  if(!['USDT-FUTURES','COIN-FUTURES','USDC-FUTURES'].includes(safeCategory)) throw new Error('Unsupported futures category.');
  const qs='category='+encodeURIComponent(safeCategory)+(symbol?'&symbol='+encodeURIComponent(String(symbol).toUpperCase()):'');
  const data=await bitgetRequest('GET','/api/v3/position/current-position?'+qs);
  return {ok:true,provider:'BITGET',category:safeCategory,positions:Array.isArray(data?.data?.list)?data.data.list:[]};
}

export async function bitgetOwnerSetFuturesLeverage(input:any){
  const category=String(input?.category||'USDT-FUTURES').toUpperCase();
  const symbol=String(input?.symbol||'').trim().toUpperCase();
  const leverage=positiveNumber(input?.leverage,'leverage');
  const marginMode=String(input?.marginMode||'crossed').trim().toLowerCase();
  if(!['USDT-FUTURES','COIN-FUTURES','USDC-FUTURES'].includes(category)) throw new Error('Unsupported futures category.');
  if(!symbol) throw new Error('A futures symbol is required.');
  if(!['crossed','isolated'].includes(marginMode)) throw new Error('Futures margin mode must be crossed or isolated.');
  const body:any={category,symbol,leverage:String(leverage),marginMode};
  const longLeverage=input?.longLeverage==null?'':String(input.longLeverage);
  const shortLeverage=input?.shortLeverage==null?'':String(input.shortLeverage);
  if(longLeverage) body.longLeverage=longLeverage;
  if(shortLeverage) body.shortLeverage=shortLeverage;
  const data=await bitgetRequest('POST','/api/v3/account/set-leverage',body);
  return {ok:true,provider:'BITGET',category,symbol,leverage,marginMode,data:data?.data||null};
}

export async function bitgetExecutionHealth(){
  try{
    bitgetConfig();
    const data=await bitgetPublic('/api/v3/market/time');
    return {ok:true,detail:'Bitget credentials are configured and public API is reachable.',serverTime:data?.data?.serverTime??null};
  }catch(e){
    return {ok:false,detail:e instanceof Error?e.message:String(e)};
  }
}

export async function externalSpotQuote(request:ExternalSpotRequest):Promise<ExternalSpotQuote>{
  if(request.provider==='BITGET'){
    const price=await bitgetSpotPrice(request.symbol);
    return {
      provider:'BITGET',symbol:request.symbol,side:request.side,quantity:request.quantity,
      price,total:price*request.quantity,expiresAt:Date.now()+3000
    };
  }
  throw new Error(`No direct execution adapter is configured for provider ${request.provider}.`);
}

async function cancelBitgetOrder(category:string,orderId:string,clientOidValue:string){
  return bitgetRequest('POST','/api/v3/trade/cancel-order',{category,orderId,clientOid:clientOidValue});
}

export async function externalSpotExecute(request:ExternalSpotRequest):Promise<ExternalSpotFill[]>{
  if(request.provider!=='BITGET') throw new Error(`No direct execution adapter is configured for provider ${request.provider}.`);
  if(request.orderType!=='MARKET' && request.orderType!=='LIMIT') throw new Error('Unsupported Bitget Spot order type.');

  const oid=clientOid(request.clientOrderId);
  const quotePrice=await bitgetSpotPrice(request.symbol);
  const qty=request.side==='BUY' ? String(request.quantity) : String(request.quantity);
  const placed=await bitgetRequest('POST','/api/v3/trade/place-order',{
    category:'SPOT',symbol:request.symbol,side:request.side.toLowerCase(),
    orderType:request.orderType.toLowerCase(),qty,clientOid:oid,timeInForce:request.orderType==='LIMIT'?'gtc':'ioc',...(request.orderType==='LIMIT'?{price:String(request.limitPrice)}:{})
  });
  const externalOrderId=String(placed?.data?.orderId||'');
  if(!externalOrderId) throw new Error('Bitget accepted the request without returning an order ID.');

  const deadline=Date.now()+(request.orderType==='LIMIT'?1500:8000);
  let detail:any=null;
  while(Date.now()<deadline){
    detail=(await bitgetRequest('GET',`/api/v3/trade/order-info?orderId=${encodeURIComponent(externalOrderId)}`))?.data;
    const status=String(detail?.orderStatus||'').toLowerCase();
    if(status==='filled'||status==='cancelled'||status==='partially_filled') break;
    await new Promise(r=>setTimeout(r,250));
  }

  const status=String(detail?.orderStatus||'').toLowerCase();
  if(request.orderType==='MARKET' && status!=='filled' && status!=='cancelled' && status!=='partially_filled'){
    await cancelBitgetOrder('SPOT',externalOrderId,oid).catch(()=>{});
    detail=(await bitgetRequest('GET',`/api/v3/trade/order-info?orderId=${encodeURIComponent(externalOrderId)}`))?.data;
  }

  const filled=positiveNumber(detail?.cumExecQty,'Bitget filled quantity');
  const avg=positiveNumber(detail?.avgPrice,'Bitget average fill price');
  const feeRows=Array.isArray(detail?.feeDetail)?detail.feeDetail:[];
  const feeRow=feeRows.find((x:any)=>Number(x?.fee)!==0)||feeRows[0];
  const fee=Math.abs(Number(feeRow?.fee||0));
  const feeAsset=feeRow?.feeCoin?String(feeRow.feeCoin):undefined;
  const finalStatus=String(detail?.orderStatus||'').toLowerCase();

  if(filled<=0){
    if(request.orderType==='LIMIT' && (finalStatus==='new'||finalStatus==='live'||finalStatus==='partially_filled')){
      return [{provider:'BITGET',externalOrderId,symbol:request.symbol,side:request.side,price:request.limitPrice||quotePrice,quantity:0,status:'PENDING'}];
    }
    if(finalStatus==='cancelled') throw new Error('Bitget cancelled the order without a fill.');
    throw new Error('Bitget returned no executed quantity.');
  }

  return [{
    provider:'BITGET',externalOrderId,symbol:request.symbol,side:request.side,
    price:avg,quantity:filled,fee:Number.isFinite(fee)?fee:undefined,feeAsset,
    status:finalStatus==='filled'?'FILLED':'PARTIAL'
  }];
}
