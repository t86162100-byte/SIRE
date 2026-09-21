import { webSearch } from './agent-tools.ts';

type HistoryItem = { role: string; text?: string; content?: string };
type RuntimeContext = Record<string, unknown>;
type AgentAction = Record<string, unknown>;

const MODEL = 'openai/gpt-oss-20b';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_ROUNDS = 4;
const MAX_OUTPUT_CHARS = 12000;

export const OPENALGO_SKILLS = [
  { name: 'openalgo-charts', kind: 'reference', use: 'Core chart engine, data model, tiers, navigation, feeds, state, replay, linking, settings, trading and pitfalls.' },
  { name: 'openalgo-chart-setup', kind: 'task', use: 'Scaffold and verify a real OpenAlgo chart in an existing host.' },
  { name: 'openalgo-chart-indicator', kind: 'task', use: 'Resolve exact indicator ids/settings, add or restyle built-in indicators, or author indicators.' },
  { name: 'openalgo-chart-terminal', kind: 'task', use: 'Build a terminal with live data, indicators, drawings, trading, depth, replay, linked charts and persistence.' },
  { name: 'openalgo-chart-plugin', kind: 'task', use: 'Extend the chart with primitives, drawing tools, chart types or indicator descriptors.' },
  { name: 'openalgo-chart-debug', kind: 'task', use: 'Diagnose rendering, data, repaint, resize, replay, live-feed, linking and bundle problems before changing code.' },
];

function key() {
  const value = process.env.OPENROUTER_API_KEY?.trim();
  if (!value) throw new Error('OpenAI GPT agent is not configured: OPENROUTER_API_KEY is missing');
  return value;
}

function cleanHistory(history: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(history)) return [];
  return history.slice(-16).flatMap((item: HistoryItem) => {
    const content = String(item?.text || item?.content || '').trim();
    if (!content) return [];
    return [{ role: item?.role === 'assistant' || item?.role === 'model' || item?.role === 'sire' ? 'assistant' : 'user', content }];
  });
}

function extractJson(text: string) {
  const fenced = text.match(/\`\`\`json\s*([\s\S]*?)\`\`\`/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
  return null;
}

function normalizeActions(value: unknown): AgentAction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).filter(item => item && typeof item === 'object').map(item => {
    const raw = item as Record<string, unknown>;
    // OpenAI/OpenRouter agents sometimes emit the natural tool shape
    // { name: 'add_drawing', params: { ... } }. The browser bridge consumes
    // the canonical SIRE action shape, so normalize it server-side.
    const name = String(raw.__sireAction || raw.type || raw.name || '');
    const params = raw.params && typeof raw.params === 'object' ? raw.params as Record<string, unknown> : {};
    const merged = { ...params, ...raw } as Record<string, unknown>;
    const rawTool = String(merged.tool || merged.kind || '').toLowerCase();
    const tool = rawTool === 'trendline' || rawTool === 'trend-line' ? 'trend-line'
      : rawTool === 'horizontal' || rawTool === 'horizontal-line' ? 'horizontal-line'
      : rawTool === 'ray' ? 'ray'
      : merged.tool;
    if (tool) merged.tool = tool;
    return {
      ...merged,
      ...(name ? { __sireAction: name, type: name } : {}),
    };
  });
}

function skillContext(query: string) {
  const q = query.toLowerCase();
  const relevant = OPENALGO_SKILLS.filter(skill =>
    skill.name.includes('debug') ? /error|broken|wrong|blank|fail|replay|stale|issue|bug/.test(q) :
    skill.name.includes('indicator') ? /indicator|rsi|macd|ema|sma|supertrend|bollinger|adx|vwap/.test(q) :
    skill.name.includes('terminal') ? /terminal|trading|order|depth|replay|workspace|drawing|chart/.test(q) :
    skill.name.includes('plugin') ? /custom|plugin|drawing|primitive|chart type/.test(q) :
    skill.name.includes('setup') ? /setup|add chart|create chart/.test(q) : true
  );
  return relevant.length ? relevant : OPENALGO_SKILLS;
}

function resolveRequestedInstrument(query: string, runtimeContext?: RuntimeContext) {
  const available = Array.isArray(runtimeContext?.availableInstruments) ? runtimeContext.availableInstruments as Array<Record<string, unknown>> : [];
  if (!available.length) return null;
  const normalized = query.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const scored = available.map(item => {
    const symbol = String(item.symbol || '');
    const name = String(item.name || '');
    const ns = symbol.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const nn = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    let score = 0;
    if (normalized.includes(ns) || ns.includes(normalized)) score += 100;
    if (normalized.includes(nn) || nn.includes(normalized)) score += 90;
    const compact = normalized.replace(/^the/, '');
    if (compact === ns || compact === nn) score += 200;
    if (/boom1000/.test(normalized) && (/boom1000/.test(ns) || /boom1000/.test(nn))) score += 500;
    if (/boom500/.test(normalized) && (/boom500/.test(ns) || /boom500/.test(nn))) score += 500;
    if (/crash1000/.test(normalized) && (/crash1000/.test(ns) || /crash1000/.test(nn))) score += 500;
    if (/crash500/.test(normalized) && (/crash500/.test(ns) || /crash500/.test(nn))) score += 500;
    return { item, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  return scored[0]?.item || null;
}

function systemPrompt() {
  return [
    'You are the SIRE OpenAlgo-compatible AI Agent layer inside a shared AI council.',
    'You have a real OpenAlgo Charts runtime in the browser and SIRE market-data services behind the server.',
    'Use the supplied chart context as the source of truth for the current chart. Do not invent prices, bars, indicators, drawings, or chart state. Every AI in the council sees the same chartContext; analyze that shared evidence before proposing an action.', 'When the user names an instrument, resolve it against chartContext.availableInstruments and use the exact catalogue symbol; never substitute an unrelated instrument because it seems like an equivalent.',
    'You may request server tools, then use their results. You may also return chart actions for the browser to execute.',
    'Do not expose hidden chain-of-thought. Give concise visible summaries and a direct answer. When analysis is requested, return a compact evidence-based analysis object containing observations, key levels, trend/bias, confidence, and disagreements/unknowns; never fabricate missing values.',
    'You are one member of a council. Treat other agents as peer analysts: challenge unsupported conclusions, use their supplied findings when present, and make your own conclusion from the shared chart data. The final action must be based on verified chart state, not majority vote alone.',
    'Never claim an order was placed. Trading actions are proposals requiring explicit user approval; the browser never auto-submits a live order from an AI response.',
    'For chart changes, use exact public OpenAlgo Charts APIs and exact indicator ids when supplied by the skill catalogue. Prefer actions over telling the user to click manually.',
    'Time values are UTC seconds. Logical ranges are chart-local; never copy a logical index from another chart as though it were a timestamp.',
    'The installed SIRE chart imports indicators, draw, trade, transform and webgl tiers. Use the capabilities reported in chartContext.',
    'Return JSON only: {"answer":"...","analysis":{"observations":[],"trend":null,"levels":[],"confidence":null,"unknowns":[],"disagreements":[]},"actions":[...],"toolRequests":[{"name":"web_search","query":"..."}]}',
    'Allowed toolRequests: web_search, list_skills. Do not invent tool names.',
    'Allowed action names include: select_instrument, set_timeframe, set_chart_type, add_indicator, remove_indicator, add_price_line, add_drawing, set_visible_range, fit_chart, reset_scale, set_timezone, set_theme, open_indicator_picker, open_drawing_tools, open_settings, take_screenshot, export_svg, replay_start, replay_play, replay_pause, replay_step, replay_stop, propose_order.',
  ].join('\n');
}

async function callModel(messages: any[]) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key()}`, 'HTTP-Referer': 'https://sire-rwv9.onrender.com', 'X-Title': 'SIRE OpenAlgo Agent' },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.25, max_tokens: 2500 }),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
  if (!response.ok) throw new Error(data?.error?.message || `OpenRouter HTTP ${response.status}`);
  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((p: any) => p?.text || '').join('') : String(content || '');
  if (!text.trim()) throw new Error('OpenAI GPT agent returned no text');
  return { text: text.trim(), id: String(data?.id || '') };
}

export async function runOpenAlgoAgent(input: {
  query: string;
  history?: HistoryItem[];
  symbol?: string;
  runtimeContext?: RuntimeContext;
}) {
  const query = String(input.query || '').trim();
  if (!query) throw new Error('query is required');

  const context = {
    chartContext: input.runtimeContext || null,
    activeSymbol: input.symbol || null,
    relevantSkills: skillContext(query),
    allSkills: OPENALGO_SKILLS,
  };

  const messages: any[] = [
    { role: 'system', content: systemPrompt() },
    ...cleanHistory(input.history),
    { role: 'user', content: `USER REQUEST:\n${query}\n\nRUNTIME:\n${JSON.stringify(context)}` },
  ];

  const toolTrace: Array<Record<string, unknown>> = [];
  const actions: AgentAction[] = [];
  let answer = '';\n  let analysis: Record<string, unknown> | null = null;
  let responseId = '';

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const result = await callModel(messages);
    responseId = result.id || responseId;
    const parsed = extractJson(result.text);
    if (!parsed) {
      answer = result.text;
      break;
    }

    answer = String(parsed.answer || '').trim();
    actions.push(...normalizeActions(parsed.actions));

    const requests = Array.isArray(parsed.toolRequests) ? parsed.toolRequests : [];
    if (!requests.length) break;

    const results = [];
    for (const request of requests.slice(0, 4)) {
      const name = String(request?.name || '');
      try {
        if (name === 'web_search') {
          const value = await webSearch(String(request.query || query), 8);
          results.push({ name, ok: true, result: value });
        } else if (name === 'list_skills') {
          results.push({ name, ok: true, result: OPENALGO_SKILLS });
        } else {
          results.push({ name, ok: false, error: 'Unknown agent tool' });
        }
      } catch (error) {
        results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    toolTrace.push(...results.map(item => ({ name: item.name, ok: item.ok })));
    messages.push({ role: 'assistant', content: result.text });
    messages.push({ role: 'user', content: `TOOL RESULTS:\n${JSON.stringify(results)}\n\nContinue the agent task. If more tools are needed, request them. Otherwise return the final JSON.` });
  }

  // Deterministically correct instrument targeting before chart actions reach the browser.
  const requestedInstrument = resolveRequestedInstrument(query, input.runtimeContext);
  if (requestedInstrument) {
    const exactSymbol = String(requestedInstrument.symbol || '');
    if (exactSymbol) {
      const hasSelection = actions.some(a => String(a.__sireAction || a.type || '') === 'select_instrument' && String(a.symbol || '') === exactSymbol);
      if (!hasSelection) actions.unshift({ __sireAction: 'select_instrument', type: 'select_instrument', symbol: exactSymbol });
      for (const action of actions) {
        const type = String(action.__sireAction || action.type || '');
        if (type !== 'select_instrument' && ['set_timeframe','set_chart_type','add_indicator','remove_indicator','add_price_line','add_drawing','set_visible_range','fit_chart','reset_scale','set_timezone','set_theme','open_indicator_picker','open_drawing_tools','open_settings','take_screenshot','export_svg','replay_start','replay_play','replay_pause','replay_step','replay_stop'].includes(type)) {
          action.symbol = exactSymbol;
        }
      }
    }
  }

  // Deterministic chart-intent fallback: if the user explicitly asks for a trend line/current trend,
  // never rely on the model remembering to emit a drawing action. The browser resolves the real
  // first/last visible-bar anchors from the active OpenAlgo chart.
  if (/(trend[- ]?line|draw (the )?current trend|current trend)/i.test(query)) {
    const drawing = actions.find(a => String(a.__sireAction || a.type || '') === 'add_drawing');
    if (!drawing) {
      actions.push({ __sireAction: 'add_drawing', type: 'add_drawing', tool: 'trend-line', paneIndex: 0, resolveFromVisibleRange: true });
    }
    if (/\ball\s+instruments\b/i.test(query)) {
      const target = actions.find(a => String(a.__sireAction || a.type || '') === 'add_drawing');
      if (target) { target.scope = 'all_instruments'; target.resolveFromVisibleRange = true; }
    }
  }

  if (/\\ball\\s+instruments\\b/i.test(query) && /(trend[- ]?line|draw (the )?current trend|current trend)/i.test(query)) {
    answer = 'Applied the trend-line request to the current chart and queued it for the other instruments. Each instrument resolves its own visible candles so the line is not copied from another market.';
  }
  if (!answer) answer = 'I could not produce a final agent response.';
  return {
    text: answer.slice(0, MAX_OUTPUT_CHARS),\n    analysis,\n    councilContext: { sharedChartState: true, sourceOfTruth: 'openalgo-runtime', verifiedActionProtocol: true },
    responseId,
    model: MODEL,
    provider: 'OpenAI via OpenRouter',
    actions,
    toolTrace,
    skills: skillContext(query).map(x => x.name),
    agentMode: 'openalgo-compatible',
    error: undefined,
  };
}
