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
 const accessQuery=/\b(github|git hub|render)\b/i.test(query)&&/\b(access|permission|permissions|connected|connection|repository|repo|workspace|authenticate|authentication|auth)\b/i.test(query);
 if(accessQuery){
   const verifyStarted=Date.now();
   const verified=await verifyConfiguredConnectors();
   mark('connectorVerification',verifyStarted);
   const gh:any=verified.github||{}, rr:any=verified.render||{};
   const githubReady=Boolean(gh.ok), renderReady=Boolean(rr.ok);
   const githubRepo = gh.repository?.fullName || 't86162100-byte/SIRE';
   const textAnswer = githubReady && renderReady
     ? `Yes. SIRE has access to GitHub and Render. GitHub: ${githubRepo} is connected, and the SIRE GitHub connector is configured for read/write/execute operations. Render: ${rr.workspaceCount||0} workspace${rr.workspaceCount===1?'':'s'} is visible, with the Render connector configured for read/write/deploy operations. I can use those connections from SIRE when a task requires them.`
     : [
         githubReady ? `GitHub is connected to ${githubRepo}.` : `GitHub is not available to SIRE: ${gh.error||'the GitHub credential is not configured'}.`,
         renderReady ? `Render is connected; ${rr.workspaceCount||0} workspace${rr.workspaceCount===1?'':'s'} is visible.` : `Render is not available to SIRE: ${rr.error||'the Render credential is not configured'}.`
       ].join(' ');
   const totalMs=Date.now()-runStarted;
   const slowest=Object.entries(timings).sort((a,b)=>b[1]-a[1])[0]||null;
   const diagnostics={totalMs,timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0};
   recordAiRun({startedAt:new Date(runStarted).toISOString(),totalMs,stages:timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0,mode:'connector-verification',queryType:query.slice(0,80),ok:githubReady&&renderReady});
   return {diagnostics,text:textAnswer,responseId:'',model:'connector-verification',provider:'SIRE runtime',teamMode:'verified-access',workspaceId:id,responsibilities:[],decisions:[],openQuestions:[],artifacts:[],activity:[],execution:{status:'not_requested'},agentActions:[],agentSkills:[],agentToolTrace:[{tool:'verify_configured_connectors',github:gh.ok?'verified':'unavailable',render:rr.ok?'verified':'unavailable'}],webSearched:false,webSources:[]};
 }
 const fastPath=/^(hi|hello|hey|thanks|thank you|ok|okay|good morning|good afternoon|good evening|how are you|what can you do)\b/i.test(query)
   || /\b(analy[sz]e the (current|this|my) chart|chart analysis|analy[sz]e current market)\b/i.test(query);
 if(fastPath){
   const fastStarted=Date.now();
   await ev('SIRE','checking',/chart/i.test(query)?'Reading the current chart context directly.':'Answering directly without running the full council.');
   const fastResult=await runGemini({query,history,symbol:input.symbol,runtimeContext:input.runtimeContext,debateRole:'response'}).catch(error=>({text:'',responseId:'',model:'',provider:'Google Gemini',error:error instanceof Error?error.message:String(error)}));
   mark('fastResponse',fastStarted);
   if(!fastResult.text) throw new Error(fastResult.error||'Fast SIRE response failed');
   const totalMs=Date.now()-runStarted; const slowest=Object.entries(timings).sort((a,b)=>b[1]-a[1])[0]||null;
   const diagnostics={totalMs,timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0};
   recordAiRun({startedAt:new Date(runStarted).toISOString(),totalMs,stages:timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0,mode:'fast-path',queryType:query.slice(0,80),ok:true});
   return {diagnostics,text:userAnswer(fastResult.text),responseId:fastResult.responseId||'',model:fastResult.model,provider:'SIRE AI Team',teamMode:'fast-path',workspaceId:id,responsibilities:s.responsibilities,decisions:s.decisions.slice(-12),openQuestions:s.openQuestions.slice(-12),artifacts:s.artifacts.slice(-8),activity:s.activity.slice(-20),execution:{status:'not_requested'},agentActions:[],agentSkills:[],agentToolTrace:[],webSearched:false,webSources:[]};
 }
 const needWeb=/\b(latest|today|current|now|recent|news|price|market|research|search|look up|source|compare|2026|2025)\b/i.test(query)||/https?:\/\//.test(query);const webStarted=Date.now();
 const web=needWeb?await webSearch(query,8).catch(()=>({results:[]})):{results:[]};
 mark('webResearch',webStarted);const sources=Array.isArray((web as any).results)?(web as any).results.map((x:any)=>({title:clean(x.title||x.name||x.url,180),url:clean(x.url||x.link,500),text:clean(x.text||x.content||x.snippet,1400)})).filter((x:any)=>x.url):[];const research=sources.length?'\nLIVE RESEARCH:\n'+sources.map((x:any,i:number)=>`[${i+1}] ${x.title}\n${x.url}\n${x.text}`).join('\n\n'):'';
 if(sources.length)await ev('Web','executing',`The team gathered ${sources.length} live sources for the shared workspace.`);const base=`SHARED TEAM WORKSPACE ${id}\n${stateText(s)}\n\nUSER GOAL:\n${query}${research}`;
 const agentStarted=Date.now();
 const agent = await runOpenAlgoAgent({ query, history, symbol: input.symbol, runtimeContext: input.runtimeContext }).catch(error => ({ text: '', actions: [], toolTrace: [], skills: [], agentMode: 'unavailable', error: error instanceof Error ? error.message : String(error) }));
 mark('openAlgoAgent',agentStarted); const agentContext = agent.text ? `\nOPENALGO AGENT RESULT:\n${agent.text}\nAgent skills: ${agent.skills.join(', ')}\nTool trace: ${JSON.stringify(agent.toolTrace)}` : `\nOPENALGO AGENT UNAVAILABLE: ${agent.error || 'unknown error'}`;
 // Let the model decide whether another teammate materially helps. There is no canned greeting/response list.
 const triageStarted=Date.now(); const triage=await runGemini({query:`${base}${agentContext}\n\nAct as the lead AI for this request. Decide whether this request materially benefits from Gemini+GPT collaboration. Collaboration is optional, not a requirement. For a simple greeting, casual exchange, straightforward factual question, or task you can answer correctly yourself, answer directly and quickly without inventing a team process. Collaborate when another model's expertise, verification, planning, coding, research, or execution would materially improve the result. Never use collaboration merely because this endpoint is called.\n\nReturn JSON only: {"collaborate":true|false,"userAnswer":"...","summary":"..."}. userAnswer must be the natural answer to the user if collaboration is false. Do not expose hidden chain-of-thought.`,history,symbol:input.symbol,runtimeContext:input.runtimeContext,debateRole:'triage'});
 mark('triage',triageStarted); const t=json(triage.text);
 if(t && t.collaborate===false){s.activity=[...s.activity,{actor:'Gemini',phase:'direct',text:clean(t.summary||'Answered directly without unnecessary collaboration.',1200),at:new Date().toISOString()}].slice(-40);const saveStarted=Date.now(); await save(s,loaded.id); mark('stateSave',saveStarted);
   const totalMs=Date.now()-runStarted; const slowest=Object.entries(timings).sort((a,b)=>b[1]-a[1])[0]||null;
   recordAiRun({startedAt:new Date(runStarted).toISOString(),totalMs,stages:timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0,mode:'adaptive-direct',queryType:query.slice(0,80),ok:true});
   return {diagnostics:{totalMs,timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0},text:clean(t.userAnswer||userAnswer(triage.text),12000),responseId:triage.responseId||'',model:triage.model,provider:'SIRE AI Team',teamMode:'adaptive-direct',workspaceId:id,responsibilities:s.responsibilities,decisions:s.decisions.slice(-12),openQuestions:s.openQuestions.slice(-12),artifacts:s.artifacts.slice(-8),activity:s.activity.slice(-20),execution:{status:'not_requested'},agentActions:agent.actions,agentSkills:agent.skills,agentToolTrace:agent.toolTrace,webSearched:sources.length>0,webSources:sources};}
 await ev('Gemini','proposing','Gemini is proposing a plan and volunteering for work.');const geminiPlanStarted=Date.now(); const g=await runGemini({query:`${base}${agentContext}\n\nYou are Gemini, the planning teammate. Propose a practical plan, volunteer for work, and identify what GPT should own. Agree where appropriate; do not debate for its own sake. Return a concise visible summary followed by JSON {"summary":"...","responsibilities":[{"owner":"Gemini|GPT","task":"...","status":"proposed|in_progress"}],"decisions":["..."],"openQuestions":["..."],"artifacts":[]}. Never expose hidden chain-of-thought.`,history,symbol:input.symbol,runtimeContext:input.runtimeContext,debateRole:'proposal'});mark('geminiPlan',geminiPlanStarted); apply(s,'Gemini',g.text);await ev('Gemini','proposed',g.text);
 await ev('GPT','collaborating','GPT is reading the shared state, accepting or improving the plan, and choosing its responsibility.');const gptDiscussionStarted=Date.now(); const p=await runOpenRouter({query:`${base}${agentContext}\n\nUPDATED SHARED STATE:\n${stateText(s)}\n\nGEMINI CONTRIBUTION:\n${g.text}\n\nYou are GPT, the second teammate. Work with Gemini toward the goal. Accept useful ideas, improve gaps, volunteer for work, and propose a joint decision. Return concise summary plus JSON {"summary":"...","responsibilities":[...],"decisions":["..."],"openQuestions":["..."],"artifacts":[]}. Do not expose hidden chain-of-thought.`,history,councilContext:g.text});mark('gptDiscussion',gptDiscussionStarted); apply(s,'GPT',p.text);await ev('GPT','proposed',p.text);
 await ev('Gemini','coordinating','Gemini is reviewing GPT and coordinating responsibilities.');const geminiCoordStarted=Date.now(); const r=await runGemini({query:`${base}${agentContext}\n\nSHARED STATE:\n${stateText(s)}\n\nGPT CONTRIBUTION:\n${p.text}\n\nCoordinate the team. Confirm agreements, resolve real conflicts, reassign work if useful, and state the joint decision. Return concise summary plus JSON {"summary":"...","responsibilities":[...],"decisions":["..."],"openQuestions":["..."],"artifacts":[]}.`,history,symbol:input.symbol,runtimeContext:input.runtimeContext,councilContext:p.text,debateRole:'response'});mark('geminiCoordination',geminiCoordStarted); apply(s,'Gemini',r.text);await ev('Gemini','coordinated',r.text);
 await ev('GPT','executing','GPT is turning the agreed plan into the concrete next action.');const gptFinalStarted=Date.now(); const f=await runOpenRouter({query:`${base}${agentContext}\n\nFINAL SHARED STATE:\n${stateText(s)}\n\nGEMINI COORDINATION:\n${r.text}\n\nGPT CONTRIBUTION:\n${p.text}\n\nYou are the execution teammate. Produce the direct answer and concrete next action. If external execution is requested, distinguish actions actually confirmed by SIRE tools from actions still requiring authorization. Return a JSON object containing {"userAnswer":"...","summary":"...","responsibilities":[...],"decisions":["..."],"openQuestions":["..."],"artifacts":[...]}. The userAnswer is the only user-facing answer and must contain no team-state JSON or internal protocol. Never claim an external action occurred without tool confirmation.`,history,councilContext:`SHARED STATE:\n${stateText(s)}\n\nGemini coordination:\n${r.text}`});mark('gptFinal',gptFinalStarted); apply(s,'GPT',f.text); const saveStarted=Date.now(); await save(s,loaded.id); mark('stateSave',saveStarted);await ev('SIRE','conclusion','The shared workspace has been updated with the team’s responsibilities, decisions, and artifacts.');
 const totalMs=Date.now()-runStarted;
 const slowest=Object.entries(timings).sort((a,b)=>b[1]-a[1])[0] || null;
 const diagnostics={totalMs,timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0};
 recordAiRun({startedAt:new Date(runStarted).toISOString(),totalMs,stages:timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0,mode:'shared-workspace-collaboration',queryType:query.slice(0,80),ok:true});
 return {diagnostics,text:userAnswer(f.text),responseId:f.responseId||g.responseId||'',model:`team:${g.model}+${f.model}`,provider:'SIRE AI Team',teamMode:'shared-workspace-collaboration',workspaceId:id,responsibilities:s.responsibilities,decisions:s.decisions.slice(-12),openQuestions:s.openQuestions.slice(-12),artifacts:s.artifacts.slice(-8),activity:s.activity.slice(-20),execution:input.execute?{status:'planned'}:{status:'not_requested'},agentActions:agent.actions,agentSkills:agent.skills,agentToolTrace:agent.toolTrace,webSearched:sources.length>0,webSources:sources};});
}
