const BAR_ID = 'sire-glass-action-bar';

type Timeframe = string;

let startY = 0;
let startX = 0;
let tracking = false;
let busy = false;
let activeButton: HTMLElement | null = null;
let viewport: HTMLElement | null = null;
let currentLabel: HTMLElement | null = null;
let nextLabel: HTMLElement | null = null;

function getTimeframes(): Timeframe[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.timeframes button'))
    .map(button => button.textContent?.trim() || '')
    .filter(Boolean);
}

function getActiveIndex(list: Timeframe[]) {
  const active = document.querySelector<HTMLElement>('.timeframes button.tool-active');
  const value = active?.textContent?.trim() || '';
  const index = list.indexOf(value);
  return index >= 0 ? index : Math.max(0, list.indexOf('1m'));
}

function getEls() {
  const bar = document.getElementById(BAR_ID);
  const button = bar?.querySelector<HTMLElement>('[data-action="time"]');
  if (!button) return null;
  activeButton = button;
  viewport = button.querySelector<HTMLElement>('.timeframe-viewport');
  currentLabel = button.querySelector<HTMLElement>('.timeframe-current');
  nextLabel = button.querySelector<HTMLElement>('.timeframe-next');
  return { button, viewport, current: currentLabel, next: nextLabel };
}

function reset(els = getEls()) {
  if (!els?.current || !els.next) return;
  els.current.style.transition = 'none';
  els.next.style.transition = 'none';
  els.current.style.transform = 'translate3d(0,0,0)';
  els.next.style.transform = 'translate3d(0,100%,0)';
  requestAnimationFrame(() => {
    if (!els.current || !els.next) return;
    els.current.style.transition = '';
    els.next.style.transition = '';
  });
}

function prepare(els: NonNullable<ReturnType<typeof getEls>>, direction: number, index: number, list: Timeframe[]) {
  if (!els.current || !els.next) return;
  const nextIndex = (index + direction + list.length) % list.length;
  els.current.textContent = list[index] || '';
  els.next.textContent = list[nextIndex] || '';
  els.current.style.transition = 'none';
  els.next.style.transition = 'none';
  els.current.style.transform = 'translate3d(0,0,0)';
  els.next.style.transform = direction > 0 ? 'translate3d(0,100%,0)' : 'translate3d(0,-100%,0)';
}

function selectTimeframe(value: string) {
  const button = Array.from(document.querySelectorAll<HTMLElement>('.timeframes button'))
    .find(item => item.textContent?.trim() === value);
  if (button) button.click();
}

function finish(direction: number) {
  const els = getEls();
  const list = getTimeframes();
  if (!els || !els.current || !els.next || list.length < 2 || busy) return;
  busy = true;
  const index = getActiveIndex(list);
  const nextIndex = (index + direction + list.length) % list.length;
  const target = list[nextIndex];
  prepare(els, direction, index, list);

  requestAnimationFrame(() => {
    if (!els.current || !els.next) { busy = false; return; }
    els.current.style.transition = 'transform 180ms cubic-bezier(.22,.75,.2,1)';
    els.next.style.transition = 'transform 180ms cubic-bezier(.22,.75,.2,1)';
    els.current.style.transform = direction > 0 ? 'translate3d(0,-100%,0)' : 'translate3d(0,100%,0)';
    els.next.style.transform = 'translate3d(0,0,0)';
  });

  window.setTimeout(() => {
    selectTimeframe(target);
    const fresh = getEls();
    if (fresh?.current && fresh.next) {
      fresh.current.textContent = target;
      fresh.next.textContent = list[(nextIndex + direction + list.length) % list.length] || '';
      fresh.current.style.transition = 'none';
      fresh.next.style.transition = 'none';
      fresh.current.style.transform = 'translate3d(0,0,0)';
      fresh.next.style.transform = 'translate3d(0,100%,0)';
    }
    window.setTimeout(() => {
      reset(getEls());
      busy = false;
    }, 80);
  }, 185);
}

function update(deltaY: number) {
  const els = getEls();
  const list = getTimeframes();
  if (!els || !els.current || !els.next || list.length < 2 || busy) return;
  const index = getActiveIndex(list);
  const direction = deltaY < 0 ? 1 : -1;
  const nextIndex = (index + direction + list.length) % list.length;
  const distance = Math.min(Math.abs(deltaY), 90);
  els.current.textContent = list[index];
  els.next.textContent = list[nextIndex];
  els.current.style.transition = 'none';
  els.next.style.transition = 'none';
  els.current.style.transform = `translate3d(0,${direction > 0 ? -distance : distance}px,0)`;
  els.next.style.transform = `translate3d(0,${direction > 0 ? 90 - distance : -90 + distance}px,0)`;
}

function begin(x: number, y: number) {
  if (busy || getTimeframes().length < 2) return;
  startX = x;
  startY = y;
  tracking = true;
  const els = getEls();
  els?.button.setAttribute('data-swiping', 'true');
}

function move(x: number, y: number, event: Event) {
  if (!tracking || busy) return;
  const dx = x - startX;
  const dy = y - startY;
  if (Math.abs(dy) <= Math.abs(dx) || Math.abs(dy) < 5) return;
  event.preventDefault();
  event.stopImmediatePropagation?.();
  update(dy);
}

function end(x: number, y: number) {
  if (!tracking) return;
  const dy = y - startY;
  const dx = x - startX;
  tracking = false;
  const els = getEls();
  els?.button.removeAttribute('data-swiping');
  if (Math.abs(dy) >= 24 && Math.abs(dy) > Math.abs(dx)) {
    finish(dy < 0 ? 1 : -1);
  } else {
    reset(els);
  }
}

function bind() {
  const els = getEls();
  if (!els || els.button.dataset.timeSwipeBound === 'true') return;
  els.button.dataset.timeSwipeBound = 'true';
  els.button.style.touchAction = 'none';
  els.button.style.userSelect = 'none';
  els.button.style.webkitUserSelect = 'none';
  els.button.style.webkitTouchCallout = 'none';

  els.button.addEventListener('pointerdown', event => begin(event.clientX, event.clientY));
  els.button.addEventListener('pointermove', event => move(event.clientX, event.clientY, event));
  els.button.addEventListener('pointerup', event => end(event.clientX, event.clientY));
  els.button.addEventListener('pointercancel', () => {
    tracking = false;
    const now = getEls();
    now?.button.removeAttribute('data-swiping');
    reset(now);
  });
  els.button.addEventListener('contextmenu', event => event.preventDefault());
  els.button.addEventListener('selectstart', event => event.preventDefault());
}

function install() {
  bind();
  window.setTimeout(bind, 250);
  window.setTimeout(bind, 800);
  window.setTimeout(bind, 1600);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();

new MutationObserver(() => bind()).observe(document.documentElement, { childList: true, subtree: true });
