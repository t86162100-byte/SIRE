const BAR_ID = 'sire-glass-action-bar';
const STYLE_ID = 'sire-safe-timeframe-style';

let boundButton: HTMLElement | null = null;
let startX = 0;
let startY = 0;
let tracking = false;
let busy = false;

function frames() {
  return Array.from(document.querySelectorAll<HTMLElement>('.timeframes button'))
    .map(button => button.textContent?.trim() || '')
    .filter(Boolean);
}

function activeFrame(list = frames()) {
  const active = document.querySelector<HTMLElement>('.timeframes button.tool-active');
  const value = active?.textContent?.trim() || '';
  return value || list[0] || '1m';
}

function findTimeButton() {
  return document.querySelector<HTMLElement>(`#${BAR_ID} [data-action="time"]`);
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BAR_ID} .glass-action[data-action="time"]{min-width:70px;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
    #${BAR_ID} .safe-time-viewport{position:relative;display:block;width:34px;height:20px;line-height:20px;overflow:hidden;text-align:center}
    #${BAR_ID} .safe-time-current,#${BAR_ID} .safe-time-next{position:absolute;left:0;right:0;top:0;width:100%;height:20px;line-height:20px;white-space:nowrap;text-align:center;will-change:transform}
    #${BAR_ID} .safe-time-next{transform:translate3d(0,100%,0)}
    #${BAR_ID} [data-action="time"][data-time-swiping="true"]{background:rgba(255,255,255,.08)}
  `;
  document.head.appendChild(style);
}

function ensureMarkup(button: HTMLElement) {
  let viewport = button.querySelector<HTMLElement>('.safe-time-viewport');
  if (viewport) return viewport;

  const oldLabel = button.querySelector<HTMLElement>('.glass-action-label');
  if (!oldLabel) return null;

  viewport = document.createElement('span');
  viewport.className = 'safe-time-viewport';
  const current = document.createElement('span');
  current.className = 'safe-time-current';
  const next = document.createElement('span');
  next.className = 'safe-time-next';
  current.textContent = oldLabel.textContent?.trim() || '1m';
  next.textContent = current.textContent;
  viewport.append(current, next);
  oldLabel.replaceWith(viewport);
  return viewport;
}

function syncDisplay() {
  const button = findTimeButton();
  if (!button) return false;
  const viewport = ensureMarkup(button);
  const current = viewport?.querySelector<HTMLElement>('.safe-time-current');
  const next = viewport?.querySelector<HTMLElement>('.safe-time-next');
  if (!current || !next) return false;

  const value = activeFrame();
  if (!tracking && !busy) {
    current.textContent = value;
    next.textContent = value;
    current.style.transition = 'none';
    next.style.transition = 'none';
    current.style.transform = 'translate3d(0,0,0)';
    next.style.transform = 'translate3d(0,100%,0)';
  }
  button.title = `Timeframe ${value} · swipe up/down to change`;
  button.setAttribute('aria-label', `Timeframe ${value}. Swipe up or down to change`);
  return true;
}

function choose(value: string) {
  const target = Array.from(document.querySelectorAll<HTMLElement>('.timeframes button'))
    .find(button => button.textContent?.trim() === value);
  target?.click();
}

function reset() {
  const button = findTimeButton();
  const current = button?.querySelector<HTMLElement>('.safe-time-current');
  const next = button?.querySelector<HTMLElement>('.safe-time-next');
  if (!current || !next) return;
  current.style.transition = 'none';
  next.style.transition = 'none';
  current.style.transform = 'translate3d(0,0,0)';
  next.style.transform = 'translate3d(0,100%,0)';
}

function finish(direction: 1 | -1) {
  if (busy) return;
  const list = frames();
  if (list.length < 2) return;
  const currentValue = activeFrame(list);
  const index = Math.max(0, list.indexOf(currentValue));
  const target = list[(index + direction + list.length) % list.length];
  const button = findTimeButton();
  const current = button?.querySelector<HTMLElement>('.safe-time-current');
  const next = button?.querySelector<HTMLElement>('.safe-time-next');
  if (!button || !current || !next) return;

  busy = true;
  current.textContent = currentValue;
  next.textContent = target;
  current.style.transition = 'transform 180ms cubic-bezier(.22,.75,.2,1)';
  next.style.transition = 'transform 180ms cubic-bezier(.22,.75,.2,1)';
  current.style.transform = direction > 0 ? 'translate3d(0,-100%,0)' : 'translate3d(0,100%,0)';
  next.style.transform = 'translate3d(0,0,0)';

  window.setTimeout(() => {
    choose(target);
    syncDisplay();
    reset();
    busy = false;
  }, 190);
}

function bindButton() {
  const button = findTimeButton();
  if (!button || boundButton === button) return;
  boundButton = button;
  ensureMarkup(button);
  button.addEventListener('pointerdown', event => {
    if (busy) return;
    startX = event.clientX;
    startY = event.clientY;
    tracking = true;
    button.setAttribute('data-time-swiping', 'true');
    button.setPointerCapture?.(event.pointerId);
  });
  button.addEventListener('pointermove', event => {
    if (!tracking || busy) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dy) <= Math.abs(dx) || Math.abs(dy) < 6) return;
    event.preventDefault();
  });
  button.addEventListener('pointerup', event => {
    if (!tracking) return;
    const dy = event.clientY - startY;
    const dx = event.clientX - startX;
    tracking = false;
    button.removeAttribute('data-time-swiping');
    if (Math.abs(dy) >= 28 && Math.abs(dy) > Math.abs(dx)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(dy < 0 ? 1 : -1);
    } else {
      reset();
    }
  });
  button.addEventListener('pointercancel', () => {
    tracking = false;
    button.removeAttribute('data-time-swiping');
    reset();
  });
}

function install() {
  installStyles();
  bindButton();
  syncDisplay();
}

function installLater() {
  install();
  window.setTimeout(install, 200);
  window.setTimeout(install, 700);
  window.setTimeout(install, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installLater, { once: true });
} else {
  installLater();
}

document.addEventListener('click', event => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('.timeframes button')) {
    window.setTimeout(syncDisplay, 0);
    window.setTimeout(syncDisplay, 80);
  }
});
