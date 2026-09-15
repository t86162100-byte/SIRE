import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';

const { handler } = await import('./backend/index.ts');
import { handleGeminiRequest, runGemini } from './backend/gemini-ai.ts';
import { runOpenRouter } from './backend/openrouter-ai.ts';
import { runAgent } from './backend/sire-agent-gateway.ts';
import { webSearch } from './backend/agent-tools.ts';
import { startAgentWorker } from './workers/sire-agent-worker.ts';
import { ws } from './compat/appdeploy-sdk/index.js';
import { realtime } from './backend/realtime.ts';

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const DIST = join(process.cwd(), 'dist');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2' };

async function serveStatic(req, res) {
  if (!req.url || !['GET','HEAD'].includes(req.method || '')) return false;
  const requestPath = decodeURIComponent(new URL(req.url, 'http://sire.local').pathname);
  if (requestPath.startsWith('/api/') || requestPath === '/ws') return false;
  const candidate = requestPath === '/' ? join(DIST,'index.html') : join(DIST, normalize(requestPath).replace(/^[/\\\\]+/,''));
  let filePath = candidate;
  try { const info = await stat(filePath); if (!info.isFile()) throw new Error('not a file'); } catch { filePath = join(DIST,'index.html'); }
  try { const data = await readFile(filePath); res.writeHead(200,{ 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' }); if (req.method !== 'HEAD') res.end(data); else res.end(); return true; } catch { return false; }
}
function toEvent(req, body) { const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); return { httpMethod:req.method, path:url.pathname, rawPath:url.pathname, body, headers:req.headers, requestContext:{ http:{ method:req.method, path:url.pathname } } }; }

function shouldSearchWeb(query) {
  const q = query.toLowerCase();
  return /\b(latest|today|current|now|recent|recently|news|price|prices|market|weather|score|scores|schedule|release|released|version|update|updates|who is|what happened|when is|where is|how much|how many|research|search|look up|according to|source|sources|compare|comparison|this week|this month|2026|2025)\b/.test(q) || /https?:\/\//.test(q);
}

async function researchForCouncil(query, emit) {
  if (!shouldSearchWeb(query)) return { sources: [], context: '' };
  await emit('Web', 'searching', `Searching the web for: ${query}`);
  try {
    const result = await webSearch(query, 8);
    const raw = Array.isArray(result.results) ? result.results : [];
    const sources = raw.map((item) => ({
      title: String(item.title || item.name || item.url || 'Web source'),
      url: String(item.url || item.link || ''),
      publishedDate: item.publishedDate ? String(item.publishedDate) : undefined,
      author: item.author ? String(item.author) : undefined,
      text: String(item.text || item.snippet || '').slice(0, 1400),
    })).filter(item => item.url);
    await emit('Web', 'searched', `Found ${sources.length} web sources.`);
    return { sources, context: sources.map((s, i) => `[Web source ${i + 1}] ${s.title}\nURL: ${s.url}\n${s.text}`).join('\n\n') };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emit('Web', 'unavailable', `Web search was requested but is unavailable: ${message}`);
    return { sources: [], context: '' };
  }
}

async function handleCouncilRequest(parsed, onEvent) {
  const query = String(parsed.query || '').trim();
  const history = Array.isArray(parsed.history) ? parsed.history : [];
  const shared = { symbol: parsed.symbol ? String(parsed.symbol) : undefined, runtimeContext: parsed.runtimeContext && typeof parsed.runtimeContext === 'object' ? parsed.runtimeContext : undefined };
  const emit = async (actor, phase, text) => { if (onEvent) await onEvent({ actor, phase, text }); };
  const web = await researchForCouncil(query, emit);
  const webContext = web.context ? `\n\nLIVE WEB RESEARCH (use this evidence for current facts; do not invent sources):\n${web.context}` : '';

  await emit('Gemini', 'proposing', 'Working on an initial approach.');
  const geminiProposal = await runGemini({ query: query + webContext, history, ...shared, debateRole: 'proposal' });
  const debate = [{ provider: geminiProposal.provider, model: geminiProposal.model, role: 'proposal', text: geminiProposal.text }];
  await emit('Gemini', 'proposed', geminiProposal.text);

  try {
    const council = await runOpenRouter({ query: query + webContext, history, councilContext: geminiProposal.text, onEvent });
    if (Array.isArray(council.council)) debate.push(...council.council);
    await emit('SIRE', 'conclusion', 'Combining the team’s work into the final response.');
    return { text: council.text, responseId: council.responseId || geminiProposal.responseId || '', model: 'council:' + geminiProposal.model + '+' + council.model, provider: 'SIRE AI Council', council: debate, councilMode: 'multi-round-collaboration', rounds: debate.length, webSearched: web.sources.length > 0, webSources: web.sources };
  } catch (cause) {
    console.warn('[COUNCIL] Collaborative debate stopped:', cause instanceof Error ? cause.message : String(cause));
    await emit('SIRE', 'fallback', 'The full collaboration was interrupted, so SIRE is using the available contribution.');
    return { text: geminiProposal.text, responseId: geminiProposal.responseId || '', model: geminiProposal.model, provider: 'SIRE AI Council', council: debate, councilMode: 'degraded-single-member', councilWarning: 'The full debate could not complete this turn; SIRE returned the available council contribution.', webSearched: web.sources.length > 0, webSources: web.sources };
  }
}

async function handleDirectGptRequest(parsed) {
  const query = String(parsed.query || '').trim();
  if (!query) throw new Error('query is required');
  const gpt = await runOpenRouter({ query, history: Array.isArray(parsed.history) ? parsed.history : [] });
  return { text: gpt.text, responseId: gpt.responseId || '', model: gpt.model, provider: gpt.provider, directGptTest: true };
}

startAgentWorker().catch(error => console.error('[SIRE agent worker]', error));

const server = http.createServer(async (req,res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204,{ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization' }); return res.end(); }
  if (await serveStatic(req,res)) return;
  let body=''; req.on('data',chunk=>{body+=chunk;}); req.on('end',async()=>{ try {
    const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    if (req.method === 'POST' && pathname === '/api/sire/autonomous') {
      const parsed = body ? JSON.parse(body) : {};
      if (!String(parsed.task || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'task is required' }));
      try { const response = await runAgent(String(parsed.task)); return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response)); }
      catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); console.error('[AUTONOMOUS AGENT]', message); return res.writeHead(502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:message })); }
    }
    if (req.method === 'GET' && pathname === '/api/sire/autonomous/health') {
      return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ ok:true, service:'sire-autonomous-runtime', gateway:'127.0.0.1:10001', continuousWorker:true, webSearch:Boolean(process.env.EXA_API_KEY) }));
    }
    if (req.method === 'POST' && pathname === '/api/sire/agent/chat') {
      const parsed = body ? JSON.parse(body) : {};
      const response = await handleGeminiRequest(parsed);
      return res.writeHead(response.status,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response.body ?? {}));
    }
    if (req.method === 'POST' && pathname === '/api/sire/agent/council') {
      const parsed = body ? JSON.parse(body) : {};
      if (!String(parsed.query || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'query is required' }));
      const response = await handleCouncilRequest(parsed);
      return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response));
    }
    if (req.method === 'POST' && pathname === '/api/sire/agent/council/stream') {
      const parsed = body ? JSON.parse(body) : {};
      if (!String(parsed.query || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'query is required' }));
      res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-cache, no-transform','Content-Type':'text/event-stream; charset=utf-8','Connection':'keep-alive','X-Accel-Buffering':'no' });
      const send = (type, payload) => { if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`); };
      try { const response = await handleCouncilRequest(parsed, event => send('council.stage', event)); send('council.done', response); } catch (cause) { send('council.error', { error: cause instanceof Error ? cause.message : String(cause) }); }
      return res.end();
    }
    if (req.method === 'POST' && pathname === '/api/sire/agent/gpt') {
      const parsed = body ? JSON.parse(body) : {};
      if (!String(parsed.query || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'query is required' }));
      try { const response = await handleDirectGptRequest(parsed); return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response)); }
      catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); console.error('[DIRECT GPT]', message); return res.writeHead(502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:`Direct GPT test failed: ${message}` })); }
    }
    const response=await handler(toEvent(req,body)); const statusCode=Number.isInteger(response?.statusCode)?response.statusCode:200; const rawBody=response?.body!==undefined?response.body:response; const isString=typeof rawBody==='string'; res.writeHead(statusCode,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store',...(isString?{}:{'Content-Type':'application/json; charset=utf-8'}),...(response?.headers||{}) }); res.end(isString?rawBody:JSON.stringify(rawBody??{}));
  } catch(cause) { const message=cause instanceof Error?cause.message:String(cause); console.error('[HTTP ERROR]',req.method,req.url,message); if (!res.headersSent) res.writeHead(500,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({error:message})); } });
});
const wss = new WebSocketServer({ noServer:true });
server.on('upgrade',(req,socket,head)=>{ const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`); if(url.pathname!=='/ws'){socket.destroy();return;} wss.handleUpgrade(req,socket,head,wsSocket=>{ const connectionId=url.searchParams.get('connection_id')||randomUUID(); ws.register(connectionId,wsSocket); wsSocket.send(JSON.stringify({type:'system.connected',payload:{connection_id:connectionId}})); wsSocket.on('close',async()=>{ws.unregister(connectionId); await realtime({body:JSON.stringify({type:'system.disconnected',payload:{connection_id:connectionId}})});}); }); });
server.listen(PORT,HOST,()=>console.log(`SIRE server listening on ${HOST}:${PORT}`));