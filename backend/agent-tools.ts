/* SIRE Agent Tool Layer
 * Generic, authenticated connector registry + web research + workspace operations.
 * Secrets stay in environment variables; never persist credentials in SIRE data.
 */
import { db } from '@appdeploy/sdk';

export type AgentPermission = 'read' | 'write' | 'execute' | 'deploy';
export type ConnectorDefinition = {
  id: string;
  name: string;
  kind: 'http' | 'webhook' | 'database' | 'github' | 'render' | 'custom';
  baseUrl?: string;
  authEnv?: string;
  permissions: AgentPermission[];
  enabled: boolean;
};

const CONNECTOR_TABLE = 'sire_connectors_v1';
const JOB_TABLE = 'sire_agent_jobs_v1';

function envJson<T>(name: string, fallback: T): T {
  try {
    const raw = process.env[name];
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function discoverConnectors(): ConnectorDefinition[] {
  const configured = envJson<ConnectorDefinition[]>('SIRE_CONNECTORS_JSON', []);
  const out = [...configured];
  const builtins: ConnectorDefinition[] = [
    { id: 'web-search', name: 'Web Search', kind: 'http', baseUrl: 'https://api.exa.ai', authEnv: 'EXA_API_KEY', permissions: ['read'], enabled: Boolean(process.env.EXA_API_KEY) },
    { id: 'github', name: 'GitHub', kind: 'github', authEnv: 'GITHUB_TOKEN', permissions: ['read', 'write', 'execute'], enabled: Boolean(process.env.GITHUB_TOKEN) },
    { id: 'render', name: 'Render', kind: 'render', authEnv: 'RENDER_API_KEY', permissions: ['read', 'write', 'deploy'], enabled: Boolean(process.env.RENDER_API_KEY) },
    { id: 'sire-data', name: 'SIRE Data', kind: 'database', permissions: ['read', 'write', 'execute'], enabled: true },
  ];
  for (const c of builtins) if (!out.some(x => x.id === c.id)) out.push(c);
  return out.filter(x => x.enabled);
}

export async function registerConnector(definition: ConnectorDefinition) {
  const existing = await db.list<ConnectorDefinition & { id: string }>(CONNECTOR_TABLE, { limit: 1000 });
  const record = { ...definition, enabled: Boolean(definition.enabled) };
  const row = existing.items.find(x => x.id === definition.id);
  if (row?.id) await db.update(CONNECTOR_TABLE, [{ id: row.id, record }]);
  else await db.add(CONNECTOR_TABLE, [record]);
  return record;
}

function requireEnv(name?: string) {
  if (!name) return undefined;
  const value = process.env[name];
  if (!value) throw new Error(`Required connector credential ${name} is not configured`);
  return value;
}

export async function webSearch(query: string, limit = 8) {
  const key = requireEnv('EXA_API_KEY');
  if (!key) throw new Error('Web search is not configured. Set EXA_API_KEY.');
  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, numResults: Math.min(Math.max(limit, 1), 20), contents: { text: true } }),
  });
  if (!response.ok) throw new Error(`Web search failed: HTTP ${response.status}`);
  const data = await response.json() as Record<string, unknown>;
  return { query, results: Array.isArray(data.results) ? data.results : [] };
}

export async function connectorRequest(connectorId: string, path: string, init: RequestInit = {}, required: AgentPermission = 'read') {
  const connector = discoverConnectors().find(x => x.id === connectorId);
  if (!connector) throw new Error(`Connector ${connectorId} is unavailable`);
  if (!connector.permissions.includes(required)) throw new Error(`Connector ${connectorId} does not grant ${required} permission`);
  if (!connector.baseUrl) throw new Error(`Connector ${connectorId} has no base URL`);
  const token = requireEnv(connector.authEnv);
  const url = new URL(path, connector.baseUrl);
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  headers.set('user-agent', 'SIRE-Agent/1.0');
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`${connectorId}: HTTP ${response.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}

export async function enqueueAgentTask(input: { task: string; priority?: number; continuous?: boolean; metadata?: Record<string, unknown> }) {
  const now = Date.now();
  const record = {
    task: input.task,
    priority: input.priority ?? 0,
    continuous: Boolean(input.continuous),
    status: 'queued',
    metadata: input.metadata || {},
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    nextRunAt: now,
  };
  const result = await db.add(JOB_TABLE, [record]);
  return { ...record, id: result?.[0]?.id };
}

export async function listAgentTasks(limit = 100) {
  return db.list<Record<string, unknown>>(JOB_TABLE, { limit });
}

export const AGENT_CAPABILITIES = {
  webSearch: Boolean(process.env.EXA_API_KEY),
  connectors: discoverConnectors().map(x => ({ id: x.id, name: x.name, permissions: x.permissions })),
  sireData: true,
  workspace: ['code', 'data', 'logs', 'research', 'runtime'],
  continuousJobs: true,
};
