const BAR_ID = 'sire-glass-action-bar';
const STYLE_ID = 'sire-glass-action-bar-style';

type Instrument = { symbol: string; name: string };

const items = [
  ['symbol', '⌕', 'SYMBOL'],
  ['time', '◷', '1m'],
  ['indicators', '◒', 'INDICATORS'],
  ['draw', '✎', 'DRAW'],
  ['tools', '◇', 'TOOLS'],
] as const;

let instrumentItems: Instrument[] = [];
let instrumentIndex = 0;
let symbolButton: HTMLButtonElement | null = null;
let swipeStartY: number | null = null;

function setSymbolLabel(instrument: Instrument | null) {
  if (!symbolButton) return;
  const label = symbolButton.querySelector('.glass-action-label');
  if (label) label.textContent = instrument?.symbol || instrument?.name || 'SYMBOL';
  symbolButton.title = instrument ? `${instrument.name} (${instrument.symbol}) · swipe up/down to change` : 'Swipe up/down to change instrument';
  symbolButton.setAttribute('aria-label', instrument ? `Instrument ${instrument.name}, ${instrument.symbol}. Swipe up or down to change` : 'Select instrument');
}

function announceInstrument() {
  const instrument = instrumentItems[instrumentIndex] || null;
  setSymbolLabel(instrument);
  if (!instrument) return;
  window.dispatchEvent(new CustomEvent('sire:instrument-change', { detail: { symbol: instrument.symbol, name: instrument.name } }));
}

async function loadInstruments() {
  try {
    const ws = new WebSocket('wss://ws.binaryws.com/websockets/v3');
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timeout')), 8000);
      ws.addEventListener('open', () => { window.clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { window.clearTimeout(timer); reject(new Error('connection failed')); }, { once: true });
    });
    const requestId = Math.floor(Math.random() * 900000000) + 100000000;
    ws.send(JSON.stringify({ active_symbols: 'brief', product_type: 'basic', req_id: requestId }));
    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timeout')), 10000);
      ws.addEventListener('message', event => {
        try {
          const data = JSON.parse(event.data) as Record<string, unknown>;
          if (Number(data.req_id) !== requestId) return;
          window.clearTimeout(timer);
          resolve(data);
        } catch { /* ignore malformed packets */ }
      });
    });
    ws.close();
    const active = Array.isArray(response.active_symbols) ? response.active_symbols : [];
    instrumentItems = active
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .filter(item => {
        const symbol = String(item.underlying_symbol || item.symbol || '');
        const text = `${symbol} ${String(item.display_name || '')} ${String(item.market || '')} ${String(item.submarket || '')}`.toLowerCase();
        return /synthetic index|volatility|boom|crash|jump|step|drift|range break|daily reset|random index/.test(text) || /^(R_|1HZ|BOOM|CRASH|STEP|JUMP|DRIFT|RANGE_BREAK|BULL|BEAR)/i.test(symbol);
      })
      .map(item => ({ symbol: String(item.underlying_symbol || item.symbol || ''), name: String(item.underlying_symbol_name || item.display_name || item.underlying_symbol || item.symbol || '') }))
      .filter(item => item.symbol)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (instrumentItems.length) announceInstrument();
  } catch {
    // The main SIRE app remains the source of truth if catalogue discovery is unavailable.
  }
}

function stepInstrument(delta: number) {
  if (!instrumentItems.length) {
    window.dispatchEvent(new CustomEvent('sire:glass-action', { detail: { action: 'symbol' } }));
    return;
  }
  instrumentIndex = (instrumentIndex + delta + instrumentItems.length) % instrumentItems.length;
  announceInstrument();
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BAR_ID}{position:fixed;z-index:9998;left:50%;bottom:calc(max(6px,env(safe-area-inset-bottom)) + 57px);transform:translateX(-50%);width:min(720px,calc(100vw - 28px));height:50px;box-sizing:border-box;display:flex;align-items:center;gap:5px;padding:5px 7px;border:1px solid rgba(255,255,255,.16);border-radius:17px;background:rgba(10,13,18,.34);-webkit-backdrop-filter:blur(24px) saturate(145%);backdrop-filter:blur(24px) saturate(145%);box-shadow:0 14px 38px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.13),inset 0 -1px 0 rgba(255,255,255,.025),0 0 18px rgba(255,255,255,.055);overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;touch-action:pan-x;justify-content:flex-start;white-space:nowrap;isolation:isolate;}
    #${BAR_ID}::-webkit-scrollbar{display:none;width:0;height:0}
    #${BAR_ID}::before{content:'';position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(90deg,rgba(255,255,255,.08),rgba(255,255,255,.42),rgba(255,255,255,.08));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;opacity:.72}
    #${BAR_ID}::after{content:'';position:absolute;left:12%;right:12%;top:-18px;height:26px;background:rgba(255,255,255,.08);filter:blur(22px);opacity:.45;pointer-events:none;z-index:-1}
    #${BAR_ID} .glass-action{position:relative;z-index:1;flex:0 0 auto;min-width:max-content;height:38px;border:1px solid transparent;border-radius:11px;background:rgba(255,255,255,.025);color:rgba(235,240,244,.68);display:flex;align-items:center;justify-content:center;gap:6px;padding:0 12px;font:700 9px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.08em;white-space:nowrap;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:background .16s ease,border-color .16s ease,color .16s ease,box-shadow .16s ease,transform .12s ease}
    #${BAR_ID} .glass-action:hover{background:rgba(255,255,255,.065);border-color:rgba(255,255,255,.10);color:#fff}
    #${BAR_ID} .glass-action:active{transform:scale(.97);background:rgba(255,255,255,.09);color:#fff}
    #${BAR_ID} .glass-action.active{background:rgba(255,255,255,.075);border-color:rgba(255,255,255,.22);color:#fff;box-shadow:inset 0 0 14px rgba(255,255,255,.035),0 0 12px rgba(255,255,255,.05)}
    #${BAR_ID} .glass-action-icon{font-size:15px;line-height:1;letter-spacing:0;opacity:.9}
    #${BAR_ID} .glass-action-label{overflow:visible;text-overflow:clip;max-width:190px;display:block}
    #${BAR_ID} .glass-action[data-action="symbol"] .glass-action-label{max-width:190px;overflow:hidden;text-overflow:ellipsis}
    @media(max-width:520px){#${BAR_ID}{bottom:calc(max(6px,env(safe-area-inset-bottom)) + 56px);width:calc(100vw - 20px);height:48px;padding:4px 5px;border-radius:16px;gap:3px}#${BAR_ID} .glass-action{height:38px;padding:0 10px;gap:4px;font-size:8px;letter-spacing:.06em}#${BAR_ID} .glass-action-icon{font-size:14px}}
  `;
  document.head.appendChild(style);
}

function mountBar() {
  installStyles();
  if (document.getElementById(BAR_ID)) return;
  const bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'SIRE quick actions');
  items.forEach(([action, icon, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'glass-action';
    button.dataset.action = action;
    button.innerHTML = `<span class="glass-action-icon" aria-hidden="true">${icon}</span><span class="glass-action-label">${label}</span>`;
    if (action === 'symbol') {
      symbolButton = button;
      button.addEventListener('pointerdown', event => {
        swipeStartY = event.clientY;
        button.setPointerCapture?.(event.pointerId);
      });
      button.addEventListener('pointerup', event => {
        if (swipeStartY === null) return;
        const deltaY = event.clientY - swipeStartY;
        swipeStartY = null;
        if (Math.abs(deltaY) >= 28) {
          stepInstrument(deltaY < 0 ? 1 : -1);
          return;
        }
        bar.querySelectorAll('.glass-action').forEach(node => node.classList.remove('active'));
        button.classList.add('active');
        window.dispatchEvent(new CustomEvent('sire:glass-action', { detail: { action: 'symbol' } }));
      });
      button.addEventListener('pointercancel', () => { swipeStartY = null; });
    } else {
      button.addEventListener('click', () => {
        bar.querySelectorAll('.glass-action').forEach(node => node.classList.remove('active'));
        button.classList.add('active');
        window.dispatchEvent(new CustomEvent('sire:glass-action', { detail: { action } }));
      });
    }
    bar.appendChild(button);
  });
  document.body.appendChild(bar);
  void loadInstruments();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBar, { once: true });
else mountBar();
const observer = new MutationObserver(() => { if (!document.getElementById(BAR_ID)) mountBar(); });
observer.observe(document.documentElement, { childList: true, subtree: true });
