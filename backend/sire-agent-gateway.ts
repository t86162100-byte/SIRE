/* SIRE Agent Gateway - provider-neutral autonomous tool-calling runtime. */
import { createServer } from 'node:http';
import { AGENT_CAPABILITIES, connectorRequest, discoverConnectors, enqueueAgentTask, verifyConfiguredConnectors, webSearch } from './agent-tools';

const PORT = Number(process.env.SIRE_AGENT_PORT || 10001);
const BASE_URL = (process.env.SIRE_AGENT_BASE_URL || '').replace(/\/$/, '');
const API_KEY = process.env.SIRE_AGENT_API_KEY || '';
const MODEL = process.env.SIRE_AGENT_MODEL || '';
const MAX_STEPS = Math.min(24, Math.max(1, Number(process.env.SIRE_AGENT_MAX_STEPS || 12)));
const ALLOW_WRITES = process.env.SIRE_AGENT_ALLOW_WRITES === 'true';

const tools = [
  { type: 'function', function: { name: 'web_search', description: 'Search the live public web and return source results.', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'list_connectors', description: 'Discover configured SIRE connectors and permissions.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'connector_request', description: 'Call an authenticated connector. Writes require SIRE_AGENT_ALLOW_WRITES=true.', parameters: { type: 'object', properties: { connectorId: { type: 'string' }, path: { type: 'string' }, method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }, permission: { type: 'string', enum: ['read', 'write', 'execute', 'deploy'] }, body: { type: 'object' } }, required: ['connectorId', 'path'] } } },
  { type: 'function', function: { name: 'create_background_task', description: 'Create a durable task for the always-on worker.', parameters: { type: 'object', properties: { task: { type: 'string' }, priority: { type: 'number' }, continuous: { type: 'boolean' }, metadata: { type: 'object' } }, required: ['task'] } } },
];

const SYSTEM = `You are SIRE, an autonomous intelligence operating across the entire SIRE workspace. Search the live web, discover authenticated connectors, and use authorized services. Inspect before acting. Never claim an action happened unless a tool confirms it. Separate facts from inference. For long-running work create durable background tasks. You have ${MAX_STEPS} tool steps.`;

function json(res: any, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'POST, GET, OPTIONS' });
  res.end(JSON.stringify(body));
}

async function model(messages: any[]) {
  if (!BASE_URL || !API_KEY || !MODEL) throw new Error('SIRE agent model is not configured');
  const response = await fetch(`${BASE_URL}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` }, body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: 'auto', temperature: 0.2 }) });
  const text = await response.text();
  if (!response.ok) throw new Error(`SIRE agent model HTTP ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

export async function runAgent(input: string) {
  const task = String(input || '').trim();

  // Access/connection questions are verified directly at the gateway so the
  // answer cannot be replaced by a stale model claim about SIRE's capabilities.
  if (/(github|render)/i.test(task) && /(access|connected|connection|workspace|repository|repo|permission|credential|api key|token|check|have)/i.test(task)) {
    const verification = await verifyConfiguredConnectors();
    const github = verification.github as Record<string, unknown> | undefined;
    const render = verification.render as Record<string, unknown> | undefined;
    const githubText = github?.ok
      ? `GitHub access is verified (authenticated as ${String(github.login || 'the configured account')}).`
      : `GitHub access is not verified: ${String(github?.error || 'connector unavailable')}.`;
    const renderText = render?.ok
      ? `Render access is verified; I can see ${String(render.workspaceCount ?? 0)} configured workspace(s).`
      : `Render access is not verified: ${String(render?.error || 'connector unavailable')}.`;
    return {
      answer: `${githubText} ${renderText} I verified this from SIRE's server-side connectors; no credentials are exposed.`,
      steps: 1,
      connectorVerification: verification,
    };
  }

  const messages: any[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: task }];
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const result = await model(messages);
    const message = result?.choices?.[0]?.message;
    if (!message) throw new Error('Agent model returned no message');
    messages.push(message);
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!calls.length) return { answer: message.content || '', steps: step + 1 };
    for (const call of calls) {
      let args: any = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { args = {}; }
      let output: unknown;
      try {
        switch (call.function?.name) {
          case 'web_search': output = await webSearch(String(args.query || ''), Number(args.limit || 8)); break;
          case 'list_connectors': output = { connectors: discoverConnectors(), capabilities: AGENT_CAPABILITIES }; break;
          case 'create_background_task': output = await enqueueAgentTask({ task: String(args.task || ''), priority: Number(args.priority || 0), continuous: Boolean(args.continuous), metadata: args.metadata || {} }); break;
          case 'connector_request': {
            const permission = (args.permission || 'read') as 'read' | 'write' | 'execute' | 'deploy';
            if (permission !== 'read' && !ALLOW_WRITES) throw new Error('Write/execute/deploy actions are disabled by SIRE_AGENT_ALLOW_WRITES');
            output = await connectorRequest(String(args.connectorId), String(args.path), { method: String(args.method || 'GET'), body: args.body === undefined ? undefined : JSON.stringify(args.body), headers: args.body === undefined ? undefined : { 'content-type': 'application/json' } }, permission);
            break;
          }
          default: output = { error: `Unknown tool ${String(call.function?.name)}` };
        }
      } catch (error) { output = { error: error instanceof Error ? error.message : String(error) }; }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  return { answer: 'The task reached the agent step limit before a final answer was produced.', steps: MAX_STEPS };
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, service: 'sire-agent-gateway', capabilities: AGENT_CAPABILITIES, writesEnabled: ALLOW_WRITES });
  if (req.method !== 'POST' || req.url !== '/agent') return json(res, 404, { error: 'not found' });
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    if (!body.task || typeof body.task !== 'string') return json(res, 400, { error: 'task is required' });
    return json(res, 200, await runAgent(body.task));
  } catch (error) { return json(res, 500, { error: error instanceof Error ? error.message : String(error) }); }
});

server.listen(PORT, '127.0.0.1', () => console.log(`[SIRE agent gateway] listening on 127.0.0.1:${PORT}`));
