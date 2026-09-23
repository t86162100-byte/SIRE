/* SIRE Agent Tool Layer
 * Generic authenticated connector registry + resilient free web research + workspace operations.
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
    { id: 'web-search', name: 'Web Search (SearXNG + free HTTP + Chrome)', kind: 'http', baseUrl: searxngInstances()[0], permissions: ['read'], enabled: true },
    { id: 'github', name: 'GitHub', kind: 'github', baseUrl: 'https://api.github.com/', authEnv: 'GITHUB_TOKEN', permissions: ['read', 'write', 'execute'], enabled: Boolean(process.env.GITHUB_TOKEN) },
    { id: 'render', name: 'Render', kind: 'render', baseUrl: 'https://api.render.com/v1/', authEnv: 'RENDER_API_KEY', permissions: ['read', 'write', 'deploy'], enabled: Boolean(process.env.RENDER_API_KEY) },
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

function decodeHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(value: string) {
  try { return new URL(value, 'https://duckduckgo.com').toString(); } catch { return value; }
}

async function duckDuckGoSearch(query: string, limit: number) {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 (compatible; SIRE-Agent/1.0; +https://sire-rwv9.onrender.com)',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`DuckDuckGo: HTTP ${response.status}`);
  const html = await response.text();
  const results: Array<{ title: string; url: string; snippet: string; source: string }> = [];
  const blocks = html.match(/<div[^>]+class=["'][^"']*result[^"']*["'][\s\S]*?<\/div>\s*<\/div>/gi) || [];
  for (const block of blocks) {
    const link = block.match(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const snippetMatch = block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\//i);
    const resultUrl = absoluteUrl(link[1]);
    try {
      results.push({ title: decodeHtml(link[2]).slice(0, 240), url: resultUrl, snippet: decodeHtml(snippetMatch?.[1] || '').slice(0, 500), source: new URL(resultUrl).hostname });
    } catch { /* ignore malformed result */ }
    if (results.length >= Math.min(Math.max(limit, 1), 10)) break;
  }
  if (!results.length) throw new Error('DuckDuckGo returned no usable results');
  return { query, provider: 'DuckDuckGo HTML', results };
}

async function bingRssSearch(query: string, limit: number) {
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'rss');
  const response = await fetch(url, {
    headers: { accept: 'application/rss+xml,application/xml,text/xml', 'user-agent': 'SIRE-Agent/1.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Bing RSS: HTTP ${response.status}`);
  const xml = await response.text();
  const results: Array<{ title: string; url: string; snippet: string; source: string }> = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    const title = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
    const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1];
    const description = item.match(/<description>([\s\S]*?)<\/description>/i)?.[1];
    if (!title || !link) continue;
    const resultUrl = decodeHtml(link).trim();
    try {
      results.push({ title: decodeHtml(title).slice(0, 240), url: resultUrl, snippet: decodeHtml(description || '').slice(0, 500), source: new URL(resultUrl).hostname });
    } catch { /* ignore malformed result */ }
    if (results.length >= Math.min(Math.max(limit, 1), 10)) break;
  }
  if (!results.length) throw new Error('Bing RSS returned no usable results');
  return { query, provider: 'Bing RSS', results };
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
        headers: { accept: 'application/json', 'user-agent': 'SIRE-Agent/1.0 (+https://sire-rwv9.onrender.com)' },
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
      return { query, provider: 'SearXNG', instance: baseUrl, results: results.slice(0, Math.min(Math.max(limit, 1), 20)) };
    } catch (error) {
      lastError = `${baseUrl}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  throw new Error(`SearXNG unavailable. ${lastError}`);
}

export async function webSearch(query: string, limit = 8) {
  const failures: string[] = [];
  const providers = [
    ['SearXNG', () => searxngSearch(query, limit)],
    ['DuckDuckGo', () => duckDuckGoSearch(query, limit)],
    ['Bing', () => bingRssSearch(query, limit)],
    ['Chrome', () => chromeWebSearch(query, limit)],
  ] as const;
  for (const [name, search] of providers) {
    try { return await search(); }
    catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  throw new Error(`Web research unavailable after all providers failed. ${failures.join(' | ')}`);
}

export async function verifyConfiguredConnectors() {
  const checks: Record<string, unknown> = {};
  if (discoverConnectors().some(x => x.id === 'github')) {
    try {
      const user = await connectorRequest('github', '/user', {}, 'read') as Record<string, unknown>;
      const repo = await connectorRequest('github', '/repos/t86162100-byte/SIRE', {}, 'read') as Record<string, unknown>;
      checks.github = {
        ok: true,
        login: user.login,
        name: user.name || null,
        repository: { fullName: repo.full_name || 't86162100-byte/SIRE', private: Boolean(repo.private), defaultBranch: repo.default_branch || null },
      };
    } catch (error) {
      checks.github = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (discoverConnectors().some(x => x.id === 'render')) {
    try {
      const workspaces = await connectorRequest('render', '/owners?limit=100', {}, 'read') as Record<string, unknown>;
      const owners = Array.isArray(workspaces?.items) ? workspaces.items : Array.isArray(workspaces) ? workspaces : [];
      checks.render = {
        ok: true,
        workspaceCount: owners.length,
        workspaces: owners.slice(0, 20).map((owner: any) => ({ id: owner.id, name: owner.name, type: owner.type || null })),
      };
    } catch (error) {
      checks.render = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return checks;
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
  if (connectorId === 'github') { headers.set('accept', 'application/vnd.github+json'); headers.set('x-github-api-version', '2022-11-28'); }
  headers.set('user-agent', 'SIRE-Agent/1.0');
  const response = await fetch(url, { ...init, headers, signal: init.signal || AbortSignal.timeout(8000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${connectorId}: HTTP ${response.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}

export async function enqueueAgentTask(input: { task: string; priority?: number; continuous?: boolean; metadata?: Record<string, unknown> }) {
  const now = Date.now();
  const record = { task: input.task, priority: input.priority ?? 0, continuous: Boolean(input.continuous), status: 'queued', metadata: input.metadata || {}, createdAt: now, updatedAt: now, attempts: 0, nextRunAt: now };
  const result = await db.add(JOB_TABLE, [record]);
  return { ...record, id: result?.[0]?.id };
}

export async function listAgentTasks(limit = 100) {
  return db.list<Record<string, unknown>>(JOB_TABLE, { limit });
}

export const AGENT_CAPABILITIES = {
  webSearch: true,
  webSearchProvider: 'SearXNG → DuckDuckGo → Bing → Chrome',
  connectors: discoverConnectors().map(x => ({ id: x.id, name: x.name, permissions: x.permissions })),
  sireData: true,
  workspace: ['code', 'data', 'logs', 'research', 'runtime'],
  continuousJobs: true,
};