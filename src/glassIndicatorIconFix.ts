const BAR_ID = 'sire-glass-action-bar';
const STYLE_ID = 'sire-glass-indicator-icon-style';

function installIndicatorIcon() {
  const bar = document.getElementById(BAR_ID);
  const button = bar?.querySelector<HTMLButtonElement>('[data-action="indicators"]');
  if (!button) return;

  if (!button.dataset.indicatorIconFixed) {
    button.innerHTML = '<span class="glass-action-icon indicator-function-icon" aria-hidden="true">ƒ</span>';
    button.dataset.indicatorIconFixed = 'true';
  }

  button.setAttribute('aria-label', 'Indicators');
  button.title = 'Indicators';
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BAR_ID} [data-action="indicators"] .indicator-function-icon {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 21px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0;
      opacity: .95;
    }
    @media(max-width:520px){
      #${BAR_ID} [data-action="indicators"] .indicator-function-icon { font-size: 20px; }
    }
  `;
  document.head.appendChild(style);
}

function install() {
  installStyles();
  installIndicatorIcon();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}

window.setInterval(installIndicatorIcon, 700);
