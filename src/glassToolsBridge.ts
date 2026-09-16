const BAR_ID = 'sire-glass-action-bar';
const STYLE_ID = 'sire-glass-tools-bridge-style';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BAR_ID} .glass-action[data-action="tools"] .glass-action-label { display:none !important; }
    #${BAR_ID} .glass-action[data-action="tools"] .glass-action-icon { font-size:22px !important; font-weight:900 !important; line-height:1 !important; }
    #${BAR_ID} .glass-action[data-action="tools"] { min-width:48px !important; width:48px; padding-left:8px !important; padding-right:8px !important; }
    html.sire-tools-open .chart-toolbar {
      display:flex !important;
      position:fixed !important;
      z-index:9997 !important;
      left:50% !important;
      bottom:calc(max(6px,env(safe-area-inset-bottom)) + 112px) !important;
      transform:translateX(-50%) !important;
      width:min(94vw,760px) !important;
      max-height:min(62vh,520px) !important;
      height:auto !important;
      min-height:0 !important;
      margin:0 !important;
      padding:10px !important;
      box-sizing:border-box !important;
      overflow:auto !important;
      pointer-events:auto !important;
      flex-wrap:wrap !important;
      gap:8px !important;
      border:1px solid rgba(255,255,255,.16) !important;
      border-radius:18px !important;
      background:rgba(10,13,18,.72) !important;
      -webkit-backdrop-filter:blur(24px) saturate(145%) !important;
      backdrop-filter:blur(24px) saturate(145%) !important;
      box-shadow:0 18px 48px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.12),0 0 24px rgba(255,255,255,.06) !important;
    }
    html.sire-tools-open .chart-toolbar > * { flex:0 0 auto; }
    html.sire-tools-open .chart-toolbar::before {
      content:'TOOLS'; flex:0 0 100%; font:800 11px/1 system-ui,sans-serif; letter-spacing:.14em; color:rgba(255,255,255,.72); padding:2px 4px 4px;
    }
  `;
  document.head.appendChild(style);
}

function setOpen(open: boolean) {
  document.documentElement.classList.toggle('sire-tools-open', open);
  const button = document.querySelector<HTMLElement>(`#${BAR_ID} [data-action="tools"]`);
  if (button) {
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Tools — close tool bar' : 'Tools — open tool bar');
    button.title = open ? 'Close tools' : 'Open tools';
  }
}

function toggleTools() {
  setOpen(!document.documentElement.classList.contains('sire-tools-open'));
}

function bind() {
  const button = document.querySelector<HTMLElement>(`#${BAR_ID} [data-action="tools"]`);
  if (!button || button.dataset.toolsBridgeBound === 'true') return;
  button.dataset.toolsBridgeBound = 'true';
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleTools();
  });
}

function install() {
  installStyles();
  bind();
  window.setTimeout(bind, 250);
  window.setTimeout(bind, 800);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
else install();

new MutationObserver(bind).observe(document.documentElement, { childList:true, subtree:true });
document.addEventListener('pointerdown', event => {
  if (!document.documentElement.classList.contains('sire-tools-open')) return;
  const target = event.target as Node | null;
  if (target && (target.closest?.('.chart-toolbar') || target.closest?.(`#${BAR_ID} [data-action="tools"]`))) return;
  setOpen(false);
}, true);
window.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });
