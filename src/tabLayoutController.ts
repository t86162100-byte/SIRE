const STYLE_ID = 'sire-tab-layout-controller-style';
const BAR_ID = 'sire-glass-action-bar';
const NAV_ID = 'sire-bottom-tabs';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* The glass chart controls belong to CHART only. */
    body.sire-active-sire #${BAR_ID},
    body.sire-active-quote #${BAR_ID} {
      display: none !important;
    }

    /* QUOTE: remove the selected AUD Basket/live header controls. */
    body.sire-active-quote .sidebar-meta,
    body.sire-active-quote .terminal-topbar .instrument-picker,
    body.sire-active-quote .terminal-topbar .live-state {
      display: none !important;
    }

    /* With navigation visible, keep the action bar above it. */
    body.sire-active-chart:not(.sire-nav-hidden) #${BAR_ID} {
      bottom: calc(max(6px, env(safe-area-inset-bottom)) + 57px) !important;
    }

    /* When navigation hides, let the chart action bar drop to the bottom. */
    body.sire-active-chart.sire-nav-hidden #${BAR_ID} {
      bottom: max(6px, env(safe-area-inset-bottom)) !important;
    }

    /* In SIRE, the composer follows the navigation: hidden nav = composer at bottom. */
    body.sire-active-sire:not(.sire-nav-hidden) .sire-chat-only-composer {
      bottom: 60px !important;
    }

    body.sire-active-sire.sire-nav-hidden .sire-chat-only-composer {
      bottom: max(6px, env(safe-area-inset-bottom)) !important;
    }

    /* QUOTE search sits immediately below the SIRE header, at the very top of the content. */
    body.sire-active-quote .terminal-topbar {
      min-height: 48px !important;
    }
    body.sire-active-quote .terminal-body {
      display: block !important;
      padding: 0 12px 108px !important;
    }
    body.sire-active-quote .symbol-sidebar {
      display: flex !important;
      width: 100% !important;
      height: calc(100vh - 48px) !important;
      border-right: 0 !important;
      padding: 7px 0 108px !important;
      box-sizing: border-box !important;
    }
    body.sire-active-quote .sidebar-search {
      order: -1 !important;
      width: 100% !important;
      max-width: 760px !important;
      margin: 0 auto 10px !important;
    }
    body.sire-active-quote .sidebar-meta {
      display: none !important;
    }
    body.sire-active-quote .symbol-list {
      width: 100% !important;
      max-width: 760px !important;
      margin: 0 auto !important;
      display: grid !important;
      grid-template-columns: repeat(auto-fill,minmax(220px,1fr));
      gap: 10px;
      overflow-y: auto;
      align-content: start;
      padding-bottom: 8px;
    }
    body.sire-active-quote .symbol-row {
      min-height: 82px;
      padding: 14px !important;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 14px;
      background: rgba(255,255,255,.025);
      text-align: left;
    }
    body.sire-active-quote .symbol-row.active {
      border-color: rgba(255,255,255,.72);
      background: rgba(255,255,255,.07);
      box-shadow: 0 0 18px rgba(255,255,255,.08);
    }
    body.sire-active-quote .catalogue-refresh {
      width: min(760px,100%);
      margin: 12px auto 0;
    }

    @media(max-width:520px) {
      body.sire-active-chart:not(.sire-nav-hidden) #${BAR_ID} {
        bottom: calc(max(6px, env(safe-area-inset-bottom)) + 56px) !important;
      }
      body.sire-active-sire:not(.sire-nav-hidden) .sire-chat-only-composer {
        bottom: 60px !important;
      }
      body.sire-active-quote .terminal-topbar {
        min-height: 48px !important;
      }
      body.sire-active-quote .symbol-sidebar {
        height: calc(100dvh - 48px) !important;
        padding-top: 6px !important;
      }
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
  const isQuote = root.classList.contains('sire-tab-quote');
  const isSire = !isChart && !isQuote;
  const navHidden = nav.classList.contains('nav-auto-hidden');

  body.classList.toggle('sire-active-chart', isChart);
  body.classList.toggle('sire-active-quote', isQuote);
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}

window.setInterval(install, 500);
