import { db } from '@appdeploy/sdk';
import { verifyConfiguredConnectors, discoverConnectors } from './agent-tools.ts';
import { getAiMonitor } from './sire-ai-monitor.ts';
import { getRecentIssues } from './sire-issue-tracker.ts';

type Check = {
  id:string;
  area:string;
  status:'pass'|'warning'|'fail';
  severity:'info'|'warning'|'critical';
  title:string;
  detail:string;
  latencyMs?:number;
  evidence?:unknown;
};

const safeError=(e:unknown)=>String(e instanceof Error?e.message:e).replace(/(Bearer\s+)[^\s]+/ig,'$1[redacted]').slice(0,500);

async function timed<T>(fn:()=>Promise<T>,ms=2500):Promise<{ok:boolean;value?:T;error?:string;latencyMs:number}>{
  const started=Date.now(); let timer:any;
  try{
    const value=await Promise.race([
      fn(),
      new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`timed out after ${ms}ms`)),ms);})
    ]);
    return {ok:true,value,latencyMs:Date.now()-started};
  }catch(e){return {ok:false,error:safeError(e),latencyMs:Date.now()-started};}
  finally{if(timer)clearTimeout(timer);}
}

function safeConnectorSummary(value:any){
  const github=value?.github||{},render=value?.render||{};
  return {
    github:{configured:Boolean(process.env.GITHUB_TOKEN),ok:Boolean(github.ok),login:github.login||null,repository:github.repository?.fullName||null,error:github.ok?null:safeError(github.error||'GitHub verification failed')},
    render:{configured:Boolean(process.env.RENDER_API_KEY),ok:Boolean(render.ok),workspaceCount:Number(render.workspaceCount||0),workspaces:Array.isArray(render.workspaces)?render.workspaces.map((w:any)=>({id:w.id,name:w.name,type:w.type||null})):[],error:render.ok?null:safeError(render.error||'Render verification failed')}
  };
}

function severityFor(status:Check['status']):Check['severity']{
  return status==='fail'?'critical':status==='warning'?'warning':'info';
}

export async function runSireDiagnostics(){
  const startedAt=Date.now();
  const checks:Check[]=[];
  const connectors=discoverConnectors();

  const [connectorRun,dbRun,geminiRun,openRouterRun,webRun]=await Promise.all([
    timed(()=>verifyConfiguredConnectors(),9000),
    timed(async()=>{ if(!process.env.DATABASE_URL) return {configured:false}; const r=await db.list('sire_ai_team_state_v1',{limit:1}); return {configured:true,reachable:true,rows:Array.isArray(r.items)?r.items.length:0}; },1800),
    timed(async()=>{const key=process.env.GEMINI_API_KEY?.trim();if(!key)throw new Error('GEMINI_API_KEY is missing');const res=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash',{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(1800)});if(!res.ok)throw new Error(`Gemini API HTTP ${res.status}`);return {configured:true,reachable:true};},2200),
    timed(async()=>{const key=process.env.OPENROUTER_API_KEY?.trim();if(!key)throw new Error('OPENROUTER_API_KEY is missing');const res=await fetch('https://openrouter.ai/api/v1/models',{headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(1800)});if(!res.ok)throw new Error(`OpenRouter API HTTP ${res.status}`);return {configured:true,reachable:true};},2200),
    timed(async()=>{const url=(process.env.SIRE_SEARXNG_URLS||'https://searx.debnerd.in').split(',')[0].trim().replace(/\/$/,'');if(!url)throw new Error('No SearXNG URL configured');const res=await fetch(url,{headers:{accept:'text/html'},signal:AbortSignal.timeout(1800)});if(!res.ok)throw new Error(`SearXNG HTTP ${res.status}`);return {configured:true,url};},2200)
  ]);

  const connectorSummary=connectorRun.ok?safeConnectorSummary(connectorRun.value):{github:{configured:Boolean(process.env.GITHUB_TOKEN),ok:false,error:connectorRun.error},render:{configured:Boolean(process.env.RENDER_API_KEY),ok:false,error:connectorRun.error}};
  checks.push({id:'GITHUB',area:'connectors',status:connectorRun.ok&&connectorSummary.github.ok?'pass':connectorSummary.github.configured?'warning':'fail',severity:'info',title:'GitHub connector',detail:connectorSummary.github.ok?'Authenticated and repository verification passed.':'GitHub connector is not fully verified.',latencyMs:connectorRun.latencyMs,evidence:{configured:connectorSummary.github.configured,login:connectorSummary.github.login,repository:connectorSummary.github.repository,error:connectorSummary.github.error}});
  checks.push({id:'RENDER',area:'connectors',status:connectorRun.ok&&connectorSummary.render.ok?'pass':connectorSummary.render.configured?'warning':'fail',severity:'info',title:'Render connector',detail:connectorSummary.render.ok?'Authenticated and workspace verification passed.':'Render connector is not fully verified.',latencyMs:connectorRun.latencyMs,evidence:{configured:connectorSummary.render.configured,workspaceCount:connectorSummary.render.workspaceCount,error:connectorSummary.render.error}});

  const dbStatus=!process.env.DATABASE_URL?'warning':dbRun.ok?'pass':'warning';
  checks.push({id:'AI_STATE_DB',area:'persistence',status:dbStatus,severity:severityFor(dbStatus),title:'AI state persistence',detail:!process.env.DATABASE_URL?'DATABASE_URL is not configured; SIRE uses runtime memory.':dbRun.ok?'AI state store is reachable.':'AI state store is slow/unreachable; SIRE should fall back to memory without blocking responses.',latencyMs:dbRun.latencyMs,evidence:dbRun.ok?dbRun.value:dbRun.error});

  const geminiStatus=geminiRun.ok?'pass':'fail';
  checks.push({id:'GEMINI',area:'models',status:geminiStatus,severity:severityFor(geminiStatus),title:'Gemini provider',detail:geminiRun.ok?'Gemini API key and network reachability check passed.':'Gemini cannot be reached or is not configured.',latencyMs:geminiRun.latencyMs,evidence:geminiRun.ok?geminiRun.value:geminiRun.error});
  const routerStatus=openRouterRun.ok?'pass':'fail';
  checks.push({id:'OPENROUTER',area:'models',status:routerStatus,severity:severityFor(routerStatus),title:'OpenRouter / GPT provider',detail:openRouterRun.ok?'OpenRouter API key and network reachability check passed.':'OpenRouter cannot be reached or is not configured.',latencyMs:openRouterRun.latencyMs,evidence:openRouterRun.ok?openRouterRun.value:openRouterRun.error});

  const webStatus=webRun.ok?'pass':'warning';
  checks.push({id:'WEB_SEARCH',area:'research',status:webStatus,severity:severityFor(webStatus),title:'Web research provider',detail:webRun.ok?'Primary SearXNG endpoint is reachable.':'Primary SearXNG endpoint is unavailable; SIRE can attempt fallbacks.',latencyMs:webRun.latencyMs,evidence:webRun.ok?webRun.value:webRun.error});

  const monitor=getAiMonitor();
  const last=monitor.lastRun;
  if(last){
    const slow=last.slowestMs>=15000?'fail':last.slowestMs>=8000?'warning':'pass';
    checks.push({id:'LAST_AI_RUN',area:'performance',status:slow,severity:severityFor(slow),title:'Last SIRE AI response timing',detail:slow==='pass'?'Last tracked AI run completed within the normal target.':`The last tracked AI run had a slow stage: ${last.slowestStage||'unknown'}.`,latencyMs:last.totalMs,evidence:{totalMs:last.totalMs,timings:last.stages,slowestStage:last.slowestStage,slowestMs:last.slowestMs,mode:last.mode}});
  }else{
    checks.push({id:'LAST_AI_RUN',area:'performance',status:'warning',severity:'warning',title:'AI response timing telemetry',detail:'No completed SIRE AI run has been recorded since the current server process started.'});
  }

  const runtimeIssues=getRecentIssues();
  if(runtimeIssues.length){
    const latest=runtimeIssues[0];
    const exactLocation=latest.file ? `Exact runtime location: ${latest.file}${latest.line?':'+latest.line:''}${latest.column?':'+latest.column:''}.` : 'The browser supplied a stack trace but no parseable source location.';
    checks.push({id:'RUNTIME_ERROR_TRACE',area:'runtime',status:'fail',severity:'critical',title:'Captured runtime failure',detail:`${latest.message} ${exactLocation}`,evidence:{source:latest.source,component:latest.component,file:latest.file,line:latest.line,column:latest.column,url:latest.url,detail:latest.detail,cause:latest.cause,stack:latest.stack}});
  } else {
    checks.push({id:'RUNTIME_ERROR_TRACE',area:'runtime',status:'pass',severity:'info',title:'Runtime error trace',detail:'No browser runtime exception or unhandled rejection has been captured by the issue finder.',evidence:{captured:0}});
  }

  const totalMs=Date.now()-startedAt;
  const slowestCheck=checks.filter(x=>typeof x.latencyMs==='number').sort((a,b)=>(b.latencyMs||0)-(a.latencyMs||0))[0];
  const failed=checks.filter(x=>x.status==='fail');
  const warnings=checks.filter(x=>x.status==='warning');
  let mainIssue;
  if(failed.length) mainIssue={severity:'critical',id:failed[0].id,title:failed[0].title,detail:failed[0].detail};
  else if(last && last.slowestMs>=8000) mainIssue={severity:'warning',id:'LAST_AI_RUN',title:`AI response bottleneck: ${last.slowestStage||'unknown'}`,detail:`Last response took ${last.totalMs}ms; ${last.slowestStage||'one stage'} took ${last.slowestMs}ms.`};
  else if(warnings.length) mainIssue={severity:'warning',id:warnings[0].id,title:warnings[0].title,detail:warnings[0].detail};
  else mainIssue={severity:'info',id:'NONE',title:'No blocking issue detected',detail:'The scanned SIRE AI services are responding within the configured diagnostic thresholds.'};

  return {
    ok:failed.length===0,
    generatedAt:new Date().toISOString(),
    durationMs:totalMs,
    service:'SIRE full AI diagnostics',
    mainIssue,
    summary:{checks:checks.length,failed:failed.length,warnings:warnings.length,passed:checks.filter(x=>x.status==='pass').length,slowestCheck:slowestCheck?{id:slowestCheck.id,latencyMs:slowestCheck.latencyMs}:null},
    checks,
    aiMonitor:monitor,
    connectors:connectorSummary,
    runtimeIssues,
    routes:{chatRoute:'/api/sire/agent/council/stream',directAgentRoute:'/api/sire/agent/openalgo',directGptRoute:'/api/sire/agent/gpt',autonomousRoute:'/api/sire/autonomous',diagnosticsRoute:'/api/sire/diagnostics'},
    capabilities:{webSearch:true,openAlgoAgent:true,gemini:true,gptOss20b:true,github:connectors.some(x=>x.id==='github'),render:connectors.some(x=>x.id==='render'),persistentState:Boolean(process.env.DATABASE_URL)},
    noSecrets:true
  };
}
