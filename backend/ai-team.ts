import { db } from '@appdeploy/sdk';
import { runGemini } from './gemini-ai.ts';
import { runOpenRouter } from './openrouter-ai.ts';
import { webSearch, verifyConfiguredConnectors } from './agent-tools.ts';
import { runOpenAlgoAgent } from './openalgo-agent.ts';
import { recordAiRun } from './sire-ai-monitor.ts';

type TeamEvent = (e:{actor:string;phase:string;text:string;workspaceId:string})=>void|Promise<void>;
type State = {workspaceId:string;goal:string;responsibilities:any[];decisions:string[];openQuestions:string[];artifacts:any[];activity:any[];updatedAt:string};
const TABLE='sire_ai_team_state_v1', memory=new Map<string,State>(), locks=new Map<string,Promise<void>>();
const clean=(v:unknown,n=9000)=>String(v??'').trim().slice(0,n);
const wid=(i:any)=>clean(i.workspaceId||i.workspace||i.sessionId||'default',180)||'default';
const empty=(id:string,goal:string):State=>({workspaceId:id,goal,responsibilities:[],decisions:[],openQuestions:[],artifacts:[],activity:[],updatedAt:new Date().toISOString()});
async function withTimeout<T>(promise:Promise<T>,ms:number,label:string):Promise<T>{
  let timer:any;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_,reject)=>{ timer=setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)),ms); })
    ]);
  } finally { if(timer) clearTimeout(timer); }
}
async function load(id:string,goal:string){
  if(!process.env.DATABASE_URL) return {state:memory.get(id)||empty(id,goal)};
  try { const r=await withTimeout(db.list(TABLE,{limit:1000}),1500,'AI team state load'); const x=r.items.find((v:any)=>v?.workspaceId===id); return x?{id:x.id,state:{...empty(id,goal),...x,goal:goal||x.goal}}:{state:empty(id,goal)}; }
  catch(e){ console.warn('[AI TEAM] persistent store unavailable; using runtime state:',e instanceof Error?e.message:String(e)); return {state:memory.get(id)||empty(id,goal)}; }
}
async function save(s:State,id?:string){
  s.updatedAt=new Date().toISOString(); memory.set(s.workspaceId,s);
  if(!process.env.DATABASE_URL) return;
  try { if(id) await withTimeout(db.update(TABLE,[{id,record:s}]),1500,'AI team state update'); else await withTimeout(db.add(TABLE,[s]),1500,'AI team state insert'); }
  catch(e){ console.warn('[AI TEAM] could not persist state:',e instanceof Error?e.message:String(e)); }
}
async function lock<T>(id:string,fn:()=>Promise<T>):Promise<T>{ const p=locks.get(id)||Promise.resolve(); let release!:()=>void; const c=new Promise<void>(r=>release=r); locks.set(id,p.then(()=>c)); await p; try{return await fn()}finally{release();if(locks.get(id)===c)locks.delete(id)} }
const stateText=(s:State)=>JSON.stringify({goal:s.goal,responsibilities:s.responsibilities.slice(-12),decisions:s.decisions.slice(-12),openQuestions:s.openQuestions.slice(-12),artifacts:s.artifacts.slice(-8)},null,2);
function json(text:string){
  const fenced=text.match(/```json\s*([\s\S]*?)```/i);
  if(fenced) { try{return JSON.parse(fenced[1])}catch{} }
  const candidates=[...text.matchAll(/\{[\s\S]*?\}/g)].reverse();
  for(const m of candidates){try{return JSON.parse(m[0])}catch{}}
  return null;
}
function userAnswer(text:string){
  const p=json(text);
  if(p?.userAnswer) return clean(p.userAnswer,12000);
  const fenced=text.replace(/```json\s*[\s\S]*?```/gi,'').trim();
  const heading=/\*\*Answer to (?:the )?User\*\*\s*([\s\S]*?)(?:\n\s*```|\n\s*\{|$)/i.exec(fenced);
  if(heading?.[1]) return clean(heading[1],12000).replace(/\*\*Team Summary\*\*[\s\S]*?\n/i,'').trim();
  return clean(fenced,12000);
}
function apply(s:State,actor:string,text:string){const p=json(text);if(!p)return;if(Array.isArray(p.responsibilities))s.responsibilities=p.responsibilities.map((x:any)=>({owner:clean(x.owner,80),task:clean(x.task,500),status:clean(x.status,80)})).filter((x:any)=>x.task);if(Array.isArray(p.decisions))s.decisions=[...s.decisions,...p.decisions.map((x:any)=>clean(x,700)).filter(Boolean)].slice(-20);if(Array.isArray(p.openQuestions))s.openQuestions=p.openQuestions.map((x:any)=>clean(x,500)).filter(Boolean).slice(-20);if(Array.isArray(p.artifacts))s.artifacts=p.artifacts.map((x:any)=>({name:clean(x.name,120),content:clean(x.content,3000),owner:clean(x.owner,80)})).filter((x:any)=>x.name&&x.content).slice(-12);s.activity=[...s.activity,{actor,phase:'update',text:clean(p.summary||text,1200),at:new Date().toISOString()}].slice(-40)}
async function emit(fn:TeamEvent|undefined,id:string,actor:string,phase:string,text:string){if(fn)await fn({actor,phase,text:clean(userAnswer(text),1800),workspaceId:id});}

export async function runAiTeam(input:{query:string;workspaceId?:string;history?:any[];symbol?:string;runtimeContext?:Record<string,unknown>;execute?:boolean;onEvent?:TeamEvent}){
 const query=clean(input.query);if(!query)throw new Error('query is required');const id=wid(input);
 return lock(id,async()=>{
 const runStarted=Date.now(); const timings:Record<string,number>={}; const mark=(name:string,started:number)=>{timings[name]=Date.now()-started;};
 const loadedStarted=Date.now(); const loaded=await load(id,query); mark('stateLoad',loadedStarted);
 const s=loaded.state;s.goal=query;const history=Array.isArray(input.history)?input.history.slice(-20):[];const ev=(a:string,p:string,t:string)=>emit(input.onEvent,id,a,p,t);
 const routerStarted=Date.now();
 const route=await runGemini({query:`You are the SIRE routing layer. You are not a teammate, boss, or decision maker. Your only job is to classify which capabilities are relevant so the three peer AIs can work together when useful. You are not tied to charts, coding, GitHub, Render, research, or the AI council. Normal conversation and unrelated topics should be answered directly without tools. Use chart only when the request actually concerns the user's chart or market/chart state. Use GitHub only for repository/code/file/source-control work. Use Render only for deployment, service, environment, logs, domains, infrastructure, or Render state. Use web research only when freshness or external sources are needed. Use peer collaboration when Gemini, GPT-OSS 20B, and OpenAlgo Agent can materially improve one another's work. Do not use a capability merely because it exists. Return JSON only: {"mode":"direct|chart|github|render|research|collaborate|mixed","useChart":false,"useGitHub":false,"useRender":false,"useWeb":false,"collaborate":false,"reason":"short reason"}. USER REQUEST: ${query}`,history,symbol:input.symbol,runtimeContext:input.runtimeContext,debateRole:'triage'});
 mark('chiefRouter',routerStarted); const routeJson=json(route.text)||{};
 const useChart=Boolean(routeJson.useChart)||routeJson.mode==='chart'||routeJson.mode==='mixed';
 const useGitHub=Boolean(routeJson.useGitHub)||routeJson.mode==='github'||routeJson.mode==='mixed';
 const useRender=Boolean(routeJson.useRender)||routeJson.mode==='render'||routeJson.mode==='mixed';
 const useWeb=Boolean(routeJson.useWeb)||routeJson.mode==='research'||routeJson.mode==='mixed';
 const collaborate=Boolean(routeJson.collaborate)||routeJson.mode==='collaborate'||routeJson.mode==='mixed';
 const needWeb=useWeb;const webStarted=Date.now();
 const web=needWeb?await webSearch(query,8).catch(()=>({results:[]})):{results:[]};
 mark('webResearch',webStarted);const sources=Array.isArray((web as any).results)?(web as any).results.map((x:any)=>({title:clean(x.title||x.name||x.url,180),url:clean(x.url||x.link,500),text:clean(x.text||x.content||x.snippet,1400)})).filter((x:any)=>x.url):[];const research=sources.length?'\nLIVE RESEARCH:\n'+sources.map((x:any,i:number)=>`[${i+1}] ${x.title}\n${x.url}\n${x.text}`).join('\n\n'):'';
 if(sources.length)await ev('Web','executing',`The team gathered ${sources.length} live sources for the shared workspace.`);const base=`SHARED TEAM WORKSPACE ${id}\n${stateText(s)}\n\nUSER GOAL:\n${query}${research}`;
 const agentStarted=Date.now();
 const agent = (useChart || useGitHub || useRender)
   ? await runOpenAlgoAgent({ query, history, symbol: input.symbol, runtimeContext: input.runtimeContext }).catch(error => ({ text: '', actions: [], toolTrace: [], skills: [], agentMode: 'unavailable', error: error instanceof Error ? error.message : String(error) }))
   : ({ text: '', actions: [], toolTrace: [], skills: [], agentMode: 'not_needed' });
 mark('openAlgoAgent',agentStarted); const agentContext = agent.text ? `\nOPENALGO AGENT RESULT:\n${agent.text}\nAgent skills: ${agent.skills.join(', ')}\nTool trace: ${JSON.stringify(agent.toolTrace)}` : `\nOPENALGO AGENT UNAVAILABLE: ${agent.error || 'unknown error'}`;
 // Let the model decide whether another teammate materially helps. There is no canned greeting/response list.
 const triageStarted=Date.now(); const triage=await runGemini({query:`${base}${agentContext}\n\nAct as the initial Gemini triage pass for this request. You are not the leader of the team. Decide whether this request materially benefits from Gemini+GPT collaboration. Collaboration is optional, not a requirement. For a simple greeting, casual exchange, straightforward factual question, or task you can answer correctly yourself, answer directly and quickly without inventing a team process. Collaborate when another model's expertise, verification, planning, coding, research, or execution would materially improve the result. Never use collaboration merely because this endpoint is called.\n\nReturn JSON only: {"collaborate":true|false,"userAnswer":"...","summary":"..."}. userAnswer must be the natural answer to the user if collaboration is false. Do not expose hidden chain-of-thought.`,history,symbol:input.symbol,runtimeContext:input.runtimeContext,debateRole:'triage'});
 mark('triage',triageStarted); const t=json(triage.text);
 if(t && t.collaborate===false){s.activity=[...s.activity,{actor:'Gemini',phase:'direct',text:clean(t.summary||'Answered directly without unnecessary collaboration.',1200),at:new Date().toISOString()}].slice(-40);const saveStarted=Date.now(); await save(s,loaded.id); mark('stateSave',saveStarted);
   const totalMs=Date.now()-runStarted; const slowest=Object.entries(timings).sort((a,b)=>b[1]-a[1])[0]||null;
   recordAiRun({startedAt:new Date(runStarted).toISOString(),totalMs,stages:timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0,mode:'adaptive-direct',queryType:query.slice(0,80),ok:true});
   return {diagnostics:{totalMs,timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0},text:clean(t.userAnswer||userAnswer(triage.text),12000),responseId:triage.responseId||'',model:triage.model,provider:'SIRE AI Team',teamMode:'adaptive-direct',workspaceId:id,responsibilities:s.responsibilities,decisions:s.decisions.slice(-12),openQuestions:s.openQuestions.slice(-12),artifacts:s.artifacts.slice(-8),activity:s.activity.slice(-20),execution:{status:'not_requested'},agentActions:mergedActions,agentSkills:[...new Set([...(agent.skills||[]),...(oa.skills||[]),...(oa2.skills||[])])],agentToolTrace:[...(agent.toolTrace||[]),...(oa.toolTrace||[]),...(oa2.toolTrace||[])],webSearched:sources.length>0,webSources:sources};}
 await ev('Gemini','proposing','Gemini is opening the team discussion.');const geminiPlanStarted=Date.now(); const g=await runGemini({query:base+agentContext+'\n\nYou are Gemini, one of three equal SIRE teammates. Think independently, state useful conclusions, identify uncertainties, propose work, and invite the other two to challenge you. You have no authority over GPT-OSS 20B or OpenAlgo Agent. Return JSON {"summary":"...","responsibilities":[...],"decisions":["..."],"openQuestions":["..."],"artifacts":[]}. Never expose hidden chain-of-thought.',history,symbol:input.symbol,runtimeContext:input.runtimeContext,debateRole:'proposal'});mark('geminiPlan',geminiPlanStarted); apply(s,'Gemini',g.text);await ev('Gemini','proposed',g.text);
 await ev('GPT-OSS 20B','collaborating','GPT-OSS 20B is reading Gemini and the shared workspace, then adding its own view.');const gptDiscussionStarted=Date.now(); const p=await runOpenRouter({query:base+agentContext+'\n\nGEMINI MESSAGE:\n'+g.text+'\n\nYou are GPT-OSS 20B, one of three equal SIRE teammates. Read Gemini, agree where justified, dispute weak points, add missing ideas, and volunteer for work. You have no authority over Gemini or OpenAlgo Agent. Return JSON {"summary":"...","responsibilities":[...],"decisions":["..."],"openQuestions":["..."],"artifacts":[]}. Do not expose hidden chain-of-thought.',history,councilContext:g.text});mark('gptDiscussion',gptDiscussionStarted);apply(s,'GPT-OSS 20B',p.text);await ev('GPT-OSS 20B','proposed',p.text);
 await ev('OpenAlgo Agent','collaborating','OpenAlgo Agent is reading both teammates and the shared chart/tool context, then contributing its own analysis.');const openAlgoDiscussionStarted=Date.now(); const oa=await runOpenAlgoAgent({query,runtimeContext:input.runtimeContext,symbol:input.symbol,history,councilContext:'GEMINI:\n'+g.text+'\n\nGPT-OSS 20B:\n'+p.text+'\n\nSHARED STATE:\n'+stateText(s)}).catch(error=>({text:'',actions:[],toolTrace:[],skills:[],agentMode:'unavailable',error:error instanceof Error?error.message:String(error)}));mark('openAlgoDiscussion',openAlgoDiscussionStarted);apply(s,'OpenAlgo Agent',oa.text);await ev('OpenAlgo Agent','proposed',oa.text);
 await ev('Gemini','responding','Gemini is responding to GPT-OSS 20B and OpenAlgo Agent so the three can converge or keep a disagreement visible.');const geminiResponseStarted=Date.now(); const g2=await runGemini({query:base+agentContext+'\n\nGEMINI FIRST VIEW:\n'+g.text+'\n\nGPT-OSS 20B:\n'+p.text+'\n\nOPENALGO AGENT:\n'+oa.text+'\n\nYou are still only one equal teammate. Respond to the other two. Agree, dispute, correct yourself, combine ideas, or leave a justified disagreement. Work toward a shared position rather than acting as a boss. Return JSON {"summary":"...","responsibilities":[...],"decisions":["..."],"openQuestions":["..."],"artifacts":[]}. Never expose hidden chain-of-thought.',history,symbol:input.symbol,runtimeContext:input.runtimeContext,councilContext:'GPT-OSS 20B:\n'+p.text+'\n\nOpenAlgo Agent:\n'+oa.text,debateRole:'response'});mark('geminiResponse',geminiResponseStarted);apply(s,'Gemini',g2.text);await ev('Gemini','response',g2.text);
 await ev('GPT-OSS 20B','responding','GPT-OSS 20B is checking the updated discussion and can challenge or accept the emerging team position.');const gptFinalStarted=Date.now(); const f=await runOpenRouter({query:base+agentContext+'\n\nGEMINI:\n'+g2.text+'\n\nOPENALGO AGENT:\n'+oa.text+'\n\nYou are an equal teammate, not a final authority. Review the discussion. State whether you agree, what you dispute, and what the team should do next. If you disagree, propose a correction. Return JSON {"userAnswer":"...","summary":"...","responsibilities":[...],"decisions":["..."],"openQuestions":["..."],"artifacts":[]}. The userAnswer is the team current best answer, not a statement of personal authority. Never expose hidden chain-of-thought.',history,councilContext:'Gemini:\n'+g2.text+'\n\nOpenAlgo Agent:\n'+oa.text});mark('gptFinal',gptFinalStarted);apply(s,'GPT-OSS 20B',f.text);
 await ev('OpenAlgo Agent','responding','OpenAlgo Agent is checking the full discussion and returning its tool-aware position.');const oaFinalStarted=Date.now(); const oa2=await runOpenAlgoAgent({query,runtimeContext:input.runtimeContext,symbol:input.symbol,history,councilContext:'GEMINI:\n'+g2.text+'\n\nGPT-OSS 20B:\n'+f.text+'\n\nOPENALGO FIRST VIEW:\n'+oa.text+'\n\nSHARED STATE:\n'+stateText(s)}).catch(error=>({text:'',actions:[],toolTrace:[],skills:[],agentMode:'unavailable',error:error instanceof Error?error.message:String(error)}));mark('openAlgoFinal',oaFinalStarted);apply(s,'OpenAlgo Agent',oa2.text);await ev('OpenAlgo Agent','response',oa2.text);
 const finalText=oa2.text||f.text||g2.text||oa.text||p.text||g.text; const mergedActions=[...(agent.actions||[]),...(oa.actions||[]),...(oa2.actions||[])]; const saveStarted=Date.now(); await save(s,loaded.id); mark('stateSave',saveStarted);await ev('SIRE','conclusion','The shared workspace has been updated with the team’s responsibilities, decisions, and artifacts.');
 const totalMs=Date.now()-runStarted;
 const slowest=Object.entries(timings).sort((a,b)=>b[1]-a[1])[0] || null;
 const diagnostics={totalMs,timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0};
 recordAiRun({startedAt:new Date(runStarted).toISOString(),totalMs,stages:timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0,mode:'peer-team-collaboration',queryType:query.slice(0,80),ok:true});
 return {diagnostics,text:userAnswer(finalText),responseId:oa2.responseId||f.responseId||g2.responseId||g.responseId||'',model:`team:${g.model}+${f.model}+${oa2.model||'openalgo'}`,provider:'SIRE AI Team',teamMode:'peer-team-collaboration',workspaceId:id,responsibilities:s.responsibilities,decisions:s.decisions.slice(-12),openQuestions:s.openQuestions.slice(-12),artifacts:s.artifacts.slice(-8),activity:s.activity.slice(-20),execution:input.execute?{status:'planned'}:{status:'not_requested'},agentActions:agent.actions,agentSkills:agent.skills,agentToolTrace:agent.toolTrace,webSearched:sources.length>0,webSources:sources};});
}
