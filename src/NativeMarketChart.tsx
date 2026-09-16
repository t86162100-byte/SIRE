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
    const timeframeViewport = surface.querySelector<HTMLElement>('.native-bottom-timeframe-viewport');
    const timeframeTrack = surface.querySelector<HTMLElement>('.native-bottom-timeframe-track');
    const timeframeCurrent = surface.querySelector<HTMLElement>('.native-bottom-timeframe-current');
    const timeframePrevious = surface.querySelector<HTMLElement>('.native-bottom-timeframe-previous');
    const timeframeNext = surface.querySelector<HTMLElement>('.native-bottom-timeframe-next');
    if (!bar || !viewport || !track || !currentLabel || !previousLabel || !nextLabel) return;
    const timeframeHost = document.querySelector<HTMLElement>('.native-bottom-timeframe-viewport');
    const timeframeTrackHost = document.querySelector<HTMLElement>('.native-bottom-timeframe-track');
    const timeframeCurrentHost = document.querySelector<HTMLElement>('.native-bottom-timeframe-current');
    const timeframePreviousHost = document.querySelector<HTMLElement>('.native-bottom-timeframe-previous');
    const timeframeNextHost = document.querySelector<HTMLElement>('.native-bottom-timeframe-next');
    if (!timeframeHost || !timeframeTrackHost || !timeframeCurrentHost || !timeframePreviousHost || !timeframeNextHost) return;

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

    const getTimeframes = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.native-timeframes button')).map(button => ({ value: button.textContent?.trim() || '', button })).filter(item => item.value);
    const currentTimeframeIndex = () => {
      const frames = getTimeframes();
      const index = frames.findIndex(item => item.button.classList.contains('active'));
      return { frames, index };
    };
    const setTimeframeTrack = (offset: number, animated = false) => {
      timeframeTrackHost.style.transition = animated ? 'transform 180ms cubic-bezier(.22,.8,.24,1)' : 'none';
      timeframeTrackHost.style.transform = `translate3d(0, calc(-48px + ${offset}px), 0)`;
    };
    const renderTimeframePreview = () => {
      const { frames, index } = currentTimeframeIndex();
      const current = index >= 0 ? frames[index]?.value : '1m';
      timeframeCurrentHost.textContent = current;
      timeframePreviousHost.textContent = index > 0 ? frames[index - 1].value : '';
      timeframeNextHost.textContent = index >= 0 && index < frames.length - 1 ? frames[index + 1].value : '';
      timeframePreviousHost.style.opacity = index > 0 ? '1' : '0';
      timeframeNextHost.style.opacity = index >= 0 && index < frames.length - 1 ? '1' : '0';
      setTimeframeTrack(0);
    };
    const selectTimeframeOffset = (direction: -1 | 1) => {
      const { frames, index } = currentTimeframeIndex();
      const target = index + direction;
      if (index < 0 || target < 0 || target >= frames.length) { setTimeframeTrack(0, true); return; }
      setTimeframeTrack(direction < 0 ? -48 : 48, true);
      window.setTimeout(() => {
        frames[target].button.click();
        window.setTimeout(renderTimeframePreview, 100);
      }, 35);
    };
    const openTimeframeList = () => {
      const frames = getTimeframes();
      if (!frames.length) return;
      const existing = document.querySelector<HTMLElement>('.native-bottom-timeframe-overlay');
      existing?.remove();
      const overlay = document.createElement('div');
      overlay.className = 'native-bottom-timeframe-overlay';
      const sheet = document.createElement('div');
      sheet.className = 'native-bottom-timeframe-sheet';
      const head = document.createElement('div');
      head.className = 'native-bottom-timeframe-head';
      head.innerHTML = '<span>TIMEFRAME</span><button type="button">Done</button>';
      sheet.appendChild(head);
      const list = document.createElement('div');
      list.className = 'native-bottom-timeframe-list';
      frames.forEach(({ value, button }) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = value;
        item.className = button.classList.contains('active') ? 'active' : '';
        item.addEventListener('click', () => { button.click(); overlay.remove(); window.setTimeout(renderTimeframePreview, 60); });
        list.appendChild(item);
      });
      sheet.appendChild(list);
      overlay.appendChild(sheet);
      document.body.appendChild(overlay);
      overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
      head.querySelector('button')?.addEventListener('click', () => overlay.remove());
    };
    let timeframeStartY = 0;
    let timeframeStartX = 0;
    let timeframeTracking = false;
    let timeframeOffset = 0;
    let timeframeRaf = 0;
    let timeframeLongPressTimer = 0;
    let timeframeLongPressTriggered = false;
    const cancelTimeframeHold = () => { if (timeframeLongPressTimer) window.clearTimeout(timeframeLongPressTimer); timeframeLongPressTimer = 0; };
    const onTimeframeDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      timeframeStartX = event.clientX;
      timeframeStartY = event.clientY;
      timeframeOffset = 0;
      timeframeTracking = true;
      timeframeLongPressTriggered = false;
      cancelTimeframeHold();
      timeframeHost.setPointerCapture?.(event.pointerId);
      bar.classList.add('timeframe-swiping');
      timeframeLongPressTimer = window.setTimeout(() => {
        if (!timeframeTracking) return;
        timeframeLongPressTriggered = true;
        timeframeTracking = false;
        if (timeframeRaf) cancelAnimationFrame(timeframeRaf);
        setTimeframeTrack(0, true);
        bar.classList.remove('timeframe-swiping');
        openTimeframeList();
      }, 600);
    };
    const onTimeframeMove = (event: PointerEvent) => {
      if (!timeframeTracking) return;
      const dy = event.clientY - timeframeStartY;
      const dx = event.clientX - timeframeStartX;
      if (Math.hypot(dx, dy) > 12) cancelTimeframeHold();
      if (Math.abs(dy) < Math.abs(dx) * 1.05) return;
      timeframeOffset = Math.max(-44, Math.min(44, dy));
      if (timeframeRaf) cancelAnimationFrame(timeframeRaf);
      timeframeRaf = requestAnimationFrame(() => setTimeframeTrack(timeframeOffset));
      event.preventDefault();
    };
    const onTimeframeUp = (event: PointerEvent) => {
      cancelTimeframeHold();
      if (timeframeLongPressTriggered) { timeframeLongPressTriggered = false; return; }
      if (!timeframeTracking) return;
      timeframeTracking = false;
      if (timeframeRaf) cancelAnimationFrame(timeframeRaf);
      const dy = event.clientY - timeframeStartY;
      const dx = event.clientX - timeframeStartX;
      const vertical = Math.abs(dy) >= Math.abs(dx) * 1.05;
      const threshold = Math.max(18, timeframeHost.clientHeight * .42);
      if (!vertical || Math.abs(dy) < threshold) setTimeframeTrack(0, true);
      else selectTimeframeOffset(dy < 0 ? 1 : -1);
      window.setTimeout(() => bar.classList.remove('timeframe-swiping'), 210);
    };

    viewport.addEventListener('pointerdown', onPointerDown, { passive: false });
    viewport.addEventListener('pointermove', onPointerMove, { passive: false });
    viewport.addEventListener('pointerup', onPointerUp, { passive: false });
    viewport.addEventListener('pointercancel', onPointerUp, { passive: false });
    timeframeHost.addEventListener('pointerdown', onTimeframeDown, { passive: false });
    timeframeHost.addEventListener('pointermove', onTimeframeMove, { passive: false });
    timeframeHost.addEventListener('pointerup', onTimeframeUp, { passive: false });
    timeframeHost.addEventListener('pointercancel', onTimeframeUp, { passive: false });

    const observer = new MutationObserver(() => { updateFromSource(); renderTimeframePreview(); });
    const pickerText = document.querySelector('.native-instrument-picker strong');
    if (pickerText) observer.observe(pickerText, { childList: true, characterData: true, subtree: true });
    const timeframeBar = document.querySelector('.native-timeframes');
    if (timeframeBar) observer.observe(timeframeBar, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    updateFromSource();
    renderTimeframePreview();
    const primeTimer = window.setTimeout(() => void readPicker(), 160);

    return () => {
      window.clearTimeout(primeTimer);
      cancelLongPress();
      cancelTimeframeHold();
      if (raf) cancelAnimationFrame(raf);
      if (timeframeRaf) cancelAnimationFrame(timeframeRaf);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerUp);
      viewport.removeEventListener('pointercancel', onPointerUp);
      timeframeHost.removeEventListener('pointerdown', onTimeframeDown);
      timeframeHost.removeEventListener('pointermove', onTimeframeMove);
      timeframeHost.removeEventListener('pointerup', onTimeframeUp);
      timeframeHost.removeEventListener('pointercancel', onTimeframeUp);
      observer.disconnect();
      document.querySelector('.native-bottom-timeframe-overlay')?.remove();
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
      <div className="native-bottom-timeframe-viewport">
        <div className="native-bottom-timeframe-track">
          <span className="native-bottom-timeframe-side native-bottom-timeframe-previous" />
          <span className="native-bottom-timeframe-current">1m</span>
          <span className="native-bottom-timeframe-side native-bottom-timeframe-next" />
        </div>
      </div>
    </div>
  </div>;
}
