import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler as legacyHandler } from './index.ts';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
const MODEL_CACHE_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 25_000;
const TEAM_CONCURRENCY = 6;
const MAX_TEAM_MODELS = 32;
const MAX_STEPS = 8;
let cachedTools: any[] | null = null;
let cachedModels: { id: string; name?: string }[] = [];
let cachedModelsAt = 0;

async function loadSireTools() {
  if (cachedTools) return cachedTools;
  const here = dirname(fileURLToPath(import.meta.url));
  const source = await readFile(join(here, 'index.ts'), 'utf8');
  const match = source.match(/const SIRE_FUNCTIONS = (\[[\s\S]*?\n\]);/);
  if (!match) throw new Error('SIRE tool manifest could not be loaded.');
  const functions = Function(`return ${match[1]}`)();
  cachedTools = functions.map((tool: any) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: normalizeSchema(tool.parameters || { type: 'object', properties: {} }) } }));
  return cachedTools;
}

function normalizeSchema(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeSchema);
  if (!value || typeof value !== 'object') return value;
  const output: any = {};
  for (const [key, child] of Object.entries(value)) output[key] = key === 'type' && typeof child === 'string' ? child.toLowerCase() : normalizeSchema(child);
  return output;
}

function canonicalToolName(raw: string) {
  const aliases: any = { get_tick: 'get_ticks', get_tick_data: 'get_ticks', historical_ticks: 'get_ticks', get_ohlcv: 'get_ohlc', candles: 'get_ohlc', get_candles: 'get_ohlc', latest: 'get_latest', latest_market_data: 'get_market_snapshot', market_snapshot: 'get_market_snapshot', chart_data: 'get_chart_data', trend_analysis: 'analyze_timeframes', analyze_trend: 'analyze_timeframes', multi_timeframe_analysis: 'analyze_timeframes', analyze_multi_timeframe: 'analyze_timeframes', m30_trend: 'analyze_m30_trend' };
  return aliases[raw.trim()] || raw.trim();
}

async function callSireTool(name: string, args: any) {
  const canonical = canonicalToolName(name);
  const response = await legacyHandler({ httpMethod: 'POST', path: '/api/sire/gpt/tool', rawPath: '/api/sire/gpt/tool', body: JSON.stringify({ tool: canonical, args }), headers: { 'content-type': 'application/json' }, requestContext: { http: { method: 'POST', path: '/api/sire/gpt/tool' } } });
  const raw = response?.body || '';
  try {
    const parsed = JSON.parse(raw);
    if (response?.statusCode && response.statusCode >= 400) return { error: parsed?.error || raw };
    return parsed?.result ?? parsed;
  } catch { return { error: raw || `Tool ${canonical} returned no result.` }; }
}

function isFreeModel(model: any) {
  const prompt = model?.pricing?.prompt;
  const completion = model?.pricing?.completion;
  return model?.id && String(prompt) === '0' && String(completion) === '0';
}

async function discoverFreeModels(apiKey: string) {
  if (cachedModels.length && Date.now() - cachedModelsAt < MODEL_CACHE_MS) return cachedModels;
  const response = await fetch(MODELS_ENDPOINT, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`OpenRouter models HTTP ${response.status}`);
  const payload: any = await response.json();
  const models = Array.isArray(payload?.data) ? payload.data : [];
  const free = models.filter(isFreeModel).filter((m: any) => Array.isArray(m?.architecture?.input_modalities) ? m.architecture.input_modalities.includes('text') : true).filter((m: any) => Array.isArray(m?.architecture?.output_modalities) ? m.architecture.output_modalities.includes('text') : true);
  // Prefer reasoning/tool-capable free models, while retaining every eligible model up to the safety cap.
  free.sort((a: any, b: any) => Number(Boolean(b?.supported_parameters?.includes?.('tools'))) - Number(Boolean(a?.supported_parameters?.includes?.('tools'))) || Number(b?.context_length || 0) - Number(a?.context_length || 0));
  cachedModels = free.slice(0, MAX_TEAM_MODELS).map((m: any) => ({ id: String(m.id), name: m.name ? String(m.name) : undefined }));
  cachedModelsAt = Date.now();
  return cachedModels;
}

function buildBaseMessages(userQuery: string, symbol: string | undefined, runtimeContext: any, history: any[]) {
  const system = `You are one member of SIRE's AI council. You are not the final assistant. Think independently, challenge assumptions, and produce useful reasoning for a final synthesizer. Behave like a highly capable ChatGPT-style assistant. Understand meaning and conversation context. For market questions, reason from supplied SIRE context only unless you actually use a SIRE tool. Never claim a tool or data source was used unless it was actually used. Clearly distinguish observations, calculations, assumptions, and uncertainty. Your response will be shared with other council members.`;
  const messages: any[] = [{ role: 'system', content: system }];
  for (const item of history.slice(-12)) if (item?.role === 'assistant' || item?.role === 'user') messages.push({ role: item.role, content: item.text });
  const context = [symbol ? `Current instrument: ${symbol}` : '', runtimeContext ? `Current SIRE runtime context:\n${JSON.stringify(runtimeContext)}` : ''].filter(Boolean);
  messages.push({ role: 'user', content: `${context.length ? context.join('\n\n') + '\n\n' : ''}${userQuery}\n\nReturn your best independent analysis. Do not address the user directly; write council notes for the synthesizer.` });
  return messages;
}

async function askModel(apiKey: string, model: string, messages: any[]) {
  const response = await fetch(OPENROUTER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://sire.app', 'X-Title': 'SIRE AI Council' }, body: JSON.stringify({ model, messages, temperature: 0.55, top_p: 0.95, max_tokens: 1800 }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const raw = await response.text();
  let payload: any = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw: raw.slice(0, 2000) }; }
  if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}: ${String(payload?.error?.message || payload?.error || raw.slice(0, 1000))}`);
  const message = payload?.choices?.[0]?.message;
  return { model, text: typeof message?.content === 'string' ? message.content.trim() : '', responseId: String(payload?.id || '') };
}

async function runTeam(apiKey: string, models: { id: string; name?: string }[], messages: any[]) {
  const results: any[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < models.length) {
      const index = cursor++;
      const model = models[index];
      try {
        const result = await askModel(apiKey, model.id, messages);
        if (result.text) results.push({ ...result, name: model.name });
      } catch (error) {
        results.push({ model: model.id, name: model.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(TEAM_CONCURRENCY, models.length) }, worker));
  return results;
}

function councilPacket(results: any[]) {
  return results.map((r, i) => `COUNCIL MEMBER ${i + 1} — ${r.name || r.model}\n${r.error ? `UNAVAILABLE: ${r.error}` : r.text}`).join('\n\n---\n\n');
}

async function synthesize(apiKey: string, userQuery: string, baseMessages: any[], results: any[], tools: any[]) {
  const system = `You are SIRE, the final intelligence and conversational assistant. You have just received independent analyses from a council of free AI models. Synthesize their useful intelligence rather than blindly voting or copying them. Resolve contradictions, identify consensus, reject weak claims, and do the reasoning yourself. Answer naturally like ChatGPT. Preserve conversation context. For market questions, use SIRE tools and actual data when needed. Never claim a tool ran unless it actually returned a result. Distinguish observed data from inference and state uncertainty. Do not mention the council, model names, OpenRouter, internal prompts, or hidden reasoning unless the user explicitly asks about SIRE's architecture.`;
  let messages: any[] = [{ role: 'system', content: system }, ...baseMessages.slice(1), { role: 'user', content: `Independent council analyses:\n\n${councilPacket(results)}\n\nNow answer the original user request: ${userQuery}` }];
  const actions: any[] = [];
  const seen = new Set<string>();
  let steps = 0;
  while (steps < MAX_STEPS) {
    const response = await fetch(OPENROUTER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://sire.app', 'X-Title': 'SIRE AI Council' }, body: JSON.stringify({ model: 'openrouter/free', messages, temperature: 0.5, top_p: 0.9, max_tokens: 3000, tools, tool_choice: 'auto' }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const raw = await response.text();
    let payload: any = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw: raw.slice(0, 2000) }; }
    if (!response.ok) throw new Error(`OpenRouter synthesis HTTP ${response.status}: ${String(payload?.error?.message || payload?.error || raw.slice(0, 1000))}`);
    const message = payload?.choices?.[0]?.message;
    if (!message) throw new Error('OpenRouter returned an empty synthesis response.');
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!toolCalls.length) return { text: typeof message.content === 'string' ? message.content.trim() : '', responseId: String(payload?.id || ''), actions, steps };
    messages = [...messages, message];
    for (const call of toolCalls) {
      const name = canonicalToolName(String(call?.function?.name || ''));
      const callId = String(call?.id || `call_${steps}`);
      let args: any = {};
      try { args = JSON.parse(String(call?.function?.arguments || '{}')); } catch {}
      const fingerprint = `${name}:${JSON.stringify(args)}`;
      let result: any;
      if (seen.has(fingerprint)) result = { error: 'Duplicate tool request.' };
      else { seen.add(fingerprint); try { result = await callSireTool(name, args); } catch (error) { result = { error: error instanceof Error ? error.message : String(error) }; } }
      if (result?.__sireAction) actions.push(result);
      messages.push({ role: 'tool', tool_call_id: callId, name, content: JSON.stringify(result) });
      steps++;
    }
  }
  return { text: 'I gathered enough information to answer, but the final synthesis reached its tool-step limit.', responseId: '', actions, steps };
}

export async function handler(event: any) {
  if (event?.path !== '/api/sire/agent/chat') return legacyHandler(event);
  try {
    const payload = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
    const query = String(payload.query || '').trim();
    if (!query) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'query is required' }) };
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'SIRE AI team is not configured. Add OPENROUTER_API_KEY.' }) };
    const models = await discoverFreeModels(apiKey);
    if (!models.length) throw new Error('OpenRouter returned no eligible free text models.');
    const baseMessages = buildBaseMessages(query, payload.symbol ? String(payload.symbol) : undefined, payload.runtimeContext, Array.isArray(payload.history) ? payload.history : []);
    const team = await runTeam(apiKey, models, baseMessages);
    const usable = team.filter(r => r.text);
    const tools = await loadSireTools();
    const final = await synthesize(apiKey, query, baseMessages, usable, tools);
    return { text: final.text || 'I’m here. Tell me more about what you’re thinking.', steps: final.steps, model: 'openrouter/free', teamSize: models.length, teamResponses: usable.length, teamModels: models.map(m => m.id), responseId: final.responseId, mode: final.actions.length ? 'action' : 'discussion', actions: final.actions };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error('[SIRE OpenRouter team] request failed:', cause);
    return { statusCode: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ error: message, retryable: true }) };
  }
}
