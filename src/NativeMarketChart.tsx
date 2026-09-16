import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
} from 'lightweight-charts';

type Candle = { epoch: number; open: number; high: number; low: number; close: number };
type Props = { candles: Candle[]; latest?: { epoch: number; quote: number; bid?: number; ask?: number } | null; autoScale?: boolean };
type InstrumentPreview = { symbol: string; name: string };

function toSeriesData(candles: Candle[]): CandlestickData[] {
  const sorted = candles.filter(candle => Number.isFinite(candle.epoch) && Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close)).slice().sort((a, b) => a.epoch - b.epoch);
  const unique: CandlestickData[] = [];
  let lastTime = -1;
  for (const candle of sorted) {
    const time = Math.floor(candle.epoch) as UTCTimestamp;
    if (Number(time) <= lastTime) continue;
    unique.push({ time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
    lastTime = Number(time);
  }
  return unique;
}

export default function NativeMarketChart({ candles, latest, autoScale = true }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const initializedRef = useRef(false);
  const firstDataRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { color: '#090d12' }, textColor: '#9aa5b1', attributionLogo: false },
      grid: { vertLines: { color: '#151b23' }, horzLines: { color: '#151b23' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#66717f', width: 1, style: 3, labelBackgroundColor: '#202833' }, horzLine: { color: '#66717f', width: 1, style: 3, labelBackgroundColor: '#202833' } },
      rightPriceScale: { visible: true, borderVisible: true, borderColor: '#29313c', textColor: '#b5bec9', ticksVisible: true, minimumWidth: 76, autoScale },
      timeScale: { visible: true, borderVisible: true, timeVisible: true, secondsVisible: true, rightOffset: 6, barSpacing: 8, minBarSpacing: 2 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: true, mouseWheel: true, pinch: true },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: '#22c55e', downColor: '#ef4444', borderUpColor: '#22c55e', borderDownColor: '#ef4444', wickUpColor: '#22c55e', wickDownColor: '#ef4444', priceLineVisible: true, lastValueVisible: true, priceLineWidth: 1 });
    chartRef.current = chart;
    seriesRef.current = series;
    initializedRef.current = true;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; initializedRef.current = false; firstDataRef.current = false; };
  }, [autoScale]);

  useEffect(() => {
    if (!initializedRef.current || !seriesRef.current) return;
    const data = toSeriesData(candles);
    seriesRef.current.setData(data);
    if (!firstDataRef.current && data.length) { chartRef.current?.timeScale().fitContent(); firstDataRef.current = true; }
  }, [candles]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !latest || !candles.length) return;
    const last = candles[candles.length - 1];
    const latestTime = Math.floor(latest.epoch);
    const candleTime = Math.floor(last.epoch);
    if (latestTime < candleTime) return;
    series.update({ time: candleTime as UTCTimestamp, open: last.open, high: Math.max(last.high, latest.quote), low: Math.min(last.low, latest.quote), close: latest.quote });
  }, [latest, candles]);

  useEffect(() => {
    const surface = hostRef.current?.parentElement;
    if (!surface) return;
    const bar = surface.querySelector<HTMLElement>('.native-bottom-glass-bar');
    const viewport = surface.querySelector<HTMLElement>('.native-bottom-instrument-viewport');
    const track = surface.querySelector<HTMLElement>('.native-bottom-instrument-track');
    const currentLabel = surface.querySelector<HTMLElement>('.native-bottom-instrument-current');
    const previousLabel = surface.querySelector<HTMLElement>('.native-bottom-instrument-previous');
    const nextLabel = surface.querySelector<HTMLElement>('.native-bottom-instrument-next');
    if (!bar || !viewport || !track || !currentLabel || !previousLabel || !nextLabel) return;

    let startY = 0;
    let startX = 0;
    let dragOffset = 0;
    let tracking = false;
    let raf = 0;
    let longPressTimer = 0;
    let longPressTriggered = false;
    let instruments: InstrumentPreview[] = [];
    let activeIndex = -1;

    const setTrack = (offset: number, animated = false) => {
      track.style.transition = animated ? 'transform 180ms cubic-bezier(.22,.8,.24,1)' : 'none';
      track.style.transform = `translate3d(0, calc(-48px + ${offset}px), 0)`;
    };

    const renderPreview = () => {
      const current = instruments[activeIndex];
      const previous = activeIndex > 0 ? instruments[activeIndex - 1] : null;
      const next = activeIndex >= 0 && activeIndex < instruments.length - 1 ? instruments[activeIndex + 1] : null;
      currentLabel.textContent = current?.name || 'Select instrument';
      previousLabel.textContent = previous?.name || '';
      nextLabel.textContent = next?.name || '';
      previousLabel.style.opacity = previous ? '1' : '0';
      nextLabel.style.opacity = next ? '1' : '0';
      setTrack(0);
    };

    const openPicker = () => {
      const picker = document.querySelector<HTMLButtonElement>('.native-instrument-picker');
      if (!picker) return;
      picker.click();
    };

    const closePickerSilently = () => {
      const done = document.querySelector<HTMLButtonElement>('.native-instrument-sheet .sheet-head button');
      if (done) done.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      window.setTimeout(() => document.body.classList.remove('sire-swipe-probing'), 80);
    };

    const readPicker = (selectOffset?: -1 | 1) => {
      const picker = document.querySelector<HTMLButtonElement>('.native-instrument-picker');
      if (!picker) return Promise.resolve(false);
      document.body.classList.add('sire-swipe-probing');
      picker.click();
      return new Promise<boolean>(resolve => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('.native-instrument-sheet .sheet-row'));
          const parsed = rows.map(row => {
            const strong = row.querySelector('b');
            const symbol = row.querySelector('small');
            return { name: strong?.textContent?.trim() || '', symbol: symbol?.textContent?.trim() || '' };
          }).filter(item => item.name);
          const active = rows.findIndex(row => row.classList.contains('active'));
          if (parsed.length) {
            instruments = parsed;
            if (active >= 0) activeIndex = active;
            if (!selectOffset) renderPreview();
          }
          if (selectOffset && activeIndex >= 0) {
            const target = activeIndex + selectOffset;
            if (target >= 0 && target < rows.length) {
              rows[target].click();
              window.setTimeout(() => document.body.classList.remove('sire-swipe-probing'), 120);
              resolve(true);
              return;
            }
          }
          closePickerSilently();
          resolve(Boolean(parsed.length));
        }));
      });
    };

    const updateFromSource = () => {
      const source = document.querySelector<HTMLElement>('.native-instrument-picker strong');
      if (source && activeIndex < 0 && instruments.length) {
        const index = instruments.findIndex(item => item.name === source.textContent?.trim());
        if (index >= 0) { activeIndex = index; renderPreview(); }
      }
    };

    const finishSwipe = (direction: -1 | 1) => {
      if (activeIndex < 0 || (direction < 0 && activeIndex <= 0) || (direction > 0 && activeIndex >= instruments.length - 1)) {
        setTrack(0, true);
        window.setTimeout(() => setTrack(0), 190);
        return;
      }
      const target = activeIndex + direction;
      setTrack(direction < 0 ? -48 : 48, true);
      window.setTimeout(() => {
        void readPicker(direction).then(success => {
          if (!success) { setTrack(0, true); return; }
          activeIndex = target;
          window.setTimeout(() => renderPreview(), 115);
        });
      }, 35);
    };

    const cancelLongPress = () => {
      if (longPressTimer) window.clearTimeout(longPressTimer);
      longPressTimer = 0;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      startX = event.clientX;
      startY = event.clientY;
      dragOffset = 0;
      tracking = true;
      longPressTriggered = false;
      cancelLongPress();
      viewport.setPointerCapture?.(event.pointerId);
      if (!instruments.length) void readPicker();
      bar.classList.add('instrument-swiping');
      longPressTimer = window.setTimeout(() => {
        if (!tracking) return;
        longPressTriggered = true;
        tracking = false;
        if (raf) cancelAnimationFrame(raf);
        setTrack(0, true);
        bar.classList.remove('instrument-swiping');
        openPicker();
      }, 600);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!tracking) return;
      const dy = event.clientY - startY;
      const dx = event.clientX - startX;
      if (Math.hypot(dx, dy) > 12) cancelLongPress();
      if (Math.abs(dy) < Math.abs(dx) * 1.05) return;
      dragOffset = Math.max(-44, Math.min(44, dy));
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTrack(dragOffset));
      event.preventDefault();
    };

    const onPointerUp = (event: PointerEvent) => {
      cancelLongPress();
      if (longPressTriggered) { longPressTriggered = false; return; }
      if (!tracking) return;
      tracking = false;
      if (raf) cancelAnimationFrame(raf);
      const dy = event.clientY - startY;
      const dx = event.clientX - startX;
      const vertical = Math.abs(dy) >= Math.abs(dx) * 1.05;
      const threshold = Math.max(18, viewport.clientHeight * .42);
      if (!vertical || Math.abs(dy) < threshold) setTrack(0, true);
      else finishSwipe(dy < 0 ? 1 : -1);
      window.setTimeout(() => bar.classList.remove('instrument-swiping'), 210);
    };

    viewport.addEventListener('pointerdown', onPointerDown, { passive: false });
    viewport.addEventListener('pointermove', onPointerMove, { passive: false });
    viewport.addEventListener('pointerup', onPointerUp, { passive: false });
    viewport.addEventListener('pointercancel', onPointerUp, { passive: false });

    const observer = new MutationObserver(updateFromSource);
    const pickerText = document.querySelector('.native-instrument-picker strong');
    if (pickerText) observer.observe(pickerText, { childList: true, characterData: true, subtree: true });
    updateFromSource();
    const primeTimer = window.setTimeout(() => void readPicker(), 160);

    return () => {
      window.clearTimeout(primeTimer);
      cancelLongPress();
      if (raf) cancelAnimationFrame(raf);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerUp);
      viewport.removeEventListener('pointercancel', onPointerUp);
      observer.disconnect();
      document.body.classList.remove('sire-swipe-probing');
    };
  }, []);

  return <div className="native-chart-touch-surface">
    <div ref={hostRef} className="sire-native-chart" aria-label="SIRE native market chart" />
    <div className="native-bottom-glass-bar" aria-hidden="true">
      <div className="native-bottom-instrument-viewport">
        <div className="native-bottom-instrument-track">
          <span className="native-bottom-instrument-side native-bottom-instrument-previous" />
          <span className="native-bottom-instrument-current">Select instrument</span>
          <span className="native-bottom-instrument-side native-bottom-instrument-next" />
        </div>
      </div>
    </div>
  </div>;
}
