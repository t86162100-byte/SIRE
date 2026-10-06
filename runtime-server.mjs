import http from 'node:http';
import { randomUUID, createHmac } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

const { handler } = await import('./backend/index.ts');
import { handleGeminiRequest } from './backend/gemini-ai.ts';
import { runGptHead } from './backend/openrouter-ai.ts';
import { ws } from './compat/appdeploy-sdk/index.js';
import { realtime } from './backend/realtime.ts';
import { getStoredHistory, persistHistoryBars, historyStoreStatus } from './backend/deriv-history-store.ts';
import { signup, login, logout, currentUser, googleStart, googleCallback } from './backend/auth.ts';
import { runSireDiagnostics } from './backend/sire-diagnostics.ts';
import { runAutonomousCycle } from './autonomous/sire-autonomous-cycle.ts';
import { recordIssue, getRecentIssues } from './backend/sire-issue-tracker.ts';
import { fetchBinanceCatalogServer, fetchBinanceMarketSnapshotServer, fetchBinanceHistoryServer } from './backend/binance-catalog.ts';

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const DIST = join(process.cwd(), 'dist');
const pendingChartControls = new Map();

const gptJobs = new Map();
const GPT_JOB_RETENTION_MS = 2 * 60 * 60 * 1000;
function pruneGptJobs() {
  const cutoff = Date.now() - GPT_JOB_RETENTION_MS;
  for (const [id, job] of gptJobs) {
    if (job.finishedAt && job.finishedAt < cutoff) gptJobs.delete(id);
  }
}
function startGptJob(requestId, parsed, sendEvent) {
  const job = {
    requestId,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    response: null,
    error: null,
  };
  gptJobs.set(requestId, job);
  void (async () => {
    try {
      const response = await handleDirectGptRequest({ ...parsed, requestId }, async event => {
        job.lastActivity = { ...event, at: Date.now() };
        try { sendEvent?.('gpt.status', { ...event, requestId }); } catch {}
      });
      job.status = 'completed';
      job.response = response;
      job.finishedAt = Date.now();
      job.lastActivity = { actor:'GPT', phase:'done', text:'GPT completed the request.', at: job.finishedAt };
      try { sendEvent?.('gpt.done', response); } catch {}
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      job.status = 'failed';
      job.error = {
        error: message,
        requestId,
        status: cause && typeof cause === 'object' ? cause.status ?? null : null,
        code: cause && typeof cause === 'object' ? cause.code ?? null : null,
        providerBody: cause && typeof cause === 'object' && typeof cause.providerBody === 'string' ? cause.providerBody.slice(0, 2000) : null,
      };
      job.finishedAt = Date.now();
      job.lastActivity = { actor:'GPT', phase:'error', text:message, at:job.finishedAt };
      console.error('[DIRECT GPT JOB]', JSON.stringify({ requestId, ...job.error }));
      try { sendEvent?.('gpt.error', job.error); } catch {}
    } finally {
      pruneGptJobs();
    }
  })();
  return job;
}

const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2' };

async function serveStatic(req, res) {
  if (!req.url || !['GET','HEAD'].includes(req.method || '')) return false;
  const requestPath = decodeURIComponent(new URL(req.url, 'http://sire.local').pathname);
  if (requestPath.startsWith('/api/') || requestPath === '/ws') return false;
  const candidate = requestPath === '/' ? join(DIST,'index.html') : join(DIST, normalize(requestPath).replace(/^[/\\]+/,''));
  let filePath = candidate;
  try { const info = await stat(filePath); if (!info.isFile()) throw new Error('not a file'); } catch { filePath = join(DIST,'index.html'); }
  try { const data = await readFile(filePath); res.writeHead(200,{ 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' }); if (req.method !== 'HEAD') res.end(data); else res.end(); return true; } catch { return false; }
}

function toEvent(req, body) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const routedPath = `${url.pathname}${url.search}`;
  return { httpMethod:req.method, path:routedPath, rawPath:routedPath, body, headers:req.headers, requestContext:{ http:{ method:req.method, path:routedPath } } };
}

async function handleTeamRequest(parsed, onEvent) {
  const query = String(parsed.query || '').trim();
  if (!query) throw new Error('query is required');
  const response = await runAiTeam({
    query,
    workspaceId: parsed.workspaceId || parsed.workspace || parsed.sessionId || 'default',
    history: Array.isArray(parsed.history) ? parsed.history : [],
    execute: Boolean(parsed.execute),
    onEvent
  });
  return { ...response, councilMode: 'shared-workspace-team', rounds: response.activity.length };
}

function githubRepoConfig() {
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  const repo = String(process.env.GITHUB_REPOSITORY || 't86162100-byte/SIRE').trim();
  if (!token) throw new Error('GPT GitHub access is not configured: set GITHUB_TOKEN (or GH_TOKEN) on the SIRE service.');
  if (!/^[^/]+\/[^/]+$/.test(repo)) throw new Error('Invalid GITHUB_REPOSITORY configuration.');
  return { token, repo };
}

async function renderRequestForGpt({ method, path, body, permission }) {
  const token = String(process.env.RENDER_API_KEY || '').trim();
  const serviceId = String(process.env.RENDER_SERVICE_ID || 'srv-daprrarbc2fs73bqt1r0').trim();
  if (!token) throw new Error('GPT Render control is not configured: set RENDER_API_KEY on the SIRE service.');
  let normalizedPath = String(path || '').trim();
  if (!normalizedPath.startsWith('/')) normalizedPath = '/' + normalizedPath;
  const servicePrefix = '/v1/services/' + serviceId;
  if (!(normalizedPath === servicePrefix || normalizedPath.startsWith(servicePrefix + '/'))) {
    throw new Error('GPT Render access is limited to the configured SIRE service.');
  }
  const verb = String(method || 'GET').toUpperCase();
  const requestedPermission = String(permission || (verb === 'GET' ? 'read' : 'execute')).toLowerCase();
  if (verb === 'GET' && requestedPermission !== 'read') throw new Error('GET Render requests require read permission.');
  if (verb !== 'GET' && requestedPermission !== 'execute') throw new Error('Mutating Render requests require execute permission.');
  const response = await fetch('https://api.render.com' + normalizedPath, {
    method: verb,
    headers: {
      'Accept':'application/json',
      'Authorization':'Bearer ' + token,
      ...(body !== undefined ? {'Content-Type':'application/json'} : {}),
    },
    ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
  });
  const raw = await response.text();
  let data = raw;
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok) {
    const detail = typeof data === 'object' && data ? (data.message || data.error || JSON.stringify(data)) : String(data);
    throw new Error('Render API ' + response.status + ': ' + detail);
  }
  return JSON.stringify({ok:true,status:response.status,path:normalizedPath,result:data});
}

async function githubRequestForGpt({ method, path, body, permission }) {
  const { token, repo } = githubRepoConfig();
  const repoParts = repo.split('/');
  const owner = repoParts[0];
  const repoName = repoParts[1];
  let normalizedPath = String(path || '').trim();

  // GPT/OpenAI tool calls may wrap paths in Markdown/code quotes or omit the
  // leading slash/scheme. Strip presentation-only wrappers before parsing.
  normalizedPath = normalizedPath
    .replace(/^[\`'"\s]+|[\`'"\s]+$/g, '')
    .replace(/[\r\n]+/g, '');

  // GPT/OpenAI tool calls can return API paths, absolute api.github.com URLs,
  // github.com browser URLs, API-v3 proxy URLs, or a repo-relative endpoint.
  // Canonicalize all of those to the same GitHub REST path before authorization.
  try {
    if (/^https?:\/\/(?:www\.)?api\.github\.com/i.test(normalizedPath)) {
      const parsedUrl = new URL(normalizedPath);
      normalizedPath = parsedUrl.pathname + parsedUrl.search;
    } else if (/^(?:api\.github\.com|www\.github\.com|github\.com)\//i.test(normalizedPath)) {
      const parsedUrl = new URL('https://' + normalizedPath.replace(/^www\./i, ''));
      normalizedPath = parsedUrl.hostname.toLowerCase() === 'api.github.com'
        ? parsedUrl.pathname + parsedUrl.search
        : parsedUrl.pathname + parsedUrl.search;
    } else if (/^https?:\/\/(?:www\.)?github\.com/i.test(normalizedPath)) {
      const parsedUrl = new URL(normalizedPath);
      const parts = parsedUrl.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && parts[0].toLowerCase() === owner.toLowerCase() && parts[1].toLowerCase() === repoName.toLowerCase()) {
        const suffix = parts.slice(2);
        if (suffix[0] === 'blob' || suffix[0] === 'tree') {
          const ref = suffix[1] || '';
          const filePath = suffix.slice(2).join('/');
          normalizedPath = '/repos/' + repo + '/contents/' + filePath + (ref ? '?ref=' + encodeURIComponent(ref) : '');
        } else {
          normalizedPath = '/repos/' + repo + '/' + suffix.join('/');
        }
      }
    } else if (/^https?:\/\/[^/]+\/api\/v3\/repos\//i.test(normalizedPath)) {
      const parsedUrl = new URL(normalizedPath);
      normalizedPath = parsedUrl.pathname.replace(/^\/api\/v3/i, '') + parsedUrl.search;
    }
  } catch (error) {
    throw new Error('Invalid GitHub path supplied to GPT: ' + (error instanceof Error ? error.message : String(error)));
  }

  // Normalize encoding and harmless path formatting variants.
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(normalizedPath);
      if (decoded === normalizedPath) break;
      normalizedPath = decoded;
    } catch {
      break;
    }
  }
  if (normalizedPath.toLowerCase().startsWith('/api/v3/')) normalizedPath = normalizedPath.slice(7);
  normalizedPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath;

  // Also accept the common repo-relative form:
  //   t86162100-byte/SIRE/contents/...
  // and canonicalize it to the REST form required by GitHub.
  const ownerRepoPrefix = '/' + owner + '/' + repoName;
  if (normalizedPath.toLowerCase() === ownerRepoPrefix.toLowerCase()) {
    normalizedPath = '/repos/' + repo;
  } else if (normalizedPath.toLowerCase().startsWith(ownerRepoPrefix.toLowerCase() + '/')) {
    normalizedPath = '/repos/' + repo + normalizedPath.slice(ownerRepoPrefix.length);
  }

  const repoPrefix = '/repos/' + repo;
  const lowerPath = normalizedPath.toLowerCase();
  const lowerRepoPrefix = repoPrefix.toLowerCase();

  // Accept repo-relative GitHub REST endpoints too, while still forcing them
  // into the configured repository.
  const repoRelativePrefixes = [
    '/contents/', '/contents',
    '/branches/', '/branches',
    '/commits/', '/commits',
    '/git/', '/git',
    '/pulls/', '/pulls',
    '/issues/', '/issues',
    '/actions/', '/actions',
    '/deployments/', '/deployments',
    '/releases/', '/releases',
    '/collaborators/', '/collaborators',
  ];
  if (repoRelativePrefixes.some(prefix => lowerPath === prefix || lowerPath.startsWith(prefix))) {
    normalizedPath = repoPrefix + normalizedPath;
  }

  const finalLowerPath = normalizedPath.toLowerCase();
  const isRepoScoped = finalLowerPath === lowerRepoPrefix || finalLowerPath.startsWith(lowerRepoPrefix + '/');
  const isRepoSearch = finalLowerPath.startsWith('/search/code') ||
    finalLowerPath.startsWith('/search/commits') ||
    finalLowerPath.startsWith('/search/issues') ||
    finalLowerPath.startsWith('/search/repositories');

  if (!isRepoScoped && !isRepoSearch) {
    console.warn('[GPT GitHub] blocked path after normalization:', JSON.stringify({
      requestedPath: path,
      normalizedPath,
      configuredRepository: repo,
      method,
    }));
    throw new Error('GPT GitHub access is limited to the configured SIRE repository. Requested path: ' + String(path || '') + '. Normalized path: ' + normalizedPath + '. Use paths under ' + repoPrefix + ' for repository inspection and changes.');
  }

  const verb = String(method || 'GET').toUpperCase();
  const requestedPermission = String(permission || (verb === 'GET' ? 'read' : 'write')).toLowerCase();
  if (!['read','write','execute'].includes(requestedPermission)) throw new Error('Invalid GitHub permission.');
  if (verb === 'GET' && requestedPermission !== 'read') throw new Error('GET requests must use read permission.');
  if (verb !== 'GET' && requestedPermission === 'read') throw new Error('Mutating GitHub requests require write or execute permission.');

  const url = 'https://api.github.com' + normalizedPath;
  const response = await fetch(url, {
    method: verb,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SIRE-GPT',
      ...(body !== undefined && body !== null ? {'Content-Type':'application/json'} : {}),
    },
    ...(body !== undefined && body !== null ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let data = raw;
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok && response.status === 404 && verb === 'GET') {
    const branchPrefix = '/repos/' + repo + '/branches/';
    const lowerBranchPath = normalizedPath.toLowerCase();
    if (lowerBranchPath.startsWith(branchPrefix.toLowerCase())) {
      const requestedBranch = decodeURIComponent(normalizedPath.slice(branchPrefix.length));
      const listUrl = 'https://api.github.com/repos/' + repo + '/branches?per_page=100';
      const listResponse = await fetch(listUrl, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': 'Bearer ' + token,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'SIRE-GPT',
        },
      });
      if (listResponse.ok) {
        const list = await listResponse.json().catch(() => []);
        const branches = Array.isArray(list) ? list.map(item => String(item?.name || '')).filter(Boolean) : [];
        const normalizedRequested = requestedBranch.toLowerCase().replace(/\s+/g, '-');
        const matchedBranch = branches.find(name =>
          name.toLowerCase() === requestedBranch.toLowerCase() ||
          name.toLowerCase().replace(/\s+/g, '-') === normalizedRequested
        );
        if (matchedBranch) {
          normalizedPath = branchPrefix + encodeURIComponent(matchedBranch);
          const retryResponse = await fetch('https://api.github.com' + normalizedPath, {
            method: 'GET',
            headers: {
              'Accept': 'application/vnd.github+json',
              'Authorization': 'Bearer ' + token,
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'SIRE-GPT',
            },
          });
          const retryRaw = await retryResponse.text();
          let retryData = retryRaw;
          try { retryData = retryRaw ? JSON.parse(retryRaw) : {}; } catch {}
          if (retryResponse.ok) {
            return JSON.stringify({ ok:true, status:retryResponse.status, method:'GET', path:normalizedPath, result:retryData, branchResolvedFrom:requestedBranch });
          }
          data = retryData;
        }
      }
    }
  }
  if (!response.ok) {
    const detail = typeof data === 'object' && data ? (data.message || JSON.stringify(data)) : String(data);
    throw new Error('GitHub API ' + response.status + ': ' + detail);
  }
  return JSON.stringify({ ok:true, status:response.status, method:verb, path:normalizedPath, result:data });
}
async function marketDataRequestForGpt(input) {
  const symbol = String(input?.symbol || '').trim();
  const dataType = String(input?.dataType || 'candles').toLowerCase();
  const interval = input?.interval ? String(input.interval).trim() : '';
  const requestedCount = Math.max(1, Math.min(10000, Math.floor(Number(input?.count) || 100)));
  const from = Number.isFinite(Number(input?.from)) ? Math.floor(Number(input.from)) : undefined;
  const to = Number.isFinite(Number(input?.to)) ? Math.floor(Number(input.to)) : undefined;
  if (!symbol) throw new Error('Market-data request requires a symbol.');
  if (dataType !== 'candles' && dataType !== 'ticks') throw new Error('Market-data dataType must be candles or ticks.');
  if (dataType === 'candles' && !interval) throw new Error('Candle history requires an interval.');
  if (from !== undefined && to !== undefined && from > to) throw new Error('Market-data from must be before or equal to to.');

  const intervalSeconds = dataType === 'candles' ? ({
    '1m':60,'2m':120,'3m':180,'5m':300,'10m':600,'15m':900,'20m':1200,'30m':1800,'45m':2700,
    '1h':3600,'2h':7200,'3h':10800,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'1w':604800
  })[interval] : undefined;
  if (dataType === 'candles' && !intervalSeconds) throw new Error('Unsupported candle interval: ' + interval);

  const rangeCount = from !== undefined && to !== undefined && dataType === 'candles'
    ? Math.max(1, Math.ceil((to - from) / intervalSeconds) + 1)
    : undefined;
  const targetCount = rangeCount ? Math.min(10000, rangeCount) : requestedCount;
  const chunkSize = 1000;
  const chunks = [];
  let cursorEnd = to ?? 'latest';

  // Deriv's public market-data API accepts one-time historical requests. We
  // deliberately page large GPT requests in <=1000-point chunks and pace them
  // to avoid bursty traffic against the shared WebSocket budget.
  for (let remaining = targetCount; remaining > 0; remaining -= chunkSize) {
    const chunkCount = Math.min(chunkSize, remaining);
    const payload = dataType === 'ticks'
      ? {
          ticks_history: symbol,
          end: cursorEnd,
          ...(from !== undefined ? { start: from } : {}),
          count: chunkCount,
          style: 'ticks',
        }
      : {
          ticks_history: symbol,
          end: cursorEnd,
          ...(from !== undefined ? { start: from } : {}),
          count: chunkCount,
          style: 'candles',
          granularity: intervalSeconds,
        };

    const result = await requestDerivPublic(payload);
    if (dataType === 'ticks') {
      const history = result?.history || {};
      const times = Array.isArray(history.times) ? history.times : [];
      const prices = Array.isArray(history.prices) ? history.prices : [];
      for (let i = 0; i < Math.min(times.length, prices.length); i++) {
        const item = { epoch: Number(times[i]), price: Number(prices[i]) };
        if (Number.isFinite(item.epoch) && Number.isFinite(item.price)) chunks.push(item);
      }
      if (chunks.length < chunkCount || chunks.length >= targetCount) break;
      const oldest = Number(times[0]);
      if (!Number.isFinite(oldest)) break;
      cursorEnd = oldest - 1;
    } else {
      const candles = Array.isArray(result?.candles) ? result.candles : [];
      for (const candle of candles) {
        const item = {
          epoch: Number(candle?.epoch),
          open: Number(candle?.open),
          high: Number(candle?.high),
          low: Number(candle?.low),
          close: Number(candle?.close),
          ...(candle?.volume !== undefined ? { volume: Number(candle.volume) } : {}),
        };
        if (Number.isFinite(item.epoch) && Number.isFinite(item.open) && Number.isFinite(item.high) &&
            Number.isFinite(item.low) && Number.isFinite(item.close)) chunks.push(item);
      }
      if (candles.length < chunkCount || chunks.length >= targetCount) break;
      const oldest = Number(candles[0]?.epoch);
      if (!Number.isFinite(oldest)) break;
      cursorEnd = oldest - intervalSeconds;
    }
    if (remaining > chunkSize) await new Promise(resolve => setTimeout(resolve, 150));
  }

  const data = chunks
    .sort((a, b) => Number(a.epoch) - Number(b.epoch))
    .slice(-targetCount);

  return JSON.stringify({
    ok: true,
    dataType,
    symbol,
    ...(interval ? { interval, intervalSeconds } : {}),
    requested: { count: targetCount, from: from ?? null, to: to ?? 'latest' },
    returned: data.length,
    complete: data.length >= targetCount,
    pageSize: chunkSize,
    pages: Math.ceil(data.length / chunkSize),
    data,
  });
}

async function requestChartControlForGpt(input, onEvent) {
  const operations = Array.isArray(input?.operations) ? input.operations.slice(0, 10) : [];
  if (!operations.length) throw new Error('Chart control requires at least one operation.');
  const commandId = randomUUID();
  const timeoutMs = 15000;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingChartControls.delete(commandId);
      reject(new Error('Chart control timed out waiting for the SIRE chart runtime to execute and verify the request.'));
    }, timeoutMs);
    pendingChartControls.set(commandId, { resolve: value => { clearTimeout(timer); pendingChartControls.delete(commandId); resolve(value); }, reject });
  });
  await onEvent?.({
    actor: 'Chart',
    phase: 'working',
    text: 'Executing and verifying the requested chart operation…',
    chartControl: { commandId, operations },
  });
  return await promise;
}

function resolveChartControl(commandId, result) {
  const pending = pendingChartControls.get(String(commandId || ''));
  if (!pending) return false;
  pending.resolve(result);
  return true;
}

async function handleDirectGptRequest(parsed, onEvent) {
  const query = String(parsed.query || '').trim();
  if (!query) throw new Error('query is required');
  const gpt = await runGptHead({
    query,
    history: Array.isArray(parsed.history) ? parsed.history : [],
    chartSnapshot: parsed.chartSnapshot && typeof parsed.chartSnapshot === 'object' ? parsed.chartSnapshot : undefined,
    onEvent,
    tools: {
      githubRequest: githubRequestForGpt,
      renderRequest: renderRequestForGpt,
      marketDataRequest: marketDataRequestForGpt,
      chartControl: input => requestChartControlForGpt(input, onEvent),
      checkIntegrations: async () => {
        const result = {
          github: { configured: false, repository: String(process.env.GITHUB_REPOSITORY || 't86162100-byte/SIRE') },
          render: { configured: Boolean(process.env.RENDER_API_KEY), serviceId: String(process.env.RENDER_SERVICE_ID || 'srv-daprrarbc2fs73bqt1r0') }
        };
        try {
          const { repo } = githubRepoConfig();
          result.github.configured = true;
          result.github.repository = repo;
          await githubRequestForGpt({ method:'GET', path:'/repos/' + repo, permission:'read' });
          result.github.connected = true;
        } catch (error) {
          result.github.connected = false;
          result.github.error = error instanceof Error ? error.message : String(error);
        }
        if (result.render.configured) {
          try {
            const service = await renderRequestForGpt({ method:'GET', path:'/v1/services/' + result.render.serviceId, permission:'read' });
            result.render.connected = true;
            result.render.service = JSON.parse(service);
          } catch (error) {
            result.render.connected = false;
            result.render.error = error instanceof Error ? error.message : String(error);
          }
        } else {
          result.render.connected = false;
          result.render.error = 'RENDER_API_KEY is not configured on the SIRE service.';
        }
        return JSON.stringify(result);
      },
    },
  });
  return { text:gpt.text, responseId:gpt.responseId || '', model:gpt.model, provider:gpt.provider, actions:[], directGpt:true };
}

async function requestDerivPublic(payload, timeoutMs = 12000) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
    const reqId = Number(payload.req_id || Math.floor(Math.random() * 900000) + 100000);
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Deriv public market-data request timed out after 12 seconds.')), timeoutMs);
    ws.on('open', () => {
      try { ws.send(JSON.stringify({ ...payload, req_id: reqId })); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
    ws.on('message', data => {
      try {
        const parsed = JSON.parse(String(data));
        if (Number(parsed?.req_id) !== reqId) return;
        if (parsed?.error) {
          finish(new Error(parsed.error.message || parsed.error.code || 'Deriv market-data request failed.'));
          return;
        }
        finish(null, parsed);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    ws.on('error', error => finish(new Error(`Deriv public WebSocket error: ${error instanceof Error ? error.message : String(error)}`)));
    ws.on('close', (code, reason) => {
      if (!settled) finish(new Error(`Deriv public WebSocket closed before the request completed (code ${code})${reason ? `: ${String(reason)}` : ''}.`));
    });
  });
}

async function checkDerivPublicMarketDataOnce(timeoutMs = 7000) {
  const endpoints = [
    'wss://api.derivws.com/trading/v1/options/ws/public',
    'wss://ws.binaryws.com/websockets/v3',
  ];
  let lastFailure = null;

  for (const endpoint of endpoints) {
    const result = await new Promise(resolve => {
      const ws = new WebSocket(endpoint);
      let settled = false;
      const reqId = 900001;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(value);
      };
      const timer = setTimeout(() => finish({
        ok: false, stage: 'connect', endpoint,
        error: `Deriv public WebSocket connection timed out after ${timeoutMs}ms.`,
      }), timeoutMs);

      ws.on('open', () => {
        console.log('[DERIV STARTUP] WebSocket connected:', endpoint);
        try {
          ws.send(JSON.stringify({
            active_symbols: 'brief',
            ...(endpoint.includes('binaryws.com') ? { product_type: 'basic' } : {}),
            req_id: reqId,
          }));
        } catch (error) {
          finish({ ok: false, stage: 'request', endpoint,
            error: `Deriv active_symbols request could not be sent: ${error instanceof Error ? error.message : String(error)}` });
        }
      });

      ws.on('message', data => {
        try {
          const parsed = JSON.parse(String(data));
          if (parsed?.error) {
            finish({
              ok: false,
              stage: Number(parsed?.req_id) === reqId ? 'active_symbols' : 'response',
              endpoint,
              error: parsed.error.message || parsed.error.code || 'Deriv returned an unknown market-data error.',
              code: parsed.error.code || '',
            });
            return;
          }
          if (Number(parsed?.req_id) === reqId) {
            const count = Array.isArray(parsed?.active_symbols) ? parsed.active_symbols.length : 0;
            finish(count
              ? { ok: true, stage: 'active_symbols', endpoint, symbolCount: count, activeSymbols: parsed.active_symbols }
              : { ok: false, stage: 'active_symbols', endpoint, error: 'Deriv connected, but returned an empty active-symbol catalogue.' });
          }
        } catch (error) {
          finish({ ok: false, stage: 'response', endpoint, error: error instanceof Error ? error.message : String(error) });
        }
      });

      ws.on('error', error => finish({
        ok: false, stage: 'connect', endpoint,
        error: `Deriv public WebSocket error: ${error instanceof Error ? error.message : String(error)}`,
      }));

      ws.on('close', (code, reason) => {
        if (!settled) finish({
          ok: false, stage: 'connect', endpoint,
          error: `Deriv public WebSocket closed before startup completed (code ${code})${reason ? `: ${String(reason)}` : ''}.`,
        });
      });
    });

    if (result?.ok) return result;
    lastFailure = result;
    console.warn('[DERIV STARTUP] endpoint failed:', endpoint, result?.error || result);
  }

  return lastFailure || { ok: false, stage: 'connect', error: 'All Deriv public market-data endpoints failed.' };
}
async function checkDerivPublicMarketData() {
  const maxAttempts = 3;
  const retryDelaysMs = [0, 1200, 2500];
  let lastFailure = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (retryDelaysMs[attempt - 1] > 0) {
      await new Promise(resolve => setTimeout(resolve, retryDelaysMs[attempt - 1]));
    }

    console.log('[DERIV STARTUP] health attempt', attempt, 'of', maxAttempts);
    const result = await checkDerivPublicMarketDataOnce(7000);

    if (result.ok) {
      console.log('[DERIV STARTUP] health passed', JSON.stringify({ attempt, stage: result.stage, symbolCount: result.symbolCount }));
      return { ...result, attempts: attempt };
    }

    lastFailure = result;
    console.warn('[DERIV STARTUP] health attempt failed', JSON.stringify({ attempt, ...result }));

    // A request/response failure is retryable too: Deriv documents the public
    // endpoint as a no-auth market-data channel, so a transient connection or
    // response failure should not permanently block SIRE startup.
  }

  return {
    ...(lastFailure || { ok: false, stage: 'unknown', error: 'Deriv startup health check failed.' }),
    ok: false,
    attempts: maxAttempts,
  };
}

async function twelveDataRequest(path, params={}) {
  const apiKey=String(process.env.TWELVE_DATA_API_KEY||'').trim();
  if(!apiKey) throw new Error('TWELVE_DATA_API_KEY is not configured on Render.');
  const query=new URLSearchParams({...params,apikey:apiKey});
  const response=await fetch('https://api.twelvedata.com/'+path+'?'+query.toString(),{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
  const text=await response.text(); let data={}; try{data=text?JSON.parse(text):{};}catch{data={};}
  if(!response.ok || data?.status==='error' || data?.code) throw new Error('Twelve Data HTTP '+response.status+': '+String(data?.message||data?.code||text.slice(0,300)));
  return data;
}
function twelveDataExchange(provider,marketType){
  const p=String(provider||'').toUpperCase(), m=String(marketType||'').toUpperCase();
  if(p==='NASDAQTRADER') {
    if(m.includes('NYSE')) return 'NYSE';
    if(m.includes('AMEX')||m.includes('AMERICAN')) return 'AMEX';
    return 'NASDAQ';
  }
  if(p==='NYSEAMERICAN') return 'AMEX';
  return '';
}
function normalizeTwelveSymbol(provider,symbol){
  const p=String(provider||'').toUpperCase();
  const s=String(symbol||'').trim();
  if(p==='OANDA') return s.replace(/_/g,'/');
  return s;
}
async function universalMarketHistory({provider,symbol,marketType,category,interval,count,from,to}){
  const normalized=normalizeTwelveSymbol(provider,symbol);
  const exchange=twelveDataExchange(provider,marketType);
  const params={symbol:normalized,interval,outputsize:String(Math.min(5000,Math.max(2,Number(count)||500))),order:'ASC'};
  if(exchange) params.exchange=exchange;
  if(Number.isFinite(Number(from))) params.start_date=new Date(Number(from)*1000).toISOString();
  if(Number.isFinite(Number(to))) params.end_date=new Date(Number(to)*1000).toISOString();
  let data;
  try {
    data=await twelveDataRequest('time_series',params);
  } catch(first) {
    // Retry without exchange when the catalogue provider's venue name is not
    // accepted by Twelve Data; the symbol itself may still be globally unique.
    if(exchange) {
      delete params.exchange;
      data=await twelveDataRequest('time_series',params);
    } else throw first;
  }
  const values=Array.isArray(data?.values)?data.values:[];
  const bars=values.map(v=>({
    time:Math.floor(new Date(String(v.datetime||'')).getTime()/1000),
    open:Number(v.open),high:Number(v.high),low:Number(v.low),close:Number(v.close),volume:Number(v.volume)||0
  })).filter(v=>Number.isFinite(v.time)&&[v.open,v.high,v.low,v.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);
  if(!bars.length) throw new Error('Twelve Data returned no candles for '+normalized+'.');
  return bars;
}
async function universalMarketQuote({provider,symbol,marketType}){
  const normalized=normalizeTwelveSymbol(provider,symbol);
  const exchange=twelveDataExchange(provider,marketType);
  const params={symbol:normalized};
  if(exchange) params.exchange=exchange;
  let data;
  try { data=await twelveDataRequest('quote',params); }
  catch(first) { if(exchange){delete params.exchange;data=await twelveDataRequest('quote',params);} else throw first; }
  const price=Number(data?.close ?? data?.price);
  const epoch=Number(data?.timestamp)||Math.floor(Date.now()/1000);
  if(!Number.isFinite(price)) throw new Error('Twelve Data returned no live price for '+normalized+'.');
  return {symbol,epoch,price,bid:Number(data?.bid),ask:Number(data?.ask),volume:Number(data?.volume)||0};
}


async function bitgetWalletRequest(path, body) {
  const apiKey=String(process.env.BITGET_WALLET_API_KEY||'').trim();
  const apiSecret=String(process.env.BITGET_WALLET_API_SECRET||'').trim();
  if(!apiKey||!apiSecret) throw new Error('Bitget Wallet routing is not configured on SIRE. Add BITGET_WALLET_API_KEY and BITGET_WALLET_API_SECRET.');
  const timestamp=String(Date.now());
  const rawBody=JSON.stringify(body||{});
  const content={'apiPath':path,'body':rawBody,'x-api-key':apiKey,'x-api-timestamp':timestamp};
  const payload=JSON.stringify(Object.fromEntries(Object.keys(content).sort().map(key=>[key,content[key]])));
  const signature=createHmac('sha256',apiSecret).update(payload).digest('base64');
  const response=await fetch('https://bopenapi.bgwapi.io'+path,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','x-api-key':apiKey,'x-api-timestamp':timestamp,'x-api-signature':signature},body:rawBody,signal:AbortSignal.timeout(12000)});
  const raw=await response.text(); let data={}; try{data=raw?JSON.parse(raw):{};}catch{}
  if(!response.ok||Number(data?.status)!==0){const error=new Error('Bitget Wallet '+response.status+': '+String(data?.msg||data?.message||data?.title||raw.slice(0,500)||('HTTP '+response.status))); error.status=response.status; error.code=data?.error_code??data?.code??null; throw error;}
  return data?.data??data;
}
const server = http.createServer(async (req,res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204,{ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization' }); return res.end(); }
  if (await serveStatic(req,res)) return;
  let body=''; req.on('data',chunk=>{body+=chunk;}); req.on('end',async()=>{ try {
    const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    if(req.method==='POST' && pathname.startsWith('/api/sire/swap/bitget/')){
      const json=(status,payload)=>res.writeHead(status,{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(payload));
      try{
        const action=pathname.slice('/api/sire/swap/bitget/'.length);
        if(!['quote','swap'].includes(action)) return json(404,{ok:false,error:'Unknown Bitget Wallet swap endpoint.'});
        const parsed=body?JSON.parse(body):{};
        const crossChain=String(parsed?.fromChain||'')!==String(parsed?.toChain||'');
        const apiPath=action==='quote'
          ? (crossChain?'/bgw-pro/swapx/order/getSwapPrice':'/bgw-pro/swapx/pro/quote')
          : (crossChain?'/bgw-pro/swapx/order/makeSwapOrder':'/bgw-pro/swapx/pro/swap');
        const data=await bitgetWalletRequest(apiPath,parsed);
        return json(200,{ok:true,data});
      }catch(cause){const status=Number(cause?.status)>=400&&Number(cause?.status)<600?Number(cause.status):503;return json(status,{ok:false,error:cause instanceof Error?cause.message:String(cause),code:cause?.code??null});}
    }
    if (req.method === 'GET' && pathname === '/api/sire/market-data/history') {
      try {
        const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
        const bars=await universalMarketHistory({
          provider:u.searchParams.get('provider')||'',symbol:u.searchParams.get('symbol')||'',
          marketType:u.searchParams.get('marketType')||'',category:u.searchParams.get('category')||'',
          interval:u.searchParams.get('interval')||'1min',count:Number(u.searchParams.get('count')||500),
          from:Number(u.searchParams.get('from')),to:Number(u.searchParams.get('to'))
        });
        return res.writeHead(200,{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({ok:true,bars}));
      } catch(e) { return res.writeHead(502,{'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({ok:false,error:e instanceof Error?e.message:String(e)})); }
    }
    if (req.method === 'GET' && pathname === '/api/sire/market-data/quote') {
      try {
        const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
        const quote=await universalMarketQuote({provider:u.searchParams.get('provider')||'',symbol:u.searchParams.get('symbol')||'',marketType:u.searchParams.get('marketType')||''});
        return res.writeHead(200,{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({ok:true,quote}));
      } catch(e) { return res.writeHead(502,{'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({ok:false,error:e instanceof Error?e.message:String(e)})); }
    }
    if (pathname === '/api/auth/google' && req.method === 'GET') {
      try { const result = await googleStart(req); return res.writeHead(302,{Location:result.url,'Set-Cookie':result.setCookie,'Cache-Control':'no-store'}).end(); }
      catch (cause) { const message=cause instanceof Error?cause.message:String(cause); return res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'}).end(message); }
    }
    if (pathname === '/api/auth/google/callback' && req.method === 'GET') {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      try { const result = await googleCallback(req,url.searchParams.get('code') || '',url.searchParams.get('state') || ''); return res.writeHead(302,{Location:'/', 'Set-Cookie':result.setCookie,'Cache-Control':'no-store'}).end(); }
      catch (cause) { const message=cause instanceof Error?cause.message:String(cause); return res.writeHead(302,{Location:`/?auth_error=${encodeURIComponent(message)}`,'Cache-Control':'no-store'}).end(); }
    }
    if (pathname === '/api/auth/me' && req.method === 'GET') { const user = await currentUser(req); return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Credentials':'true' }).end(JSON.stringify({ user })); }
    if (pathname === '/api/auth/signup' && req.method === 'POST') { const parsed = body ? JSON.parse(body) : {}; try { const result = await signup({ headers:req.headers, body:parsed }); return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Credentials':'true','Set-Cookie':result.setCookie }).end(JSON.stringify({ user:result.user })); } catch (cause) { const message=cause instanceof Error?cause.message:String(cause); return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Credentials':'true' }).end(JSON.stringify({ error:message })); } }
    if (pathname === '/api/auth/login' && req.method === 'POST') { const parsed = body ? JSON.parse(body) : {}; try { const result = await login({ headers:req.headers, body:parsed }); return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Credentials':'true','Set-Cookie':result.setCookie }).end(JSON.stringify({ user:result.user })); } catch (cause) { const message=cause instanceof Error?cause.message:String(cause); return res.writeHead(401,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Credentials':'true' }).end(JSON.stringify({ error:message })); } }
    if (pathname === '/api/auth/logout' && req.method === 'POST') { const result = await logout(req); return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Credentials':'true','Set-Cookie':result.setCookie }).end(JSON.stringify({ ok:true })); }
    if (req.method === 'POST' && pathname === '/api/sire/issues') {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const issue = recordIssue(parsed);
        console.error('[SIRE ISSUE TRACE]', JSON.stringify(issue));
        return res.writeHead(201,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ok:true,issue}));
      } catch (cause) {
        return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ok:false,error:cause instanceof Error?cause.message:String(cause)}));
      }
    }
    if (req.method === 'GET' && pathname === '/api/sire/issues') {
      return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ok:true,issues:getRecentIssues()}));
    }
    if (req.method === 'POST' && pathname === '/api/sire/autonomous/run') {
      const supplied = String(req.headers['x-sire-autonomous-token'] || '').trim();
      const expected = String(process.env.SIRE_AUTONOMOUS_TRIGGER_TOKEN || '').trim();
      if (!expected || supplied !== expected) {
        return res.writeHead(401,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ ok:false, error:'Autonomous trigger is not authorized.' }));
      }
      try {
        const result = await runAutonomousCycle();
        return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ ok:true, result }));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error('[AUTONOMOUS SIRE]', message);
        return res.writeHead(502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ ok:false,error:message }));
      }
    }
    if (req.method === 'GET' && pathname === '/api/sire/diagnostics') { try { const report = await runSireDiagnostics(); return res.writeHead(report.ok ? 200 : 502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(report)); } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); return res.writeHead(500,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ ok:false, error:message, noSecrets:true })); } }
    if (req.method === 'POST' && pathname === '/api/sire/deriv/history') {
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch { return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'Invalid JSON request.' })); }
      const symbol = String(parsed.symbol || '').trim();
      const count = Math.max(1, Math.min(1000, Number(parsed.count) || 500));
      const granularity = Math.max(1, Math.floor(Number(parsed.granularity) || 60));
      const end = parsed.end === undefined ? 'latest' : parsed.end;
      if (!symbol) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'symbol is required' }));

      const interval = granularity >= 604800 ? '1w'
        : granularity >= 86400 ? '1d'
        : granularity % 3600 === 0 ? `${granularity / 3600}h`
        : `${granularity / 60}m`;

      let providerError = '';
      let providerResult = null;
      try {
        providerResult = await requestDerivPublic({ ticks_history:symbol, end, count, style:'candles', granularity, adjust_start_time:1 });
        const providerBars = Array.isArray(providerResult?.candles) ? providerResult.candles : [];
        if (providerBars.length) await persistHistoryBars(symbol, interval, providerBars);
      } catch (cause) {
        providerError = cause instanceof Error ? cause.message : String(cause);
      }

      const stored = await getStoredHistory(symbol, interval, end, count);
      const providerBars = Array.isArray(providerResult?.candles) ? providerResult.candles : [];
      const byEpoch = new Map();
      for (const candle of [...stored.bars, ...providerBars]) {
        const epoch = Number(candle?.epoch);
        if (Number.isFinite(epoch)) byEpoch.set(epoch, candle);
      }
      const candles = [...byEpoch.values()].sort((a, b) => Number(a.epoch) - Number(b.epoch)).slice(-count);

      if (providerResult) {
        console.log('[DERIV HISTORY]', symbol, granularity, count, end, `stored=${stored.bars.length}`);
        return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({
          ...providerResult,
          candles,
          sireHistoryStore: { enabled: stored.enabled, chunks: stored.chunks, returned: candles.length },
        }));
      }

      if (candles.length) {
        console.log('[DERIV HISTORY] PROVIDER FALLBACK', symbol, granularity, count, end, `stored=${candles.length}`);
        return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({
          msg_type:'candles',
          candles,
          sireHistoryStore: { enabled: stored.enabled, chunks: stored.chunks, returned: candles.length, providerError },
        }));
      }

      console.error('[DERIV HISTORY] FAIL', symbol, providerError || 'No candles available from provider or persistent history store.');
      return res.writeHead(502,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({
        error: providerError || 'No candles available from Deriv or SIRE persistent history store.',
        symbol, granularity, count, end,
        sireHistoryStore: { enabled: stored.enabled, chunks: stored.chunks },
      }));
    }
    if (req.method === 'GET' && pathname === '/api/sire/deriv/history/status') {
      const status = await historyStoreStatus();
      return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(status));
    }
    if (req.method === 'GET' && pathname === '/api/sire/deriv/health') { const result = await checkDerivPublicMarketData(); console.log('[DERIV HEALTH]', JSON.stringify(result)); return res.writeHead(result.ok ? 200 : 502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(result)); }
    if (req.method === 'POST' && pathname === '/api/sire/agent/chat') { const parsed = body ? JSON.parse(body) : {}; const response = await handleGeminiRequest(parsed); return res.writeHead(response.status,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response.body ?? {})); }
    if (req.method === 'POST' && pathname === '/api/sire/chart/control-result') {
      const parsed = body ? JSON.parse(body) : {};
      const ok = resolveChartControl(parsed.commandId, parsed.result || { ok: false, error: 'Missing chart control result.' });
      return res.writeHead(ok ? 200 : 404,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ ok }));
    }
    if (req.method === 'GET' && pathname === '/api/sire/agent/gpt/status') {
      const url = new URL(req.url || '/', `http://sire.local`);
      const requestId = String(url.searchParams.get('requestId') || '').trim();
      pruneGptJobs();
      const job = gptJobs.get(requestId);
      if (!requestId || !job) return res.writeHead(404,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ ok:false,error:'GPT request not found.' }));
      return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ ok:true,requestId,status:job.status,startedAt:job.startedAt,finishedAt:job.finishedAt,lastActivity:job.lastActivity||null,response:job.status==='completed'?job.response:null,error:job.status==='failed'?job.error:null }));
    }
    if (req.method === 'POST' && pathname === '/api/sire/agent/gpt/stream') {
      const parsed = body ? JSON.parse(body) : {};
      if (!String(parsed.query || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'query is required' }));
      const requestId = `gpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sendEvent = (type, payload) => {
        if (res.writableEnded || res.destroyed) return;
        try { res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`); } catch {}
      };
      res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-cache, no-transform','Content-Type':'text/event-stream; charset=utf-8','Connection':'keep-alive','X-Accel-Buffering':'no','X-SIRE-GPT-Request-Id':requestId,'Access-Control-Expose-Headers':'X-SIRE-GPT-Request-Id' });
      res.flushHeaders?.();
      res.socket?.setKeepAlive?.(true);
      const heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) {
          try { res.write(`: keep-alive ${Date.now()}\\n\\n`); } catch {}
        }
      }, 5000);
      sendEvent('gpt.status',{actor:'SIRE',phase:'starting',text:`SIRE connected. GPT request ${requestId} is starting.`,requestId});
      startGptJob(requestId, parsed, sendEvent);
      req.on('close', () => {
        // IMPORTANT: closing the browser/SSE connection does NOT cancel GPT.
        // The job continues server-side and remains recoverable by requestId.
        console.log('[DIRECT GPT STREAM] client connection closed; GPT job continues', requestId);
      });
      const finishWait = setInterval(() => {
        const job = gptJobs.get(requestId);
        if (!job || job.status === 'running') return;
        clearInterval(finishWait);
        clearInterval(heartbeat);
        if (!res.writableEnded && !res.destroyed) {
          if (job.status === 'completed') sendEvent('gpt.done', job.response);
          else sendEvent('gpt.error', job.error);
          try { res.end(); } catch {}
        }
      }, 500);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/sire/agent/gpt') { const parsed = body ? JSON.parse(body) : {}; if (!String(parsed.query || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'query is required' })); try { const response = await handleDirectGptRequest(parsed); return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response)); } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); console.error('[DIRECT GPT]', message); return res.writeHead(502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:`Direct GPT test failed: ${message}` })); } }
    if (pathname.startsWith('/api/sire/limit-orders')) {
  const apiKey = String(process.env.ZEROX_API_KEY || '').trim();
  const json = (status, payload) => res.writeHead(status, {'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(payload));
  const supportedChains = new Set([1,56,137,8453,42161,43114]);
  const chainBase = (chainId) => {
    if (!supportedChains.has(Number(chainId))) throw new Error('0x Limit Orders are not enabled for this network.');
    return String(process.env.ZEROX_ORDERBOOK_BASE_URL || 'https://api.0x.org/orderbook/v1').replace(/\/$/,'');
  };
  const authHeaders = {'0x-api-key': apiKey, '0x-version': 'v2', Accept:'application/json', 'Content-Type':'application/json'};
  try {
    if (!apiKey) return json(503, {ok:false, error:'0x Limit Orders are not configured yet. Add ZEROX_API_KEY to the SIRE Render service.'});
    const makerMatch = pathname.match(/^\/api\/sire\/limit-orders\/maker\/(\d+)\/(0x[a-fA-F0-9]{40})$/);
    if (req.method === 'GET' && makerMatch) {
      const chainId=Number(makerMatch[1]); const maker=makerMatch[2];
      const upstream=await fetch(chainBase(chainId) + '/orders?maker=' + encodeURIComponent(maker) + '&page=1&perPage=100',{headers:authHeaders});
      const raw=await upstream.text(); let result={}; try{result=raw?JSON.parse(raw):{};}catch{result={raw};}
      if(!upstream.ok) return json(upstream.status,{ok:false,error:String(result?.reason||result?.message||result?.error||raw.slice(0,500)||'0x rejected the order query.'),upstream:result});
      return json(200,{ok:true,orders:Array.isArray(result?.records)?result.records.map((item)=>({...(item?.order||{}),orderHash:item?.metaData?.orderHash,remainingFillableTakerAmount:item?.metaData?.remainingFillableTakerAmount,createdAt:item?.metaData?.createdAt})):[]});
    }
    const orderMatch=pathname.match(/^\/api\/sire\/limit-orders\/(\d+)\/(0x[0-9a-fA-F]{64})$/);
    if(req.method==='GET' && orderMatch){
      const chainId=Number(orderMatch[1]); const hash=orderMatch[2];
      const upstream=await fetch(chainBase(chainId) + '/order/' + hash,{headers:authHeaders});
      const raw=await upstream.text(); let result={}; try{result=raw?JSON.parse(raw):{};}catch{result={raw};}
      if(!upstream.ok) return json(upstream.status,{ok:false,error:String(result?.reason||result?.message||result?.error||raw.slice(0,500)||'0x rejected the order status query.'),upstream:result});
      return json(200,{ok:true,order:result});
    }
    if (req.method === 'POST' && pathname === '/api/sire/limit-orders/submit') {
      const parsed = body ? JSON.parse(body) : {};
      const chainId=Number(parsed?.chainId||parsed?.data?.chainId||0);
      const orderHash=String(parsed?.orderHash||''); const signature=String(parsed?.signature||''); const data=parsed?.data;
      if(!supportedChains.has(chainId)) return json(400,{ok:false,error:'0x Limit Orders are not enabled for this network.'});
      if(!/^0x[0-9a-fA-F]{64}$/.test(orderHash)) return json(400,{ok:false,error:'Invalid limit order hash.'});
      if(!/^0x[0-9a-fA-F]{130}$/.test(signature)) return json(400,{ok:false,error:'Invalid limit order signature.'});
      if(!data||typeof data!=='object') return json(400,{ok:false,error:'Missing limit order data.'});
      const sig={signatureType:2,r:'0x'+signature.slice(2,66),s:'0x'+signature.slice(66,130),v:parseInt(signature.slice(130,132),16)};
      if(sig.v===0||sig.v===1) sig.v+=27;
      const signedOrder={...data,chainId,verifyingContract:'0xdef1c0ded9bec7f1a1670819833240f027b25eff',signature:sig};
      const upstream=await fetch(chainBase(chainId) + '/order',{method:'POST',headers:authHeaders,body:JSON.stringify(signedOrder)});
      const raw=await upstream.text(); let result={}; try{result=raw?JSON.parse(raw):{};}catch{result={raw};}
      if(!upstream.ok) return json(upstream.status,{ok:false,error:String(result?.reason||result?.message||result?.error||raw.slice(0,500)||'0x rejected the limit order.'),upstream:result});
      return json(201,{ok:true,orderHash,result});
    }
    return json(404,{ok:false,error:'Unknown 0x limit-order endpoint.'});
  } catch (cause) {
    return json(502,{ok:false,error:cause instanceof Error ? cause.message : String(cause)});
  }
}
;