import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

const { handler } = await import('./backend/index.ts');
import { handleGeminiRequest } from './backend/gemini-ai.ts';
import { runGptHead, analyzeBars } from './backend/openrouter-ai.ts';
import { ws, db } from './compat/appdeploy-sdk/index.js';
import { realtime } from './backend/realtime.ts';
import { getStoredHistory, persistHistoryBars, historyStoreStatus } from './backend/deriv-history-store.ts';
import { signup, login, logout, currentUser, googleStart, googleCallback } from './backend/auth.ts';
import { runSireDiagnostics } from './backend/sire-diagnostics.ts';
import { recordIssue, getRecentIssues } from './backend/sire-issue-tracker.ts';

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const DIST = join(process.cwd(), 'dist');
const pendingChartControls = new Map();
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
  return await new Promise((resolve) => {
    const endpoint = 'wss://api.derivws.com/trading/v1/options/ws/public';
    const ws = new WebSocket(endpoint);
    let settled = false;
    const reqId = 900001;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => finish({
      ok: false,
      stage: 'connect',
      error: `Deriv public WebSocket connection timed out after ${timeoutMs}ms.`,
    }), timeoutMs);

    ws.on('open', () => {
      console.log('[DERIV STARTUP] WebSocket connected; requesting active_symbols.');
      try {
        ws.send(JSON.stringify({ active_symbols: 'brief', req_id: reqId }));
      } catch (error) {
        finish({
          ok: false,
          stage: 'request',
          error: `Deriv active_symbols request could not be sent: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });

    ws.on('message', data => {
      try {
        const parsed = JSON.parse(String(data));
        if (parsed?.error) {
          finish({
            ok: false,
            stage: Number(parsed?.req_id) === reqId ? 'active_symbols' : 'response',
            error: parsed.error.message || parsed.error.code || 'Deriv returned an unknown market-data error.',
            code: parsed.error.code || '',
          });
          return;
        }
        if (Number(parsed?.req_id) === reqId) {
          const count = Array.isArray(parsed?.active_symbols) ? parsed.active_symbols.length : 0;
          finish(count
            ? { ok: true, stage: 'active_symbols', symbolCount: count, activeSymbols: parsed.active_symbols }
            : { ok: false, stage: 'active_symbols', error: 'Deriv connected, but returned an empty active-symbol catalogue.' });
        }
      } catch (error) {
        finish({ ok: false, stage: 'response', error: error instanceof Error ? error.message : String(error) });
      }
    });

    ws.on('error', error => finish({
      ok: false,
      stage: 'connect',
      error: `Deriv public WebSocket error: ${error instanceof Error ? error.message : String(error)}`,
    }));

    ws.on('close', (code, reason) => {
      if (!settled) finish({
        ok: false,
        stage: 'connect',
        error: `Deriv public WebSocket closed before startup completed (code ${code})${reason ? `: ${String(reason)}` : ''}.`,
      });
    });
  });
}

const OBSERVER_CONFIG_TABLE = 'sire_market_observer_config_v1';
const OBSERVER_STATE_TABLE = 'sire_market_observer_state_v1';
const OBSERVER_EVENT_TABLE = 'sire_market_observer_events_v1';
let observerTimer = null;
let observerBusy = false;

function observerUserKey(user) {
  return String(user?.id || user?.email || user?.userId || '').trim();
}
function observerDefaults(userKey) {
  return { ownerKey:userKey, enabled:false, symbols:['WLDAUD'], intervals:['1m','5m','15m'], lookback:200, pollSeconds:60, updatedAt:Date.now() };
}
async function getObserverConfig(userKey) {
  const rows = await db.list(OBSERVER_CONFIG_TABLE,{limit:1000});
  return rows.items.find(item=>String(item?.ownerKey||'')===userKey) || observerDefaults(userKey);
}
async function saveObserverConfig(userKey,patch) {
  const rows=await db.list(OBSERVER_CONFIG_TABLE,{limit:1000});
  const existing=rows.items.find(item=>String(item?.ownerKey||'')===userKey);
  const base=existing||observerDefaults(userKey);
  const config={...base,...patch,ownerKey:userKey,enabled:Boolean(patch?.enabled??base.enabled),
    symbols:Array.from(new Set((Array.isArray(patch?.symbols)?patch.symbols:base.symbols).map(x=>String(x).trim().toUpperCase()).filter(Boolean))).slice(0,10),
    intervals:Array.from(new Set((Array.isArray(patch?.intervals)?patch.intervals:base.intervals).map(x=>String(x).trim()).filter(x=>['1m','5m','15m','30m','1h'].includes(x)))).slice(0,5),
    lookback:Math.max(30,Math.min(1000,Math.floor(Number(patch?.lookback??base.lookback)||200))),
    pollSeconds:Math.max(30,Math.min(900,Math.floor(Number(patch?.pollSeconds??base.pollSeconds)||60))),updatedAt:Date.now()};
  if(!config.symbols.length) config.symbols=['WLDAUD'];
  if(!config.intervals.length) config.intervals=['1m'];
  if(existing?.id) await db.update(OBSERVER_CONFIG_TABLE,[{id:existing.id,record:config}]);
  else await db.add(OBSERVER_CONFIG_TABLE,[config]);
  return config;
}
async function observerState(userKey,symbol,interval) {
  const rows=await db.list(OBSERVER_STATE_TABLE,{limit:5000});
  return rows.items.find(item=>String(item?.ownerKey||'')===userKey&&item.symbol===symbol&&item.interval===interval&&item.id);
}
function observerEventDiff(previous,analysis) {
  if(!analysis?.ok) return [];
  const events=[];
  const trend=String(analysis.trend?.label||'');
  const breakout=String(analysis.breakout?.status||'none');
  const rsi=Number(analysis.momentum?.rsi14);
  const close=Number(analysis.latest?.close);
  const previousTrend=String(previous?.trend||'');
  const previousBreakout=String(previous?.breakout||'none');
  const previousRsi=Number(previous?.rsi);
  if(previous&&trend&&previousTrend&&trend!==previousTrend) events.push({type:'trend_change',message:'Trend changed from '+previousTrend+' to '+trend+'.'});
  if(breakout!==previousBreakout&&breakout!=='none') events.push({type:'breakout',message:'20-bar close breakout detected: '+breakout+'.'});
  if(previous&&Number.isFinite(previousRsi)&&Number.isFinite(rsi)){
    if(previousRsi>=30&&rsi<30) events.push({type:'rsi_oversold',message:'RSI crossed below 30: '+rsi.toFixed(2)+'.'});
    if(previousRsi<=70&&rsi>70) events.push({type:'rsi_overbought',message:'RSI crossed above 70: '+rsi.toFixed(2)+'.'});
  }
  if(previous&&Number.isFinite(Number(previous.close))&&Number.isFinite(close)){
    const sma20=Number(analysis.movingAverages?.sma20), prevSma20=Number(previous.sma20);
    if(Number.isFinite(sma20)&&Number.isFinite(prevSma20)){
      const wasBelow=Number(previous.close)<prevSma20, isBelow=close<sma20;
      if(wasBelow!==isBelow) events.push({type:'ma20_cross',message:'Price crossed '+(isBelow?'below':'above')+' SMA20.'});
    }
  }
  return events;
}
async function observerTick() {
  if(observerBusy) return {ok:false,skipped:true,reason:'observer_tick_already_running'};
  observerBusy=true; const startedAt=Date.now(); let observations=0,events=0,failures=0;
  try {
    const configs=(await db.list(OBSERVER_CONFIG_TABLE,{limit:1000})).items.filter(item=>item?.enabled&&item?.ownerKey);
    for(const config of configs) for(const symbol of config.symbols||[]) for(const interval of config.intervals||[]) {
      try {
        const raw=await marketDataRequestForGpt({symbol,interval,count:config.lookback||200,dataType:'candles'});
        const parsed=JSON.parse(raw), bars=Array.isArray(parsed?.data)?parsed.data:[];
        const analysis=analyzeBars(bars,config.lookback||200);
        if(!analysis?.ok) throw new Error(analysis?.error||'Observer analysis failed.');
        const previous=await observerState(config.ownerKey,symbol,interval);
        const detected=observerEventDiff(previous,analysis), now=Date.now();
        const stateRecord={ownerKey:config.ownerKey,symbol,interval,observedAt:now,source:'controlled Deriv public candle data',range:analysis.range,latest:analysis.latest,trend:analysis.trend?.label||null,breakout:analysis.breakout?.status||'none',rsi:analysis.momentum?.rsi14??null,atr14:analysis.volatility?.atr14??null,sma20:analysis.movingAverages?.sma20??null,analysis,updatedAt:now};
        if(previous?.id) await db.update(OBSERVER_STATE_TABLE,[{id:previous.id,record:stateRecord}]); else await db.add(OBSERVER_STATE_TABLE,[stateRecord]);
        observations++;
        for(const event of detected){await db.add(OBSERVER_EVENT_TABLE,[{ownerKey:config.ownerKey,symbol,interval,type:event.type,message:event.message,observedAt:now,evidence:{latest:analysis.latest,trend:analysis.trend,breakout:analysis.breakout,rsi:analysis.momentum?.rsi14,atr14:analysis.volatility?.atr14}}]);events++;}
      } catch(error){failures++;console.warn('[SIRE OBSERVER] observation failed',JSON.stringify({ownerKey:config.ownerKey,symbol,interval,error:error instanceof Error?error.message:String(error)}));}
    }
    return {ok:true,observations,events,failures,durationMs:Date.now()-startedAt};
  } finally {observerBusy=false;}
}
async function ensureObserverLoop() {
  if(observerTimer) return;
  const rows=await db.list(OBSERVER_CONFIG_TABLE,{limit:1000});
  if(!rows.items.some(item=>item?.enabled)) return;
  observerTimer=setInterval(()=>{void observerTick();},60000);
  void observerTick();
  console.log('[SIRE OBSERVER] loop started; interval=60s');
}
function stopObserverLoopIfIdle(){
  if(!observerTimer)return;
  void db.list(OBSERVER_CONFIG_TABLE,{limit:1000}).then(rows=>{
    if(rows.items.some(item=>item?.enabled))return;
    clearInterval(observerTimer);observerTimer=null;console.log('[SIRE OBSERVER] loop stopped; no enabled observers');
  }).catch(()=>{});
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

const server = http.createServer(async (req,res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204,{ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization' }); return res.end(); }
  if (await serveStatic(req,res)) return;
  let body=''; req.on('data',chunk=>{body+=chunk;}); req.on('end',async()=>{ try {
    const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
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
    if (pathname === '/api/sire/observer/status' && req.method === 'GET') {
      const user=await currentUser(req), ownerKey=observerUserKey(user);
      if(!ownerKey)return res.writeHead(401,{'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({ok:false,error:'Authentication required.'}));
      const config=await getObserverConfig(ownerKey);
      const states=(await db.list(OBSERVER_STATE_TABLE,{limit:5000})).items.filter(item=>String(item?.ownerKey||'')===ownerKey).slice(-100);
      const recentEvents=(await db.list(OBSERVER_EVENT_TABLE,{limit:5000})).items.filter(item=>String(item?.ownerKey||'')===ownerKey).sort((a,b)=>Number(b?.observedAt||0)-Number(a?.observedAt||0)).slice(0,50);
      return res.writeHead(200,{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Credentials':'true'}).end(JSON.stringify({ok:true,mode:'market_observer_core',runtimeLoop:Boolean(observerTimer),busy:observerBusy,config,states,recentEvents}));
    }
    if (pathname === '/api/sire/observer/config' && req.method === 'POST') {
      const user=await currentUser(req), ownerKey=observerUserKey(user);
      if(!ownerKey)return res.writeHead(401,{'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({ok:false,error:'Authentication required.'}));
      let parsed={};try{parsed=body?JSON.parse(body):{};}catch{return res.writeHead(400,{'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({ok:false,error:'Invalid JSON request.'}));}
      const config=await saveObserverConfig(ownerKey,parsed);await ensureObserverLoop();
      return res.writeHead(200,{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Credentials':'true'}).end(JSON.stringify({ok:true,config}));
    }
    if (pathname === '/api/sire/observer/start' && req.method === 'POST') {
      const user=await currentUser(req), ownerKey=observerUserKey(user);
      if(!ownerKey)return res.writeHead(401,{'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({ok:false,error:'Authentication required.'}));
      const config=await saveObserverConfig(ownerKey,{enabled:true});await ensureObserverLoop();
      return res.writeHead(200,{'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Credentials':'true'}).end(JSON.stringify({ok:true,config,mode:'opportunistic_web_service_loop'}));
    }
    if (pathname === '/api/sire/observer/stop' && req.method === 'POST') {
      const user=await currentUser(req), ownerKey=observerUserKey(user);
      if(!ownerKey)return res.writeHead(401,{'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({ok:false,error:'Authentication required.'}));
      const config=await saveObserverConfig(ownerKey,{enabled:false});stopObserverLoopIfIdle();
      return res.writeHead(200,{'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Credentials':'true'}).end(JSON.stringify({ok:true,config}));
    }
    if (req.method === 'GET' && pathname === '/api/sire/deriv/health') { const result = await checkDerivPublicMarketData(); console.log('[DERIV HEALTH]', JSON.stringify(result)); return res.writeHead(result.ok ? 200 : 502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(result)); }
    if (req.method === 'POST' && pathname === '/api/sire/agent/chat') { const parsed = body ? JSON.parse(body) : {}; const response = await handleGeminiRequest(parsed); return res.writeHead(response.status,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response.body ?? {})); }
    if (req.method === 'POST' && pathname === '/api/sire/chart/control-result') {
      const parsed = body ? JSON.parse(body) : {};
      const ok = resolveChartControl(parsed.commandId, parsed.result || { ok: false, error: 'Missing chart control result.' });
      return res.writeHead(ok ? 200 : 404,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ ok }));
    }
    if (req.method === 'POST' && pathname === '/api/sire/agent/gpt/stream') {
      const parsed = body ? JSON.parse(body) : {};
      if (!String(parsed.query || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'query is required' }));
      const requestId = `gpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sendEvent = (type, payload) => {
        if (res.writableEnded) return;
        res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
      };
      res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-cache, no-transform','Content-Type':'text/event-stream; charset=utf-8','Connection':'keep-alive','X-Accel-Buffering':'no' });
      res.flushHeaders?.();
      res.socket?.setKeepAlive?.(true);
      // Render/proxy layers can close an otherwise healthy SSE response while GPT is
      // waiting on a slow upstream model call. Send comment heartbeats so the stream
      // stays active even when no user-visible status event is ready.
      const heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) {
          try { res.write(`: keep-alive ${Date.now()}\\n\\n`); } catch {}
        }
      }, 5000);
      sendEvent('gpt.status',{actor:'SIRE',phase:'starting',text:`SIRE connected. GPT request ${requestId} is starting.`,requestId});
      try {
        const response = await handleDirectGptRequest({ ...parsed, requestId }, async event => sendEvent('gpt.status', { ...event, requestId }));
        if (!res.writableEnded && !res.destroyed) {
          sendEvent('gpt.status',{actor:'SIRE',phase:'finishing',text:'GPT has completed the work. Sending the final response.',requestId});
          sendEvent('gpt.done', response);
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const detail = cause && typeof cause === 'object' ? { status: cause.status ?? null, code: cause.code ?? null, requestId: cause.requestId ?? requestId, providerBody: typeof cause.providerBody === 'string' ? cause.providerBody.slice(0, 2000) : null } : { status: null, code: null, requestId, providerBody: null };
        console.error('[DIRECT GPT STREAM]', JSON.stringify({ requestId, message, ...detail }));
        if (!res.writableEnded && !res.destroyed) sendEvent('gpt.error',{error:`Direct GPT failed [${requestId}]: ${message}`,requestId,...detail});
      } finally {
        clearInterval(heartbeat);
        if (!res.writableEnded) res.end();
      }
      return;
    }
    if (req.method === 'POST' && pathname === '/api/sire/agent/gpt') { const parsed = body ? JSON.parse(body) : {}; if (!String(parsed.query || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'query is required' })); try { const response = await handleDirectGptRequest(parsed); return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response)); } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); console.error('[DIRECT GPT]', message); return res.writeHead(502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:`Direct GPT test failed: ${message}` })); } }
    const response=await handler(toEvent(req,body)); const statusCode=Number.isInteger(response?.statusCode)?response.statusCode:200; const rawBody=response?.body!==undefined?response.body:response; const isString=typeof rawBody==='string'; res.writeHead(statusCode,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store',...(isString?{}:{'Content-Type':'application/json; charset=utf-8'}),...(response?.headers||{}) }); res.end(isString?rawBody:JSON.stringify(rawBody??{}));
  } catch(cause) { const message=cause instanceof Error?cause.message:String(cause); console.error('[HTTP ERROR]',req.method,req.url,message); if (!res.headersSent) res.writeHead(500,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({error:message})); } });
});

const wss = new WebSocketServer({ noServer:true });
server.on('upgrade',(req,socket,head)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(url.pathname==='/deriv/ws'){
    console.log('[DERIV PROXY] Browser market-data client connected');
    wss.handleUpgrade(req,socket,head,clientSocket=>{
      const upstream=new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
      const queued=[];
      let upstreamOpen=false;
      const fail=(message)=>{
        const detail = String(message || 'Unknown Deriv upstream error.');
        console.error('[DERIV PROXY] FAIL', detail);
        if(clientSocket.readyState===WebSocket.OPEN) {
          clientSocket.send(JSON.stringify({error:{message:detail}}));
          clientSocket.close(1011, detail.slice(0, 120));
        } else if(clientSocket.readyState===WebSocket.CONNECTING) {
          clientSocket.close();
        }
      };
      const upstreamTimer=setTimeout(()=>{ if(!upstreamOpen) fail('Deriv upstream connection timed out.'); },15000);
      upstream.on('open',()=>{
        upstreamOpen=true;
        clearTimeout(upstreamTimer);
        for(const data of queued) upstream.send(data);
        queued.length=0;
      });
      upstream.on('message',data=>{
        try {
          const parsed=JSON.parse(String(data));
          if(parsed?.error) console.error('[DERIV PROXY] upstream error', JSON.stringify(parsed.error));
        } catch {}
        if(clientSocket.readyState===WebSocket.OPEN) clientSocket.send(data);
      });
      upstream.on('error',error=>{
        const detail = error instanceof Error ? error.message : String(error);
        console.error('[DERIV PROXY]', detail);
        fail(`Deriv upstream WebSocket error: ${detail}`);
      });
      upstream.on('close',(code,reason)=>{
        clearTimeout(upstreamTimer);
        const detail = reason ? String(reason) : '';
        if(clientSocket.readyState===WebSocket.OPEN) {
          clientSocket.close(code && code !== 1000 ? 1011 : 1000, detail.slice(0, 120));
        }
      });
      clientSocket.on('message',data=>{
        if(upstreamOpen && upstream.readyState===WebSocket.OPEN) upstream.send(data);
        else if(!upstreamOpen) queued.push(data);
      });
      clientSocket.on('close',()=>{
        clearTimeout(upstreamTimer);
        queued.length=0;
        if(upstream.readyState===WebSocket.OPEN || upstream.readyState===WebSocket.CONNECTING) upstream.close();
      });
    });
    return;
  }
  if(url.pathname!=='/ws'){socket.destroy();return;}
  wss.handleUpgrade(req,socket,head,wsSocket=>{
    const connectionId=url.searchParams.get('connection_id')||randomUUID();
    ws.register(connectionId,wsSocket);
    wsSocket.send(JSON.stringify({type:'system.connected',payload:{connection_id:connectionId}}));
    wsSocket.on('close',async()=>{ws.unregister(connectionId); await realtime({body:JSON.stringify({type:'system.disconnected',payload:{connection_id:connectionId}})});});
  });
});

server.listen(PORT,HOST,async()=>{ console.log(`SIRE server listening on ${HOST}:${PORT}`); console.log('[DERIV HISTORY STORE]', JSON.stringify(await historyStoreStatus())); try { await ensureObserverLoop(); } catch (error) { console.warn('[SIRE OBSERVER] startup check failed', error instanceof Error ? error.message : String(error)); } });
