import { CandlestickSeries, createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';

type Bar = { time: Time; open: number; high: number; low: number; close: number };

type Bridge = { host: HTMLDivElement; chart: IChartApi; series: ISeriesApi<'Candlestick'>; observer: MutationObserver; resize: ResizeObserver };

const bridges = new WeakMap<SVGElement, Bridge>();

function number(value: string | null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readPriceScale(stage: HTMLElement) {
  const labels = Array.from(stage.querySelectorAll<HTMLElement>('.price-axis span'))
    .map(el => ({ value: Number(el.textContent?.replace(/,/g, '')), y: el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 }))
    .filter(item => Number.isFinite(item.value));
  if (labels.length < 2) return null;
  labels.sort((a, b) => a.y - b.y);
  const first = labels[0];
  const last = labels[labels.length - 1];
  const dy = last.y - first.y;
  if (!dy) return null;
  return (y: number) => first.value + ((y - first.y) / dy) * (last.value - first.value);
}

function readBars(stage: HTMLElement, svg: SVGElement): Bar[] {
  const toPrice = readPriceScale(stage);
  if (!toPrice) return [];
  const groups = Array.from(svg.querySelectorAll<SVGGElement>('g.candle-up, g.candle-down'));
  const bars: Bar[] = [];
  groups.forEach((group, index) => {
    const body = group.querySelector<SVGRectElement>('.candle-body');
    const wick = group.querySelector<SVGLineElement>('.candle-wick');
    if (!body || !wick) return;
    const x = number(wick.getAttribute('x1'));
    const yHigh = number(wick.getAttribute('y1'));
    const yLow = number(wick.getAttribute('y2'));
    const yOpen = number(body.getAttribute('y'));
    const height = number(body.getAttribute('height'));
    const rising = group.classList.contains('candle-up');
    if (x === null || yHigh === null || yLow === null || yOpen === null || height === null) return;
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const scaleY = rect.height / viewBox.height;
    const screenY = (svg.getBoundingClientRect().top + yOpen * scaleY);
    const screenBottom = screenY + height * scaleY;
    const openPrice = toPrice(rising ? screenBottom : screenY);
    const closePrice = toPrice(rising ? screenY : screenBottom);
    bars.push({
      time: (index + 1) as Time,
      open: openPrice,
      high: toPrice(svg.getBoundingClientRect().top + yHigh * scaleY),
      low: toPrice(svg.getBoundingClientRect().top + yLow * scaleY),
      close: closePrice,
    });
  });
  return bars.filter(bar => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
}

function sync(bridge: Bridge, stage: HTMLElement, svg: SVGElement) {
  const bars = readBars(stage, svg);
  if (!bars.length) return;
  const width = svg.getBoundingClientRect().width;
  const barSpacing = width / bars.length;
  bridge.series.setData(bars);
  bridge.chart.timeScale().applyOptions({ barSpacing: Math.max(1, barSpacing), rightOffset: 0, minBarSpacing: 1, maxBarSpacing: Math.max(1, barSpacing) });
  bridge.chart.timeScale().setVisibleLogicalRange({ from: -0.5, to: bars.length - 0.5 });
  const min = Math.min(...bars.map(bar => bar.low));
  const max = Math.max(...bars.map(bar => bar.high));
  bridge.series.priceScale().setVisibleRange({ from: min, to: max });
}

function mount(stage: HTMLElement, svg: SVGElement) {
  if (bridges.has(svg)) return;
  const host = document.createElement('div');
  host.className = 'sire-tradingview-candle-canvas';
  Object.assign(host.style, { position: 'absolute', pointerEvents: 'none', zIndex: '2', overflow: 'hidden' });
  const svgRect = svg.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  host.style.left = `${svgRect.left - stageRect.left}px`;
  host.style.top = `${svgRect.top - stageRect.top}px`;
  host.style.width = `${svgRect.width}px`;
  host.style.height = `${svgRect.height}px`;
  stage.appendChild(host);

  const chart = createChart(host, {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: 'transparent' },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    leftPriceScale: { visible: false },
    rightPriceScale: { visible: false },
    timeScale: { visible: false, borderVisible: false, rightOffset: 0, minBarSpacing: 1, enableConflation: false },
    crosshair: { mode: 0 },
    handleScroll: false,
    handleScale: false,
  });
  const series = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: false,
    wickVisible: true,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350',
    priceLineVisible: false,
    lastValueVisible: false,
  });
  const observer = new MutationObserver(() => requestAnimationFrame(() => sync(bridge, stage, svg)));
  const resize = new ResizeObserver(() => requestAnimationFrame(() => sync(bridge, stage, svg)));
  const bridge = { host, chart, series, observer, resize };
  bridges.set(svg, bridge);
  svg.querySelectorAll<SVGGElement>('g.candle-up, g.candle-down').forEach(group => { group.style.visibility = 'hidden'; });
  observer.observe(svg, { childList: true, subtree: true, attributes: true, attributeFilter: ['x', 'y', 'width', 'height', 'class'] });
  resize.observe(stage);
  sync(bridge, stage, svg);
}

function scan() {
  document.querySelectorAll<HTMLElement>('.chart-stage').forEach(stage => {
    const svg = stage.querySelector<SVGElement>('.market-svg');
    if (svg) mount(stage, svg);
  });
}

const rootObserver = new MutationObserver(() => requestAnimationFrame(scan));
rootObserver.observe(document.documentElement, { childList: true, subtree: true });
scan();
