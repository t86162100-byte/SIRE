const BAR_ID = 'sire-glass-action-bar';

function indicatorScore(button: HTMLButtonElement) {
  const text = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.textContent || ''}`.toLowerCase();
  let score = 0;
  if (/indicator/.test(text)) score += 20;
  if (/add|open|show|select|study/.test(text)) score += 8;
  if (button.closest('.chart-toolbar')) score += 10;
  if (button.querySelector('svg')) score += 2;
  return score;
}

function openIndicatorList() {
  const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>([
    '.chart-toolbar button',
    'button[aria-label*="indicator" i]',
    'button[title*="indicator" i]',
    'button[data-action*="indicator" i]'
  ].join(','))).filter(button => !button.closest(`#${BAR_ID}`));

  const target = candidates.sort((a, b) => indicatorScore(b) - indicatorScore(a))[0];
  if (target) {
    target.click();
    return;
  }

  window.dispatchEvent(new CustomEvent('sire:open-indicators'));
}

function bind() {
  const bar = document.getElementById(BAR_ID);
  const button = bar?.querySelector<HTMLElement>('[data-action="indicators"]');
  if (!button || button.dataset.indicatorBridgeBound === 'true') return;

  button.dataset.indicatorBridgeBound = 'true';
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openIndicatorList();
  });
  button.setAttribute('aria-label', 'Indicators — open indicator list');
  button.title = 'Indicators — open indicator list';
}

function install() {
  bind();
  window.setTimeout(bind, 200);
  window.setTimeout(bind, 700);
  window.setTimeout(bind, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}

new MutationObserver(bind).observe(document.documentElement, { childList: true, subtree: true });
