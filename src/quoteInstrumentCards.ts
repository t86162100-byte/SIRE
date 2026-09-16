const STYLE_ID = 'sire-quote-instrument-cards-style';
const WS_URL = 'wss://ws.binaryws.com/websockets/v3';

type QuoteState = {
  quote: number;
  previous?: number;
  bid?: number;
  ask?: number;
  epoch?: number;
};

const quotes = new Map<string, QuoteState>();
let socket: WebSocket | null = null;
let reconnectTimer = 0;
let observer: MutationObserver | null = null;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .sire-tab-quote .symbol-list .symbol-row {
      position: relative !important;
      display: grid !important;
      grid-template-columns: minmax(0,1fr) auto !important;
      grid-template-rows: auto auto !important;
      align-items: start !important;
      gap: 8px 14px !important;
      min-height: 116px !important;
      padding: 18px 18px !important;
      border-radius: 22px !important;
      border: 1px solid rgba(255,255,255,.09) !important;
      background: rgba(15,17,22,.46) !important;
      -webkit-backdrop-filter: blur(18px) saturate(135%) !important;
      backdrop-filter: blur(18px) saturate(135%) !important;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 10px 28px rgba(0,0,0,.18) !important;
      overflow: hidden !important;
      transition: border-color .22s ease, box-shadow .22s ease, transform .16s ease !important;
    }
    .sire-tab-quote .symbol-list .symbol-row::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      pointer-events: none;
      border: 1px solid transparent;
      opacity: .85;
      transition: border-color .22s ease, box-shadow .22s ease !important;
    }
    .sire-tab-quote .symbol-list .symbol-row[data-price-state="up"]::before {
      border-color: rgba(45,235,139,.82);
      box-shadow: 0 0 14px rgba(45,235,139,.28), 0 0 32px rgba(45,235,139,.12) inset;
    }
    .sire-tab-quote .symbol-list .symbol-row[data-price-state="down"]::before {
      border-color: rgba(255,72,88,.82);
      box-shadow: 0 0 14px rgba(255,72,88,.28), 0 0 32px rgba(255,72,88,.12) inset;
    }
    .sire-tab-quote .symbol-list .symbol-row[data-price-state="flat"]::before {
      border-color: rgba(110,150,255,.32);
    }
    .sire-tab-quote .symbol-list .symbol-row > span:first-child {
      grid-column: 1;
      grid-row: 1;
      min-width: 0;
      display: flex !important;
      flex-direction: column !important;
      align-items: flex-start !important;
      gap: 6px !important;
      text-align: left !important;
    }
    .sire-tab-quote .symbol-list .symbol-row > span:first-child b {
      display: block !important;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 17px !important;
      font-weight: 850 !important;
      line-height: 1.15 !important;
    }
    .sire-tab-quote .symbol-list .symbol-row > span:first-child small {
      font-size: 12px !important;
      opacity: .52 !important;
      letter-spacing: .04em !important;
    }
    .sire-tab-quote .symbol-list .symbol-row .sire-quote-price {
      grid-column: 2;
      grid-row: 1;
      align-self: start;
      text-align: right;
      font-size: 18px;
      font-weight: 850;
      line-height: 1.15;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .sire-tab-quote .symbol-list .symbol-row[data-price-state="up"] .sire-quote-price { color: #52f39a; }
    .sire-tab-quote .symbol-list .symbol-row[data-price-state="down"] .sire-quote-price { color: #ff6674; }
    .sire-tab-quote .symbol-list .symbol-row .sire-quote-details {
      grid-column: 1 / -1;
      grid-row: 2;
      display: flex;
      flex-wrap: wrap;
      gap: 8px 18px;
      min-height: 18px;
      color: rgba(235,240,250,.58);
      font-size: 11px;
      font-weight: 650;
      letter-spacing: .02em;
      font-variant-numeric: tabular-nums;
    }
    .sire-tab-quote .symbol-list .symbol-row .sire-quote-details b {
      color: rgba(235,240,250,.86);
      font-weight: 750;
    }
    .sire-tab-quote .symbol-list .symbol-row > em {
      position: absolute !important;
      right: 16px;
      bottom: 15px;
      z-index: 2;
      font-style: normal !important;
      font-size: 9px !important;
      opacity: .45 !important;
    }
  `;
  document.head.appendChild(style);
}

function formatPrice(value: number | undefined) {
  return Number.isFinite(value) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—';
}

function symbolsFromRows() {
  return Array.from(document.querySelectorAll('.sire-tab-quote .symbol-list .symbol-row'))
    .map(row => (row.querySelector('small')?.textContent || '').trim())
    .filter(Boolean);
}

function decorateRows() {
  document.querySelectorAll<HTMLButtonElement>('.sire-tab-quote .symbol-list .symbol-row').forEach(row => {
    if (row.dataset.quoteCardBound !== 'true') {
      row.dataset.quoteCardBound = 'true';
      const price = document.createElement('strong');
      price.className = 'sire-quote-price';
      price.textContent = '—';
      const details = document.createElement('div');
      details.className = 'sire-quote-details';
      details.innerHTML = '<span>Bid <b>—</b></span><span>Ask <b>—</b></span><span>Live <b>—</b></span>';
      row.append(price, details);
    }
    const symbol = (row.querySelector('small')?.textContent || '').trim();
    const state = symbol ? quotes.get(symbol) : undefined;
    const price = row.querySelector<HTMLElement>('.sire-quote-price');
    const details = row.querySelector<HTMLElement>('.sire-quote-details');
    if (!price || !details) return;
    if (!state) {
      price.textContent = '—';
      row.removeAttribute('data-price-state');
      return;
    }
    price.textContent = formatPrice(state.quote);
    const delta = state.previous === undefined ? 0 : state.quote - state.previous;
    row.dataset.priceState = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    details.innerHTML = `<span>Bid <b>${formatPrice(state.bid ?? state.quote)}</b></span><span>Ask <b>${formatPrice(state.ask ?? state.quote)}</b></span><span>Live <b>${state.epoch ? new Date(state.epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</b></span>`;
  });
}

function connect() {
  if (!document.querySelector('.sire-tab-quote .symbol-list')) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  try {
    socket = new WebSocket(WS_URL);
  } catch {
    return;
  }
  socket.onopen = () => {
    symbolsFromRows().forEach(symbol => {
      try { socket?.send(JSON.stringify({ ticks: symbol, subscribe: 1 })); } catch { /* ignore */ }
    });
  };
  socket.onmessage = event => {
    try {
      const data = JSON.parse(event.data) as Record<string, unknown>;
      if (data.msg_type !== 'tick' || !data.tick || typeof data.tick !== 'object') return;
      const tick = data.tick as Record<string, unknown>;
      const symbol = String(tick.symbol || '');
      const quote = Number(tick.quote);
      if (!symbol || !Number.isFinite(quote)) return;
      const old = quotes.get(symbol);
      quotes.set(symbol, {
        quote,
        previous: old?.quote,
        bid: Number.isFinite(Number(tick.bid)) ? Number(tick.bid) : undefined,
        ask: Number.isFinite(Number(tick.ask)) ? Number(tick.ask) : undefined,
        epoch: Number.isFinite(Number(tick.epoch)) ? Number(tick.epoch) : undefined,
      });
      decorateRows();
    } catch { /* ignore malformed stream messages */ }
  };
  socket.onclose = () => {
    socket = null;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, 3500);
  };
  socket.onerror = () => socket?.close();
}

function install() {
  installStyles();
  decorateRows();
  connect();
  if (!observer) {
    observer = new MutationObserver(() => {
      decorateRows();
      if (!socket || socket.readyState === WebSocket.CLOSED) connect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
