type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

type ModelInfo = {
  id?: string;
  pricing?: { prompt?: string | number; completion?: string | number; input?: string | number; output?: string | number };
  input_modalities?: string[];
};

const BASE_URL = 'https://api.unorouter.com/v1';
const MAX_MODELS = 200;
const MAX_OUTPUT_CHARS_PER_MODEL = 6000;
const MAX_TRANSCRIPT_CHARS = 60000;
const REQUEST_TIMEOUT_MS = 45000;
const COUNCIL_SIZE = 5;
const MODEL_COOLDOWN_MS = 65_000;
const MAX_MODEL_ATTEMPTS = 15;

// Preferred free council ranking. The live /models response is still authoritative:
// a preferred model is used only when UnoRouter currently reports it as genuinely free.
const PREFERRED_FREE_MODELS = [
  'gemini-3.8-flash:free',
  'ling-3.0-flash-fin:free',
  'glm-5.3-flash-search:free',
  'glm-5.3-flash-think-search:free',
  'glm-5.3-flash-thinking:free',
];

const modelCooldownUntil = new Map<string, number>();
let rotationCursor = 0;

function apiKey() {
  const key = process.env.UNOROUTER_API_KEY?.trim();
  if (!key) throw new Error('UnoRouter is not configured: UNOROUTER_API_KEY is missing');
  return key;
}

function isFreeModel(model: ModelInfo) {
  const id = String(model.id || '').trim();
  if (!id) return false;
  if (id.endsWith(':free')) return true;
  const pricing = model.pricing || {};
  const prompt = Number(pricing.prompt ?? pricing.input);
  const completion = Number(pricing.completion ?? pricing.output);
  return Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0;
}

function isTextModel(model: ModelInfo) {
  const modalities = Array.isArray(model.input_modalities) ? model.input_modalities : [];
  return modalities.length === 0 || modalities.some(value => String(value).toLowerCase() === 'text');
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

export async function listFreeModels() {
  const data = await fetchJson('/models');
  const models = Array.isArray(data.data) ? data.data as ModelInfo[] : [];
  return models.filter(model => isFreeModel(model) && isTextModel(model))
    .map(model => String(model.id)).filter(Boolean).slice(0, MAX_MODELS);
}

function rankCouncilModels(models: string[]) {
  const available = new Set(models);
  const preferred = PREFERRED_FREE_MODELS.filter(model => available.has(model));
  const remaining = models.filter(model => !preferred.includes(model));
  // Keep the live UnoRouter catalogue order for the fallback slots. This means
  // new free models can enter the council without ever enabling a paid model.
  const ranked = [...preferred, ...remaining];
  return ranked.slice(0, Math.min(COUNCIL_SIZE, ranked.length));
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

async function callModel(model: string, messages: ChatMessage[]) {
  const data = await fetchJson('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model, messages }),
  });
  const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
  const first = choices[0];
  const message = first && typeof first.message === 'object' ? first.message as Record<string, unknown> : undefined;
  const result = (extractMessageText(message?.content) || extractMessageText(first?.text)).trim();
  if (!result) throw new Error(`UnoRouter model ${model} returned no text`);
  return result.slice(0, MAX_OUTPUT_CHARS_PER_MODEL);
}

function isRateLimited(error: unknown) {
  const value = error as { status?: number; message?: string };
  return value?.status === 429 || /rate[_ -]?limit|too many requests|retry in \d+s/i.test(String(value?.message || ''));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function compactTranscript(rows: Array<{ model: string; response: string }>) {
  const text = rows.map((row, index) => `MODEL ${index + 1} — ${row.model}\n${row.response || '(no response)'}`).join('\n\n');
  return text.length > MAX_TRANSCRIPT_CHARS ? text.slice(0, MAX_TRANSCRIPT_CHARS) : text;
}

export async function runFreeCouncil(input: {
  query: string;
  history?: Array<{ role: string; text: string }>;
  runtimeContext?: Record<string, unknown>;
  symbol?: string;
}) {
  const discoveredModels = await listFreeModels();
  if (!discoveredModels.length) throw new Error('UnoRouter returned no free text models');

  const selectedModels = rankCouncilModels(discoveredModels);
  if (selectedModels.length < COUNCIL_SIZE) {
    throw new Error(`UnoRouter currently exposes only ${selectedModels.length} usable free text models; SIRE requires ${COUNCIL_SIZE}. No paid fallback is allowed.`);
  }

  const context = JSON.stringify({ symbol: input.symbol || null, runtimeContext: input.runtimeContext || null });
  const history = (input.history || []).slice(-12).map(item => `${item.role}: ${item.text}`).join('\n');
  const basePrompt = [
    'You are one member of the SIRE research and reasoning council.',
    'There are five council members. The council is collaborative, not a vote.',
    'Reason independently, then inspect the other council members\' arguments supplied below.',
    'Challenge weak assumptions, correct errors, identify disagreements, and build on strong ideas.',
    'Do not merely agree. State the best-supported conclusion and what the council should do.',
    'Do not invent market data. If data is missing, say what is missing and use SIRE tools/context when available.',
    `SIRE runtime context: ${context}`,
    `Conversation history:\n${history || '(none)'}`,
    `Current user request:\n${input.query}`,
  ].join('\n\n');

  const council: Array<{ model: string; response: string }> = [];
  const failures: string[] = [];

  // Each of the five selected models is called at most once per user turn.
  // Every later member receives the complete discussion accumulated so far,
  // so the council is a real sequential debate rather than five isolated answers.
  for (const model of selectedModels) {
    try {
      const discussion = council.length
        ? [
            'SHARED COUNCIL DISCUSSION SO FAR:',
            compactTranscript(council),
            '',
            'You have now seen the other members\' positions. Debate them directly: identify agreements, disagreements, corrections, missing evidence, and the strongest path forward.',
          ].join('\n\n')
        : 'You are the first council member. Establish the initial analysis, key assumptions, risks, and proposed direction so the other four members can challenge it.';

      const response = await callModel(model, [{
        role: 'system',
        content: [basePrompt, discussion, 'Return a concise council contribution for the next members and eventual SIRE answer.'].join('\n\n'),
      }]);
      council.push({ model, response });
      modelCooldownUntil.set(model, Date.now() + MODEL_COOLDOWN_MS);
    } catch (cause) {
      if (isRateLimited(cause)) modelCooldownUntil.set(model, Date.now() + MODEL_COOLDOWN_MS);
      failures.push(`${model}: ${errorText(cause)}`);
    }
  }

  if (council.length < COUNCIL_SIZE) {
    throw new Error(`The five-model free council could not complete. ${failures.slice(0, 5).join(' | ')}`);
  }

  const final = council[council.length - 1];
  return {
    text: final.response,
    council: {
      provider: 'UnoRouter',
      freeOnly: true,
      discoveredFreeTextModels: discoveredModels.length,
      councilMembersUsed: council.length,
      councilModels: council.map(row => row.model),
      debateMode: 'shared-sequential-five-model-council',
      failedCandidates: failures.length,
      synthesizer: final.model,
      rateLimitPolicy: 'each free model is called at most once per user turn',
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
    return { status: 502, body: { error: cause instanceof Error ? cause.message : String(cause), provider: 'UnoRouter' } };
  }
}
