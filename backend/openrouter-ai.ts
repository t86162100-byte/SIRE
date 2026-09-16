type ChatMessage = { role: 'user' | 'assistant'; content: string };

type CouncilTurn = { provider: string; model: string; role: string; text: string };
type CouncilEvent = (event: { actor: string; phase: string; text: string }) => void | Promise<void>;

import { runGemini } from './gemini-ai.ts';

const MODEL = 'openai/gpt-oss-20b';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 30000;
const MAX_OUTPUT_CHARS = 12000;

function getApiKey() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error('OpenAI GPT council is not configured: OPENROUTER_API_KEY is missing');
  return key;
}

function cleanHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history.slice(-20).flatMap((item: any) => {
    const content = String(item?.text || item?.content || '').trim();
    if (!content) return [];
    return [{ role: item?.role === 'assistant' || item?.role === 'model' || item?.role === 'sire' ? 'assistant' : 'user', content } as ChatMessage];
  });
}

function textFromResponse(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim();
  return '';
}

async function callOpenRouter(messages: ChatMessage[], temperature = 0.7) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getApiKey()}`, 'HTTP-Referer': 'https://sire-rwv9.onrender.com', 'X-Title': 'SIRE AI Council' },
      body: JSON.stringify({ model: MODEL, messages, temperature, max_tokens: 2048 }),
    });
    const raw = await response.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
    if (!response.ok) { const error = new Error(data?.error?.message || `OpenRouter HTTP ${response.status}`); (error as any).status = response.status; throw error; }
    const text = textFromResponse(data);
    if (!text) { const error = new Error('OpenAI GPT council returned no text'); (error as any).status = 502; throw error; }
    return { text: text.slice(0, MAX_OUTPUT_CHARS), responseId: typeof data?.id === 'string' ? data.id : '' };
  } finally { clearTimeout(timer); }
}

function systemPrompt() {
  return [
    'You are SIRE, the user-facing AI assistant and one member of a capable AI team.',
    'Your name is SIRE. Never identify yourself as ChatGPT, OpenAI, Gemini, GPT, GPT-OSS, or another assistant unless the user explicitly asks what technology powers SIRE.',
    'You are a full-fledged general conversational AI. Handle greetings, small talk, questions, explanations, brainstorming, writing, planning, coding and technical topics naturally.',
    'Do not assume every message is a task or a market/trading request.',
    'Preserve conversation context and answer the actual user intent.',
    'You are collaborating with another capable AI. Treat it like a teammate, not an opponent. You may agree, disagree, ask it questions, propose ideas, split responsibilities, verify its work, combine complementary ideas, or change your mind.',
    'Do not manufacture disagreement. If the other member is correct, say so and build on it. If both approaches are useful, divide the work and combine them.',
    'When useful, suggest concrete next steps, checks, research questions, plans, or tool calls. If tools are actually supplied by the runtime, use their results rather than inventing them.',
    'Never claim to have browsed, searched, verified, executed, or changed something unless the runtime actually did it.',
    'For the visible council stream, provide short decision-relevant summaries of what you are doing, such as proposing, checking, discussing, planning, researching, agreeing, revising, or concluding. Do not expose private chain-of-thought.',
    'Do not force labels such as Arguments, Evidence, Assumptions, Objections, or Conclusion. Use whatever structure naturally fits the current discussion.',
  ].join('\n');
}

export async function runOpenRouter(input: {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  system?: string;
  councilContext?: string;
  onEvent?: CouncilEvent;
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');
  const system = input.system || systemPrompt();
  const history = cleanHistory(input.history);
  const initialContext = input.councilContext?.trim() || '';
  const debate: CouncilTurn[] = [];
  const emit = async (actor: string, phase: string, text: string) => { if (input.onEvent) await input.onEvent({ actor, phase, text }); };

  if (!initialContext) {
    const result = await callOpenRouter([{ role: 'system', content: system }, ...history, { role: 'user', content: query }]);
    return { text: result.text, responseId: result.responseId, model: MODEL, provider: 'OpenAI via OpenRouter' };
  }

  await emit('GPT', 'discussing', 'Reading Gemini’s contribution and deciding how to help.');
  const challenge = await callOpenRouter([
    { role: 'system', content: `${system}\n\nYou are joining an active team discussion. First understand the other member's proposal. Then contribute whatever is most useful: validate it, question it, improve it, add a missing idea, propose a different approach, or divide the work. Do not disagree just to create debate. Do not produce the final user answer yet. Give a concise collaboration summary.` },
    ...history,
    { role: 'user', content: query },
    { role: 'assistant', content: `Gemini's current contribution:\n\n${initialContext}` },
    { role: 'user', content: 'Continue the team discussion. Decide what contribution would move the work forward most.' },
  ]);
  debate.push({ provider: 'OpenAI via OpenRouter', model: MODEL, role: 'discussion', text: challenge.text });
  await emit('GPT', 'discussing', challenge.text);

  await emit('Gemini', 'responding', 'Considering GPT’s contribution and deciding whether to agree, refine, divide work, or change direction.');
  const rebuttal = await runGemini({
    query,
    history,
    councilContext: `USER REQUEST:\n${query}\n\nMY PREVIOUS CONTRIBUTION:\n${initialContext}\n\nGPT TEAMMATE CONTRIBUTION:\n${challenge.text}`,
    debateRole: 'response',
    onEvent: input.onEvent,
  });
  debate.push({ provider: rebuttal.provider, model: rebuttal.model, role: 'discussion', text: rebuttal.text });
  await emit('Gemini', 'discussing', rebuttal.text);

  await emit('GPT', 'concluding', 'Combining the useful work from both members into one answer.');
  const final = await callOpenRouter([
    { role: 'system', content: `${system}\n\nYou are the final member of the team. Review the complete discussion, resolve genuine differences, preserve agreements, combine complementary ideas, and produce the best direct answer to the user as SIRE. Do not mention internal council mechanics unless asked. Do not expose private chain-of-thought. The final answer must stand on its own.` },
    ...history,
    { role: 'user', content: query },
    { role: 'assistant', content: `TEAM DISCUSSION:\n\nGEMINI:\n${initialContext}\n\nGPT:\n${challenge.text}\n\nGEMINI:\n${rebuttal.text}` },
    { role: 'user', content: 'Conclude the team discussion and answer the user directly.' },
  ]);
  debate.push({ provider: 'OpenAI via OpenRouter', model: MODEL, role: 'conclusion', text: final.text });
  await emit('GPT', 'conclusion', 'The team has reached a conclusion.');

  return { text: final.text, responseId: final.responseId || rebuttal.responseId || challenge.responseId || '', model: MODEL, provider: 'OpenAI via OpenRouter', council: debate };
}
