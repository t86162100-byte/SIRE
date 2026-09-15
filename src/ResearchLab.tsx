import { useEffect, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import { Check, Copy, Send, Sparkles, X } from 'lucide-react';
import './chat.css';

type Instrument = { symbol: string; name: string };
type RuntimeContext = {
  symbol: string;
  name?: string;
  timeframe?: string;
  chartMode?: string;
  latestPrice?: number | null;
  activeIndicators?: string[];
  drawings?: Array<Record<string, unknown>>;
  chartBars?: number;
  visibleBars?: number;
  selectedInspection?: { epoch: number; price: number } | null;
};
type Props = {
  symbol: string;
  instruments: Instrument[];
  onClose: () => void;
  onSelectInstrument?: (symbol: string) => void;
  onSetChartView?: (settings: Record<string, unknown>) => void;
  onAddMarker?: (label: string) => void;
  runtimeContext?: RuntimeContext;
};
type ChatMessage = { id: number; role: 'user' | 'sire'; text: string; meta?: string };

type AgentResponse = {
  text?: string;
  responseId?: string;
  actions?: Array<Record<string, unknown>>;
};

function inlineMarkdown(value: string) {
  const tokens = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^\s)]+\))/g;
  const parts = value.split(tokens).filter(Boolean);
  return parts.map((part, index) => {
    if (/^\*\*.*\*\*$/.test(part) || /^__.*__$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^`.*`$/.test(part)) return <code className="sire-inline-code" key={index}>{part.slice(1, -1)}</code>;
    if (/^\*.*\*$/.test(part) || /^_.*_$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = part.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return <span key={index}>{part}</span>;
  });
}

function RichMessage({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: JSX.Element[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let ordered = false;
  let quote: string[] = [];
  let code: string[] = [];
  let inCode = false;
  const flushParagraph = () => { if (!paragraph.length) return; blocks.push(<p key={`p-${blocks.length}`}>{inlineMarkdown(paragraph.join(' '))}</p>); paragraph = []; };
  const flushList = () => { if (!list.length) return; const Tag = ordered ? 'ol' : 'ul'; blocks.push(<Tag key={`l-${blocks.length}`}>{list.map((item, index) => <li key={index}>{inlineMarkdown(item)}</li>)}</Tag>); list = []; ordered = false; };
  const flushQuote = () => { if (!quote.length) return; blocks.push(<blockquote key={`q-${blocks.length}`}>{quote.map((line, index) => <div key={index}>{inlineMarkdown(line)}</div>)}</blockquote>); quote = []; };
  const flushCode = () => { blocks.push(<pre key={`c-${blocks.length}`}><code>{code.join('\n')}</code></pre>); code = []; };

  lines.forEach((line) => {
    if (line.trim().startsWith('```')) {
      if (inCode) flushCode(); else { flushParagraph(); flushList(); flushQuote(); }
      inCode = !inCode; return;
    }
    if (inCode) { code.push(line); return; }
    if (!line.trim()) { flushParagraph(); flushList(); flushQuote(); return; }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); flushQuote(); const level = line.match(/^#+/)?.[0].length || 1; const Tag = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4'; blocks.push(<Tag key={`h-${blocks.length}`}>{inlineMarkdown(heading[1])}</Tag>); return; }
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || numbered) { flushParagraph(); flushQuote(); const nextOrdered = Boolean(numbered); if (list.length && ordered !== nextOrdered) flushList(); ordered = nextOrdered; list.push((bullet || numbered)![1]); return; }
    if (/^>\s?/.test(line)) { flushParagraph(); flushList(); quote.push(line.replace(/^>\s?/, '')); return; }
    flushList(); if (quote.length) flushQuote(); paragraph.push(line.trim());
  });
  if (inCode) flushCode(); flushParagraph(); flushList(); flushQuote();
  return <div className="sire-rich-content">{blocks}</div>;
}

export default function ResearchLab({ symbol, instruments, onClose, onSelectInstrument, onSetChartView, onAddMarker, runtimeContext }: Props) {
  const [activeSymbol, setActiveSymbol] = useState(symbol);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [lastPrompt, setLastPrompt] = useState('');
  const [lastError, setLastError] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const runtimeContextRef = useRef<RuntimeContext | null>(runtimeContext || null);

  useEffect(() => { runtimeContextRef.current = runtimeContext || null; }, [runtimeContext]);
  useEffect(() => { setActiveSymbol(symbol); }, [symbol]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chatMessages, chatBusy]);

  const buildRuntimeContext = (): RuntimeContext => runtimeContextRef.current || {
    symbol: activeSymbol, name: instruments.find(item => item.symbol === activeSymbol)?.name, timeframe: 'unknown', chartMode: 'unknown', latestPrice: null,
    activeIndicators: [], drawings: [], chartBars: 0, visibleBars: 0, selectedInspection: null,
  };

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(current => current === message.id ? null : current), 1400);
    } catch {
      // Native long-press text selection remains available as a fallback.
    }
  };

  const runAgent = async (prompt: string, retrying = false) => {
    const query = prompt.trim();
    if (!query || chatBusy) return;
    setLastPrompt(query); setChatInput(''); setChatBusy(true); setLastError(false);
    setChatMessages(previous => [...previous, { id: Date.now(), role: 'user', text: query }]);
    try {
      const response = await api.post('/api/sire/agent/chat', {
        query, symbol: activeSymbol,
        history: [...chatMessages.map(message => ({ role: message.role, text: message.text })), { role: 'user', text: query }],
        runtimeContext: buildRuntimeContext(),
      });
      const data = response.data as AgentResponse;
      const text = String(data.text || '').trim() || 'I’m here. Tell me more.';
      const actions = Array.isArray(data.actions) ? data.actions : [];
      actions.forEach(action => {
        const type = String(action.__sireAction || '');
        if (type === 'select_instrument') {
          const requested = String(action.symbol || '');
          if (requested && instruments.some(item => item.symbol === requested)) { setActiveSymbol(requested); onSelectInstrument?.(requested); }
        } else if (type === 'set_chart_view') onSetChartView?.((action.settings || {}) as Record<string, unknown>);
        else if (type === 'add_chart_marker') onAddMarker?.(String(action.label || 'SIRE marker'));
      });
      setChatMessages(previous => [...previous, { id: Date.now() + 1, role: 'sire', text }]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Connection failed';
      setLastError(true);
      setChatMessages(previous => [...previous, { id: Date.now() + 1, role: 'sire', text: `I couldn’t complete that message. ${detail}`, meta: 'Retry available' }]);
    } finally { setChatBusy(false); }
    if (retrying) setLastError(false);
  };

  return (
    <div className="sire-chat-only-overlay">
      <section className="sire-chat-only" aria-label="SIRE conversation">
        <header className="sire-chat-only-header">
          <div className="sire-chat-only-brand"><div className="sire-chat-only-mark"><Sparkles size={16} /></div><span>SIRE</span><i /></div>
          <button className="sire-chat-only-close" onClick={onClose} aria-label="Close SIRE"><X size={18} /></button>
        </header>
        <main className="sire-chat-only-messages">
          <div className="sire-chat-only-inner">
            {chatMessages.length === 0 && <div className="sire-chat-only-empty" aria-hidden="true"><div className="sire-chat-only-empty-mark"><Sparkles size={22} /></div><span>SIRE</span></div>}
            {chatMessages.map(item => (
              <article className={`sire-chat-only-message ${item.role}`} key={item.id}>
                <div className="sire-chat-only-role">{item.role === 'sire' ? 'SIRE' : 'YOU'}</div>
                <div className="sire-chat-only-message-row">
                  <div className="sire-chat-only-bubble" aria-label={`${item.role === 'sire' ? 'SIRE' : 'You'} message`}>
                    {item.role === 'sire' ? <RichMessage text={item.text} /> : <div className="sire-user-content">{item.text}</div>}
                  </div>
                  <button className="sire-chat-only-copy" onClick={() => void copyMessage(item)} aria-label={copiedId === item.id ? 'Copied' : 'Copy message'} title={copiedId === item.id ? 'Copied' : 'Copy'}>
                    {copiedId === item.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
                {item.meta && <small>{item.meta}</small>}
              </article>
            ))}
            {chatBusy && <article className="sire-chat-only-message sire"><div className="sire-chat-only-role">SIRE</div><div className="sire-chat-only-typing" aria-label="SIRE is thinking"><i /><i /><i /></div></article>}
            {lastError && !chatBusy && <button className="sire-chat-only-retry" onClick={() => void runAgent(lastPrompt, true)}>Retry</button>}
            <div ref={chatEndRef} />
          </div>
        </main>
        <footer className="sire-chat-only-composer">
          <div className="sire-chat-only-input-wrap">
            <textarea value={chatInput} onChange={event => setChatInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void runAgent(chatInput); } }} placeholder="Message SIRE" rows={1} disabled={chatBusy} aria-label="Message SIRE" />
            <button onClick={() => void runAgent(chatInput)} disabled={chatBusy || !chatInput.trim()} aria-label="Send message"><Send size={17} /></button>
          </div>
        </footer>
      </section>
    </div>
  );
}
