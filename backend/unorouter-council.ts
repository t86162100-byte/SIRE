type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

type ModelInfo = {
  id?: string;
  object?: string;
  pricing?: { prompt?: string | number; completion?: string | number; input?: string | number; output?: string | number };
  input_modalities?: string[];
  supported_parameters?: string[];
};

const BASE_URL = 'https://api.unorouter.com/v1';
const MAX_MODELS = 200;
const MAX_OUTPUT_CHARS_PER_MODEL = 6000;
const MAX_TRANSCRIPT_CHARS = 60000;
const REQUEST_TIMEOUT_MS = 45000;
const MAX_CONCURRENCY = 8;

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
    const text = await response.text();
    let data: unknown = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!response.ok) {
      const message = typeof data === 'object' && data && 'error' in data
        ? JSON.stringify((data as Record<string, unknown>).error)
        : `UnoRouter HTTP ${response.status}`;
      throw new Error(message);
    }
    return data as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export async function listFreeModels() {
  const data = await fetchJson('/models');
  const models = Array.isArray(data.data) ? data.data as ModelInfo[] : [];
  return models
    .filter(model => isFreeModel(model) && isTextModel(model))
    .map(model => String(model.id))
    .filter(Boolean)
    .slice(0, MAX_MODELS);
}

async function callModel(model: string, messages: ChatMessage[], temperature = 0.2) {
  const data = await fetchJson('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: 1800,
      stream: false,
    }),
  });
  const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
  const first = choices[0]?.message as Record<string, unknown> | undefined;
  return String(first?.content || '').trim().slice(0, MAX_OUTPUT_CHARS_PER_MODEL);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
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
  const models = await listFreeModels();
  if (!models.length) throw new Error('UnoRouter returned no free text models');

  const context = JSON.stringify({ symbol: input.symbol || null, runtimeContext: input.runtimeContext || null });
  const history = (input.history || []).slice(-12).map(item => `${item.role}: ${item.text}`).join('\n');
  const basePrompt = [
    'You are one member of the SIRE research and reasoning council.',
    'Think independently, be precise, challenge assumptions, and use the supplied SIRE context when relevant.',
    'Do not invent market data. If data is missing, say what is missing.',
    `SIRE runtime context: ${context}`,
    `Conversation history:\n${history || '(none)'}`,
    `Current user request:\n${input.query}`,
    'Return a concise analysis that another council member can critique and build on.',
  ].join('\n\n');

  const firstRound = await mapWithConcurrency(models, MAX_CONCURRENCY, async model => {
    try {
      const response = await callModel(model, [{ role: 'system', content: basePrompt }], 0.25);
      return { model, response, ok: true };
    } catch (cause) {
      return { model, response: cause instanceof Error ? `ERROR: ${cause.message}` : 'ERROR: request failed', ok: false };
    }
  });

  const successful = firstRound.filter(row => row.ok && row.response && !row.response.startsWith('ERROR:'));
  const transcript = compactTranscript(successful);
  const discussionPrompt = [
    'You are participating in the second stage of the SIRE council.',
    'Below are analyses produced by other free models. Compare them, identify agreements, disagreements, missing evidence, and stronger ideas. Build a better joint conclusion rather than simply voting.',
    `User request: ${input.query}`,
    `Shared council transcript:\n${transcript}`,
    'Produce a reasoned joint analysis for the next council stage.',
  ].join('\n\n');

  const discussionModels = models.filter(model => successful.some(row => row.model === model));
  const secondRound = await mapWithConcurrency(discussionModels, MAX_CONCURRENCY, async model => {
    try {
      const response = await callModel(model, [{ role: 'system', content: discussionPrompt }], 0.2);
      return { model, response, ok: true };
    } catch (cause) {
      return { model, response: cause instanceof Error ? `ERROR: ${cause.message}` : 'ERROR: request failed', ok: false };
    }
  });

  const discussionSuccess = secondRound.filter(row => row.ok && row.response && !row.response.startsWith('ERROR:'));
  const finalTranscript = compactTranscript(discussionSuccess.length ? discussionSuccess : successful);
  const synthesizer = discussionSuccess[0]?.model || successful[0]?.model || models[0];
  const finalPrompt = [
    'You are the final SIRE council synthesizer.',
    'Use the council discussion below as shared reasoning. Resolve conflicts using evidence and explicit uncertainty. Do not mention internal provider mechanics unless the user asks. Answer the user directly and naturally.',
    `User request: ${input.query}`,
    `Council discussion:\n${finalTranscript}`,
  ].join('\n\n');
  let finalText = '';
  try {
    finalText = await callModel(synthesizer, [{ role: 'system', content: finalPrompt }], 0.15);
  } catch {
    finalText = discussionSuccess[0]?.response || successful[0]?.response || 'The free-model council could not complete a response.';
  }

  return {
    text: finalText,
    council: {
      provider: 'UnoRouter',
      freeOnly: true,
      discoveredFreeTextModels: models.length,
      firstRoundCompleted: successful.length,
      secondRoundCompleted: discussionSuccess.length,
      synthesizer,
      modelResponses: firstRound.map(row => ({ model: row.model, ok: row.ok })),
    },
  };
}

export async function handleUnoRouterRequest(body: unknown) {
  const payload = (body || {}) as Record<string, unknown>;
  const query = String(payload.query || '').trim();
  if (!query) return { status: 400, body: { error: 'query is required' } };
  try {
    const result = await runFreeCouncil({
      query,
      symbol: payload.symbol ? String(payload.symbol) : undefined,
      history: Array.isArray(payload.history) ? payload.history as Array<{ role: string; text: string }> : [],
      runtimeContext: payload.runtimeContext && typeof payload.runtimeContext === 'object' ? payload.runtimeContext as Record<string, unknown> : undefined,
    });
    return { status: 200, body: result };
  } catch (cause) {
    return { status: 502, body: { error: cause instanceof Error ? cause.message : String(cause), provider: 'UnoRouter' } };
  }
}
