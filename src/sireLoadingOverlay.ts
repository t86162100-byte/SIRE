const STYLE_ID = 'sire-loading-overlay-style';
const OVERLAY_ID = 'sire-loading-overlay';
const SHOW_CLASS = 'sire-loading-active';
const MIN_LOAD_MS = 850;

type LoadingApi = { show: (message?: string) => void; hide: () => void };

let manualMessage = '';
let manualLoading = false;
let overlay: HTMLElement | null = null;
let scheduled = false;
let wasLoading = false;
let finishing = false;
let finishTimer: number | undefined;
let minimumLoadTimer: number | undefined;
let loadStartedAt = 0;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID}{position:fixed;inset:0;z-index:9990;display:grid;place-items:center;pointer-events:auto;opacity:0;visibility:hidden;background:rgba(3,5,9,.58);-webkit-backdrop-filter:blur(18px) saturate(118%);backdrop-filter:blur(18px) saturate(118%);transition:opacity .38s ease,visibility .38s ease;overflow:hidden}
    #${OVERLAY_ID}.is-visible{opacity:1;visibility:visible}
    #${OVERLAY_ID} .sire-loader{display:flex;align-items:center;justify-content:center;min-width:155px;height:78px}
    #${OVERLAY_ID} .sire-logo-orbit{position:relative;width:70px;height:70px;display:grid;place-items:center;flex:0 0 70px}
    #${OVERLAY_ID} .sire-logo-orbit::before{display:none!important;content:none!important}
    #${OVERLAY_ID} .sire-logo-mark{position:relative;z-index:2;display:grid;place-items:center;width:46px;height:46px;color:#fff;font-size:41px;font-weight:900;line-height:1;text-shadow:none;filter:none;animation:sire-star 1.15s cubic-bezier(.45,0,.55,1) infinite;transform-origin:center}
    #${OVERLAY_ID} .sire-logo-mark::after{display:none!important;content:none!important}
    #${OVERLAY_ID} .sire-loader-name{display:block;width:0;overflow:hidden;opacity:0;transform:translateX(24px);margin-left:0;white-space:nowrap;font-size:25px;font-weight:900;letter-spacing:.15em;color:#fff;text-shadow:none;transition:width .75s cubic-bezier(.16,1,.3,1),opacity .45s ease,transform .75s cubic-bezier(.16,1,.3,1),margin-left .75s cubic-bezier(.16,1,.3,1)}
    #${OVERLAY_ID}.is-complete .sire-logo-mark{animation:sire-finish .65s cubic-bezier(.22,1,.36,1) forwards}
    #${OVERLAY_ID}.is-complete .sire-loader-name{width:78px;opacity:1;transform:translateX(0);margin-left:15px}
    #${OVERLAY_ID} .sire-loader-message,#${OVERLAY_ID} .sire-loader-line{display:none}
    @keyframes sire-star{0%{transform:rotate(0deg) scale(.82);opacity:.90}45%{transform:rotate(165deg) scale(1.10);opacity:1}100%{transform:rotate(360deg) scale(.82);opacity:.90}}
    @keyframes sire-finish{0%{transform:rotate(0deg) scale(.92)}55%{transform:rotate(180deg) scale(1.08)}100%{transform:rotate(360deg) scale(1)}}
    @media(prefers-reduced-motion:reduce){#${OVERLAY_ID} *{animation:none!important;transition:none!important}}
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
    overlay.innerHTML = `<div class="sire-loader" role="status" aria-label="Loading SIRE"><div class="sire-logo-orbit"><div class="sire-logo-mark">✦</div></div><div class="sire-loader-name">SIRE</div><div class="sire-loader-message"></div><div class="sire-loader-line"></div></div>`;
    document.body.appendChild(overlay);
  }
  return overlay;
}

function shouldAutoLoad() {
  const root = document.getElementById('root');
  if (!root) return false;
  if (root.classList.contains('sire-chart-tab')) {
    const text = root.textContent?.replace(/\s+/g, ' ').toLowerCase() || '';
    const chartStatus = root.querySelector('.sire-chart-status:not(.error)');
    return Boolean(chartStatus) || text.includes('no instrument') || text.includes('waiting for genuine deriv ticks') || text.includes('connecting to deriv');
  }
  if (root.classList.contains('sire-tab-quote')) return !root.querySelector('.native-symbol-list > button');
  return false;
}

function completeLoading(el: HTMLElement) {
  if (!wasLoading || finishing) return;
  wasLoading = false;
  finishing = true;
  el.classList.remove(SHOW_CLASS);
  el.classList.add('is-visible', 'is-complete');
  finishTimer = window.setTimeout(() => {
    const current = document.getElementById(OVERLAY_ID);
    if (current) current.classList.remove('is-visible', 'is-complete', SHOW_CLASS);
    finishing = false;
    finishTimer = undefined;
  }, 1800);
}

function sync() {
  scheduled = false;
  const el = ensureOverlay();
  const active = manualLoading || shouldAutoLoad();
  if (active) {
    if (!wasLoading) loadStartedAt = performance.now();
    wasLoading = true;
    finishing = false;
    if (finishTimer !== undefined) { window.clearTimeout(finishTimer); finishTimer = undefined; }
    if (minimumLoadTimer !== undefined) { window.clearTimeout(minimumLoadTimer); minimumLoadTimer = undefined; }
    el.classList.remove('is-complete');
    el.classList.add('is-visible', SHOW_CLASS);
    return;
  }
  if (wasLoading && !finishing) {
    const remaining = Math.max(0, MIN_LOAD_MS - (performance.now() - loadStartedAt));
    if (remaining > 0) {
      if (minimumLoadTimer === undefined) {
        minimumLoadTimer = window.setTimeout(() => { minimumLoadTimer = undefined; scheduleSync(); }, remaining);
      }
      return;
    }
    completeLoading(el);
    return;
  }
  if (finishing) return;
  el.classList.remove('is-visible', 'is-complete', SHOW_CLASS);
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
