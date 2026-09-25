type OpenAIMessage = { role:string; content?:unknown; tool_calls?:any[]; name?:string };

function bridgeToken() {
  const token=String(process.env.SIRE_AGENT_BRIDGE_TOKEN||'').trim();
  if(!token) throw Object.assign(new Error('SIRE_AGENT_BRIDGE_TOKEN is not configured'),{status:503});
  return token;
}
function assertAuthorized(headers:any) {
  const supplied=String(headers?.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!supplied || supplied!==bridgeToken()) throw Object.assign(new Error('Unauthorized model bridge request'),{status:401});
}
function contentText(v:any) {
  if(typeof v==='string') return v;
  if(Array.isArray(v)) return v.map((p:any)=>typeof p?.text==='string'?p.text:'').filter(Boolean).join('\n');
  return '';
}
function toGemini(messages:OpenAIMessage[]) {
  const system:string[]=[]; const contents:any[]=[];
  for(const m of messages||[]) {
    const role=String(m?.role||'user');
    if(role==='system'||role==='developer'){const t=contentText(m.content);if(t)system.push(t);continue;}
    if(role==='tool'){contents.push({role:'user',parts:[{functionResponse:{name:String(m.name||'tool'),response:{result:contentText(m.content)}}}]});continue;}
    if(role==='assistant'){
      const parts:any[]=[]; const t=contentText(m.content); if(t)parts.push({text:t});
      for(const call of Array.isArray(m.tool_calls)?m.tool_calls:[]){
        const fn=call?.function||{}; let args:any={};
        try{args=typeof fn.arguments==='string'?JSON.parse(fn.arguments||'{}'):(fn.arguments||{});}catch{}
        parts.push({functionCall:{name:String(fn.name||'tool'),args}});
      }
      if(parts.length)contents.push({role:'model',parts}); continue;
    }
    const t=contentText(m.content); if(t)contents.push({role:'user',parts:[{text:t}]});
  }
  return {system,contents};
}
async function callGemini(model:string,body:any,key:string){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(body)});
    const raw=await response.text(); let data:any={}; try{data=raw?JSON.parse(raw):{};}catch{data={error:raw};}
    return {response,data};
  }finally{clearTimeout(timer);}
}
function toOpenAI(model:string,data:any){
  const parts=Array.isArray(data?.candidates?.[0]?.content?.parts)?data.candidates[0].content.parts:[];
  const text=parts.filter((p:any)=>typeof p?.text==='string').map((p:any)=>p.text).join('');
  const calls=parts.filter((p:any)=>p?.functionCall?.name).map((p:any,i:number)=>({id:`call_${Date.now()}_${i}`,type:'function',function:{name:String(p.functionCall.name),arguments:JSON.stringify(p.functionCall.args||{})}}));
  const message:any={role:'assistant',content:text||null}; if(calls.length)message.tool_calls=calls;
  return {id:String(data?.responseId||`sire-gemini-${Date.now()}`),object:'chat.completion',created:Math.floor(Date.now()/1000),model,choices:[{index:0,message,finish_reason:calls.length?'tool_calls':'stop'}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}};
}
function streamChunks(payload:any){
  const choice=payload.choices?.[0]; const m=choice?.message||{}; const out:any[]=[];
  if(m.content)out.push({id:payload.id,object:'chat.completion.chunk',created:payload.created,model:payload.model,choices:[{index:0,delta:{role:'assistant',content:m.content},finish_reason:null}]});
  if(Array.isArray(m.tool_calls)&&m.tool_calls.length)out.push({id:payload.id,object:'chat.completion.chunk',created:payload.created,model:payload.model,choices:[{index:0,delta:{role:'assistant',tool_calls:m.tool_calls},finish_reason:null}]});
  out.push({id:payload.id,object:'chat.completion.chunk',created:payload.created,model:payload.model,choices:[{index:0,delta:{},finish_reason:choice?.finish_reason||'stop'}]});
  return out;
}
export async function handleOpenAICompatibleGemini(req:any,body:any){
  assertAuthorized(req.headers);
  const key=String(process.env.GEMINI_API_KEY||'').trim();
  if(!key)throw Object.assign(new Error('Gemini is not configured: GEMINI_API_KEY is missing'),{status:503});
  const model=String(body?.model||'gemini-3.6-flash').trim();
  const converted=toGemini(Array.isArray(body?.messages)?body.messages:[]);
  const requestBody:any={...(converted.system.length?{systemInstruction:{parts:[{text:converted.system.join('\n\n')}]}}:{}),contents:converted.contents.length?converted.contents:[{role:'user',parts:[{text:'Hello'}]}],generationConfig:{maxOutputTokens:Math.min(8192,Math.max(1,Number(body?.max_tokens)||2048)),temperature:typeof body?.temperature==='number'?body.temperature:0.4}};
  const declarations=(Array.isArray(body?.tools)?body.tools:[]).map((tool:any)=>{const fn=tool?.function||tool;return {name:String(fn?.name||'tool'),description:String(fn?.description||''),parameters:fn?.parameters||{type:'object',properties:{}}};});
  if(declarations.length){requestBody.tools=[{functionDeclarations:declarations}];requestBody.toolConfig={functionCallingConfig:{mode:'AUTO'}};}
  const {response,data}=await callGemini(model,requestBody,key);
  if(!response.ok)throw Object.assign(new Error(String(data?.error?.message||`Gemini HTTP ${response.status}`)),{status:response.status});
  return toOpenAI(model,data);
}
export function writeOpenAICompatibleStream(res:any,payload:any){
  res.writeHead(200,{'Access-Control-Allow-Origin':'*','Cache-Control':'no-cache, no-transform','Content-Type':'text/event-stream; charset=utf-8','Connection':'keep-alive','X-Accel-Buffering':'no'});
  for(const chunk of streamChunks(payload))res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end('data: [DONE]\n\n');
}
