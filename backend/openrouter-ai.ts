type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: any; tool_call_id?: string; tool_calls?: any[] };

type CouncilEvent = (event: { actor: string; phase: string; text: string }) => void | Promise<void>;

const MODEL = 'openai/gpt-oss-20b';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 45000;
const MAX_OUTPUT_CHARS = 12000;
const MAX_TOOL_TURNS = 4;

function getApiKey() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error('GPT head is not configured: OPENROUTER_API_KEY is missing');
  return key;
}

function cleanHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history.slice(-20).flatMap((item: any) => {
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

function systemPrompt() {
  return [
    'You are SIRE, powered by OpenAI gpt-oss-20b through OpenRouter.',
    'You are a general-purpose conversational AI. You have no access to the SIRE chart runtime and must not inspect, receive, control, modify, or infer live chart or market state.',
    'Do not emit executable chart actions. If the user asks you to operate the chart, explain that chart control is not available to this GPT.',
    'Do not claim to know the current instrument, price, candles, indicators, drawings, replay state, visible range, or chart settings unless the user explicitly provides that information in the current message.',
    'Do not expose hidden chain-of-thought. Visible activity must be concise work summaries.',
    'The current user message is the task. Earlier chat is context only.',
  ].join('\\n');
}

export async function runGptHead(input: {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  onEvent?: CouncilEvent;
  tools?: {
    webSearch?: (query: string) => Promise<string>;
    runtimeContext?: Record<string, unknown>;
    checkIntegrations?: () => Promise<string>;
    githubRequest?: (input: { method: string; path: string; body?: unknown; permission: string }) => Promise<string>;
  };
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');
  const emit = async (actor: string, phase: string, text: string) => { if (input.onEvent) await input.onEvent({ actor, phase, text }); };

  const toolDefs: any[] = [];
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
      description: 'Use SIRE\'s connected GitHub repository access. Read repository files, branches, commits, issues, pull requests, or perform requested repository changes such as creating/updating/deleting files, branches, commits, or pull requests. Use only when the user asks for GitHub/repository work or the task genuinely requires repository access. For changes, inspect the relevant current state first and then perform the requested write.',
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
    { role: 'system', content: systemPrompt(input.tools?.runtimeContext) },
    ...cleanHistory(input.history),
    { role: 'user', content: query },
  ];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    await emit('GPT','thinking', turn === 0 ? 'GPT is considering your request and deciding what, if anything, it needs to inspect.' : 'GPT is evaluating the latest tool result and deciding the next step.');
    const result = await callOpenRouter(messages, toolDefs);
    const message = result.message;
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (!toolCalls.length) {
      const text = textFromResponse({ choices: [{ message }] });
      if (!text) throw new Error('GPT head returned no text');
      let answer = text; let actions: any[] = []; let analysis: any = null;
      try {
        const raw = text.replace(/^\s*\`\`\`json\s*/i, '').replace(/\s*\`\`\`\s*$/i, '');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && ('answer' in parsed || 'actions' in parsed)) {
          answer = String(parsed.answer || '').trim() || 'Done.';
          actions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 40) : [];
          analysis = parsed.analysis ?? null;
        }
      } catch {}
      return { text: answer.slice(0, MAX_OUTPUT_CHARS), actions, analysis, responseId: result.responseId, model: MODEL, provider: 'OpenAI gpt-oss via OpenRouter' };
    }

    messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: toolCalls });

    for (const call of toolCalls) {
      const name = String(call?.function?.name || '');
      let args: any = {};
      try { args = JSON.parse(String(call?.function?.arguments || '{}')); } catch { args = {}; }
      const callId = String(call?.id || `${name}-${turn}`);

      if (name === 'github_request' && input.tools?.githubRequest) {
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

  throw new Error('GPT head reached the maximum tool turns without producing a final answer');
}

export async function runOpenRouter(input: {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  system?: string;
  councilContext?: string;
  runtimeContext?: Record<string, unknown>;
  onEvent?: CouncilEvent;
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');
  const messages: ChatMessage[] = [
    { role: 'system', content: input.system || systemPrompt(input.runtimeContext) },
    ...cleanHistory(input.history),
    ...(input.councilContext ? [{ role: 'user', content: `TEAM CONTEXT:\n${input.councilContext}` } as ChatMessage] : []),
    { role: 'user', content: query },
  ];
  const result = await callOpenRouter(messages);
  const text = textFromResponse({ choices: [{ message: result.message }] });
  if (!text) throw new Error('GPT returned no text');
  let answer = text; let actions: any[] = []; let analysis: any = null;
  try {
    const raw = text.replace(/^\s*\`\`\`json\s*/i, '').replace(/\s*\`\`\`\s*$/i, '');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && ('answer' in parsed || 'actions' in parsed)) {
      answer = String(parsed.answer || '').trim() || 'Done.';
      actions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 40) : [];
      analysis = parsed.analysis ?? null;
    }
  } catch {}
  return { text: answer.slice(0, MAX_OUTPUT_CHARS), actions, analysis, responseId: result.responseId, model: MODEL, provider: 'OpenAI gpt-oss via OpenRouter' };
}
