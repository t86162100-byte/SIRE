type ChatMessage = { role: 'user' | 'model'; parts: Array<{ text: string }> };

// Keep several currently listed free-tier Flash models available. If one is
// temporarily saturated, SIRE can continue through the next provider model.
const MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];
const MAX_OUTPUT_CHARS = 12000;
const REQUEST_TIMEOUT_MS = 30000;

function getApiKey() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('Gemini is not configured: GEMINI_API_KEY is missing');
  return key;
}

function textFromResponse(data: any): string {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  return candidates
    .flatMap((candidate: any) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function cleanHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history.slice(-20).flatMap((item: any) => {
    const text = String(item?.text || item?.content || '').trim();
    if (!text) return [];
    return [{
      role: item?.role === 'assistant' || item?.role === 'model' || item?.role === 'sire' ? 'model' : 'user',
      parts: [{ text }],
    } as ChatMessage];
  });
}

function needsEnvironmentContext(query: string): boolean {
  return /\b(chart|market|markets|price|prices|instrument|instruments|trade|trading|forex|crypto|bitcoin|btc|ethereum|eth|stock|stocks|commodity|commodities|index|indices|signal|backtest|backtesting|ticks?|ohlc|portfolio|position|positions|indicator|indicators|research|analyse|analyze|analysis|deriv|strategy|strategies)\b/i.test(query);
}

async function requestModel(model: string, body: unknown, apiKey: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function runGemini(input: {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  runtimeContext?: Record<string, unknown>;
  symbol?: string;
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');

  // Casual conversation should not receive the current chart, price, symbol,
  // indicators, or other runtime state. That context is supplied only when
  // the user's message actually calls for it.
  const environmentContext = needsEnvironmentContext(query)
    ? JSON.stringify({ symbol: input.symbol || null, runtimeContext: input.runtimeContext || null })
    : 'Not relevant to this message. Do not introduce market or chart context.';

  const systemInstruction = [
    'You are SIRE, a full-fledged general conversational AI.',
    'Your primary job is to understand and respond naturally to the user, like a high-quality everyday AI assistant.',
    'Conversation is first-class. Greetings, small talk, questions, explanations, brainstorming, storytelling, planning, technical discussion and casual conversation are all valid.',
    'Never assume the user wants trading, markets, charts, research, analysis, or a task merely because SIRE has those capabilities.',
    'Only use or mention market, chart, trading, research, or SIRE-environment information when it is relevant to what the user actually asked.',
    'Never force an intent, action, task, recommendation, or follow-up agenda onto a simple conversational message.',
    'Answer the actual question directly. If the user asks your name, say your name is SIRE. If they ask how you are, answer naturally. Do not redirect ordinary conversation into markets.',
    'Maintain continuity using the conversation history. Understand references to earlier messages instead of treating every message as an isolated task.',
    'Reason carefully, distinguish facts from assumptions, and never invent data, tool results, live prices, capabilities, or actions.',
    'When environment context is supplied, use it only when it helps answer the user. Do not claim to have used a tool unless its result is actually supplied.',
    `Relevant SIRE environment context: ${environmentContext}`,
  ].join('\n\n');

  const requestBody = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [...cleanHistory(input.history), { role: 'user', parts: [{ text: query }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
  };

  const apiKey = getApiKey();
  let lastError: any = null;

  for (const model of MODELS) {
    try {
      const { response, data } = await requestModel(model, requestBody, apiKey);
      if (!response.ok) {
        const status = response.status;
        lastError = Object.assign(new Error(data?.error?.message || `Gemini HTTP ${status}`), { status, model });
        // Free-tier models can be temporarily saturated. Continue immediately
        // to the next compatible model instead of exposing a provider error.
        if (status === 429 || status === 503 || status === 500 || status === 502) continue;
        throw lastError;
      }

      const text = textFromResponse(data);
      if (!text) {
        lastError = Object.assign(new Error(`Gemini ${model} returned no text`), { status: 502, model });
        continue;
      }

      return {
        text: text.slice(0, MAX_OUTPUT_CHARS),
        responseId: typeof data?.responseId === 'string' ? data.responseId : '',
        model,
        provider: 'Google Gemini',
        mode: 'single-provider-foundation',
      };
    } catch (cause) {
      lastError = cause;
      const status = Number((cause as any)?.status || 0);
      const retryable = status === 429 || status === 500 || status === 502 || status === 503 || (cause as any)?.name === 'AbortError';
      if (retryable) continue;
      throw cause;
    }
  }

  // Do not expose a misleading model-specific demand message when every free
  // model is temporarily saturated. The frontend can safely offer Retry.
  const error = new Error('Gemini is temporarily busy. Please try again in a moment.');
  (error as any).status = 503;
  (error as any).cause = lastError;
  throw error;
}

export async function handleGeminiRequest(body: unknown) {
  const payload = (body || {}) as Record<string, unknown>;
  const query = String(payload.query || '').trim();
  if (!query) return { status: 400, body: { error: 'query is required' } };

  try {
    return {
      status: 200,
      body: await runGemini({
        query,
        symbol: payload.symbol ? String(payload.symbol) : undefined,
        history: Array.isArray(payload.history)
          ? payload.history as Array<{ role: string; text?: string; content?: string }>
          : [],
        runtimeContext: payload.runtimeContext && typeof payload.runtimeContext === 'object'
          ? payload.runtimeContext as Record<string, unknown>
          : undefined,
      }),
    };
  } catch (cause) {
    const status = Number.isInteger((cause as any)?.status) ? Number((cause as any).status) : 502;
    return {
      status,
      body: {
        error: cause instanceof Error ? cause.message : String(cause),
        provider: 'Google Gemini',
        retryable: status === 429 || status === 500 || status === 502 || status === 503,
      },
    };
  }
}
