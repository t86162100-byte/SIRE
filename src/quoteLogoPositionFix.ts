const STYLE_ID = 'sire-quote-logo-position-fix';

function install() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .sire-tab-quote .terminal-topbar { display: none !important; }
    .sire-tab-quote .symbol-sidebar { display: flex !important; flex-direction: column !important; }
    .sire-tab-quote #sire-quote-logo-header { order: 1 !important; }
    .sire-tab-quote .sidebar-search { order: 2 !important; }
    .sire-tab-quote .symbol-list { order: 3 !important; }
    .sire-tab-quote .catalogue-refresh { order: 4 !important; }
  `;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
