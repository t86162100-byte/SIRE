const STYLE_ID = 'sire-quote-logo-position-fix';

function install() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .sire-tab-quote .terminal-topbar { display: none !important; }
    .sire-tab-quote .symbol-sidebar { display: flex !important; flex-direction: column !important; }

    /* Quote order: SIRE logo/header first, Search immediately below it. */
    .sire-tab-quote #sire-quote-logo-header {
      order: 0 !important;
      flex: 0 0 auto !important;
      width: 100% !important;
      margin: 0 0 10px !important;
    }
    .sire-tab-quote .sidebar-search {
      order: 1 !important;
      flex: 0 0 auto !important;
      width: 100% !important;
      margin: 0 0 10px !important;
    }
    .sire-tab-quote .symbol-list { order: 2 !important; }
    .sire-tab-quote .catalogue-refresh { order: 3 !important; }
  `;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
