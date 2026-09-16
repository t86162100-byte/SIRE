import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';

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

export function attachSireNativeDrawingController(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  root: HTMLElement,
): Controller {
  const button = root.querySelector<HTMLButtonElement>('[data-sire-drawing-toggle]');
  const palette = root.querySelector<HTMLElement>('[data-sire-drawing-palette]');
  const status = root.querySelector<HTMLElement>('[data-sire-drawing-status]');
  const undo = root.querySelector<HTMLButtonElement>('[data-sire-drawing-undo]');
  const clear = root.querySelector<HTMLButtonElement>('[data-sire-drawing-clear]');
  const toolButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-sire-drawing-tool]'));

  if (!button || !palette || !status || !undo || !clear) return { destroy: () => undefined };

  const chartElement = chart.chartElement();
  chartElement.style.position = chartElement.style.position || 'relative';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute', left: '0', top: '0', width: '0', height: '0',
    pointerEvents: 'none', zIndex: '5',
  });
  chartElement.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let activeTool: DrawingTool | null = null;
  let firstPoint: Point | null = null;
  let previewPoint: Point | null = null;
  let pointerActive = false;
  let completing = false;
  let destroyed = false;
  let nextId = 1;
  let drawings: Drawing[] = [];
  let raf = 0;

  const paneSize = () => chart.paneSize(0);

  const resizeCanvas = () => {
    if (!ctx || destroyed) return;
    const size = paneSize();
    const width = Math.max(0, size.width);
    const height = Math.max(0, size.height);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    draw();
  };

  const toCoordinates = (point: Point) => {
    const x = chart.timeScale().timeToCoordinate(point.time);
    const y = series.priceToCoordinate(point.price);
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  };

  const drawSegment = (a: { x: number; y: number }, b: { x: number; y: number }, ray: boolean) => {
    if (!ctx) return;
    const size = paneSize();
    let endX = b.x;
    let endY = b.y;
    if (ray) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.abs(dx) < 0.001) {
        endX = a.x;
        endY = b.y >= a.y ? size.height : 0;
      } else {
        endX = dx >= 0 ? size.width : 0;
        endY = a.y + (endX - a.x) * (dy / dx);
      }
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  };

  const draw = () => {
    if (!ctx || destroyed) return;
    const size = paneSize();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(0, size.width);
    const height = Math.max(0, size.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(93, 178, 255, 0.96)';
    ctx.fillStyle = 'rgba(48, 126, 196, 0.10)';
    ctx.setLineDash([]);

    const renderDrawing = (drawing: Drawing) => {
      const a = toCoordinates(drawing.a);
      if (!a) return;
      if (drawing.tool === 'horizontal') {
        ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(width, a.y); ctx.stroke();
        return;
      }
      if (!drawing.b) return;
      const b = toCoordinates(drawing.b);
      if (!b) return;
      if (drawing.tool === 'rectangle') {
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      } else {
        drawSegment(a, b, drawing.tool === 'ray');
      }
    };

    drawings.forEach(renderDrawing);
    if (activeTool && firstPoint && previewPoint) {
      const a = toCoordinates(firstPoint);
      const b = toCoordinates(previewPoint);
      if (a && b) {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(150, 205, 255, 0.85)';
        if (activeTool === 'horizontal') {
          ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(width, a.y); ctx.stroke();
        } else if (activeTool === 'rectangle') {
          ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        } else {
          drawSegment(a, b, activeTool === 'ray');
        }
        ctx.restore();
      }
    }
    ctx.restore();
  };

  const scheduleDraw = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(() => { raf = 0; draw(); });
  };

  const setPalette = (open: boolean) => {
    palette.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };

  const setStatus = (text: string) => { status.textContent = text; };

  const setTool = (tool: DrawingTool | null) => {
    activeTool = tool;
    firstPoint = null;
    previewPoint = null;
    completing = false;
    if (!tool) {
      chart.clearCrosshairPosition();
      button.classList.remove('active');
      toolButtons.forEach(item => item.classList.remove('active'));
      setStatus('');
    } else {
      button.classList.add('active');
      toolButtons.forEach(item => item.classList.toggle('active', item.dataset.sireDrawingTool === tool));
      setStatus(`${TOOL_LABELS[tool]}: tap the chart`);
    }
    scheduleDraw();
  };

  const pointFromXY = (x: number, y: number): Point | null => {
    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time == null || price == null || !Number.isFinite(price)) return null;
    return { time, price };
  };

  const updateCrosshair = (point: Point) => {
    chart.setCrosshairPosition(point.price, point.time, series);
    previewPoint = point;
    scheduleDraw();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (destroyed || !activeTool || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const rect = chartElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const size = paneSize();
    if (x < 0 || y < 0 || x > size.width || y > size.height) return;
    const point = pointFromXY(x, y);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    pointerActive = true;
    chartElement.setPointerCapture?.(event.pointerId);
    updateCrosshair(point);

    if (activeTool === 'horizontal') {
      drawings.push({ id: nextId++, tool: activeTool, a: point });
      firstPoint = null;
      completing = false;
      setStatus('Horizontal line placed');
      scheduleDraw();
      return;
    }

    if (firstPoint) {
      completing = true;
    } else {
      completing = false;
      firstPoint = point;
      setStatus(`${TOOL_LABELS[activeTool]}: tap the second point`);
      scheduleDraw();
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (destroyed || !activeTool || (!pointerActive && event.pointerType !== 'mouse')) return;
    const rect = chartElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const size = paneSize();
    if (x < 0 || y < 0 || x > size.width || y > size.height) return;
    const point = pointFromXY(x, y);
    if (point) updateCrosshair(point);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!pointerActive || !activeTool) return;
    pointerActive = false;
    if (!completing || !firstPoint) return;
    const rect = chartElement.getBoundingClientRect();
    const point = pointFromXY(event.clientX - rect.left, event.clientY - rect.top);
    if (!point) return;
    drawings.push({ id: nextId++, tool: activeTool, a: firstPoint, b: point });
    firstPoint = null;
    previewPoint = point;
    completing = false;
    setStatus(`${TOOL_LABELS[activeTool]} placed — tap again to draw another`);
    scheduleDraw();
  };

  const onToggle = (event: Event) => {
    event.preventDefault(); event.stopPropagation();
    const opening = palette.hidden;
    setPalette(opening);
    if (opening) { if (!activeTool) setStatus('Choose a drawing tool'); }
    else setTool(null);
  };

  const onTool = (event: Event) => {
    event.preventDefault(); event.stopPropagation();
    const tool = (event.currentTarget as HTMLElement).dataset.sireDrawingTool as DrawingTool | undefined;
    if (!tool) return;
    setTool(tool); setPalette(true);
  };

  const onUndo = (event: Event) => {
    event.preventDefault(); event.stopPropagation();
    firstPoint = null; completing = false; drawings = drawings.slice(0, -1);
    setStatus(activeTool ? `${TOOL_LABELS[activeTool]}: ready` : ''); scheduleDraw();
  };

  const onClear = (event: Event) => {
    event.preventDefault(); event.stopPropagation();
    firstPoint = null; completing = false; drawings = [];
    setStatus(activeTool ? `${TOOL_LABELS[activeTool]}: ready` : ''); scheduleDraw();
  };

  const onRangeChange = () => scheduleDraw();
  const onSizeChange = () => resizeCanvas();

  button.addEventListener('click', onToggle);
  toolButtons.forEach(item => item.addEventListener('click', onTool));
  undo.addEventListener('click', onUndo);
  clear.addEventListener('click', onClear);
  chartElement.addEventListener('pointerdown', onPointerDown, { passive: false });
  chartElement.addEventListener('pointermove', onPointerMove, { passive: false });
  chartElement.addEventListener('pointerup', onPointerUp, { passive: false });
  chartElement.addEventListener('pointercancel', onPointerUp, { passive: false });
  chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
  chart.timeScale().subscribeSizeChange(onSizeChange);
  window.addEventListener('resize', onSizeChange);
  resizeCanvas();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) window.cancelAnimationFrame(raf);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
      chart.timeScale().unsubscribeSizeChange(onSizeChange);
      window.removeEventListener('resize', onSizeChange);
      button.removeEventListener('click', onToggle);
      toolButtons.forEach(item => item.removeEventListener('click', onTool));
      undo.removeEventListener('click', onUndo);
      clear.removeEventListener('click', onClear);
      chartElement.removeEventListener('pointerdown', onPointerDown);
      chartElement.removeEventListener('pointermove', onPointerMove);
      chartElement.removeEventListener('pointerup', onPointerUp);
      chartElement.removeEventListener('pointercancel', onPointerUp);
      chart.clearCrosshairPosition();
      canvas.remove();
      setPalette(false);
      activeTool = null;
      firstPoint = null;
      previewPoint = null;
      drawings = [];
    },
  };
}
