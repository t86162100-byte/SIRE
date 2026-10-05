type Json = Record<string, any>;

const CG_BASE = 'https://api.coingecko.com/api/v3';
const CMC_BASE = 'https://pro-api.coinmarketcap.com/public-api';

type PlatformMeta = { id:string; name:string; shortname:string; nativeCoinId:string; logoUrl:string };
type AssetMeta = { symbol:string; name:string; logoUrl:string; candidates:Array<{platformId:string; tokenAddress:string; category:string; name:string; slug:string; logoUrl:string}> };

const cache = {
  platforms:{at:0,data:new Map<string,PlatformMeta>()},
  nativeCoins:{at:0,data:new Map<string,{id:string;symbol:string;name:string}>()},
  assets:{at:0,data:new Map<string,AssetMeta[]>()},
};
const PLATFORM_TTL = 24*60*60*1000;
const ASSET_TTL = 6*60*60*1000;
const FETCH_TIMEOUT = 12000;

const text=(v:unknown)=>String(v??'').trim();
const upper=(v:unknown)=>text(v).toUpperCase();
const norm=(v:unknown)=>text(v).toLowerCase().replace(/[\s_-]+/g,'');
const unique=<T>(items:T[])=>[...new Set(items)];

async function getJson(url:string){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),FETCH_TIMEOUT);
  try{
    const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'SIRE-Independent-Token-Metadata/1.0'},cache:'no-store',signal:controller.signal});
    const body=await response.text();
    let data:any={};
    try{data=body?JSON.parse(body):{};}catch{throw new Error('Invalid JSON from metadata provider.');}
    if(!response.ok) throw new Error('Metadata provider HTTP '+response.status);
    return data;
  }finally{clearTimeout(timer);}
}

async function refreshPlatforms(){
  if(Date.now()-cache.platforms.at<PLATFORM_TTL && cache.platforms.data.size)return;
  const rows=await getJson(CG_BASE+'/asset_platforms');
  const next=new Map<string,PlatformMeta>();
  for(const row of Array.isArray(rows)?rows:[]){
    const id=text(row?.id); if(!id)continue;
    next.set(id,{id,name:text(row?.name)||id,shortname:text(row?.shortname),nativeCoinId:text(row?.native_coin_id),logoUrl:text(row?.image?.small||row?.image?.thumb||row?.image?.large)});
  }
  cache.platforms={at:Date.now(),data:next};
}

async function refreshNativeCoins(){
  if(Date.now()-cache.nativeCoins.at<PLATFORM_TTL && cache.nativeCoins.data.size)return;
  try{
    const rows=await getJson(CG_BASE+'/coins/list?include_platform=false');
    const next=new Map<string,{id:string;symbol:string;name:string}>();
    for(const row of Array.isArray(rows)?rows:[]){
      const id=text(row?.id); if(!id)continue;
      next.set(id,{id,symbol:upper(row?.symbol),name:text(row?.name)});
    }
    cache.nativeCoins={at:Date.now(),data:next};
  }catch{}
}

function platformForNativeCoin(symbol:string){
  const matches:string[]=[];
  for(const platform of cache.platforms.data.values()){
    const native=cache.nativeCoins.data.get(platform.nativeCoinId);
    if(native&&upper(native.symbol)===upper(symbol))matches.push(platform.id);
  }
  return unique(matches);
}

async function refreshAssets(symbols:string[]){
  const needed=unique(symbols.map(upper).filter(Boolean)).filter(symbol=>!cache.assets.data.has(symbol)||Date.now()-cache.assets.at>=ASSET_TTL);
  if(!needed.length&&cache.assets.data.size)return;
  const next=new Map(cache.assets.data);
  for(let i=0;i<needed.length;i+=100){
    const batch=needed.slice(i,i+100);
    try{
      const url=CMC_BASE+'/v2/cryptocurrency/info?symbol='+encodeURIComponent(batch.join(','))+'&aux=logo,platform&skip_invalid=true';
      const payload=await getJson(url);
      const data=payload?.data&&typeof payload.data==='object'?payload.data:{};
      for(const symbol of batch){
        const raw=data[symbol]??[];
        const rows=Array.isArray(raw)?raw:[raw];
        const mapped:AssetMeta[]=rows.filter(Boolean).map((row:any)=>({
          symbol:upper(row?.symbol||symbol),name:text(row?.name),logoUrl:text(row?.logo),
          candidates:[{platformId:text(row?.platform?.slug||row?.platform?.name),tokenAddress:text(row?.platform?.token_address),category:text(row?.category),name:text(row?.name),slug:text(row?.slug),logoUrl:text(row?.logo)}],
        }));
        if(mapped.length)next.set(symbol,mapped);
      }
    }catch{}
  }
  cache.assets={at:Date.now(),data:next};
}

function findAsset(symbol:string,name:string,contract:string){
  const rows=cache.assets.data.get(upper(symbol))||[];
  if(!rows.length)return undefined;
  const wantedName=norm(name), wantedContract=text(contract).toLowerCase();
  return rows.find(row=>wantedContract&&row.candidates.some(c=>text(c.tokenAddress).toLowerCase()===wantedContract))
    ||rows.find(row=>wantedName&&norm(row.name)===wantedName)
    ||rows.find(row=>row.candidates.some(c=>c.category==='coin'))
    ||rows[0];
}

function resolveChain(symbol:string,asset:AssetMeta|undefined,contract:string){
  const candidates=asset?.candidates||[];
  const exact=text(contract).toLowerCase()?candidates.find(c=>text(c.tokenAddress).toLowerCase()===text(contract).toLowerCase()):undefined;
  if(exact?.platformId){
    const p=cache.platforms.data.get(exact.platformId);
    if(p)return {platform:p,source:'coingecko-platform+cmc-contract'};
  }
  const platformIds=unique(candidates.map(c=>text(c.platformId)).filter(Boolean));
  if(platformIds.length===1){
    const p=cache.platforms.data.get(platformIds[0]);
    if(p)return {platform:p,source:'coingecko-platform+cmc'};
  }
  const nativeIds=platformForNativeCoin(symbol);
  if(nativeIds.length===1){
    const p=cache.platforms.data.get(nativeIds[0]);
    if(p)return {platform:p,source:'coingecko-native-coin'};
  }
  return null;
}

export async function enrichBinanceInstruments(instruments:Json[]){
  const crypto=instruments.filter(item=>['CRYPTO','ALPHA'].includes(upper(item?.marketGroup)));
  const symbols=unique(crypto.map(item=>upper(item?.baseAsset||item?.symbol)).filter(Boolean));
  try{await refreshPlatforms();await refreshNativeCoins();await refreshAssets(symbols);}catch{}
  return instruments.map(item=>{
    const symbol=upper(item?.baseAsset||item?.symbol);
    if(!symbol||!crypto.includes(item))return item;
    const contract=text(item?.contractAddress||item?.tokenAddress);
    const asset=findAsset(symbol,text(item?.name||symbol),contract);
    const resolved=resolveChain(symbol,asset,contract);
    const platform=resolved?.platform;
    return {
      ...item,
      assetId:asset?.candidates?.[0]?.slug||item?.assetId||'',
      assetLogoUrl:asset?.logoUrl||item?.assetLogoUrl||'',
      logoUrl:asset?.logoUrl||item?.logoUrl||'',
      chain:platform?.name||text(item?.chain),
      chainName:platform?.name||text(item?.chainName),
      chainSymbol:platform?.shortname||text(item?.chainSymbol),
      chainId:platform?.id||text(item?.chainId),
      chainLogoUrl:platform?.logoUrl||text(item?.chainLogoUrl),
      contractAddress:contract||text(item?.contractAddress),
      metadataSource:resolved?.source||(asset?'coinmarketcap-static-metadata':'unresolved'),
    };
  });
}
