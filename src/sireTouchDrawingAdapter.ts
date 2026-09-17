const CHART_SELECTOR = '.sire-chart-canvas';
const ACTIVE_TOOL_SELECTOR = '.sire-drawing-toolbar button.active';

function getChartTarget(target: EventTarget | null): HTMLElement | null {
  const element = target instanceof HTMLElement ? target : null;
  return element?.closest(CHART_SELECTOR) ?? null;
}

function drawingToolIsActive(): boolean {
  return Boolean(document.querySelector(ACTIVE_TOOL_SELECTOR));
}

function pointFromTouch(touch: Touch) {
  return {
    clientX: touch.clientX,
    clientY: touch.clientY,
    screenX: touch.screenX,
    screenY: touch.screenY,
  };
}

function dispatchMouse(type: 'mousedown' | 'mousemove' | 'mouseup', target: HTMLElement, touch: Touch) {
  const point = pointFromTouch(touch);
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    detail: 1,
    screenX: point.screenX,
    screenY: point.screenY,
    clientX: point.clientX,
    clientY: point.clientY,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
  }));
}

function install() {
  let activeTarget: HTMLElement | null = null;

  const onTouchStart = (event: TouchEvent) => {
    if (!drawingToolIsActive() || event.touches.length !== 1) return;
    const target = getChartTarget(event.target);
    if (!target) return;
    activeTarget = target;
    event.preventDefault();
    event.stopPropagation();
    dispatchMouse('mousedown', target, event.touches[0]);
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!activeTarget || event.touches.length !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    dispatchMouse('mousemove', activeTarget, event.touches[0]);
  };

  const finish = (event: TouchEvent) => {
    if (!activeTarget || event.changedTouches.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    dispatchMouse('mouseup', activeTarget, event.changedTouches[0]);
    activeTarget = null;
  };

  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', finish, { capture: true, passive: false });
  document.addEventListener('touchcancel', finish, { capture: true, passive: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
