const STYLE_ID = 'sire-glass-timeframe-style-fix';

function install() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #sire-glass-action-bar .glass-action[data-action="time"] .glass-action-icon {
      display: none !important;
    }
    #sire-glass-action-bar .glass-action[data-action="time"] .glass-action-label {
      font-size: 18px !important;
      font-weight: 900 !important;
      letter-spacing: .01em !important;
      line-height: 1 !important;
    }
  `;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
