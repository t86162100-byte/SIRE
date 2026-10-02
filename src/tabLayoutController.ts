const STYLE_ID = 'sire-tab-layout-controller-style';
const BAR_ID = 'sire-glass-action-bar';
const NAV_ID = 'sire-bottom-tabs-v2';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    body.sire-active-sire #${BAR_ID} { display: none !important; }

    body.sire-active-chart:not(.sire-nav-hidden) #${BAR_ID} {
      bottom: calc(max(6px, env(safe-area-inset-bottom)) + 57px) !important;
    }
    body.sire-active-chart.sire-nav-hidden #${BAR_ID} {
      bottom: max(6px, env(safe-area-inset-bottom)) !important;
    }

    body.sire-active-sire:not(.sire-nav-hidden) .sire-chat-only-composer { bottom: 60px !important; }
    body.sire-active-sire.sire-nav-hidden .sire-chat-only-composer { bottom: max(6px, env(safe-area-inset-bottom)) !important; }

    @media(max-width:520px) {
      body.sire-active-chart:not(.sire-nav-hidden) #${BAR_ID} { bottom: calc(max(6px, env(safe-area-inset-bottom)) + 56px) !important; }
      body.sire-active-sire:not(.sire-nav-hidden) .sire-chat-only-composer { bottom: 60px !important; }
    }
  `;
  document.head.appendChild(style);
}

function sync() {
  const root = document.getElementById('root');
  const nav = document.getElementById(NAV_ID);
  const body = document.body;
  if (!root || !nav || !body) return;
  const isChart = root.classList.contains('sire-chart-tab');
  const isSire = !isChart;
  const navHidden = nav.classList.contains('nav-auto-hidden');
  body.classList.toggle('sire-active-chart', isChart);
  body.classList.toggle('sire-active-sire', isSire);
  body.classList.toggle('sire-nav-hidden', navHidden);
}

function install() {
  installStyles();
  sync();
  const root = document.getElementById('root');
  const nav = document.getElementById(NAV_ID);
  if (root && root.dataset.tabLayoutObserved !== 'true') {
    root.dataset.tabLayoutObserved = 'true';
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
  }
  if (nav && nav.dataset.tabLayoutObserved !== 'true') {
    nav.dataset.tabLayoutObserved = 'true';
    new MutationObserver(sync).observe(nav, { attributes: true, attributeFilter: ['class'] });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
window.setInterval(install, 500);
