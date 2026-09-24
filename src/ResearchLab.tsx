import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@appdeploy/client';
import { Bug, Check, Copy, Globe2, Menu, MessageSquarePlus, Plus, Send, Sparkles, Trash2, X } from 'lucide-react';
import './sire-council.css';

type Instrument = { symbol: string; name: string };
type RuntimeContext = { symbol: string; name?: string; timeframe?: string; chartMode?: string; latestPrice?: number | null; activeIndicators?: unknown[]; availableIndicatorIds?: string[]; chartDiagnostics?: Array<Record<string, unknown>>; drawings?: Array<Record<string, unknown>>; chartBars?: number; visibleBars?: number; recentBars?: unknown[]; latestBar?: unknown; visibleRange?: unknown; replay?: unknown; chartState?: unknown; capabilities?: Record<string, unknown>; agentContract?: Record<string, unknown>; selectedInspection?: { epoch: number; price: number } | null; availableInstruments?: Array<{symbol:string;name:string}> };
type Props = { symbol: string; instruments: Instrument[]; onClose: () => void; runtimeContext?: RuntimeContext };
type CouncilActivity = { actor: string; phase: string; text: string };
type WebSource = { title: string; url: string; publishedDate?: string; author?: string; text?: string };
type ChatMessage = { id: string; role: 'user' | 'sire'; text: string; meta?: string };
type ChatSession = { id: string; title: string; messages: ChatMessage[]; createdAt: number; updatedAt: number };
type AgentResponse = { text?: string; responseId?: string; actions?: Array<Record<string, unknown>>; agentActions?: Array<Record<string, unknown>>; agentSkills?: string[]; error?: string; webSearched?: boolean; webSources?: WebSource[] };

type PersistedJob = { chatId: string; status: 'processing' | 'complete' | 'error' | 'cancelled'; updatedAt: number };
type DiagnosticCheck = { id:string; area:string; status:'pass'|'warning'|'fail'; severity:string; title:string; detail:string; latencyMs?:number; evidence?:unknown };
type IssueLog = { id:string; timestamp:number; source:string; level:string; message:string; detail?:string; stack?:string; url?:string; line?:number; column?:number; file?:string; component?:string; cause?:string; traceId?:string };
type DiagnosticReport = { ok:boolean; durationMs?:number; mainIssue?:{severity:string;id:string;title:string;detail:string}; summary?:{checks:number;failed:number;warnings:number;passed:number}; checks?:DiagnosticCheck[]; aiMonitor?:any; chart?:any; error?:string };

const readJobs = (): PersistedJob[] => {
  try {
    const raw = window.localStorage.getItem('sire-chat-jobs');
    const jobs = raw ? JSON.parse(raw) : [];
    return Array.isArray(jobs) ? jobs : [];
  } catch { return []; }
};
const writeJob = (chatId: string, status: PersistedJob['status']) => {
  try {
    const jobs = readJobs().filter(job => job.chatId !== chatId);
    jobs.unshift({ chatId, status, updatedAt: Date.now() });
    window.localStorage.setItem('sire-chat-jobs', JSON.stringify(jobs.slice(0, 100)));
    window.dispatchEvent(new CustomEvent('sire:chat-job', { detail: { chatId, status } }));
  } catch { /* storage can be unavailable */ }
};
const persistChatMessage = (chatId: string, message: ChatMessage, title?: string) => {
  try {
    const raw = window.localStorage.getItem('sire-chat-sessions');
    const sessions = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(sessions) ? sessions : [];
    const index = list.findIndex((chat: ChatSession) => chat.id === chatId);
    if (index < 0) return;
    const chat = list[index] as ChatSession;
    const messages = [...chat.messages, message].slice(-200);
    list[index] = { ...chat, title: title && chat.title === 'New chat' ? title : chat.title, messages, updatedAt: Date.now() };
    window.localStorage.setItem('sire-chat-sessions', JSON.stringify(list.filter((chat: ChatSession) => chat.messages.length > 0).slice(0, 100)));
  } catch { /* storage can be unavailable */ }
};

const phaseLabel = (phase: string) => { const value = phase.toLowerCase(); if (value.includes('propos')) return 'proposing'; if (value.includes('research') || value.includes('search')) return 'researching'; if (value.includes('plan')) return 'planning'; if (value.includes('discuss')) return 'discussing'; if (value.includes('respond') || value.includes('revis')) return 'responding'; if (value.includes('check') || value.includes('verif')) return 'checking'; if (value.includes('conclud')) return 'concluding'; if (value.includes('unavailable')) return 'web unavailable'; if (value.includes('fallback')) return 'finishing'; return phase || 'working'; };

function InlineMarkdown({ text }: { text: string }) {
  const tokens = text.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+)/g);
  return <>{tokens.map((token, index) => { if (!token) return null; if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) return <strong key={index}>{token.slice(2, -2)}</strong>; if (token.startsWith('`') && token.endsWith('`')) return <code key={index} className="sire-inline-code">{token.slice(1, -1)}</code>; if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) return <em key={index}>{token.slice(1, -1)}</em>; const markdownLink = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/); if (markdownLink) return <a key={index} href={markdownLink[2]} target="_blank" rel="noreferrer">{markdownLink[1]}</a>; if (/^https?:\/\//.test(token)) return <a key={index} href={token} target="_blank" rel="noreferrer">{token.replace(/^https?:\/\//, '')}</a>; return <span key={index}>{token}</span>; })}</>;
}

function RichMessage({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = []; let list: { ordered: boolean; text: string }[] = []; let quote: string[] = []; let code: string[] | null = null; let codeLanguage = ''; let table: string[][] = [];
  const flushParagraph = () => { if (!paragraph.length) return; blocks.push(<p key={`p-${blocks.length}`}><InlineMarkdown text={paragraph.join(' ')} /></p>); paragraph = []; };
  const flushList = () => { if (!list.length) return; const ordered = list[0].ordered; const items = list.map((item, index) => <li key={index}><InlineMarkdown text={item.text} /></li>); blocks.push(ordered ? <ol key={`ol-${blocks.length}`}>{items}</ol> : <ul key={`ul-${blocks.length}`}>{items}</ul>); list = []; };
  const flushQuote = () => { if (!quote.length) return; blocks.push(<blockquote key={`quote-${blocks.length}`}>{quote.map((line, index) => <div key={index}><InlineMarkdown text={line} /></div>)}</blockquote>); quote = []; };
  const flushTable = () => { if (table.length < 2) { table = []; return; } const header = table[0]; const rows = table.slice(1).filter(row => !row.every(cell => /^\s*:?-{3,}:?\s*$/.test(cell))); blocks.push(<div className="sire-table-wrap" key={`table-${blocks.length}`}><table className="sire-rich-table"><thead><tr>{header.map((cell, index) => <th key={index}><InlineMarkdown text={cell.trim()} /></th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{header.map((_, cellIndex) => <td key={cellIndex}><InlineMarkdown text={(row[cellIndex] || '').trim()} /></td>)}</tr>)}</tbody></table></div>); table = []; };
  const flushCode = () => { if (code === null) return; const source = code.join('\n'); blocks.push(<pre key={`code-${blocks.length}`} className="sire-code-block"><div className="sire-code-head"><span>{codeLanguage || 'code'}</span><button type="button" onClick={() => void navigator.clipboard?.writeText(source)}><Copy size={13} /><span>Copy</span></button></div><code>{source}</code></pre>); code = null; codeLanguage = ''; };
  const isTableLine = (line: string) => line.includes('|') && line.trim().split('|').length >= 3;
  const splitTable = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  lines.forEach((line, index) => {
    const fence = line.match(/^\s*```(.*)$/); if (fence) { if (code === null) { flushParagraph(); flushList(); flushQuote(); flushTable(); code = []; codeLanguage = fence[1].trim(); } else flushCode(); return; }
    if (code !== null) { code.push(line); return; }
    if (!line.trim()) { flushParagraph(); flushList(); flushQuote(); flushTable(); return; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { flushParagraph(); flushList(); flushQuote(); flushTable(); blocks.push(<hr key={`hr-${index}`} />); return; }
    if (isTableLine(line)) { flushParagraph(); flushList(); flushQuote(); table.push(splitTable(line)); return; }
    if (table.length) flushTable();
    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/); if (heading) { flushParagraph(); flushList(); flushQuote(); const level = Math.min(heading[1].length, 4); const content = <InlineMarkdown text={heading[2].replace(/\s+#+\s*$/, '')} />; blocks.push(level === 1 ? <h2 key={`h-${index}`}>{content}</h2> : level === 2 ? <h3 key={`h-${index}`}>{content}</h3> : <h4 key={`h-${index}`}>{content}</h4>); return; }
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/); const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/); if (bullet || numbered) { flushParagraph(); flushQuote(); const ordered = Boolean(numbered); if (list.length && list[0].ordered !== ordered) flushList(); list.push({ ordered, text: (bullet || numbered)![1] }); return; }
    if (/^\s*>/.test(line)) { flushParagraph(); flushList(); quote.push(line.replace(/^\s*>\s?/, '')); return; }
    if (quote.length) flushQuote(); paragraph.push(line.trim());
  });
  flushParagraph(); flushList(); flushQuote(); flushTable(); flushCode(); return <div className="sire-rich-text">{blocks}</div>;
}

function MessageActions({ text }: { text: string }) { const [copied, setCopied] = useState(false); const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { /* native long-press selection remains available */ } }; return <div className="sire-message-actions"><button type="button" onClick={() => void copy()} aria-label="Copy response">{copied ? <Check size={14} /> : <Copy size={14} />}<span>{copied ? 'Copied' : 'Copy'}</span></button></div>; }

export default function ResearchLab({ symbol, instruments, onClose, runtimeContext }: Props) {
  const createChat = (title = 'New chat'): ChatSession => ({ id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title, messages: [], createdAt: Date.now(), updatedAt: Date.now() });
  const chatEndRef = useRef<HTMLDivElement | null>(null); const runtimeContextRef = useRef<RuntimeContext | null>(runtimeContext || null);
  const [chatInput, setChatInput] = useState('');
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => {
    try {
      const raw = window.localStorage.getItem('sire-chat-sessions');
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed) && parsed.length) {
        // Only completed conversations belong in history. An untouched "New chat"
        // is a temporary draft and must never become a saved history item.
        return parsed
          .filter(item => item && Array.isArray(item.messages) && item.messages.length > 0)
          .map(item => ({ ...item, messages: item.messages.slice(-200) }));
      }
      const legacy = window.localStorage.getItem('sire-chat-history');
      const legacyMessages = legacy ? JSON.parse(legacy) : [];
      if (Array.isArray(legacyMessages) && legacyMessages.length) {
        return [{
          id: `chat-legacy-${Date.now()}`,
          title: String(legacyMessages.find((m: any) => m?.role === 'user')?.text || 'Previous chat').slice(0, 48),
          messages: legacyMessages.slice(-200),
          createdAt: Date.now(),
          updatedAt: Date.now()
        }];
      }
    } catch { /* storage can be unavailable in private browsing */ }
    return [];
  });
  const [activeChatId, setActiveChatId] = useState<string | null>(() => { try { const raw = window.localStorage.getItem('sire-active-chat-id'); return raw || null; } catch { return null; } });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [processingChats, setProcessingChats] = useState<string[]>(() => readJobs().filter(job => job.status === 'processing').map(job => job.chatId));
  const currentChatBusy = Boolean(activeChatId && processingChats.includes(activeChatId));
  const cancelledJobsRef = useRef<Set<string>>(new Set());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const [lastPrompt, setLastPrompt] = useState(''); const [lastError, setLastError] = useState(false); const [activity, setActivity] = useState<CouncilActivity[]>([]); const [webSources, setWebSources] = useState<WebSource[]>([]);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false); const [diagnosticsBusy, setDiagnosticsBusy] = useState(false); const [issueLogs, setIssueLogs] = useState<IssueLog[]>([]);
  useEffect(() => {
  try { const raw=window.localStorage.getItem('sire-issue-finder-logs'); const parsed=raw?JSON.parse(raw):[]; if(Array.isArray(parsed)) setIssueLogs(parsed); } catch {}
  const parseLocation=(stack:string, url?:string) => {
    const match=String(stack||'').match(/(?:at\s+[^\n(]+\s*\()?((?:https?:\/\/[^\s)]+|\/[^\s):]+|[^\s):]+)):(\d+):(\d+)\)?/);
    if(!match) return {};
    const source=match[1]; return { url: source.startsWith('http') ? source : (url || window.location.href), line:Number(match[2]), column:Number(match[3]), file:source.split('/').pop() || source };
  };
  const record=(raw:any, source:string, level='error') => {
    const error=raw instanceof Error ? raw : new Error(typeof raw==='string' ? raw : String(raw?.message || raw || 'Unknown browser error'));
    const stack=String(error.stack || '');
    const loc=parseLocation(stack, window.location.href);
    const item:IssueLog={id:'runtime-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),timestamp:Date.now(),source,level,message:error.message,detail:source==='Unhandled promise rejection'?'An unhandled promise rejection reached the global browser error handler.':undefined,stack,url:window.location.href,...loc,component:'browser-runtime'};
    setIssueLogs(previous => { const next=[...previous,item].slice(-500); try { window.localStorage.setItem('sire-issue-finder-logs',JSON.stringify(next)); } catch {} return next; });
    void fetch('/api/sire/issues',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)}).catch(()=>{});
  };
  const onError=(event:ErrorEvent)=>record(event.error || event.message,'Global window error','error');
  const onRejection=(event:PromiseRejectionEvent)=>record(event.reason,'Unhandled promise rejection','error');
  window.addEventListener('error',onError); window.addEventListener('unhandledrejection',onRejection);
  return()=>{window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onRejection);};
}, []); const [thinkingSince, setThinkingSince] = useState<number | null>(null); const [thinkingSeconds, setThinkingSeconds] = useState(0); const [diagnosticReport, setDiagnosticReport] = useState<DiagnosticReport|null>(null);
  const activeChat = chatSessions.find(chat => chat.id === activeChatId) || null;
  const chatMessages = activeChat?.messages || [];
  useEffect(() => {
    // Every time SIRE opens, start on a fresh conversation. Existing chats remain
    // persisted in the history sidebar and can be reopened explicitly.
    const created = createChat();
    setChatSessions(previous => [created, ...previous].slice(0, 100));
    setActiveChatId(created.id);
    try { window.localStorage.removeItem('sire-active-chat-id'); } catch { /* storage can be unavailable */ }
  }, []);
  useEffect(() => {
    try {
      // Never persist an untouched draft. It can exist in memory so the user
      // gets a fresh composer, but history should contain conversations only.
      const completed = chatSessions.filter(chat => chat.messages.length > 0).slice(0, 100);
      window.localStorage.setItem('sire-chat-sessions', JSON.stringify(completed));
      if (activeChatId && !chatSessions.some(chat => chat.id === activeChatId && chat.messages.length > 0)) {
        window.localStorage.removeItem('sire-active-chat-id');
      }
    } catch { /* storage can be unavailable in private browsing */ }
  }, [chatSessions, activeChatId]);
  useEffect(() => { try { if (activeChatId) window.localStorage.setItem('sire-active-chat-id', activeChatId); else window.localStorage.removeItem('sire-active-chat-id'); } catch { /* storage can be unavailable in private browsing */ } }, [activeChatId]);
  useEffect(() => {
    const syncJobs = () => setProcessingChats(readJobs().filter(job => job.status === 'processing').map(job => job.chatId));
    window.addEventListener('sire:chat-job', syncJobs);
    window.addEventListener('storage', syncJobs);
    syncJobs();
    return () => { window.removeEventListener('sire:chat-job', syncJobs); window.removeEventListener('storage', syncJobs); };
  }, []);
  useEffect(() => {
    runtimeContextRef.current = runtimeContext || null;
    const incoming = Array.isArray((runtimeContext as any)?.chartDiagnostics) ? (runtimeContext as any).chartDiagnostics : [];
    if (!incoming.length) return;
    setIssueLogs(previous => {
      const existing = new Set(previous.map(item => item.id));
      const additions = incoming.filter((item:any) => item && item.id !== undefined && !existing.has('chart-'+String(item.id))).map((item:any) => ({
        id: 'chart-'+String(item.id), timestamp: Number(item.timestamp)||Date.now(), source: 'Chart',
        level: String(item.level||'info'), message: String(item.message||item.code||'Chart diagnostic'),
        detail: item.detail ? String(item.detail) : undefined
      }));
      if (!additions.length) return previous;
      const next=[...previous,...additions];
      try { window.localStorage.setItem('sire-issue-finder-logs', JSON.stringify(next)); } catch {}
      return next;
    });
  }, [runtimeContext]); useEffect(() => { if(!currentChatBusy || !thinkingSince){ setThinkingSeconds(0); return; } const tick=()=>setThinkingSeconds(Math.max(0,Math.floor((Date.now()-thinkingSince)/1000))); tick(); const timer=window.setInterval(tick,1000); return ()=>window.clearInterval(timer); }, [currentChatBusy, thinkingSince]); useEffect(() => {
    if (!activity.length) return;
    const latest=activity[activity.length-1];
    const id='activity-'+latest.actor+'-'+latest.phase+'-'+latest.text;
    setIssueLogs(previous => {
      if (previous.some(item => item.id===id)) return previous;
      const next=[...previous,{id,timestamp:Date.now(),source:latest.actor,level:'info',message:latest.text}];
      try { window.localStorage.setItem('sire-issue-finder-logs', JSON.stringify(next)); } catch {}
      return next;
    });
  }, [activity]);
   useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chatMessages, currentChatBusy, activity, webSources]);

  const runDiagnostics = async () => {
    if (diagnosticsBusy) return;
    setDiagnosticsOpen(true); setDiagnosticsBusy(true); setDiagnosticReport(null);
    const started=Date.now();
    try {
      const context=runtimeContextRef.current;
      const [serverResponse, derivResponse, issueResponse]=await Promise.all([fetch('/api/sire/diagnostics',{cache:'no-store'}),fetch('/api/sire/deriv/health',{cache:'no-store'}),fetch('/api/sire/issues',{cache:'no-store'})]);
      const server=await serverResponse.json().catch(()=>({ok:false,error:'Diagnostics HTTP '+serverResponse.status}));
      const deriv=await derivResponse.json().catch(()=>({ok:false,error:'Deriv health HTTP '+derivResponse.status}));
      const checks:DiagnosticCheck[]=[...(Array.isArray(server.checks)?server.checks:[])];
      const chartChecks:DiagnosticCheck[]=[
        {id:'CHART_SYMBOL',area:'chart',status:context?.symbol?'pass':'fail',severity:context?.symbol?'info':'critical',title:'Active chart instrument',detail:context?.symbol?'Chart context reports '+context.symbol+'.':'No active chart symbol was supplied to SIRE.',evidence:context?.symbol||null},
        {id:'CHART_PRICE',area:'chart',status:Number.isFinite(Number(context?.latestPrice))?'pass':'warning',severity:Number.isFinite(Number(context?.latestPrice))?'info':'warning',title:'Live chart price',detail:Number.isFinite(Number(context?.latestPrice))?'A current price is present in chart context.':'Chart context has no current price; this can prevent reliable analysis.',evidence:context?.latestPrice??null},
        {id:'CHART_BARS',area:'chart',status:Number(context?.chartBars||0)>0?'pass':'fail',severity:Number(context?.chartBars||0)>0?'info':'critical',title:'Chart OHLC bars',detail:Number(context?.chartBars||0)>0?String(context.chartBars)+' chart bars are reported.':'No chart bars are reported to SIRE.',evidence:{chartBars:context?.chartBars,visibleBars:context?.visibleBars}},
        {id:'CHART_CONTEXT',area:'chart',status:context?'pass':'fail',severity:context?'info':'critical',title:'AI chart context bridge',detail:context?'Runtime chart context is available to SIRE.':'The AI did not receive chart runtime context.',evidence:{timeframe:context?.timeframe,chartMode:context?.chartMode,indicators:Array.isArray(context?.activeIndicators)?context.activeIndicators.length:null,drawings:Array.isArray(context?.drawings)?context.drawings.length:null}},
        {id:'DERIV_HEALTH',area:'market-data',status:deriv?.ok?'pass':'fail',severity:deriv?.ok?'info':'critical',title:'Deriv market-data health',detail:deriv?.ok?'Deriv market-data health check passed.':String(deriv?.error||'Deriv market-data health check failed.'),evidence:deriv},
        {id:'DIAGNOSTIC_LATENCY',area:'diagnostics',status:(Date.now()-started)<5000?'pass':'warning',severity:(Date.now()-started)<5000?'info':'warning',title:'Issue finder response time',detail:'Full scan completed in '+(Date.now()-started)+'ms.',latencyMs:Date.now()-started}
      ];
      const all=checks.concat(chartChecks); const failed=all.filter(x=>x.status==='fail'); const warnings=all.filter(x=>x.status==='warning'); const serverMain=server.mainIssue;
      const mainIssue=failed.length ? {severity:'critical',id:failed[0].id,title:failed[0].title,detail:failed[0].detail} : serverMain && serverMain.severity!=='info' ? serverMain : warnings.length ? {severity:'warning',id:warnings[0].id,title:warnings[0].title,detail:warnings[0].detail} : {severity:'info',id:'NONE',title:'No blocking issue detected',detail:'The full scan did not find a blocking SIRE AI or chart issue.'};
      setDiagnosticReport({ok:failed.length===0,durationMs:Date.now()-started,mainIssue,summary:{checks:all.length,failed:failed.length,warnings:warnings.length,passed:all.filter(x=>x.status==='pass').length},checks:all,aiMonitor:server.aiMonitor,chart:context});
    } catch(error) { setDiagnosticReport({ok:false,durationMs:Date.now()-started,mainIssue:{severity:'critical',id:'ISSUE_FINDER',title:'Issue finder failed',detail:error instanceof Error?error.message:String(error)}}); }
    finally { setDiagnosticsBusy(false); }
  };
  const cancelConversation = (chatId: string) => {
    cancelledJobsRef.current.add(chatId);
    abortControllersRef.current.get(chatId)?.abort();
    abortControllersRef.current.delete(chatId);
    writeJob(chatId, 'cancelled');
    setThinkingSince(null);
    setProcessingChats(previous => previous.filter(id => id !== chatId));
    setChatSessions(previous => previous.map(chat => chat.id === chatId ? { ...chat, updatedAt: Date.now() } : chat));
  };
  const runAgent = async (prompt: string, retrying = false) => {
    const query = prompt.trim(); if (!query || (activeChatId && processingChats.includes(activeChatId))) return; setLastPrompt(query); setChatInput(''); setLastError(false); setActivity([{ actor:'SIRE', phase:'starting', text:'I’m receiving your message and starting the response.' }]); setThinkingSince(Date.now()); setWebSources([]); const ensureChat = () => {
      if (activeChat) return activeChat.id;
      const created = createChat(query.slice(0, 48) || 'New chat');
      setChatSessions(previous => [created, ...previous].slice(0, 100));
      setActiveChatId(created.id);
      return created.id;
    };
    const chatId = ensureChat();
    cancelledJobsRef.current.delete(chatId);
    const controller = new AbortController();
    abortControllersRef.current.set(chatId, controller);
    writeJob(chatId, 'processing');
    persistChatMessage(chatId, { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'user', text: query }, query.slice(0, 48) || 'New chat');
    setChatSessions(previous => previous.map(chat => chat.id === chatId ? { ...chat, title: chat.title === 'New chat' ? query.slice(0, 48) || 'New chat' : chat.title, messages: [...chat.messages, { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'user', text: query }].slice(-200), updatedAt: Date.now() } : chat));
    const isCancelled = () => cancelledJobsRef.current.has(chatId);
    try { const lowerQuery = query.toLowerCase(); const directGptTest = true; const actualQuery = lowerQuery.startsWith('/gpt ') ? query.slice(5).trim() : query; if (!actualQuery) throw new Error(directGptTest ? 'Message is required.' : 'Message is required.'); const history = [...chatMessages.map(message => ({ role: message.role, text: message.text })), { role: 'user', text: actualQuery }];
      if (directGptTest) {
        const response = await fetch('/api/sire/agent/gpt/stream', {
          method:'POST',
          headers:{'Content-Type':'application/json','Accept':'text/event-stream'},
          signal:controller.signal,
          body:JSON.stringify({ query:actualQuery, history })
        });
        if (!response.ok || !response.body) {
          const fallback = await response.text().catch(()=>'');
          throw new Error(fallback || `Direct GPT connection failed (${response.status})`);
        }
        const reader=response.body.getReader();
        const decoder=new TextDecoder();
        let buffer='';
        let finalData:AgentResponse|null=null;
        const consume=(chunk:string)=>{
          buffer+=chunk;
          const events=buffer.split(/\r?\n\r?\n/);
          buffer=events.pop()||'';
          events.forEach(event=>{
            let type='';
            let data='';
            event.split(/\r?\n/).forEach(line=>{
              if(line.startsWith('event:')) type=line.slice(6).trim();
              else if(line.startsWith('data:')) data+=line.slice(5).trim();
            });
            if(!data) return;
            let payload:any;
            try { payload=JSON.parse(data); } catch { return; }
            if(type==='gpt.status') {
              const item=payload as CouncilActivity;
              setActivity(previous=>[...previous,item]);
            } else if(type==='gpt.done') {
              finalData=payload as AgentResponse;
            } else if(type==='gpt.error') {
              const detail = payload?.status ? ` (HTTP ${payload.status})` : '';
              const requestId = payload?.requestId ? ` [${payload.requestId}]` : '';
              throw new Error(`${String(payload.error||'Direct GPT failed')}${detail}${requestId}`);
            }
          });
        };
        while(true) {
          const {value,done}=await reader.read();
          if(value) consume(decoder.decode(value,{stream:!done}));
          if(done) break;
        }
        // Some proxies terminate an SSE stream immediately after the final event,
        // leaving that event in the decoder buffer without the trailing blank line.
        // Flush the buffer once more before declaring the response missing.
        if(buffer.trim()) consume('\n\n');
        if(!finalData) throw new Error('Direct GPT stream closed before a final response event was received.');
        const data=finalData;
        if(data.error) throw new Error(String(data.error));
        if(isCancelled()) return;
        const reply={id:`m-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,role:'sire' as const,text:String(data.text||'').trim()||'I’m here. Tell me more.'};
        persistChatMessage(chatId,reply);
        writeJob(chatId,'complete');
        setThinkingSince(null);
        setProcessingChats(previous=>previous.filter(id=>id!==chatId));
        setChatSessions(previous=>previous.map(chat=>chat.id===chatId?{...chat,messages:[...chat.messages,reply].slice(-200),updatedAt:Date.now()}:chat));
        return;
      }
      const response = await fetch('/api/sire/agent/council/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, signal: controller.signal, body: JSON.stringify({ query: actualQuery, history }) }); if (!response.ok || !response.body) throw new Error(`SIRE council connection failed (${response.status})`);
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let finalData: AgentResponse | null = null; const consume = (chunk: string) => { buffer += chunk; const events = buffer.split('\n\n'); buffer = events.pop() || ''; events.forEach(event => { let type = ''; let data = ''; event.split('\n').forEach(line => { if (line.startsWith('event:')) type = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }); if (!data) return; const payload = JSON.parse(data); if (type === 'council.stage') setActivity(previous => [...previous, payload as CouncilActivity]); if (type === 'council.done') finalData = payload as AgentResponse; if (type === 'council.error') throw new Error(String(payload.error || 'Council failed')); }); };
      while (true) { const { value, done } = await reader.read(); if (value) consume(decoder.decode(value, { stream: !done })); if (done) break; } if (!finalData) throw new Error('The council ended without a final answer.'); if (isCancelled()) return; if (finalData.error) throw new Error(String(finalData.error)); if (Array.isArray(finalData.webSources)) setWebSources(finalData.webSources); const reply = { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'sire' as const, text: String(finalData?.text || '').trim() || 'I’m here. Tell me more.' };
      persistChatMessage(chatId, reply); writeJob(chatId, 'complete'); setProcessingChats(previous => previous.filter(id => id !== chatId)); setChatSessions(previous => previous.map(chat => chat.id === chatId ? { ...chat, messages: [...chat.messages, reply].slice(-200), updatedAt: Date.now() } : chat));
    } catch (error) { setIssueLogs(previous => { const errorObject=error instanceof Error?error:new Error(String(error)); const stack=String(errorObject.stack||''); const location=stack.match(/(?:at\s+[^\n(]+\s*\()?((?:https?:\/\/[^\s)]+|\/[^\s):]+|[^\s):]+)):(\d+):(\d+)\)?/); const item:IssueLog={id:'error-'+Date.now(),timestamp:Date.now(),source:'SIRE',level:'error',message:errorObject.message,detail:query,stack,url:window.location.href,line:location?Number(location[2]):undefined,column:location?Number(location[3]):undefined,file:location?location[1].split('/').pop()||location[1]:undefined,component:'chat-request'}; const next=[...previous,item]; void fetch('/api/sire/issues',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)}).catch(()=>{}); try { window.localStorage.setItem('sire-issue-finder-logs', JSON.stringify(next)); } catch {} return next; }); if (isCancelled() || (error instanceof DOMException && error.name === 'AbortError')) return; const detail = error instanceof Error ? error.message : 'Connection failed'; setLastError(true); const reply = { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'sire' as const, text: `I couldn’t complete that message. ${detail}`, meta: 'Retry available' }; persistChatMessage(chatId, reply); writeJob(chatId, 'error'); setThinkingSince(null); setProcessingChats(previous => previous.filter(id => id !== chatId)); setChatSessions(previous => previous.map(chat => chat.id === chatId ? { ...chat, messages: [...chat.messages, reply].slice(-200), updatedAt: Date.now() } : chat)); } finally { if (retrying) setLastError(false); }
  };
  const startNewChat = () => { const created = createChat(); setChatSessions(previous => [created, ...previous].slice(0, 100)); setActiveChatId(created.id); setChatInput(''); setActivity([]); setWebSources([]); setLastError(false); setLastPrompt(''); setSidebarOpen(false); };
  const openChat = (id: string) => { setActiveChatId(id); setActivity([]); setWebSources([]); setLastError(false); setSidebarOpen(false); };
  const deleteChat = (id: string) => {
    // Deletion is a hard boundary: cancel in-flight work, invalidate the chat id,
    // remove its persisted messages/jobs immediately, and prevent any late response
    // from being written back into storage or sent as context on a future turn.
    cancelledJobsRef.current.add(id);
    abortControllersRef.current.get(id)?.abort();
    abortControllersRef.current.delete(id);
    try {
      const rawSessions = window.localStorage.getItem('sire-chat-sessions');
      const sessions = rawSessions ? JSON.parse(rawSessions) : [];
      if (Array.isArray(sessions)) {
        window.localStorage.setItem(
          'sire-chat-sessions',
          JSON.stringify(sessions.filter((chat: ChatSession) => chat?.id !== id)),
        );
      }
      const rawJobs = window.localStorage.getItem('sire-chat-jobs');
      const jobs = rawJobs ? JSON.parse(rawJobs) : [];
      if (Array.isArray(jobs)) {
        window.localStorage.setItem(
          'sire-chat-jobs',
          JSON.stringify(jobs.filter((job: PersistedJob) => job?.chatId !== id)),
        );
      }
      if (window.localStorage.getItem('sire-active-chat-id') === id) {
        window.localStorage.removeItem('sire-active-chat-id');
      }
    } catch { /* storage can be unavailable */ }
    setProcessingChats(previous => previous.filter(chatId => chatId !== id));
    setChatSessions(previous => previous.filter(chat => chat.id !== id));
    if (activeChatId === id) {
      const replacement = chatSessions.find(chat => chat.id !== id);
      setActiveChatId(replacement?.id || null);
    }
  };
  const formatChatDate = (timestamp: number) => { const date = new Date(timestamp); const today = new Date(); const yesterday = new Date(Date.now() - 86400000); if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'; return date.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const suggestions = ['Explain this market to me', 'Research the latest news', 'Analyze the current chart'];
  return <div className="sire-chat-only-overlay"><section className="sire-chat-only" aria-label="SIRE conversation">
    <aside className={`sire-chat-history ${sidebarOpen ? 'open' : ''}`} aria-label="SIRE chat history">
      <div className="sire-chat-history-head"><div className="sire-chat-history-brand"><div className="sire-chat-history-mark"><Sparkles size={15} /></div><strong>SIRE</strong></div><button type="button" onClick={() => setSidebarOpen(false)} aria-label="Close chat history"><X size={17} /></button></div>
      <button type="button" className="sire-new-chat" onClick={startNewChat}><MessageSquarePlus size={17} /><span>New chat</span></button>
      <div className="sire-chat-history-label">Recent</div>
      <div className="sire-chat-history-list">{chatSessions.filter(chat => chat.messages.length > 0).map(chat => <div className={`sire-chat-history-item ${chat.id === activeChatId ? 'active' : ''}`} key={chat.id}><button type="button" className="sire-chat-history-open" onClick={() => openChat(chat.id)}><span className="sire-chat-history-title">{chat.title || 'New chat'}</span><small>{processingChats.includes(chat.id) ? '● Responding…' : formatChatDate(chat.updatedAt)}</small></button><button type="button" className="sire-chat-history-delete" onClick={() => deleteChat(chat.id)} aria-label={`Delete ${chat.title || 'chat'}`}><Trash2 size={14} /></button></div>)}{chatSessions.every(chat => chat.messages.length === 0) && <p className="sire-chat-history-empty">Your conversations will appear here.</p>}</div>
    </aside>
    <header className="sire-chat-only-header"><button className="sire-chat-history-toggle" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open chat history"><Menu size={19} /></button><div className="sire-chat-only-brand"><div className="sire-chat-only-mark"><Sparkles size={16} /></div><span>SIRE</span><i className={currentChatBusy ? 'sire-live-dot active' : 'sire-live-dot'} /></div><div className="sire-chat-context"><span>{instruments.find(item => item.symbol === symbol)?.name || symbol}</span></div><div className="sire-chat-header-actions"><button className="sire-chat-header-new" type="button" onClick={() => void runDiagnostics()} aria-label="Run SIRE issue finder" title="Find SIRE issues"><Bug size={17} /><span>Issue finder</span></button><button className="sire-chat-header-new" type="button" onClick={startNewChat}><MessageSquarePlus size={17} /><span>New chat</span></button><button className="sire-chat-only-close" onClick={onClose} aria-label="Close SIRE"><X size={18} /></button></div></header>
    <main className="sire-chat-only-messages"><div className="sire-chat-only-inner">
      {chatMessages.length === 0 && <div className="sire-chat-only-empty"><h1>What can I help you explore?</h1><p>Ask SIRE to research, reason through a problem, or work with your market context.</p><div className="sire-suggestion-grid">{suggestions.map((suggestion, index) => <button key={suggestion} type="button" onClick={() => void runAgent(suggestion)}><span>{index === 0 ? 'Explore' : index === 1 ? 'Research' : 'Analyze'}</span><strong>{suggestion}</strong></button>)}</div></div>}
      {chatMessages.map(item => <article className={`sire-chat-only-message ${item.role}`} key={item.id}><div className="sire-chat-only-bubble">{item.role === 'sire' ? <RichMessage text={item.text} /> : <div className="sire-user-text">{item.text}</div>}</div>{item.role === 'sire' && <MessageActions text={item.text} />}{item.meta && <small>{item.meta}</small>}</article>)}
      {currentChatBusy && <div className="sire-inline-live-block" aria-live="polite"><span className="sire-inline-live-star">✦</span><span className="sire-inline-live-text">{activity[activity.length - 1]?.text || 'Reading your request…'}</span></div>}
      {webSources.length > 0 && <section className="sire-web-sources" aria-label="Web sources"><div className="sire-web-sources-head"><Globe2 size={13} /><strong>Sources</strong><span>{webSources.length}</span></div><div className="sire-web-sources-list">{webSources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="sire-web-source"><span className="sire-web-source-index">{index + 1}</span><span className="sire-web-source-body"><strong>{source.title}</strong><small>{new URL(source.url).hostname}</small></span></a>)}</div></section>}
      {lastError && !currentChatBusy && <button className="sire-chat-only-retry" onClick={() => void runAgent(lastPrompt, true)}>Retry response</button>}
      <div className="sire-chat-end-spacer" aria-hidden="true"><div ref={chatEndRef} /></div>
    {diagnosticsOpen && <div className="sire-diagnostics-overlay" role="dialog" aria-modal="true" aria-label="SIRE issue finder"><section className="sire-diagnostics-panel"><header className="sire-diagnostics-head"><div><strong>SIRE Issue Finder</strong><small>Full AI + chart + market-data health scan</small></div><div className="sire-diagnostics-head-actions"><button type="button" onClick={() => void runDiagnostics()} disabled={diagnosticsBusy}>{diagnosticsBusy ? 'Scanning…' : 'Run again'}</button><button type="button" onClick={() => setDiagnosticsOpen(false)} aria-label="Close issue finder"><X size={18}/></button></div></header>{diagnosticsBusy && <div className="sire-diagnostics-loading"><span className="sire-diagnostics-spinner"/>Checking SIRE AI, providers, connectors, persistence, chart context and Deriv market data…</div>}{diagnosticReport && <><div className={'sire-diagnostics-main '+(diagnosticReport.mainIssue?.severity||'info')}><span>{diagnosticReport.mainIssue?.severity==='critical'?'CRITICAL':diagnosticReport.mainIssue?.severity==='warning'?'WARNING':'OK'}</span><div><strong>{diagnosticReport.mainIssue?.title}</strong><p>{diagnosticReport.mainIssue?.detail}</p></div></div><div className="sire-diagnostics-current">{currentChatBusy ? <><div className="sire-diagnostics-current-head"><strong>Current response</strong><span>{thinkingSeconds}s elapsed</span></div><p>{activity[activity.length-1]?.text || 'SIRE is working…'}</p><div className="sire-diagnostics-current-list">{activity.slice(-5).map((item,index)=><div key={`${index}-${item.actor}-${item.phase}`}><b>{item.actor}</b><span>{phaseLabel(item.phase)}</span><p>{item.text}</p></div>)}</div></> : <><div className="sire-diagnostics-current-head"><strong>Current response</strong><span>idle</span></div><p>No response is running right now. The timing below is from the most recent completed AI run.</p></>}</div><div className="sire-diagnostics-log-head"><strong>Persistent issue log</strong><button type="button" onClick={() => void navigator.clipboard?.writeText(issueLogs.map(item => `[${new Date(item.timestamp).toISOString()}] ${item.level.toUpperCase()} · ${item.source} · ${item.message}${item.detail ? `\n${item.detail}` : ""}`).join("\n\n"))}>Copy all logs</button><span>{issueLogs.length}</span></div><div className="sire-diagnostics-log-list">{issueLogs.slice().reverse().map(item => <article className={`sire-diagnostics-log ${item.level}`} key={item.id}><div><strong>{item.message}</strong><small>{new Date(item.timestamp).toLocaleString()} · {item.source} · {item.level.toUpperCase()}</small>{item.detail && <code>{item.detail}</code>}</div><button type="button" onClick={() => void navigator.clipboard?.writeText(`[${new Date(item.timestamp).toISOString()}] ${item.level.toUpperCase()} · ${item.source} · ${item.message}${item.detail ? `\n${item.detail}` : ""}`)}>Copy</button></article>)}</div>{issueLogs.length>0 && <div className="sire-diagnostics-root-cause"><div className="sire-diagnostics-log-head"><strong>Exact failure trace</strong><span>Most recent captured runtime failure</span></div>{(()=>{const item=issueLogs[issueLogs.length-1]; return <article className="sire-diagnostics-log error"><div><strong>{item.message}</strong><small>{new Date(item.timestamp).toLocaleString()} · {item.source} · {item.component||'runtime'}</small>{item.file && <code>Source: {item.file}{item.line?':'+item.line:''}{item.column?':'+item.column:''}</code>}{item.cause && <code>Cause: {item.cause}</code>}{item.detail && <code>Context: {item.detail}</code>}{item.stack && <details><summary>Full stack trace</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{item.stack}</pre></details>}</div><button type="button" onClick={()=>void navigator.clipboard?.writeText(JSON.stringify(item,null,2))}>Copy</button></article>;})()}</div>}<div className="sire-diagnostics-stats"><span>{diagnosticReport.summary?.passed||0} passed</span><span>{diagnosticReport.summary?.warnings||0} warnings</span><span>{diagnosticReport.summary?.failed||0} failed</span><span>{diagnosticReport.durationMs||0} ms scan</span></div><div className="sire-diagnostics-list">{(diagnosticReport.checks||[]).map(check => <article className={'sire-diagnostic-row '+check.status} key={check.id}><div className="sire-diagnostic-row-top"><strong>{check.title}</strong><span>{check.status.toUpperCase()}{typeof check.latencyMs==='number'?' · '+check.latencyMs+'ms':''}</span></div><p>{check.detail}</p>{check.evidence!==undefined && <code>{typeof check.evidence==='string'?check.evidence:JSON.stringify(check.evidence)}</code>}</article>)}</div>{diagnosticReport.aiMonitor?.lastRun && <div className="sire-diagnostics-history"><strong>Last AI response timing</strong><span>Total: {diagnosticReport.aiMonitor.lastRun.totalMs}ms · Slowest: {diagnosticReport.aiMonitor.lastRun.slowestStage||'n/a'} ({diagnosticReport.aiMonitor.lastRun.slowestMs||0}ms)</span></div>}</>}</section></div>}
    </div></main>
    <footer className="sire-chat-only-composer"><div className="sire-chat-only-input-wrap"><button className="sire-composer-add" type="button" aria-label="Add context"><Plus size={18} /></button><textarea autoFocus={!currentChatBusy} value={chatInput} onChange={event => setChatInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void runAgent(chatInput); } }} placeholder="Message SIRE" rows={1} disabled={currentChatBusy} aria-label="Message SIRE" /><div className="sire-composer-right"><span className="sire-composer-hint">'Enter to send'</span><button className="sire-composer-send" onClick={() => void runAgent(chatInput)} disabled={currentChatBusy || !chatInput.trim()} aria-label="Send message"><Send size={17} /></button></div></div><div className="sire-composer-disclaimer">SIRE can make mistakes. Verify important information.</div></footer>
  </section></div>;
} 