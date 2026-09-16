import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';

type Bar = {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Bridge = {
  host: HTMLDivElement;
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  observer: MutationObserver;
  resize: ResizeObserver;
  initialized: boolean;
  barCount: number;
};

const bridges = new WeakMap<SVGElement, Bridge>();

function number(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceMapper(stage: HTMLElement) {
  const labels = Array.from(stage.querySelectorAll<HTMLElement>('.price-axis span'))
    .map(element => ({
      value: Number(element.textContent?.replace(/,/g, '')),
      y: element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2,
    }))
    .filter(item => Number.isFinite(item.value));

  if (labels.length < 2) return null;
  labels.sort((a, b) => a.y - b.y);

  const first = labels[0];
  const last = labels[labels.length - 1];
  const dy = last.y - first.y;
  if (!dy) return null;

  return (screenY: number) => first.value + ((screenY - first.y) / dy) * (last.value - first.value);
}

function readBars(stage: HTMLElement, svg: SVGElement): Bar[] {
  const toPrice = priceMapper(stage);
  if (!toPrice) return [];

  const svgRect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const scaleY = viewBox.height ? svgRect.height / viewBox.height : 1;
  const groups = Array.from(svg.querySelectorAll<SVGGElement>('g.candle-up, g.candle-down'));
  const bars: Bar[] = [];

  groups.forEach((group, index) => {
    const body = group.querySelector<SVGRectElement>('.candle-body');
    const wick = group.querySelector<SVGLineElement>('.candle-wick');
    if (!body || !wick) return;

    const yHigh = number(wick.getAttribute('y1'));
    const yLow = number(wick.getAttribute('y2'));
    const yBody = number(body.getAttribute('y'));
    const bodyHeight = number(body.getAttribute('height'));
    if (yHigh === null || yLow === null || yBody === null || bodyHeight === null) return;

    const bodyTop = svgRect.top + yBody * scaleY;
    const bodyBottom = bodyTop + bodyHeight * scaleY;
    const high = toPrice(svgRect.top + yHigh * scaleY);
    const low = toPrice(svgRect.top + yLow * scaleY);
    const rising = group.classList.contains('candle-up');
    const open = toPrice(rising ? bodyBottom : bodyTop);
    const close = toPrice(rising ? bodyTop : bodyBottom);

    if (![open, high, low, close].every(Number.isFinite)) return;

    bars.push({
      time: (index + 1) as Time,
      open: open as number,
      high: high as number,
      low: low as number,
      close: close as number,
    });
  });

  return bars;
}

function sync(bridge: Bridge, stage: HTMLElement, svg: SVGElement) {
  const groups = svg.querySelectorAll<SVGGElement>('g.candle-up, g.candle-down');
  groups.forEach(group => {
    group.style.visibility = 'hidden';
  });

  // The old SIRE price axis is only retained as an invisible OHLC calibration
  // source. The visible price pane is now the native Lightweight Charts scale.
  stage.querySelectorAll<HTMLElement>('.price-axis').forEach(axis => {
    axis.style.opacity = '0';
    axis.style.pointerEvents = 'none';
  });

  const bars = readBars(stage, svg);
  if (!bars.length) return;

  const timeScale = bridge.chart.timeScale();
  const previousRange = timeScale.getVisibleLogicalRange();
  const previousCount = bridge.barCount;
  const wasAtRightEdge = previousRange !== null && previousRange.to >= previousCount - 0.75;

  bridge.series.setData(bars);
  bridge.barCount = bars.length;

  timeScale.applyOptions({
    barSpacing: 8,
    minBarSpacing: 3,
    maxBarSpacing: 32,
    rightOffset: 2,
    fixLeftEdge: false,
    fixRightEdge: false,
    lockVisibleTimeRangeOnResize: true,
    rightBarStaysOnScroll: true,
    shiftVisibleRangeOnNewBar: true,
  });

  if (!bridge.initialized || !previousRange) {
    const visibleSlots = Math.max(24, Math.floor(bridge.host.clientWidth / 8));
    const from = Math.max(-2, bars.length - visibleSlots);
    const to = bars.length + 2;
    timeScale.setVisibleLogicalRange({ from, to });
    bridge.initialized = true;
    return;
  }

  const delta = bars.length - previousCount;
  const shift = wasAtRightEdge && delta > 0 ? delta : 0;
  timeScale.setVisibleLogicalRange({
    from: previousRange.from + shift,
    to: previousRange.to + shift,
  });
}

function mount(stage: HTMLElement, svg: SVGElement) {
  if (bridges.has(svg)) return;

  const host = document.createElement('div');
  host.className = 'sire-native-candlestick-chart';
  Object.assign(host.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'auto',
    zIndex: '1',
    overflow: 'hidden',
    touchAction: 'none',
    userSelect: 'none',
  });

  stage.appendChild(host);

  const chart = createChart(host, {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: 'transparent',
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { visible: false },
    },
    leftPriceScale: { visible: false },
    rightPriceScale: {
      visible: true,
      borderVisible: true,
      minimumWidth: 64,
      alignLabels: true,
      ticksVisible: false,
      autoScale: true,
    },
    timeScale: {
      visible: false,
      borderVisible: false,
      barSpacing: 8,
      minBarSpacing: 3,
      maxBarSpacing: 32,
      rightOffset: 2,
      fixLeftEdge: false,
      fixRightEdge: false,
      lockVisibleTimeRangeOnResize: true,
      rightBarStaysOnScroll: true,
      shiftVisibleRangeOnNewBar: true,
    },
    crosshair: { mode: 0 },
    handleScroll: {
      mouseWheel: false,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      mouseWheel: true,
      pinch: true,
      axisPressedMouseMove: true,
      axisDoubleClickReset: true,
    },
    kineticScroll: {
      mouse: true,
      touch: true,
    },
  });

  const series = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: true,
    borderUpColor: '#26a69a',
    borderDownColor: '#ef5350',
    wickVisible: true,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350',
    priceLineVisible: false,
    lastValueVisible: true,
  });

  const bridge: Bridge = {
    host,
    chart,
    series,
    observer: new MutationObserver(() => requestAnimationFrame(() => sync(bridge, stage, svg))),
    resize: new ResizeObserver(() => requestAnimationFrame(() => sync(bridge, stage, svg))),
    initialized: false,
    barCount: 0,
  };

  bridges.set(svg, bridge);
  bridge.observer.observe(svg, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['x', 'y', 'width', 'height', 'class'],
  });
  bridge.resize.observe(stage);
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
