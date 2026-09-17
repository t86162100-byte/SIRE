const BAR_ID = 'sire-glass-action-bar';
const HOLD_MS = 550;
const MOVE_CANCEL_PX = 12;

let timer: number | null = null;
let startX = 0;
let startY = 0;
let holding = false;
let bound: HTMLElement | null = null;

function clearHold() {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  holding = false;
}

function scoreSearchButton(button: HTMLButtonElement) {
  const text = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.textContent || ''}`.toLowerCase();
  let score = 0;
  if (/instrument|symbol/.test(text)) score += 10;
  if (/search|select|choose/.test(text)) score += 6;
  if (button.closest('.chart-subbar')) score += 8;
  if (button.querySelector('svg')) score += 1;
  return score;
}

function openInstrumentSearch() {
  holding = true;

  const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>([
    '.chart-subbar button',
    'button[aria-label*="instrument" i]',
    'button[title*="instrument" i]',
    'button[aria-label*="symbol" i]',
    'button[title*="symbol" i]',
    'button[aria-label*="search" i]'
  ].join(','))).filter(button => !button.closest(`#${BAR_ID}`));

  const target = candidates.sort((a, b) => scoreSearchButton(b) - scoreSearchButton(a))[0];
  if (target) {
    target.click();
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>([
        '.instrument-menu input',
        '.symbol-menu input',
        '.chart-subbar input',
        'input[placeholder*="search" i]',
        'input[placeholder*="instrument" i]',
        'input[placeholder*="symbol" i]'
      ].join(','));
      input?.focus();
    }, 80);
  }

  window.dispatchEvent(new CustomEvent('sire:open-instrument-search'));
}

function bind() {
  const bar = document.getElementById(BAR_ID);
  const button = bar?.querySelector<HTMLElement>('[data-action="symbol"]');
  if (!button || bound === button) return;
  bound = button;

  button.addEventListener('touchstart', event => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    clearHold();
    startX = touch.clientX;
    startY = touch.clientY;
    timer = window.setTimeout(openInstrumentSearch, HOLD_MS);
  }, { passive: true });

  button.addEventListener('touchmove', event => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > MOVE_CANCEL_PX) clearHold();
  }, { passive: true });

  button.addEventListener('touchend', clearHold, { passive: true });
  button.addEventListener('touchcancel', clearHold, { passive: true });

  button.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') return;
    clearHold();
    startX = event.clientX;
    startY = event.clientY;
    timer = window.setTimeout(openInstrumentSearch, HOLD_MS);
  });

  button.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_CANCEL_PX) clearHold();
  });

  button.addEventListener('pointerup', event => { if (event.pointerType !== 'touch') clearHold(); });
  button.addEventListener('pointercancel', clearHold);
}

function install() {
  bind();
  window.setTimeout(bind, 250);
  window.setTimeout(bind, 800);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();

new MutationObserver(bind).observe(document.documentElement, { childList: true, subtree: true });
