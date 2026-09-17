const STYLE_ID = 'sire-quote-list-full-height';

function install() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* Quote: remove the refresh strip and let the instrument list occupy the full remaining screen. */
    body.sire-active-quote .catalogue-refresh {
      display: none !important;
    }

    body.sire-active-quote .terminal-body {
      height: calc(100dvh - 52px) !important;
      min-height: 0 !important;
      padding-bottom: 0 !important;
      overflow: hidden !important;
    }

    body.sire-active-quote .symbol-sidebar {
      height: 100% !important;
      min-height: 0 !important;
      padding-bottom: 0 !important;
      overflow: hidden !important;
    }

    body.sire-active-quote .symbol-list {
      flex: 1 1 auto !important;
      min-height: 0 !important;
      height: auto !important;
      overflow-y: auto !important;
      padding-bottom: 96px !important;
      overscroll-behavior-y: contain;
    }
  `;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
