const BAR_ID = 'sire-glass-action-bar';

function drawScore(button: HTMLButtonElement) {
  const text = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.textContent || ''}`.toLowerCase();
  let score = 0;
  if (/draw|drawing|annotat/.test(text)) score += 20;
  if (/line|trend|ray|horizontal|vertical|arrow|rectangle|circle|brush|text/.test(text)) score += 4;
  if (button.closest('.chart-toolbar')) score += 10;
  if (button.querySelector('svg')) score += 2;
  return score;
}

function openDrawList() {
  const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>([
    '.chart-toolbar button',
    'button[aria-label*="draw" i]',
    'button[title*="draw" i]',
    'button[data-action*="draw" i]',
    'button[data-tool*="draw" i]'
  ].join(','))).filter(button => !button.closest(`#${BAR_ID}`));

  const target = candidates.sort((a, b) => drawScore(b) - drawScore(a))[0];
  if (target) {
    target.click();
    return;
  }

  window.dispatchEvent(new CustomEvent('sire:open-draw'));
}

function bind() {
  const bar = document.getElementById(BAR_ID);
  const button = bar?.querySelector<HTMLElement>('[data-action="draw"]');
  if (!button || button.dataset.drawBridgeBound === 'true') return;

  button.dataset.drawBridgeBound = 'true';
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openDrawList();
  });
  button.setAttribute('aria-label', 'Draw — open drawing tools');
  button.title = 'Draw — open drawing tools';
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
