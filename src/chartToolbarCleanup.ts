const CLEANUP_STYLE_ID = 'sire-chart-toolbar-cleanup-style';

function hideLegacyToolbar() {
  if (!document.querySelector('.sire-chart-tab')) return;
  document.querySelectorAll('.sire-chart-tab .chart-terminal .chart-toolbar').forEach((node) => {
    const element = node as HTMLElement;
    element.style.setProperty('display', 'none', 'important');
    element.style.setProperty('height', '0', 'important');
    element.style.setProperty('min-height', '0', 'important');
    element.style.setProperty('padding', '0', 'important');
    element.style.setProperty('margin', '0', 'important');
    element.style.setProperty('border', '0', 'important');
  });
}

function installCleanup() {
  if (!document.getElementById(CLEANUP_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = CLEANUP_STYLE_ID;
    style.textContent = `
      .sire-chart-tab .chart-terminal .chart-toolbar,
      .sire-chart-tab .chart-terminal [class*="toolbar"] {
        display:none!important;
        height:0!important;
        min-height:0!important;
        max-height:0!important;
        padding:0!important;
        margin:0!important;
        border:0!important;
        overflow:hidden!important;
      }
    `;
    document.head.appendChild(style);
  }
  hideLegacyToolbar();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installCleanup, { once: true });
} else {
  installCleanup();
}

const cleanupObserver = new MutationObserver(hideLegacyToolbar);
cleanupObserver.observe(document.documentElement, { childList: true, subtree: true });
