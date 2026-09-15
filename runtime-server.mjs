import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';

const { handler } = await import('./backend/index.ts');
import { handleGeminiRequest, runGemini } from './backend/gemini-ai.ts';
import { runOpenRouter } from './backend/openrouter-ai.ts';
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
  const candidate = requestPath === '/' ? join(DIST,'index.html') : join(DIST, normalize(requestPath).replace(/^[/\\]+/,''));
  let filePath = candidate;
  try { const info = await stat(filePath); if (!info.isFile()) throw new Error('not a file'); } catch { filePath = join(DIST,'index.html'); }
  try { const data = await readFile(filePath); res.writeHead(200,{ 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' }); if (req.method !== 'HEAD') res.end(data); else res.end(); return true; } catch { return false; }
}
function toEvent(req, body) { const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); return { httpMethod:req.method, path:url.pathname, rawPath:url.pathname, body, headers:req.headers, requestContext:{ http:{ method:req.method, path:url.pathname } } }; }

async function handleCouncilRequest(parsed) {
  const gemini = await runGemini({
    query: String(parsed.query || ''),
    symbol: parsed.symbol ? String(parsed.symbol) : undefined,
    history: Array.isArray(parsed.history) ? parsed.history : [],
    runtimeContext: parsed.runtimeContext && typeof parsed.runtimeContext === 'object' ? parsed.runtimeContext : undefined,
  });

  try {
    const gpt = await runOpenRouter({
      query: String(parsed.query || ''),
      history: Array.isArray(parsed.history) ? parsed.history : [],
      councilContext: gemini.text,
    });
    return {
      text: gpt.text,
      responseId: gpt.responseId || gemini.responseId || '',
      model: 'council:' + gemini.model + '+' + gpt.model,
      provider: 'SIRE AI Council',
      council: [
        { provider: gemini.provider, model: gemini.model, text: gemini.text },
        { provider: gpt.provider, model: gpt.model, text: gpt.text },
      ],
    };
  } catch (cause) {
    // Keep SIRE usable if the optional GPT provider has not been configured or
    // its free endpoint is temporarily unavailable. Gemini remains the live fallback.
    console.warn('[COUNCIL] GPT member unavailable:', cause instanceof Error ? cause.message : String(cause));
    return {
      ...gemini,
      council: [{ provider: gemini.provider, model: gemini.model, text: gemini.text }],
      councilWarning: 'OpenAI GPT council member is unavailable; Gemini answered this turn.',
    };
  }
}

async function handleDirectGptRequest(parsed) {
  const query = String(parsed.query || '').trim();
  if (!query) throw new Error('query is required');
  const gpt = await runOpenRouter({
    query,
    history: Array.isArray(parsed.history) ? parsed.history : [],
  });
  return {
    text: gpt.text,
    responseId: gpt.responseId || '',
    model: gpt.model,
    provider: gpt.provider,
    directGptTest: true,
  };
}

const server = http.createServer(async (req,res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204,{ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization' }); return res.end(); }
  if (await serveStatic(req,res)) return;
  let body=''; req.on('data',chunk=>{body+=chunk;}); req.on('end',async()=>{ try {
    const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
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
    if (req.method === 'POST' && pathname === '/api/sire/agent/gpt') {
      const parsed = body ? JSON.parse(body) : {};
      if (!String(parsed.query || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'query is required' }));
      try {
        const response = await handleDirectGptRequest(parsed);
        return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error('[DIRECT GPT]', message);
        return res.writeHead(502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:`Direct GPT test failed: ${message}` }));
      }
    }
    const response=await handler(toEvent(req,body)); const statusCode=Number.isInteger(response?.statusCode)?response.statusCode:200; const rawBody=response?.body!==undefined?response.body:response; const isString=typeof rawBody==='string'; res.writeHead(statusCode,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store',...(isString?{}:{'Content-Type':'application/json; charset=utf-8'}),...(response?.headers||{}) }); res.end(isString?rawBody:JSON.stringify(rawBody??{}));
  } catch(cause) { const message=cause instanceof Error?cause.message:String(cause); console.error('[HTTP ERROR]',req.method,req.url,message); res.writeHead(500,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({error:message})); } });
});
const wss = new WebSocketServer({ noServer:true });
server.on('upgrade',(req,socket,head)=>{ const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`); if(url.pathname!=='/ws'){socket.destroy();return;} wss.handleUpgrade(req,socket,head,wsSocket=>{ const connectionId=url.searchParams.get('connection_id')||randomUUID(); ws.register(connectionId,wsSocket); wsSocket.send(JSON.stringify({type:'system.connected',payload:{connection_id:connectionId}})); wsSocket.on('close',async()=>{ws.unregister(connectionId); await realtime({body:JSON.stringify({type:'system.disconnected',payload:{connection_id:connectionId}})});}); }); });
server.listen(PORT,HOST,()=>console.log(`SIRE server listening on ${HOST}:${PORT}`));