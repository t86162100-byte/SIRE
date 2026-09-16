import { useEffect, useMemo, useRef } from 'react';
import { attachSireTradingViewDrawingController } from './chart/drawings/SireTradingViewDrawingController';
import type { TradingViewResolution, TradingViewResolutionOption } from './chart/tradingViewResolutions';
import {
  CandlestickSeries,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';

type Candle = { epoch: number; open: number; high: number; low: number; close: number };
type InstrumentPreview = { symbol: string; name: string };
type Props = {
  candles: Candle[];
  latest?: { epoch: number; quote: number; bid?: number; ask?: number } | null;
  autoScale?: boolean;
  timeframe: TradingViewResolution;
  timeframeOptions: readonly TradingViewResolutionOption[];
  onTimeframeChange: (value: TradingViewResolution) => void;
};

function toSeriesData(candles: Candle[]): CandlestickData[] {
  const sorted = candles
    .filter(candle => Number.isFinite(candle.epoch) && Number.isFinite(candle.open) && Number.isFinite(candle.high) && Number.isFinite(candle.low) && Number.isFinite(candle.close))
    .slice()
    .sort((a, b) => a.epoch - b.epoch);
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

export default function NativeMarketChart({
  candles,
  latest,
  autoScale = true,
  timeframe,
  timeframeOptions,
  onTimeframeChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const initializedRef = useRef(false);
  const firstDataRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    const surface = host?.parentElement;
    if (!host || !surface) return;

    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { color: '#090d12' }, textColor: '#9aa5b1', attributionLogo: false },
      grid: { vertLines: { color: '#151b23' }, horzLines: { color: '#151b23' } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#66717f', width: 1, style: 3, labelBackgroundColor: '#202833' },
        horzLine: { color: '#66717f', width: 1, style: 3, labelBackgroundColor: '#202833' },
      },
      rightPriceScale: { visible: true, borderVisible: true, borderColor: '#29313c', textColor: '#b5bec9', ticksVisible: true, minimumWidth: 76, autoScale },
      timeScale: { visible: true, borderVisible: true, timeVisible: true, secondsVisible: true, rightOffset: 6, barSpacing: 8, minBarSpacing: 2 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: true, mouseWheel: true, pinch: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceLineVisible: true,
      lastValueVisible: true,
      priceLineWidth: 1,
    });

    const drawingController = attachSireTradingViewDrawingController(chart, series, surface);
    chartRef.current = chart;
    seriesRef.current = series;
    initializedRef.current = true;

    return () => {
      drawingController.destroy();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      initializedRef.current = false;
      firstDataRef.current = false;
    };
  }, [autoScale]);

  useEffect(() => {
    if (!initializedRef.current || !seriesRef.current) return;
    const data = toSeriesData(candles);
    seriesRef.current.setData(data);
    if (!firstDataRef.current && data.length) {
      chartRef.current?.timeScale().fitContent();
      firstDataRef.current = true;
    }
  }, [candles]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !latest || !candles.length) return;
    const last = candles[candles.length - 1];
    const candleTime = Math.floor(last.epoch);
    if (Math.floor(latest.epoch) < candleTime) return;
    series.update({
      time: candleTime as UTCTimestamp,
      open: last.open,
      high: Math.max(last.high, latest.quote),
      low: Math.min(last.low, latest.quote),
      close: latest.quote,
    });
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
    if (!bar || !viewport || !track || !currentLabel || !previousLabel || !nextLabel || !timeframeViewport || !timeframeTrack || !timeframeCurrent || !timeframePrevious || !timeframeNext) return;

    let startY = 0;
    let startX = 0;
    let dragOffset = 0;
    let tracking = false;
    let raf = 0;
    let longPressTimer = 0;
    let longPressTriggered = false;
    let instruments: InstrumentPreview[] = [];
    let activeIndex = -1;

    const setTrack = (element: HTMLElement, offset: number, animated = false) => {
      element.style.transition = animated ? 'transform 180ms cubic-bezier(.22,.8,.24,1)' : 'none';
      element.style.transform = `translate3d(0, calc(-48px + ${offset}px), 0)`;
    };

    const renderInstrumentPreview = () => {
      const current = instruments[activeIndex];
      const previous = activeIndex > 0 ? instruments[activeIndex - 1] : null;
      const next = activeIndex >= 0 && activeIndex < instruments.length - 1 ? instruments[activeIndex + 1] : null;
      currentLabel.textContent = current?.name || 'Select instrument';
      previousLabel.textContent = previous?.name || '';
      nextLabel.textContent = next?.name || '';
      previousLabel.style.opacity = previous ? '1' : '0';
      nextLabel.style.opacity = next ? '1' : '0';
      setTrack(track, 0);
    };

    const openPicker = () => document.querySelector<HTMLButtonElement>('.native-instrument-picker')?.click();

    const closePickerSilently = () => {
      document.querySelector<HTMLButtonElement>('.native-instrument-sheet .sheet-head button')?.click();
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
          const parsed = rows.map(row => ({
            name: row.querySelector('b')?.textContent?.trim() || '',
            symbol: row.querySelector('small')?.textContent?.trim() || '',
          })).filter(item => item.name);
          const active = rows.findIndex(row => row.classList.contains('active'));
          if (parsed.length) {
            instruments = parsed;
            if (active >= 0) activeIndex = active;
            if (!selectOffset) renderInstrumentPreview();
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

    const updateInstrumentFromTopBar = () => {
      const source = document.querySelector<HTMLElement>('.native-instrument-picker strong');
      if (source && instruments.length) {
        const index = instruments.findIndex(item => item.name === source.textContent?.trim());
        if (index >= 0 && index !== activeIndex) {
          activeIndex = index;
          renderInstrumentPreview();
        }
      }
    };

    const finishInstrumentSwipe = (direction: -1 | 1) => {
      if (activeIndex < 0 || (direction < 0 && activeIndex <= 0) || (direction > 0 && activeIndex >= instruments.length - 1)) {
        setTrack(track, 0, true);
        return;
      }
      const target = activeIndex + direction;
      setTrack(track, direction < 0 ? -48 : 48, true);
      window.setTimeout(() => {
        void readPicker(direction).then(success => {
          if (!success) {
            setTrack(track, 0, true);
            return;
          }
          activeIndex = target;
          window.setTimeout(() => renderInstrumentPreview(), 115);
        });
      }, 35);
    };

    const cancelLongPress = () => {
      if (longPressTimer) window.clearTimeout(longPressTimer);
      longPressTimer = 0;
    };

    const onInstrumentDown = (event: PointerEvent) => {
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
        setTrack(track, 0, true);
        bar.classList.remove('instrument-swiping');
        openPicker();
      }, 600);
    };

    const onInstrumentMove = (event: PointerEvent) => {
      if (!tracking) return;
      const dy = event.clientY - startY;
      const dx = event.clientX - startX;
      if (Math.hypot(dx, dy) > 12) cancelLongPress();
      if (Math.abs(dy) < Math.abs(dx) * 1.05) return;
      dragOffset = Math.max(-44, Math.min(44, dy));
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTrack(track, dragOffset));
      event.preventDefault();
    };

    const onInstrumentUp = (event: PointerEvent) => {
      cancelLongPress();
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }
      if (!tracking) return;
      tracking = false;
      if (raf) cancelAnimationFrame(raf);
      const dy = event.clientY - startY;
      const dx = event.clientX - startX;
      const vertical = Math.abs(dy) >= Math.abs(dx) * 1.05;
      const threshold = Math.max(18, viewport.clientHeight * .42);
      if (!vertical || Math.abs(dy) < threshold) setTrack(track, 0, true);
      else finishInstrumentSwipe(dy < 0 ? 1 : -1);
      window.setTimeout(() => bar.classList.remove('instrument-swiping'), 210);
    };

    const currentTimeframeIndex = () => timeframeOptions.findIndex(option => option.value === timeframe);
    const renderTimeframePreview = () => {
      const index = currentTimeframeIndex();
      timeframeCurrent.textContent = timeframeOptions[index]?.label || '1m';
      timeframePrevious.textContent = index > 0 ? timeframeOptions[index - 1].label : '';
      timeframeNext.textContent = index >= 0 && index < timeframeOptions.length - 1 ? timeframeOptions[index + 1].label : '';
      timeframePrevious.style.opacity = index > 0 ? '1' : '0';
      timeframeNext.style.opacity = index >= 0 && index < timeframeOptions.length - 1 ? '1' : '0';
      setTrack(timeframeTrack, 0);
    };

    const selectTimeframeOffset = (direction: -1 | 1) => {
      const index = currentTimeframeIndex();
      const target = index + direction;
      if (index < 0 || target < 0 || target >= timeframeOptions.length) {
        setTrack(timeframeTrack, 0, true);
        return;
      }
      setTrack(timeframeTrack, direction < 0 ? -48 : 48, true);
      window.setTimeout(() => {
        onTimeframeChange(timeframeOptions[target].value);
        window.setTimeout(renderTimeframePreview, 80);
      }, 35);
    };

    const openTimeframeList = () => {
      document.querySelector('.native-bottom-timeframe-overlay')?.remove();
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
      timeframeOptions.forEach(option => {
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = option.label;
        item.className = option.value === timeframe ? 'active' : '';
        item.addEventListener('click', () => {
          onTimeframeChange(option.value);
          overlay.remove();
          window.setTimeout(renderTimeframePreview, 60);
        });
        list.appendChild(item);
      });
      sheet.appendChild(list);
      overlay.appendChild(sheet);
      document.body.appendChild(overlay);
      overlay.addEventListener('click', event => {
        if (event.target === overlay) overlay.remove();
      });
      head.querySelector('button')?.addEventListener('click', () => overlay.remove());
    };

    let timeframeStartY = 0;
    let timeframeStartX = 0;
    let timeframeTracking = false;
    let timeframeRaf = 0;
    let timeframeHoldTimer = 0;
    let timeframeHoldTriggered = false;

    const cancelTimeframeHold = () => {
      if (timeframeHoldTimer) window.clearTimeout(timeframeHoldTimer);
      timeframeHoldTimer = 0;
    };

    const onTimeframeDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      timeframeStartX = event.clientX;
      timeframeStartY = event.clientY;
      timeframeTracking = true;
      timeframeHoldTriggered = false;
      cancelTimeframeHold();
      timeframeViewport.setPointerCapture?.(event.pointerId);
      bar.classList.add('timeframe-swiping');
      timeframeHoldTimer = window.setTimeout(() => {
        if (!timeframeTracking) return;
        timeframeHoldTriggered = true;
        timeframeTracking = false;
        if (timeframeRaf) cancelAnimationFrame(timeframeRaf);
        setTrack(timeframeTrack, 0, true);
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
      if (timeframeRaf) cancelAnimationFrame(timeframeRaf);
      const offset = Math.max(-44, Math.min(44, dy));
      timeframeRaf = requestAnimationFrame(() => setTrack(timeframeTrack, offset));
      event.preventDefault();
    };

    const onTimeframeUp = (event: PointerEvent) => {
      cancelTimeframeHold();
      if (timeframeHoldTriggered) {
        timeframeHoldTriggered = false;
        return;
      }
      if (!timeframeTracking) return;
      timeframeTracking = false;
      if (timeframeRaf) cancelAnimationFrame(timeframeRaf);
      const dy = event.clientY - timeframeStartY;
      const dx = event.clientX - timeframeStartX;
      const vertical = Math.abs(dy) >= Math.abs(dx) * 1.05;
      const threshold = Math.max(18, timeframeViewport.clientHeight * .42);
      if (!vertical || Math.abs(dy) < threshold) setTrack(timeframeTrack, 0, true);
      else selectTimeframeOffset(dy < 0 ? 1 : -1);
      window.setTimeout(() => bar.classList.remove('timeframe-swiping'), 210);
    };

    renderTimeframePreview();
    void readPicker();

    viewport.addEventListener('pointerdown', onInstrumentDown, { passive: false });
    viewport.addEventListener('pointermove', onInstrumentMove, { passive: false });
    viewport.addEventListener('pointerup', onInstrumentUp, { passive: false });
    viewport.addEventListener('pointercancel', onInstrumentUp, { passive: false });
    timeframeViewport.addEventListener('pointerdown', onTimeframeDown, { passive: false });
    timeframeViewport.addEventListener('pointermove', onTimeframeMove, { passive: false });
    timeframeViewport.addEventListener('pointerup', onTimeframeUp, { passive: false });
    timeframeViewport.addEventListener('pointercancel', onTimeframeUp, { passive: false });

    const observer = new MutationObserver(() => updateInstrumentFromTopBar());
    const pickerText = document.querySelector('.native-instrument-picker strong');
    if (pickerText) observer.observe(pickerText, { childList: true, characterData: true, subtree: true });
    updateInstrumentFromTopBar();

    return () => {
      cancelLongPress();
      cancelTimeframeHold();
      if (raf) cancelAnimationFrame(raf);
      if (timeframeRaf) cancelAnimationFrame(timeframeRaf);
      viewport.removeEventListener('pointerdown', onInstrumentDown);
      viewport.removeEventListener('pointermove', onInstrumentMove);
      viewport.removeEventListener('pointerup', onInstrumentUp);
      viewport.removeEventListener('pointercancel', onInstrumentUp);
      timeframeViewport.removeEventListener('pointerdown', onTimeframeDown);
      timeframeViewport.removeEventListener('pointermove', onTimeframeMove);
      timeframeViewport.removeEventListener('pointerup', onTimeframeUp);
      timeframeViewport.removeEventListener('pointercancel', onTimeframeUp);
      observer.disconnect();
      document.querySelector('.native-bottom-timeframe-overlay')?.remove();
      document.body.classList.remove('sire-swipe-probing');
    };
  }, [timeframe, timeframeOptions, onTimeframeChange]);

  const timeframeLabels = useMemo(() => timeframeOptions.map(option => option.label).join(','), [timeframeOptions]);

  return (
    <div className="native-chart-touch-surface" data-timeframe-options={timeframeLabels}>
      <div ref={hostRef} className="sire-native-chart" aria-label="TradingView Lightweight Charts market chart" />
      <div className="native-bottom-glass-bar">
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
        <button type="button" className="sire-drawing-toggle" data-sire-drawing-toggle aria-label="Drawing tools" aria-expanded="false">✎</button>
        <div className="sire-drawing-palette" data-sire-drawing-palette hidden>
          <div className="sire-drawing-palette-tools">
            <button type="button" data-sire-drawing-tool="trend">Trend</button>
            <button type="button" data-sire-drawing-tool="horizontal">H-Line</button>
            <button type="button" data-sire-drawing-tool="ray">Ray</button>
            <button type="button" data-sire-drawing-tool="rectangle">Box</button>
          </div>
          <div className="sire-drawing-palette-actions">
            <span data-sire-drawing-status />
            <button type="button" data-sire-drawing-undo>Undo</button>
            <button type="button" data-sire-drawing-clear>Clear</button>
          </div>
        </div>
      </div>
    </div>
  );
}
