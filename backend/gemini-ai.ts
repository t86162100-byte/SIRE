type ChatMessage = { role: 'user' | 'model'; parts: Array<{ text: string }> };

const MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'];
const MAX_OUTPUT_CHARS = 12000;

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
  return history.slice(-20).flatMap((item: any) => {
    const text = String(item?.text || item?.content || '').trim();
    if (!text) return [];
    return [{ role: item?.role === 'assistant' || item?.role === 'model' ? 'model' : 'user', parts: [{ text }] } as ChatMessage];
  });
}

async function requestModel(model: string, body: unknown, apiKey: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
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

export async function runGemini(input: {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  runtimeContext?: Record<string, unknown>;
  symbol?: string;
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');

  const context = JSON.stringify({ symbol: input.symbol || null, runtimeContext: input.runtimeContext || null });
  const systemInstruction = [
    'You are SIRE, the intelligent conversational AI inside the SIRE environment.',
    'Conversation is first-class. Understand normal greetings, questions, discussion, planning, research and technical requests naturally.',
    'Do not pretend every user message is a task. Respond conversationally when the user is simply talking.',
    'Reason carefully. Distinguish facts from assumptions and never invent market data or system capabilities.',
    'When SIRE runtime context is supplied, use it when relevant. Do not claim to have used a tool unless the runtime actually supplied its result.',
    'You are the first AI provider in a future multi-provider council. Give a complete, useful answer that another AI can critique later.',
    `SIRE runtime context: ${context}`,
  ].join('\n\n');
  const requestBody = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [...cleanHistory(input.history), { role: 'user', parts: [{ text: query }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  };

  let lastError: any = null;
  for (const model of MODELS) {
    try {
      const { response, data } = await requestModel(model, requestBody, getApiKey());
      if (!response.ok) {
        const status = response.status;
        lastError = Object.assign(new Error(data?.error?.message || `Gemini HTTP ${status}`), { status });
        if (status === 429 || status === 503 || status === 500) continue;
        throw lastError;
      }
      const text = textFromResponse(data);
      if (!text) { lastError = new Error(`Gemini ${model} returned no text`); continue; }
      return {
        text: text.slice(0, MAX_OUTPUT_CHARS),
        responseId: typeof data?.responseId === 'string' ? data.responseId : '',
        model, provider: 'Google Gemini', mode: 'single-provider-foundation',
      };
    } catch (cause) {
      lastError = cause;
      const status = Number((cause as any)?.status || 0);
      if (status === 429 || status === 503 || status === 500 || (cause as any)?.name === 'AbortError') continue;
      throw cause;
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
      provider: 'Google Gemini', retryable: status === 429 || status === 500 || status === 502 || status === 503,
    } };
  }
}
