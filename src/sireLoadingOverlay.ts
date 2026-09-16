const STYLE_ID = 'sire-loading-overlay-style';
const OVERLAY_ID = 'sire-loading-overlay';
const SHOW_CLASS = 'sire-loading-active';

type LoadingApi = {
  show: (message?: string) => void;
  hide: () => void;
};

let manualMessage = '';
let manualLoading = false;
let overlay: HTMLElement | null = null;
let scheduled = false;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID}{
      position:fixed;left:0;right:0;top:0;bottom:88px;z-index:9990;
      display:grid;place-items:center;pointer-events:auto;opacity:0;visibility:hidden;
      background:rgba(4,6,11,.68);-webkit-backdrop-filter:blur(16px) saturate(125%);
      backdrop-filter:blur(16px) saturate(125%);transition:opacity .35s ease,visibility .35s ease;
      overflow:hidden;
    }
    #${OVERLAY_ID}.is-visible{opacity:1;visibility:visible}
    #${OVERLAY_ID} .sire-loader{
      position:relative;width:min(280px,72vw);min-height:180px;display:flex;
      flex-direction:column;align-items:center;justify-content:center;gap:18px;
      border:1px solid rgba(255,255,255,.13);border-radius:28px;
      background:rgba(11,14,22,.46);box-shadow:0 24px 70px rgba(0,0,0,.45),
      inset 0 1px 0 rgba(255,255,255,.11),0 0 42px rgba(82,145,255,.10);
    }
    #${OVERLAY_ID} .sire-logo-orbit{position:relative;width:92px;height:92px;display:grid;place-items:center}
    #${OVERLAY_ID} .sire-logo-orbit::before,#${OVERLAY_ID} .sire-logo-orbit::after{
      content:'';position:absolute;border:1px solid rgba(100,169,255,.45);border-radius:50%;
      animation:sire-orbit 2.8s linear infinite;
    }
    #${OVERLAY_ID} .sire-logo-orbit::before{inset:4px;box-shadow:0 0 22px rgba(70,150,255,.25)}
    #${OVERLAY_ID} .sire-logo-orbit::after{inset:15px;border-color:rgba(255,255,255,.22);animation-duration:1.9s;animation-direction:reverse}
    #${OVERLAY_ID} .sire-logo-mark{
      position:relative;z-index:2;width:54px;height:54px;display:grid;place-items:center;
      border-radius:17px;color:#fff;font-size:34px;font-weight:900;line-height:1;
      background:linear-gradient(145deg,rgba(255,255,255,.16),rgba(255,255,255,.035));
      border:1px solid rgba(255,255,255,.28);box-shadow:0 0 18px rgba(105,174,255,.40),
      inset 0 1px 0 rgba(255,255,255,.25);animation:sire-logo-pulse 1.7s ease-in-out infinite;
    }
    #${OVERLAY_ID} .sire-logo-mark::after{content:'';position:absolute;inset:-9px;border-radius:22px;
      border:1px solid rgba(98,165,255,.20);animation:sire-ring 1.7s ease-out infinite}
    #${OVERLAY_ID} .sire-loader-name{font-size:19px;font-weight:900;letter-spacing:.22em;color:rgba(255,255,255,.94)}
    #${OVERLAY_ID} .sire-loader-message{font-size:12px;font-weight:650;letter-spacing:.04em;color:rgba(195,210,235,.72);text-align:center;min-height:16px}
    #${OVERLAY_ID} .sire-loader-line{width:150px;height:2px;overflow:hidden;border-radius:9px;background:rgba(255,255,255,.08)}
    #${OVERLAY_ID} .sire-loader-line::after{content:'';display:block;width:42%;height:100%;border-radius:inherit;
      background:rgba(122,181,255,.95);box-shadow:0 0 12px rgba(88,161,255,.75);animation:sire-progress 1.15s ease-in-out infinite}
    @keyframes sire-orbit{to{transform:rotate(360deg)}}
    @keyframes sire-ring{0%{transform:scale(.8);opacity:.8}100%{transform:scale(1.3);opacity:0}}
    @keyframes sire-logo-pulse{0%,100%{transform:scale(.94) rotate(0deg);box-shadow:0 0 18px rgba(105,174,255,.28)}50%{transform:scale(1.06) rotate(4deg);box-shadow:0 0 30px rgba(105,174,255,.58)}}
    @keyframes sire-progress{0%{transform:translateX(-120%)}100%{transform:translateX(360%)}}
    @media(prefers-reduced-motion:reduce){#${OVERLAY_ID} *{animation:none!important}}
  `;
  document.head.appendChild(style);
}

function ensureOverlay() {
  if (overlay && document.body.contains(overlay)) return overlay;
  overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
      <div class="sire-loader" role="status">
        <div class="sire-logo-orbit"><div class="sire-logo-mark">✦</div></div>
        <div class="sire-loader-name">SIRE</div>
        <div class="sire-loader-message">Preparing your workspace…</div>
        <div class="sire-loader-line"></div>
      </div>`;
    document.body.appendChild(overlay);
  }
  return overlay;
}

function shouldAutoLoad() {
  const root = document.getElementById('root');
  if (!root) return false;

  if (root.classList.contains('sire-chart-tab')) {
    const text = root.textContent?.replace(/\s+/g, ' ').toLowerCase() || '';
    return text.includes('no instrument') || text.includes('waiting for genuine deriv ticks') || text.includes('connecting to deriv');
  }

  if (root.classList.contains('sire-tab-quote')) {
    return !root.querySelector('.symbol-list .symbol-row');
  }

  return false;
}

function sync() {
  scheduled = false;
  const el = ensureOverlay();
  const active = manualLoading || shouldAutoLoad();
  el.classList.toggle('is-visible', active);
  el.classList.toggle(SHOW_CLASS, active);
  const message = el.querySelector<HTMLElement>('.sire-loader-message');
  if (message) message.textContent = manualMessage || (document.getElementById('root')?.classList.contains('sire-tab-quote') ? 'Loading live instruments…' : 'Opening live market data…');
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(sync);
}

const api: LoadingApi = {
  show(message = 'Please wait…') { manualMessage = message; manualLoading = true; scheduleSync(); },
  hide() { manualLoading = false; manualMessage = ''; scheduleSync(); },
};

(window as Window & { SIRELoading?: LoadingApi }).SIRELoading = api;

function install() {
  installStyles();
  ensureOverlay();
  scheduleSync();
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
