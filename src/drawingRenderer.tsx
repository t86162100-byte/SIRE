import type { ReactNode } from 'react';

export type DrawingVisual = { id: number; tool: string; p1: number; p2?: number; e1: number; e2?: number; visible: boolean; color?: 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'white'; width?: 1 | 2 | 3 }; 
export type DrawingBar = { epoch: number; open: number; high: number; low: number; close: number };
export type DrawingGeometry = { min: number; max: number };

type Props = { drawing: DrawingVisual; visibleBars: DrawingBar[]; geometry: DrawingGeometry; selected: boolean; formatQuote: (value: number) => string };

export function renderDrawing({ drawing, visibleBars, geometry, selected, formatQuote }: Props): ReactNode {
  if (!drawing.visible || !visibleBars.length) return null;
  const range = Math.max(geometry.max - geometry.min, Number.EPSILON);
  const clamp = (n: number, min = -300, max = 300) => Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
  const xFor = (epoch?: number) => {
    if (!epoch || !Number.isFinite(epoch)) return 0;
    const found = visibleBars.findIndex(bar => bar.epoch >= epoch);
    const index = found < 0 ? visibleBars.length - 1 : found;
    return clamp(visibleBars.length === 1 ? 50 : index / Math.max(1, visibleBars.length - 1) * 100, 0, 100);
  };
  const yFor = (price?: number) => clamp(100 - ((Number.isFinite(price) ? Number(price) : geometry.min) - geometry.min) / range * 100);
  const x1 = xFor(drawing.e1);
  const x2 = xFor(drawing.e2 ?? drawing.e1);
  const y1 = yFor(drawing.p1);
  const y2 = yFor(drawing.p2 ?? drawing.p1);
  const colorClass = `drawing-color-${drawing.color ?? 'blue'}`;
  const widthClass = `drawing-width-${drawing.width ?? 1}`;
  const cls = `drawing-line ${colorClass} ${widthClass}${selected ? ' drawing-selected-line' : ''}`;
  const line = (a: number, b: number, c: number, d: number, dashed = false) => <line x1={a} y1={b} x2={c} y2={d} className={`${cls}${dashed ? ' drawing-dashed' : ''}`} vectorEffect="non-scaling-stroke" />;
  const handle = (x: number, y: number) => selected ? <circle cx={x} cy={y} r="2.5" className={`drawing-handle ${colorClass}`} /> : null;
  const endpointHandles = () => selected ? <>{handle(x1, y1)}{handle(x2, y2)}</> : null;
  const selectedHandle = (x: number, y: number) => selected ? handle(x, y) : null;
  const label = (text: string, x: number, y: number) => <text x={clamp(x, 1, 96)} y={clamp(y, 5, 97)} className="drawing-label">{text}</text>;
  const id = drawing.id;
  const tool = drawing.tool;

  if (tool === 'Horizontal Line') return <g key={id}>{line(0, y1, 100, y1)}{selectedHandle(3, y1)}{selectedHandle(97, y1)}</g>;
  if (tool === 'Horizontal Ray') return <g key={id}>{line(x1, y1, 100, y1)}{selectedHandle(x1, y1)}</g>;
  if (tool === 'Vertical Line') return <g key={id}>{line(x1, 0, x1, 100)}{selectedHandle(x1, y1)}</g>;
  if (tool === 'Cross Line') return <g key={id}>{line(x1, 0, x1, 100)}{line(0, y1, 100, y1)}{selectedHandle(x1, y1)}</g>;

  if (['Trend Line', 'Forecast Line', 'Info Line', 'Measure', 'Projection'].includes(tool)) {
    const dashed = tool === 'Forecast Line' || tool === 'Measure' || tool === 'Projection';
    return <g key={id}>{line(x1, y1, x2, y2, dashed)}{endpointHandles()}{tool === 'Measure' && label(`${formatQuote(Math.abs((drawing.p2 ?? drawing.p1) - drawing.p1))} · ${Math.abs((drawing.e2 || drawing.e1) - drawing.e1)}s`, Math.min(x1, x2) + 1, Math.min(y1, y2) - 2)}</g>;
  }
  if (tool === 'Ray' || tool === 'Extended Line' || tool === 'Regression Trend') {
    const slope = (y2 - y1) / Math.max(0.001, x2 - x1);
    const ax = tool === 'Ray' ? x1 : 0;
    const bx = tool === 'Ray' ? (x2 >= x1 ? 100 : 0) : 100;
    return <g key={id}>{line(ax, tool === 'Ray' ? y1 : clamp(y1 + slope * (ax - x1)), bx, clamp(y1 + slope * (bx - x1)), false)}{endpointHandles()}</g>;
  }
  if (['Parallel Channel', 'Disjoint Channel', 'Fib Channel', 'Pitchfork', 'Schiff Pitchfork', 'Modified Schiff Pitchfork'].includes(tool)) {
    const spread = Math.max(4, Math.abs(y2 - y1) * 0.65);
    return <g key={id}>{line(x1, y1, 100, clamp(y1 - spread))}{line(x1, y1, 100, clamp(y1 + spread))}{line(x1, y1, 100, y2, true)}{endpointHandles()}</g>;
  }

  if (['Date Range', 'Cycle Lines', 'Time Cycles', 'Fib Time Zone'].includes(tool)) {
    const step = Math.max(6, Math.abs(x2 - x1) || 8);
    const multipliers = tool === 'Fib Time Zone' ? [0, 1, 2, 3, 5, 8, 13, 21] : [0, 1, 2, 3, 4, 5];
    return <g key={id}>{multipliers.map(n => { const x = clamp(x1 + step * n, 0, 100); return <g key={n}>{line(x, 0, x, 100)}{label(String(n), x + 1, 7)}</g>; })}</g>;
  }
  if (tool === 'Price Range') return <g key={id}>{line(0, y1, 100, y1)}{line(0, y2, 100, y2)}{label(formatQuote(Math.abs((drawing.p2 ?? drawing.p1) - drawing.p1)), 2, Math.min(y1, y2) - 2)}</g>;
  if (['Date and Price Range', 'Rectangle', 'Projection', 'Bars Pattern', 'Gann Box'].includes(tool)) return <g key={id}><rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.max(.2, Math.abs(x2 - x1))} height={Math.max(.2, Math.abs(y2 - y1))} className="drawing-zone" />{tool === 'Gann Box' && <>{line(x1, y1, x2, y2)}{line(x1, y2, x2, y1)}</>}{tool === 'Bars Pattern' && label('BARS', Math.min(x1, x2) + 1, Math.min(y1, y2) + 7)}</g>;

  if (['Fib Retracement', 'Auto Fib Retracement', 'Fib Extension', 'Fib Trend-Based Extension'].includes(tool)) {
    const levels = tool.includes('Extension') ? [0, .618, 1, 1.272, 1.618, 2.618] : [0, .236, .382, .5, .618, .786, 1];
    return <g key={id}>{levels.map(level => { const price = drawing.p1 + ((drawing.p2 ?? drawing.p1) - drawing.p1) * level; const y = yFor(price); return <g key={level}>{line(Math.min(x1, x2), y, Math.max(x1, x2), y)}{label(String(level), Math.max(x1, x2) + 1, y - 1)}</g>; })}{endpointHandles()}</g>;
  }
  if (['Fib Speed Resistance Fan', 'Pitchfan', 'Gann Fan'].includes(tool)) return <g key={id}>{[.25, .382, .5, .618, 1, 1.618].map(n => line(x1, y1, clamp(x1 + (x2 - x1) * 2, 0, 100), clamp(y1 + (y2 - y1) * n * 2)))}{selectedHandle(x1, y1)}</g>;
  if (tool === 'Fib Circles') return <g key={id}>{[.382, .618, 1, 1.618].map(n => <ellipse key={n} cx={x1} cy={y1} rx={Math.max(.2, Math.abs(x2 - x1) * n)} ry={Math.max(.2, Math.abs(y2 - y1) * n)} className="drawing-fib" />)}</g>;
  if (tool === 'Fib Spiral') return <g key={id}><path d={Array.from({ length: 36 }, (_, i) => { const t = i / 35; const a = t * Math.PI * 4; const r = t * Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)); return `${i ? 'L' : 'M'} ${clamp(x1 + Math.cos(a) * r, -20, 120)} ${clamp(y1 + Math.sin(a) * r, -20, 120)}`; }).join(' ')} className={cls} fill="none" /></g>;

  if (['Gann Square', 'Gann Box'].includes(tool)) return <g key={id}><rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.max(.2, Math.abs(x2 - x1))} height={Math.max(.2, Math.abs(y2 - y1))} className="drawing-zone" />{[.25, .5, .75].map(n => <g key={n}>{line(x1 + (x2 - x1) * n, y1, x1 + (x2 - x1) * n, y2)}{line(x1, y1 + (y2 - y1) * n, x2, y1 + (y2 - y1) * n)}</g>)}</g>;
  if (['Ellipse', 'Fib Wedge'].includes(tool)) return <g key={id}><ellipse cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.max(.2, Math.abs(x2 - x1) / 2)} ry={Math.max(.2, Math.abs(y2 - y1) / 2)} className="drawing-zone" /></g>;
  if (['Triangle', 'Wedge'].includes(tool)) return <g key={id}><polygon points={`${x1},${y1} ${x2},${y2} ${x1},${y2}`} className="drawing-zone" /></g>;
  if (tool === 'Arc') return <g key={id}><path d={`M ${x1} ${y2} Q ${(x1 + x2) / 2} ${clamp(y1 - Math.abs(y2 - y1))} ${x2} ${y2}`} className={cls} fill="none" /></g>;
  if (['Polyline', 'Curve', 'Path', 'Brush', 'Highlighter'].includes(tool)) return <g key={id}><path d={`M ${x1} ${y1} Q ${(x1 + x2) / 2} ${clamp(y1 + (y2 - y1) * .35)} ${x2} ${y2}`} className={`${cls}${tool === 'Highlighter' ? ' drawing-highlighter' : tool === 'Brush' ? ' drawing-brush' : ''}`} fill="none" /></g>;
  if (tool === 'Arrow') return <g key={id}>{line(x1, y1, x2, y2)}{line(x2, y2, x2 - 3, y2 + 2)}{line(x2, y2, x2 - 3, y2 - 2)}{endpointHandles()}</g>;
  if (['Text', 'Note', 'Callout', 'Price Label', 'Arrow Mark Up', 'Flag Mark', 'Pin', 'Emoji'].includes(tool)) return <g key={id}>{tool === 'Arrow Mark Up' ? line(x1, y1 + 8, x1, y1 - 2) : selectedHandle(x1, y1)}{label(tool === 'Price Label' ? formatQuote(drawing.p1) : tool, x1 + 2, y1 - 3)}</g>;

  return <g key={id}>{line(x1, y1, x2, y2)}{endpointHandles()}</g>;
}
