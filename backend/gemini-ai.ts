type ChatMessage = { role: 'user' | 'model'; parts: Array<{ text: string }> };

const MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'];
const MAX_OUTPUT_CHARS = 12000;
const REQUEST_TIMEOUT_MS = 25000;

function getApiKey() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('Gemini is not configured: GEMINI_API_KEY is missing');
  return key;
}

function textFromResponse(data: any): string {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  return candidates.flatMap((candidate: any) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim();
}

function cleanHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history.slice(-24).flatMap((item: any) => {
    const text = String(item?.text || item?.content || '').trim();
    if (!text) return [];
    return [{ role: item?.role === 'assistant' || item?.role === 'sire' || item?.role === 'model' ? 'model' : 'user', parts: [{ text }] } as ChatMessage];
  });
}

async function requestModel(model: string, body: unknown, apiKey: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
    return { response, data };
  } finally { clearTimeout(timer); }
}

function isTransient(status: number, cause?: any) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || cause?.name === 'AbortError';
}

function delay(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function runGemini(input: {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  runtimeContext?: Record<string, unknown>;
  symbol?: string;
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');

  // Runtime data is optional background capability. It must never become the
  // subject of an ordinary conversation unless the user makes it relevant.
  const context = JSON.stringify({ symbol: input.symbol || null, runtimeContext: input.runtimeContext || null });
  const systemInstruction = [
    'You are SIRE, a full-fledged general conversational AI inside the SIRE environment.',
    'Your primary job is to understand and converse with the user naturally, like a high-quality general AI assistant.',
    'Every user message is a conversation unless the user clearly asks for an action, analysis, research, coding help, market information, chart operation, or another concrete task.',
    'Do NOT assume the user is talking about trading, markets, charts, instruments, investing, or research merely because SIRE has access to those capabilities.',
    'For greetings, small talk, personal discussion, opinions, general questions, explanations, brainstorming, storytelling, planning, and casual conversation, answer directly and naturally. Do not introduce market or trading content unless the user brought it up.',
    'Do not append unsolicited lists of market actions or ask whether the user wants to analyze the current chart after an ordinary conversational message.',
    'Treat supplied SIRE runtime context as optional background information, not as the subject of the conversation. Ignore it completely when it is not relevant to the user request.',
    'Only mention a symbol, price, timeframe, indicator, chart, live feed, or other runtime detail when it directly helps answer the current request or the user explicitly asks about it.',
    'Never claim that data is live, that a tool was used, or that an action was performed unless the runtime or an actual tool result supplied that information.',
    'Use conversation history to maintain continuity and understand references to earlier messages.',
    'Reason carefully, be honest about uncertainty, and do not invent facts or capabilities.',
    'When a concrete SIRE operation is genuinely requested, answer the user and use the supplied context appropriately; do not replace the conversation with a generic task-status message.',
    `Optional SIRE runtime context (use only if relevant): ${context}`,
  ].join('\n\n');

  const requestBody = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [...cleanHistory(input.history), { role: 'user', parts: [{ text: query }] }],
    generationConfig: { temperature: 0.75, maxOutputTokens: 4096 },
  };

  let lastError: any = null;
  const apiKey = getApiKey();
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { response, data } = await requestModel(model, requestBody, apiKey);
        if (!response.ok) {
          const status = response.status;
          lastError = Object.assign(new Error(data?.error?.message || `Gemini HTTP ${status}`), { status });
          if (isTransient(status) && attempt === 0) { await delay(350); continue; }
          if (isTransient(status)) break;
          throw lastError;
        }
        const text = textFromResponse(data);
        if (!text) {
          lastError = new Error(`Gemini ${model} returned no text`);
          if (attempt === 0) { await delay(250); continue; }
          break;
        }
        return {
          text: text.slice(0, MAX_OUTPUT_CHARS),
          responseId: typeof data?.responseId === 'string' ? data.responseId : '',
          model, provider: 'Google Gemini', mode: 'single-provider-foundation',
        };
      } catch (cause) {
        lastError = cause;
        const status = Number((cause as any)?.status || 0);
        if (isTransient(status, cause) && attempt === 0) { await delay(350); continue; }
        if (isTransient(status, cause)) break;
        throw cause;
      }
    }
  }
  throw lastError || new Error('Gemini is temporarily unavailable');
}

export async function handleGeminiRequest(body: unknown) {
  const payload = (body || {}) as Record<string, unknown>;
  const query = String(payload.query || '').trim();
  if (!query) return { status: 400, body: { error: 'query is required' } };
  try {
    return { status: 200, body: await runGemini({
      query,
      symbol: payload.symbol ? String(payload.symbol) : undefined,
      history: Array.isArray(payload.history) ? payload.history as Array<{ role: string; text?: string; content?: string }> : [],
      runtimeContext: payload.runtimeContext && typeof payload.runtimeContext === 'object' ? payload.runtimeContext as Record<string, unknown> : undefined,
    }) };
  } catch (cause) {
    const status = Number.isInteger((cause as any)?.status) ? Number((cause as any).status) : 502;
    return { status, body: {
      error: cause instanceof Error ? cause.message : String(cause),
      provider: 'Google Gemini', retryable: isTransient(status, cause),
    } };
  }
}
