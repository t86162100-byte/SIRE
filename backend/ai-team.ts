import { db } from '@appdeploy/sdk';
import { runOpenRouter, runGptHead } from './openrouter-ai.ts';
import { webSearch, verifyConfiguredConnectors, connectorRequest } from './agent-tools.ts';
import { runOpenAlgoAgent } from './openalgo-agent.ts';
import { recordAiRun } from './sire-ai-monitor.ts';

type TeamEvent = (e:{actor:string;phase:string;text:string;workspaceId:string})=>void|Promise<void>;
type State = {workspaceId:string;goal:string;responsibilities:any[];decisions:string[];openQuestions:string[];artifacts:any[];activity:any[];updatedAt:string};
const TABLE='sire_ai_team_state_v1', memory=new Map<string,State>(), locks=new Map<string,Promise<void>>();
const clean=(v:unknown,n=9000)=>String(v??'').trim().slice(0,n);
const wid=(i:any)=>clean(i.workspaceId||i.workspace||i.sessionId||'default',180)||'default';
const empty=(id:string,goal:string):State=>({workspaceId:id,goal,responsibilities:[],decisions:[],openQuestions:[],artifacts:[],activity:[],updatedAt:new Date().toISOString()});
async function withTimeout<T>(promise:Promise<T>,ms:number,label:string):Promise<T>{let timer:any;try{return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)),ms);})]);}finally{if(timer)clearTimeout(timer);}}
async function load(id:string,goal:string){if(!process.env.DATABASE_URL)return{state:memory.get(id)||empty(id,goal)};try{const r=await withTimeout(db.list(TABLE,{limit:1000}),1500,'AI team state load');const x=r.items.find((v:any)=>v?.workspaceId===id);return x?{id:x.id,state:{...empty(id,goal),...x,goal:goal||x.goal}}:{state:empty(id,goal)}}catch(e){console.warn('[AI TEAM] state load fallback:',e instanceof Error?e.message:String(e));return{state:memory.get(id)||empty(id,goal)}}}
async function save(s:State,id?:string){s.updatedAt=new Date().toISOString();memory.set(s.workspaceId,s);if(!process.env.DATABASE_URL)return;try{if(id)await withTimeout(db.update(TABLE,[{id,record:s}]),1500,'AI team state update');else await withTimeout(db.add(TABLE,[s]),1500,'AI team state insert')}catch(e){console.warn('[AI TEAM] state save fallback:',e instanceof Error?e.message:String(e));}}
async function lock<T>(id:string,fn:()=>Promise<T>):Promise<T>{const p=locks.get(id)||Promise.resolve();let release!:()=>void;const c=new Promise<void>(r=>release=r);locks.set(id,p.then(()=>c));await p;try{return await fn()}finally{release();if(locks.get(id)===c)locks.delete(id)}}
const stateText=(s:State)=>JSON.stringify({goal:s.goal,responsibilities:s.responsibilities.slice(-12),decisions:s.decisions.slice(-12),openQuestions:s.openQuestions.slice(-12),artifacts:s.artifacts.slice(-8)},null,2);

export async function runAiTeam(input:{query:string;workspaceId?:string;history?:any[];symbol?:string;runtimeContext?:Record<string,unknown>;execute?:boolean;onEvent?:TeamEvent}){
 const query=clean(input.query);if(!query)throw new Error('query is required');const id=wid(input);
 return lock(id,async()=>{
  const started=Date.now();const timings:Record<string,number>={};const delegatedActions:any[]=[];const loadedAt=Date.now();const loaded=await load(id,query);timings.stateLoad=Date.now()-loadedAt;const s=loaded.state;s.goal=query;
  const ev=async(actor:string,phase:string,text:string)=>{const item={actor,phase,text:clean(text,1800),at:new Date().toISOString()};s.activity=[...s.activity,item].slice(-40);if(input.onEvent)await input.onEvent({actor,phase,text:item.text,workspaceId:id});};
  await ev('GPT','thinking','GPT is thinking about your message.');
  const headStarted=Date.now();
  const result=await runGptHead({
    query,
    history:Array.isArray(input.history)?input.history.slice(-20):[],
    onEvent:async(e)=>{await ev(e.actor,e.phase,e.text);},
    tools:{
      askOpenAlgo:async(task)=>{
        const t=Date.now();await ev('OpenAlgo Agent','thinking','OpenAlgo Agent is inspecting the relevant chart, code, deployment, or tool context.');
        try {
          const r=await runOpenAlgoAgent({query:task,history:Array.isArray(input.history)?input.history.slice(-20):[],symbol:input.symbol,runtimeContext:input.runtimeContext,councilContext:`GPT delegated this task to you. Work on the concrete technical problem and return concise findings/actions for GPT to use. Do not expose hidden chain-of-thought.\\n\\nUSER REQUEST:\\n${query}\\n\\nDELEGATED TASK:\\n${task}`});
          if (Array.isArray(r.actions)) delegatedActions.push(...r.actions);
          timings.openAlgo=Date.now()-t;
          return JSON.stringify({text:r.text,actions:Array.isArray(r.actions)?r.actions:[],skills:r.skills||[],toolTrace:r.toolTrace||[]});
        } catch (error) {
          timings.openAlgo=Date.now()-t;
          return JSON.stringify({error:error instanceof Error?error.message:String(error),actions:[]});
        }
      },
      checkIntegrations:async()=>{
        const checks=await verifyConfiguredConnectors();
        return JSON.stringify(checks);
      },
      githubRequest:async(input)=>{
        const method=String(input.method||'GET').toUpperCase();
        const permission=String(input.permission||((method==='GET')?'read':'write'));
        const path=String(input.path||'').trim();
        if(!path.startsWith('/')) throw new Error('GitHub API path must start with /');
        if(method==='GET') return JSON.stringify(await connectorRequest('github',path,{method},'read'));
        const body=input.body===undefined?undefined:JSON.stringify(input.body);
        return JSON.stringify(await connectorRequest('github',path,{
          method,
          headers: body ? {'content-type':'application/json'} : undefined,
          body,
        },permission as any));
      },
      webSearch:async(q)=>{
        const t=Date.now();await ev('Web','research','Gemini decided that current external information is needed, so SIRE is searching the web.');const r=await webSearch(q,8).catch(()=>({results:[]}));timings.webSearch=Date.now()-t;
        return Array.isArray((r as any).results)?(r as any).results.map((x:any)=>`TITLE: ${clean(x.title||x.name||x.url,180)}\nURL: ${clean(x.url||x.link,500)}\n${clean(x.text||x.content||x.snippet,1400)}`).join('\n\n'):'';
      },
    }
  });
  timings.gptHead=Date.now()-headStarted;
  s.decisions=[...s.decisions,`GPT head completed the request and delegated only where useful.`].slice(-20);
  s.activity=[...s.activity,{actor:'GPT',phase:'conclusion',text:'GPT completed the response after deciding dynamically whether additional help was needed.',at:new Date().toISOString()}].slice(-40);
  const saveAt=Date.now();await save(s,loaded.id);timings.stateSave=Date.now()-saveAt;
  const totalMs=Date.now()-started;const slowest=Object.entries(timings).sort((a,b)=>b[1]-a[1])[0]||null;
  const diagnostics={totalMs,timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0};
  recordAiRun({startedAt:new Date(started).toISOString(),totalMs,stages:timings,slowestStage:slowest?.[0]||null,slowestMs:slowest?.[1]||0,mode:'gpt-head',queryType:query.slice(0,80),ok:true});
  return {diagnostics,text:result.text,responseId:result.responseId||'',model:result.model||'openai/gpt-oss-20b',provider:'OpenAI gpt-oss via OpenRouter',teamMode:'gpt-head',workspaceId:id,responsibilities:s.responsibilities,decisions:s.decisions.slice(-12),openQuestions:s.openQuestions.slice(-12),artifacts:s.artifacts.slice(-8),activity:s.activity.slice(-20),execution:input.execute?{status:'planned'}:{status:'not_requested'},actions:delegatedActions,agentActions:delegatedActions,agentSkills:[],agentToolTrace:[],webSearched:Boolean(timings.webSearch),webSources:[],sharedState:stateText(s)};
 });
}
