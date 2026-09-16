import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  MouseEventParams,
  Time,
} from 'lightweight-charts';

type DrawingTool = 'trend' | 'horizontal' | 'ray' | 'rectangle';
type Point = { time: Time; price: number };
type Drawing = { id: number; tool: DrawingTool; a: Point; b?: Point };
type Controller = { destroy: () => void };

const TOOL_LABELS: Record<DrawingTool, string> = {
  trend: 'Trend line',
  horizontal: 'Horizontal line',
  ray: 'Ray',
  rectangle: 'Rectangle',
};

class DrawingPrimitive implements ISeriesPrimitive<unknown> {
  private drawings: Drawing[] = [];
  private requestUpdate: (() => void) | null = null;
  private nextId = 1;
  private view: IPrimitivePaneView;

  constructor(
    private readonly chart: IChartApi,
    private readonly series: ISeriesApi<'Candlestick'>,
  ) {
    const owner = this;
    this.view = {
      zOrder: 'top',
      renderer: {
        draw(target) {
          target.useMediaCoordinateSpace(scope => {
            const ctx = scope.context;
            const width = scope.mediaSize.width;
            const height = scope.mediaSize.height;
            ctx.save();
            try {
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = 'rgba(93, 178, 255, 0.96)';
              ctx.fillStyle = 'rgba(48, 126, 196, 0.10)';
              ctx.setLineDash([]);

              for (const drawing of owner.drawings) {
                const ax = owner.x(drawing.a.time);
                const ay = owner.y(drawing.a.price);
                if (ax == null || ay == null || !Number.isFinite(ax) || !Number.isFinite(ay)) continue;

                if (drawing.tool === 'horizontal') {
                  ctx.beginPath();
                  ctx.moveTo(0, ay);
                  ctx.lineTo(width, ay);
                  ctx.stroke();
                  continue;
                }

                const b = drawing.b;
                if (!b) continue;
                const bx = owner.x(b.time);
                const by = owner.y(b.price);
                if (bx == null || by == null || !Number.isFinite(bx) || !Number.isFinite(by)) continue;

                if (drawing.tool === 'rectangle') {
                  const left = Math.min(ax, bx);
                  const top = Math.min(ay, by);
                  const rectWidth = Math.abs(bx - ax);
                  const rectHeight = Math.abs(by - ay);
                  ctx.fillRect(left, top, rectWidth, rectHeight);
                  ctx.strokeRect(left, top, rectWidth, rectHeight);
                  continue;
                }

                if (drawing.tool === 'ray') {
                  const dx = bx - ax;
                  const dy = by - ay;
                  if (Math.abs(dx) < 0.001) {
                    ctx.beginPath();
                    ctx.moveTo(ax, 0);
                    ctx.lineTo(ax, height);
                    ctx.stroke();
                  } else {
                    const endX = dx >= 0 ? width : 0;
                    const endY = ay + (endX - ax) * (dy / dx);
                    ctx.beginPath();
                    ctx.moveTo(ax, ay);
                    ctx.lineTo(endX, endY);
                    ctx.stroke();
                  }
                  continue;
                }

                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.stroke();
              }
            } finally {
              ctx.restore();
            }
          });
        },
      } satisfies IPrimitivePaneRenderer,
    };
  }

  attached({ requestUpdate }: { requestUpdate: () => void }) {
    this.requestUpdate = requestUpdate;
  }

  detached() {
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  updateAllViews() {}

  add(tool: DrawingTool, a: Point, b?: Point) {
    this.drawings.push({ id: this.nextId++, tool, a, b });
    this.requestUpdate?.();
  }

  removeLast() {
    if (!this.drawings.length) return;
    this.drawings.pop();
    this.requestUpdate?.();
  }

  clear() {
    if (!this.drawings.length) return;
    this.drawings = [];
    this.requestUpdate?.();
  }

  x(time: Time) {
    return this.chart.timeScale().timeToCoordinate(time);
  }

  y(price: number) {
    return this.series.priceToCoordinate(price);
  }
}

function pointFromEvent(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  param: MouseEventParams,
): Point | null {
  if (!param.point) return null;
  const time = chart.timeScale().coordinateToTime(param.point.x);
  const price = series.coordinateToPrice(param.point.y);
  if (time == null || price == null || !Number.isFinite(param.point.x) || !Number.isFinite(param.point.y)) return null;
  return { time, price };
}

export function attachSireNativeDrawingController(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  root: HTMLElement,
): Controller {
  const primitive = new DrawingPrimitive(chart, series);
  series.attachPrimitive(primitive);

  const button = root.querySelector<HTMLButtonElement>('[data-sire-drawing-toggle]');
  const palette = root.querySelector<HTMLElement>('[data-sire-drawing-palette]');
  const status = root.querySelector<HTMLElement>('[data-sire-drawing-status]');
  const undo = root.querySelector<HTMLButtonElement>('[data-sire-drawing-undo]');
  const clear = root.querySelector<HTMLButtonElement>('[data-sire-drawing-clear]');
  const toolButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-sire-drawing-tool]'));

  if (!button || !palette || !status || !undo || !clear) {
    series.detachPrimitive(primitive);
    return { destroy: () => undefined };
  }

  let activeTool: DrawingTool | null = null;
  let firstPoint: Point | null = null;
  let destroyed = false;

  const setPalette = (open: boolean) => {
    palette.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };

  const setStatus = (text: string) => {
    status.textContent = text;
  };

  const setTool = (tool: DrawingTool | null) => {
    activeTool = tool;
    firstPoint = null;
    toolButtons.forEach(item => item.classList.toggle('active', item.dataset.sireDrawingTool === tool));
    if (!tool) {
      setStatus('');
      button.classList.remove('active');
      return;
    }
    button.classList.add('active');
    setStatus(`${TOOL_LABELS[tool]}: tap ${tool === 'horizontal' ? 'the chart' : 'the first point'}`);
  };

  const onToggle = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const opening = palette.hidden;
    setPalette(opening);
    if (opening) {
      if (!activeTool) setStatus('Choose a drawing tool');
    } else {
      // Closing the palette also exits drawing mode. This prevents a hidden
      // palette from leaving the chart armed for accidental taps.
      setTool(null);
    }
  };

  const onTool = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const tool = (event.currentTarget as HTMLElement).dataset.sireDrawingTool as DrawingTool | undefined;
    if (!tool) return;
    setTool(tool);
    setPalette(true);
  };

  const onChartClick = (param: MouseEventParams) => {
    if (destroyed || !activeTool) return;
    const point = pointFromEvent(chart, series, param);
    if (!point) return;

    if (activeTool === 'horizontal') {
      primitive.add(activeTool, point);
      setStatus('Horizontal line placed');
      return;
    }

    if (!firstPoint) {
      firstPoint = point;
      setStatus(`${TOOL_LABELS[activeTool]}: tap the second point`);
      return;
    }

    primitive.add(activeTool, firstPoint, point);
    firstPoint = null;
    setStatus(`${TOOL_LABELS[activeTool]} placed — tap again to draw another`);
  };

  const onUndo = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    firstPoint = null;
    primitive.removeLast();
    setStatus(activeTool ? `${TOOL_LABELS[activeTool]}: ready` : '');
  };

  const onClear = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    firstPoint = null;
    primitive.clear();
    setStatus(activeTool ? `${TOOL_LABELS[activeTool]}: ready` : '');
  };

  button.addEventListener('click', onToggle);
  toolButtons.forEach(item => item.addEventListener('click', onTool));
  undo.addEventListener('click', onUndo);
  clear.addEventListener('click', onClear);
  chart.subscribeClick(onChartClick);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      chart.unsubscribeClick(onChartClick);
      button.removeEventListener('click', onToggle);
      toolButtons.forEach(item => item.removeEventListener('click', onTool));
      undo.removeEventListener('click', onUndo);
      clear.removeEventListener('click', onClear);
      series.detachPrimitive(primitive);
      setTool(null);
      setPalette(false);
    },
  };
}
