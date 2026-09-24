type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: any; tool_call_id?: string; tool_calls?: any[] };

type CouncilEvent = (event: { actor: string; phase: string; text: string }) => void | Promise<void>;

const MODEL = 'openai/gpt-oss-20b';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 120000;
const MAX_OUTPUT_CHARS = 12000;
const MAX_TOOL_TURNS = 16;

function getApiKey() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error('GPT head is not configured: OPENROUTER_API_KEY is missing');
  return key;
}

function cleanHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  // History is context only. The current user message is the only task/instruction
  // for this turn, so keep a small recent window and explicitly fence it off below.
  return history.slice(-8).flatMap((item: any) => {
    const content = String(item?.text || item?.content || '').trim();
    if (!content) return [];
    return [{ role: item?.role === 'assistant' || item?.role === 'model' || item?.role === 'sire' ? 'assistant' : 'user', content }];
  });
}

function textFromResponse(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim();
  return '';
}

async function callOpenRouter(messages: ChatMessage[], tools?: any[]) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const body: any = { model: MODEL, messages, max_tokens: 2048 };
    if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }
    const response = await fetch(API_URL, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getApiKey()}`, 'HTTP-Referer': 'https://sire-amfv.onrender.com', 'X-Title': 'SIRE' },
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
    if (!response.ok) {
      const error = new Error(data?.error?.message || `OpenRouter HTTP ${response.status}`);
      (error as any).status = response.status;
      throw error;
    }
    return { message: data?.choices?.[0]?.message || {}, responseId: typeof data?.id === 'string' ? data.id : '' };
  } finally { clearTimeout(timer); }
}

export function analyzeChartRuntime(runtimeContext: Record<string, unknown> = {}, focus?: string) {
  const raw = Array.isArray(runtimeContext.recentBars) ? runtimeContext.recentBars : [];
  const bars = raw.map((b:any)=>({time:Number(b?.time),open:Number(b?.open),high:Number(b?.high),low:Number(b?.low),close:Number(b?.close)}))
    .filter((b:any)=>Number.isFinite(b.time)&&Number.isFinite(b.open)&&Number.isFinite(b.high)&&Number.isFinite(b.low)&&Number.isFinite(b.close));
  if(bars.length<30) return {ok:false,reason:'Not enough OHLC bars for conservative structural analysis.',bars:bars.length,confirmedStructures:[],drawings:[]};
  const closes=bars.map((b:any)=>b.close);
  const ema=(period:number)=>{const k=2/(period+1);let v=closes[0];for(let i=1;i<closes.length;i++)v=closes[i]*k+v*(1-k);return v;};
  const tr=bars.map((b:any,i:number)=>i===0?b.high-b.low:Math.max(b.high-b.low,Math.abs(b.high-bars[i-1].close),Math.abs(b.low-bars[i-1].close)));
  const atr14=tr.slice(-14).reduce((a:number,b:number)=>a+b,0)/Math.min(14,tr.length);
  const e20=ema(20),e50=ema(50),recent=bars.slice(-20),last=bars[bars.length-1];
  const recentHigh=Math.max(...recent.map((b:any)=>b.high)),recentLow=Math.min(...recent.map((b:any)=>b.low));
  const pivots:{index:number;kind:'high'|'low';price:number}[]=[];
  for(let i=2;i<bars.length-2;i++){const b=bars[i];if(b.high>bars[i-1].high&&b.high>bars[i-2].high&&b.high>=bars[i+1].high&&b.high>=bars[i+2].high)pivots.push({index:i,kind:'high',price:b.high});if(b.low<bars[i-1].low&&b.low<bars[i-2].low&&b.low<=bars[i+1].low&&b.low<=bars[i+2].low)pivots.push({index:i,kind:'low',price:b.low});}
  const highs=pivots.filter(p=>p.kind==='high'),lows=pivots.filter(p=>p.kind==='low'),lastHigh=highs.at(-1)||null,lastLow=lows.at(-1)||null;
  const bullishBos=Boolean(lastHigh&&last.close>lastHigh.price&&last.close>last.open),bearishBos=Boolean(lastLow&&last.close<lastLow.price&&last.close<last.open);
  const structure=bullishBos?'bullish BOS':bearishBos?'bearish BOS':'no confirmed BOS';
  const trend=bullishBos?'bullish':bearishBos?'bearish':(e20>e50?'bullish':e20<e50?'bearish':'mixed/ranging');
  const tolerance=Math.max(atr14*0.12,Math.abs(last.close)*0.0001),equalHighs=highs.filter(p=>Math.abs(p.price-recentHigh)<=tolerance).slice(-4),equalLows=lows.filter(p=>Math.abs(p.price-recentLow)<=tolerance).slice(-4);
  const confirmedStructures:any[]=[],drawings:any[]=[];
  if(bullishBos||bearishBos){const broken=bullishBos?lastHigh!:lastLow!;confirmedStructures.push({name:bullishBos?'Bullish Break of Structure':'Bearish Break of Structure',type:'BOS',confirmed:true,evidence:'Latest confirmed swing level was closed through by a directional candle.',level:{time:bars[broken.index].time,price:broken.price}});drawings.push({confirmed:true,tool:'horizontal-line',points:[{time:bars[Math.max(0,broken.index-4)].time,price:broken.price},{time:last.time,price:broken.price}],label:bullishBos?'SMC • Bullish BOS':'SMC • Bearish BOS',rationale:'Confirmed structural break at the last confirmed swing level.'});}
  if(equalHighs.length>=2){confirmedStructures.push({name:'Buy-side liquidity',type:'liquidity',confirmed:true,price:recentHigh,evidence:'At least two confirmed swing highs cluster inside a volatility-adjusted tolerance.'});drawings.push({confirmed:true,tool:'rectangle',points:[{time:bars[Math.max(0,equalHighs[0].index-2)].time,price:recentHigh-tolerance},{time:bars[Math.min(bars.length-1,equalHighs.at(-1)!.index+2)].time,price:recentHigh+tolerance}],label:'ICT • Buy-side Liquidity',rationale:'Confirmed equal-high cluster limited to the measured liquidity area.'});}
  if(equalLows.length>=2){confirmedStructures.push({name:'Sell-side liquidity',type:'liquidity',confirmed:true,price:recentLow,evidence:'At least two confirmed swing lows cluster inside a volatility-adjusted tolerance.'});drawings.push({confirmed:true,tool:'rectangle',points:[{time:bars[Math.max(0,equalLows[0].index-2)].time,price:recentLow-tolerance},{time:bars[Math.min(bars.length-1,equalLows.at(-1)!.index+2)].time,price:recentLow+tolerance}],label:'ICT • Sell-side Liquidity',rationale:'Confirmed equal-low cluster limited to the measured liquidity area.'});}
  const crtWindow=bars.slice(-9,-1);if(crtWindow.length>=8){const hi=Math.max(...crtWindow.map((b:any)=>b.high)),lo=Math.min(...crtWindow.map((b:any)=>b.low)),compact=hi-lo<=atr14*2.5,bull=compact&&last.close>hi&&last.close-last.open>atr14*.5,bear=compact&&last.close<lo&&last.open-last.close>atr14*.5;if(bull||bear){confirmedStructures.push({name:'CRT range expansion',type:'CRT',confirmed:true,direction:bull?'bullish':'bearish',range:{low:lo,high:hi},evidence:'Prior compact range followed by a directional expansion close outside it.'});drawings.push({confirmed:true,tool:'rectangle',points:[{time:crtWindow[0].time,price:lo},{time:crtWindow.at(-1)!.time,price:hi}],label:'CRT • Confirmed Range',rationale:'Measured prior consolidation that produced a confirmed expansion.'});}}
  const displacementIndex=bars.findIndex((b:any,i:number)=>i>=Math.max(3,bars.length-8)&&Math.abs(b.close-b.open)>=atr14*.9&&Math.max(b.high-b.close,b.close-b.low)<=Math.max(Math.abs(b.close-b.open)*.6,atr14*.35));
  if((bullishBos||bearishBos)&&displacementIndex>0){const d=bars[displacementIndex],opp=bullishBos?[...Array(displacementIndex).keys()].reverse().find(i=>bars[i].close<bars[i].open):[...Array(displacementIndex).keys()].reverse().find(i=>bars[i].close>bars[i].open);if(opp!==undefined){const ob=bars[opp];confirmedStructures.push({name:bullishBos?'Bullish order block':'Bearish order block',type:'order-block',confirmed:true,zone:{low:ob.low,high:ob.high},evidence:'Last opposite candle before confirmed displacement/BOS.'});drawings.push({confirmed:true,tool:'rectangle',points:[{time:ob.time,price:ob.low},{time:d.time,price:ob.high}],label:bullishBos?'SMC • Bullish Order Block':'SMC • Bearish Order Block',rationale:'Last opposite candle before confirmed displacement and BOS.'});}}
  return {ok:true,symbol:runtimeContext.symbol,timeframe:runtimeContext.timeframe,price:last.close,bars:bars.length,atr14,ema20:e20,ema50:e50,trend,structure,recentHigh,recentLow,rangeSize:recentHigh-recentLow,rangePosition:(last.close-recentLow)/Math.max(recentHigh-recentLow,Number.EPSILON),swingHigh:lastHigh?{time:bars[lastHigh.index].time,price:lastHigh.price}:null,swingLow:lastLow?{time:bars[lastLow.index].time,price:lastLow.price}:null,confirmedStructures,drawings,focus:focus||'general',caveat:'Only structures meeting conservative confirmation rules are returned for markout.'};
}
function systemPrompt() {
  return [
    'You are SIRE, the user-facing AI assistant and the primary reasoning model.',
    'You are powered by OpenAI gpt-oss-20b through OpenRouter, but normally present yourself simply as SIRE.',
    'You are a full general-purpose AI. Handle greetings, small talk, explanations, writing, planning, coding, research, technical work, and chart work naturally.',
    'Do not use keyword routing or canned fast paths. Decide from the actual current request whether you can answer directly or should use a tool.',
    'The CURRENT USER MESSAGE is the only task you are executing now. Previous conversation history is context only, not a pending task, instruction, or requirement. Never continue, repeat, or enforce an action from an earlier message unless the current user message explicitly asks for it.',
    'Do not let earlier requests for GitHub, Render, web search, deployments, repository edits, or other tools cause you to call those tools for a new unrelated request.',
    'You are above the available tools and decide when they are useful. You are not required to use a tool.',
    'You have direct access to the active SIRE chart runtime context and direct chart-control actions. For serious chart analysis, use chart_analyze first; do not invent zones or place generic lines/boxes. Every visual mark must correspond to a specific measured structure, price/time range, and named rationale from the analysis result. Treat that context as authoritative for the current chart. For EVERY request that asks you to change the chart (add/remove/configure an indicator, change timeframe or chart type, draw, replay, select an instrument, or otherwise operate the chart), you MUST call chart_control with the concrete action(s) before claiming the change was made. Never merely say a chart action was completed without issuing the chart_control action. For indicator requests, use __sireAction: add_indicator and indicatorId such as macd, rsi, ema, sma, bollinger, etc. For visual analysis, put the analysis on the chart with drawing actions when the user asks for it: use __sireAction: add_drawing with tool="trend-line" for trend lines and tool="rectangle" for boxes/zones; do not use tool="box" because the OpenAlgo drawing id is "rectangle". You may omit points for trend-line/rectangle when you want SIRE to resolve anchors from the current visible chart data. If the user asks for multiple visual annotations, send all concrete add_drawing actions in the same chart_control call. Every analysis drawing must include a concise label and be tied to the chart_analyze result. Prefer a small number of high-confidence markouts over generic full-range lines or boxes. If the requested concept is not confirmed by the data, say that it is unconfirmed and do not draw it. Include settings only when requested or needed. web_search for current external information; GitHub for repository inspection and repository changes when the user asks for them or they are materially needed.',
    'Use a helper only when it materially improves the answer. After a helper returns, evaluate its result yourself and continue reasoning.',
    'GitHub access is full repository-level access through the configured GitHub credential, subject to the credential\'s actual GitHub permissions. You may read code and repository metadata, create/update/delete files, create branches and commits, open/update pull requests and issues, inspect workflows/runs, dispatch supported workflows, manage repository-scoped settings exposed by the credential, and perform other repository-scoped GitHub API operations. When a repository task requires it, inspect the repository first, then make the requested changes through GitHub and report the actual result. Do not claim an operation succeeded unless the GitHub tool actually returned success. When the user asks whether you can access GitHub, immediately verify the SIRE repository and the render-migration branch with github_request; do not run chart analysis or unrelated tools first. For a repository repair request, inspect the branch and relevant source files before changing anything. Prefer a small number of targeted reads and writes rather than repeatedly fetching large files.',
    'Visible activity should contain only concise work summaries, never private chain-of-thought.',
    'If a simple message can be answered directly, answer it directly without unnecessary work.',
    'If a difficult task needs deeper investigation, delegate a focused task, inspect the result, and integrate it into your own answer. For repository/self-repair requests, work as an engineering agent: inspect the current branch and relevant files first, identify the root cause from evidence, make the smallest coherent fix, validate it, monitor deployment when Render access is configured, and if validation/deployment fails, inspect the failure and correct the code rather than stopping after the first attempt.',
  ].join('\n');
}

export async function runGptHead(input: {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  onEvent?: CouncilEvent;
  runtimeContext?: Record<string, unknown>;
  tools?: {
    chartControl?: (actions: any[]) => Promise<string>;
    chartAnalyze?: (focus?: string) => Promise<string>;
    webSearch?: (query: string) => Promise<string>;
    checkIntegrations?: () => Promise<string>;
    githubRequest?: (input: { method: string; path: string; body?: unknown; permission: string }) => Promise<string>;
    renderRequest?: (input: { method: string; path: string; body?: unknown; permission: string }) => Promise<string>;
  };
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');
  const emit = async (actor: string, phase: string, text: string) => { if (input.onEvent) await input.onEvent({ actor, phase, text }); };

  const toolDefs: any[] = [];
  if (input.tools?.chartControl) toolDefs.push({ type: 'function', function: { name: 'chart_control', description: 'Directly operate the active SIRE chart using the authoritative live runtime context. Use for instrument selection, timeframe, chart type, indicators, drawings, replay, chart linking, multi-chart layout and supported chart actions. Do not ask for the current instrument when the context supplies it.', parameters: { type:'object', properties: { actions:{ type:'array', items:{type:'object', additionalProperties:true} } }, required:['actions'], additionalProperties:false } } });  if (input.tools?.chartAnalyze) toolDefs.push({
    type: 'function',
    function: {
      name: 'chart_analyze',
      description: 'Run SIRE quantitative market-structure analysis on the authoritative live OHLC context before making chart-analysis claims. Returns trend, EMA/ATR context, confirmed swing structure, liquidity clusters, range boundaries, and concrete candidate drawing anchors with rationale. Use this for serious chart analysis requests.',
      parameters: { type:'object', properties: { focus:{ type:'string', description:'Optional focus such as SMC, ICT, CRT, structure, liquidity, order blocks, or general analysis.' } }, additionalProperties:false },
    },
  });

  if (input.tools?.renderRequest) toolDefs.push({
    type: 'function',
    function: {
      name: 'render_request',
      description: 'Inspect or operate the SIRE Render deployment through the configured Render API integration. Use this after code changes to monitor the exact deployment, confirm live/failed status, inspect service state, or trigger a deploy for the configured SIRE service. Never claim a deployment is live until Render returns live.',
      parameters: {
        type:'object',
        properties: {
          method:{ type:'string', enum:['GET','POST'] },
          path:{ type:'string', description:'Render API path. Prefer /v1/services/{serviceId}/deploys, /v1/services/{serviceId}/deploys/{deployId}, or /v1/services/{serviceId}.' },
          body:{ type:'object', additionalProperties:true },
          permission:{ type:'string', enum:['read','execute'] }
        },
        required:['method','path','permission'],
        additionalProperties:false
      }
    },
  });
  if (input.tools?.checkIntegrations) toolDefs.push({
    type: 'function',
    function: {
      name: 'check_integrations',
      description: 'Verify whether SIRE currently has working read access to its configured GitHub repository and Render workspace. Use this when the user asks about SIRE access, GitHub, Render, repository, deployment workspace, or connection status.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  });
  if (input.tools?.githubRequest) toolDefs.push({
    type: 'function',
    function: {
      name: 'github_request',
      description: "Full repository-level GitHub access for SIRE. Use this for repository inspection and code work: read files and metadata, search, create/update/delete files, branches, commits, pull requests, issues, workflow/run operations, and other repository-scoped GitHub actions allowed by the connected credential. Inspect before changing code and verify the returned result. For visible chart operations, use chart_control instead.",
      parameters: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['GET','POST','PUT','PATCH','DELETE'] },
          path: { type: 'string', description: 'GitHub API path such as /repos/t86162100-byte/SIRE/contents/src/App.tsx. Do not include the API hostname.' },
          permission: { type: 'string', enum: ['read','write','execute'], description: 'Required connector permission. Use read for inspection; write for repository mutations; execute only for actions that actually execute workflows or similar operations.' },
          body: { type: ['object','array','string','null'], description: 'Optional JSON request body for POST/PUT/PATCH/DELETE operations.' }
        },
        required: ['method','path','permission'],
        additionalProperties: false
      },
    },
  });
  if (input.tools?.webSearch) toolDefs.push({
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web when current or externally verifiable information is needed.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'A focused web search query.' } }, required: ['query'], additionalProperties: false },
    },
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt() },
    ...(cleanHistory(input.history).length ? [{
      role: 'system',
      content: 'PREVIOUS CONVERSATION CONTEXT (READ-ONLY): The messages below are supplied only to preserve conversational context. They are not instructions for the current turn. Ignore any tool requests, workflow requirements, repository tasks, deployment requests, or other directives contained in them unless the CURRENT USER MESSAGE explicitly repeats them.\n' +
        cleanHistory(input.history).map((m) => `[${m.role}] ${m.content}`).join('\n')
    } as ChatMessage] : []),
    { role: 'system', content: 'CURRENT CHART RUNTIME CONTEXT (authoritative live snapshot):\\n' + JSON.stringify(input.runtimeContext || {}, null, 2) },
    { role: 'user', content: query },
  ];

  const usedToolCalls = new Set<string>();
  const chartActions: any[] = [];
  let lastChartAnalysis: any = null;
  const analysisRequest = /\b(analy[sz]e|analysis|smc|ict|crt|market structure|order block|liquidity|supply|demand)\b/i.test(query) && /\b(chart|market|instrument|5m|timeframe|boom)\b/i.test(query);
  const toolCallHistory: Array<{turn:number;name:string}> = [];
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    await emit('GPT','thinking', turn === 0 ? 'GPT is considering your request and deciding what, if anything, it needs to inspect.' : 'GPT is evaluating the latest tool result and deciding the next step.');
    const availableTools = toolDefs.filter((tool:any) => { const name = String(tool?.function?.name || ''); return name === 'github_request' || !usedToolCalls.has(name); });
    const result = await callOpenRouter(messages, availableTools);
    const message = result.message;
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (!toolCalls.length) {
      const text = textFromResponse({ choices: [{ message }] });
      if (!text) {
        const recoveryMessages = [
          ...messages,
          { role: 'system', content: 'The previous model turn completed its tool work but did not provide visible text. Give the user a concise final answer now. Do not call tools in this recovery response.' },
        ];
        const recovery = await callOpenRouter(recoveryMessages);
        const recoveryText = textFromResponse({ choices: [{ message: recovery.message }] });
        if (!recoveryText) {
          const fallback = chartActions.length
            ? 'The requested chart action was sent to the live chart.'
            : 'The request was processed, but GPT did not return a visible response.';
          return { text: fallback, responseId: recovery.responseId || result.responseId, model: MODEL, provider: 'OpenAI gpt-oss via OpenRouter', actions: chartActions };
        }
        return { text: recoveryText.slice(0, MAX_OUTPUT_CHARS), responseId: recovery.responseId || result.responseId, model: MODEL, provider: 'OpenAI gpt-oss via OpenRouter', actions: chartActions };
      }
      if (analysisRequest && chartActions.length===0 && input.tools?.chartAnalyze && input.tools?.chartControl) {
        try {
          const a=lastChartAnalysis || JSON.parse(await input.tools.chartAnalyze(query));
          const ds=Array.isArray(a?.drawings)?a.drawings.filter((d:any)=>d?.confirmed===true&&Array.isArray(d?.points)&&d.points.length>=2):[];
          if(ds.length){
            const acts=ds.map((d:any)=>({__sireAction:'add_drawing',symbol:String(a.symbol||input.runtimeContext?.symbol||''),interval:String(a.timeframe||input.runtimeContext?.timeframe||''),tool:String(d.tool||'rectangle'),points:d.points,label:String(d.label||'Confirmed structure'),rationale:String(d.rationale||''),resolveFromVisibleRange:false,actionId:'analysis-'+Date.now()+'-'+Math.random().toString(36).slice(2,8)}));
            await input.tools.chartControl(acts); chartActions.push(...acts);
            await emit('Chart','working',`GPT is marking ${acts.length} confirmed structure(s) from the measured analysis.`);
          }
        } catch {}
      }
      return { text: text.slice(0, MAX_OUTPUT_CHARS), responseId: result.responseId, model: MODEL, provider: 'OpenAI gpt-oss via OpenRouter', actions: chartActions };
    }

    messages.push({
      role: 'assistant',
      content: message.content ?? '',
      tool_calls: toolCalls,
      ...(Array.isArray(message.reasoning_details) ? { reasoning_details: message.reasoning_details } : {}),
    });

    for (const call of toolCalls) {
      const name = String(call?.function?.name || '');
      let args: any = {};
      try { args = JSON.parse(String(call?.function?.arguments || '{}')); } catch { args = {}; }
      const callId = String(call?.id || `${name}-${turn}`);
      toolCallHistory.push({ turn, name });
      usedToolCalls.add(name);

      if (name === 'chart_control' && input.tools?.chartControl) {
        const requested = Array.isArray(args.actions) ? args.actions : [];
        const accepted = requested.filter((action:any) => action && typeof action === 'object' && (action.__sireAction || action.type));
        chartActions.push(...accepted);
        await emit('Chart','working',accepted.length ? `GPT is operating the chart directly (${accepted.length} action(s)).` : 'GPT received a chart-control request but no valid actions were supplied.');
        messages.push({ role: 'tool', tool_call_id: callId, content: JSON.stringify({ ok:true, actions: accepted }) });
      } else if (name === 'chart_analyze' && input.tools?.chartAnalyze) {
        await emit('Chart','analysis','GPT is running measured SMC/ICT/CRT structure analysis on the live OHLC context.');
        const output = await input.tools.chartAnalyze(String(args.focus || query).slice(0,500));
        try { lastChartAnalysis = JSON.parse(output); } catch { lastChartAnalysis = null; }
        messages.push({ role: 'tool', tool_call_id: callId, content: output.slice(0,18000) });
      } else if (name === 'render_request' && input.tools?.renderRequest) {
        const method=String(args.method||'GET').toUpperCase(), path=String(args.path||'').trim(), permission=String(args.permission||(method==='GET'?'read':'execute'));
        await emit('Render','working',method==='GET'?'GPT is inspecting the SIRE deployment through Render.':'GPT is operating the SIRE deployment through Render.');
        const output=await input.tools.renderRequest({method,path,body:args.body,permission});
        messages.push({ role:'tool', tool_call_id:callId, content:output.slice(0,16000) });
      } else if (name === 'github_request' && input.tools?.githubRequest) {
        const method = String(args.method || 'GET').toUpperCase();
        const path = String(args.path || '').trim();
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        const permission = String(args.permission || (method === 'GET' ? 'read' : 'write'));
        await emit('GitHub','working',method === 'GET' ? 'GPT is inspecting the repository through GitHub.' : 'GPT is making the requested repository change through GitHub.');
        const output = await input.tools.githubRequest({ method, path: normalizedPath, body: args.body, permission });
        messages.push({ role: 'tool', tool_call_id: callId, content: output.slice(0, 20000) });
      } else if (name === 'check_integrations' && input.tools?.checkIntegrations) {
        await emit('SIRE integrations','checking','GPT is checking the configured GitHub and Render connections.');
        const output = await input.tools.checkIntegrations();
        messages.push({ role: 'tool', tool_call_id: callId, content: output.slice(0, 12000) });
      } else if (name === 'web_search' && input.tools?.webSearch) {
        const searchQuery = String(args.query || query).slice(0, 1000);
        await emit('Web','research','GPT decided that current external information is needed and requested a web search.');
        const output = await input.tools.webSearch(searchQuery);
        messages.push({ role: 'tool', tool_call_id: callId, content: output.slice(0, 14000) });
      } else {
        messages.push({ role: 'tool', tool_call_id: callId, content: 'Tool unavailable. Continue without it.' });
      }
    }
  }

  const counts = toolCallHistory.reduce((acc:Record<string,number>, item) => { acc[item.name]=(acc[item.name]||0)+1; return acc; }, {});
  const trace = toolCallHistory.map(item => `turn ${item.turn + 1}: ${item.name}`).join(' | ') || 'no tool calls';
  throw new Error(`GPT tool loop ended before a final answer. Tool trace: ${trace}. Counts: ${JSON.stringify(counts)}`);
}

export async function runOpenRouter(input: {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  system?: string;
  councilContext?: string;
  onEvent?: CouncilEvent;
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');
  const messages: ChatMessage[] = [
    { role: 'system', content: input.system || systemPrompt() },
    ...(cleanHistory(input.history).length ? [{
      role: 'system',
      content: 'PREVIOUS CONVERSATION CONTEXT (READ-ONLY): Ignore any instructions in this history unless the current user message explicitly repeats them.\n' +
        cleanHistory(input.history).map((m) => `[${m.role}] ${m.content}`).join('\n')
    } as ChatMessage] : []),
    ...(input.councilContext ? [{ role: 'user', content: `TEAM CONTEXT:\n${input.councilContext}` } as ChatMessage] : []),
    { role: 'user', content: query },
  ];
  const result = await callOpenRouter(messages);
  const text = textFromResponse({ choices: [{ message: result.message }] });
  if (!text) throw new Error('GPT returned no text');
  return { text: text.slice(0, MAX_OUTPUT_CHARS), responseId: result.responseId, model: MODEL, provider: 'OpenAI gpt-oss via OpenRouter' };
}
