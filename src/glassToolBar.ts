const STYLE_ID = 'sire-glass-tools-scroll-style';
const BAR_ID = 'sire-glass-tools-bar';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BAR_ID}{
      overflow-x:auto!important;
      overflow-y:hidden!important;
      overscroll-behavior-x:contain!important;
      -webkit-overflow-scrolling:touch!important;
      scrollbar-width:none!important;
      touch-action:pan-x!important;
      justify-content:flex-start!important;
      white-space:nowrap!important;
      cursor:grab!important;
    }
    #${BAR_ID}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
    #${BAR_ID}:active{cursor:grabbing!important}
    #${BAR_ID} > *{flex:0 0 auto!important}
    #${BAR_ID} button{flex:0 0 auto!important;white-space:nowrap!important}
  `;
  document.head.appendChild(style);
}

function enableDragScroll(bar: HTMLElement) {
  if (bar.dataset.dragScrollWired === 'true') return;
  bar.dataset.dragScrollWired = 'true';
  let dragging = false;
  let startX = 0;
  let startScroll = 0;
  bar.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') return;
    dragging = true;
    startX = event.clientX;
    startScroll = bar.scrollLeft;
    bar.setPointerCapture?.(event.pointerId);
  });
  bar.addEventListener('pointermove', event => {
    if (!dragging) return;
    bar.scrollLeft = startScroll - (event.clientX - startX);
  });
  const stop = () => { dragging = false; };
  bar.addEventListener('pointerup', stop);
  bar.addEventListener('pointercancel', stop);
  bar.addEventListener('mouseleave', stop);
}

function apply() {
  injectStyles();
  const bar = document.getElementById(BAR_ID);
  if (bar) enableDragScroll(bar);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
else apply();

new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });
