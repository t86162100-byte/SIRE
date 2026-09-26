import { runGptHead } from '../backend/openrouter-ai.ts';

const DERIV_PUBLIC_WS_ENDPOINTS = [
  'wss://api.derivws.com/trading/v1/options/ws/public',
  'wss://ws.binaryws.com/websockets/v3',
];
const GITHUB_API = 'https://api.github.com';
const REPO = process.env.GITHUB_REPOSITORY || 't86162100-byte/SIRE';
const TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const ISSUE_NUMBER = Number(process.env.AUTONOMOUS_STATE_ISSUE_NUMBER || '10');
const SYMBOL = String(process.env.SIRE_AUTONOMOUS_SYMBOL || 'WLDAUD').trim();
const INTERVAL = String(process.env.SIRE_AUTONOMOUS_INTERVAL || '1m').trim();
const COUNT = Math.max(30, Math.min(200, Number(process.env.SIRE_AUTONOMOUS_CANDLE_COUNT || '100')));
const SAMPLE_COUNT = 1;
if (!TOKEN) throw new Error('GITHUB_TOKEN is required for autonomous SIRE memory.');
if (!ISSUE_NUMBER) throw new Error('AUTONOMOUS_STATE_ISSUE_NUMBER is required.');
if (!SYMBOL) throw new Error('SIRE_AUTONOMOUS_SYMBOL is required.');

function request(ws:any, payload:unknown, expectedType:string, timeoutMs=15000):Promise<any> {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('Deriv request timed out: '+expectedType));},timeoutMs);
    const onMessage=(raw:any)=>{
      let msg:any; try{msg=JSON.parse(String(raw));}catch{return;}
      if(msg?.error){cleanup();reject(new Error(msg.error.message||'Deriv request failed'));return;}
      if(msg?.msg_type!==expectedType)return;
      cleanup();resolve(msg);
    };
    const cleanup=()=>{clearTimeout(timer);ws.off('message',onMessage);};
    ws.on('message',onMessage); ws.send(JSON.stringify(payload));
  });
}

async function getMarketObservation() {
  const wsModule=await import('ws'); const WebSocket=wsModule.WebSocket;
  let lastError='Unknown Deriv market-data error';
  for(const endpoint of DERIV_PUBLIC_WS_ENDPOINTS){
    const ws:any=new WebSocket(endpoint);
    try{
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Deriv WebSocket open timed out')),15000);
        ws.once('open',()=>{clearTimeout(timer);resolve();});
        ws.once('error',(e:any)=>{clearTimeout(timer);reject(e);});
      });
      const result=await request(ws,{ticks_history:SYMBOL,end:'latest',count:COUNT,style:'candles',granularity:60,subscribe:0,req_id:2},'candles');
      const candles=(result.candles||[]).map((c:any)=>({epoch:Number(c.epoch),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)})).filter((c:any)=>Object.values(c).every(Number.isFinite));
      if(candles.length<30) throw new Error('Deriv returned fewer than 30 valid candles.');
      return {source:'Deriv public market data',endpoint,symbol:SYMBOL,timeframe:INTERVAL,candleCount:candles.length,latestCandle:candles[candles.length-1],previousCandle:candles[candles.length-2],observedAt:new Date().toISOString(),candles};
    }catch(error){ lastError=error instanceof Error?error.message:String(error); }
    finally{ try{ws.close();}catch{} }
  }
  throw new Error('All Deriv public market-data endpoints failed: '+lastError);
}

async function updateMemory(state:any) {
  const response=await fetch(GITHUB_API+'/repos/'+REPO+'/issues/'+ISSUE_NUMBER,{
    method:'PATCH',headers:{Authorization:'Bearer '+TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json','User-Agent':'SIRE-autonomous-agent'},
    body:JSON.stringify({body:[
      'SIRE AUTONOMOUS MEMORY — maintained by the same SIRE AI used by the chat tab.','',
      'State: '+state.status,'Last autonomous cycle: '+state.observedAt,'Instrument: '+state.market.symbol,'Timeframe: '+state.market.timeframe,'',
      '## SIRE observation',state.aiObservation||'(no AI observation)','',
      '## Raw market state','```json',JSON.stringify({latestCandle:state.market.latestCandle,previousCandle:state.market.previousCandle,candleCount:state.market.candleCount,source:state.market.source,endpoint:state.market.endpoint||null},null,2),'```','',
      '## Runtime',JSON.stringify({agent:'SIRE',mode:'autonomous',model:state.model||null,provider:state.provider||null,cycleId:state.cycleId,cycleSucceeded:state.status==='healthy'},null,2)
    ].join('\n')})
  });
  if(!response.ok) throw new Error('GitHub autonomous memory update failed: '+response.status+' '+(await response.text()).slice(0,500));
}

export async function runAutonomousCycle() {
  const cycleId='sire-auto-'+Date.now();
  const samples=[await getMarketObservation()]; const market=samples[0];
  const prompt=[
    'Run one autonomous SIRE observation cycle.',
    'You are the SAME SIRE AI that users chat with in the SIRE tab, not a separate observer.',
    'Observe the supplied market state and record a concise factual observation for SIRE memory.',
    'Do not invent missing data. Do not create a trading strategy yet. Do not make a trade recommendation.',
    'Separate direct observations from uncertainty.',
    'Instrument: '+market.symbol,'Timeframe: '+market.timeframe,'Latest candle: '+JSON.stringify(market.latestCandle),'Previous candle: '+JSON.stringify(market.previousCandle),'Candle count: '+market.candleCount,
    'Return a short factual observation that can be read later by the same SIRE chat agent.'
  ].join('\n');
  const ai=await runGptHead({query:prompt,history:[],chartSnapshot:{source:'autonomous SIRE market engine',autonomous:true,symbol:market.symbol,timeframe:market.timeframe,recentBars:market.candles,autonomousSamples:samples.map((s:any)=>({observedAt:s.observedAt,latestCandle:s.latestCandle})),liveMarketData:{connectionStatus:'connected',subscriptionStatus:'historical_snapshot',latestTick:market.latestCandle?.close??null,dataTimestamp:market.latestCandle?.epoch??null,stale:false,staleThresholdMs:120000}}});
  const state={status:'healthy',cycleId,observedAt:market.observedAt,market,autonomousSamples:samples.map((s:any)=>({observedAt:s.observedAt,latestCandle:s.latestCandle})),aiObservation:ai.text,model:ai.model,provider:ai.provider};
  await updateMemory(state);
  console.log(JSON.stringify({service:'sire-autonomous-agent',agent:'SIRE',event:'autonomous.cycle.completed',cycleId,observedAt:market.observedAt,symbol:market.symbol,model:ai.model,provider:ai.provider}));
}

if(process.argv[1]&&process.argv[1].endsWith('sire-autonomous-cycle.ts')){
  runAutonomousCycle().catch(async error=>{
    const failure={status:'degraded',cycleId:'sire-auto-'+Date.now(),observedAt:new Date().toISOString(),market:{symbol:SYMBOL,timeframe:INTERVAL,source:'Deriv public market data',latestCandle:null,previousCandle:null,candleCount:0},aiObservation:'',error:error instanceof Error?error.message:String(error)};
    try{await updateMemory(failure);}catch{}
    console.error(JSON.stringify({service:'sire-autonomous-agent',event:'autonomous.cycle.failed',...failure})); process.exit(1);
  });
}