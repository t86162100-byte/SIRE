const MIN_SCALE = 0.35;
const MAX_SCALE = 3.6;
const UP_DISTANCE_FOR_MAX = 280;
const DOWN_DISTANCE_FOR_MIN = 180;
const STYLE_ID = 'sire-price-pane-vertical-zoom-style';

let installed = false;
let startY = 0;
let startX = 0;
let active = false;
let baseScale = 1;
let pane: HTMLElement | null = null;
let svg: SVGElement | null = null;

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .chart-stage .market-svg.sire-price-zooming {
      transform-origin: 50% 50%;
      will-change: transform;
    }
  `;
  document.head.appendChild(style);
}

function findPane(target: EventTarget | null): HTMLElement | null {
  const el = target instanceof Element ? target : null;
  if (!el) return null;
  const stage = el.closest('.chart-stage');
  if (!(stage instanceof HTMLElement)) return null;
  const candidate = el.closest('.market-svg');
  if (candidate instanceof SVGElement) return stage;
  if (el === stage || stage.contains(el)) return stage;
  return null;
}

function findSvg(root: HTMLElement): SVGElement | null {
  const current = root.querySelector('.market-svg');
  return current instanceof SVGElement ? current : null;
}

function applyScale(next: number) {
  if (!svg) return;
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
  svg.style.transform = `scaleY(${scale})`;
  svg.classList.add('sire-price-zooming');
  svg.dataset.priceZoomScale = String(scale);
}

function getScale() {
  const value = Number(svg?.dataset.priceZoomScale || '1');
  return Number.isFinite(value) ? value : 1;
}

function onPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const nextPane = findPane(event.target);
  if (!nextPane) return;
  const nextSvg = findSvg(nextPane);
  if (!nextSvg) return;
  pane = nextPane;
  svg = nextSvg;
  startY = event.clientY;
  startX = event.clientX;
  baseScale = getScale();
  active = false;
  try { pane.setPointerCapture(event.pointerId); } catch {}
}

function onPointerMove(event: PointerEvent) {
  if (!pane || !svg || startY === 0) return;
  const dy = event.clientY - startY;
  const dx = event.clientX - startX;
  if (!active) {
    if (Math.abs(dy) < 12 || Math.abs(dy) < Math.abs(dx) * 1.15) return;
    active = true;
  }
  if (!active) return;
  event.preventDefault();
  const next = dy < 0
    ? baseScale + Math.abs(dy) / UP_DISTANCE_FOR_MAX * (MAX_SCALE - baseScale)
    : baseScale - Math.abs(dy) / DOWN_DISTANCE_FOR_MIN * (baseScale - MIN_SCALE);
  applyScale(next);
}

function endPointer(event: PointerEvent) {
  if (!pane) return;
  try { pane.releasePointerCapture(event.pointerId); } catch {}
  pane = null;
  svg = null;
  active = false;
  startY = 0;
  startX = 0;
}

function install() {
  if (installed) return;
  installed = true;
  installStyle();
  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', endPointer, { passive: true });
  document.addEventListener('pointercancel', endPointer, { passive: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
