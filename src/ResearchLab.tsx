import { useEffect, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import { Send, Sparkles, X } from 'lucide-react';

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
  error?: string;
};

export default function ResearchLab({ symbol, instruments, onClose, onSelectInstrument, onSetChartView, onAddMarker, runtimeContext }: Props) {
  const [activeSymbol, setActiveSymbol] = useState(symbol);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [lastPrompt, setLastPrompt] = useState('');
  const [lastError, setLastError] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const runtimeContextRef = useRef<RuntimeContext | null>(runtimeContext || null);

  useEffect(() => {
    runtimeContextRef.current = runtimeContext || null;
  }, [runtimeContext]);

  useEffect(() => {
    setActiveSymbol(symbol);
  }, [symbol]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages, chatBusy]);

  const buildRuntimeContext = (): RuntimeContext => runtimeContextRef.current || {
    symbol: activeSymbol,
    name: instruments.find(item => item.symbol === activeSymbol)?.name,
    timeframe: 'unknown',
    chartMode: 'unknown',
    latestPrice: null,
    activeIndicators: [],
    drawings: [],
    chartBars: 0,
    visibleBars: 0,
    selectedInspection: null,
  };

  const runAgent = async (prompt: string, retrying = false) => {
    const query = prompt.trim();
    if (!query || chatBusy) return;

    setLastPrompt(query);
    setChatInput('');
    setChatBusy(true);
    setLastError(false);
    setChatMessages(previous => [...previous, {
      id: Date.now(),
      role: 'user',
      text: query,
    }]);

    try {
      const response = await api.post('/api/sire/agent/chat', {
        query,
        symbol: activeSymbol,
        history: [...chatMessages.map(message => ({ role: message.role, text: message.text })), { role: 'user', text: query }],
        runtimeContext: buildRuntimeContext(),
      });

      // The Render migration client can return the JSON body directly rather
      // than an Axios-style { data } wrapper. Normalize both shapes before
      // reading the response so an undefined .data can never become the
      // user-facing "reading 'text'" error.
      const rawResponse = response as unknown;
      const data = (
        rawResponse &&
        typeof rawResponse === 'object' &&
        'data' in rawResponse &&
        (rawResponse as Record<string, unknown>).data !== undefined
          ? (rawResponse as Record<string, unknown>).data
          : rawResponse
      ) as AgentResponse | undefined;

      if (data?.error) throw new Error(String(data.error));

      const text = String(data?.text || '').trim() || 'I’m here. Tell me more.';
      const actions = Array.isArray(data?.actions) ? data.actions : [];
      actions.forEach(action => {
        const type = String(action.__sireAction || '');
        if (type === 'select_instrument') {
          const requested = String(action.symbol || '');
          if (requested && instruments.some(item => item.symbol === requested)) {
            setActiveSymbol(requested);
            onSelectInstrument?.(requested);
          }
        } else if (type === 'set_chart_view') {
          onSetChartView?.((action.settings || {}) as Record<string, unknown>);
        } else if (type === 'add_chart_marker') {
          onAddMarker?.(String(action.label || 'SIRE marker'));
        }
      });

      setChatMessages(previous => [...previous, {
        id: Date.now() + 1,
        role: 'sire',
        text,
      }]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Connection failed';
      setLastError(true);
      setChatMessages(previous => [...previous, {
        id: Date.now() + 1,
        role: 'sire',
        text: `I couldn’t complete that message. ${detail}`,
        meta: 'Retry available',
      }]);
    } finally {
      setChatBusy(false);
    }

    if (retrying) setLastError(false);
  };

  return (
    <div className="sire-chat-only-overlay">
      <section className="sire-chat-only" aria-label="SIRE conversation">
        <header className="sire-chat-only-header">
          <div className="sire-chat-only-brand">
            <div className="sire-chat-only-mark"><Sparkles size={16} /></div>
            <span>SIRE</span>
            <i />
          </div>
          <button className="sire-chat-only-close" onClick={onClose} aria-label="Close SIRE">
            <X size={18} />
          </button>
        </header>

        <main className="sire-chat-only-messages">
          <div className="sire-chat-only-inner">
            {chatMessages.length === 0 && (
              <div className="sire-chat-only-empty" aria-hidden="true">
                <div className="sire-chat-only-empty-mark"><Sparkles size={22} /></div>
                <span>SIRE</span>
              </div>
            )}

            {chatMessages.map(item => (
              <article className={`sire-chat-only-message ${item.role}`} key={item.id}>
                <div className="sire-chat-only-role">{item.role === 'sire' ? 'SIRE' : 'YOU'}</div>
                <div className="sire-chat-only-bubble">{item.text}</div>
                {item.meta && <small>{item.meta}</small>}
              </article>
            ))}

            {chatBusy && (
              <article className="sire-chat-only-message sire">
                <div className="sire-chat-only-role">SIRE</div>
                <div className="sire-chat-only-typing" aria-label="SIRE is thinking">
                  <i /><i /><i />
                </div>
              </article>
            )}

            {lastError && !chatBusy && (
              <button className="sire-chat-only-retry" onClick={() => void runAgent(lastPrompt, true)}>
                Retry
              </button>
            )}

            <div ref={chatEndRef} />
          </div>
        </main>

        <footer className="sire-chat-only-composer">
          <div className="sire-chat-only-input-wrap">
            <textarea
              value={chatInput}
              onChange={event => setChatInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void runAgent(chatInput);
                }
              }}
              placeholder="Message SIRE"
              rows={1}
              disabled={chatBusy}
              aria-label="Message SIRE"
            />
            <button
              onClick={() => void runAgent(chatInput)}
              disabled={chatBusy || !chatInput.trim()}
              aria-label="Send message"
            >
              <Send size={17} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
