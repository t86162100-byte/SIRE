const BAR_ID = 'sire-glass-action-bar';
const STYLE_ID = 'sire-glass-symbol-touch-fix';

function applyTouchFix() {
  const button = document.querySelector<HTMLButtonElement>(`#${BAR_ID} .glass-action[data-action="symbol"]`);
  if (!button) return false;
  button.style.touchAction = 'none';
  button.style.webkitUserSelect = 'none';
  button.style.userSelect = 'none';
  button.style.webkitTouchCallout = 'none';
  return true;
}

function install() {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `#${BAR_ID} .glass-action[data-action="symbol"]{touch-action:none!important;user-select:none!important;-webkit-user-select:none!important;-webkit-touch-callout:none!important;}`;
    document.head.appendChild(style);
  }
  applyTouchFix();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}

const observer = new MutationObserver(() => applyTouchFix());
observer.observe(document.documentElement, { childList: true, subtree: true });
