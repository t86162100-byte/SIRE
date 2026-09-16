const STYLE_ID = 'sire-chart-glass-bar-restore-style';
const BAR_ID = 'sire-glass-action-bar';

function install() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* Keep the horizontal chart controls visible whenever the chart pane exists. */
    body:has(.chart-stage) #${BAR_ID} {
      display: flex !important;
      position: fixed !important;
      left: 50% !important;
      bottom: calc(max(6px, env(safe-area-inset-bottom)) + 57px) !important;
      width: min(720px, calc(100vw - 14px)) !important;
      height: 54px !important;
      box-sizing: border-box !important;
      border: 1px solid rgba(150,190,255,.26) !important;
      border-radius: 18px !important;
      background: rgba(14,19,28,.22) !important;
      -webkit-backdrop-filter: blur(26px) saturate(150%) !important;
      backdrop-filter: blur(26px) saturate(150%) !important;
      box-shadow: 0 16px 40px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.14), 0 0 24px rgba(65,145,255,.14) !important;
    }
    body:has(.chart-stage) #${BAR_ID} .glass-action {
      background: rgba(255,255,255,.065) !important;
      border-color: rgba(255,255,255,.13) !important;
    }
    @media(max-width:520px) {
      body:has(.chart-stage) #${BAR_ID} {
        bottom: calc(max(6px, env(safe-area-inset-bottom)) + 56px) !important;
      }
    }
  `;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
