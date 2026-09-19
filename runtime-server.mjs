import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

const { handler } = await import('./backend/index.ts');
import { handleGeminiRequest } from './backend/gemini-ai.ts';
import { runAiTeam } from './backend/ai-team.ts';
import { runOpenRouter } from './backend/openrouter-ai.ts';
import { runAgent } from './backend/sire-agent-gateway.ts';
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

async function handleDirectGptRequest(parsed) {
  const query = String(parsed.query || '').trim();
  if (!query) throw new Error('query is required');
  const gpt = await runOpenRouter({ query, history: Array.isArray(parsed.history) ? parsed.history : [] });
  return { text: gpt.text, responseId: gpt.responseId || '', model: gpt.model, provider: gpt.provider, directGptTest: true };
}

if (process.env.SIRE_AGENT_WORKER_ENABLED === 'true') startAgentWorker().catch(error => console.error('[SIRE agent worker]', error));

const server = http.createServer(async (req,res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204,{ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization' }); return res.end(); }
  if (await serveStatic(req,res)) return;
  let body=''; req.on('data',chunk=>{body+=chunk;}); req.on('end',async()=>{ try {
    const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    if (req.method === 'POST' && pathname === '/api/sire/autonomous') { const parsed = body ? JSON.parse(body) : {}; if (!String(parsed.task || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'task is required' })); try { const response = await runAgent(String(parsed.task)); return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response)); } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); console.error('[AUTONOMOUS AGENT]', message); return res.writeHead(502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:message })); } }
    if (req.method === 'GET' && pathname === '/api/sire/autonomous/health') return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ ok:true, service:'sire-autonomous-runtime', gateway:'127.0.0.1:10001', continuousWorker:true, webSearch:true, webSearchProvider:'SearXNG', webSearchFree:true }));
    if (req.method === 'POST' && pathname === '/api/sire/agent/chat') { const parsed = body ? JSON.parse(body) : {}; const response = await handleGeminiRequest(parsed); return res.writeHead(response.status,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response.body ?? {})); }
    if (req.method === 'POST' && pathname === '/api/sire/agent/council') { const parsed = body ? JSON.parse(body) : {}; if (!String(parsed.query || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'query is required' })); try { const response = await handleTeamRequest(parsed); return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response)); } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); console.error('[AI TEAM]', message); return res.writeHead(502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:message, teamMode:'shared-workspace-team' })); } }
    if (req.method === 'POST' && pathname === '/api/sire/agent/council/stream') { const parsed = body ? JSON.parse(body) : {}; if (!String(parsed.query || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'query is required' })); res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-cache, no-transform','Content-Type':'text/event-stream; charset=utf-8','Connection':'keep-alive','X-Accel-Buffering':'no' }); const send = (type, payload) => { if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`); }; try { const response = await handleTeamRequest(parsed, event => send('council.stage', event)); send('council.done', response); } catch (cause) { send('council.error', { error: cause instanceof Error ? cause.message : String(cause) }); } return res.end(); }
    if (req.method === 'POST' && pathname === '/api/sire/agent/gpt') { const parsed = body ? JSON.parse(body) : {}; if (!String(parsed.query || '').trim()) return res.writeHead(400,{ 'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:'query is required' })); try { const response = await handleDirectGptRequest(parsed); return res.writeHead(200,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify(response)); } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); console.error('[DIRECT GPT]', message); return res.writeHead(502,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8' }).end(JSON.stringify({ error:`Direct GPT test failed: ${message}` })); } }
    const response=await handler(toEvent(req,body)); const statusCode=Number.isInteger(response?.statusCode)?response.statusCode:200; const rawBody=response?.body!==undefined?response.body:response; const isString=typeof rawBody==='string'; res.writeHead(statusCode,{ 'Access-Control-Allow-Origin':'*','Cache-Control':'no-store',...(isString?{}:{'Content-Type':'application/json; charset=utf-8'}),...(response?.headers||{}) }); res.end(isString?rawBody:JSON.stringify(rawBody??{}));
  } catch(cause) { const message=cause instanceof Error?cause.message:String(cause); console.error('[HTTP ERROR]',req.method,req.url,message); if (!res.headersSent) res.writeHead(500,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({error:message})); } });
});

const wss = new WebSocketServer({ noServer:true });
server.on('upgrade',(req,socket,head)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(url.pathname==='/deriv/ws'){
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

server.listen(PORT,HOST,()=>console.log(`SIRE server listening on ${HOST}:${PORT}`));
