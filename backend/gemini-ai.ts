type ChatMessage = { role: 'user' | 'model'; parts: Array<{ text: string }> };
type CouncilEvent = (event: { actor: string; phase: string; text: string }) => void | Promise<void>;

const MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const MAX_OUTPUT_CHARS = 12000;
const REQUEST_TIMEOUT_MS = 30000;

function getApiKey() { const key = process.env.GEMINI_API_KEY?.trim(); if (!key) throw new Error('Gemini is not configured: GEMINI_API_KEY is missing'); return key; }
function textFromResponse(data: any): string { const candidates = Array.isArray(data?.candidates) ? data.candidates : []; return candidates.flatMap((candidate: any) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []).map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim(); }
function cleanHistory(history: unknown): ChatMessage[] { if (!Array.isArray(history)) return []; return history.slice(-20).flatMap((item: any) => { const text = String(item?.text || item?.content || '').trim(); if (!text) return []; return [{ role: item?.role === 'assistant' || item?.role === 'model' || item?.role === 'sire' ? 'model' : 'user', parts: [{ text }] } as ChatMessage]; }); }
function needsEnvironmentContext(query: string): boolean { return /\b(chart|market|markets|price|prices|instrument|instruments|trade|trading|forex|crypto|bitcoin|btc|ethereum|eth|stock|stocks|commodity|commodities|index|indices|signal|backtest|backtesting|ticks?|ohlc|portfolio|position|positions|indicator|indicators|research|analyse|analyze|analysis|deriv|strategy|strategies)\b/i.test(query); }
async function requestModel(model: string, body: unknown, apiKey: string) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS); try { const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) }); const raw = await response.text(); let data: any = {}; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; } return { response, data }; } finally { clearTimeout(timer); } }

export async function runGemini(input: { query: string; history?: Array<{ role: string; text?: string; content?: string }>; runtimeContext?: Record<string, unknown>; symbol?: string; councilContext?: string; debateRole?: 'proposal' | 'response'; onEvent?: CouncilEvent }) {
  const query = input.query.trim(); if (!query) throw new Error('query is required');
  const environmentContext = needsEnvironmentContext(query) ? JSON.stringify({ symbol: input.symbol || null, runtimeContext: input.runtimeContext || null }) : 'Not relevant to this message. Do not introduce market or chart context.';
  const hasCouncilContext = Boolean(input.councilContext?.trim());
  const collaborationInstruction = hasCouncilContext
    ? `You are continuing a real team discussion. Read the teammate's contribution carefully. You can agree, ask a question, improve it, add a new idea, verify a point, divide responsibilities, propose a plan, or change your mind. Do not manufacture disagreement. Your contribution should move the work forward.\n\nTEAM CONTEXT:\n${input.councilContext!.trim()}`
    : 'You are the first team member to respond. Develop a useful initial position and identify what should be checked or explored next.';
  const systemInstruction = [
    'You are SIRE, a full-fledged general conversational AI and a member of a capable AI team.',
    'Handle ordinary conversation naturally: greetings, small talk, questions, explanations, brainstorming, writing, planning, coding and technical topics.',
    'Do not assume the user wants trading, markets, charts, research, or a task unless their message calls for it.',
    'Maintain conversation continuity and answer the actual intent.',
    'Treat the other council member as a teammate with independent judgment. Collaboration can include agreement, disagreement, questions, complementary work, delegation, planning, verification, or changing direction.',
    'Do not expose private hidden chain-of-thought. Visible council updates should be concise summaries of useful activity, not internal reasoning.',
    'Do not force artificial sections such as Arguments, Evidence, Assumptions, Objections, or Conclusion. Use structure only when it naturally helps.',
    `Relevant SIRE environment context: ${environmentContext}`,
    collaborationInstruction,
  ].join('\n\n');
  const requestBody = { system_instruction: { parts: [{ text: systemInstruction }] }, contents: [...cleanHistory(input.history), { role: 'user', parts: [{ text: query }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } };
  const apiKey = getApiKey(); let lastError: any = null;
  for (const model of MODELS) {
    try {
      const { response, data } = await requestModel(model, requestBody, apiKey);
      if (!response.ok) { const status = response.status; lastError = Object.assign(new Error(data?.error?.message || `Gemini HTTP ${status}`), { status, model }); if (status === 429 || status === 503 || status === 500 || status === 502) continue; throw lastError; }
      const text = textFromResponse(data); if (!text) { lastError = Object.assign(new Error(`Gemini ${model} returned no text`), { status: 502, model }); continue; }
      return { text: text.slice(0, MAX_OUTPUT_CHARS), responseId: typeof data?.responseId === 'string' ? data.responseId : '', model, provider: 'Google Gemini', mode: hasCouncilContext ? 'council-response' : 'council-proposal', role: input.debateRole || (hasCouncilContext ? 'response' : 'proposal') };
    } catch (cause) { lastError = cause; const status = Number((cause as any)?.status || 0); const retryable = status === 429 || status === 500 || status === 502 || status === 503 || (cause as any)?.name === 'AbortError'; if (retryable) continue; throw cause; }
  }
  const error = new Error('Gemini is temporarily busy. Please try again in a moment.'); (error as any).status = 503; (error as any).cause = lastError; throw error;
}

export async function handleGeminiRequest(body: unknown) {
  const payload = (body || {}) as Record<string, unknown>; const query = String(payload.query || '').trim(); if (!query) return { status: 400, body: { error: 'query is required' } };
  try { return { status: 200, body: await runGemini({ query, symbol: payload.symbol ? String(payload.symbol) : undefined, history: Array.isArray(payload.history) ? payload.history as Array<{ role: string; text?: string; content?: string }> : [], runtimeContext: payload.runtimeContext && typeof payload.runtimeContext === 'object' ? payload.runtimeContext as Record<string, unknown> : undefined }) }; } catch (cause) { const status = Number.isInteger((cause as any)?.status) ? Number((cause as any).status) : 502; return { status, body: { error: cause instanceof Error ? cause.message : String(cause), provider: 'Google Gemini', retryable: status === 429 || status === 500 || status === 502 || status === 503 } }; }
}
