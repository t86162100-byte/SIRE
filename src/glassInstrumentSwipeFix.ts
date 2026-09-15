const BAR_ID = 'sire-glass-action-bar';

type Instrument = { name: string; symbol: string };

// Fallback basket order keeps the gesture usable even if the public catalogue is slow/unavailable.
const fallbackInstruments: Instrument[] = [
  { name: 'AUD Basket', symbol: 'AUD Basket' },
  { name: 'EUR Basket', symbol: 'EUR Basket' },
  { name: 'GBP Basket', symbol: 'GBP Basket' },
  { name: 'USD Basket', symbol: 'USD Basket' },
];

let startY = 0;
let startX = 0;
let tracking = false;
let busy = false;

function getEls() {
  const bar = document.getElementById(BAR_ID);
  if (!bar) return null;
  const button = bar.querySelector<HTMLElement>('[data-action="symbol"]');
  const viewport = bar.querySelector<HTMLElement>('.symbol-viewport');
  const current = bar.querySelector<HTMLElement>('.symbol-current');
  const next = bar.querySelector<HTMLElement>('.symbol-next');
  if (!button || !viewport || !current || !next) return null;
  return { bar, button, viewport, current, next };
}

function instruments(): Instrument[] {
  return fallbackInstruments;
}

function currentIndex(list: Instrument[]) {
  const els = getEls();
  const name = els?.current.textContent?.trim() || '';
  const index = list.findIndex(item => item.name === name);
  return index >= 0 ? index : 0;
}

function prepare(els: NonNullable<ReturnType<typeof getEls>>, direction: number, index: number) {
  const list = instruments();
  const nextIndex = (index + direction + list.length) % list.length;
  els.current.textContent = list[index].name;
  els.next.textContent = list[nextIndex].name;
  els.current.style.transition = 'none';
  els.next.style.transition = 'none';
  els.current.style.transform = 'translate3d(0,0,0)';
  els.next.style.transform = direction > 0 ? 'translate3d(0,100%,0)' : 'translate3d(0,-100%,0)';
  els.button.dataset.swiping = 'true';
}

function finish(direction: number) {
  const els = getEls();
  const list = instruments();
  if (!els || !list.length || busy) return;
  busy = true;
  const index = currentIndex(list);
  const nextIndex = (index + direction + list.length) % list.length;
  prepare(els, direction, index);
  requestAnimationFrame(() => {
    els.current.style.transition = 'transform 180ms cubic-bezier(.22,.75,.2,1)';
    els.next.style.transition = 'transform 180ms cubic-bezier(.22,.75,.2,1)';
    els.current.style.transform = direction > 0 ? 'translate3d(0,-100%,0)' : 'translate3d(0,100%,0)';
    els.next.style.transform = 'translate3d(0,0,0)';
  });
  window.setTimeout(() => {
    const current = list[nextIndex];
    els.current.textContent = current.name;
    els.next.textContent = list[(nextIndex + direction + list.length) % list.length].name;
    els.current.style.transition = 'none';
    els.next.style.transition = 'none';
    els.current.style.transform = 'translate3d(0,0,0)';
    els.next.style.transform = direction > 0 ? 'translate3d(0,100%,0)' : 'translate3d(0,-100%,0)';
    els.button.dataset.swiping = 'false';
    busy = false;
    window.dispatchEvent(new CustomEvent('sire:instrument-change', { detail: { symbol: current.symbol, name: current.name } }));
  }, 195);
}

function bind() {
  const els = getEls();
  if (!els || els.button.dataset.swipeFixBound === 'true') return;
  els.button.dataset.swipeFixBound = 'true';
  els.button.style.touchAction = 'none';

  const begin = (x: number, y: number) => {
    if (busy) return;
    startX = x;
    startY = y;
    tracking = true;
    els.button.dataset.swiping = 'true';
  };

  const move = (x: number, y: number, event?: Event) => {
    if (!tracking || busy) return;
    const dx = x - startX;
    const dy = y - startY;
    if (Math.abs(dy) < Math.abs(dx) || Math.abs(dy) < 6) return;
    event?.preventDefault();
    const list = instruments();
    const index = currentIndex(list);
    const direction = dy < 0 ? 1 : -1;
    prepare(els, direction, index);
    const distance = Math.min(Math.abs(dy), 80);
    els.current.style.transform = `translate3d(0,${direction > 0 ? -distance : distance}px,0)`;
    els.next.style.transform = `translate3d(0,${direction > 0 ? 80 - distance : -80 + distance}px,0)`;
  };

  const end = (x: number, y: number) => {
    if (!tracking) return;
    const dy = y - startY;
    tracking = false;
    if (Math.abs(dy) >= 20 && Math.abs(dy) > Math.abs(x - startX)) {
      finish(dy < 0 ? 1 : -1);
    } else {
      const elsNow = getEls();
      if (elsNow) {
        elsNow.button.dataset.swiping = 'false';
        elsNow.current.style.transition = 'transform 120ms ease';
        elsNow.next.style.transition = 'transform 120ms ease';
        elsNow.current.style.transform = 'translate3d(0,0,0)';
        elsNow.next.style.transform = 'translate3d(0,100%,0)';
      }
    }
  };

  els.button.addEventListener('touchstart', event => {
    const t = event.changedTouches[0];
    if (t) begin(t.clientX, t.clientY);
  }, { passive: true });
  els.button.addEventListener('touchmove', event => {
    const t = event.changedTouches[0];
    if (t) move(t.clientX, t.clientY, event);
  }, { passive: false });
  els.button.addEventListener('touchend', event => {
    const t = event.changedTouches[0];
    if (t) end(t.clientX, t.clientY);
  }, { passive: true });
  els.button.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });

  els.button.addEventListener('pointerdown', event => begin(event.clientX, event.clientY));
  els.button.addEventListener('pointermove', event => move(event.clientX, event.clientY, event));
  els.button.addEventListener('pointerup', event => end(event.clientX, event.clientY));
  els.button.addEventListener('pointercancel', () => { tracking = false; });
}

function install() {
  bind();
  window.setTimeout(bind, 300);
  window.setTimeout(bind, 1000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();

new MutationObserver(bind).observe(document.documentElement, { childList: true, subtree: true });
