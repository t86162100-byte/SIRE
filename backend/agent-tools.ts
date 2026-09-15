/* SIRE Agent Tool Layer
 * Generic authenticated connector registry + free web research + workspace operations.
 * Secrets stay in environment variables; never persist credentials in SIRE data.
 */
import { db } from '@appdeploy/sdk';
import { chromeWebSearch } from './chrome-web-search';

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

const DEFAULT_SEARXNG_INSTANCES = [
  'https://searx.debnerd.in',
  'https://search.wdpserver.com',
  'https://searx.tiekoetter.com',
  'https://searx.rhscz.eu',
];

function envJson<T>(name: string, fallback: T): T {
  try {
    const raw = process.env[name];
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function searxngInstances() {
  return (process.env.SIRE_SEARXNG_URLS || DEFAULT_SEARXNG_INSTANCES.join(','))
    .split(',')
    .map(value => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function discoverConnectors(): ConnectorDefinition[] {
  const configured = envJson<ConnectorDefinition[]>('SIRE_CONNECTORS_JSON', []);
  const out = [...configured];
  const builtins: ConnectorDefinition[] = [
    { id: 'web-search', name: 'Web Search (Chrome + SearXNG)', kind: 'http', baseUrl: searxngInstances()[0], permissions: ['read'], enabled: true },
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

async function searxngSearch(query: string, limit: number) {
  const urls = searxngInstances();
  if (!urls.length) throw new Error('No SearXNG search instances are configured');
  let lastError = 'No SearXNG instance responded';

  for (const baseUrl of urls) {
    try {
      const url = new URL('/search', `${baseUrl}/`);
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'json');
      url.searchParams.set('categories', 'general,news');
      url.searchParams.set('language', 'en');
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'SIRE-Agent/1.0 (+https://sire-rwv9.onrender.com)',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        lastError = `${baseUrl}: HTTP ${response.status}`;
        continue;
      }
      const data = await response.json() as Record<string, unknown>;
      const results = Array.isArray(data.results) ? data.results : [];
      if (!results.length) {
        lastError = `${baseUrl}: no results`;
        continue;
      }
      return {
        query,
        provider: 'SearXNG',
        instance: baseUrl,
        results: results.slice(0, Math.min(Math.max(limit, 1), 20)),
      };
    } catch (error) {
      lastError = `${baseUrl}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  throw new Error(`SearXNG unavailable. ${lastError}`);
}

export async function webSearch(query: string, limit = 8) {
  try {
    return await searxngSearch(query, limit);
  } catch (searxError) {
    const searxMessage = searxError instanceof Error ? searxError.message : String(searxError);
    try {
      return await chromeWebSearch(query, limit);
    } catch (chromeError) {
      const chromeMessage = chromeError instanceof Error ? chromeError.message : String(chromeError);
      throw new Error(`Web research unavailable. SearXNG: ${searxMessage}. Chrome: ${chromeMessage}`);
    }
  }
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
  webSearch: true,
  webSearchProvider: 'SearXNG → Chrome/Google',
  connectors: discoverConnectors().map(x => ({ id: x.id, name: x.name, permissions: x.permissions })),
  sireData: true,
  workspace: ['code', 'data', 'logs', 'research', 'runtime'],
  continuousJobs: true,
};
