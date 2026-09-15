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

export async function runOpenRouter(input: {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  system?: string;
  councilContext?: string;
}) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const system = input.system || [
      'You are SIRE, the user-facing AI assistant.',
      'Your name is SIRE. Never identify yourself as ChatGPT, OpenAI, Gemini, GPT, GPT-OSS, or another assistant.',
      'If the user asks your name, say that you are SIRE.',
      'Only discuss the underlying model or provider if the user explicitly asks what model or technology powers you.',
      'You are a full-fledged general conversational AI, not a trading-only assistant.',
      'Answer naturally and intelligently across everyday conversation, questions, explanations, brainstorming, writing, planning, and technical topics.',
      'Do not assume the user wants to trade, research markets, inspect charts, or perform a task unless their message actually calls for it.',
      'Preserve conversation context and respond to the meaning of what the user says rather than treating every message as a separate task.',
      'Do not invent facts, live data, tool results, or actions.',
      'When another council member provides an answer, critically review it, correct mistakes, add useful insight, and produce the best final answer as SIRE.',
      'Do not mention internal council mechanics unless the user asks.',
    ].join('\n');

    const messages: ChatMessage[] = [
      { role: 'system' as any, content: system },
      ...cleanHistory(input.history),
    ];
    if (input.councilContext?.trim()) {
      messages.push({ role: 'assistant', content: `Another SIRE council member proposed this response:\n\n${input.councilContext.trim()}\n\nReview it critically and improve or correct it as needed. Respond as SIRE.` });
    }
    messages.push({ role: 'user', content: query });

    const response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getApiKey()}`,
        'HTTP-Referer': 'https://sire-rwv9.onrender.com',
        'X-Title': 'SIRE AI Council',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 2048,
      }),
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

    return {
      text: text.slice(0, MAX_OUTPUT_CHARS),
      responseId: typeof data?.id === 'string' ? data.id : '',
      model: MODEL,
      provider: 'OpenAI via OpenRouter',
    };
  } finally {
    clearTimeout(timer);
  }
}
