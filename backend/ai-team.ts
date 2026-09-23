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
 await ev('SIRE','starting','I’m receiving your message and starting the response. I’ll keep you updated while I work.');

 // Fast path for ordinary conversation. Greetings and tiny social exchanges should never
 // enter the router/council pipeline; that pipeline is reserved for work that benefits
 // from tools, research, coding, chart context, or peer collaboration.
 const instant=/^(hi|hey|hello|hey there|hello there|yo|hiya|good morning|good afternoon|good evening|thanks|thank you|thx|ok|okay|alright|cool|nice|great|yes|no|sure|bye|goodbye|how are you|how's it going|whats up|what's up)\s*[!?.,]*$/i.test(query);
 if(instant){
   const directStarted=Date.now();
   const instantReplies:Record<string,string>={
     hi:'Hi! 👋 What can I help you with?',
     hey:'Hey! 👋 What can I help you with?',
     hello:'Hello! 👋 What can I help you with?',
     'hey there':'Hey there! 👋 What can I help you with?',
     'hello there':'Hello there! 👋 What can I help you with?',
     yo:'Hey! 👋 What can I help you with?',
     hiya:'Hi! 👋 What can I help you with?',
     'how are you':"I’m good and ready to help. What are we working on?",
     "how's it going":"Going well. What would you like to work on?",
     'whats up':"I’m here and ready. What’s up?",
     "what's up":"I’m here and ready. What’s up?"
   };
   const key=query.toLowerCase().replace(/[!?.,]+$/,'').trim();
   const text=instantReplies[key] || (key==='thanks'||key==='thank you'||key==='thx' ? "You’re welcome! 👋" : "Got it. What’s next?");
   const totalMs=Date.now()-runStarted;
   recordAiRun({startedAt:new Date(runStarted).toISOString(),totalMs,stages:{stateLoad:timings.stateLoad||0,instantReply:Date.now()-directStarted},slowestStage:'instantReply',slowestMs:Date.now()-directStarted,mode:'instant-chat',queryType:query.slice(0,80),ok:true});
   return {diagnostics:{totalMs,timings:{stateLoad:timings.stateLoad||0,instantReply:Date.now()-directStarted},slowestStage:'instantReply',slowestMs:Date.now()-directStarted},text,responseId:'',model:'SIRE instant conversation',provider:'SIRE AI Team',teamMode:'instant-chat',workspaceId:id,responsibilities:[],decisions:[],openQuestions:[],artifacts:[],activity:[{actor:'SIRE',phase:'direct',text:'Answered immediately without starting the AI team.',at:new Date().toISOString()}],execution:{status:'not_requested'},agentActions:[],agentSkills:[],agentToolTrace:[],webSearched:false,webSources:[]};
 }
 const routerStarted=Date.now();
 await ev('SIRE','routing','I’m understanding your request and deciding what kind of help it needs. I’ll answer directly when I can, and bring in tools or the peer team only when they add value.');
 const decisionPrompt=`You are SIRE's primary reasoning brain. Act like a normal general-purpose AI assistant, not a scripted router.
You can answer ordinary conversation, explanations, brainstorming, writing, and factual questions yourself. You have access to specialized capabilities when the user's request genuinely needs them: web research for fresh/external information; chart/OpenAlgo for chart or market-state work; GitHub for repository/code work; Render for deployment/infrastructure/service state; and the three-peer team (Gemini, GPT-OSS 20B, OpenAlgo Agent) for tasks where independent expertise or verification materially improves the result.
Decide dynamically from the actual request. Do NOT classify based on keyword lists, canned examples, or the fact that this endpoint exists.
For simple requests, answer now. Do not manufacture a workflow, progress stages, tool calls, or team discussion just to look busy.
For requests requiring current connected-system facts, choose the relevant capability so it can actually be checked.
For difficult or multi-step work, choose the smallest useful set of capabilities and/or peer collaboration. You may revise the plan later if evidence changes.
Never claim a tool was used unless the runtime actually uses it.
Return JSON only:
{"mode":"direct|chart|github|render|research|collaborate|mixed","useChart":false,"useGitHub":false,"useRender":false,"useWeb":false,"collaborate":false,"answer":"natural user-facing answer when mode=direct, otherwise empty","reason":"brief decision summary"}
USER REQUEST:
${query}`;
 let decision:any;
 try {
   decision=await runGemini({query:decisionPrompt,history,symbol:input.symbol,runtimeContext:input.runtimeContext,debateRole:'primary-reasoning'});
 } catch (error) {
   const fallback=await runOpenRouter({query:decisionPrompt,history,councilContext:'You are SIRE primary reasoning fallback. Decide whether to answer directly or use capabilities; do not invent tool use.'});
   decision=fallback;
 }
 mark('primaryReasoning',routerStarted); const routeJson=json(decision.text)||{};
 const useChart=Boolean(routeJson.useChart)||routeJson.mode==='chart'||routeJson.mode==='mixed';
 const useGitHub=Boolean(routeJson.useGitHub)||routeJson.mode==='github'||routeJson.mode==='mixed';
 const useRender=Boolean(routeJson.useRender)||routeJson.mode==='render'||routeJson.mode==='mixed';
 const useWeb=Boolean(routeJson.useWeb)||routeJson.mode==='research'||routeJson.mode==='mixed';
 const collaborate=Boolean(routeJson.collaborate)||routeJson.mode==='collaborate'||routeJson.mode==='mixed';

 if(routeJson.mode==='direct' && clean(routeJson.answer,12000)){
   s.activity=[...s.activity,{actor:'SIRE',phase:'direct',text:'Answered directly from the primary reasoning pass; no extra tools or peer work were needed.',at:new Date().toISOString()}].slice(-40);
   const saveStarted=Date.now(); await save(s,loaded.id); mark('stateSave',saveStarted);
   const totalMs=Date.now()-runStarted; const slowest=Object.entries(timings).sort((a,b)=>b[1]-a[1])[0]||null;
   recordAiRun({startedAt:new Date(runStarted).toISOString(),totalMs,stages:timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0,mode:'adaptive-direct',queryType:query.slice(0,80),ok:true});
   return {diagnostics:{totalMs,timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0},text:clean(routeJson.answer,12000),responseId:decision.responseId||'',model:decision.model||'primary-reasoning',provider:'SIRE AI Team',teamMode:'adaptive-direct',workspaceId:id,responsibilities:s.responsibilities,decisions:s.decisions.slice(-12),openQuestions:s.openQuestions.slice(-12),artifacts:s.artifacts.slice(-8),activity:s.activity.slice(-20),execution:{status:'not_requested'},agentActions:[],agentSkills:[],agentToolTrace:[],webSearched:false,webSources:[]};
 }

 const needWeb=useWeb; const webStarted=Date.now();
 if(needWeb) await ev('SIRE','research','I’m gathering current external information because this request needs fresh research.');
 const web=needWeb?await webSearch(query,8).catch(()=>({results:[]})):{results:[]};
 mark('webResearch',webStarted); const sources=Array.isArray((web as any).results)?(web as any).results.map((x:any)=>({title:clean(x.title||x.name||x.url,180),url:clean(x.url||x.link,500),text:clean(x.text||x.content||x.snippet,1400)})).filter((x:any)=>x.url):[];
 const research=sources.length?'\\nLIVE RESEARCH:\\n'+sources.map((x:any,i:number)=>`[${i+1}] ${x.title}\\n${x.url}\\n${x.text}`).join('\\n\\n'):'';
 if(sources.length)await ev('Web','executing',`The system gathered ${sources.length} live sources for the shared workspace.`);
 const base=`SHARED TEAM WORKSPACE ${id}\\n${stateText(s)}\\n\\nUSER GOAL:\\n${query}${research}`;

 const agentStarted=Date.now();
 if(useChart||useGitHub||useRender) await ev('OpenAlgo Agent','executing','OpenAlgo Agent is checking the relevant chart, code, GitHub, Render, or execution context.');
 const agent = (useChart || useGitHub || useRender)
   ? await runOpenAlgoAgent({ query, history, symbol: input.symbol, runtimeContext: input.runtimeContext }).catch(error => ({ text: '', actions: [], toolTrace: [], skills: [], agentMode: 'unavailable', error: error instanceof Error ? error.message : String(error) }))
   : ({ text: '', actions: [], toolTrace: [], skills: [], agentMode: 'not_needed' });
 mark('openAlgoAgent',agentStarted); const agentContext = agent.text ? `\\nOPENALGO AGENT RESULT:\\n${agent.text}\\nAgent skills: ${agent.skills.join(', ')}\\nTool trace: ${JSON.stringify(agent.toolTrace)}` : `\\nOPENALGO AGENT UNAVAILABLE: ${agent.error || 'unknown error'}`;

 const triageStarted=Date.now(); await ev('Gemini','planning','Gemini is checking whether the request is simple enough to answer directly or benefits from the peer team.'); await ev('SIRE','parallel','The three peer AIs are working independently before seeing one another.');
 const independentPrompt=base+agentContext+'\n\nYou are one of three equal peer AIs: Gemini, GPT-OSS 20B, or OpenAlgo Agent. Work independently first. Use your own expertise. Give a concise reasoning summary, proposed approach, risks, and work you can own. You have equal authority with the other peers. Do not expose hidden chain-of-thought.';
 const independentStarted=Date.now();
 const [g,p,oa]=await Promise.all([
   runGemini({query:independentPrompt,history,symbol:input.symbol,runtimeContext:input.runtimeContext,debateRole:'independent'}),
   runOpenRouter({query:independentPrompt,history,councilContext:'Independent pass: form your own view before seeing the other peers.'}),
   runOpenAlgoAgent({query,runtimeContext:input.runtimeContext,symbol:input.symbol,history,councilContext:'Independent pass: form your own tool-aware view before seeing the other peers.'}).catch(error=>({text:'',actions:[],toolTrace:[],skills:[],agentMode:'unavailable',error:error instanceof Error?error.message:String(error)}))
 ]);
 mark('independentPeerPass',independentStarted);
 apply(s,'Gemini',g.text);apply(s,'GPT-OSS 20B',p.text);apply(s,'OpenAlgo Agent',oa.text);
 await ev('Gemini','independent',g.text);await ev('GPT-OSS 20B','independent',p.text);await ev('OpenAlgo Agent','independent',oa.text);
 const peerPacket='GEMINI INDEPENDENT VIEW:\n'+g.text+'\n\nGPT-OSS 20B INDEPENDENT VIEW:\n'+p.text+'\n\nOPENALGO AGENT INDEPENDENT VIEW:\n'+oa.text+'\n\nSHARED STATE:\n'+stateText(s);
 await ev('SIRE','team_start','The three peers are now working as an adaptive team. No peer is the leader; the runtime only schedules work and enforces safety limits.');
 const outputs:any[]=[{actor:'Gemini',data:g},{actor:'GPT-OSS 20B',data:p},{actor:'OpenAlgo Agent',data:oa}];
 const seen=new Set<string>(); let round=0; let finished=false; let finalCandidate=''; const MAX_ROUNDS=8;
 const packet=()=>outputs.slice(-18).map((x:any)=>x.actor.toUpperCase()+' PEER UPDATE:\n'+clean(x.data?.text||'',5000)).join('\n\n');
 while(!finished&&round<MAX_ROUNDS){ round++; const ctx=base+agentContext+'\n\n'+packet()+'\n\nBLACKBOARD:\n'+stateText(s);
  const ps=Date.now();
  const [gp,pp,op]=await Promise.all([
   runGemini({query:ctx+'\n\nYou are Gemini, an equal peer. Decide what useful work should happen next. You may own work, request another peer, verify evidence, use capabilities, challenge assumptions, or declare solved. Do not merely critique. Return JSON only: {"status":"continue|done|blocked","tasks":[{"owner":"Gemini|GPT-OSS 20B|OpenAlgo Agent","task":"specific work"}],"answer":"..."}.',history,symbol:input.symbol,runtimeContext:input.runtimeContext,councilContext:packet(),debateRole:'adaptive-planning'}),
   runOpenRouter({query:ctx+'\n\nYou are GPT-OSS 20B, an equal peer. Decide what useful work should happen next. You may own work, request another peer, verify evidence, challenge assumptions, or declare solved. Do not merely critique. Return JSON only: {"status":"continue|done|blocked","tasks":[{"owner":"Gemini|GPT-OSS 20B|OpenAlgo Agent","task":"specific work"}],"answer":"..."}.',history,councilContext:packet()}),
   runOpenAlgoAgent({query,runtimeContext:input.runtimeContext,symbol:input.symbol,history,councilContext:ctx+'\n\nYou are OpenAlgo Agent, an equal peer. Decide and execute useful next work when possible. Use chart/GitHub/Render/research capabilities when relevant. Do not merely critique.'}).catch(error=>({text:'',actions:[],toolTrace:[],skills:[],agentMode:'unavailable',error:error instanceof Error?error.message:String(error)}))
  ]); mark('adaptivePlanningRound'+round,ps);
  outputs.push({actor:'Gemini',data:gp},{actor:'GPT-OSS 20B',data:pp},{actor:'OpenAlgo Agent',data:op});
  const plans=[['Gemini',gp],['GPT-OSS 20B',pp],['OpenAlgo Agent',op]].map((x:any)=>({actor:x[0],data:x[1],json:json(x[1].text)||{status:'continue',tasks:[]}}));
  for(const x of plans){apply(s,x.actor,x.data.text||'');await ev(x.actor,'planning',x.data.text||'');if(x.json.answer)finalCandidate=clean(x.json.answer,12000);}
  const tasks:any[]=[]; for(const x of plans)for(const t of Array.isArray(x.json.tasks)?x.json.tasks:[]){const owner=['Gemini','GPT-OSS 20B','OpenAlgo Agent'].includes(t.owner)?t.owner:x.actor;const task=clean(t.task,700);const key=owner+'|'+task.toLowerCase();if(task&&!seen.has(key)&&tasks.length<4){seen.add(key);tasks.push({owner,task});}}
  if(plans.every((x:any)=>x.json.status==='done')||(!tasks.length&&plans.some((x:any)=>x.json.answer))){finished=true;break;}
  if(!tasks.length)continue;
  await ev('SIRE','dispatch','Round '+round+': peers dynamically selected '+tasks.length+' task(s).');
  const es=Date.now(); const results=await Promise.all(tasks.map(async(t:any)=>{const q=ctx+'\n\nTASK TO EXECUTE:\n'+JSON.stringify(t)+'\n\nActually perform the useful work. Do not merely critique. Return JSON only: {"status":"done|continue|blocked","result":"concrete work","answer":"...","followups":["..."]}.';if(t.owner==='Gemini')return {actor:t.owner,data:await runGemini({query:q,history,symbol:input.symbol,runtimeContext:input.runtimeContext,councilContext:packet(),debateRole:'task-execution'})};if(t.owner==='GPT-OSS 20B')return {actor:t.owner,data:await runOpenRouter({query:q,history,councilContext:packet()})};return {actor:t.owner,data:await runOpenAlgoAgent({query,runtimeContext:input.runtimeContext,symbol:input.symbol,history,councilContext:q}).catch(error=>({text:'',actions:[],toolTrace:[],skills:[],agentMode:'unavailable',error:error instanceof Error?error.message:String(error)}))};})); mark('adaptiveExecutionRound'+round,es);
  for(const r of results){outputs.push(r);apply(s,r.actor,r.data.text||'');await ev(r.actor,'task_execution',r.data.text||'');const j=json(r.data.text||'')||{};if(j.answer)finalCandidate=clean(j.answer,12000);}
  if(results.every((r:any)=>(json(r.data.text||'')||{}).status==='done')&&round>=2){const vs=await Promise.all([runGemini({query:ctx+'\n\nVerify completion independently. Return JSON only {"done":true|false,"missing":"...","answer":"..."}.',history,councilContext:packet(),debateRole:'verification'}),runOpenRouter({query:ctx+'\n\nVerify completion independently. Return JSON only {"done":true|false,"missing":"...","answer":"..."}.',history,councilContext:packet()}),runOpenAlgoAgent({query,runtimeContext:input.runtimeContext,symbol:input.symbol,history,councilContext:ctx+'\n\nVerify completion independently.'}).catch(error=>({text:'',actions:[],toolTrace:[],skills:[],agentMode:'unavailable',error:error instanceof Error?error.message:String(error)}))]);const vj=vs.map((x:any)=>json(x.text)||{done:false});if(vj.every((x:any)=>x.done===true)){finalCandidate=vj.map((x:any)=>x.answer).find(Boolean)||finalCandidate;finished=true;}}
 }
 const finalStarted=Date.now(); const finalCtx=base+agentContext+'\n\nFINAL TEAM WORK:\n'+packet()+'\n\nBLACKBOARD:\n'+stateText(s);
 const [fg,fp,fo]=await Promise.all([runGemini({query:finalCtx+'\n\nGive the strongest user-facing answer from completed work. Do not invent work or consensus.',history,symbol:input.symbol,runtimeContext:input.runtimeContext,councilContext:packet(),debateRole:'final'}),runOpenRouter({query:finalCtx+'\n\nGive the strongest user-facing answer from completed work. Do not invent work or consensus.',history,councilContext:packet()}),runOpenAlgoAgent({query,runtimeContext:input.runtimeContext,symbol:input.symbol,history,councilContext:finalCtx}).catch(error=>({text:'',actions:[],toolTrace:[],skills:[],agentMode:'unavailable',error:error instanceof Error?error.message:String(error)}))]); mark('finalPeerPass',finalStarted);
 apply(s,'Gemini',fg.text);apply(s,'GPT-OSS 20B',fp.text);apply(s,'OpenAlgo Agent',fo.text);
 const finalText=userAnswer(fg.text||fp.text||fo.text||finalCandidate); const saveStarted=Date.now();await save(s,loaded.id);mark('stateSave',saveStarted);await ev('SIRE','conclusion','Adaptive collaboration stopped after '+round+' round(s) because the peers reached a completion condition or the safety bound.');
 const totalMs=Date.now()-runStarted;const slowest=Object.entries(timings).sort((a,b)=>b[1]-a[1])[0]||null;const diagnostics={totalMs,timings,rounds:round,maxRounds:MAX_ROUNDS,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0};recordAiRun({startedAt:new Date(runStarted).toISOString(),totalMs,stages:timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0,mode:'adaptive-peer-team',queryType:query.slice(0,80),ok:true});
 return {diagnostics,text:finalText,responseId:fg.responseId||fp.responseId||fo.responseId||'',model:'team:'+((fg.model)||'gemini')+'+'+((fp.model)||'gpt-oss-20b')+'+'+((fo.model)||'openalgo'),provider:'SIRE AI Team',teamMode:'adaptive-peer-team',workspaceId:id,responsibilities:s.responsibilities,decisions:s.decisions.slice(-12),openQuestions:s.openQuestions.slice(-12),artifacts:s.artifacts.slice(-8),activity:s.activity.slice(-20),execution:input.execute?{status:'planned'}:{status:'not_requested'},agentActions:[...(agent.actions||[]),...(oa.actions||[]),...(fo.actions||[])],agentSkills:[...(agent.skills||[]),...(oa.skills||[])],agentToolTrace:[...(agent.toolTrace||[]),...(oa.toolTrace||[])],webSearched:sources.length>0,webSources:sources};});
}
