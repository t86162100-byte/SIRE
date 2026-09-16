import { db } from '@appdeploy/sdk';
import { runGemini } from './gemini-ai.ts';
import { runOpenRouter } from './openrouter-ai.ts';
import { webSearch } from './agent-tools.ts';

type TeamEvent = (event: { actor: string; phase: string; text: string; workspaceId: string }) => void | Promise<void>;
type TeamState = {
  workspaceId: string;
  goal: string;
  responsibilities: Array<{ owner: string; task: string; status: string }>;
  decisions: string[];
  openQuestions: string[];
  artifacts: Array<{ name: string; content: string; owner: string }>;
  activity: Array<{ actor: string; phase: string; text: string; at: string }>;
  updatedAt: string;
};

const TABLE = 'sire_ai_team_state_v1';
const MAX_ACTIVITY = 40;
const MAX_TEXT = 9000;
const locks = new Map<string, Promise<void>>();

function clean(value: unknown, max = MAX_TEXT) { return String(value ?? '').trim().slice(0, max); }
function workspaceIdOf(input: any) { return clean(input.workspaceId || input.workspace || input.sessionId || 'default', 180) || 'default'; }
function emptyState(workspaceId: string, goal: string): TeamState {
  return { workspaceId, goal, responsibilities: [], decisions: [], openQuestions: [], artifacts: [], activity: [], updatedAt: new Date().toISOString() };
}

async function loadState(workspaceId: string, goal: string): Promise<{ state: TeamState; id?: string }> {
  const result = await db.list(TABLE, { limit: 1000 });
  const item = result.items.find((row: any) => row?.workspaceId === workspaceId);
  if (!item) return { state: emptyState(workspaceId, goal) };
  return { id: item.id, state: { ...emptyState(workspaceId, goal), ...item, goal: goal || item.goal } };
}

async function saveState(state: TeamState, id?: string) {
  state.updatedAt = new Date().toISOString();
  if (id) { await db.update(TABLE, [{ id, record: state }]); return id; }
  const ids = await db.add(TABLE, [state]);
  return ids[0] || undefined;
}

async function withWorkspaceLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(workspaceId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  locks.set(workspaceId, previous.then(() => current));
  await previous;
  try { return await fn(); } finally { release(); if (locks.get(workspaceId) === current) locks.delete(workspaceId); }
}

function stateText(state: TeamState) {
  return JSON.stringify({ goal: state.goal, responsibilities: state.responsibilities.slice(-12), decisions: state.decisions.slice(-12), openQuestions: state.openQuestions.slice(-12), artifacts: state.artifacts.slice(-8) }, null, 2);
}

function parseJson(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function applyUpdate(state: TeamState, actor: string, text: string) {
  const parsed = parseJson(text);
  if (!parsed || typeof parsed !== 'object') return;
  if (Array.isArray(parsed.responsibilities)) state.responsibilities = parsed.responsibilities.map((x: any) => ({ owner: clean(x.owner, 80), task: clean(x.task, 500), status: clean(x.status, 80) })).filter((x: any) => x.task);
  if (Array.isArray(parsed.decisions)) state.decisions = [...state.decisions, ...parsed.decisions.map((x: any) => clean(x, 700)).filter(Boolean)].slice(-20);
  if (Array.isArray(parsed.openQuestions)) state.openQuestions = parsed.openQuestions.map((x: any) => clean(x, 500)).filter(Boolean).slice(-20);
  if (Array.isArray(parsed.artifacts)) state.artifacts = parsed.artifacts.map((x: any) => ({ name: clean(x.name, 120), content: clean(x.content, 3000), owner: clean(x.owner, 80) })).filter((x: any) => x.name && x.content).slice(-12);
  state.activity.push({ actor, phase: 'update', text: clean(parsed.summary || text, 1200), at: new Date().toISOString() });
  state.activity = state.activity.slice(-MAX_ACTIVITY);
}

async function emit(onEvent: TeamEvent | undefined, workspaceId: string, actor: string, phase: string, text: string) {
  if (onEvent) await onEvent({ actor, phase, text: clean(text, 1800), workspaceId });
}

export async function runAiTeam(input: {
  query: string;
  workspaceId?: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  symbol?: string;
  runtimeContext?: Record<string, unknown>;
  execute?: boolean;
  onEvent?: TeamEvent;
}) {
  const query = clean(input.query);
  if (!query) throw new Error('query is required');
  const workspaceId = workspaceIdOf(input);
  return withWorkspaceLock(workspaceId, async () => {
    const loaded = await loadState(workspaceId, query);
    const state = loaded.state;
    state.goal = query;
    const history = Array.isArray(input.history) ? input.history.slice(-20) : [];
    const emitLocal = (actor: string, phase: string, text: string) => emit(input.onEvent, workspaceId, actor, phase, text);
    const web = /\b(latest|today|current|now|recent|news|price|market|research|search|look up|source|compare|2026|2025)\b/i.test(query) || /https?:\/\//.test(query)
      ? await webSearch(query, 8).catch(() => ({ results: [] })) : { results: [] };
    const sources = Array.isArray((web as any).results) ? (web as any).results.map((x: any) => ({ title: clean(x.title || x.name || x.url, 180), url: clean(x.url || x.link, 500), text: clean(x.text || x.content || x.snippet, 1400) })).filter((x: any) => x.url) : [];
    const researchContext = sources.length ? `\nLIVE RESEARCH:\n${sources.map((s: any, i: number) => `[${i + 1}] ${s.title}\n${s.url}\n${s.text}`).join('\n\n')}` : '';
    if (sources.length) await emitLocal('Web', 'executing', `The team gathered ${sources.length} live sources for the shared workspace.`);

    const base = `SHARED TEAM WORKSPACE ${workspaceId}\n${stateText(state)}\n\nUSER GOAL:\n${query}${researchContext}`;
    await emitLocal('Gemini', 'proposing', 'Gemini is proposing a plan and volunteering for work.');
    const gemini = await runGemini({ query: `${base}\n\nAct as the planning teammate. Propose a practical plan, volunteer for work, and identify what GPT should own. Return a concise visible summary plus this JSON object: {"summary":"...","responsibilities":[{"owner":"Gemini|GPT","task":"...","status":"proposed"}],"decisions":["..."],"openQuestions":["..."],"artifacts":[]}. Do not expose hidden chain-of-thought.`, history, symbol: input.symbol, runtimeContext: input.runtimeContext, debateRole: 'proposal' });
    applyUpdate(state, 'Gemini', gemini.text);
    await emitLocal('Gemini', 'proposed', gemini.text);

    const afterGemini = stateText(state);
    await emitLocal('GPT', 'collaborating', 'GPT is reading the shared state, accepting or improving Gemini’s plan, and choosing its responsibility.');
    const gpt = await runOpenRouter({ query: `${base}\n\nUPDATED SHARED STATE:\n${afterGemini}\n\nGEMINI CONTRIBUTION:\n${gemini.text}\n\nAct as the second teammate. Do not debate for its own sake. Agree where appropriate, improve gaps, volunteer for a responsibility, and propose a joint decision. Return a concise visible summary plus JSON: {"summary":"...","responsibilities":[{"owner":"Gemini|GPT","task":"...","status":"accepted|proposed|in_progress"}],"decisions":["..."],"openQuestions":["..."],"artifacts":[]}. Do not expose hidden chain-of-thought.`, history, councilContext: gemini.text, onEvent: undefined });
    applyUpdate(state, 'GPT', gpt.text);
    await emitLocal('GPT', 'proposed', gpt.text);

    await emitLocal('Gemini', 'coordinating', 'Gemini is reviewing GPT’s proposal and coordinating the division of responsibility.');
    const geminiReview = await runGemini({ query: `${base}\n\nSHARED STATE:\n${stateText(state)}\n\nGPT CONTRIBUTION:\n${gpt.text}\n\nCoordinate the team. Confirm useful agreements, resolve only real conflicts, reassign work if needed, and state the joint decision. Return concise summary plus JSON: {"summary":"...","responsibilities":[...],"decisions":["..."],"openQuestions":["..."],"artifacts":[]}.`, history, symbol: input.symbol, runtimeContext: input.runtimeContext, councilContext: `GPT teammate contribution:\n${gpt.text}`, debateRole: 'response' });
    applyUpdate(state, 'Gemini', geminiReview.text);
    await emitLocal('Gemini', 'coordinated', geminiReview.text);

    await emitLocal('GPT', 'executing', 'GPT is turning the agreed plan into the team’s concrete next action.');
    const final = await runOpenRouter({ query: `${base}\n\nFINAL SHARED STATE:\n${stateText(state)}\n\nGEMINI COORDINATION:\n${geminiReview.text}\n\nGPT CONTRIBUTION:\n${gpt.text}\n\nYou are the execution teammate. Produce the direct answer and a concrete next action the team can carry out now. If safe execution is requested, identify exactly what was executed by SIRE’s available tools versus what still needs user authorization. Return concise summary plus JSON: {"summary":"...","responsibilities":[...],"decisions":["..."],"openQuestions":["..."],"artifacts":[{"name":"...","content":"...","owner":"GPT"}]}. Never claim an external action occurred unless a tool result proves it.`, history, councilContext: `SHARED STATE:\n${stateText(state)}\n\nGemini coordination:\n${geminiReview.text}`, onEvent: undefined });
    applyUpdate(state, 'GPT', final.text);

    const executionRequested = Boolean(input.execute);
    const execution = executionRequested ? { status: 'planned', note: 'The two-model team produced and recorded an execution plan. External writes remain governed by SIRE authorization controls.' } : { status: 'not_requested' };
    await saveState(state, loaded.id);
    await emitLocal('SIRE', 'conclusion', 'The shared workspace has been updated with the team’s responsibilities, decisions, and latest artifacts.');
    return { text: final.text, responseId: final.responseId || gemini.responseId || '', model: `team:${gemini.model}+${final.model}`, provider: 'SIRE AI Team', teamMode: 'shared-workspace-collaboration', workspaceId, responsibilities: state.responsibilities, decisions: state.decisions.slice(-12), openQuestions: state.openQuestions.slice(-12), artifacts: state.artifacts.slice(-8), activity: state.activity.slice(-20), execution, webSearched: sources.length > 0, webSources: sources };
  });
}
