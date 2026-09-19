import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, History, Lock, Minus, MoreHorizontal, Pause, Play, RotateCcw, Settings2, SkipBack, SkipForward, Trash2, Wrench, X } from 'lucide-react';
import { registerInterval } from 'openalgo-charts';
import 'openalgo-charts/indicators';
import 'openalgo-charts/draw';
import { computeMarketProfile, MarketProfile } from 'openalgo-charts/profile';
import 'openalgo-charts/trade';
import 'openalgo-charts/transform';
import 'openalgo-charts/webgl';
import { createWidget, type Widget } from 'openalgo-charts/widget';
import './financialChart.css';

type Instrument = { symbol: string; name: string; pipSize?: number };
type Props = { symbol: string; isActive?: boolean; instruments: Instrument[]; onSelectInstrument: (instrument: Instrument) => void; onWidgetReady?: (widget: Widget) => void; onWidgetDestroyed?: (widget: Widget) => void; onInstrumentTap?: () => void };
const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60, '2m': 120, '3m': 180, '5m': 300, '10m': 600, '15m': 900, '20m': 1200,
  '30m': 1800, '45m': 2700, '1h': 3600, '2h': 7200, '3h': 10800, '4h': 14400,
  '6h': 21600, '8h': 28800, '12h': 43200, '1d': 86400, '1w': 604800,
};
const DERIV_INTERVALS = Object.keys(INTERVAL_SECONDS);
for (const [code, seconds] of Object.entries(INTERVAL_SECONDS)) {
  if (!['1m', '5m', '15m', '1h', '1d', '1w'].includes(code)) {
    registerInterval({ code, bucketing: { mode: 'interval', seconds } });
  }
}

const CHART_TYPES = [
  { id: 'candlestick', label: 'Candles' },
  { id: 'hollow-candle', label: 'Hollow Candles' },
  { id: 'volume-candle', label: 'Volume Candles' },
  { id: 'bar', label: 'Bars (OHLC)' },
  { id: 'high-low', label: 'High-Low' },
  { id: 'line', label: 'Line' },
  { id: 'line-markers', label: 'Line + Markers' },
  { id: 'step', label: 'Step Line' },
  { id: 'area', label: 'Area' },
  { id: 'hlc-area', label: 'HLC Area' },
  { id: 'baseline', label: 'Baseline' },
  { id: 'columns', label: 'Columns' },
  { id: 'histogram', label: 'Histogram' },
] as const;

const REPLAY_SPEEDS = [0.5, 1, 2, 5, 10] as const;
const replaySpeedLabel = (speed: number) => `${speed}×`;
const formatReplayInput = (_epoch: number) => '';
const parseReplayInput = (_value: string) => NaN;

export default function FinancialChart({ symbol, isActive = false, instruments, onSelectInstrument, onWidgetReady, onWidgetDestroyed, onInstrumentTap }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawRackOpen, setDrawRackOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [compareQuery, setCompareQuery] = useState('');
  const [comparisons, setComparisons] = useState<string[]>([]);
  const [replayActive, setReplayActive] = useState(false);
  const [replayState, setReplayState] = useState<any>(null);
  const [replaySetupOpen, setReplaySetupOpen] = useState(false);
  const [replayStartInput, setReplayStartInput] = useState('');
  const [replayEndInput, setReplayEndInput] = useState('');
  const [replayRangeError, setReplayRangeError] = useState<string | null>(null);
  const [replayDraftSpeed, setReplayDraftSpeed] = useState(1);
  const replaySpeedRef = useRef(1);
  const widgetRef = useRef<Widget | null>(null);
  const instrumentsRef = useRef(instruments);
  const onSelectInstrumentRef = useRef(onSelectInstrument);
  const symbolRef = useRef(symbol);
  const tpoEnabledRef = useRef(false);
  const tpoProfileRef = useRef<MarketProfile | null>(null);
  const tpoUnregisterRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const nextIndex = instruments.findIndex(item => item.symbol === symbol);
    if (nextIndex >= 0) setSwipeInstrumentIndex(nextIndex);
  }, [instruments, symbol]);
  const marketInstrument = instruments.find(item => item.symbol === symbol);
  const marketInstrumentName = marketInstrument?.name || symbol;
  const marketPriceDecimals = 2;
  const marketQuote = null;
  const formatMarketPrice = (_price: number) => '—';
  const compactInstrumentName = (name: string) => {
    const first = name.trim().split(/\s+/)[0] || symbol;
    return `${first.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 5)}_`;
  };
  const swipeInstrument = (direction: 1 | -1) => {
    if (!instruments.length) return;
    const currentIndex = Math.max(0, instruments.findIndex(item => item.symbol === symbol));
    const nextIndex = Math.max(0, Math.min(instruments.length - 1, currentIndex + direction));
    const next = instruments[nextIndex];
    if (next && next.symbol !== symbol) onSelectInstrument(next);
  };
  const triggerSwipeStep = (direction: 1 | -1) => {
    if (!instruments.length) return;
    const currentIndex = Math.max(0, instruments.findIndex(item => item.symbol === symbol));
    const nextIndex = Math.max(0, Math.min(instruments.length - 1, currentIndex + direction));
    if (nextIndex === currentIndex) return;
    setSwipeAnimation(direction > 0 ? 'up' : 'down');
    swipeInstrument(direction);
    window.setTimeout(() => setSwipeAnimation(null), 320);
  };
  const clearTimeframeHold = () => {
    if (timeframeHoldTimerRef.current !== null) {
      window.clearTimeout(timeframeHoldTimerRef.current);
      timeframeHoldTimerRef.current = null;
    }
  };
  const handleTimeframePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    timeframeSwipeStartYRef.current = event.clientY;
    timeframeSwipeAccumulatedRef.current = 0;
    timeframeHoldTriggeredRef.current = false;
    clearTimeframeHold();
    timeframeHoldTimerRef.current = window.setTimeout(() => {
      timeframeHoldTriggeredRef.current = true;
      setTimeframeOpen(true);    }, 600);
  };
  const handleTimeframePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (timeframeHoldTriggeredRef.current) return;
    const delta = event.clientY - timeframeSwipeStartYRef.current;
    if (Math.abs(delta) >= 8) clearTimeframeHold();
    if (Math.abs(delta) < 45 || timeframeSwipeAnimatingRef.current) return;

    const direction: 1 | -1 = delta < 0 ? 1 : -1;
    const currentIndex = DERIV_INTERVALS.indexOf(activeTimeframe);
    const nextIndex = Math.max(0, Math.min(DERIV_INTERVALS.length - 1, currentIndex + direction));
    if (nextIndex !== currentIndex) {
      timeframeSwipeAnimatingRef.current = true;
      selectTimeframe(DERIV_INTERVALS[nextIndex]);
      window.setTimeout(() => { timeframeSwipeAnimatingRef.current = false; }, 280);
    }
    timeframeSwipeStartYRef.current = event.clientY;
    timeframeSwipeAccumulatedRef.current = 0;
  };
  const handleTimeframePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    clearTimeframeHold();
    timeframeHoldTriggeredRef.current = false;
    timeframeSwipeStartYRef.current = 0;
    timeframeSwipeAccumulatedRef.current = 0;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };
  const selectTimeframe = (interval: string) => {
    if (replayRef.current) stopReplay();
    const widget = widgetRef.current;
    if (!widget) return;
    setActiveTimeframe(interval);
    setTimeframeOpen(false);
    widget.setInterval(interval);
  };

  const clearInstrumentHold = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };
  const handleInstrumentPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    swipeStartYRef.current = event.clientY;
    swipeAccumulatedRef.current = 0;
    holdTriggeredRef.current = false;
    clearInstrumentHold();
    holdTimerRef.current = window.setTimeout(() => {
      if (swipeStartYRef.current !== null) {
        holdTriggeredRef.current = true;
        onInstrumentTap?.();
      }
    }, 600);
  };
  const handleInstrumentPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStartYRef.current;
    if (start === null) return;
    const delta = event.clientY - start;
    if (Math.abs(delta) >= 18 && !holdTriggeredRef.current) clearInstrumentHold();
    if (Math.abs(delta) < 55 || swipeAnimatingRef.current || holdTriggeredRef.current) return;
    const direction: 1 | -1 = delta < 0 ? 1 : -1;
    triggerSwipeStep(direction);
    swipeAnimatingRef.current = true;
    swipeStartYRef.current = event.clientY;
    swipeAccumulatedRef.current = 0;
    window.setTimeout(() => { swipeAnimatingRef.current = false; }, 320);
  };
  const handleInstrumentPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    clearInstrumentHold();
    swipeStartYRef.current = null;
    swipeAccumulatedRef.current = 0;
    holdTriggeredRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  useEffect(() => {
    if (!drawRackOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawRackOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [drawRackOpen]);

  useEffect(() => {
    if (!containerRef.current) return;
    const host = containerRef.current;
    const sourceFeed = {
      async getBars() {
        return [];
      },
      subscribeBars() {
        return () => {
      offSymbol?.();
      offInterval?.();
      offRenderer?.();
      offDrawingObjects?.();
      offIndicatorObjects?.();
      offDrawingSelect?.();
      window.removeEventListener('resize', onResize);
      host.removeEventListener('pointerdown', onDrawingInteraction, true);
      host.removeEventListener('pointerdown', onIndicatorInteraction, true);
      tpoUnregisterRef.current?.();
      tpoUnregisterRef.current = null;
      tpoProfileRef.current = null;
      onWidgetDestroyed?.(widget);
      widget.destroy();
      widgetRef.current = null;
    };
    } catch (error) {
      host.textContent = `OpenAlgo widget failed to initialize: ${error instanceof Error ? error.message : String(error)}`;
      host.style.padding = '24px';
      host.style.boxSizing = 'border-box';
      host.style.color = '#ff8080';
      host.style.background = '#080808';
      host.style.fontFamily = 'monospace';
      host.style.fontSize = '14px';
      throw error;
    }
  }, []);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const positionRail = () => {
      const rail = host.querySelector<HTMLElement>('.oac-rail');
      if (!rail) return;
      rail.classList.toggle('sire-oac-rail--closed', !drawRackOpen);
      rail.setAttribute('aria-hidden', String(!drawRackOpen));

      if (!drawRackOpen) {
        rail.style.removeProperty('--sire-rail-top');
        return;
      }

      const quote = host.querySelector<HTMLElement>('.sire-market-quote');
      const hostRect = host.getBoundingClientRect();
      const quoteRect = quote?.getBoundingClientRect();
      const quoteBottom = quoteRect ? quoteRect.bottom - hostRect.top : 0;

      // OpenAlgo indicator legends are canvas-rendered, so measure their row
      // count from the chart objects rather than looking for DOM elements.
      const widget = widgetRef.current;
      const mainPaneIndicators = widget?.objects.list?.().filter(
        (item: any) => item?.kind === 'indicator' && Number(item?.paneIndex) === 0 && item?.visible !== false
      ) ?? [];
      const indicatorLegendBottom = mainPaneIndicators.length
        ? 6 + mainPaneIndicators.length * 24 + 4
        : 0;

      // Keep the drawing rail below the SIRE quote and any main-pane legend
      // rows, with a small breathing gap so nothing is covered.
      const top = Math.ceil(Math.max(quoteBottom + 8, indicatorLegendBottom));
      rail.style.setProperty('--sire-rail-top', `${Math.max(0, top)}px`);
    };

    positionRail();
    const observer = new MutationObserver(() => window.requestAnimationFrame(positionRail));
    observer.observe(host, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(positionRail);
    resizeObserver.observe(host);
    const onResize = () => positionRail();
    window.addEventListener('resize', onResize);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      const rail = host.querySelector<HTMLElement>('.oac-rail');
      rail?.style.removeProperty('--sire-rail-top');
    };
  }, [drawRackOpen, symbol, marketQuote, instruments]);

  useEffect(() => {
    const widget = widgetRef.current;
    if (widget && widget.symbol() !== symbol) widget.setSymbol(symbol, 'Deriv Synthetic Indices');
  }, [symbol]);

  const stopReplay = () => {
    setReplayActive(false);
    setReplayState(null);
    setReplaySetupOpen(false);
  };
  const toggleReplay = () => setReplaySetupOpen(open => !open);
  const replayStep = () => {};
  const replayStepBack = () => {};
  const replayJumpStart = () => {};
  const replayJumpEnd = () => {};
  const replaySeek = (_index: number) => {};
  const setReplaySpeed = (speed: number) => { replaySpeedRef.current = speed; setReplayDraftSpeed(speed); };
  const startReplayFromInputs = (_fromBeginning: boolean, _toLatest: boolean) => setReplayRangeError('No chart data source is connected.');

  const exportChartSvg = () => { const widget = widgetRef.current; if (!widget) return; const svg = widget.chart.exportSVG({ background: true }); const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `sire-${widget.symbol()}-${widget.interval()}.svg`; anchor.click(); URL.revokeObjectURL(url); };
  const addCompare = async (_compareSymbol: string) => {};
  const removeCompare = (_compareSymbol: string) => {
    setComparisons(current => current.filter(item => item !== _compareSymbol));
  };

  const refreshTpoProfile = () => {};
  const toggleTpo = () => setTpoEnabled(value => !value);

  const selectChartType = (chartType: string) => {
    const widget = widgetRef.current;
    if (!widget) return;
    try {
      widget.setChartType(chartType);
    } catch {
      return;
    }
    setMoreMenuOpen(false);
  };

  const captureChartPng = () => {
    const widget = widgetRef.current;
    if (!widget) return;
    widget.chart.downloadScreenshot(`sire-${symbol}-${widget.interval() || 'chart'}.png`);
    setMoreMenuOpen(false);
  };

  const exportChartSvgFromMenu = () => {
    exportChartSvg();
    setMoreMenuOpen(false);
  };



  return (
    <div ref={containerRef} className={`sire-financial-chart${drawRackOpen ? ' sire-draw-rack-open' : ''}${isActive ? ' sire-toolbar-owner' : ''}`}>
      <div className="sire-market-quote" aria-label={`Selected ${marketInstrumentName}`}>
        <strong className="sire-market-quote__name">{marketInstrumentName}</strong>
        <div className="sire-market-quote__value-row">
          <span className="sire-market-quote__price">{marketQuote ? formatMarketPrice(marketQuote.price) : '—'}</span>
          <span className={`sire-market-quote__change ${marketQuote && marketQuote.percent > 0 ? 'is-positive' : marketQuote && marketQuote.percent < 0 ? 'is-negative' : 'is-neutral'}`}>
            {marketQuote ? `${marketQuote.percent >= 0 ? '+' : ''}${marketQuote.percent.toFixed(2)}%` : '—'}
          </span>
        </div>
      </div>
      <button type="button" className="sire-chart-settings-button" aria-label="Chart settings" title="Chart settings" onClick={() => widgetRef.current?.openSettings()}><MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" /></button>
      {replayActive && replayState && (
        <div className="sire-replay-transport" role="dialog" aria-label="Chart replay controls">
          <div className="sire-replay-head">
            <span className="sire-replay-badge"><History size={13} strokeWidth={2.1} aria-hidden="true" /> REPLAY</span>
            <span className="sire-replay-clock">{replayState.bar ? new Date(replayState.bar.time * 1000 + 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ') : ''}</span>
            <span className="sire-replay-count">{replayState.index + 1}/{replayState.total}{replayState.subSteps > 1 ? ` · ${replayState.subIndex + 1}/${replayState.subSteps}` : ''}</span>
          </div>
          <div className="sire-replay-progress-row">
            <button type="button" onClick={replayJumpStart} aria-label="Jump to replay start" title="Start"><SkipBack size={15} /></button>
            <input type="range" min="0" max={Math.max(0, replayState.total - 1)} step="1" value={Math.min(replayState.index, Math.max(0, replayState.total - 1))} onChange={event => replaySeek(Number(event.target.value))} aria-label="Replay position" title="Scrub replay" />
            <button type="button" onClick={replayJumpEnd} aria-label="Jump to replay end" title="End"><SkipForward size={15} /></button>
          </div>
          <div className="sire-replay-transport-row">
            <button type="button" onClick={replayStepBack} aria-label="Previous replay bar" title="Previous"><ChevronLeft size={17} /></button>
            <button type="button" className="sire-replay-play" onClick={toggleReplay} aria-label={replayState.playing ? 'Pause replay' : 'Play replay'} title={replayState.playing ? 'Pause' : 'Play'}>{replayState.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
            <button type="button" onClick={replayStep} aria-label="Next replay bar" title="Next"><ChevronRight size={17} /></button>
            <button type="button" onClick={stopReplay} aria-label="Exit replay" title="Exit replay"><X size={17} /></button>
            <button type="button" onClick={() => replaySeek(Math.max(0, replayState.index - 10))} aria-label="Back ten bars" title="Back 10 bars"><RotateCcw size={15} /></button>
          </div>
          <div className="sire-replay-speed-row">
            {REPLAY_SPEEDS.map(speed => (
              <button key={speed} type="button" className={replaySpeedRef.current === speed ? 'active' : ''} onClick={() => setReplaySpeed(speed)} title={`Speed ${replaySpeedLabel(speed)}`}>{replaySpeedLabel(speed)}</button>
            ))}
          </div>
        </div>
      )}
      {replaySetupOpen && !replayActive && (
        <div className="sire-replay-setup" role="dialog" aria-label="Set replay range">
          <div className="sire-replay-setup-row">
            <input aria-label="Replay start date and time" type="datetime-local" value={replayStartInput} onChange={event => setReplayStartInput(event.target.value)} title="Start" />
            <span aria-hidden="true">↔</span>
            <input aria-label="Replay stop date and time" type="datetime-local" value={replayEndInput} onChange={event => setReplayEndInput(event.target.value)} title="Stop" />
          </div>
          <div className="sire-replay-quick-row">
            <button type="button" onClick={() => startReplayFromInputs(true, true)} aria-label="Replay from beginning to latest" title="Beginning to latest">⏮▶</button>
            <button type="button" onClick={() => startReplayFromInputs(false, true)} aria-label="Replay selected start to latest" title="Start to latest">▶⏭</button>
            <button type="button" onClick={() => startReplayFromInputs(false, false)} aria-label="Replay selected range" title="Start to stop">↔▶</button>
            <button type="button" onClick={() => setReplaySetupOpen(false)} aria-label="Close replay setup" title="Close">×</button>
          </div>
          {replayRangeError && <div className="sire-replay-error">{replayRangeError}</div>}
          <div className="sire-replay-speed-row">
            {REPLAY_SPEEDS.map(speed => (
              <button key={speed} type="button" className={replayDraftSpeed === speed ? 'active' : ''} onClick={() => { setReplayDraftSpeed(speed); setReplaySpeed(speed); }} title={`Speed ${replaySpeedLabel(speed)}`}>{replaySpeedLabel(speed)}</button>
            ))}
          </div>
        </div>
      )}
      {selectedIndicator && (
        <div
          className="sire-indicator-selection-bar"
          role="toolbar"
          aria-label={`Selected indicator: ${selectedIndicator.name}`}
          style={selectedIndicatorPosition ? { left: selectedIndicatorPosition.left, top: selectedIndicatorPosition.top } : undefined}
          onPointerDown={event => event.stopPropagation()}
        >
          <button
            type="button"
            className="sire-indicator-selection-button"
            aria-label="Indicator settings"
            title="Indicator settings"
            onClick={() => widgetRef.current?.objects.openSettings(selectedIndicator.id)}
          >
            <Settings2 size={15} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sire-indicator-selection-button sire-indicator-selection-obj"
            aria-label="Open objects"
            title="Objects"
            onClick={() => widgetRef.current?.openObjects()}
          >
            <span aria-hidden="true">OBJ</span>
          </button>
          <button
            type="button"
            className="sire-indicator-selection-button sire-indicator-selection-delete"
            aria-label="Delete indicator"
            title="Delete indicator"
            onClick={() => {
              const widget = widgetRef.current;
              if (!widget) return;
              widget.objects.remove(selectedIndicator.id);
              selectedIndicatorRef.current = null;
              setSelectedIndicator(null);
              setSelectedIndicatorPosition(null);
            }}
          >
            <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
      {selectedDrawing && (
        <div
          className="sire-drawing-selection-bar"
          role="toolbar"
          aria-label={`Selected drawing: ${selectedDrawing.name}`}
          style={selectedDrawingPosition ? { left: selectedDrawingPosition.left, top: selectedDrawingPosition.top } : undefined}
        >
          <button
            type="button"
            className="sire-drawing-selection-button"
            aria-label={selectedDrawing.visible ? 'Hide drawing' : 'Show drawing'}
            title={selectedDrawing.visible ? 'Hide drawing' : 'Show drawing'}
            onClick={() => {
              const widget = widgetRef.current;
              if (!widget) return;
              widget.objects.setVisible(selectedDrawing.id, !selectedDrawing.visible);
            }}
          >
            <Eye size={16} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`sire-drawing-selection-button sire-drawing-selection-lock${selectedDrawing.locked ? ' is-locked' : ''}`}
            aria-label={selectedDrawing.locked ? 'Unlock drawing' : 'Lock drawing'}
            title={selectedDrawing.locked ? 'Unlock drawing' : 'Lock drawing'}
            onClick={() => {
              const widget = widgetRef.current;
              if (!widget) return;
              widget.objects.setLocked(selectedDrawing.id, !selectedDrawing.locked);
            }}
          >
            <Lock size={16} strokeWidth={1.9} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sire-drawing-selection-button"
            aria-label="Drawing settings"
            title="Drawing settings"
            onClick={() => widgetRef.current?.objects.openSettings(selectedDrawing.id)}
          >
            <MoreHorizontal size={19} strokeWidth={2.1} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sire-drawing-selection-button"
            aria-label="Focus drawing"
            title="Focus drawing"
            onClick={() => widgetRef.current?.objects.focus(selectedDrawing.id)}
          >
            <span className="sire-drawing-focus-glyph" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sire-drawing-selection-button sire-drawing-selection-delete"
            aria-label="Delete drawing"
            title="Delete drawing"
            onClick={() => {
              const widget = widgetRef.current;
              if (!widget) return;
              widget.objects.remove(selectedDrawing.id);
            }}
          >
            <Minus size={17} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="sire-bottom-glass-bar">
        <div className="sire-bottom-scroll-track">
        <div
          onPointerDown={handleInstrumentPointerDown}
          onPointerMove={handleInstrumentPointerMove}
          onPointerUp={handleInstrumentPointerEnd}
          onPointerCancel={handleInstrumentPointerEnd}
          onContextMenu={event => event.preventDefault()}
          className={`sire-bottom-instrument-swipe${swipeAnimation ? ` is-swiping-${swipeAnimation}` : ''}`}
          title="Swipe up or down to change instrument"
        >
          <span className="sire-bottom-instrument-prev">{compactInstrumentName(instruments[Math.max(0, swipeInstrumentIndex - 1)]?.name || '')}</span>
          <strong>{compactInstrumentName(instruments[swipeInstrumentIndex]?.name || symbol)}</strong>
          <span className="sire-bottom-instrument-next">{compactInstrumentName(instruments[Math.min(instruments.length - 1, swipeInstrumentIndex + 1)]?.name || '')}</span>
        </div>
        <div
          className="sire-bottom-timeframe"
          onPointerDown={handleTimeframePointerDown}
          onPointerMove={handleTimeframePointerMove}
          onPointerUp={handleTimeframePointerEnd}
          onPointerCancel={handleTimeframePointerEnd}
          onContextMenu={event => event.preventDefault()}
          title="Tap and hold to choose timeframe"
        >
          <strong>{activeTimeframe}</strong>
        </div>
        <button
          type="button"
          className="sire-bottom-indicator-button"
          aria-label="Open indicators"
          title="Indicators"
          onClick={() => widgetRef.current?.openIndicatorPicker()}
        >
          <span className="sire-bottom-indicator-icon" aria-hidden="true">ƒ</span>
        </button>
        <button
          type="button"
          className="sire-bottom-replay-button"
          aria-label={replayActive ? (replayState?.playing ? 'Pause replay' : 'Play replay') : 'Open replay'}
          title={replayActive ? (replayState?.playing ? 'Pause replay' : 'Play replay') : 'Replay'}
          onClick={toggleReplay}
        >
          <span aria-hidden="true">{replayActive ? (replayState?.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />) : <History size={20} />}</span>
        </button>
        <button
          type="button"
          className="sire-bottom-tools-button"
          aria-label={drawRackOpen ? 'Close OpenAlgo drawing tools' : 'Open OpenAlgo drawing tools'}
          aria-expanded={drawRackOpen}
          title={drawRackOpen ? 'Close OpenAlgo tools' : 'OpenAlgo drawing tools'}
          onClick={() => setDrawRackOpen(open => !open)}
        >
          <Wrench size={22} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sire-bottom-multichart-button"
          aria-label="Open multi-chart manager"
          title="Multi-chart"
          onClick={() => window.dispatchEvent(new CustomEvent('sire:open-multichart'))}
        >
          <span className="sire-bottom-multichart-icon" aria-hidden="true"><span /><span /><span /></span>
        </button>
        <button
          type="button"
          className="sire-bottom-more-button"
          aria-label="Open chart menu"
          aria-expanded={moreMenuOpen}
          aria-haspopup="menu"
          title="More chart options"
          onClick={() => setMoreMenuOpen(open => !open)}
        >
          <MoreHorizontal size={23} strokeWidth={2} aria-hidden="true" />
        </button>
        {moreMenuOpen && (
          <div className="sire-bottom-more-menu" role="menu" aria-label="Chart options">
            <div className="sire-bottom-more-menu__section">
              <div className="sire-bottom-more-menu__title">Chart type</div>
              <div className="sire-bottom-more-menu__chart-types">
                {CHART_TYPES.map(chartType => (
                  <button
                    key={chartType.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={widgetRef.current?.chartType?.() === chartType.id}
                    className={widgetRef.current?.chartType?.() === chartType.id ? 'active' : ''}
                    onClick={() => selectChartType(chartType.id)}
                  >
                    {chartType.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sire-bottom-more-menu__section sire-bottom-more-menu__actions">
              <button type="button" role="menuitem" onClick={toggleTpo}>
                {tpoEnabled ? 'Hide Market Profile' : 'Market Profile'}
              </button>
              <button type="button" role="menuitem" onClick={captureChartPng}>Capture PNG</button>
              <button type="button" role="menuitem" onClick={exportChartSvgFromMenu}>Export SVG</button>
            </div>
          </div>
        )}
                <button
          type="button"
          className="sire-bottom-obj-button"
          aria-label="Open objects"
          title="Objects"
          onClick={() => widgetRef.current?.openObjects()}
        >
          <span aria-hidden="true">OBJ</span>
        </button>
        {timeframeOpen && (
          <div className="sire-bottom-timeframe-menu">
            {DERIV_INTERVALS.map(interval => (
              <button
                key={interval}
                type="button"
                className={interval === activeTimeframe ? 'active' : ''}
                onClick={() => selectTimeframe(interval)}
              >
                {interval}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}