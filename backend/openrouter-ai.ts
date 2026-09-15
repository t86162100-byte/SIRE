import { runGemini } from './gemini-ai.ts';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

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
    return [{
      role: item?.role === 'assistant' || item?.role === 'model' || item?.role === 'sire' ? 'assistant' : 'user',
      content,
    } as ChatMessage];
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
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getApiKey()}`,
        'HTTP-Referer': 'https://sire-rwv9.onrender.com',
        'X-Title': 'SIRE AI Council',
      },
      body: JSON.stringify({ model: MODEL, messages, temperature, max_tokens: 2048 }),
    });
    const raw = await response.text();
    let data: any = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
    if (!response.ok) {
      const error = new Error(data?.error?.message || `OpenRouter HTTP ${response.status}`);
      (error as any).status = response.status;
      throw error;
    }
    const text = textFromResponse(data);
    if (!text) {
      const error = new Error('OpenAI GPT council returned no text');
      (error as any).status = 502;
      throw error;
    }
    return { text: text.slice(0, MAX_OUTPUT_CHARS), responseId: typeof data?.id === 'string' ? data.id : '' };
  } finally {
    clearTimeout(timer);
  }
}

function systemPrompt() {
  return [
    'You are SIRE, the user-facing AI assistant.',
    'Your name is SIRE. Never identify yourself as ChatGPT, OpenAI, Gemini, GPT, GPT-OSS, or another assistant.',
    'If the user asks your name, say that you are SIRE.',
    'Only discuss the underlying model or provider if the user explicitly asks what model or technology powers you.',
    'You are a full-fledged general conversational AI, not a trading-only assistant.',
    'Answer naturally and intelligently across everyday conversation, questions, explanations, brainstorming, writing, planning, and technical topics.',
    'Do not assume the user wants to trade, research markets, inspect charts, or perform a task unless their message actually calls for it.',
    'Preserve conversation context and respond to the meaning of what the user says rather than treating every message as a separate task.',
    'Do not invent facts, live data, tool results, or actions.',
    'For collaboration, challenge ideas when warranted, ask meaningful questions of the other council member, correct mistakes, and build on useful ideas.',
    'Never reveal private chain-of-thought. The council UI may show concise decision-relevant summaries instead.',
    'When participating in a visible council round, organize the response with short labeled sections when they are useful: Arguments, Evidence, Assumptions, Objections, Response, Agreement/Disagreement, and Conclusion. Do not force empty sections.',
    'Keep collaboration substantive: refer to the other member\'s actual position, identify specific points you accept or reject, explain why briefly, and add new useful information.',
    'Do not mention internal council mechanics unless the user asks.',
  ].join('\n');
}

export async function runOpenRouter(input: {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  system?: string;
  councilContext?: string;
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');

  const system = input.system || systemPrompt();
  const history = cleanHistory(input.history);
  const initialContext = input.councilContext?.trim() || '';
  const debate: Array<{ provider: string; model: string; role: string; text: string }> = [];

  if (!initialContext) {
    const result = await callOpenRouter([
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: query },
    ]);
    return {
      text: result.text,
      responseId: result.responseId,
      model: MODEL,
      provider: 'OpenAI via OpenRouter',
    };
  }

  // Round 1: GPT sees Gemini's proposal and actively challenges it instead of merely rewriting it.
  const challenge = await callOpenRouter([
    { role: 'system', content: `${system}\n\nYou are the challenging council member in a collaborative debate. Do not produce the final answer yet. Give a concise critique using useful sections such as Arguments, Evidence, Assumptions, Objections, Response, Agreement/Disagreement, and Conclusion. Identify what is strong, what may be wrong or missing, what question you would ask the other member, and what you would change. Keep it decision-relevant and do not expose private chain-of-thought.` },
    ...history,
    { role: 'user', content: query },
    { role: 'assistant', content: `Gemini's current proposal:\n\n${initialContext}` },
    { role: 'user', content: 'Challenge this proposal. Question the other member where necessary and state your corrected position.' },
  ]);
  debate.push({ provider: 'OpenAI via OpenRouter', model: MODEL, role: 'challenge', text: challenge.text });

  // Round 2: Gemini gets both sides and responds to the GPT challenge.
  const rebuttal = await runGemini({
    query: `We are collaborating on the user's request below. Another council member proposed an initial answer, then GPT challenged it. Respond to the challenge and refine your position. You are not writing the final user answer yet. Use concise decision-relevant sections when useful: Arguments, Evidence, Assumptions, Objections, Response, Agreement/Disagreement, and Conclusion. State what you agree with, what you reject, what you would correct, and the position you now recommend. Do not reveal private chain-of-thought.\n\nUSER REQUEST:\n${query}\n\nINITIAL GEMINI PROPOSAL:\n${initialContext}\n\nGPT CHALLENGE:\n${challenge.text}`,
    history,
    debateRole: 'response',
  });
  debate.push({ provider: rebuttal.provider, model: rebuttal.model, role: 'rebuttal', text: rebuttal.text });

  // Round 3: GPT sees the whole exchange and makes the collaborative final answer.
  const final = await callOpenRouter([
    { role: 'system', content: `${system}\n\nYou are the final decision member of a two-model collaboration. You have seen the initial proposal, a challenge, and a rebuttal. Resolve disagreements, keep correct ideas from each side, reject weak claims, and answer the user directly as SIRE. Do not mention that you are GPT. Do not expose private chain-of-thought. The final answer should stand on its own. Before the answer, you may provide a compact Conclusion/Decision summary, but do not dump the debate into the user-facing answer.` },
    ...history,
    { role: 'user', content: query },
    { role: 'assistant', content: `INITIAL GEMINI PROPOSAL:\n${initialContext}\n\nGPT CHALLENGE:\n${challenge.text}\n\nGEMINI REBUTTAL:\n${rebuttal.text}` },
    { role: 'user', content: 'Now resolve the debate and provide the best final answer to the user.' },
  ]);
  debate.push({ provider: 'OpenAI via OpenRouter', model: MODEL, role: 'final', text: final.text });

  return {
    text: final.text,
    responseId: final.responseId || rebuttal.responseId || challenge.responseId || '',
    model: MODEL,
    provider: 'OpenAI via OpenRouter',
    council: debate,
  };
}
