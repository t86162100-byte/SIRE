import { db } from '@appdeploy/sdk';
import { runGemini } from './gemini-ai.ts';
import { runOpenRouter } from './openrouter-ai.ts';

type TeamEvent = (event: { actor: string; phase: string; text: string }) => void | Promise<void>;
type TeamTurn = { actor: 'Gemini' | 'GPT'; phase: string; text: string; responsibility?: string };

type TeamInput = {
  query: string;
  history?: Array<{ role: string; text?: string; content?: string }>;
  runtimeContext?: Record<string, unknown>;
  symbol?: string;
  workspaceId?: string;
  onEvent?: TeamEvent;
};

const TEAM_STATE_TABLE = 'sire_ai_team_state_v1';

async function emit(input: TeamInput, actor: string, phase: string, text: string) {
  if (input.onEvent) await input.onEvent({ actor, phase, text });
}

async function saveState(workspaceId: string | undefined, query: string, turns: TeamTurn[], sharedState: Record<string, unknown>) {
  if (!workspaceId) return;
  const now = Date.now();
  const existing = await db.list<Record<string, unknown>>(TEAM_STATE_TABLE, { limit: 100 });
  const row = existing.items.find(item => item.workspaceId === workspaceId);
  const record = { workspaceId, query, turns: turns.slice(-20), sharedState, updatedAt: now };
  if (row?.id) await db.update(TEAM_STATE_TABLE, [{ id: row.id, record }]);
  else await db.add(TEAM_STATE_TABLE, [record]);
}

export async function runAiTeam(input: TeamInput) {
  const query = input.query.trim();
  if (!query) throw new Error('query is required');

  const turns: TeamTurn[] = [];
  const sharedState: Record<string, unknown> = {
    goal: query,
    responsibilities: {},
    decisions: [],
    openQuestions: [],
    artifacts: [],
  };

  await emit(input, 'SIRE', 'team-start', 'Gemini and GPT are working together on the shared workspace.');
  await emit(input, 'Gemini', 'proposing', 'Developing an initial plan and identifying useful work to divide.');

  const gemini = await runGemini({
    query,
    history: input.history,
    runtimeContext: input.runtimeContext,
    symbol: input.symbol,
    councilContext: `You are the first teammate in a shared workspace. Do not debate for its own sake. Propose a practical plan, identify the main subtasks, and volunteer for the part you can handle best. State your proposed responsibility clearly.\n\nUSER GOAL:\n${query}`,
    debateRole: 'proposal',
  });
  turns.push({ actor: 'Gemini', phase: 'proposal', text: gemini.text });
  sharedState.responsibilities = { Gemini: 'Proposed by Gemini; final allocation remains a team decision.' };
  await emit(input, 'Gemini', 'proposed', gemini.text);
  await saveState(input.workspaceId, query, turns, sharedState);

  await emit(input, 'GPT', 'collaborating', 'Reading Gemini’s proposal and choosing where GPT can contribute most effectively.');
  const gpt = await runOpenRouter({
    query,
    history: input.history,
    system: `You are GPT, the second teammate in SIRE's shared workspace. You are not an opponent and you are not required to disagree. Read Gemini's proposal and actively collaborate. You may accept it, improve it, add a missing idea, verify a concern, volunteer for a subtask, ask Gemini to handle another subtask, or suggest a joint task. Make a concrete responsibility proposal. Keep the response focused on moving the shared work forward. Do not expose private chain-of-thought.`,
    councilContext: `USER GOAL:\n${query}\n\nGEMINI'S PROPOSAL:\n${gemini.text}\n\nSHARED TEAM STATE:\n${JSON.stringify(sharedState)}`,
  });
  turns.push({ actor: 'GPT', phase: 'collaboration', text: gpt.text });
  sharedState.responsibilities = { Gemini: 'Initial planning / review', GPT: 'Implementation / verification where appropriate' };
  await emit(input, 'GPT', 'proposed-responsibility', gpt.text);
  await saveState(input.workspaceId, query, turns, sharedState);

  await emit(input, 'Gemini', 'coordinating', 'Reviewing GPT’s proposal and adjusting the team plan where useful.');
  const geminiFollowup = await runGemini({
    query,
    history: input.history,
    runtimeContext: input.runtimeContext,
    symbol: input.symbol,
    councilContext: `SHARED USER GOAL:\n${query}\n\nGEMINI'S FIRST PROPOSAL:\n${gemini.text}\n\nGPT'S CONTRIBUTION:\n${gpt.text}\n\nTEAM RESPONSIBILITIES SO FAR:\n${JSON.stringify(sharedState.responsibilities)}\n\nAct as a teammate. Confirm useful agreements, resolve genuine differences, refine responsibilities, and identify the next concrete actions. Do not manufacture disagreement.`,
    debateRole: 'response',
  });
  turns.push({ actor: 'Gemini', phase: 'coordination', text: geminiFollowup.text });
  await emit(input, 'Gemini', 'coordinated', geminiFollowup.text);
  await saveState(input.workspaceId, query, turns, sharedState);

  await emit(input, 'GPT', 'executing-plan', 'Combining both contributions into the team decision and next actions.');
  const final = await runOpenRouter({
    query,
    history: input.history,
    system: `You are the coordinating teammate in SIRE. Produce the team's direct answer after reviewing both teammates' work. Preserve agreements, resolve genuine differences, combine complementary ideas, and make the responsibility split explicit when useful. The team should act together toward the user's goal, not stage an artificial debate. Do not expose private chain-of-thought or internal orchestration.`,
    councilContext: `USER GOAL:\n${query}\n\nTEAM WORKSPACE:\n${JSON.stringify(sharedState)}\n\nGEMINI:\n${gemini.text}\n\nGPT:\n${gpt.text}\n\nGEMINI FOLLOW-UP:\n${geminiFollowup.text}`,
  });
  turns.push({ actor: 'GPT', phase: 'decision', text: final.text });
  sharedState.decisions = [final.text];
  await emit(input, 'GPT', 'decision', final.text);
  await saveState(input.workspaceId, query, turns, sharedState);
  await emit(input, 'SIRE', 'team-complete', 'The team has combined its work into one shared result.');

  return {
    text: final.text,
    responseId: final.responseId || geminiFollowup.responseId || gpt.responseId || gemini.responseId || '',
    model: 'team:Gemini+' + final.model,
    provider: 'SIRE AI Team',
    council: turns.map(turn => ({ provider: turn.actor === 'Gemini' ? 'Google Gemini' : 'OpenAI via OpenRouter', model: turn.actor === 'Gemini' ? gemini.model : final.model, role: turn.phase, text: turn.text })),
    teamMode: 'shared-workspace-collaboration',
    sharedState,
  };
}
