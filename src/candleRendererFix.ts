const SVG_NS = 'http://www.w3.org/2000/svg';

function num(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fixCandleGroup(group: Element) {
  const body = group.querySelector<SVGRectElement>('.candle-body');
  const wick = group.querySelector<SVGLineElement>('.candle-wick');
  if (!body || !wick) return;

  const width = num(body.getAttribute('width'));
  if (width > 0) {
    const left = num(body.getAttribute('x'));
    const center = left + width / 2;
    const cleanWidth = Math.max(0.16, Math.min(width * 0.62, 0.44));
    body.setAttribute('width', String(cleanWidth));
    body.setAttribute('x', String(center - cleanWidth / 2));
    body.setAttribute('rx', '0');
  }

  const yHigh = num(wick.getAttribute('y1'));
  const yLow = num(wick.getAttribute('y2'));
  const top = num(body.getAttribute('y'));
  const height = num(body.getAttribute('height'));
  const bottom = top + height;
  const x = num(wick.getAttribute('x1'));

  let upper = group.querySelector<SVGLineElement>('.candle-wick-upper');
  let lower = group.querySelector<SVGLineElement>('.candle-wick-lower');
  if (!upper) {
    upper = document.createElementNS(SVG_NS, 'line');
    upper.setAttribute('class', 'candle-wick candle-wick-upper');
    group.appendChild(upper);
  }
  if (!lower) {
    lower = document.createElementNS(SVG_NS, 'line');
    lower.setAttribute('class', 'candle-wick candle-wick-lower');
    group.appendChild(lower);
  }

  upper.setAttribute('x1', String(x));
  upper.setAttribute('x2', String(x));
  upper.setAttribute('y1', String(yHigh));
  upper.setAttribute('y2', String(Math.min(yHigh, top)));

  lower.setAttribute('x1', String(x));
  lower.setAttribute('x2', String(x));
  lower.setAttribute('y1', String(Math.max(yLow, bottom)));
  lower.setAttribute('y2', String(yLow));

  wick.setAttribute('opacity', '0');
  wick.setAttribute('pointer-events', 'none');
}

function applyCandleFix(root: ParentNode = document) {
  root.querySelectorAll<SVGGElement>('g.candle-up, g.candle-down').forEach(fixCandleGroup);
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyCandleFix();
  });
}

function start() {
  applyCandleFix();
  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.type === 'childList' || mutation.type === 'attributes')) schedule();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['x', 'y', 'width', 'height', 'class'],
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
