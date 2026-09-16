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
      height: 58px !important;
      min-height: 58px !important;
      margin: 0 0 14px !important;
      box-sizing: border-box !important;
      border: 1px solid rgba(70, 160, 255, .52) !important;
      border-radius: 18px !important;
      background: rgba(8, 18, 32, .38) !important;
      -webkit-backdrop-filter: blur(22px) saturate(150%) !important;
      backdrop-filter: blur(22px) saturate(150%) !important;
      box-shadow:
        0 0 0 1px rgba(35, 130, 255, .12),
        0 0 18px rgba(30, 125, 255, .22),
        0 8px 28px rgba(0, 0, 0, .25),
        inset 0 1px 0 rgba(255, 255, 255, .10) !important;
      overflow: hidden !important;
      transition: border-color .2s ease, box-shadow .2s ease, background .2s ease !important;
    }
    .sire-tab-quote .sidebar-search:focus-within {
      border-color: rgba(72, 166, 255, .95) !important;
      background: rgba(8, 20, 38, .48) !important;
      box-shadow:
        0 0 0 1px rgba(48, 145, 255, .25),
        0 0 24px rgba(30, 135, 255, .38),
        0 10px 32px rgba(0, 0, 0, .28),
        inset 0 1px 0 rgba(255, 255, 255, .13) !important;
    }
    .sire-tab-quote .sidebar-search input {
      width: 100% !important;
      height: 100% !important;
      min-height: 58px !important;
      box-sizing: border-box !important;
      padding: 0 18px 0 48px !important;
      border: 0 !important;
      outline: 0 !important;
      background: transparent !important;
      color: rgba(245, 249, 255, .96) !important;
      font-size: 17px !important;
      font-weight: 500 !important;
    }
    .sire-tab-quote .sidebar-search input::placeholder {
      color: rgba(175, 195, 220, .76) !important;
      font-size: 16px !important;
    }
    .sire-tab-quote .symbol-list { order: 2 !important; }
    .sire-tab-quote .catalogue-refresh { order: 3 !important; }
  `;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
