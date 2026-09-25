import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { currentUser, findUserById, login } from './auth.ts';

const ISSUER = () => process.env.SIRE_MCP_AUTH_ISSUER?.trim() || process.env.SIRE_MCP_PUBLIC_URL?.trim() || '';
const SECRET = () => process.env.SIRE_MCP_SECRET?.trim() || '';
const RESOURCE = () => process.env.SIRE_MCP_PUBLIC_URL?.trim() || '';
const CODE_TTL_MS = 5 * 60_000;
const ACCESS_TTL_SEC = 60 * 60;
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

type OAuthCode = { userId:string; clientId:string; redirectUri:string; codeChallenge:string; resource:string; scope:string; expiresAt:number };
const codes = new Map<string, OAuthCode>();
const chartContexts = new Map<string, any>();
type PendingAction = { id:string; userId:string; action:any; createdAt:number; expiresAt:number; status:'pending'|'done'|'failed'; result?:any };
const pendingActions = new Map<string, PendingAction>();
function newAction(userId:string, action:any) {
  const id=randomBytes(18).toString('base64url');
  const item={id,userId,action,createdAt:Date.now(),expiresAt:Date.now()+60_000,status:'pending' as const};
  pendingActions.set(id,item); return item;
}
export function claimSireAction(userId:string) {
  const now=Date.now();
  for (const item of pendingActions.values()) {
    if (item.userId===userId && item.status==='pending' && item.expiresAt>now) return item;
  }
  return null;
}
export function completeSireAction(userId:string,id:string,result:any,failed=false) {
  const item=pendingActions.get(id);
  if (!item || item.userId!==userId) return false;
  item.status=failed?'failed':'done'; item.result=result; return true;
}

function base64url(value: Buffer | string) {
  return Buffer.from(value).toString('base64url');
}
function sign(value:string) {
  const secret = SECRET();
  if (!secret) throw new Error('SIRE_MCP_SECRET is not configured.');
  return createHmac('sha256', secret).update(value).digest('base64url');
}
function issueToken(userId:string, type:'access'|'refresh', scope:string) {
  const exp = Math.floor(Date.now()/1000) + (type === 'access' ? ACCESS_TTL_SEC : REFRESH_TTL_SEC);
  const body = base64url(JSON.stringify({ sub:userId, aud:RESOURCE(), iss:ISSUER(), exp, iat:Math.floor(Date.now()/1000), typ:type, scope }));
  return body + '.' + sign(body);
}
function verifyToken(token:string, expectedType:'access'|'refresh'='access') {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;
  const expected = sign(body);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a,b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if (data.typ !== expectedType || !data.sub || Number(data.exp) <= Math.floor(Date.now()/1000)) return null;
    if (data.aud !== RESOURCE() || data.iss !== ISSUER()) return null;
    return data as {sub:string;scope:string;exp:number};
  } catch { return null; }
}
function parseBearer(req:any) {
  const header = String(req.headers?.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}
function htmlEscape(value:string) {
  return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
}
function json(res:any, status:number, data:any, headers:any={}) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers });
  res.end(JSON.stringify(data));
}
function form(res:any, status:number, body:string, headers:any={}) {
  res.writeHead(status, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', ...headers });
  res.end(body);
}
function oauthLoginPage(params:URLSearchParams, error='') {
  const action = '/oauth/authorize';
  const hidden = [...params.entries()].map(([k,v]) => `<input type="hidden" name="${htmlEscape(k)}" value="${htmlEscape(v)}">`).join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect SIRE to ChatGPT</title><style>body{font-family:system-ui;background:#080808;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}main{width:min(420px,calc(100% - 32px));background:#151515;border:1px solid #333;border-radius:16px;padding:24px;box-sizing:border-box}input{width:100%;box-sizing:border-box;padding:12px;margin:7px 0 14px;border-radius:10px;border:1px solid #444;background:#0d0d0d;color:#fff}button{width:100%;padding:12px;border:0;border-radius:10px;background:#fff;color:#000;font-weight:700}small{color:#aaa}.error{color:#ff8a8a;margin-bottom:12px}</style></head><body><main><h2>Connect SIRE</h2><p>Sign in to your SIRE account to let ChatGPT access your workspace and chart.</p>${error?`<div class="error">${htmlEscape(error)}</div>`:''}<form method="post" action="${action}">${hidden}<label>Email</label><input name="email" type="email" autocomplete="email" required><label>Password</label><input name="password" type="password" autocomplete="current-password" required><button type="submit">Sign in and continue</button></form><small>Your SIRE credentials are sent only to SIRE over HTTPS.</small></main></body></html>`;
}
function consentPage(params:URLSearchParams, user:any) {
  const hidden = [...params.entries()].map(([k,v]) => `<input type="hidden" name="${htmlEscape(k)}" value="${htmlEscape(v)}">`).join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize SIRE</title><style>body{font-family:system-ui;background:#080808;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}main{width:min(440px,calc(100% - 32px));background:#151515;border:1px solid #333;border-radius:16px;padding:24px;box-sizing:border-box}button{padding:12px 18px;border:0;border-radius:10px;background:#fff;color:#000;font-weight:700;margin-right:8px}.muted{color:#aaa}</style></head><body><main><h2>Authorize ChatGPT</h2><p>Allow ChatGPT to access your SIRE workspace as <b>${htmlEscape(user.name || user.email)}</b>.</p><p class="muted">SIRE will expose chart state and other workspace data permitted by the connected tools.</p><form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="decision" value="allow"><button type="submit">Allow</button><button type="submit" name="decision" value="deny">Deny</button></form></main></body></html>`;
}
function pkce(verifier:string, challenge:string) {
  const actual = createHash('sha256').update(verifier).digest('base64url');
  return actual === challenge;
}

export function setChartContext(userId:string, context:any) {
  if (!userId) return;
  chartContexts.set(userId, { ...context, syncedAt:Date.now() });
}
export function getChartContext(userId:string) {
  return chartContexts.get(userId) || null;
}

export async function handleMcpOAuth(req:any, res:any, pathname:string, body='') {
  const resource = RESOURCE();
  const issuer = ISSUER();
  if (!resource || !issuer) return json(res, 503, { error:'SIRE MCP public URL/auth issuer is not configured.' });

  if (pathname === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
    return json(res, 200, { resource, authorization_servers:[issuer], scopes_supported:['sire.read','sire.write'], resource_documentation:resource });
  }
  if (pathname === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
    return json(res, 200, {
      issuer,
      authorization_endpoint:`${issuer}/oauth/authorize`,
      token_endpoint:`${issuer}/oauth/token`,
      client_id_metadata_document_supported:true,
      token_endpoint_auth_methods_supported:['none'],
      code_challenge_methods_supported:['S256'],
      scopes_supported:['sire.read','sire.write'],
      authorization_response_iss_parameter_supported:true,
    });
  }
  if (pathname === '/oauth/authorize' && req.method === 'GET') {
    const params = new URLSearchParams(new URL(req.url || '/', resource).search);
    const required = ['client_id','redirect_uri','response_type','state','code_challenge','code_challenge_method','resource'];
    if (required.some(k => !params.get(k))) return json(res,400,{error:'invalid_request',error_description:'Missing OAuth parameters.'});
    if (params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || params.get('resource') !== resource) return json(res,400,{error:'invalid_request',error_description:'Unsupported OAuth request.'});
    const user = await currentUser(req);
    if (!user) return form(res,200,oauthLoginPage(params));
    return form(res,200,consentPage(params,user));
  }
  if (pathname === '/oauth/authorize' && req.method === 'POST') {
    const params = new URLSearchParams(body);
    const decision = params.get('decision') || 'allow';
    const user = await currentUser(req);
    if (!user) {
      try {
        const result = await login({ headers:req.headers, body:{ email:params.get('email') || '', password:params.get('password') || '' } });
        const clean = new URLSearchParams(params); clean.delete('email'); clean.delete('password');
        return res.writeHead(302,{Location:`/oauth/authorize?${clean.toString()}`,'Set-Cookie':result.setCookie,'Cache-Control':'no-store'}).end();
      } catch (e) {
        params.delete('password');
        return form(res,401,oauthLoginPage(params,e instanceof Error ? e.message : String(e)));
      }
    }
    const redirectUri=params.get('redirect_uri') || '';
    const clientId=params.get('client_id') || '';
    if (!redirectUri || !clientId) return json(res,400,{error:'invalid_request'});
    const callback = new URL(redirectUri);
    if (!['https:','http:'].includes(callback.protocol)) return json(res,400,{error:'invalid_request',error_description:'Invalid redirect URI.'});
    if (decision !== 'allow') {
      callback.searchParams.set('error','access_denied'); callback.searchParams.set('state',params.get('state') || ''); callback.searchParams.set('iss',issuer);
      return res.writeHead(302,{Location:callback.toString(),'Cache-Control':'no-store'}).end();
    }
    const code=randomBytes(32).toString('base64url');
    codes.set(code,{userId:user.id,clientId,redirectUri,codeChallenge:params.get('code_challenge') || '',resource,scope:params.get('scope') || 'sire.read',expiresAt:Date.now()+CODE_TTL_MS});
    callback.searchParams.set('code',code); callback.searchParams.set('state',params.get('state') || ''); callback.searchParams.set('iss',issuer);
    return res.writeHead(302,{Location:callback.toString(),'Cache-Control':'no-store'}).end();
  }
  if (pathname === '/oauth/token' && req.method === 'POST') {
    const params = new URLSearchParams(body);
    const grant=params.get('grant_type') || '';
    if (grant === 'refresh_token') {
      const verified=verifyToken(params.get('refresh_token') || '','refresh');
      if (!verified) return json(res,400,{error:'invalid_grant'});
      return json(res,200,{access_token:issueToken(verified.sub,'access',verified.scope),token_type:'Bearer',expires_in:ACCESS_TTL_SEC,refresh_token:params.get('refresh_token')});
    }
    if (grant !== 'authorization_code') return json(res,400,{error:'unsupported_grant_type'});
    const code=params.get('code') || '';
    const record=codes.get(code);
    codes.delete(code);
    if (!record || record.expiresAt<Date.now() || record.clientId!==params.get('client_id') || record.redirectUri!==params.get('redirect_uri') || record.resource!==params.get('resource')) return json(res,400,{error:'invalid_grant'});
    if (!pkce(params.get('code_verifier') || '',record.codeChallenge)) return json(res,400,{error:'invalid_grant',error_description:'PKCE verification failed.'});
    return json(res,200,{access_token:issueToken(record.userId,'access',record.scope),token_type:'Bearer',expires_in:ACCESS_TTL_SEC,refresh_token:issueToken(record.userId,'refresh',record.scope),scope:record.scope});
  }
  return false;
}

function authChallenge() {
  return `Bearer resource_metadata="${RESOURCE()}/.well-known/oauth-protected-resource", error="invalid_token", error_description="SIRE authorization required"`;
}
function getAuthedUser(req:any) {
  const token=parseBearer(req);
  try { return verifyToken(token,'access'); } catch { return null; }
}

const profileSchema = {
  id:z.string(), name:z.string(), email:z.string(), nickname:z.string(),
};
const chartSchema = {
  symbol:z.string(), name:z.string(), timeframe:z.string(), latestPrice:z.number().nullable(), latestBar:z.any().nullable(),
  chartBars:z.number(), recentBars:z.array(z.any()), visibleBars:z.number().nullable(), visibleRange:z.any().nullable(),
  activeIndicators:z.array(z.any()), drawings:z.array(z.any()), replay:z.any().nullable(), chartState:z.any().nullable(),
  capabilities:z.any(), agentContract:z.any(), publishedAt:z.number(), syncedAt:z.number(),
};

function createSireMcpServer(user:any) {
  const server = new McpServer(
    { name:'sire-chart', version:'0.1.0' },
    { instructions:'SIRE is the user\'s trading-chart workspace. Read the live chart state before answering chart questions. Treat SIRE chart data as the source of truth for instrument, timeframe, price, candles, indicators, drawings and replay.' }
  );
  const readSecurity=[{type:'oauth2',scopes:['sire.read']}];
  const writeSecurity=[{type:'oauth2',scopes:['sire.write']}];
  server.registerTool('get_profile',{
    title:'Get SIRE profile', description:'Return the SIRE account connected to this ChatGPT session.', inputSchema:{}, outputSchema:profileSchema,
    securitySchemes:readSecurity, annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}, _meta:{securitySchemes:readSecurity,'openai/profile':true}
  },async()=>{ const value={id:user.id,name:user.name,email:user.email,nickname:`${user.name} — SIRE`}; return {structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}]}; });

  server.registerTool('get_chart_state',{
    title:'Read current SIRE chart', description:'Read the current live SIRE chart state before explaining or analyzing the market. Includes instrument, timeframe, latest price, recent candles, visible range, indicators, drawings and replay state.',
    inputSchema:{}, outputSchema:chartSchema, securitySchemes:readSecurity, annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}, _meta:{securitySchemes:readSecurity}
  },async()=>{ const context=getChartContext(user.id); if(!context) return {content:[{type:'text',text:'SIRE is connected, but no live chart context has been synchronized from the user\'s browser yet.'}],isError:true}; return {structuredContent:context,content:[{type:'text',text:`Current chart: ${context.name || context.symbol} (${context.symbol}), ${context.timeframe}, latest price ${context.latestPrice ?? 'unavailable'}.`}]}; });

  server.registerTool('get_available_instruments',{
    title:'List SIRE instruments', description:'List instruments currently known by the connected SIRE chart workspace.',
    inputSchema:{}, outputSchema:{instruments:z.array(z.object({symbol:z.string(),name:z.string()}))}, securitySchemes:readSecurity, annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}, _meta:{securitySchemes:readSecurity}
  },async()=>{ const context=getChartContext(user.id); const instruments=Array.isArray(context?.availableInstruments)?context.availableInstruments:[]; return {structuredContent:{instruments},content:[{type:'text',text:`SIRE currently reports ${instruments.length} available instruments.`}]}; });

  server.registerTool('get_chart_diagnostics',{
    title:'Read SIRE chart diagnostics', description:'Read the latest SIRE chart and market-data diagnostics when investigating a chart problem.',
    inputSchema:{}, outputSchema:{ok:z.boolean(),mainIssue:z.any(),checks:z.array(z.any()).optional()}, securitySchemes:readSecurity, annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}, _meta:{securitySchemes:readSecurity}
  },async()=>{ const context=getChartContext(user.id); const diagnostics=context?.diagnostics || []; const value={ok:!diagnostics.some((d:any)=>d?.level==='error'),mainIssue:diagnostics.find((d:any)=>d?.level==='error') || null,checks:diagnostics}; return {structuredContent:value,content:[{type:'text',text:value.ok?'No error-level browser chart diagnostics are currently synchronized.':'SIRE has one or more error-level chart diagnostics.'}]}; });

  const actionInput = z.object({ action:z.enum(['switch_instrument','set_timeframe','add_indicator','remove_indicator','add_drawing','remove_drawing','start_replay','stop_replay','set_chart_type']), args:z.record(z.any()).optional() });
  server.registerTool('control_chart',{
    title:'Control SIRE chart', description:'Request a verified chart action in the connected SIRE browser. SIRE executes the action and reports the result; write actions require sire.write authorization.', inputSchema:actionInput, outputSchema:{actionId:z.string(),status:z.string(),action:z.any()}, securitySchemes:writeSecurity, annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}, _meta:{securitySchemes:writeSecurity,'openai/confirmation':{required:true}}
  },async(input:any)=>{ const item=newAction(user.id,input); return {structuredContent:{actionId:item.id,status:item.status,action:input},content:[{type:'text',text:`Chart action ${item.id} queued. SIRE browser will execute and verify it.`}]}; });
  server.registerTool('get_action_result',{
    title:'Get chart action result', description:'Read the verified result of a previously queued SIRE chart action.', inputSchema:{actionId:z.string()}, outputSchema:{actionId:z.string(),status:z.string(),result:z.any().optional()}, securitySchemes:readSecurity, annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}, _meta:{securitySchemes:readSecurity}
  },async(input:any)=>{ const item=pendingActions.get(input.actionId); if(!item || item.userId!==user.id) return {isError:true,content:[{type:'text',text:'Unknown chart action.'}]}; return {structuredContent:{actionId:item.id,status:item.status,result:item.result},content:[{type:'text',text:JSON.stringify({status:item.status,result:item.result})}]}; });

  return server;
}

export async function handleSireMcp(req:any,res:any) {
  const auth=getAuthedUser(req);
  if (!auth) {
    return json(res,401,{error:'unauthorized'}, {'WWW-Authenticate':authChallenge()});
  }
  // The bearer token is the source of identity; no browser cookie is required.
  const user=await findUserById(auth.sub);
  if (!user) return json(res,401,{error:'unauthorized'}, {'WWW-Authenticate':authChallenge()});
  const server=createSireMcpServer(user);
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{ transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req,res);
}
