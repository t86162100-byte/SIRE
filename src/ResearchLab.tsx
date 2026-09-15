import { useEffect, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import { Send, Sparkles, X } from 'lucide-react';

type Instrument = { symbol: string; name: string };
type RuntimeContext = { symbol: string; name?: string; timeframe?: string; chartMode?: string; latestPrice?: number | null; activeIndicators?: string[]; drawings?: Array<Record<string, unknown>>; chartBars?: number; visibleBars?: number; selectedInspection?: { epoch: number; price: number } | null };
type Props = { symbol: string; instruments: Instrument[]; onClose: () => void; onSelectInstrument?: (symbol: string) => void; onSetChartView?: (settings: Record<string, unknown>) => void; onAddMarker?: (label: string) => void; runtimeContext?: RuntimeContext };
type CouncilTurn = { provider: string; model: string; role: string; text: string };
type CouncilActivity = { actor: string; phase: string; text: string };
type ChatMessage = { id: number; role: 'user' | 'sire'; text: string; meta?: string };
type AgentResponse = { text?: string; responseId?: string; actions?: Array<Record<string, unknown>>; council?: CouncilTurn[]; councilMode?: string; rounds?: number; error?: string };

const phaseLabel = (phase: string) => {
  const value = phase.toLowerCase();
  if (value.includes('propos')) return 'proposing';
  if (value.includes('research') || value.includes('search')) return 'researching';
  if (value.includes('plan')) return 'planning';
  if (value.includes('discuss')) return 'discussing';
  if (value.includes('respond') || value.includes('revis')) return 'responding';
  if (value.includes('check') || value.includes('verif')) return 'checking';
  if (value.includes('conclud')) return 'concluding';
  if (value.includes('fallback')) return 'finishing';
  return phase || 'working';
};

export default function ResearchLab({ symbol, instruments, onClose, onSelectInstrument, onSetChartView, onAddMarker, runtimeContext }: Props) {
  const [activeSymbol, setActiveSymbol] = useState(symbol);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [lastPrompt, setLastPrompt] = useState('');
  const [lastError, setLastError] = useState(false);
  const [activity, setActivity] = useState<CouncilActivity[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const runtimeContextRef = useRef<RuntimeContext | null>(runtimeContext || null);

  useEffect(() => { runtimeContextRef.current = runtimeContext || null; }, [runtimeContext]);
  useEffect(() => { setActiveSymbol(symbol); }, [symbol]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chatMessages, chatBusy, activity]);

  const buildRuntimeContext = (): RuntimeContext => runtimeContextRef.current || { symbol: activeSymbol, name: instruments.find(item => item.symbol === activeSymbol)?.name, timeframe: 'unknown', chartMode: 'unknown', latestPrice: null, activeIndicators: [], drawings: [], chartBars: 0, visibleBars: 0, selectedInspection: null };

  const applyActions = (actions: unknown) => {
    if (!Array.isArray(actions)) return;
    actions.forEach(action => {
      const item = action as Record<string, unknown>;
      const type = String(item.__sireAction || '');
      if (type === 'select_instrument') {
        const requested = String(item.symbol || '');
        if (requested && instruments.some(instrument => instrument.symbol === requested)) { setActiveSymbol(requested); onSelectInstrument?.(requested); }
      } else if (type === 'set_chart_view') onSetChartView?.((item.settings || {}) as Record<string, unknown>);
      else if (type === 'add_chart_marker') onAddMarker?.(String(item.label || 'SIRE marker'));
    });
  };

  const runAgent = async (prompt: string, retrying = false) => {
    const query = prompt.trim();
    if (!query || chatBusy) return;
    setLastPrompt(query); setChatInput(''); setChatBusy(true); setLastError(false); setActivity([]);
    setChatMessages(previous => [...previous, { id: Date.now(), role: 'user', text: query }]);

    try {
      const directGptTest = query.toLowerCase().startsWith('/gpt ');
      const actualQuery = directGptTest ? query.slice(5).trim() : query;
      if (!actualQuery) throw new Error('Use /gpt followed by a message.');
      const history = [...chatMessages.map(message => ({ role: message.role, text: message.text })), { role: 'user', text: actualQuery }];

      if (directGptTest) {
        const response = await api.post('/api/sire/agent/gpt', { query: actualQuery, symbol: activeSymbol, history, runtimeContext: buildRuntimeContext() });
        const raw = response as unknown;
        const data = ((raw && typeof raw === 'object' && 'data' in raw && (raw as Record<string, unknown>).data !== undefined ? (raw as Record<string, unknown>).data : raw) || {}) as AgentResponse;
        if (data.error) throw new Error(String(data.error));
        applyActions(data.actions);
        setChatMessages(previous => [...previous, { id: Date.now() + 1, role: 'sire', text: String(data.text || '').trim() || 'I’m here. Tell me more.' }]);
        return;
      }

      const response = await fetch('/api/sire/agent/council/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ query: actualQuery, symbol: activeSymbol, history, runtimeContext: buildRuntimeContext() }) });
      if (!response.ok || !response.body) throw new Error(`SIRE council connection failed (${response.status})`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalData: AgentResponse | null = null;
      const consume = (chunk: string) => {
        buffer += chunk;
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        events.forEach(event => {
          let type = '';
          let data = '';
          event.split('\n').forEach(line => { if (line.startsWith('event:')) type = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); });
          if (!data) return;
          try {
            const payload = JSON.parse(data);
            if (type === 'council.stage') setActivity(previous => [...previous, payload as CouncilActivity]);
            if (type === 'council.done') finalData = payload as AgentResponse;
            if (type === 'council.error') throw new Error(String(payload.error || 'Council failed'));
          } catch (error) { if (type === 'council.error') throw error; }
        });
      };
      while (true) { const { value, done } = await reader.read(); if (value) consume(decoder.decode(value, { stream: !done })); if (done) break; }
      if (!finalData) throw new Error('The council ended without a final answer.');
      if (finalData.error) throw new Error(String(finalData.error));
      applyActions(finalData.actions);
      const text = String(finalData.text || '').trim() || 'I’m here. Tell me more.';
      setChatMessages(previous => [...previous, { id: Date.now() + 1, role: 'sire', text }]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Connection failed';
      setLastError(true);
      setChatMessages(previous => [...previous, { id: Date.now() + 1, role: 'sire', text: `I couldn’t complete that message. ${detail}`, meta: 'Retry available' }]);
    } finally { setChatBusy(false); if (retrying) setLastError(false); }
  };

  return (
    <div className="sire-chat-only-overlay">
      <section className="sire-chat-only" aria-label="SIRE conversation">
        <header className="sire-chat-only-header">
          <div className="sire-chat-only-brand"><div className="sire-chat-only-mark"><Sparkles size={16} /></div><span>SIRE</span><i className={chatBusy ? 'sire-live-dot active' : 'sire-live-dot'} /></div>
          <button className="sire-chat-only-close" onClick={onClose} aria-label="Close SIRE"><X size={18} /></button>
        </header>

        <main className="sire-chat-only-messages">
          <div className="sire-chat-only-inner">
            {chatMessages.length === 0 && <div className="sire-chat-only-empty" aria-hidden="true"><div className="sire-chat-only-empty-mark"><Sparkles size={22} /></div><span>SIRE</span></div>}

            {chatMessages.map(item => (
              <article className={`sire-chat-only-message ${item.role}`} key={item.id}>
                <div className="sire-chat-only-role">{item.role === 'sire' ? 'SIRE' : 'YOU'}</div>
                <div className="sire-chat-only-bubble">{item.text}</div>
                {item.meta && <small>{item.meta}</small>}
              </article>
            ))}

            {chatBusy && (
              <article className="sire-council-live" aria-live="polite">
                <div className="sire-council-live-head"><span className="sire-council-live-pulse" /><strong>SIRE is working</strong><small>live</small></div>
                <div className="sire-council-live-stream">
                  {activity.slice(-5).map((item, index) => (
                    <div className="sire-council-live-event" key={`${index}-${item.actor}-${item.phase}`}>
                      <span className="sire-council-live-actor">{item.actor}</span>
                      <span className="sire-council-live-phase">{phaseLabel(item.phase)}</span>
                      <p>{item.text}</p>
                    </div>
                  ))}
                  <div className="sire-council-live-cursor"><i /><i /><i /></div>
                </div>
              </article>
            )}

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
