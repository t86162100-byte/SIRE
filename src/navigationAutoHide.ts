const NAV_ID = 'sire-bottom-tabs';
const STYLE_ID = 'sire-navigation-auto-hide-style';
const HIDE_AFTER = 2600;

let hideTimer: number | undefined;
let lastRevealAt = 0;
let navInitialized = false;
let touchStartX: number | null = null;
let touchStartY: number | null = null;
let touchRevealed = false;
let pointerStartX: number | null = null;
let pointerStartY: number | null = null;
let pointerRevealed = false;

function style() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
    #${NAV_ID}.nav-auto-hidden{opacity:0!important;transform:translate(-50%,14px)!important;pointer-events:none!important}
    #${NAV_ID}{transition:opacity .28s ease,transform .28s ease!important}
  `;
  document.head.appendChild(el);
}

function reveal(ms = HIDE_AFTER) {
  const nav = document.getElementById(NAV_ID);
  if (!nav) return;
  lastRevealAt = Date.now();
  nav.classList.remove('nav-auto-hidden');
  if (hideTimer !== undefined) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    const current = document.getElementById(NAV_ID);
    if (current) current.classList.add('nav-auto-hidden');
  }, ms);
}

function enforceAutoHide() {
  const nav = document.getElementById(NAV_ID);
  if (!nav) return;
  if (lastRevealAt > 0 && Date.now() - lastRevealAt >= HIDE_AFTER) {
    nav.classList.add('nav-auto-hidden');
  }
}

function isSwipeSurface(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const quoteCard = el.closest('.sire-tab-quote .symbol-list .symbol-row');
  if (el.closest(`#${NAV_ID},#sire-glass-action-bar,input,textarea,select`)) return false;
  if (el.closest('button') && !quoteCard) return false;
  return true;
}

function horizontalEnough(dx: number, dy: number) {
  return Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.12;
}

function wireTouchSwipe() {
  document.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || !isSwipeSurface(event.target)) return;
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
    touchRevealed = false;
  }, { passive: true });

  document.addEventListener('touchmove', event => {
    if (touchStartX === null || touchStartY === null || touchRevealed || event.touches.length !== 1) return;
    const dx = event.touches[0].clientX - touchStartX;
    const dy = event.touches[0].clientY - touchStartY;
    if (!horizontalEnough(dx, dy)) return;
    touchRevealed = true;
    reveal(3200);
  }, { passive: true });

  const reset = () => {
    touchStartX = null;
    touchStartY = null;
    touchRevealed = false;
  };
  document.addEventListener('touchend', reset, { passive: true });
  document.addEventListener('touchcancel', reset, { passive: true });
}

function wirePointerSwipe() {
  document.addEventListener('pointerdown', event => {
    if (!isSwipeSurface(event.target)) return;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    pointerRevealed = false;
  }, { passive: true });

  document.addEventListener('pointermove', event => {
    if (pointerStartX === null || pointerStartY === null || pointerRevealed) return;
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    const dx = event.clientX - pointerStartX;
    const dy = event.clientY - pointerStartY;
    if (!horizontalEnough(dx, dy)) return;
    pointerRevealed = true;
    reveal(3200);
  }, { passive: true });

  const reset = () => {
    pointerStartX = null;
    pointerStartY = null;
    pointerRevealed = false;
  };
  document.addEventListener('pointerup', reset, { passive: true });
  document.addEventListener('pointercancel', reset, { passive: true });
}

function bind() {
  style();
  const nav = document.getElementById(NAV_ID);
  if (!nav || nav.dataset.autoHideBound === 'true') return;
  nav.dataset.autoHideBound = 'true';
  nav.addEventListener('pointerdown', () => reveal(), { passive: true });
  nav.addEventListener('click', () => reveal(), { passive: true });

  if (!navInitialized) {
    navInitialized = true;
    reveal();
  } else {
    // If React recreates the navigation while Quote is rendering, preserve
    // the auto-hidden state instead of making the new copy stay visible.
    nav.classList.add('nav-auto-hidden');
  }
}

function install() {
  style();
  bind();
  wireTouchSwipe();
  wirePointerSwipe();
  const observer = new MutationObserver(() => bind());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(enforceAutoHide, 300);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();