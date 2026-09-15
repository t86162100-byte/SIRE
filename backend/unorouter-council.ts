type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

type ModelInfo = {
  id?: string;
  pricing?: { prompt?: string | number; completion?: string | number; input?: string | number; output?: string | number };
  input_modalities?: string[];
};

const BASE_URL = 'https://api.unorouter.com/v1';
const MAX_OUTPUT_CHARS = 6000;
const REQUEST_TIMEOUT_MS = 45000;
const SINGLE_MODEL = 'gemini-3.8-flash:free';

function apiKey() {
  const key = process.env.UNOROUTER_API_KEY?.trim();
  if (!key) throw new Error('UnoRouter is not configured: UNOROUTER_API_KEY is missing');
  return key;
}

async function fetchJson(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    if (!response || typeof response.text !== 'function') throw new Error('UnoRouter returned an invalid HTTP response');
    const text = await response.text();
    let data: unknown = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!response.ok) {
      const message = typeof data === 'object' && data && 'error' in data
        ? JSON.stringify((data as Record<string, unknown>).error)
        : `UnoRouter HTTP ${response.status}`;
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    if (!data || typeof data !== 'object') throw new Error('UnoRouter returned an invalid JSON response');
    return data as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

function extractMessageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const part = item as Record<string, unknown>;
      return typeof part.text === 'string' ? part.text : typeof part.content === 'string' ? part.content : '';
    }
    return '';
  }).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    const part = value as Record<string, unknown>;
    return typeof part.text === 'string' ? part.text : typeof part.content === 'string' ? part.content : '';
  }
  return '';
}

async function callModel(messages: ChatMessage[]) {
  const data = await fetchJson('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model: SINGLE_MODEL, messages }),
  });
  const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
  const first = choices[0];
  const message = first && typeof first.message === 'object' ? first.message as Record<string, unknown> : undefined;
  const result = (extractMessageText(message?.content) || extractMessageText(first?.text)).trim();
  if (!result) throw new Error(`UnoRouter model ${SINGLE_MODEL} returned no text`);
  return { text: result.slice(0, MAX_OUTPUT_CHARS), responseId: typeof data.id === 'string' ? data.id : '' };
}

export async function runFreeCouncil(input: {
  query: string;
  history?: Array<{ role: string; text: string }>;
  runtimeContext?: Record<string, unknown>;
  symbol?: string;
}) {
  const context = JSON.stringify({ symbol: input.symbol || null, runtimeContext: input.runtimeContext || null });
  const history = (input.history || []).slice(-12).map(item => `${item.role}: ${item.text}`).join('\n');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are SIRE, the reasoning and research intelligence inside the SIRE environment.',
        'Understand the user naturally like a capable general assistant. Conversation is first-class; do not invent tasks.',
        'Reason carefully, challenge weak assumptions, distinguish facts from inference, and do not invent market data.',
        'Use the supplied SIRE context when relevant. If information is missing, say what is missing.',
        `SIRE runtime context: ${context}`,
        `Conversation history:\n${history || '(none)'}`,
      ].join('\n\n'),
    },
    { role: 'user', content: input.query },
  ];

  const result = await callModel(messages);
  return {
    text: result.text,
    responseId: result.responseId,
    model: SINGLE_MODEL,
    provider: 'UnoRouter',
    mode: 'single-model',
    council: {
      provider: 'UnoRouter',
      freeOnly: true,
      councilMembersUsed: 1,
      councilModels: [SINGLE_MODEL],
      debateMode: 'disabled-for-single-model-test',
      rateLimitPolicy: 'one UnoRouter model request per user turn',
    },
  };
}

export async function handleUnoRouterRequest(body: unknown) {
  const payload = (body || {}) as Record<string, unknown>;
  const query = String(payload.query || '').trim();
  if (!query) return { status: 400, body: { error: 'query is required' } };
  try {
    return {
      status: 200,
      body: await runFreeCouncil({
        query,
        symbol: payload.symbol ? String(payload.symbol) : undefined,
        history: Array.isArray(payload.history) ? payload.history as Array<{ role: string; text: string }> : [],
        runtimeContext: payload.runtimeContext && typeof payload.runtimeContext === 'object'
          ? payload.runtimeContext as Record<string, unknown> : undefined,
      }),
    };
  } catch (cause) {
    const value = cause as { status?: number };
    return {
      status: Number.isInteger(value?.status) ? Number(value.status) : 502,
      body: { error: cause instanceof Error ? cause.message : String(cause), provider: 'UnoRouter', model: SINGLE_MODEL },
    };
  }
}
