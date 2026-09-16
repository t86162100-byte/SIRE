import {
  type IChartApi,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';

type DrawingTool = 'trend' | 'horizontal' | 'ray' | 'rectangle';
type Point = { time: Time; price: number };
type Drawing = { id: number; tool: DrawingTool; a: Point; b: Point };
type RendererTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

type DrawingState = {
  drawings: Drawing[];
  preview: { tool: DrawingTool; a: Point; b: Point } | null;
};

class TradingViewDrawingRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly source: TradingViewDrawingPrimitive) {}

  draw(target: RendererTarget) {
    target.useMediaCoordinateSpace(scope => {
      const ctx = scope.context;
      const width = scope.mediaSize.width;
      const height = scope.mediaSize.height;
      ctx.save();
      try {
        const state = this.source.state();
        for (const drawing of state.drawings) {
          this.drawShape(ctx, width, height, drawing.tool, drawing.a, drawing.b, false);
        }
        if (state.preview) {
          this.drawShape(ctx, width, height, state.preview.tool, state.preview.a, state.preview.b, true);
        }
      } finally {
        ctx.restore();
      }
    });
  }

  private drawShape(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tool: DrawingTool,
    a: Point,
    b: Point,
    preview: boolean,
  ) {
    const points = this.source.coordinates(a, b);
    if (!points) return;
    const { x1, y1, x2, y2 } = points;
    ctx.lineWidth = preview ? 1.25 : 1.5;
    ctx.strokeStyle = preview ? 'rgba(255,255,255,.72)' : 'rgba(255,255,255,.94)';
    ctx.setLineDash(preview ? [6, 5] : []);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (tool === 'horizontal') {
      ctx.beginPath();
      ctx.moveTo(0, y1);
      ctx.lineTo(width, y1);
      ctx.stroke();
      this.anchor(ctx, x1, y1, preview);
      return;
    }

    if (tool === 'rectangle') {
      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const rectWidth = Math.abs(x2 - x1);
      const rectHeight = Math.abs(y2 - y1);
      ctx.fillStyle = preview ? 'rgba(255,255,255,.045)' : 'rgba(255,255,255,.06)';
      ctx.fillRect(left, top, rectWidth, rectHeight);
      ctx.strokeRect(left, top, rectWidth, rectHeight);
      this.anchor(ctx, x1, y1, preview);
      this.anchor(ctx, x2, y2, preview);
      return;
    }

    if (tool === 'ray') {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      const dx = x2 - x1;
      const dy = y2 - y1;
      if (Math.abs(dx) < 0.0001) {
        ctx.lineTo(x1, dy >= 0 ? height : 0);
      } else {
        const targetX = dx > 0 ? width : 0;
        const factor = (targetX - x1) / dx;
        ctx.lineTo(targetX, y1 + dy * factor);
      }
      ctx.stroke();
      this.anchor(ctx, x1, y1, preview);
      this.anchor(ctx, x2, y2, preview);
      return;
    }

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    this.anchor(ctx, x1, y1, preview);
    this.anchor(ctx, x2, y2, preview);
  }

  private anchor(ctx: CanvasRenderingContext2D, x: number, y: number, preview: boolean) {
    ctx.setLineDash([]);
    ctx.fillStyle = preview ? 'rgba(255,255,255,.78)' : 'rgba(255,255,255,1)';
    ctx.beginPath();
    ctx.arc(x, y, preview ? 3.25 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

class TradingViewDrawingPaneView implements IPrimitivePaneView {
  constructor(private readonly source: TradingViewDrawingPrimitive) {}

  update() {}

  renderer() {
    return new TradingViewDrawingRenderer(this.source);
  }

  zOrder() {
    return 'top' as const;
  }
}

class TradingViewDrawingPrimitive {
  private requestUpdate: (() => void) | null = null;
  private tool: DrawingTool | null = null;
  private drawings: Drawing[] = [];
  private preview: { tool: DrawingTool; a: Point; b: Point } | null = null;
  private nextId = 1;
  private readonly view = new TradingViewDrawingPaneView(this);

  constructor(private readonly chart: IChartApi, private readonly series: ISeriesApi<'Candlestick'>) {}

  attached(param: { requestUpdate: () => void }) {
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.requestUpdate = null;
  }

  paneViews() {
    return [this.view];
  }

  state(): DrawingState {
    return { drawings: this.drawings, preview: this.preview };
  }

  coordinates(a: Point, b: Point) {
    const x1 = this.chart.timeScale().timeToCoordinate(a.time);
    const x2 = this.chart.timeScale().timeToCoordinate(b.time);
    const y1 = this.series.priceToCoordinate(a.price);
    const y2 = this.series.priceToCoordinate(b.price);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return null;
    return { x1, y1, x2, y2 };
  }

  setTool(tool: DrawingTool | null) {
    this.tool = tool;
    this.preview = null;
    this.invalidate();
  }

  getTool() {
    return this.tool;
  }

  setPreview(a: Point, b = a) {
    if (!this.tool) return;
    this.preview = { tool: this.tool, a, b };
    this.invalidate();
  }

  clearPreview() {
    this.preview = null;
    this.invalidate();
  }

  add(a: Point, b: Point) {
    if (!this.tool) return;
    this.drawings.push({ id: this.nextId++, tool: this.tool, a, b });
    this.preview = null;
    this.invalidate();
  }

  undo() {
    this.drawings.pop();
    this.invalidate();
  }

  clear() {
    this.drawings = [];
    this.preview = null;
    this.invalidate();
  }

  invalidate() {
    this.view.update();
    this.requestUpdate?.();
  }
}

function pointFromEvent(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  event: PointerEvent,
): Point | null {
  const rect = chart.chartElement().getBoundingClientRect();
  const pane = chart.paneSize(0);
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x > pane.width || y > pane.height) return null;
  const time = chart.timeScale().coordinateToTime(x);
  const price = series.coordinateToPrice(y);
  if (time === null || price === null || !Number.isFinite(Number(price))) return null;
  return { time, price: Number(price) };
}

export function attachSireTradingViewDrawingController(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  surface: HTMLElement,
) {
  const primitive = new TradingViewDrawingPrimitive(chart, series);
  const pane = chart.panes()[0];
  pane.attachPrimitive(primitive);

  const toggle = surface.querySelector<HTMLButtonElement>('[data-sire-drawing-toggle]');
  const palette = surface.querySelector<HTMLElement>('[data-sire-drawing-palette]');
  const toolButtons = Array.from(surface.querySelectorAll<HTMLButtonElement>('[data-sire-drawing-tool]'));
  const status = surface.querySelector<HTMLElement>('[data-sire-drawing-status]');
  const undo = surface.querySelector<HTMLButtonElement>('[data-sire-drawing-undo]');
  const clear = surface.querySelector<HTMLButtonElement>('[data-sire-drawing-clear]');

  let armed = false;
  let activationTapComplete = false;
  let firstPoint: Point | null = null;
  let pendingPoint: Point | null = null;
  let pointerActive = false;
  let pointerId = -1;

  const setStatus = (text: string) => {
    if (status) status.textContent = text;
  };

  const syncButtons = () => {
    const active = primitive.getTool();
    toolButtons.forEach(button => button.classList.toggle('active', button.dataset.sireDrawingTool === active));
    toggle.classList.toggle('active', Boolean(active));
    toggle.setAttribute('aria-expanded', active ? 'true' : String(!palette.hidden));
  };

  const resetPlacement = () => {
    armed = false;
    activationTapComplete = false;
    firstPoint = null;
    pendingPoint = null;
    primitive.clearPreview();
  };

  const chooseTool = (tool: DrawingTool) => {
    const active = primitive.getTool() === tool ? null : tool;
    primitive.setTool(active);
    resetPlacement();
    syncButtons();
    if (active) {
      palette.hidden = false;
      setStatus('Tap chart to activate the crosshair.');
    } else {
      chart.clearCrosshairPosition();
      palette.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  };

  const onToggle = () => {
    if (palette.hidden) {
      palette.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      setStatus(primitive.getTool() ? 'Tap chart to activate the crosshair.' : 'Choose a drawing tool.');
    } else if (primitive.getTool()) {
      palette.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    } else {
      palette.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    const tool = primitive.getTool();
    if (!tool) return;
    const point = pointFromEvent(chart, series, event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    pointerActive = true;
    pointerId = event.pointerId;
    try { element.setPointerCapture(event.pointerId); } catch { /* noop */ }
    chart.setCrosshairPosition(point.price, point.time, series);
    pendingPoint = point;
    armed = true;
    primitive.setPreview(firstPoint ?? point, point);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!primitive.getTool() || !armed) return;
    if (event.pointerType !== 'mouse' && !pointerActive) return;
    const point = pointFromEvent(chart, series, event);
    if (!point) return;
    chart.setCrosshairPosition(point.price, point.time, series);
    pendingPoint = point;
    primitive.setPreview(firstPoint ?? point, point);
    if (pointerActive) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!primitive.getTool() || !armed || !pointerActive) return;
    const point = pointFromEvent(chart, series, event) ?? pendingPoint;
    pointerActive = false;
    if (pointerId >= 0) {
      try { element.releasePointerCapture(pointerId); } catch { /* noop */ }
    }
    pointerId = -1;
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    chart.setCrosshairPosition(point.price, point.time, series);
    pendingPoint = point;

    if (!activationTapComplete) {
      activationTapComplete = true;
      primitive.setPreview(point, point);
      setStatus('Crosshair active. Move it, then tap to set the first anchor.');
      return;
    }

    if (!firstPoint) {
      firstPoint = point;
      if (primitive.getTool() === 'horizontal') {
        primitive.add(point, point);
        resetPlacement();
        setStatus('Horizontal line placed. Tap chart to start another.');
      } else {
        primitive.setPreview(point, point);
        setStatus('First anchor set. Move the crosshair, then tap to set the second anchor.');
      }
      return;
    }

    primitive.add(firstPoint, point);
    resetPlacement();
    setStatus('Drawing placed. Tap chart to start another.');
  };

  const onPointerCancel = () => {
    pointerActive = false;
    pointerId = -1;
    pendingPoint = null;
    primitive.clearPreview();
  };

  const onUndo = () => {
    primitive.undo();
    resetPlacement();
    setStatus('Last drawing removed.');
  };

  const onClear = () => {
    primitive.clear();
    resetPlacement();
    setStatus('Drawings cleared.');
  };

  const toolHandlers = new Map<HTMLButtonElement, EventListener>();
  toggle.addEventListener('click', onToggle);
  toolButtons.forEach(button => {
    const handler: EventListener = () => {
      const tool = button.dataset.sireDrawingTool as DrawingTool | undefined;
      if (tool) chooseTool(tool);
    };
    toolHandlers.set(button, handler);
    button.addEventListener('click', handler);
  });
  undo?.addEventListener('click', onUndo);
  clear?.addEventListener('click', onClear);

  const element = chart.chartElement();
  element.addEventListener('pointerdown', onPointerDown, { passive: false });
  element.addEventListener('pointermove', onPointerMove, { passive: false });
  element.addEventListener('pointerup', onPointerUp, { passive: false });
  element.addEventListener('pointercancel', onPointerCancel, { passive: false });

  const redraw = () => primitive.invalidate();
  chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
  chart.timeScale().subscribeSizeChange(redraw);
  syncButtons();

  return {
    destroy() {
      toggle.removeEventListener('click', onToggle);
      toolHandlers.forEach((handler, button) => button.removeEventListener('click', handler));
      undo?.removeEventListener('click', onUndo);
      clear?.removeEventListener('click', onClear);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
      chart.timeScale().unsubscribeSizeChange(redraw);
      pane.detachPrimitive(primitive);
    },
  };
}
