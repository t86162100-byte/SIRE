const MIN_Y_SCALE = 0.35;
const MAX_Y_SCALE = 3.6;
const MIN_X_SCALE = 0.65;
const MAX_X_SCALE = 2.8;
const STYLE_ID = 'sire-price-pane-gesture-style';
const Y_THRESHOLD = 14;
const PINCH_THRESHOLD = 8;

let installed = false;
let activePane: HTMLElement | null = null;
let activeSvg: SVGElement | null = null;
let gesture: 'vertical' | 'pinch' | null = null;
let startX = 0;
let startY = 0;
let baseY = 1;
let baseX = 1;
let pinchStartDistance = 0;
let pinchBaseX = 1;

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .chart-stage .market-svg.sire-price-pane-gesture {
      transform-origin: 50% 50%;
      will-change: transform;
    }
    .chart-stage .market-svg .candle-body {
      shape-rendering: crispEdges;
      vector-effect: non-scaling-stroke;
      paint-order: stroke fill;
    }
    .chart-stage .market-svg .candle-wick,
    .chart-stage .market-svg .candle-open,
    .chart-stage .market-svg .candle-close {
      shape-rendering: crispEdges;
      vector-effect: non-scaling-stroke;
    }
  `;
  document.head.appendChild(style);
}

function findSvg(target: EventTarget | null): SVGElement | null {
  const el = target instanceof Element ? target : null;
  if (!el) return null;
  const svg = el.closest('.chart-stage .market-svg');
  return svg instanceof SVGElement ? svg : null;
}

function findPane(svg: SVGElement): HTMLElement | null {
  const stage = svg.closest('.chart-stage');
  return stage instanceof HTMLElement ? stage : null;
}

function isPriceAxisTouch(touch: Touch, stage: HTMLElement) {
  const rect = stage.getBoundingClientRect();
  const axisWidth = Math.max(55, Math.min(72, rect.width * 0.18));
  const axisLeft = rect.right - axisWidth;
  const axisTop = rect.top + 12;
  const axisBottom = rect.bottom - 26;
  return touch.clientX >= axisLeft && touch.clientX <= rect.right && touch.clientY >= axisTop && touch.clientY <= axisBottom;
}

function distance(a: Touch, b: Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function getScale(svg: SVGElement, axis: 'x' | 'y') {
  const key = axis === 'x' ? 'priceZoomX' : 'priceZoomY';
  const value = Number(svg.dataset[key] || '1');
  return Number.isFinite(value) ? value : 1;
}

function applyTransform() {
  if (!activeSvg) return;
  const x = Math.max(MIN_X_SCALE, Math.min(MAX_X_SCALE, baseX));
  const y = Math.max(MIN_Y_SCALE, Math.min(MAX_Y_SCALE, baseY));
  activeSvg.style.transform = `scale(${x}, ${y})`;
  activeSvg.classList.add('sire-price-pane-gesture');
  activeSvg.dataset.priceZoomX = String(x);
  activeSvg.dataset.priceZoomY = String(y);
}

function clearGesture() {
  activePane = null;
  activeSvg = null;
  gesture = null;
  startX = 0;
  startY = 0;
  pinchStartDistance = 0;
}

function onTouchStart(event: TouchEvent) {
  const svg = findSvg(event.target);
  if (!svg) return;
  const pane = findPane(svg);
  if (!pane) return;

  if (event.touches.length >= 2) {
    activePane = pane;
    activeSvg = svg;
    gesture = 'pinch';
    pinchStartDistance = distance(event.touches[0], event.touches[1]);
    pinchBaseX = getScale(svg, 'x');
    baseX = pinchBaseX;
    baseY = getScale(svg, 'y');
    event.preventDefault();
    return;
  }

  if (event.touches.length !== 1) return;
  const touch = event.touches[0];
  if (!isPriceAxisTouch(touch, pane)) return;

  activePane = pane;
  activeSvg = svg;
  gesture = null;
  startX = touch.clientX;
  startY = touch.clientY;
  baseY = getScale(svg, 'y');
  baseX = getScale(svg, 'x');
}

function onTouchMove(event: TouchEvent) {
  if (!activePane || !activeSvg) return;

  if (event.touches.length >= 2) {
    if (gesture !== 'pinch') {
      gesture = 'pinch';
      pinchStartDistance = distance(event.touches[0], event.touches[1]);
      pinchBaseX = getScale(activeSvg, 'x');
      baseX = pinchBaseX;
    }
    const currentDistance = distance(event.touches[0], event.touches[1]);
    if (pinchStartDistance < 1) return;
    const ratio = currentDistance / pinchStartDistance;
    if (Math.abs(ratio - 1) < PINCH_THRESHOLD / Math.max(pinchStartDistance, 1)) return;
    baseX = pinchBaseX * ratio;
    baseY = getScale(activeSvg, 'y');
    event.preventDefault();
    applyTransform();
    return;
  }

  if (event.touches.length !== 1 || gesture === 'pinch') return;

  const touch = event.touches[0];
  const dx = touch.clientX - startX;
  const dy = touch.clientY - startY;
  if (!gesture) {
    if (Math.abs(dy) < Y_THRESHOLD) return;
    if (Math.abs(dy) <= Math.abs(dx) * 1.18) return;
    gesture = 'vertical';
  }
  if (gesture !== 'vertical') return;

  event.preventDefault();
  const nextY = dy < 0
    ? baseY + Math.abs(dy) / 240 * (MAX_Y_SCALE - baseY)
    : baseY - Math.abs(dy) / 150 * (baseY - MIN_Y_SCALE);
  baseY = nextY;
  applyTransform();
}

function onTouchEnd(event: TouchEvent) {
  if (!activeSvg) return;
  if (event.touches.length === 0) {
    clearGesture();
    return;
  }
  if (gesture === 'pinch' && event.touches.length === 1) {
    clearGesture();
  }
}

function install() {
  if (installed) return;
  installed = true;
  installStyle();
  document.addEventListener('touchstart', onTouchStart, { passive: false });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('touchcancel', onTouchEnd, { passive: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
