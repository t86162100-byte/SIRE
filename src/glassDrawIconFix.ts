const STYLE_ID = 'sire-glass-draw-icon-fix';

function install() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #sire-glass-action-bar .glass-action[data-action="draw"] .glass-action-label {
      display: none !important;
    }
    #sire-glass-action-bar .glass-action[data-action="draw"] .glass-action-icon {
      display: flex !important;
      align-items: center;
      justify-content: center;
      width: 100%;
      font-size: 22px !important;
      font-weight: 900 !important;
      line-height: 1 !important;
    }
    #sire-glass-action-bar .glass-action[data-action="draw"] {
      min-width: 48px !important;
      width: 48px;
      padding-left: 8px !important;
      padding-right: 8px !important;
    }
  `;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
