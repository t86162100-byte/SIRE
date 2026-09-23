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
    'You are SIRE, the user-facing AI assistant and the primary reasoning model.',
    'You are powered by OpenAI gpt-oss-20b through OpenRouter, but normally present yourself simply as SIRE.',
    'You are a full general-purpose AI. Handle greetings, small talk, explanations, writing, planning, coding, research, technical work, and chart work naturally.',
    'Do not use keyword routing or canned fast paths. Decide from the actual request whether you can answer directly or should use a tool.',
    'You are above the available tools and decide when they are useful. You are not required to use a tool.',
    'Available helpers: OpenAlgo Agent for chart/OpenAlgo/market and related technical context; web_search for current external information; GitHub for repository inspection and repository changes when the user asks for them or they are materially needed.',
    'Use a helper only when it materially improves the answer. After a helper returns, evaluate its result yourself and continue reasoning.',
    'GitHub access is real and may be read/write. When a repository task requires it, inspect the repository first, then make the requested changes through the GitHub tool and report the actual result. Never claim you searched, inspected, changed, deployed, or verified something unless the runtime actually performed that action.',
    'Visible activity should contain only concise work summaries, never private chain-of-thought.',
    'The current user message is the task you must answer. Treat earlier conversation as context only; do not continue, repeat, or act on an earlier request unless the current message asks you to. In particular, do not call GitHub, Render, OpenAlgo, or web tools merely because they appeared in earlier turns. If the current message is simple and self-contained, answer it directly without tools.',
    'If a difficult task needs deeper investigation, delegate a focused task, inspect the result, and integrate it into your own answer. After a tool result, do not call the same tool again unless the new call is required to resolve a specific remaining question; otherwise answer from the evidence already returned.'
  ].join('\n');
}

export async function runGptHead(input: {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  onEvent?: CouncilEvent;
  tools?: {
    askOpenAlgo?: (task: string) => Promise<string>;
    webSearch?: (query: string) => Promise<string>;
    checkIntegrations?: () => Promise<string>;
    githubRequest?: (input: { method: string; path: string; body?: unknown; permission: string }) => Promise<string>;
  };
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');
  const emit = async (actor: string, phase: string, text: string) => { if (input.onEvent) await input.onEvent({ actor, phase, text }); };

  const toolDefs: any[] = [];
  if (input.tools?.askOpenAlgo) toolDefs.push({
    type: 'function',
    function: {
      name: 'ask_openalgo',
      description: 'Ask the OpenAlgo Agent to inspect or act on chart, market, OpenAlgo, or related technical context. Use only when that specialist context is genuinely needed.',
      parameters: { type: 'object', properties: { task: { type: 'string', description: 'The focused task for the OpenAlgo Agent.' } }, required: ['task'], additionalProperties: false },
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
    { role: 'system', content: systemPrompt() },
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
      return { text: text.slice(0, MAX_OUTPUT_CHARS), responseId: result.responseId, model: MODEL, provider: 'OpenAI gpt-oss via OpenRouter' };
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
      } else if (name === 'ask_openalgo' && input.tools?.askOpenAlgo) {

        const task = String(args.task || query).slice(0, 8000);
        await emit('OpenAlgo Agent','working','GPT asked OpenAlgo Agent to inspect a focused technical/chart question.');
        const output = await input.tools.askOpenAlgo(task);
        messages.push({ role: 'tool', tool_call_id: callId, content: output.slice(0, 14000) });
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
  onEvent?: CouncilEvent;
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');
  const messages: ChatMessage[] = [
    { role: 'system', content: input.system || systemPrompt() },
    ...cleanHistory(input.history),
    ...(input.councilContext ? [{ role: 'user', content: `TEAM CONTEXT:\n${input.councilContext}` } as ChatMessage] : []),
    { role: 'user', content: query },
  ];
  const result = await callOpenRouter(messages);
  const text = textFromResponse({ choices: [{ message: result.message }] });
  if (!text) throw new Error('GPT returned no text');
  return { text: text.slice(0, MAX_OUTPUT_CHARS), responseId: result.responseId, model: MODEL, provider: 'OpenAI gpt-oss via OpenRouter' };
}
