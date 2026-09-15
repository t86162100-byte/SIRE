const STYLE_ID = 'sire-remove-mobile-chart-controls';

function removeMobileChartControls() {
  document.querySelectorAll('.mobile-chart-nav, #sire-mobile-tools, .mobile-tools-sheet').forEach((node) => {
    node.remove();
  });
}

function installRemoval() {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .mobile-chart-nav,
      #sire-mobile-tools,
      .mobile-tools-sheet {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        min-height: 0 !important;
        max-height: 0 !important;
        width: 0 !important;
        overflow: hidden !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  removeMobileChartControls();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installRemoval, { once: true });
} else {
  installRemoval();
}

const removalObserver = new MutationObserver(removeMobileChartControls);
removalObserver.observe(document.documentElement, { childList: true, subtree: true });
