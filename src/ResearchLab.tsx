import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@appdeploy/client';
import { Check, Copy, Globe2, Plus, Send, Sparkles, X } from 'lucide-react';
import './sire-council.css';

type Instrument = { symbol: string; name: string };
type RuntimeContext = { symbol: string; name?: string; timeframe?: string; chartMode?: string; latestPrice?: number | null; activeIndicators?: string[]; drawings?: Array<Record<string, unknown>>; chartBars?: number; visibleBars?: number; selectedInspection?: { epoch: number; price: number } | null };
type Props = { symbol: string; instruments: Instrument[]; onClose: () => void; onSelectInstrument?: (symbol: string) => void; onSetChartView?: (settings: Record<string, unknown>) => void; onAddMarker?: (label: string) => void; runtimeContext?: RuntimeContext };
type CouncilActivity = { actor: string; phase: string; text: string };
type WebSource = { title: string; url: string; publishedDate?: string; author?: string; text?: string };
type ChatMessage = { id: number; role: 'user' | 'sire'; text: string; meta?: string };
type AgentResponse = { text?: string; responseId?: string; actions?: Array<Record<string, unknown>>; error?: string; webSearched?: boolean; webSources?: WebSource[] };

const phaseLabel = (phase: string) => {
  const value = phase.toLowerCase();
  if (value.includes('propos')) return 'proposing';
  if (value.includes('research') || value.includes('search')) return 'researching';
  if (value.includes('plan')) return 'planning';
  if (value.includes('discuss')) return 'discussing';
  if (value.includes('respond') || value.includes('revis')) return 'responding';
  if (value.includes('check') || value.includes('verif')) return 'checking';
  if (value.includes('conclud')) return 'concluding';
  if (value.includes('unavailable')) return 'web unavailable';
  if (value.includes('fallback')) return 'finishing';
  return phase || 'working';
};

const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function InlineMarkdown({ text }: { text: string }) {
  const escaped = escapeText(text);
  const tokens = escaped.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+)/g);
  return <>{tokens.map((token, index) => {
    if (!token) return null;
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (token.startsWith('`') && token.endsWith('`')) return <code key={index} className="sire-inline-code">{token.slice(1, -1)}</code>;
    const markdownLink = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (markdownLink) return <a key={index} href={markdownLink[2]} target="_blank" rel="noreferrer">{markdownLink[1]}</a>;
    if (/^https?:\/\//.test(token)) return <a key={index} href={token} target="_blank" rel="noreferrer">{token.replace(/^https?:\/\//, '')}</a>;
    return <span key={index}>{token}</span>;
  })}</>;
}

function RichMessage({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; text: string }[] = [];
  let code: string[] | null = null;
  let codeLanguage = '';
  const flushParagraph = () => { if (!paragraph.length) return; blocks.push(<p key={`p-${blocks.length}`}><InlineMarkdown text={paragraph.join(' ')} /></p>); paragraph = []; };
  const flushList = () => { if (!list.length) return; const ordered = list[0].ordered; const items = list.map((item, index) => <li key={index}><InlineMarkdown text={item.text} /></li>); blocks.push(ordered ? <ol key={`ol-${blocks.length}`}>{items}</ol> : <ul key={`ul-${blocks.length}`}>{items}</ul>); list = []; };
  const flushCode = () => { if (code === null) return; const source = code.join('\n'); blocks.push(<pre key={`code-${blocks.length}`} className="sire-code-block"><div className="sire-code-head"><span>{codeLanguage || 'code'}</span><button type="button" onClick={() => void navigator.clipboard?.writeText(source)}><Copy size={13} /><span>Copy</span></button></div><code>{source}</code></pre>); code = null; codeLanguage = ''; };
  lines.forEach((line, index) => {
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) { if (code === null) { flushParagraph(); flushList(); code = []; codeLanguage = fence[1].trim(); } else flushCode(); return; }
    if (code !== null) { code.push(line); return; }
    if (!line.trim()) { flushParagraph(); flushList(); return; }
    const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); const level = heading[1].length; const content = <InlineMarkdown text={heading[2]} />; blocks.push(level === 1 ? <h2 key={`h-${index}`}>{content}</h2> : level === 2 ? <h3 key={`h-${index}`}>{content}</h3> : <h4 key={`h-${index}`}>{content}</h4>); return; }
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || numbered) { flushParagraph(); const ordered = Boolean(numbered); if (list.length && list[0].ordered !== ordered) flushList(); list.push({ ordered, text: (bullet || numbered)![1] }); return; }
    flushList(); paragraph.push(line.trim());
  });
  flushParagraph(); flushList(); flushCode();
  return <div className="sire-rich-text">{blocks}</div>;
}

function MessageActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { /* native selection remains available */ } };
  return <div className="sire-message-actions"><button type="button" onClick={() => void copy()} aria-label="Copy response">{copied ? <Check size={14} /> : <Copy size={14} />}<span>{copied ? 'Copied' : 'Copy'}</span></button></div>;
}

export default function ResearchLab({ symbol, instruments, onClose, onSelectInstrument, onSetChartView, onAddMarker, runtimeContext }: Props) {
  const [activeSymbol, setActiveSymbol] = useState(symbol);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [lastPrompt, setLastPrompt] = useState('');
  const [lastError, setLastError] = useState(false);
  const [activity, setActivity] = useState<CouncilActivity[]>([]);
  const [webSources, setWebSources] = useState<WebSource[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const runtimeContextRef = useRef<RuntimeContext | null>(runtimeContext || null);

  useEffect(() => { runtimeContextRef.current = runtimeContext || null; }, [runtimeContext]);
  useEffect(() => { setActiveSymbol(symbol); }, [symbol]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chatMessages, chatBusy, activity, webSources]);
  const buildRuntimeContext = (): RuntimeContext => runtimeContextRef.current || { symbol: activeSymbol, name: instruments.find(item => item.symbol === activeSymbol)?.name, timeframe: 'unknown', chartMode: 'unknown', latestPrice: null, activeIndicators: [], drawings: [], chartBars: 0, visibleBars: 0, selectedInspection: null };
  const applyActions = (actions: unknown) => { if (!Array.isArray(actions)) return; actions.forEach(action => { const item = action as Record<string, unknown>; const type = String(item.__sireAction || ''); if (type === 'select_instrument') { const requested = String(item.symbol || ''); if (requested && instruments.some(instrument => instrument.symbol === requested)) { setActiveSymbol(requested); onSelectInstrument?.(requested); } } else if (type === 'set_chart_view') onSetChartView?.((item.settings || {}) as Record<string, unknown>); else if (type === 'add_chart_marker') onAddMarker?.(String(item.label || 'SIRE marker')); }); };

  const runAgent = async (prompt: string, retrying = false) => {
    const query = prompt.trim(); if (!query || chatBusy) return;
    setLastPrompt(query); setChatInput(''); setChatBusy(true); setLastError(false); setActivity([]); setWebSources([]);
    setChatMessages(previous => [...previous, { id: Date.now(), role: 'user', text: query }]);
    try {
      const directGptTest = query.toLowerCase().startsWith('/gpt ');
      const actualQuery = directGptTest ? query.slice(5).trim() : query;
      if (!actualQuery) throw new Error('Use /gpt followed by a message.');
      const history = [...chatMessages.map(message => ({ role: message.role, text: message.text })), { role: 'user', text: actualQuery }];
      if (directGptTest) {
        const response = await api.post('/api/sire/agent/gpt', { query: actualQuery, symbol: activeSymbol, history, runtimeContext: buildRuntimeContext() });
        const raw = response as unknown; const data = ((raw && typeof raw === 'object' && 'data' in raw && (raw as Record<string, unknown>).data !== undefined ? (raw as Record<string, unknown>).data : raw) || {}) as AgentResponse;
        if (data.error) throw new Error(String(data.error)); applyActions(data.actions); setChatMessages(previous => [...previous, { id: Date.now() + 1, role: 'sire', text: String(data.text || '').trim() || 'I’m here. Tell me more.' }]); return;
      }
      const response = await fetch('/api/sire/agent/council/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ query: actualQuery, symbol: activeSymbol, history, runtimeContext: buildRuntimeContext() }) });
      if (!response.ok || !response.body) throw new Error(`SIRE council connection failed (${response.status})`);
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let finalData: AgentResponse | null = null;
      const consume = (chunk: string) => { buffer += chunk; const events = buffer.split('\n\n'); buffer = events.pop() || ''; events.forEach(event => { let type = ''; let data = ''; event.split('\n').forEach(line => { if (line.startsWith('event:')) type = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }); if (!data) return; const payload = JSON.parse(data); if (type === 'council.stage') setActivity(previous => [...previous, payload as CouncilActivity]); if (type === 'council.done') finalData = payload as AgentResponse; if (type === 'council.error') throw new Error(String(payload.error || 'Council failed')); }); };
      while (true) { const { value, done } = await reader.read(); if (value) consume(decoder.decode(value, { stream: !done })); if (done) break; }
      if (!finalData) throw new Error('The council ended without a final answer.');
      if (finalData.error) throw new Error(String(finalData.error));
      if (Array.isArray(finalData.webSources)) setWebSources(finalData.webSources);
      applyActions(finalData.actions); setChatMessages(previous => [...previous, { id: Date.now() + 1, role: 'sire', text: String(finalData?.text || '').trim() || 'I’m here. Tell me more.' }]);
    } catch (error) { const detail = error instanceof Error ? error.message : 'Connection failed'; setLastError(true); setChatMessages(previous => [...previous, { id: Date.now() + 1, role: 'sire', text: `I couldn’t complete that message. ${detail}`, meta: 'Retry available' }]); }
    finally { setChatBusy(false); if (retrying) setLastError(false); }
  };

  const suggestions = ['Explain this market to me', 'Research the latest news', 'Analyze the current chart'];

  return <div className="sire-chat-only-overlay"><section className="sire-chat-only" aria-label="SIRE conversation">
    <header className="sire-chat-only-header"><div className="sire-chat-only-brand"><div className="sire-chat-only-mark"><Sparkles size={16} /></div><span>SIRE</span><i className={chatBusy ? 'sire-live-dot active' : 'sire-live-dot'} /></div><div className="sire-chat-context"><span>{instruments.find(item => item.symbol === activeSymbol)?.name || activeSymbol}</span></div><button className="sire-chat-only-close" onClick={onClose} aria-label="Close SIRE"><X size={18} /></button></header>
    <main className="sire-chat-only-messages"><div className="sire-chat-only-inner">
      {chatMessages.length === 0 && <div className="sire-chat-only-empty"><div className="sire-chat-only-empty-orbit"><div className="sire-chat-only-empty-mark"><Sparkles size={23} /></div></div><h1>What can I help you explore?</h1><p>Ask SIRE to research, reason through a problem, or work with your market context.</p><div className="sire-suggestion-grid">{suggestions.map((suggestion, index) => <button key={suggestion} type="button" onClick={() => void runAgent(suggestion)}><span>{index === 0 ? 'Explore' : index === 1 ? 'Research' : 'Analyze'}</span><strong>{suggestion}</strong></button>)}</div></div>}
      {chatMessages.map(item => <article className={`sire-chat-only-message ${item.role}`} key={item.id}><div className="sire-chat-only-bubble">{item.role === 'sire' ? <RichMessage text={item.text} /> : <div className="sire-user-text">{item.text}</div>}</div>{item.role === 'sire' && <MessageActions text={item.text} />}{item.meta && <small>{item.meta}</small>}</article>)}
      {chatBusy && <article className="sire-council-live" aria-live="polite"><div className="sire-council-live-head"><span className="sire-council-live-pulse" /><strong>SIRE is thinking</strong><small>live</small></div><div className="sire-council-live-stream">{activity.slice(-8).map((item, index) => <div className="sire-council-live-event" key={`${index}-${item.actor}-${item.phase}`}><span className="sire-council-live-actor">{item.actor}</span><span className="sire-council-live-phase">{phaseLabel(item.phase)}</span><p>{item.text}</p></div>)}<div className="sire-council-live-cursor"><i /><i /><i /></div></div></article>}
      {webSources.length > 0 && <section className="sire-web-sources" aria-label="Web sources"><div className="sire-web-sources-head"><Globe2 size={13} /><strong>Sources</strong><span>{webSources.length}</span></div><div className="sire-web-sources-list">{webSources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer" className="sire-web-source"><span className="sire-web-source-index">{index + 1}</span><span className="sire-web-source-body"><strong>{source.title}</strong><small>{new URL(source.url).hostname}</small></span></a>)}</div></section>}
      {lastError && !chatBusy && <button className="sire-chat-only-retry" onClick={() => void runAgent(lastPrompt, true)}>Retry response</button>}
      <div ref={chatEndRef} />
    </div></main>
    <footer className="sire-chat-only-composer"><div className="sire-chat-only-input-wrap"><button className="sire-composer-add" type="button" aria-label="Add context"><Plus size={18} /></button><textarea value={chatInput} onChange={event => setChatInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void runAgent(chatInput); } }} placeholder="Message SIRE" rows={1} disabled={chatBusy} aria-label="Message SIRE" /><div className="sire-composer-right"><span className="sire-composer-hint">Enter to send</span><button className="sire-composer-send" onClick={() => void runAgent(chatInput)} disabled={chatBusy || !chatInput.trim()} aria-label="Send message"><Send size={17} /></button></div></div><div className="sire-composer-disclaimer">SIRE can make mistakes. Verify important information.</div></footer>
  </section></div>;
}
