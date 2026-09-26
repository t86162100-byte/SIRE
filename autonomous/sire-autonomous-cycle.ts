import { runGptHead } from '../backend/openrouter-ai.ts';

const DIRECT_DERIV_WS = ['wss://api.derivws.com/trading/v1/options/ws/public','wss://ws.derivws.com/websockets/v3?app_id=1089'];
const SIRE_PUBLIC_URL = String(process.env.SIRE_PUBLIC_URL || 'https://sire-amfv.onrender.com').replace(/\/$/,'');
const GITHUB_API = 'https://api.github.com';
const REPO = process.env.GITHUB_REPOSITORY || 't86162100-byte/SIRE';
const TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const ISSUE_NUMBER = Number(process.env.AUTONOMOUS_STATE_ISSUE_NUMBER || '10');
const SYMBOL = String(process.env.SIRE_AUTONOMOUS_SYMBOL || 'WLDAUD').trim();
const INTERVAL = String(process.env.SIRE_AUTONOMOUS_INTERVAL || '1m').trim();
const COUNT = Math.max(30, Math.min(200, Number(process.env.SIRE_AUTONOMOUS_CANDLE_COUNT || '100')));
if (!TOKEN) throw new Error('GITHUB_TOKEN is required for autonomous SIRE memory.');
if (!ISSUE_NUMBER) throw new Error('AUTONOMOUS_STATE_ISSUE_NUMBER is required.');

function waitOpen(ws:any, timeoutMs=15000):Promise<void>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(new Error('WebSocket open timed out'));},timeoutMs);const cleanup=()=>{clearTimeout(timer);ws.off('open',onOpen);ws.off('error',onError);};const onOpen=()=>{cleanup();resolve();};const onError=(e:any)=>{cleanup();reject(e);};ws.once('open',onOpen);ws.once('error',onError);});}
function request(ws:any,payload:any,expectedType:string,timeoutMs=15000):Promise<any>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(new Error('Deriv request timed out: '+expectedType));},timeoutMs);const onMessage=(raw:any)=>{let msg:any;try{msg=JSON.parse(String(raw));}catch{return;}if(msg?.error){cleanup();reject(new Error(msg.error.message||'Deriv request failed'));return;}if(msg?.msg_type===expectedType){cleanup();resolve(msg);}};const onClose=(code:any,reason:any)=>{cleanup();reject(new Error('Deriv socket closed before '+expectedType+' (code '+code+')'+(reason?' '+String(reason):'')));};const cleanup=()=>{clearTimeout(timer);ws.off('message',onMessage);ws.off('close',onClose);};ws.on('message',onMessage);ws.once('close',onClose);ws.send(JSON.stringify(payload));});}
async function getFromWs(endpoint:string){const wsModule=await import('ws');const WebSocket=wsModule.WebSocket;const ws:any=new WebSocket(endpoint);try{await waitOpen(ws);const result=await request(ws,{ticks_history:SYMBOL,end:'latest',count:COUNT,style:'candles',granularity:60,subscribe:0,req_id:Math.floor(Date.now()%900000)+100000},'candles');const candles=(result.candles||[]).map((c:any)=>({epoch:Number(c.epoch),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)})).filter((c:any)=>Object.values(c).every(Number.isFinite));if(candles.length<30)throw new Error('Deriv returned fewer than 30 valid candles.');return {source:'Deriv public market data',endpoint,symbol:SYMBOL,timeframe:INTERVAL,candleCount:candles.length,latestCandle:candles.at(-1),previousCandle:candles.at(-2),observedAt:new Date().toISOString(),candles};}finally{try{ws.close();}catch{}}}
async function getHttpHistory(){
  const base='https://api.deriv.com/api/v1/ticks_history';
  const attempts=[
    {method:'GET',url:base+'?symbol='+encodeURIComponent(SYMBOL)+'&end=latest&count='+COUNT+'&style=candles&granularity=60'},
    {method:'POST',url:base,body:{ticks_history:SYMBOL,end:'latest',count:COUNT,style:'candles',granularity:60}}
  ];
  let lastError='Deriv HTTP history failed';
  for(const attempt of attempts){
    try{
      const response=await fetch(attempt.url,{method:attempt.method,headers:{Accept:'application/json','Content-Type':'application/json'},...(attempt.body?{body:JSON.stringify(attempt.body)}:{})});
      const raw=await response.text(); let data:any={}; try{data=raw?JSON.parse(raw):{};}catch{}
      if(!response.ok) throw new Error('HTTP '+response.status+' '+raw.slice(0,200));
      const rawCandles=data?.candles||data?.history?.candles||data?.data?.candles||[];
      const candles=Array.isArray(rawCandles)?rawCandles.map((c:any)=>({epoch:Number(c.epoch),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)})).filter((c:any)=>Object.values(c).every(Number.isFinite)):[];
      if(candles.length<30) throw new Error('HTTP response contained fewer than 30 valid candles.');
      return {source:'Deriv public market data',endpoint:attempt.url.split('?')[0],symbol:SYMBOL,timeframe:INTERVAL,candleCount:candles.length,latestCandle:candles.at(-1),previousCandle:candles.at(-2),observedAt:new Date().toISOString(),candles};
    }catch(e){lastError=e instanceof Error?e.message:String(e);}
  }
  throw new Error(lastError);
}

async function getJinaHistory(){
  const target='https://api.deriv.com/api/v1/ticks_history?symbol='+encodeURIComponent(SYMBOL)+'&end=latest&count='+COUNT+'&style=candles&granularity=60';
  const response=await fetch('https://r.jina.ai/'+target,{headers:{Accept:'application/json','X-Engine':'direct','X-No-Cache':'true'}});
  if(!response.ok)throw new Error('Jina proxy HTTP '+response.status);
  const raw=await response.text(); let outer:any={}; try{outer=JSON.parse(raw);}catch{}
  const candidate=typeof outer?.content==='string'?outer.content:raw;
  let data:any={}; try{data=JSON.parse(candidate);}catch{throw new Error('Jina proxy returned non-JSON Deriv data.');}
  const rawCandles=data?.candles||data?.history?.candles||data?.data?.candles||[];
  const candles=Array.isArray(rawCandles)?rawCandles.map((c:any)=>({epoch:Number(c.epoch),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)})).filter((c:any)=>Object.values(c).every(Number.isFinite)):[];
  if(candles.length<30)throw new Error('Jina proxy returned fewer than 30 valid candles.');
  return {source:'Deriv public market data via Jina Reader proxy',endpoint:target,symbol:SYMBOL,timeframe:INTERVAL,candleCount:candles.length,latestCandle:candles.at(-1),previousCandle:candles.at(-2),observedAt:new Date().toISOString(),candles};
}

async function getMarketObservation(){let lastError='Unknown Deriv market-data error';try{return await getHttpHistory();}catch(e){lastError=e instanceof Error?e.message:String(e);}try{return await getJinaHistory();}catch(e){lastError=e instanceof Error?e.message:String(e);}try{return await getFromWs(SIRE_PUBLIC_URL.replace(/^http/,'ws')+'/deriv/ws');}catch(e){lastError=e instanceof Error?e.message:String(e);}for(const endpoint of DIRECT_DERIV_WS){try{return await getFromWs(endpoint);}catch(e){lastError=e instanceof Error?e.message:String(e);}}throw new Error('All Deriv public market-data paths failed: '+lastError);}
async function askSameSireAi(prompt:string,chartSnapshot:any){const key=String(process.env.OPENROUTER_API_KEY||'').trim();if(key)return await runGptHead({query:prompt,history:[],chartSnapshot});const response=await fetch(SIRE_PUBLIC_URL+'/api/sire/agent/gpt',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query:prompt,history:[],chartSnapshot})});const raw=await response.text();let data:any={};try{data=raw?JSON.parse(raw):{};}catch{}if(!response.ok)throw new Error('SIRE hosted AI request failed: '+response.status+' '+(data.error||raw.slice(0,500)));if(!data.text)throw new Error('SIRE hosted AI returned no final response.');return data;}
async function updateMemory(state:any){const response=await fetch(GITHUB_API+'/repos/'+REPO+'/issues/'+ISSUE_NUMBER,{method:'PATCH',headers:{Authorization:'Bearer '+TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json','User-Agent':'SIRE-autonomous-agent'},body:JSON.stringify({body:['SIRE AUTONOMOUS MEMORY — maintained by the same SIRE AI used by the chat tab.','','State: '+state.status,'Last autonomous cycle: '+state.observedAt,'Instrument: '+state.market.symbol,'Timeframe: '+state.market.timeframe,'','## SIRE observation',state.aiObservation||'(no AI observation)','','## Raw market state',JSON.stringify({latestCandle:state.market.latestCandle,previousCandle:state.market.previousCandle,candleCount:state.market.candleCount,source:state.market.source,endpoint:state.market.endpoint||null},null,2),'','## Runtime',JSON.stringify({agent:'SIRE',mode:'autonomous',model:state.model||null,provider:state.provider||null,cycleId:state.cycleId,cycleSucceeded:state.status==='healthy'},null,2)].join('\n')})});if(!response.ok)throw new Error('GitHub autonomous memory update failed: '+response.status+' '+(await response.text()).slice(0,500));}
export async function runAutonomousCycle(){const cycleId='sire-auto-'+Date.now();const market=await getMarketObservation();const prompt=['Run one autonomous SIRE observation cycle.','You are the SAME SIRE AI that users chat with in the SIRE tab, not a separate observer.','Observe the supplied market state and record a concise factual observation for SIRE memory.','Do not invent missing data. Do not create a trading strategy yet. Do not make a trade recommendation.','Separate direct observations from uncertainty.','Instrument: '+market.symbol,'Timeframe: '+market.timeframe,'Latest candle: '+JSON.stringify(market.latestCandle),'Previous candle: '+JSON.stringify(market.previousCandle),'Candle count: '+market.candleCount,'Return a short factual observation that can be read later by the same SIRE chat agent.'].join('\n');const chartSnapshot={source:'autonomous SIRE market engine',autonomous:true,symbol:market.symbol,timeframe:market.timeframe,recentBars:market.candles,autonomousSamples:[{observedAt:market.observedAt,latestCandle:market.latestCandle}],liveMarketData:{connectionStatus:'connected',subscriptionStatus:'historical_snapshot',latestTick:market.latestCandle?.close??null,dataTimestamp:market.latestCandle?.epoch??null,stale:false,staleThresholdMs:120000}};const ai=await askSameSireAi(prompt,chartSnapshot);const state={status:'healthy',cycleId,observedAt:market.observedAt,market,aiObservation:ai.text,model:ai.model,provider:ai.provider};await updateMemory(state);console.log(JSON.stringify({service:'sire-autonomous-agent',event:'autonomous.cycle.completed',cycleId,observedAt:market.observedAt,symbol:market.symbol,model:ai.model,provider:ai.provider}));return state;}
if(process.argv[1]&&process.argv[1].endsWith('sire-autonomous-cycle.ts')){runAutonomousCycle().catch(async error=>{const failure={status:'degraded',cycleId:'sire-auto-'+Date.now(),observedAt:new Date().toISOString(),market:{symbol:SYMBOL,timeframe:INTERVAL,source:'Deriv public market data',latestCandle:null,previousCandle:null,candleCount:0},aiObservation:'',error:error instanceof Error?error.message:String(error)};try{await updateMemory(failure);}catch{}console.error(JSON.stringify({service:'sire-autonomous-agent',event:'autonomous.cycle.failed',...failure}));process.exit(1);});}