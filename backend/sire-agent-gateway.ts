/* SIRE Agent Gateway
 * A provider-neutral tool-calling loop. Configure any OpenAI-compatible model endpoint
 * with SIRE_AGENT_BASE_URL, SIRE_AGENT_API_KEY and SIRE_AGENT_MODEL.
 */
import { createServer } from 'node:http';
import { autonomousEnvironmentAudit } from './sire-autonomy';
import { AGENT_CAPABILITIES, connectorRequest, discoverConnectors, enqueueAgentTask, webSearch } from './agent-tools';

const PORT = Number(process.env.PORT || 10000);
const BASE_URL = (process.env.SIRE_AGENT_BASE_URL || '').replace(/\/$/, '');
const API_KEY = process.env.SIRE_AGENT_API_KEY || '';
const MODEL = process.env.SIRE_AGENT_MODEL || '';
const MAX_STEPS = Math.min(24, Math.max(1, Number(process.env.SIRE_AGENT_MAX_STEPS || 12)));
const ALLOW_WRITES = process.env.SIRE_AGENT_ALLOW_WRITES === 'true';

const tools = [
  { type: 'function', function: { name: 'web_search', description: 'Search the live public web and return source results. Use this for current information and documentation.', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'list_connectors', description: 'Discover currently configured SIRE connectors and their permissions.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'inspect_sire', description: 'Inspect SIRE itself: catalogue, persisted market data coverage and known capability gaps.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'connector_request', description: 'Call an authenticated connector. Read actions are allowed by default; write/execute/deploy actions require SIRE_AGENT_ALLOW_WRITES=true and connector permission.', parameters: { type: 'object', properties: { connectorId: { type: 'string' }, path: { type: 'string' }, method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }, permission: { type: 'string', enum: ['read', 'write', 'execute', 'deploy'] }, body: { type: 'object' } }, required: ['connectorId', 'path'] } } },
  { type: 'function', function: { name: 'create_background_task', description: 'Create a durable SIRE task that the always-on worker can resume and execute.', parameters: { type: 'object', properties: { task: { type: 'string' }, priority: { type: 'number' }, continuous: { type: 'boolean' }, metadata: { type: 'object' } }, required: ['task'] } } },
];

const SYSTEM = `You are SIRE, an autonomous intelligence operating across the SIRE workspace. You can inspect SIRE data, search the live web, discover authenticated connectors and use authorized external services. Treat the workspace as a whole system, not just the current UI screen. When a task requires code, deployment, data or infrastructure, discover the appropriate connector and inspect before acting. Never claim an action happened unless a tool confirms it. Separate observed facts from inference. For destructive or high-impact actions, obey connector permissions and the runtime write policy. If a long-running task is requested, create or continue a durable background task. You have ${MAX_STEPS} tool steps.`;

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

async function runAgent(input: string) {
  const messages: any[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: input }];
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
          case 'inspect_sire': output = await autonomousEnvironmentAudit(); break;
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

server.listen(PORT, '0.0.0.0', () => console.log(`[SIRE agent gateway] listening on ${PORT}`));
