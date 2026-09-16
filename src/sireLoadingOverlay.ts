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
let wasLoading = false;
let finishTimer: number | undefined;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID}{
      position:fixed;inset:0;z-index:9990;display:grid;place-items:center;
      pointer-events:auto;opacity:0;visibility:hidden;
      background:rgba(3,5,9,.58);-webkit-backdrop-filter:blur(18px) saturate(118%);
      backdrop-filter:blur(18px) saturate(118%);transition:opacity .32s ease,visibility .32s ease;
      overflow:hidden;
    }
    #${OVERLAY_ID}.is-visible{opacity:1;visibility:visible}
    #${OVERLAY_ID} .sire-loader{display:flex;align-items:center;justify-content:center;gap:0;min-width:120px;height:64px}
    #${OVERLAY_ID} .sire-logo-orbit{position:relative;width:54px;height:54px;display:grid;place-items:center;flex:0 0 54px}
    #${OVERLAY_ID} .sire-logo-orbit::before{
      content:'';position:absolute;inset:2px;border:1px solid rgba(112,174,255,.28);border-radius:50%;
      animation:sire-orbit 1.55s linear infinite;box-shadow:0 0 16px rgba(72,145,255,.14)
    }
    #${OVERLAY_ID} .sire-logo-mark{
      position:relative;z-index:2;display:grid;place-items:center;width:30px;height:30px;
      color:#fff;font-size:27px;font-weight:900;line-height:1;text-shadow:0 0 10px rgba(130,190,255,.85);
      animation:sire-star 1.15s cubic-bezier(.45,0,.55,1) infinite;
      transform-origin:center
    }
    #${OVERLAY_ID} .sire-logo-mark::after{
      content:'';position:absolute;inset:-7px;border-radius:50%;border:1px solid rgba(112,174,255,.18);
      animation:sire-pulse 1.15s ease-out infinite
    }
    #${OVERLAY_ID} .sire-loader-name{
      width:0;overflow:hidden;opacity:0;transform:translateX(-12px);margin-left:0;
      white-space:nowrap;font-size:22px;font-weight:900;letter-spacing:.18em;color:rgba(255,255,255,.96);
      transition:width .48s cubic-bezier(.22,1,.36,1),opacity .28s ease,transform .48s cubic-bezier(.22,1,.36,1),margin-left .48s ease
    }
    #${OVERLAY_ID}.is-complete .sire-logo-mark{animation:sire-finish .55s cubic-bezier(.22,1,.36,1) forwards}
    #${OVERLAY_ID}.is-complete .sire-logo-orbit::before{animation:sire-finish-ring .55s ease-out forwards}
    #${OVERLAY_ID}.is-complete .sire-loader-name{width:82px;opacity:1;transform:translateX(0);margin-left:10px}
    #${OVERLAY_ID} .sire-loader-message,#${OVERLAY_ID} .sire-loader-line{display:none}
    @keyframes sire-orbit{to{transform:rotate(360deg)}}
    @keyframes sire-star{
      0%{transform:rotate(0deg) scale(.82);opacity:.78}
      45%{transform:rotate(165deg) scale(1.08);opacity:1}
      100%{transform:rotate(360deg) scale(.82);opacity:.78}
    }
    @keyframes sire-pulse{0%{transform:scale(.7);opacity:.7}100%{transform:scale(1.35);opacity:0}}
    @keyframes sire-finish{0%{transform:rotate(0deg) scale(1.04)}100%{transform:rotate(360deg) scale(1)}}
    @keyframes sire-finish-ring{0%{transform:scale(1);opacity:.4}100%{transform:scale(1.45);opacity:0}}
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
    overlay.innerHTML = `
      <div class="sire-loader" role="status" aria-label="Loading SIRE">
        <div class="sire-logo-orbit"><div class="sire-logo-mark">✦</div></div>
        <div class="sire-loader-name">SIRE</div>
        <div class="sire-loader-message"></div>
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

  if (finishTimer !== undefined && active) {
    window.clearTimeout(finishTimer);
    finishTimer = undefined;
  }

  if (active) {
    wasLoading = true;
    el.classList.remove('is-complete');
    el.classList.add('is-visible', SHOW_CLASS);
    return;
  }

  if (wasLoading) {
    wasLoading = false;
    el.classList.remove(SHOW_CLASS);
    el.classList.add('is-visible', 'is-complete');
    finishTimer = window.setTimeout(() => {
      const current = document.getElementById(OVERLAY_ID);
      if (current) current.classList.remove('is-visible', 'is-complete');
      finishTimer = undefined;
    }, 850);
    return;
  }

  el.classList.remove('is-visible', 'is-complete', SHOW_CLASS);
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(sync);
}

const api: LoadingApi = {
  show(message = 'Please wait…') {
    manualMessage = message;
    manualLoading = true;
    scheduleSync();
  },
  hide() {
    manualLoading = false;
    manualMessage = '';
    scheduleSync();
  },
};

(window as Window & { SIRELoading?: LoadingApi }).SIRELoading = api;

function install() {
  installStyles();
  ensureOverlay();
  scheduleSync();
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
