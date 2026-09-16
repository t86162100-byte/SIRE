const NAV_ID = 'sire-bottom-tabs';
const STYLE_ID = 'sire-navigation-auto-hide-style';
const HIDE_AFTER = 2600;

let hideTimer: number | undefined;
let startX: number | null = null;
let startY: number | null = null;

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
  nav.classList.remove('nav-auto-hidden');
  if (hideTimer !== undefined) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    const current = document.getElementById(NAV_ID);
    if (current) current.classList.add('nav-auto-hidden');
  }, ms);
}

function bind() {
  style();
  const nav = document.getElementById(NAV_ID);
  if (!nav || nav.dataset.autoHideBound === 'true') return;
  nav.dataset.autoHideBound = 'true';
  nav.addEventListener('pointerdown', () => reveal(), { passive: true });
  nav.addEventListener('click', () => reveal(), { passive: true });
  reveal();
}

function wireSwipe() {
  document.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(`#${NAV_ID},#sire-glass-action-bar,input,textarea,select,button`)) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', event => {
    if (startX === null || startY === null) return;
    const dx = event.changedTouches[0].clientX - startX;
    const dy = event.changedTouches[0].clientY - startY;
    startX = null;
    startY = null;

    // Horizontal swipes only reveal the navigation. They NEVER change tabs.
    if (Math.abs(dx) < 55 || Math.abs(dx) <= Math.abs(dy) * 1.25) return;
    reveal(3200);
  }, { passive: true });
}

function install() {
  bind();
  wireSwipe();
  const observer = new MutationObserver(() => bind());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
