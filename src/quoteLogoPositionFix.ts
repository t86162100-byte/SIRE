const STYLE_ID = 'sire-quote-logo-position-fix';

function install() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .sire-tab-quote .terminal-topbar { display: none !important; }
    .sire-tab-quote .symbol-sidebar { display: flex !important; flex-direction: column !important; }

    /* Header only: match the saved Market header's compact black search treatment.
       Provider/category/filter controls below it remain untouched. */
    .sire-tab-quote #sire-quote-logo-header {
      display: none !important;
    }
    .sire-tab-quote .sidebar-search {
      order: 0 !important;
      flex: 0 0 auto !important;
      width: min(340px, 100%) !important;
      height: 38px !important;
      min-height: 38px !important;
      margin: 0 0 12px !important;
      box-sizing: border-box !important;
      display: flex !important;
      align-items: center !important;
      gap: 9px !important;
      padding: 0 11px !important;
      border: 1px solid #262626 !important;
      border-radius: 7px !important;
      background: #080808 !important;
      color: #777 !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      overflow: hidden !important;
      transition: border-color .15s ease, color .15s ease !important;
    }
    .sire-tab-quote .sidebar-search:focus-within {
      border-color: #555 !important;
      background: #080808 !important;
      color: #aaa !important;
      box-shadow: none !important;
    }
    .sire-tab-quote .sidebar-search input {
      width: 100% !important;
      height: 100% !important;
      min-height: 38px !important;
      box-sizing: border-box !important;
      padding: 0 !important;
      border: 0 !important;
      outline: 0 !important;
      background: transparent !important;
      color: #fff !important;
      font-size: 12px !important;
      font-weight: 500 !important;
    }
    .sire-tab-quote .sidebar-search input::placeholder {
      color: #666 !important;
      font-size: 12px !important;
    }
    .sire-tab-quote .symbol-list { order: 2 !important; }
    .sire-tab-quote .catalogue-refresh { order: 3 !important; }
  `;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
