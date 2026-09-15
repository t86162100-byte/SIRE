type ChatMessage = { role: 'user' | 'model'; parts: Array<{ text: string }> };

const MODEL = 'gemini-3.6-flash';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_OUTPUT_CHARS = 12000;

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
      role: item?.role === 'assistant' || item?.role === 'model' ? 'model' : 'user',
      parts: [{ text }],
    } as ChatMessage];
  });
}

export async function runGemini(input: {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  runtimeContext?: Record<string, unknown>;
  symbol?: string;
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');

  const context = JSON.stringify({
    symbol: input.symbol || null,
    runtimeContext: input.runtimeContext || null,
  });

  const systemInstruction = [
    'You are SIRE, the intelligent conversational AI inside the SIRE environment.',
    'Conversation is first-class. Understand normal greetings, questions, discussion, planning, research and technical requests naturally.',
    'Do not pretend every user message is a task. Respond conversationally when the user is simply talking.',
    'Reason carefully. Distinguish facts from assumptions and never invent market data or system capabilities.',
    'When SIRE runtime context is supplied, use it when relevant. Do not claim to have used a tool unless the runtime actually supplied its result.',
    'You are the first AI provider in a future multi-provider council. Give a complete, useful answer that another AI can critique later.',
    `SIRE runtime context: ${context}`,
  ].join('\n\n');

  const contents: ChatMessage[] = [
    ...cleanHistory(input.history),
    { role: 'user', parts: [{ text: query }] },
  ];

  const response = await fetch(`${API_URL}?key=${encodeURIComponent(getApiKey())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    }),
  });

  const raw = await response.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }

  if (!response.ok) {
    const message = data?.error?.message || `Gemini HTTP ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const text = textFromResponse(data);
  if (!text) throw new Error('Gemini returned no text');

  return {
    text: text.slice(0, MAX_OUTPUT_CHARS),
    responseId: typeof data?.responseId === 'string' ? data.responseId : '',
    model: MODEL,
    provider: 'Google Gemini',
    mode: 'single-provider-foundation',
  };
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
        history: Array.isArray(payload.history) ? payload.history as Array<{ role: string; text?: string; content?: string }> : [],
        runtimeContext: payload.runtimeContext && typeof payload.runtimeContext === 'object'
          ? payload.runtimeContext as Record<string, unknown> : undefined,
      }),
    };
  } catch (cause) {
    const value = cause as { status?: number };
    return {
      status: Number.isInteger(value?.status) ? Number(value.status) : 502,
      body: { error: cause instanceof Error ? cause.message : String(cause), provider: 'Google Gemini', model: MODEL },
    };
  }
}
