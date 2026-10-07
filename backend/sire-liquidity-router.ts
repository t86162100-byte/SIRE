export type AssetClass = 'CRYPTO'|'TRADFI'|'ALPHA'|'TOKENIZED'|'OTHER';
export type InstrumentType =
  | 'SPOT'|'PERPETUAL'|'FUTURE'|'MARGIN'
  | 'EQUITY'|'ETF'|'FX'|'COMMODITY'|'PREIPO'
  | 'CFD'|'OPTION'|'TOKENIZED_SECURITY'|'OTHER';

export type LiquidityInstrument = {
  symbol:string;
  assetClass:AssetClass;
  instrumentType:InstrumentType;
  venue?:string;
  jurisdiction?:string;
  quoteAsset?:string;
  settlementAsset?:string;
};

export type LiquidityQuote = {
  provider:string;
  symbol:string;
  bids?:Array<{price:number;quantity:number}>;
  asks?:Array<{price:number;quantity:number}>;
  receivedAt:number;
  mode:'STREAM'|'RFQ'|'BOOK';
};

export type LiquidityExecutionRequest = LiquidityInstrument & {
  side:'BUY'|'SELL';
  quantity:number;
  orderType:'MARKET'|'LIMIT';
  limitPrice?:number;
  clientOrderId:string;
};

export type LiquidityExecutionResult = {
  provider:string;
  externalOrderId?:string;
  fills:Array<{price:number;quantity:number;fee?:number;feeAsset?:string}>;
  status:'FILLED'|'PARTIAL'|'REJECTED'|'PENDING';
  receivedAt:number;
};

export type LiquidityProvider = {
  id:string;
  priority:number;
  supports:(instrument:LiquidityInstrument)=>boolean;
  health:()=>Promise<{ok:boolean;detail?:string}>;
  quote?: (instrument:LiquidityInstrument,depth:number)=>Promise<LiquidityQuote|null>;
  execute?: (request:LiquidityExecutionRequest)=>Promise<LiquidityExecutionResult>;
};

const cryptoTypes = new Set<InstrumentType>(['SPOT','PERPETUAL','FUTURE','MARGIN','CFD','OPTION']);
const tradFiTypes = new Set<InstrumentType>(['EQUITY','ETF','FX','COMMODITY','PREIPO']);
const alphaTypes = new Set<InstrumentType>(['SPOT','PERPETUAL','FUTURE','CFD']);
const tokenizedTypes = new Set<InstrumentType>(['TOKENIZED_SECURITY','SPOT']);

function configuredUrl(key:string){
  const value=String(process.env[key]||'').trim();
  return value ? value.replace(/\/$/,'') : '';
}

function validInstrument(instrument:LiquidityInstrument){
  if(!instrument?.symbol || !/^[A-Z0-9._:/-]{2,80}$/i.test(String(instrument.symbol))) throw new Error('Invalid liquidity instrument symbol.');
  if(!['CRYPTO','TRADFI','ALPHA','TOKENIZED','OTHER'].includes(instrument.assetClass)) throw new Error('Invalid liquidity asset class.');
  return instrument;
}

/*
 * Wintermute is the selected bootstrap crypto liquidity candidate. Its public
 * API documentation advertises institutional API/FIX, streaming/RFQ and
 * spot/CFD connectivity, but private execution credentials/endpoints require
 * institutional onboarding. Therefore this adapter stays disabled until SIRE
 * is provisioned with the real private integration details.
 */
const wintermute:LiquidityProvider = {
  id:'WINTERMUTE',
  priority:100,
  supports:(i)=>validInstrument(i).assetClass==='CRYPTO' && cryptoTypes.has(i.instrumentType),
  health:async()=>{
    const url=configuredUrl('SIRE_LIQUIDITY_WINTERMUTE_EXECUTION_URL');
    return url && tokenForConfigured('WINTERMUTE') ? {ok:true,detail:'Wintermute execution adapter configured.'}
               : {ok:false,detail:'Wintermute selected as bootstrap provider but its private execution URL/token are not configured.'};
  }
};

/*
 * Generic institutional adapter. This is deliberately provider-neutral: SIRE
 * never invents a venue API or pretends an external fill happened. A real
 * adapter must be installed and its endpoint/credentials configured.
 */

function tokenForConfigured(provider:string){
  return provider==='WINTERMUTE' ? Boolean(String(process.env.SIRE_LIQUIDITY_WINTERMUTE_TOKEN||'').trim()) : Boolean(String(process.env.SIRE_LIQUIDITY_TOKEN||'').trim());
}

function externalProvider(id:string,priority:number,envUrl:string,supports:(i:LiquidityInstrument)=>boolean):LiquidityProvider{
  return {
    id,priority,supports,
    health:async()=>{
      const url=configuredUrl(envUrl);
      return url ? {ok:true,detail:'Configured adapter endpoint present.'} : {ok:false,detail:'Adapter endpoint is not configured.'};
    }
  };
}

const providers:LiquidityProvider[] = [
  wintermute,
  externalProvider('TRADFI_INSTITUTIONAL',80,'SIRE_LIQUIDITY_TRADFI_URL',i=>validInstrument(i).assetClass==='TRADFI' && tradFiTypes.has(i.instrumentType)),
  externalProvider('ALPHA_DEFI',70,'SIRE_LIQUIDITY_ALPHA_URL',i=>validInstrument(i).assetClass==='ALPHA' && alphaTypes.has(i.instrumentType)),
  externalProvider('TOKENIZED_SECURITIES',70,'SIRE_LIQUIDITY_TOKENIZED_URL',i=>validInstrument(i).assetClass==='TOKENIZED' && tokenizedTypes.has(i.instrumentType)),
];

export function listLiquidityProviders(){
  return providers.map(p=>({id:p.id,priority:p.priority}));
}

export function selectLiquidityProvider(instrument:LiquidityInstrument){
  validInstrument(instrument);
  const candidates=providers
    .filter(p=>p.supports(instrument))
    .sort((a,b)=>b.priority-a.priority);
  if(!candidates.length) return null;
  return candidates[0];
}

export async function universalLiquidityStatus(){
  const rows=await Promise.all(providers.map(async p=>{
    const health=await p.health();
    return {id:p.id,priority:p.priority,configured:health.ok,detail:health.detail};
  }));
  return {
    ok:true,
    bootstrapProvider:'WINTERMUTE',
    architecture:'SIRE_UNIVERSAL_LIQUIDITY_ROUTER',
    executionAuthority:'SIRE',
    providers:rows,
    migration:{
      externalLiquidityPercent:Number(process.env.SIRE_EXTERNAL_LIQUIDITY_PERCENT||100),
      sireOwnedLiquidityPercent:Number(process.env.SIRE_OWNED_LIQUIDITY_PERCENT||0)
    }
  };
}

export function liquidityRoute(instrument:LiquidityInstrument){
  const provider=selectLiquidityProvider(instrument);
  return {
    ok:Boolean(provider),
    instrument:validInstrument(instrument),
    provider:provider?.id||null,
    executionEnabled:false,
    reason:provider
      ? 'Provider capability matched. External execution remains disabled until the provider adapter is explicitly configured and authenticated.'
      : 'No configured provider capability matches this instrument.'
  };
}

export async function getUniversalQuote(instrument:LiquidityInstrument,depth=20){
  const provider=selectLiquidityProvider(instrument);
  if(!provider?.quote) return null;
  return provider.quote(instrument,Math.max(1,Math.min(100,Math.floor(Number(depth)||20))));
}

export async function executeExternalLiquidity(request:LiquidityExecutionRequest){
  const provider=selectLiquidityProvider(request);
  if(!provider) throw new Error('No liquidity provider supports this instrument.');
  if(!provider.execute) throw new Error(`Liquidity provider ${provider.id} is selected but its authenticated execution adapter is not configured.`);
  return provider.execute(request);
}
