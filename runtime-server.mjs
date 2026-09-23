import http from 'node:http';
import { randomUUID } from 'node:crypto';
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
import { recordIssue, getRecentIssues } from './backend/sire-issue-tracker.ts';

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const DIST = join(process.cwd(), 'dist');
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
  const response = await runAiTeam({ query, workspaceId: parsed.workspaceId || parsed.workspace || parsed.sessionId || 'default', history: Array.isArray(parsed.history) ? parsed.history : [], symbol: parsed.symbol ? String(parsed.symbol) : undefined, runtimeContext: parsed.runtimeContext && typeof parsed.runtimeContext === 'object' ? parsed.runtimeContext : undefined, execute: Boolean(parsed.execute), onEvent });
  return { ...response, councilMode: 'shared-workspace-team', rounds: response.activity.length };
}

function githubRepoConfig() {
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  const repo = String(process.env.GITHUB_REPOSITORY || 't86162100-byte/SIRE').trim();
  if (!token) throw new Error('GPT GitHub access is not configured: set GITHUB_TOKEN (or GH_TOKEN) on the SIRE service.');
  if (!/^[^/]+\/[^/]+$/.test(repo)) throw new Error('Invalid GITHUB_REPOSITORY configuration.');
  return { token, repo };
}

async function githubRequestForGpt({ method, path, body, permission }) {
  const { token, repo } = githubRepoConfig();
  let normalizedPath = String(path || '').trim();
  // GPT sometimes returns the full GitHub API URL even though the tool schema asks
  // for an API path. Normalize that form instead of rejecting a valid repo request.
  if (normalizedPath.startsWith('https://api.github.com') || normalizedPath.startsWith('http://api.github.com')) { const parsedUrl = new URL(normalizedPath); normalizedPath = parsedUrl.pathname + parsedUrl.search; }
  normalizedPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath;
  const repoPrefix = '/repos/' + repo;
  const isRepoScoped = normalizedPath === repoPrefix || normalizedPath.startsWith(repoPrefix + '/');
  const isRepoSearch = normalizedPath.startsWith('/search/code') || normalizedPath.startsWith('/search/commits') || normalizedPath.startsWith('/search/issues') || normalizedPath.startsWith('/search/repositories');
  if (!isRepoScoped && !isRepoSearch) {
    throw new Error('GPT GitHub access is limited to the configured SIRE repository. Use paths under ' + repoPrefix + ' for repository inspection and changes.');
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
  if (!response.ok) {
    const detail = typeof data === 'object' && data ? (data.message || JSON.stringify(data)) : String(data);
    throw new Error('GitHub API ' + response.status + ': ' + detail);
  }
  return JSON.stringify({ ok:true, status:response.status, method:verb, path:normalizedPath, result:data });
}

async function handleDirectGptRequest(parsed) {
  const query = String(parsed.query || '').trim();
  if (!query) throw new Error('query is required');
  const runtimeContext = parsed.runtimeContext && typeof parsed.runtimeContext === 'object' ? parsed.runtimeContext : {};
  const gpt = await runGptHead({
    query,
    history: Array.isArray(parsed.history) ? parsed.history : [],
    runtimeContext,
    onEvent: parsed.onEvent,
    tools: {
      chartControl: async actions => JSON.stringify({ ok:true, actions }),
      githubRequest: githubRequestForGpt,
      checkIntegrations: async () => {
        const result = { github: { configured:false, repository:String(process.env.GITHUB_REPOSITORY || 't86162100-byte/SIRE') }, render: { configured:true } };
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
        return JSON.stringify(result);
      },
    },
  });
  return { text: gpt.text, responseId: gpt.responseId || '', model: gpt.model, provider: gpt.provider, actions: gpt.actions || [], directGpt: true };
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

async function checkDerivPublicMarketData() {
  return await new Promise((resolve) => {
    const ws = new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public');
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok:false, stage:'connect', error:'Deriv public WebSocket connection timed out after 12 seconds.' }), 12000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ active_symbols:'brief', req_id:900001 }));
    });
    ws.on('message', data => {
      try {
        const parsed = JSON.parse(String(data));
        if (parsed?.error) {
          clearTimeout(timer);
          finish({ ok:false, stage:'active_symbols', error:parsed.error.message || parsed.error.code || 'Deriv returned an unknown market-data error.', code:parsed.error.code || '' });
          return;
        }
        if (Number(parsed?.req_id) === 900001) {
          clearTimeout(timer);
          const count = Array.isArray(parsed?.active_symbols) ? parsed.active_symbols.length : 0;
          finish(count ? { ok:true, stage:'active_symbols', symbolCount:count, activeSymbols: parsed.active_symbols } : { ok:false, stage:'active_symbols', error:'Deriv connected, but returned an empty active-symbol catalogue.' });
        }
      } catch (error) {
        clearTimeout(timer);
        finish({ ok:false, stage:'response', error:error instanceof Error ? error.message : String(error) });
      }
    });
    ws.on('error', error => {
      clearTimeout(timer);
      finish({ ok:false, stage:'connect', error:`Deriv public WebSocket error: ${error instanceof Error ? error.message : String(error)}` });
    });
    ws.on('close', (code, reason) => {
      if (!settled) {
        clearTimeout(timer);
        finish({ ok:false, stage:'connect', error:`Deriv public WebSocket closed before startup completed (code ${code})${reason ? `: ${String(reason)}` : ''}.` });
      }
    });
  });
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
    if (req.method === 'GET' && pathname === '/api/sire/deriv/health') { const result = await checkDerivPublicMarketData(); console.log('[DERIV HEALTH]', JSON.stringify(result)); return res.writeHead(result.ok ? 200 : 502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(result)); }
    if (req.method === 'POST' && pathname === '/api/sire/agent/chat') { const parsed = body ? JSON.parse(body) : {}; const response = await handleGeminiRequest(parsed); return res.writeHead(response.status,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response.body ?? {})); }
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

server.listen(PORT,HOST,async()=>{ console.log(`SIRE server listening on ${HOST}:${PORT}`); console.log('[DERIV HISTORY STORE]', JSON.stringify(await historyStoreStatus())); });
