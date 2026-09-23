type ChatMessage = { role: 'user' | 'model'; parts: Array<{ text: string }> };
type CouncilEvent = (event: { actor: string; phase: string; text: string }) => void | Promise<void>;

const MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const MAX_OUTPUT_CHARS = 12000;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_TOOL_TURNS = 8;

function getApiKey() { const key = process.env.GEMINI_API_KEY?.trim(); if (!key) throw new Error('Gemini is not configured: GEMINI_API_KEY is missing'); return key; }
function textFromResponse(data: any): string { const candidates = Array.isArray(data?.candidates) ? data.candidates : []; return candidates.flatMap((candidate: any) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []).map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim(); }
function cleanHistory(history: unknown): ChatMessage[] { if (!Array.isArray(history)) return []; return history.slice(-20).flatMap((item: any) => { const text = String(item?.text || item?.content || '').trim(); if (!text) return []; return [{ role: item?.role === 'assistant' || item?.role === 'model' || item?.role === 'sire' ? 'model' : 'user', parts: [{ text }] } as ChatMessage]; }); }
function needsEnvironmentContext(query: string): boolean { return /\b(chart|market|markets|price|prices|instrument|instruments|trade|trading|forex|crypto|bitcoin|btc|ethereum|eth|stock|stocks|commodity|commodities|index|indices|signal|backtest|backtesting|ticks?|ohlc|portfolio|position|positions|indicator|indicators|research|analyse|analyze|analysis|deriv|strategy|strategies)\b/i.test(query); }
async function requestModel(model: string, body: unknown, apiKey: string) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS); try { const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) }); const raw = await response.text(); let data: any = {}; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; } return { response, data }; } finally { clearTimeout(timer); } }

export type GeminiHeadTools = {
  askGptOss?: (task: string) => Promise<string>;
  askOpenAlgo?: (task: string) => Promise<string>;
  webSearch?: (query: string) => Promise<string>;
  onToolStart?: (name: string, task: string) => void | Promise<void>;
};

const HEAD_TOOLS = [
  { function_declarations: [
    { name: 'ask_gpt_oss', description: 'Ask GPT-OSS 20B to independently inspect, reason about, challenge, or solve a difficult part of the user task. Use only when another model materially helps.', parameters: { type: 'object', properties: { task: { type: 'string', description: 'The concrete problem GPT-OSS should investigate.' } }, required: ['task'] } },
    { name: 'ask_openalgo', description: 'Ask the OpenAlgo Agent to inspect or act on SIRE chart, market, OpenAlgo, GitHub, Render, replay, indicators, or related technical capabilities. Use only when needed.', parameters: { type: 'object', properties: { task: { type: 'string', description: 'The concrete chart, code, deployment, or OpenAlgo work to investigate.' } }, required: ['task'] } },
    { name: 'web_search', description: 'Search the web when the answer genuinely requires current or external information.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Focused web search query.' } }, required: ['query'] } },
  ]},
];

export async function runGemini(input: { query: string; history?: Array<{ role: string; text?: string; content?: string }>; runtimeContext?: Record<string, unknown>; symbol?: string; councilContext?: string; debateRole?: string; onEvent?: CouncilEvent }) {
  const query = input.query.trim(); if (!query) throw new Error('query is required');
  const environmentContext = needsEnvironmentContext(query) ? JSON.stringify({ symbol: input.symbol || null, runtimeContext: input.runtimeContext || null }) : 'Not relevant to this message.';
  const hasCouncilContext = Boolean(input.councilContext?.trim());
  const systemInstruction = [
    'You are SIRE, a normal general-purpose conversational AI. You are the primary conversational intelligence and Gemini is the head of this system.',
    'Receive the user request directly. Think about the actual intent and answer naturally.',
    'You may answer yourself immediately when you have enough information. Do not force tools, delegation, progress, research, or team discussion just because they exist.',
    'When a difficult task would benefit from another model, you may ask GPT-OSS 20B for an independent technical or reasoning pass. When chart/OpenAlgo/code/deployment context is needed, you may ask OpenAlgo Agent. When current external information is needed, use web_search.',
    'You remain responsible for understanding the request, deciding whether help is needed, integrating returned findings, and producing the final user-facing answer.',
    'Delegation is optional and dynamic. Never use keyword rules or canned routing. Do not claim a tool or teammate was used unless the runtime actually executed it.',
    'You may use multiple independent tools in one turn when that is genuinely useful. After receiving results, continue thinking and call another tool only if necessary.',
    'Visible activity must be concise descriptions of work, never private hidden chain-of-thought.',
    `Relevant SIRE environment context: ${environmentContext}`,
    hasCouncilContext ? `TEAM CONTEXT FROM ANOTHER TURN:\n${input.councilContext!.trim()}` : '',
  ].filter(Boolean).join('\n\n');

  const contents: any[] = [...cleanHistory(input.history), { role: 'user', parts: [{ text: query }] }];
  const apiKey = getApiKey(); let lastError: any = null;
  for (const model of MODELS) {
    try {
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const requestBody = { system_instruction: { parts: [{ text: systemInstruction }] }, contents, tools: HEAD_TOOLS, toolConfig: { functionCallingConfig: { mode: 'AUTO' } }, generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } };
        const { response, data } = await requestModel(model, requestBody, apiKey);
        if (!response.ok) { const status = response.status; lastError = Object.assign(new Error(data?.error?.message || `Gemini HTTP ${status}`), { status, model }); if (status === 429 || status === 503 || status === 500 || status === 502) break; throw lastError; }
        const candidate = data?.candidates?.[0]; const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
        const calls = parts.filter((p: any) => p?.functionCall?.name);
        if (!calls.length) {
          const text = textFromResponse(data);
          if (!text) { lastError = Object.assign(new Error(`Gemini ${model} returned no text`), { status: 502, model }); break; }
          return { text: text.slice(0, MAX_OUTPUT_CHARS), responseId: typeof data?.responseId === 'string' ? data.responseId : '', model, provider: 'Google Gemini', mode: 'gemini-head', role: 'head' };
        }
        contents.push({ role: 'model', parts });
        const results = await Promise.all(calls.map(async (part: any) => {
          const name = String(part.functionCall.name); const args = part.functionCall.args || {}; const task = String(args.task || args.query || '').trim();
          await input.onEvent?.({ actor: 'Gemini', phase: 'delegating', text: name === 'ask_gpt_oss' ? 'Gemini asked GPT-OSS 20B to take a closer look at this.' : name === 'ask_openalgo' ? 'Gemini asked OpenAlgo Agent to inspect the relevant technical context.' : 'Gemini is checking current external information.' });
          let result = '';
          try {
            if (name === 'ask_gpt_oss') result = input.tools?.askGptOss ? await input.tools.askGptOss(task) : 'GPT-OSS is not currently available.';
            else if (name === 'ask_openalgo') result = input.tools?.askOpenAlgo ? await input.tools.askOpenAlgo(task) : 'OpenAlgo Agent is not currently available.';
            else if (name === 'web_search') result = input.tools?.webSearch ? await input.tools.webSearch(task) : 'Web search is not currently available.';
            else result = 'Unknown tool.';
          } catch (e) { result = `Tool ${name} failed: ${e instanceof Error ? e.message : String(e)}`; }
          await input.onEvent?.({ actor: name === 'ask_gpt_oss' ? 'GPT-OSS 20B' : name === 'ask_openalgo' ? 'OpenAlgo Agent' : 'Web', phase: 'result', text: result.slice(0, 1600) });
          return { functionResponse: { name, response: { result: result.slice(0, 12000) } } };
        }));
        contents.push({ role: 'user', parts: results });
      }
      lastError = Object.assign(new Error(`Gemini ${model} reached the tool-turn safety limit`), { status: 503, model });
    } catch (cause) {
      lastError = cause; const status = Number((cause as any)?.status || 0); const retryable = status === 429 || status === 500 || status === 502 || status === 503 || (cause as any)?.name === 'AbortError'; if (!retryable) throw cause;
    }
  }
  const error = new Error('Gemini is temporarily busy. Please try again in a moment.'); (error as any).status = 503; (error as any).cause = lastError; throw error;
}

export async function handleGeminiRequest(body: unknown) {
  const payload = (body || {}) as Record<string, unknown>; const query = String(payload.query || '').trim(); if (!query) return { status: 400, body: { error: 'query is required' } };
  try { return { status: 200, body: await runGemini({ query, symbol: payload.symbol ? String(payload.symbol) : undefined, history: Array.isArray(payload.history) ? payload.history as Array<{ role: string; text?: string; content?: string }> : [], runtimeContext: payload.runtimeContext && typeof payload.runtimeContext === 'object' ? payload.runtimeContext as Record<string, unknown> : undefined }) }; } catch (cause) { const status = Number.isInteger((cause as any)?.status) ? Number((cause as any).status) : 502; return { status, body: { error: cause instanceof Error ? cause.message : String(cause), provider: 'Google Gemini', retryable: status === 429 || status === 500 || status === 502 || status === 503 } }; }
}
