const BAR_ID = 'sire-glass-action-bar';

type Instrument = { name: string; symbol: string; row: HTMLElement };

let startY = 0;
let startX = 0;
let tracking = false;
let busy = false;
let longPressTimer: number | null = null;
let longPressTriggered = false;
let activeButton: HTMLElement | null = null;
let activeViewport: HTMLElement | null = null;
let activeCurrent: HTMLElement | null = null;
let activeNext: HTMLElement | null = null;

function getEls() {
  const bar = document.getElementById(BAR_ID);
  if (!bar) return null;
  const button = bar.querySelector<HTMLElement>('[data-action="symbol"]');
  const viewport = bar.querySelector<HTMLElement>('.symbol-viewport');
  const current = bar.querySelector<HTMLElement>('.symbol-current');
  const next = bar.querySelector<HTMLElement>('.symbol-next');
  if (!button || !viewport || !current || !next) return null;
  activeButton = button;
  activeViewport = viewport;
  activeCurrent = current;
  activeNext = next;
  return { bar, button, viewport, current, next };
}

function getInstruments(): Instrument[] {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.symbol-row'));
  const seen = new Set<string>();
  return rows.map(row => {
    const name = row.querySelector('b')?.textContent?.trim() || '';
    const symbol = row.querySelector('small')?.textContent?.trim() || '';
    return { name, symbol, row };
  }).filter(item => {
    const key = item.symbol || item.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function currentIndex(list: Instrument[]) {
  const currentName = activeCurrent?.textContent?.trim() || '';
  const currentSymbol = document.querySelector('.chart-subbar > div:first-child span')?.textContent?.trim() || '';
  const index = list.findIndex(item => item.name === currentName || item.name === currentSymbol || item.symbol === currentSymbol);
  return index >= 0 ? index : 0;
}

function reset(els = getEls()) {
  if (!els) return;
  els.current.style.transition = 'none';
  els.next.style.transition = 'none';
  els.current.style.transform = 'translate3d(0,0,0)';
  els.next.style.transform = 'translate3d(0,100%,0)';
}

function prepare(els: NonNullable<ReturnType<typeof getEls>>, direction: number, index: number, list: Instrument[]) {
  const nextIndex = (index + direction + list.length) % list.length;
  els.current.textContent = list[index]?.name || '';
  els.next.textContent = list[nextIndex]?.name || '';
  els.current.style.transition = 'none';
  els.next.style.transition = 'none';
  els.current.style.transform = 'translate3d(0,0,0)';
  els.next.style.transform = direction > 0 ? 'translate3d(0,100%,0)' : 'translate3d(0,-100%,0)';
}

function selectRow(item: Instrument) {
  item.row.click();
}

function finish(direction: number) {
  const els = getEls();
  const list = getInstruments();
  if (!els || list.length < 2 || busy) return;
  busy = true;
  const index = currentIndex(list);
  const nextIndex = (index + direction + list.length) % list.length;
  const target = list[nextIndex];
  prepare(els, direction, index, list);

  requestAnimationFrame(() => {
    els.current.style.transition = 'transform 190ms cubic-bezier(.22,.75,.2,1)';
    els.next.style.transition = 'transform 190ms cubic-bezier(.22,.75,.2,1)';
    els.current.style.transform = direction > 0 ? 'translate3d(0,-100%,0)' : 'translate3d(0,100%,0)';
    els.next.style.transform = 'translate3d(0,0,0)';
  });

  window.setTimeout(() => {
    selectRow(target);
    const fresh = getEls();
    if (fresh) {
      fresh.button.dataset.swiping = 'true';
      fresh.current.textContent = target.name;
      fresh.next.textContent = list[(nextIndex + direction + list.length) % list.length]?.name || '';
      fresh.current.style.transition = 'none';
      fresh.next.style.transition = 'none';
      fresh.current.style.transform = 'translate3d(0,0,0)';
      fresh.next.style.transform = 'translate3d(0,100%,0)';
    }
    window.setTimeout(() => {
      const done = getEls();
      if (done) done.button.dataset.swiping = 'false';
      busy = false;
    }, 550);
  }, 200);
}

function updateSwipe(deltaY: number) {
  const els = getEls();
  const list = getInstruments();
  if (!els || list.length < 2 || busy) return;
  const index = currentIndex(list);
  const direction = deltaY < 0 ? 1 : -1;
  const nextIndex = (index + direction + list.length) % list.length;
  els.current.textContent = list[index].name;
  els.next.textContent = list[nextIndex].name;
  const distance = Math.min(Math.abs(deltaY), 90);
  els.current.style.transition = 'none';
  els.next.style.transition = 'none';
  els.current.style.transform = `translate3d(0,${direction > 0 ? -distance : distance}px,0)`;
  els.next.style.transform = `translate3d(0,${direction > 0 ? 90 - distance : -90 + distance}px,0)`;
}

function openInstrumentPicker() {
  const picker = document.querySelector<HTMLButtonElement>('.instrument-picker');
  if (picker) {
    picker.click();
    return;
  }
  window.dispatchEvent(new CustomEvent('sire:glass-action', { detail: { action: 'symbol', openSearch: true } }));
}

function begin(x: number, y: number) {
  if (busy) return;
  startX = x;
  startY = y;
  tracking = true;
  longPressTriggered = false;
  const els = getEls();
  if (els) els.button.dataset.swiping = 'true';
  if (longPressTimer !== null) window.clearTimeout(longPressTimer);
  longPressTimer = window.setTimeout(() => {
    if (!tracking || busy) return;
    longPressTriggered = true;
    tracking = false;
    const current = getEls();
    if (current) {
      current.button.dataset.swiping = 'false';
      current.button.dataset.longPressTriggered = 'true';
      reset(current);
    }
    openInstrumentPicker();
  }, 550);
}

function move(x: number, y: number, event?: Event) {
  if (!tracking || busy) return;
  const dx = x - startX;
  const dy = y - startY;
  if (Math.abs(dy) <= Math.abs(dx) || Math.abs(dy) < 5) return;
  if (longPressTimer !== null) {
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  event?.preventDefault();
  event?.stopImmediatePropagation?.();
  updateSwipe(dy);
}

function end(x: number, y: number) {
  if (longPressTimer !== null) {
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (!tracking) return;
  const dy = y - startY;
  const dx = x - startX;
  tracking = false;
  if (Math.abs(dy) >= 20 && Math.abs(dy) > Math.abs(dx)) {
    finish(dy < 0 ? 1 : -1);
  } else {
    const els = getEls();
    if (els) {
      els.button.dataset.swiping = 'false';
      reset(els);
    }
  }
}

function bind() {
  const els = getEls();
  if (!els || els.button.dataset.swipeFixBound === 'true') return;
  els.button.dataset.swipeFixBound = 'true';
  els.button.style.touchAction = 'none';
  els.button.style.userSelect = 'none';
  els.button.style.webkitUserSelect = 'none';
  els.button.style.webkitTouchCallout = 'none';
  els.button.setAttribute('unselectable', 'on');

  els.button.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
  });
  els.button.addEventListener('selectstart', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
  });

  els.button.addEventListener('touchstart', event => {
    const t = event.changedTouches[0];
    if (!t) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    begin(t.clientX, t.clientY);
  }, { passive: false });

  els.button.addEventListener('touchmove', event => {
    const t = event.changedTouches[0];
    if (!t) return;
    move(t.clientX, t.clientY, event);
  }, { passive: false });

  els.button.addEventListener('touchend', event => {
    const t = event.changedTouches[0];
    if (!t) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    end(t.clientX, t.clientY);
  }, { passive: false });

  els.button.addEventListener('touchcancel', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (longPressTimer !== null) window.clearTimeout(longPressTimer);
    longPressTimer = null;
    tracking = false;
    const now = getEls();
    if (now) { now.button.dataset.swiping = 'false'; reset(now); }
  }, { passive: false });

  els.button.addEventListener('pointerdown', event => begin(event.clientX, event.clientY));
  els.button.addEventListener('pointermove', event => move(event.clientX, event.clientY, event));
  els.button.addEventListener('pointerup', event => {
    if (longPressTriggered) {
      event.preventDefault();
      event.stopImmediatePropagation();
      longPressTriggered = false;
      return;
    }
    end(event.clientX, event.clientY);
  });
  els.button.addEventListener('pointercancel', () => {
    if (longPressTimer !== null) window.clearTimeout(longPressTimer);
    longPressTimer = null;
    tracking = false;
  });
}

function install() {
  bind();
  window.setTimeout(bind, 300);
  window.setTimeout(bind, 1000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();

new MutationObserver(() => {
  if (!document.getElementById(BAR_ID)) return;
  bind();
}).observe(document.documentElement, { childList: true, subtree: true });
