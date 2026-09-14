import { router, json, error, db } from '@appdeploy/sdk';
import { ensureDerivHistory, analyzeM30Trend, autonomousEnvironmentAudit } from './sire-autonomy';

type StoredTick = {
  symbol: string;
  quote: number;
  bid?: number;
  ask?: number;
  epoch: number;
  id?: string;
  source: 'Deriv';
};
type CoverageRecord = {
  symbol: string;
  storedTicks: number;
  oldestEpoch: number | null;
  newestEpoch: number | null;
  lastIngestAt: number | null;
  batches: number;
  lastBatchId?: string | null;
  lastIngestKey?: string | null;
  storageVersion?: string;
};
type BatchRecord = {
  symbol: string;
  source: string;
  firstEpoch: number;
  lastEpoch: number;
  count: number;
  ticks: StoredTick[];
  ingestKey: string;
  createdAt: number;
};
const COVERAGE_TABLE = 'sire_coverage_v1';
const BATCH_TABLE = 'sire_tick_batches_v1';
const MAX_TICKS = 500;
const MAX_STORED_TICKS_PER_BATCH = 250;
const DEDUPE_SCAN_PAGES = 5;
const STORAGE_VERSION = '1C';
const RESEARCH_TABLE = 'sire_research_experiments_v1';
const CATALOGUE_TABLE = 'sire_catalogue_v1';
const AI_MODELS = [
  { id: 'moonshotai/kimi-k3', name: 'Kimi K3', thinking: true },
  { id: 'deepseek-ai/deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro', reasoning_effort: 'max' },
] as const;
const OPENAI_MODEL = AI_MODELS[0].id;
const OPENAI_MAX_STEPS = 18;
const OPENAI_MAX_TICKS = 2500;
const OPENAI_MAX_ANALYSIS_TICKS = 25000;
const SIRE_MAX_STEPS = OPENAI_MAX_STEPS;
const SIRE_MAX_TICKS = OPENAI_MAX_TICKS;
const SIRE_MAX_ANALYSIS_TICKS = OPENAI_MAX_ANALYSIS_TICKS;
const BACKTEST_MAX_TICKS = 100000;
const DATA_PAGE_LIMIT = 100;
const PAPER_TABLE = 'sire_paper_trades_v1';
const DATA_MAX_PAGES = 120;

const OPENAI_SYSTEM_INSTRUCTION = `You are SIRE, the living intelligence operating inside the entire SIRE environment. SIRE is not merely a chat wrapper or a research form: you are the reasoning agent for the environment. You can inspect the complete SIRE workspace, instrument catalogue, persisted market data, current/latest market state, chart/runtime state, research memory, capabilities, and known gaps through your tools. You may choose instruments yourself when a task requires one. You must not make the user manually select an instrument before you can work. When the user says "check if you have everything you need", "inspect SIRE", "what do you have", "what is missing", or equivalent, inspect the whole environment rather than only the currently selected market. When a request is market-wide or the instrument is unspecified, decide which instrument(s) are relevant and use the catalogue/market-wide tools to find them. Treat the current chart as one window into SIRE, not the boundary of SIRE. If a live tick stream is updating on one selected market, that is current runtime state, not a restriction on your access to the rest of the environment. You should be able to inspect other instruments, their persisted data and catalogue records, and choose one when needed. Behave like a highly capable ChatGPT-style assistant: understand what the user means, reason about context, communicate naturally, remember the conversation, explain ideas clearly, ask useful follow-up questions when appropriate, and help the user think through problems. Do not behave like a command parser, workflow engine, research bot, or task-completion robot. A conversation is a conversation unless the user clearly asks you to perform an action. Treat statements such as "I'm thinking of something", "I have an idea", "what do you think?", jokes, opinions, greetings, uncertainty, corrections, and casual follow-ups as normal dialogue. Respond to the meaning of the message, not merely its surface wording. Do not invent a task when none exists. Do not say that you completed a task unless you actually performed an explicit requested action. Do not force research, tools, chart analysis, or market data into ordinary conversation. Use tools silently and selectively when they materially improve the answer, such as when the user asks about the current chart, live market information, historical data, or an explicit SIRE action. When a tool is useful, reason over its result and then give the user a clear natural-language answer rather than exposing internal tool mechanics. Maintain conversational continuity across turns and interpret short follow-ups using the preceding conversation. If the user changes their mind or corrects you, adapt immediately. For complex questions, think through the problem before answering and synthesize the useful conclusion. Never claim to have seen, researched, changed, or executed something that SIRE did not actually expose or execute. For market analysis, distinguish observed data from inference and do not present uncertain predictions as facts. Only execute chart/environment actions when the user clearly asks for them; discussion of an action is not authorization. You have at most ${OPENAI_MAX_STEPS} tool steps per request.

SIRE_INTELLIGENCE_CONTRACT_V2:
- Do not confuse a tool with a capability, a catalogue entry with usable data, persisted data with live data, or the selected chart with the whole SIRE environment.
- When asked whether SIRE has everything it needs, perform a real whole-environment audit before answering. Inspect the environment, catalogue, persisted market coverage, market-state coverage, research memory, analysis/backtesting capabilities, operational limits and known gaps. Report what is VERIFIED, what is PARTIAL, what is MISSING, and what is UNKNOWN. Never answer yes merely because a corresponding tool exists.
- When a research objective is complex, first determine the evidence required: relevant instrument universe, historical depth, sampling/tick resolution, data quality, hypotheses, alternative explanations, statistical tests, costs/frictions, validation windows, robustness tests and stopping criteria. Then acquire or inspect the available evidence before drawing conclusions.
- You may independently choose instruments from SIRE's catalogue when the user's objective does not name one. Do not ask the user to select an instrument merely because the UI has a selected chart. Use the chart only as UI context.
- For opportunity or exploit discovery, search for measurable statistical inefficiencies, structural effects, regime dependencies or other testable edges. Treat every apparent edge as a hypothesis until it survives quality checks, multiple comparisons awareness, out-of-sample testing and robustness checks. Never imply guaranteed profit.
- Think critically: actively look for counter-evidence, confounders, selection bias, leakage, overfitting, non-stationarity, multiple-testing effects and plausible alternative explanations. State confidence and uncertainty.
- Separate facts directly observed from tools, model knowledge, inference, hypotheses and unknowns. If required evidence is unavailable, say exactly what is missing and why it prevents a stronger conclusion.
- General conversation is first-class. If the user is chatting, asking an ordinary question, sharing an idea, joking or discussing a non-research subject, respond naturally like a capable general assistant. Do not force trading, research or tools into the conversation.
- Do not repeatedly introduce yourself as SIRE. Speak naturally. Mention the SIRE identity only when it is useful or the user asks.
- For explicit research requests, behave as an autonomous research partner: understand the goal, choose the necessary tools and instruments, execute the strongest available analysis, challenge your own conclusion, and explain the result clearly.
- For self-inspection requests, think system-wide rather than screen-wide. Include data coverage, depth and freshness limitations and computational/tool limits in the answer.
- Never claim web access, external data, live execution, broker control, complete historical coverage or any other capability unless an actual SIRE tool/integration verifies it.
- Never claim an action, analysis or research step was completed unless the corresponding tool actually completed it.
- Preserve conversational continuity and adapt immediately when the user corrects the goal.

${OPENAI_MAX_STEPS} tool steps are a per-turn execution budget, not evidence that the environment itself is complete.`;

const SIRE_FUNCTIONS = [
  { name: 'get_workspace', description: 'Inspect the current SIRE workspace. With no symbol, inspect the whole environment: instruments, stored market data, live/latest market state, runtime/chart state, research memory, tools, capabilities and known gaps. With a symbol, inspect that instrument in addition to the whole environment.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING', description: 'Optional instrument symbol. Omit it to inspect the entire SIRE environment.' } } } },
  { name: 'get_environment', description: 'Perform a whole-SIRE environment inventory. Use this when the user asks whether SIRE has everything it needs, what is available, what is missing, or asks SIRE to inspect itself.', parameters: { type: 'OBJECT', properties: { includeMarketState: { type: 'BOOLEAN' }, includeDataCoverage: { type: 'BOOLEAN' } } } },
  { name: 'find_instruments', description: 'Search the complete SIRE instrument catalogue and choose matching instruments autonomously. Do not require the user to select an instrument first.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, limit: { type: 'NUMBER' } }, required: ['query'] } },
  { name: 'get_all_market_snapshots', description: 'Inspect the latest known market state across every instrument for which SIRE currently has persisted market data. Use when the task is market-wide or no instrument was specified.', parameters: { type: 'OBJECT', properties: { limit: { type: 'NUMBER' } } } },
  { name: 'get_instrument', description: 'Inspect an instrument directly from the complete SIRE catalogue and its persisted data without requiring the user to select it in the UI.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' } }, required: ['symbol'] } },
  { name: 'get_catalogue', description: 'Inspect the available Deriv synthetic instrument catalogue.' },
  { name: 'get_ticks', description: 'Retrieve bounded historical raw Deriv ticks with exact epoch timestamps. Use analysis tools when raw ticks are not necessary.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, startEpoch: { type: 'NUMBER' }, endEpoch: { type: 'NUMBER' }, limit: { type: 'NUMBER' } }, required: ['symbol'] } },
  { name: 'analyze_ticks', description: 'Run quantitative analysis on stored Deriv ticks.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, operation: { type: 'STRING', description: 'summary, returns, returns_series, prices, volatility, rolling_volatility, drawdown, runs, autocorrelation, entropy, sequence, distribution, quantiles, histogram, zscore, bootstrap_mean, ohlc, quality, or features' }, startEpoch: { type: 'NUMBER' }, endEpoch: { type: 'NUMBER' }, limit: { type: 'NUMBER' }, sequenceLength: { type: 'NUMBER' }, reversalHorizon: { type: 'NUMBER' }, lag: { type: 'NUMBER' }, bins: { type: 'NUMBER' }, timeframeSeconds: { type: 'NUMBER' }, window: { type: 'NUMBER' } }, required: ['symbol', 'operation'] } },
  { name: 'check_quality', description: 'Check Deriv tick data quality, duplicates, non-monotonic timestamps, gaps and coverage.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, limit: { type: 'NUMBER' } }, required: ['symbol'] } },
  { name: 'compare_symbols', description: 'Compare two Deriv synthetic indices using price and return correlations and return statistics.', parameters: { type: 'OBJECT', properties: { symbolA: { type: 'STRING' }, symbolB: { type: 'STRING' }, startEpoch: { type: 'NUMBER' }, endEpoch: { type: 'NUMBER' }, limit: { type: 'NUMBER' } }, required: ['symbolA', 'symbolB'] } },
  { name: 'get_ohlc', description: 'Build OHLC candles from stored Deriv ticks.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, startEpoch: { type: 'NUMBER' }, endEpoch: { type: 'NUMBER' }, limit: { type: 'NUMBER' }, timeframeSeconds: { type: 'NUMBER' } }, required: ['symbol'] } },
  { name: 'get_latest', description: 'Inspect the latest stored Deriv quote and recent ticks for an instrument.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, }, required: ['symbol'] } },
  { name: 'replay_ticks', description: 'Retrieve a bounded historical tick sequence suitable for step-by-step replay research.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, startEpoch: { type: 'NUMBER' }, endEpoch: { type: 'NUMBER' }, limit: { type: 'NUMBER' } }, required: ['symbol'] } },
  { name: 'get_experiments', description: 'Retrieve previously saved SIRE research experiments for an instrument.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' } }, required: ['symbol'] } },
  { name: 'save_experiment', description: 'Persist a meaningful completed research finding and its methodology in SIRE research memory.', parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' }, symbol: { type: 'STRING' }, hypothesis: { type: 'STRING' }, methodology: { type: 'STRING' }, result: { type: 'OBJECT' } }, required: ['name', 'symbol', 'hypothesis', 'methodology', 'result'] } },
  { name: 'audit_gateway', description: 'Audit SIRE research capabilities, limits, provenance and operational coverage.' },
  { name: 'get_capabilities', description: 'Inspect the capabilities available inside the SIRE environment so you can decide which tool is appropriate.' },
  { name: 'backtest_strategy', description: 'Run a realistic historical strategy simulation using chronological data, with spread, slippage, delay, PnL, win rate, expectancy and drawdown.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, strategy: { type: 'OBJECT' }, startEpoch: { type: 'NUMBER' }, endEpoch: { type: 'NUMBER' }, limit: { type: 'NUMBER' } }, required: ['symbol', 'strategy'] } },
  { name: 'walk_forward_test', description: 'Run rolling train, validation and unseen-test windows over historical ticks.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, strategy: { type: 'OBJECT' }, trainTicks: { type: 'NUMBER' }, validationTicks: { type: 'NUMBER' }, testTicks: { type: 'NUMBER' }, stepTicks: { type: 'NUMBER' }, limit: { type: 'NUMBER' } }, required: ['symbol', 'strategy'] } },
  { name: 'robustness_test', description: 'Run permutation and bootstrap robustness checks against randomized baselines.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, strategy: { type: 'OBJECT' }, permutations: { type: 'NUMBER' }, limit: { type: 'NUMBER' } }, required: ['symbol', 'strategy'] } },
  { name: 'paper_trade', description: 'Record a paper-trading signal or simulated fill.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, action: { type: 'STRING' }, expectedEntry: { type: 'NUMBER' }, actualQuote: { type: 'NUMBER' }, spread: { type: 'NUMBER' }, executionDelayMs: { type: 'NUMBER' }, strategy: { type: 'STRING' }, result: { type: 'NUMBER' } }, required: ['symbol', 'action'] } },
  { name: 'paper_trade_report', description: 'Summarize paper-trading records for an instrument.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' } }, required: ['symbol'] } },
  { name: 'set_risk_limits', description: 'Persist research risk limits for paper-trading monitoring.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, maxExposure: { type: 'NUMBER' }, maxDailyLoss: { type: 'NUMBER' }, maxDrawdown: { type: 'NUMBER' }, maxConcentration: { type: 'NUMBER' } }, required: ['symbol'] } },
  { name: 'get_runtime_context', description: 'Inspect the current SIRE UI/chart state supplied by the user interface, including selected instrument, timeframe, chart mode, indicators and drawings.' },
  { name: 'get_market_snapshot', description: 'Get the latest live/persisted Deriv quote for a symbol when the user needs current market information.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' } }, required: ['symbol'] } },
  { name: 'get_chart_data', description: 'Get current chart candles/OHLC from SIRE persistent Deriv data for technical analysis.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, timeframeSeconds: { type: 'NUMBER' }, limit: { type: 'NUMBER' } }, required: ['symbol'] } },
  { name: 'select_instrument', description: 'Action: change the SIRE chart to a specific instrument. Use when the user explicitly asks to switch/select an instrument, or when autonomously choosing the most relevant instrument is necessary to fulfill an explicit task that did not name one. Never switch merely during casual conversation.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' } }, required: ['symbol'] } },
  { name: 'set_chart_view', description: 'Action: change chart view settings requested by the user. Use only for explicit chart-control requests.', parameters: { type: 'OBJECT', properties: { chartMode: { type: 'STRING', description: 'candles, line, or ticks' }, timeframe: { type: 'STRING' }, zoom: { type: 'NUMBER' }, autoScale: { type: 'BOOLEAN' }, showCrosshair: { type: 'BOOLEAN' } } } },
  { name: 'add_chart_marker', description: 'Action: place a marker at the current chart inspection/crosshair point. Use only when the user explicitly asks to mark the current point.', parameters: { type: 'OBJECT', properties: { label: { type: 'STRING' } } } },
  { name: 'ensure_market_data', description: 'Autonomously acquire missing historical Deriv tick data for any catalogue instrument. Use this before technical analysis when persisted coverage is insufficient. Never require the user to select the market in the UI first.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, ticks: { type: 'NUMBER' } }, required: ['symbol'] } },
  { name: 'analyze_m30_trend', description: 'Autonomously ensure enough Deriv history exists, construct M30 candles and return an evidence-based trend assessment. Use for requests such as checking the M30 trend of Boom 1000.', parameters: { type: 'OBJECT', properties: { symbol: { type: 'STRING' }, candles: { type: 'NUMBER' } }, required: ['symbol'] } },
];

function normalizeOpenAISchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeOpenAISchema);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = key === 'type' && typeof child === 'string' ? child.toLowerCase() : normalizeOpenAISchema(child);
  }
  return output;
}

const OPENAI_FUNCTION_TOOLS = SIRE_FUNCTIONS.map(tool => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: normalizeOpenAISchema(tool.parameters || { type: 'OBJECT', properties: {} }),
  },
}));

function openAIToolArgs(name: string, args: Record<string, unknown>, runtimeContext?: Record<string, unknown>) {
  if (name === 'get_workspace') return gptTool('workspace', args);
  if (name === 'get_environment') return gptTool('environment', args);
  if (name === 'find_instruments') return gptTool('find_instruments', args);
  if (name === 'get_all_market_snapshots') return gptTool('all_market_snapshots', args);
  if (name === 'get_instrument') return gptTool('instrument', args);
  if (name === 'get_catalogue') return gptTool('catalogue', args);
  if (name === 'get_ticks') return gptTool('ticks', { ...args, limit: Math.min(OPENAI_MAX_TICKS, Number(args.limit || 1000)) });
  if (name === 'analyze_ticks') return gptTool('analyze', { ...args, limit: Math.min(OPENAI_MAX_ANALYSIS_TICKS, Number(args.limit || 10000)) });
  if (name === 'check_quality') return gptTool('quality', { ...args, limit: Math.min(OPENAI_MAX_ANALYSIS_TICKS, Number(args.limit || 10000)) });
  if (name === 'compare_symbols') return gptTool('compare', { ...args, limit: Math.min(OPENAI_MAX_ANALYSIS_TICKS, Number(args.limit || 10000)) });
  if (name === 'get_ohlc') return gptTool('ohlc', { ...args, limit: Math.min(OPENAI_MAX_ANALYSIS_TICKS, Number(args.limit || 10000)) });
  if (name === 'get_latest') return gptTool('latest', args);
  if (name === 'replay_ticks') return gptTool('replay', { ...args, limit: Math.min(OPENAI_MAX_TICKS, Number(args.limit || 1000)) });
  if (name === 'get_experiments') return gptTool('experiments', args);
  if (name === 'save_experiment') return gptTool('save_experiment', args);
  if (name === 'audit_gateway') return gptTool('audit', args);
  if (name === 'get_capabilities') return { environment: 'SIRE', capabilities: ['natural conversation and context', 'live Deriv market data', 'historical ticks', 'OHLC/chart data', 'technical analysis', 'symbol search/catalogue', 'research/web capability', 'research memory', 'runtime/chart state', 'error-aware retries'], rule: 'Conversation comes first; tools and research are optional and should only be used when they improve the user experience.' };
  if (name === 'get_runtime_context') return runtimeContext || { available: false, reason: 'No live UI runtime context was supplied with this message.' };
  if (name === 'get_market_snapshot') return gptTool('latest', args);
  if (name === 'get_chart_data') return gptTool('ohlc', { ...args, limit: Math.min(OPENAI_MAX_ANALYSIS_TICKS, Number(args.limit || 500)) });
  if (name === 'backtest_strategy') return gptTool('backtest', { ...args, limit: Math.min(BACKTEST_MAX_TICKS, Number(args.limit || BACKTEST_MAX_TICKS)) });
  if (name === 'walk_forward_test') return gptTool('walk_forward', { ...args, limit: Math.min(BACKTEST_MAX_TICKS, Number(args.limit || BACKTEST_MAX_TICKS)) });
  if (name === 'robustness_test') return gptTool('robustness', { ...args, limit: Math.min(BACKTEST_MAX_TICKS, Number(args.limit || BACKTEST_MAX_TICKS)) });
  if (name === 'paper_trade') return gptTool('paper_trade', args);
  if (name === 'paper_trade_report') return gptTool('paper_trade_report', args);
  if (name === 'set_risk_limits') return gptTool('risk_limits', args);
  if (name === 'select_instrument') return { __sireAction: 'select_instrument', symbol: String(args.symbol || '').trim(), reason: 'The user explicitly requested the instrument or the instrument was autonomously selected as necessary to fulfill an explicit task.' };
  if (name === 'set_chart_view') return { __sireAction: 'set_chart_view', settings: args, reason: 'User explicitly requested a chart-view change.' };
  if (name === 'add_chart_marker') return { __sireAction: 'add_chart_marker', label: String(args.label || 'SIRE marker') };
  if (name === 'ensure_market_data') return ensureDerivHistory(String(args.symbol || '').trim(), Number(args.ticks || 10000));
  if (name === 'analyze_m30_trend') return analyzeM30Trend(String(args.symbol || '').trim(), Number(args.candles || 250));
  throw new Error(`Unknown SIRE function: ${name}`);
}

const SIRE_INTERACTION_TOOLS = OPENAI_FUNCTION_TOOLS;
const openaiToolArgs = openAIToolArgs;
const openaiRetryDelayMs = openAIRetryDelayMs;
const openaiTransportMessage = openAITransportMessage;

function openAIRetryDelayMs(response: Response | null, attempt: number) {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30000, Math.max(750, seconds * 1000));
    const retryDate = Date.parse(retryAfter);
    if (Number.isFinite(retryDate)) return Math.min(30000, Math.max(750, retryDate - Date.now()));
  }
  return Math.min(30000, 1500 * 2 ** attempt) + Math.floor(Math.random() * 750);
}

function openAITransportMessage(cause: unknown) {
  if (cause instanceof DOMException && cause.name === 'AbortError') return 'The NVIDIA connection timed out.';
  if (cause instanceof Error) return cause.message || 'The connection to NVIDIA was interrupted.';
  return 'The connection to NVIDIA was interrupted.';
}

let openAIInFlight: Promise<unknown> | null = null;

async function runOpenAIChatUnlocked(userQuery: string, symbol?: string, runtimeContext?: Record<string, unknown>, history: Array<{ role: string; text: string }> = []) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not configured.');
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: OPENAI_SYSTEM_INSTRUCTION },
    ...history.filter(item => item && typeof item.text === 'string').map(item => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.text })),
    { role: 'user', content: `${symbol ? `Current instrument: ${symbol}
` : ''}${runtimeContext ? `Current SIRE runtime context:
${JSON.stringify(runtimeContext)}
` : ''}
User message:
${userQuery}` },
  ];
  let steps = 0;
  const actions: Array<Record<string, unknown>> = [];
  const normalizedQuery = userQuery.trim();
  let modelIndex = 0;

  while (true) {
    const model = AI_MODELS[modelIndex];
    const requestBody: Record<string, unknown> = {
      model: model.id,
      messages,
      tools: OPENAI_FUNCTION_TOOLS,
      tool_choice: 'auto',
      temperature: 1,
      top_p: 0.95,
      max_tokens: 16384,
      ...(model.thinking ? { chat_template_kwargs: { thinking: true } } : {}),
      ...(model.reasoning_effort ? { reasoning_effort: model.reasoning_effort } : {}),
    };
    let response: Response | null = null;
    let payload: Record<string, unknown> = {};
    let lastTransportError: unknown = null;
    const maxAttempts = 3;
    let shouldFallback = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(120000),
        });
        const raw = await response.text();
        try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { payload = { raw: raw.slice(0, 2000) }; }
        if (response.ok) break;

        // Retired/unavailable or model-specific validation errors must never block SIRE.
        if ([404, 410, 422].includes(response.status)) {
          shouldFallback = true;
          break;
        }
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts - 1) break;
        await new Promise(resolve => setTimeout(resolve, openAIRetryDelayMs(response, attempt)));
      } catch (cause) {
        lastTransportError = cause;
        response = null;
        if (attempt === maxAttempts - 1) break;
        await new Promise(resolve => setTimeout(resolve, openAIRetryDelayMs(null, attempt)));
      }
    }

    if (shouldFallback || !response || !response.ok) {
      if (modelIndex < AI_MODELS.length - 1) {
        modelIndex += 1;
        continue;
      }
      if (!response) throw new Error(`${model.name} connection failed after ${maxAttempts} attempts: ${openAITransportMessage(lastTransportError)}`);
      const apiError = payload.error as Record<string, unknown> | undefined;
      const detail = apiError?.message ? String(apiError.message) : JSON.stringify(payload).slice(0, 2000);
      if (response.status === 429) throw new Error(`${model.name} rate limit remained active after ${maxAttempts} attempts. ${detail} Please retry shortly.`);
      if ([408, 500, 502, 503, 504].includes(response.status)) throw new Error(`${model.name} temporary service/network error (${response.status}) after ${maxAttempts} attempts. ${detail} Please retry shortly.`);
      throw new Error(`${model.name} HTTP ${response.status}: ${detail}`);
    }

    const choice = Array.isArray(payload.choices) ? payload.choices[0] as Record<string, unknown> | undefined : undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : [];
    if (!toolCalls.length) {
      const text = content || (actions.length ? 'Done — I completed that action. What would you like to do next?' : `I’m here. ${normalizedQuery ? 'Tell me more about what you’re thinking.' : 'What’s on your mind?'}`);
      return { text, steps, model: model.id, provider: model.name, responseId: typeof payload.id === 'string' ? payload.id : '', mode: actions.length ? 'action' : 'discussion', actions };
    }
    if (steps + toolCalls.length > OPENAI_MAX_STEPS) throw new Error(`Exceeded maximum SIRE tool steps limit (${OPENAI_MAX_STEPS}).`);
    messages.push({ role: 'assistant', content: content || '', tool_calls: toolCalls });
    for (const call of toolCalls) {
      const callId = String(call.id || '');
      const fn = call.function as Record<string, unknown> | undefined;
      const name = String(fn?.name || '');
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(String(fn?.arguments || '{}')) as Record<string, unknown>; } catch { args = {}; }
      try {
        const result = await openAIToolArgs(name, args, runtimeContext);
        if (result && typeof result === 'object' && '__sireAction' in result) actions.push(result as Record<string, unknown>);
        messages.push({ role: 'tool', tool_call_id: callId, content: JSON.stringify(result) });
      } catch (cause) {
        messages.push({ role: 'tool', tool_call_id: callId, content: JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) }) });
      }
      steps += 1;
    }
  }
}

function isCasualGreeting(query: string) {
  const normalized = query.trim().toLowerCase().replace(/[!?.,]+$/g, '').trim();
  return /^(hi|hello|hey|hey there|hello there|good morning|good afternoon|good evening|how are you|how's it going|how is it going)$/.test(normalized);
}

async function runSIREConversation(userQuery: string, symbol?: string, runtimeContext?: Record<string, unknown>, history: Array<{ role: string; text: string }> = []) {
  if (openAIInFlight) throw new Error('A SIRE AI turn is already running. Please wait for it to finish.');
  return runOpenAIChatUnlocked(userQuery, symbol, runtimeContext, history);
}

function validTick(value: unknown): value is StoredTick {
  if (!value || typeof value !== 'object') return false;
  const tick = value as Record<string, unknown>;
  return (
    tick.source === 'Deriv' &&
    typeof tick.symbol === 'string' &&
    tick.symbol.length > 0 &&
    Number.isFinite(Number(tick.quote)) &&
    Number.isFinite(Number(tick.epoch))
  );
}
function keyFor(tick: StoredTick) {
  return `${tick.symbol}:${tick.epoch}:${tick.quote}`;
}
function normalizeTicks(symbol: string, ticks: StoredTick[]) {
  return Array.from(new Map(
    ticks
      .map(tick => ({ ...tick, symbol, source: 'Deriv' as const }))
      .sort((a, b) => a.epoch - b.epoch)
      .map(tick => [keyFor(tick), tick])
  ).values());
}
async function recentPersistedTicks(symbol: string) {
  const found = new Set<string>();
  let nextToken: string | undefined;
  for (let page = 0; page < DEDUPE_SCAN_PAGES; page += 1) {
    const response = await db.list<BatchRecord>(BATCH_TABLE, {
      limit: DATA_PAGE_LIMIT,
      ...(nextToken ? { nextToken } : {}),
    });
    for (const batch of response.items) {
      if (batch.symbol !== symbol) continue;
      for (const tick of batch.ticks) found.add(keyFor(tick));
    }
    nextToken = response.nextToken;
    if (!nextToken) break;
  }
  return found;
}
function batchKey(symbol: string, ticks: StoredTick[]) {
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  return `${symbol}:${first.epoch}:${last.epoch}:${ticks.length}`;
}
async function findCoverage(symbol: string) {
  const { items } = await db.list<CoverageRecord>(COVERAGE_TABLE, {
    limit: 100,
  });
  return items.find(item => item.symbol === symbol) || null;
}
async function updateCoverage(symbol: string, ticks: StoredTick[], batchId: string, ingestKey: string) {
  const current = await findCoverage(symbol);
  const epochs = ticks.map(tick => tick.epoch);
  const next: CoverageRecord = {
    symbol,
    storedTicks: (current?.storedTicks || 0) + ticks.length,
    oldestEpoch: Math.min(current?.oldestEpoch ?? Infinity, ...epochs),
    newestEpoch: Math.max(current?.newestEpoch ?? -Infinity, ...epochs),
    lastIngestAt: Date.now(),
    batches: (current?.batches || 0) + 1,
    lastBatchId: batchId,
    lastIngestKey: ingestKey,
    storageVersion: STORAGE_VERSION,
  };
  const rows = await db.list<CoverageRecord>(COVERAGE_TABLE, { limit: 100 });
  const record = rows.items.find(item => item.symbol === symbol);
  if (record) await db.update(COVERAGE_TABLE, [{ id: record.id, record: next }]);
  else await db.add(COVERAGE_TABLE, [next]);
}
function numericTicks(batches: BatchRecord[], symbol: string, start?: number, end?: number, limit = 100000) {
  return Array.from(new Map(
    batches.filter(batch => batch.symbol === symbol).flatMap(batch => batch.ticks)
      .filter(tick => (start === undefined || tick.epoch >= start) && (end === undefined || tick.epoch <= end))
      .map(tick => [keyFor(tick), tick])
  ).values()).sort((a, b) => a.epoch - b.epoch).slice(-Math.min(100000, limit));
}
function stats(values: number[]) {
  if (!values.length) return { count: 0, min: null, max: null, mean: null, stdev: null, p50: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  return { count: values.length, min: sorted[0], max: sorted[sorted.length - 1], mean, stdev: Math.sqrt(variance), p50: percentile(.5), p95: percentile(.95) };
}
function returns(ticks: StoredTick[]) { return ticks.slice(1).map((tick, i) => tick.quote - ticks[i].quote).filter(Number.isFinite); }
function autocorrelation(values: number[], lag: number) {
  if (values.length <= lag || !values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let num = 0; let den = 0;
  for (let i = 0; i < values.length; i += 1) den += (values[i] - mean) ** 2;
  for (let i = lag; i < values.length; i += 1) num += (values[i] - mean) * (values[i - lag] - mean);
  return den ? num / den : null;
}
function entropy(values: number[], bins: number) {
  if (!values.length) return null;
  const min = Math.min(...values); const max = Math.max(...values);
  if (min === max) return 0;
  const counts = new Array(Math.max(2, bins)).fill(0) as number[];
  for (const value of values) { const index = Math.min(counts.length - 1, Math.floor(((value - min) / (max - min)) * counts.length)); counts[index] += 1; }
  return counts.reduce((sum, count) => count ? sum - (count / values.length) * Math.log2(count / values.length) : sum, 0);
}
function runStats(values: number[]) {
  let up = 0; let down = 0; let flat = 0; const runs: number[] = []; let current = 0; let sign = 0;
  for (const value of values) { const next = value > 0 ? 1 : value < 0 ? -1 : 0; if (next > 0) up += 1; else if (next < 0) down += 1; else flat += 1; if (next === sign && next !== 0) current += 1; else { if (current) runs.push(current); current = next === 0 ? 0 : 1; sign = next; } }
  if (current) runs.push(current);
  return { up, down, flat, longestRun: runs.length ? Math.max(...runs) : 0 };
}
async function allBatches(symbol?: string, maxPages = DATA_MAX_PAGES) {
  const batches: BatchRecord[] = []; let nextToken: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await db.list<BatchRecord>(BATCH_TABLE, { limit: DATA_PAGE_LIMIT, ...(nextToken ? { nextToken } : {}) });
    batches.push(...response.items.filter(item => !symbol || item.symbol === symbol));
    nextToken = response.nextToken;
    if (!nextToken) break;
  }
  return batches;
}

async function loadTicks(symbol: string, start?: number, end?: number, limit = 10000) {
  const target = Math.min(Math.max(1, limit), SIRE_MAX_ANALYSIS_TICKS);
  const batches: BatchRecord[] = [];
  let nextToken: string | undefined;
  let matchedCount = 0;
  for (let page = 0; page < DATA_MAX_PAGES; page += 1) {
    const response = await db.list<BatchRecord>(BATCH_TABLE, { limit: DATA_PAGE_LIMIT, ...(nextToken ? { nextToken } : {}) });
    const matching = response.items.filter(item => item.symbol === symbol);
    batches.push(...matching);
    matchedCount += matching.reduce((sum, batch) => sum + batch.count, 0);
    nextToken = response.nextToken;
    if (!nextToken || matchedCount >= target) break;
  }
  return numericTicks(batches, symbol, start, end, target);
}
function pearson(a: number[], b: number[]) { if (a.length !== b.length || a.length < 2) return null; const ma = a.reduce((x, y) => x + y, 0) / a.length; const mb = b.reduce((x, y) => x + y, 0) / b.length; let num = 0; let da = 0; let db = 0; for (let i = 0; i < a.length; i += 1) { const xa = a[i] - ma; const xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; } return da && db ? num / Math.sqrt(da * db) : null; }
function quantiles(values: number[], ps = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99]) { const sorted = [...values].sort((a, b) => a - b); if (!sorted.length) return {}; return Object.fromEntries(ps.map(p => [String(p), sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]])); }
function histogram(values: number[], bins = 20) { if (!values.length) return []; const count = Math.max(2, Math.min(200, Math.floor(bins))); const min = Math.min(...values); const max = Math.max(...values); if (min === max) return [{ low: min, high: max, count: values.length }]; const width = (max - min) / count; const rows = Array.from({ length: count }, (_, i) => ({ low: min + i * width, high: i === count - 1 ? max : min + (i + 1) * width, count: 0 })); for (const value of values) rows[Math.min(count - 1, Math.floor((value - min) / width))].count += 1; return rows; }
function zscore(values: number[]) { const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; const sd = stats(values).stdev || 0; return values.map(value => sd ? (value - mean) / sd : 0); }
function bootstrapMean(values: number[], iterations = 1000) { if (!values.length) return { mean: null, lower95: null, upper95: null, iterations: 0 }; const n = Math.min(5000, Math.max(100, Math.floor(iterations))); const means: number[] = []; let state = 2166136261; for (let i = 0; i < n; i += 1) { let sum = 0; for (let j = 0; j < values.length; j += 1) { state = Math.imul(state ^ (j + i + 1), 16777619); state ^= state >>> 13; const index = Math.abs(state) % values.length; sum += values[index]; } means.push(sum / values.length); } const q = quantiles(means, [.025, .5, .975]); return { mean: values.reduce((a, b) => a + b, 0) / values.length, lower95: q['0.025'] ?? null, upper95: q['0.975'] ?? null, iterations: n }; }
function ohlc(ticks: StoredTick[], seconds: number) { const buckets = new Map<number, StoredTick[]>(); for (const tick of ticks) { const key = Math.floor(tick.epoch / seconds) * seconds; const row = buckets.get(key) || []; row.push(tick); buckets.set(key, row); } return Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([epoch, row]) => ({ epoch, open: row[0].quote, high: Math.max(...row.map(t => t.quote)), low: Math.min(...row.map(t => t.quote)), close: row[row.length - 1].quote, tickCount: row.length })); }
function quality(ticks: StoredTick[]) { const sorted = [...ticks].sort((a, b) => a.epoch - b.epoch); let duplicates = 0; let nonMonotonic = 0; const gaps: number[] = []; for (let i = 1; i < sorted.length; i += 1) { const dt = sorted[i].epoch - sorted[i - 1].epoch; if (dt === 0 && sorted[i].quote === sorted[i - 1].quote) duplicates += 1; if (dt < 0) nonMonotonic += 1; if (dt > 0) gaps.push(dt); } return { count: sorted.length, duplicates, nonMonotonic, timeGapStats: stats(gaps), firstEpoch: sorted[0]?.epoch || null, lastEpoch: sorted[sorted.length - 1]?.epoch || null }; }
async function latestMarketSnapshots(limit = 1000) {
  const batches = await allBatches(undefined, DATA_MAX_PAGES);
  const latest = new Map<string, StoredTick>();
  for (const batch of batches) {
    for (const tick of batch.ticks) {
      const current = latest.get(tick.symbol);
      if (!current || tick.epoch > current.epoch) latest.set(tick.symbol, tick);
    }
  }
  return Array.from(latest.values()).sort((a, b) => b.epoch - a.epoch).slice(0, Math.min(5000, Math.max(1, limit)));
}

async function environmentSnapshot(options: Record<string, unknown> = {}) {
  const includeMarketState = options.includeMarketState !== false;
  const includeDataCoverage = options.includeDataCoverage !== false;
  const [catalogueRows, experimentRows] = await Promise.all([
    db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 }),
    db.list<Record<string, unknown>>(RESEARCH_TABLE, { limit: 1000 }),
  ]);
  const catalogue = catalogueRows.items;
  const batches = await allBatches(undefined, DATA_MAX_PAGES);
  const symbolsWithData = new Set(batches.map(batch => batch.symbol));
  const coverageBySymbol = new Map<string, CoverageRecord>();
  for (const batch of batches) {
    const prior = coverageBySymbol.get(batch.symbol);
    const epochs = batch.ticks.map(tick => tick.epoch);
    const next: CoverageRecord = {
      symbol: batch.symbol,
      storedTicks: (prior?.storedTicks || 0) + batch.count,
      oldestEpoch: Math.min(prior?.oldestEpoch ?? Infinity, ...epochs),
      newestEpoch: Math.max(prior?.newestEpoch ?? -Infinity, ...epochs),
      lastIngestAt: Math.max(prior?.lastIngestAt || 0, batch.createdAt),
      batches: (prior?.batches || 0) + 1,
    };
    coverageBySymbol.set(batch.symbol, next);
  }
  const snapshots = includeMarketState ? await latestMarketSnapshots(5000) : [];
  const symbols = Array.from(new Set(catalogue.map(row => String(row.symbol || row.underlying_symbol || '')).filter(Boolean)));
  const missingData = symbols.filter(symbol => !symbolsWithData.has(symbol));
  return {
    environment: 'SIRE',
    source: 'Deriv',
    inspectedAt: Date.now(),
    catalogue: { count: catalogue.length, symbols },
    persistedData: { instrumentCountWithTicks: symbolsWithData.size, batchCount: batches.length, coverage: includeDataCoverage ? Array.from(coverageBySymbol.values()) : undefined, instrumentsWithoutPersistedTicks: missingData },
    marketState: includeMarketState ? { latestKnownSnapshots: snapshots, snapshotCount: snapshots.length } : undefined,
    researchMemory: { experimentCount: experimentRows.items.length, experiments: experimentRows.items },
    capabilities: { naturalConversation: true, wholeEnvironmentInspection: true, instrumentSelection: true, catalogueSearch: true, liveAndLatestMarketAccess: true, historicalTicks: true, OHLC: true, quantitativeAnalysis: true, replay: true, comparison: true, researchMemory: true, chartRuntimeContext: true, chartActions: true, realtimeMarketIngestion: true },
    knownGaps: [
      'Persisted tick history exists only for instruments that SIRE has actually ingested; catalogue presence does not imply historical data coverage.',
      'The current UI market stream is attached to the selected chart, while SIRE intelligence can inspect persisted data for other instruments and can request an instrument change when necessary.',
      'External services not exposed through SIRE tools are not assumed to exist; SIRE reports only capabilities it can actually inspect or execute.'
    ],
  };
}

type StrategySpec = { signal?: 'reversal_after_streak' | 'momentum_after_streak' | 'direction'; streakLength?: number; direction?: 'long' | 'short' | 'both'; exitTicks?: number; stopLoss?: number; takeProfit?: number; stake?: number; exposure?: number; spread?: number; slippage?: number; delayTicks?: number };

function strategySignal(diff: number[], index: number, strategy: StrategySpec) {
  const streak = Math.max(1, Math.floor(strategy.streakLength || 3));
  if (index < streak) return 0;
  const lastSign = diff[index - 1] > 0 ? 1 : diff[index - 1] < 0 ? -1 : 0;
  if (!lastSign) return 0;
  for (let j = index - streak; j < index; j += 1) { const sign = diff[j] > 0 ? 1 : diff[j] < 0 ? -1 : 0; if (sign !== lastSign) return 0; }
  let side = (strategy.signal || 'reversal_after_streak') === 'momentum_after_streak' ? lastSign : -lastSign;
  if ((strategy.signal || 'reversal_after_streak') === 'direction') side = lastSign;
  if (strategy.direction === 'long' && side < 0) return 0;
  if (strategy.direction === 'short' && side > 0) return 0;
  return side;
}

function simulateBacktest(ticks: StoredTick[], strategy: StrategySpec) {
  const diff = returns(ticks); const stake = Math.max(0.000001, Number(strategy.stake || 1)); const exposure = Math.max(0.000001, Number(strategy.exposure || 1)); const spread = Math.max(0, Number(strategy.spread || 0)); const slippage = Math.max(0, Number(strategy.slippage || 0)); const delayTicks = Math.max(0, Math.floor(strategy.delayTicks || 0)); const exitTicks = Math.max(1, Math.floor(strategy.exitTicks || 20)); const stopLoss = Math.max(0, Number(strategy.stopLoss || 0)); const takeProfit = Math.max(0, Number(strategy.takeProfit || 0)); const trades: Array<Record<string, unknown>> = []; let equity = 0; let peak = 0; let maxDrawdown = 0;
  for (let i = 1; i < ticks.length - delayTicks - 1; i += 1) { const side = strategySignal(diff, i, strategy); if (!side) continue; const entryIndex = i + delayTicks; const entryRaw = ticks[entryIndex]?.quote; if (!Number.isFinite(entryRaw)) continue; const entry = entryRaw + side * (spread / 2 + slippage); let exitIndex = Math.min(ticks.length - 1, entryIndex + exitTicks); let exit = ticks[exitIndex]?.quote; if (!Number.isFinite(exit)) continue; let reason = 'time_exit'; for (let j = entryIndex + 1; j <= exitIndex; j += 1) { const move = side * (ticks[j].quote - entry); if (takeProfit > 0 && move >= takeProfit) { exitIndex = j; exit = ticks[j].quote - side * slippage; reason = 'take_profit'; break; } if (stopLoss > 0 && move <= -stopLoss) { exitIndex = j; exit = ticks[j].quote + side * slippage; reason = 'stop_loss'; break; } } const pnl = side * (exit - entry) * stake * exposure; equity += pnl; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); trades.push({ entryEpoch: ticks[entryIndex].epoch, exitEpoch: ticks[exitIndex].epoch, side: side > 0 ? 'long' : 'short', entry, exit, pnl, reason, holdTicks: exitIndex - entryIndex }); i = exitIndex; }
  const pnls = trades.map(t => Number(t.pnl)); const wins = pnls.filter(v => v > 0).length; const losses = pnls.filter(v => v < 0).length; const total = pnls.reduce((a, b) => a + b, 0); const grossWin = pnls.filter(v => v > 0).reduce((a, b) => a + b, 0); const grossLoss = Math.abs(pnls.filter(v => v < 0).reduce((a, b) => a + b, 0)); return { strategy, sampleTicks: ticks.length, trades: trades.length, wins, losses, winRate: trades.length ? wins / trades.length : 0, totalPnl: total, expectancy: pnls.length ? total / pnls.length : 0, profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0, maxDrawdown, endingEquity: equity, baselineBuyAndHold: ticks.length > 1 ? ticks[ticks.length - 1].quote - ticks[0].quote : 0, trades: trades.slice(0, 10000), costModel: { spread, slippage, delayTicks }, lookAheadProtection: 'Signals are formed from ticks strictly before simulated execution; delay is applied forward.' };
}

function seededShuffle(values: number[], seed = 17) { const out = [...values]; let state = seed >>> 0; for (let i = out.length - 1; i > 0; i -= 1) { state = (Math.imul(state ^ (i + 1), 1664525) + 1013904223) >>> 0; const j = state % (i + 1); [out[i], out[j]] = [out[j], out[i]]; } return out; }

function featureRows(ticks: StoredTick[]) { return ticks.map((tick, i) => { const previous = ticks[i - 1]; const delta = previous ? tick.quote - previous.quote : null; return { symbol: tick.symbol, epoch: tick.epoch, quote: tick.quote, delta, absDelta: delta === null ? null : Math.abs(delta), direction: delta === null ? 'F' : delta > 0 ? 'U' : delta < 0 ? 'D' : 'F', secondsSincePrevious: previous ? tick.epoch - previous.epoch : null }; }); }
function analyzeTicks(ticks: StoredTick[], operation: string, options: Record<string, number | string>) {
  const diff = returns(ticks); const values = operation === 'returns' || operation === 'volatility' || operation === 'autocorrelation' || operation === 'entropy' || operation === 'runs' ? diff : ticks.map(t => t.quote);
  if (operation === 'summary' || operation === 'distribution') return { operation, quote: stats(ticks.map(t => t.quote)), returns: stats(diff), returnQuantiles: quantiles(diff), returnHistogram: histogram(diff, Number(options.bins || 20)) };
  if (operation === 'quantiles') return { operation, quote: quantiles(ticks.map(t => t.quote)), returns: quantiles(diff) };
  if (operation === 'histogram') return { operation, bins: Number(options.bins || 20), returns: histogram(diff, Number(options.bins || 20)) };
  if (operation === 'zscore') return { operation, values: zscore(diff) };
  if (operation === 'bootstrap_mean') return { operation, ...bootstrapMean(diff, Number(options.iterations || 1000)) };
  if (operation === 'ohlc') return { operation, timeframeSeconds: Math.max(1, Number(options.timeframeSeconds || 60)), candles: ohlc(ticks, Math.max(1, Number(options.timeframeSeconds || 60))) };
  if (operation === 'quality') return { operation, ...quality(ticks) };
  if (operation === 'features') return { operation, features: featureRows(ticks) };
  if (operation === 'returns_series') return { operation, returns: diff };
  if (operation === 'prices') return { operation, prices: ticks.map(t => ({ epoch: t.epoch, quote: t.quote })) };
  if (operation === 'rolling_volatility') { const window = Math.max(2, Number(options.window || 20)); const rows = diff.map((_, i) => i + 1 < window ? null : stats(diff.slice(i + 1 - window, i + 1)).stdev); return { operation, window, values: rows }; }
  if (operation === 'returns') return { operation, returns: stats(diff) };
  if (operation === 'volatility') return { operation, returnStats: stats(diff), volatility: stats(diff.map(value => Math.abs(value))), annualizationNotApplied: true };
  if (operation === 'drawdown') { let peak = -Infinity; let equity = 0; let maxDrawdown = 0; for (const value of diff) { equity += value; peak = Math.max(peak, equity); maxDrawdown = Math.min(maxDrawdown, equity - peak); } return { operation, maxDrawdown, endingReturn: equity }; }
  if (operation === 'runs') return { operation, ...runStats(diff) };
  if (operation === 'autocorrelation') return { operation, lag: Number(options.lag || 1), value: autocorrelation(values, Math.max(1, Number(options.lag || 1))) };
  if (operation === 'entropy') return { operation, bins: Number(options.bins || 10), entropyBits: entropy(values, Math.max(2, Number(options.bins || 10))) };
  if (operation === 'sequence') { const length = Math.max(2, Number(options.sequenceLength || 37)); const horizon = Math.max(1, Number(options.reversalHorizon || 10)); const signs = diff.map(v => v > 0 ? 'U' : v < 0 ? 'D' : 'F'); const counts = new Map<string, number>(); const reversals = new Map<string, number>(); for (let i = length; i < signs.length - horizon; i += 1) { const seq = signs.slice(i - length, i).join(''); counts.set(seq, (counts.get(seq) || 0) + 1); const last = signs[i - 1]; const future = signs.slice(i, i + horizon); const reversal = future.some(s => (last === 'U' && s === 'D') || (last === 'D' && s === 'U')); if (reversal) reversals.set(seq, (reversals.get(seq) || 0) + 1); } const rows = Array.from(counts.entries()).map(([sequence, sampleCount]) => ({ sequence, sampleCount, reversalCount: reversals.get(sequence) || 0, conditionalProbability: (reversals.get(sequence) || 0) / sampleCount })).sort((a, b) => b.conditionalProbability - a.conditionalProbability || b.sampleCount - a.sampleCount).slice(0, 50); const baseline = signs.slice(0, -horizon).reduce((n, s, i) => n + signs.slice(i + 1, i + 1 + horizon).some(f => (s === 'U' && f === 'D') || (s === 'D' && f === 'U')) ? 1 : 0, 0) / Math.max(1, signs.length - horizon); return { operation, sequenceLength: length, reversalHorizon: horizon, sampleCount: counts.size, baselineReversalProbability: baseline, topSequences: rows }; }
  return { operation, unsupported: true, availableOperations: ['summary', 'returns', 'returns_series', 'prices', 'volatility', 'rolling_volatility', 'drawdown', 'runs', 'autocorrelation', 'entropy', 'sequence', 'distribution', 'quantiles', 'histogram', 'zscore', 'bootstrap_mean', 'ohlc', 'quality', 'features'] };
}
async function researchContext(symbol: string) {
  const coverage = await findCoverage(symbol);
  const recentTicks = await loadTicks(symbol, undefined, undefined, 100);
  return { symbol, source: 'Deriv', coverage, availableTicks: coverage?.storedTicks || recentTicks.length, oldestEpoch: coverage?.oldestEpoch ?? recentTicks[0]?.epoch ?? null, newestEpoch: coverage?.newestEpoch ?? recentTicks[recentTicks.length - 1]?.epoch ?? null, operations: ['summary', 'returns', 'returns_series', 'prices', 'volatility', 'rolling_volatility', 'drawdown', 'runs', 'autocorrelation', 'entropy', 'sequence', 'distribution', 'ohlc', 'quality', 'features'], replay: true, rawTicks: true, comparison: true, latest: recentTicks[recentTicks.length - 1] || null, provenance: 'Genuine Deriv tick data stored by SIRE' };
}

const GPT_TOOL_MANIFEST = {
  name: 'SIRE Research Gateway',
  version: 1,
  source: 'Deriv',
  purpose: 'Programmatic research access to SIRE Synthetic Index data without UI interaction.',
  primaryExample: 'BOOM1000',
  tools: [
    { name: 'workspace', method: 'GET', path: '/api/sire/gpt/workspace', required: [], optional: ['symbol'] },
    { name: 'research', method: 'POST', path: '/api/sire/gpt/research', required: ['steps'], optional: ['symbol'] },
    { name: 'audit', method: 'GET', path: '/api/sire/gpt/audit', required: [] },
    { name: 'catalogue', method: 'GET', path: '/api/sire/gpt/catalogue', required: [] },
    { name: 'latest', method: 'GET', path: '/api/sire/gpt/latest', required: ['symbol'] },
    { name: 'ticks', method: 'GET', path: '/api/sire/history', required: ['symbol'], optional: ['limit'] },
    { name: 'analyze', method: 'GET', path: '/api/sire/gpt/query', required: ['symbol'], optional: ['operation', 'startEpoch', 'endEpoch', 'limit', 'sequenceLength', 'reversalHorizon', 'lag', 'bins', 'includeTicks'] },
    { name: 'compare', method: 'GET', path: '/api/sire/gpt/compare', required: ['symbolA', 'symbolB'], optional: ['startEpoch', 'endEpoch', 'limit'] },
    { name: 'ohlc', method: 'GET', path: '/api/sire/gpt/ohlc', required: ['symbol'], optional: ['startEpoch', 'endEpoch', 'limit', 'timeframeSeconds'] },
    { name: 'quality', method: 'GET', path: '/api/sire/gpt/quality', required: ['symbol'], optional: ['limit'] },
    { name: 'replay', method: 'GET', path: '/api/sire/gpt/replay', required: ['symbol'], optional: ['startEpoch', 'endEpoch', 'limit'] },
    { name: 'save_experiment', method: 'POST', path: '/api/sire/gpt/experiments', required: ['name', 'symbol'], optional: ['hypothesis', 'methodology', 'result'] },
    { name: 'experiments', method: 'GET', path: '/api/sire/gpt/experiments', required: ['symbol'] },
  ],
  operations: ['summary', 'returns', 'returns_series', 'prices', 'volatility', 'rolling_volatility', 'drawdown', 'runs', 'autocorrelation', 'entropy', 'sequence', 'distribution', 'ohlc', 'quality', 'features'],
  guarantees: ['exact epoch timestamps', 'persistent Deriv source provenance', 'bounded raw tick access', 'configurable analysis parameters', 'historical replay', 'persistent research memory'],
};

async function gptTool(tool: string, args: Record<string, unknown>) {
  const symbol = String(args.symbol || '');
  if (tool === 'workspace') {
    const environment = await environmentSnapshot(args);
    const context = symbol ? await researchContext(symbol) : null;
    return { ...environment, selectedInstrument: context };
  }
  if (tool === 'environment') return environmentSnapshot(args);
  if (tool === 'find_instruments') {
    const query = String(args.query || '').trim().toLowerCase();
    if (!query) return { source: 'Deriv', instruments: [] };
    const limit = Math.min(500, Math.max(1, Number(args.limit || 50)));
    const rows = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 });
    const instruments = rows.items.filter(row => `${row.symbol || ''} ${row.name || ''} ${row.display_name || ''} ${row.market || ''} ${row.submarket || ''} ${row.subgroup || ''}`.toLowerCase().includes(query)).slice(0, limit);
    return { source: 'Deriv', query, count: instruments.length, instruments };
  }
  if (tool === 'all_market_snapshots') return { source: 'Deriv', snapshots: await latestMarketSnapshots(Math.min(5000, Number(args.limit || 1000))) };
  if (tool === 'instrument') {
    if (!symbol) throw new Error('symbol is required');
    const rows = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 });
    const instrument = rows.items.find(row => String(row.symbol || row.underlying_symbol || '') === symbol);
    const context = await researchContext(symbol);
    return { source: 'Deriv', instrument: instrument || null, context };
  }
  if (tool === 'catalogue') { const rows = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 }); return { source: 'Deriv', instruments: rows.items }; }
  if (tool === 'latest') { const ticks = await loadTicks(symbol, undefined, undefined, 10); return { source: 'Deriv', symbol, latest: ticks[ticks.length - 1] || null, recent: ticks }; }
  if (tool === 'ticks') { const limit = Math.min(SIRE_MAX_TICKS, Number(args.limit || 1000)); const ticks = await loadTicks(symbol, args.startEpoch === undefined ? undefined : Number(args.startEpoch), args.endEpoch === undefined ? undefined : Number(args.endEpoch), limit); return { source: 'Deriv', symbol, ticks, count: ticks.length }; }
  if (tool === 'analyze') { const limit = Math.min(SIRE_MAX_ANALYSIS_TICKS, Number(args.limit || 10000)); const ticks = await loadTicks(symbol, args.startEpoch === undefined ? undefined : Number(args.startEpoch), args.endEpoch === undefined ? undefined : Number(args.endEpoch), limit); const result = analyzeTicks(ticks, String(args.operation || 'summary'), { sequenceLength: Number(args.sequenceLength || 37), reversalHorizon: Number(args.reversalHorizon || 10), lag: Number(args.lag || 1), bins: Number(args.bins || 10), timeframeSeconds: Number(args.timeframeSeconds || 60), window: Number(args.window || 20) }); return { source: 'Deriv', symbol, sampleCount: ticks.length, result, provenance: 'SIRE persistent Deriv tick store' }; }
  if (tool === 'backtest') { if (!symbol) throw new Error('symbol is required'); const strategy = (args.strategy || {}) as StrategySpec; const ticks = await loadTicks(symbol, args.startEpoch === undefined ? undefined : Number(args.startEpoch), args.endEpoch === undefined ? undefined : Number(args.endEpoch), Math.min(BACKTEST_MAX_TICKS, Number(args.limit || BACKTEST_MAX_TICKS))); if (ticks.length < 50) return { source: 'Deriv', symbol, insufficientData: true, sampleTicks: ticks.length, minimumTicks: 50 }; return { source: 'Deriv', symbol, result: simulateBacktest(ticks, strategy), provenance: 'SIRE chronological Deriv tick store' }; }
  if (tool === 'walk_forward') { if (!symbol) throw new Error('symbol is required'); const strategy = (args.strategy || {}) as StrategySpec; const ticks = await loadTicks(symbol, undefined, undefined, Math.min(BACKTEST_MAX_TICKS, Number(args.limit || BACKTEST_MAX_TICKS))); const train = Math.max(50, Math.floor(Number(args.trainTicks || 10000))); const validation = Math.max(25, Math.floor(Number(args.validationTicks || 2500))); const test = Math.max(25, Math.floor(Number(args.testTicks || 2500))); const step = Math.max(1, Math.floor(Number(args.stepTicks || test))); const windows: Array<Record<string, unknown>> = []; for (let start = 0; start + train + validation + test <= ticks.length; start += step) { const trainTicks = ticks.slice(start, start + train); const validationTicks = ticks.slice(start + train, start + train + validation); const testTicks = ticks.slice(start + train + validation, start + train + validation + test); const validationResult = simulateBacktest(validationTicks, strategy); const testResult = simulateBacktest(testTicks, strategy); windows.push({ trainRange: [trainTicks[0]?.epoch, trainTicks[trainTicks.length - 1]?.epoch], validationRange: [validationTicks[0]?.epoch, validationTicks[validationTicks.length - 1]?.epoch], testRange: [testTicks[0]?.epoch, testTicks[testTicks.length - 1]?.epoch], validation: { trades: validationResult.trades, pnl: validationResult.totalPnl, expectancy: validationResult.expectancy, drawdown: validationResult.maxDrawdown }, unseenTest: { trades: testResult.trades, pnl: testResult.totalPnl, expectancy: testResult.expectancy, drawdown: testResult.maxDrawdown, winRate: testResult.winRate } }); } const testPnls = windows.map(w => Number((w.unseenTest as Record<string, unknown>).pnl || 0)); return { source: 'Deriv', symbol, windows, windowsPassed: windows.filter(w => Number((w.unseenTest as Record<string, unknown>).pnl || 0) > 0).length, totalWindows: windows.length, unseenTestPnl: testPnls.reduce((a, b) => a + b, 0), methodology: 'Rolling train/validation/unseen-test windows with strictly chronological ranges.' }; }
  if (tool === 'robustness') { if (!symbol) throw new Error('symbol is required'); const strategy = (args.strategy || {}) as StrategySpec; const ticks = await loadTicks(symbol, undefined, undefined, Math.min(BACKTEST_MAX_TICKS, Number(args.limit || BACKTEST_MAX_TICKS))); const baseline = simulateBacktest(ticks, strategy); const observed = baseline.totalPnl; const permutations = Math.min(2000, Math.max(100, Math.floor(Number(args.permutations || 500)))); const diff = returns(ticks); let extreme = 0; const samples: number[] = []; for (let i = 0; i < permutations; i += 1) { const shuffled = seededShuffle(diff, i + 19); const synthetic: StoredTick[] = []; let price = ticks[0]?.quote || 0; for (let j = 0; j < shuffled.length; j += 1) { price += shuffled[j]; synthetic.push({ symbol, quote: price, epoch: ticks[Math.min(ticks.length - 1, j + 1)]?.epoch || 0, source: 'Deriv' }); } const result = simulateBacktest([ticks[0], ...synthetic], strategy); samples.push(result.totalPnl); if (result.totalPnl >= observed) extreme += 1; } const sorted = [...samples].sort((a, b) => a - b); const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]; return { source: 'Deriv', symbol, observedPnl: observed, permutationCount: permutations, randomizedPnlQuantiles: { p05: q(.05), p50: q(.5), p95: q(.95) }, permutationPValue: (extreme + 1) / (permutations + 1), bootstrap: bootstrapMean(samples), warning: 'Permutation testing reduces but does not eliminate data-mining risk. Searching many hypotheses still requires multiple-testing correction and independent confirmation.' }; }
  if (tool === 'paper_trade') { if (!symbol) throw new Error('symbol is required'); const [id] = await db.add(PAPER_TABLE, [{ symbol, action: String(args.action || ''), expectedEntry: args.expectedEntry ?? null, actualQuote: args.actualQuote ?? null, spread: args.spread ?? null, executionDelayMs: args.executionDelayMs ?? null, strategy: String(args.strategy || ''), result: args.result ?? null, createdAt: Date.now() }]); return { saved: Boolean(id), id, symbol }; }
  if (tool === 'paper_trade_report') { if (!symbol) throw new Error('symbol is required'); const rows = await db.list<Record<string, unknown>>(PAPER_TABLE, { limit: 1000 }); const records = rows.items.filter(row => row.symbol === symbol); const results = records.map(row => Number(row.result)).filter(Number.isFinite); const wins = results.filter(v => v > 0).length; return { symbol, records: records.length, settledResults: results.length, totalPnl: results.reduce((a, b) => a + b, 0), winRate: results.length ? wins / results.length : 0, meanResult: results.length ? results.reduce((a, b) => a + b, 0) / results.length : 0, recent: records.slice(-100) }; }
  if (tool === 'risk_limits') { if (!symbol) throw new Error('symbol is required'); const table = 'sire_risk_limits_v1'; const rows = await db.list<Record<string, unknown>>(table, { limit: 1000 }); const existing = rows.items.find(row => row.symbol === symbol); const record = { symbol, maxExposure: Number(args.maxExposure ?? 1), maxDailyLoss: Number(args.maxDailyLoss ?? 1), maxDrawdown: Number(args.maxDrawdown ?? 1), maxConcentration: Number(args.maxConcentration ?? 1), updatedAt: Date.now() }; if (existing) await db.update(table, [{ id: existing.id, record }]); else await db.add(table, [record]); return { saved: true, ...record }; }
  if (tool === 'compare') { const symbolA = String(args.symbolA || ''); const symbolB = String(args.symbolB || ''); const start = args.startEpoch === undefined ? undefined : Number(args.startEpoch); const end = args.endEpoch === undefined ? undefined : Number(args.endEpoch); const limit = Math.min(SIRE_MAX_ANALYSIS_TICKS, Number(args.limit || 10000)); const [a, b] = await Promise.all([loadTicks(symbolA, start, end, limit), loadTicks(symbolB, start, end, limit)]); const n = Math.min(a.length, b.length); const ap = a.slice(-n).map(t => t.quote); const bp = b.slice(-n).map(t => t.quote); const ar = returns(a).slice(-Math.max(0, n - 1)); const br = returns(b).slice(-Math.max(0, n - 1)); return { source: 'Deriv', symbolA, symbolB, sampleCount: n, priceCorrelation: pearson(ap, bp), returnCorrelation: pearson(ar, br), statsA: stats(ar), statsB: stats(br) }; }
  if (tool === 'ohlc') { const limit = Math.min(SIRE_MAX_ANALYSIS_TICKS, Number(args.limit || 10000)); const ticks = await loadTicks(symbol, args.startEpoch === undefined ? undefined : Number(args.startEpoch), args.endEpoch === undefined ? undefined : Number(args.endEpoch), limit); const timeframeSeconds = Math.max(1, Number(args.timeframeSeconds || 60)); return { source: 'Deriv', symbol, timeframeSeconds, candles: ohlc(ticks, timeframeSeconds) }; }
  if (tool === 'quality') { const limit = Math.min(SIRE_MAX_ANALYSIS_TICKS, Number(args.limit || 10000)); const ticks = await loadTicks(symbol, args.startEpoch === undefined ? undefined : Number(args.startEpoch), args.endEpoch === undefined ? undefined : Number(args.endEpoch), limit); return { source: 'Deriv', symbol, quality: quality(ticks) }; }
  if (tool === 'replay') { const limit = Math.min(SIRE_MAX_TICKS, Number(args.limit || 1000)); const ticks = await loadTicks(symbol, args.startEpoch === undefined ? undefined : Number(args.startEpoch), args.endEpoch === undefined ? undefined : Number(args.endEpoch), limit); return { source: 'Deriv', symbol, ticks, replay: { step: true, pause: true, speeds: [0.25, 0.5, 1, 2, 5, 20] } }; }
  if (tool === 'save_experiment') { if (!args.name || !symbol) throw new Error('name and symbol are required'); const [id] = await db.add(RESEARCH_TABLE, [{ name: String(args.name), symbol, hypothesis: String(args.hypothesis || ''), methodology: String(args.methodology || ''), result: args.result || {}, createdAt: Date.now() }]); return { id, saved: true, symbol }; }
  if (tool === 'experiments') { const rows = await db.list<Record<string, unknown>>(RESEARCH_TABLE, { limit: 100 }); return { symbol, experiments: rows.items.filter(row => row.symbol === symbol).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)) }; }
  if (tool === 'research') { const steps = Array.isArray(args.steps) ? args.steps : []; if (!steps.length) throw new Error('steps[] is required'); const outputs: unknown[] = []; for (let i = 0; i < Math.min(25, steps.length); i += 1) { const step = steps[i] as Record<string, unknown>; const stepTool = String(step.tool || ''); if (stepTool === 'research' || stepTool === 'audit') throw new Error('Nested research/audit tools are not allowed'); outputs.push({ index: i, tool: stepTool, result: await gptTool(stepTool, (step.args || {}) as Record<string, unknown>) }); } return { stepsRun: outputs.length, outputs }; }
  if (tool === 'audit') {
    const snapshot = await environmentSnapshot({ includeMarketState: true, includeDataCoverage: true });
    return {
      source: 'Deriv',
      accessible: snapshot.capabilities,
      instrumentCatalogueRecords: snapshot.catalogue.count,
      persistedInstrumentCount: snapshot.persistedData.instrumentCountWithTicks,
      instrumentsWithoutPersistedTicks: snapshot.persistedData.instrumentsWithoutPersistedTicks,
      researchOperations: ['summary', 'returns', 'returns_series', 'prices', 'volatility', 'rolling_volatility', 'drawdown', 'runs', 'autocorrelation', 'entropy', 'sequence', 'distribution', 'quantiles', 'histogram', 'zscore', 'bootstrap_mean', 'ohlc', 'quality', 'features'],
      limits: { maxTicksPerAnalysis: 100000, maxBacktestTicks: BACKTEST_MAX_TICKS, maxReplayTicks: 5000, maxResearchSteps: 25, maxPermutationRuns: 2000 },
      knownGaps: snapshot.knownGaps,
      recommendation: snapshot.persistedData.instrumentsWithoutPersistedTicks.length ? 'Catalogue access is broader than historical tick coverage. SIRE can choose any catalogue instrument, but historical analysis requires ingestion for that instrument.' : 'The current persisted catalogue and data coverage are internally consistent.'
    };
  }
  throw new Error(`Unknown SIRE tool: ${tool}`);
}

export const handler = router({
  'GET /api/sire/ai/status': [
    async () => {
      return json({ ok: true, provider: 'NVIDIA-hosted Kimi/DeepSeek', configured: Boolean(process.env.NVIDIA_API_KEY), model: OPENAI_MODEL });
    },
  ],
  'POST /api/sire/agent/chat': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>;
      const query = String(payload.query || '').trim();
      const symbol = payload.symbol ? String(payload.symbol) : undefined;
      const history = Array.isArray(payload.history) ? payload.history.filter((item): item is { role: string; text: string } => !!item && typeof item === 'object' && typeof (item as Record<string, unknown>).role === 'string' && typeof (item as Record<string, unknown>).text === 'string') : [];
      const runtimeContext = payload.runtimeContext && typeof payload.runtimeContext === 'object' ? payload.runtimeContext as Record<string, unknown> : undefined;
      if (!query) return error('query is required', 400);
      try {
        const result = await runSIREConversation(query, symbol, runtimeContext, history);
        return json({ ok: true, ...result, provenance: 'NVIDIA-hosted Kimi K3 with DeepSeek V4 Pro fallback operating inside the SIRE environment' });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (message.includes('NVIDIA_API_KEY')) return error('SIRE brain is not configured. Add NVIDIA_API_KEY to this SIRE app.', 503);
        const statusMatch = message.match(/(?:NVIDIA|OpenAI) (?:HTTP |temporary service\/network error \(|rate limit remained active )(?:(408|425|429|500|502|503|504))/);
        const status = statusMatch ? Number(statusMatch[1]) : (message.includes('timed out') || message.includes('Timeout') ? 504 : 502);
        return error(message, status);
      }
    },
  ],
  'POST /api/sire/openai/chat': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>;
      const query = String(payload.query || '').trim();
      const symbol = payload.symbol ? String(payload.symbol) : undefined;
      const history = Array.isArray(payload.history) ? payload.history.filter((item): item is { role: string; text: string } => !!item && typeof item === 'object' && typeof (item as Record<string, unknown>).role === 'string' && typeof (item as Record<string, unknown>).text === 'string') : [];
      const runtimeContext = payload.runtimeContext && typeof payload.runtimeContext === 'object' ? payload.runtimeContext as Record<string, unknown> : undefined;
      if (!query) return error('query is required', 400);
      try {
        const result = await runSIREConversation(query, symbol, runtimeContext, history);
        return json({ ok: true, ...result, provenance: 'NVIDIA-hosted Kimi K3 with DeepSeek V4 Pro fallback operating inside the SIRE environment' });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (message.includes('NVIDIA_API_KEY')) return error('NVIDIA is not configured. Add NVIDIA_API_KEY to this SIRE app.', 503);
        const statusMatch = message.match(/(?:NVIDIA|OpenAI) (?:HTTP |temporary service\/network error \(|rate limit remained active )(?:(408|425|429|500|502|503|504))/);
        const status = statusMatch ? Number(statusMatch[1]) : (message.includes('timed out') || message.includes('Timeout') ? 504 : 502);
        return error(message, status);
      }
    },
  ],
  'GET /api/sire/gpt/manifest': [
    async () => json({ ok: true, manifest: GPT_TOOL_MANIFEST }),
  ],
  'POST /api/sire/gpt/tool': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>;
      const tool = String(payload.tool || '');
      if (!tool) return error('tool is required', 400);
      try {
        const result = await gptTool(tool, (payload.args || {}) as Record<string, unknown>);
        return json({ ok: true, tool, result, provenance: 'SIRE GPT Research Gateway' });
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : String(cause), 400);
      }
    },
  ],
  'POST /api/sire/data/ensure': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>;
      const symbol = String(payload.symbol || '').trim();
      if (!symbol) return error('symbol is required', 400);
      try { return json({ ok: true, ...(await ensureDerivHistory(symbol, Number(payload.ticks || 10000))) }); }
      catch (cause) { return error(cause instanceof Error ? cause.message : String(cause), 502); }
    },
  ],
  'GET /api/sire/data/m30-trend': [
    async ({ query }) => {
      const symbol = String(query.symbol || '').trim();
      if (!symbol) return error('symbol is required', 400);
      try { return json({ ok: true, ...(await analyzeM30Trend(symbol, Number(query.candles || 250))) }); }
      catch (cause) { return error(cause instanceof Error ? cause.message : String(cause), 502); }
    },
  ],
  'GET /api/sire/environment/audit': [
    async () => json({ ok: true, ...(await autonomousEnvironmentAudit()) }),
  ],
  'GET /api/_healthcheck': [
    async () => json({ ok: true, source: 'Deriv', part: 1 }),
  ],
  'GET /api/sire/coverage': [
    async ({ query }) => {
      const symbol = query.symbol;
      if (!symbol) return error('symbol is required', 400);
      return json({ coverage: await findCoverage(symbol), storage: { persistent: true, version: STORAGE_VERSION, source: 'Deriv', resumable: true, deduplicated: true } });
    },
  ],
  'POST /api/sire/ingest': [
    async ({ body }) => {
      const payload = body as { symbol?: unknown; source?: unknown; ticks?: unknown };
      const symbol = String(payload.symbol || '').trim();
      if (!symbol || payload.source !== 'Deriv' || !Array.isArray(payload.ticks)) {
        return error('symbol, source=Deriv and ticks[] are required', 400);
      }
      if (payload.ticks.length > MAX_TICKS) return error(`Maximum ${MAX_TICKS} ticks per ingest request`, 413);
      const clean = normalizeTicks(symbol, payload.ticks.filter(validTick));
      if (!clean.length) return error('No valid Deriv ticks supplied', 422);
      const persistedKeys = await recentPersistedTicks(symbol);
      const unique = clean.filter(tick => !persistedKeys.has(keyFor(tick)));
      if (!unique.length) return json({ ok: true, inserted: 0, duplicate: true, source: 'Deriv', storageVersion: STORAGE_VERSION });

      let inserted = 0;
      const batchIds: string[] = [];
      for (let offset = 0; offset < unique.length; offset += MAX_STORED_TICKS_PER_BATCH) {
        const chunk = unique.slice(offset, offset + MAX_STORED_TICKS_PER_BATCH);
        const ingestKey = batchKey(symbol, chunk);
        const record: BatchRecord = {
          symbol,
          source: 'Deriv',
          firstEpoch: chunk[0].epoch,
          lastEpoch: chunk[chunk.length - 1].epoch,
          count: chunk.length,
          ticks: chunk,
          ingestKey,
          createdAt: Date.now(),
        };
        const [id] = await db.add(BATCH_TABLE, [record]);
        if (!id) return error('Persistent storage rejected the tick batch', 500);
        batchIds.push(id);
        inserted += chunk.length;
      }

      const coverageRows = await db.list<CoverageRecord>(COVERAGE_TABLE, { limit: 100 });
      const current = coverageRows.items.find(item => item.symbol === symbol);
      const epochs = unique.map(tick => tick.epoch);
      const coverage: CoverageRecord = {
        symbol,
        storedTicks: (current?.storedTicks || 0) + inserted,
        oldestEpoch: Math.min(current?.oldestEpoch ?? Infinity, ...epochs),
        newestEpoch: Math.max(current?.newestEpoch ?? -Infinity, ...epochs),
        lastIngestAt: Date.now(),
        batches: (current?.batches || 0) + batchIds.length,
        lastBatchId: batchIds[batchIds.length - 1] || null,
        lastIngestKey: batchKey(symbol, unique.slice(-1)),
        storageVersion: STORAGE_VERSION,
      };
      if (current) await db.update(COVERAGE_TABLE, [{ id: current.id, record: coverage }]);
      else await db.add(COVERAGE_TABLE, [coverage]);

      return json({ ok: true, inserted, duplicateTicksSkipped: clean.length - unique.length, batchIds, source: 'Deriv', storageVersion: STORAGE_VERSION });
    },
  ],
  'GET /api/sire/history': [
    async ({ query }) => {
      const symbol = query.symbol;
      if (!symbol) return error('symbol is required', 400);
      const requestedLimit = Math.max(1, Number(query.limit || 5000));
      const limit = Math.min(100, requestedLimit);
      const batches: BatchRecord[] = [];
      let nextToken: string | undefined;
      // Follow bounded pages until we have enough matching batches. The previous
      // implementation stopped after 100 pages even when the requested history was
      // larger, making older candles disappear after reload.
      for (let page = 0; page < 500; page += 1) {
        const response = await db.list<BatchRecord>(BATCH_TABLE, {
          limit,
          ...(nextToken ? { nextToken } : {}),
        });
        batches.push(...response.items.filter(item => item.symbol === symbol));
        nextToken = response.nextToken;
        if (!nextToken || batches.reduce((sum, batch) => sum + batch.count, 0) >= Math.min(100000, requestedLimit)) break;
      }
      const ticks = Array.from(
        new Map(
          batches.flatMap(item => item.ticks).map(tick => [keyFor(tick), tick])
        ).values()
      ).sort((a, b) => a.epoch - b.epoch);
      return json({
        source: 'Deriv',
        symbol,
        storageVersion: STORAGE_VERSION,
        persisted: true,
        // Return the requested historical window instead of silently truncating every chart load to 5,000 ticks.
        ticks: ticks.slice(-Math.min(100000, requestedLimit)),
        batches: batches.length,
      });
    },
  ],
  'GET /api/sire/catalogue': [
    async () => {
      const rows = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 });
      return json({ ok: true, source: 'Deriv', count: rows.items.length, instruments: rows.items });
    },
  ],
  'POST /api/sire/catalogue/sync': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>;
      const instruments = Array.isArray(payload.instruments)
        ? payload.instruments.filter(item => item && typeof item === 'object')
        : [];
      if (!instruments.length) return error('instruments[] is required', 400);
      const rows = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 });
      const existing = new Map(rows.items.map(item => [String(item.symbol || item.underlying_symbol || ''), item]));
      let added = 0;
      let updated = 0;
      for (const item of instruments) {
        const row = item as Record<string, unknown>;
        const symbol = String(row.underlying_symbol || row.symbol || '').trim();
        if (!symbol) continue;
        const record = { ...row, symbol, source: 'Deriv', discoveredAt: Date.now(), updatedAt: Date.now() };
        const prior = existing.get(symbol);
        if (prior?.id) {
          await db.update(CATALOGUE_TABLE, [{ id: prior.id, record }]);
          updated += 1;
        } else {
          await db.add(CATALOGUE_TABLE, [record]);
          added += 1;
        }
      }
      return json({ ok: true, source: 'Deriv', discovered: instruments.length, added, updated, persisted: added + updated });
    },
  ],
  'POST /api/sire/gpt/catalogue': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>;
      const instruments = Array.isArray(payload.instruments)
        ? payload.instruments.filter(item => item && typeof item === 'object')
        : [];
      if (!instruments.length) return error('instruments[] is required', 400);
      const rows = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 });
      const existing = new Map(rows.items.map(item => [String(item.symbol || item.underlying_symbol || ''), item]));
      for (const item of instruments) {
        const row = item as Record<string, unknown>;
        const symbol = String(row.underlying_symbol || row.symbol || '').trim();
        if (!symbol) continue;
        const prior = existing.get(symbol);
        const record = { ...row, symbol, updatedAt: Date.now(), source: 'Deriv' };
        if (prior?.id) await db.update(CATALOGUE_TABLE, [{ id: prior.id, record }]);
        else await db.add(CATALOGUE_TABLE, [record]);
      }
      return json({ ok: true, stored: instruments.length, source: 'Deriv' });
    },
  ],
  'GET /api/sire/gpt/latest': [
    async ({ query }) => { const symbol = String(query.symbol || ''); if (!symbol) return error('symbol is required', 400); const batches = await allBatches(symbol); const ticks = numericTicks(batches, symbol, undefined, undefined, 10); return json({ ok: true, source: 'Deriv', symbol, latest: ticks[ticks.length - 1] || null, recent: ticks }); },
  ],
  'GET /api/sire/gpt/quality': [
    async ({ query }) => { const symbol = String(query.symbol || ''); if (!symbol) return error('symbol is required', 400); const batches = await allBatches(symbol); const ticks = numericTicks(batches, symbol, undefined, undefined, Number(query.limit || 100000)); return json({ ok: true, symbol, source: 'Deriv', quality: quality(ticks) }); },
  ],
  'GET /api/sire/gpt/ohlc': [
    async ({ query }) => { const symbol = String(query.symbol || ''); if (!symbol) return error('symbol is required', 400); const batches = await allBatches(symbol); const ticks = numericTicks(batches, symbol, query.startEpoch === undefined ? undefined : Number(query.startEpoch), query.endEpoch === undefined ? undefined : Number(query.endEpoch), Number(query.limit || 100000)); const timeframeSeconds = Math.max(1, Number(query.timeframeSeconds || 60)); return json({ ok: true, symbol, source: 'Deriv', timeframeSeconds, candles: ohlc(ticks, timeframeSeconds) }); },
  ],
  'GET /api/sire/gpt/compare': [
    async ({ query }) => { const symbolA = String(query.symbolA || ''); const symbolB = String(query.symbolB || ''); if (!symbolA || !symbolB) return error('symbolA and symbolB are required', 400); const start = query.startEpoch === undefined ? undefined : Number(query.startEpoch); const end = query.endEpoch === undefined ? undefined : Number(query.endEpoch); const [aBatches, bBatches] = await Promise.all([allBatches(symbolA), allBatches(symbolB)]); const a = numericTicks(aBatches, symbolA, start, end, Number(query.limit || 100000)); const b = numericTicks(bBatches, symbolB, start, end, Number(query.limit || 100000)); const n = Math.min(a.length, b.length); const ap = a.slice(-n).map(t => t.quote); const bp = b.slice(-n).map(t => t.quote); const ar = returns(a).slice(-Math.max(0, n - 1)); const br = returns(b).slice(-Math.max(0, n - 1)); return json({ ok: true, source: 'Deriv', symbolA, symbolB, sampleCount: n, priceCorrelation: pearson(ap, bp), returnCorrelation: pearson(ar, br), statsA: stats(ar), statsB: stats(br) }); },
  ],
  'GET /api/sire/gpt/context': [
    async ({ query }) => {
      const symbol = String(query.symbol || '');
      if (!symbol) return error('symbol is required', 400);
      return json(await researchContext(symbol));
    },
  ],
  'GET /api/sire/gpt/query': [
    async ({ query }) => {
      const symbol = String(query.symbol || ''); const operation = String(query.operation || 'summary');
      if (!symbol) return error('symbol is required', 400);
      const start = query.startEpoch === undefined ? undefined : Number(query.startEpoch);
      const end = query.endEpoch === undefined ? undefined : Number(query.endEpoch);
      const batches = await allBatches(symbol); const ticks = numericTicks(batches, symbol, start, end, Number(query.limit || 100000));
      const result = analyzeTicks(ticks, operation, { sequenceLength: Number(query.sequenceLength || 37), reversalHorizon: Number(query.reversalHorizon || 10), lag: Number(query.lag || 1), bins: Number(query.bins || 10) });
      return json({ ok: true, source: 'Deriv', symbol, startEpoch: start ?? ticks[0]?.epoch ?? null, endEpoch: end ?? ticks[ticks.length - 1]?.epoch ?? null, sampleCount: ticks.length, result, ticks: query.includeTicks === '1' ? ticks.slice(-Math.min(5000, ticks.length)) : undefined, provenance: 'SIRE persistent Deriv tick store' });
    },
  ],
  'POST /api/sire/gpt/query': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>;
      const symbol = String(payload.symbol || ''); const operation = String(payload.operation || 'summary');
      if (!symbol) return error('symbol is required', 400);
      const start = payload.startEpoch === undefined ? undefined : Number(payload.startEpoch);
      const end = payload.endEpoch === undefined ? undefined : Number(payload.endEpoch);
      const batches = await allBatches(symbol); const ticks = numericTicks(batches, symbol, start, end, Number(payload.limit || 100000));
      const result = analyzeTicks(ticks, operation, { sequenceLength: Number(payload.sequenceLength || 37), reversalHorizon: Number(payload.reversalHorizon || 10), lag: Number(payload.lag || 1), bins: Number(payload.bins || 10) });
      return json({ ok: true, source: 'Deriv', symbol, startEpoch: start ?? ticks[0]?.epoch ?? null, endEpoch: end ?? ticks[ticks.length - 1]?.epoch ?? null, sampleCount: ticks.length, result, ticks: payload.includeTicks ? ticks.slice(-Math.min(5000, ticks.length)) : undefined, provenance: 'SIRE persistent Deriv tick store' });
    },
  ],
  'GET /api/sire/gpt/environment': [
    async ({ query }) => json({ ok: true, result: await environmentSnapshot({ includeMarketState: query.includeMarketState !== '0', includeDataCoverage: query.includeDataCoverage !== '0' }) }),
  ],
  'GET /api/sire/gpt/workspace': [
    async ({ query }) => {
      const symbol = query.symbol ? String(query.symbol) : '';
      const context = symbol ? await researchContext(symbol) : null;
      const rows = await db.list<Record<string, unknown>>(RESEARCH_TABLE, { limit: 100 });
      const catalogue = await db.list<Record<string, unknown>>(CATALOGUE_TABLE, { limit: 1000 });
      const experiments = symbol ? rows.items.filter(row => row.symbol === symbol) : rows.items;
      return json({ ok: true, workspace: { source: 'Deriv', selectedSymbol: symbol || null, context, catalogue: catalogue.items, experiments: experiments.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)), tools: GPT_TOOL_MANIFEST.tools, operations: GPT_TOOL_MANIFEST.operations, controls: { analysis: true, rawTicks: true, replay: true, comparison: true, persistentMemory: true, programmaticAccess: true, catalogue: true, latest: true, quality: true, ohlc: true, multiStepResearch: true, audit: true } } });
    },
  ],
  'POST /api/sire/gpt/research': [
    async ({ body }) => { const payload = (body || {}) as Record<string, unknown>; try { return json({ ok: true, tool: 'research', result: await gptTool('research', payload), provenance: 'SIRE GPT Research Gateway' }); } catch (cause) { return error(cause instanceof Error ? cause.message : String(cause), 400); } },
  ],
  'GET /api/sire/gpt/audit': [
    async () => json({ ok: true, result: await gptTool('audit', {}) }),
  ],
  'GET /api/sire/gpt/replay': [
    async ({ query }) => {
      const symbol = String(query.symbol || ''); if (!symbol) return error('symbol is required', 400);
      const start = query.startEpoch === undefined ? undefined : Number(query.startEpoch); const end = query.endEpoch === undefined ? undefined : Number(query.endEpoch); const batches = await allBatches(symbol); const ticks = numericTicks(batches, symbol, start, end, Number(query.limit || 5000));
      return json({ ok: true, symbol, source: 'Deriv', ticks, replay: { step: true, pause: true, speeds: [0.25, 0.5, 1, 2, 5, 20] } });
    },
  ],
  'POST /api/sire/gpt/experiments': [
    async ({ body }) => {
      const payload = (body || {}) as Record<string, unknown>; if (!payload.name || !payload.symbol) return error('name and symbol are required', 400);
      const [id] = await db.add(RESEARCH_TABLE, [{ name: String(payload.name), symbol: String(payload.symbol), hypothesis: String(payload.hypothesis || ''), methodology: String(payload.methodology || ''), result: payload.result || {}, createdAt: Date.now() }]);
      return json({ ok: true, id, experiment: payload });
    },
  ],
  'GET /api/sire/gpt/experiments': [
    async ({ query }) => { const rows = await db.list<Record<string, unknown>>(RESEARCH_TABLE, { limit: 100 }); const symbol = query.symbol ? String(query.symbol) : ''; return json({ experiments: rows.items.filter(row => !symbol || row.symbol === symbol).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)) }); },
  ],
});
