import { useEffect, useMemo, useRef, useState } from 'react';
import { FastFinancialChart } from '@pairlens/fast-financial-charts/react';
import type {
  ChartSeriesInput,
  DrawingToolType,
  FastFinancialChartRef,
  IndicatorInstanceInput,
  Timeframe,
} from '@pairlens/fast-financial-charts/types';

type Candle = { epoch: number; open: number; high: number; low: number; close: number; volume?: number };
type TimeframeOption = { value: Timeframe; label: string };
type Props = {
  candles: Candle[];
  latest?: { epoch: number; quote: number; bid?: number; ask?: number } | null;
  autoScale?: boolean;
  timeframe: Timeframe;
  timeframeOptions: readonly TimeframeOption[];
  onTimeframeChange: (value: Timeframe) => void;
};

const DRAWING_TOOLS: Array<{ type: DrawingToolType; label: string }> = [
  { type: 'select', label: 'Select' }, { type: 'line', label: 'Trend' }, { type: 'ray', label: 'Ray' },
  { type: 'hline', label: 'H-Line' }, { type: 'vline', label: 'V-Line' }, { type: 'rectangle', label: 'Box' },
  { type: 'circle', label: 'Circle' }, { type: 'fibonacci', label: 'Fib' }, { type: 'channel', label: 'Channel' },
  { type: 'pitchfork', label: 'Pitchfork' }, { type: 'arrow', label: 'Arrow' }, { type: 'measure', label: 'Measure' },
  { type: 'long-position', label: 'Long' }, { type: 'short-position', label: 'Short' }, { type: 'text', label: 'Text' },
];

const INDICATOR_PRESETS: Array<{ type: string; label: string; params: Record<string, number>; pane: 'overlay' | 'separate' }> = [
  { type: 'EMA', label: 'EMA 20', params: { period: 20 }, pane: 'overlay' },
  { type: 'SMA', label: 'SMA 20', params: { period: 20 }, pane: 'overlay' },
  { type: 'BollingerBands', label: 'Bollinger', params: { period: 20, stdDev: 2 }, pane: 'overlay' },
  { type: 'VWAP', label: 'VWAP', params: {}, pane: 'overlay' },
  { type: 'SuperTrend', label: 'SuperTrend', params: { period: 10, multiplier: 3 }, pane: 'overlay' },
  { type: 'RSI', label: 'RSI 14', params: { period: 14 }, pane: 'separate' },
  { type: 'MACD', label: 'MACD', params: { fast: 12, slow: 26, signal: 9 }, pane: 'separate' },
  { type: 'Stochastic', label: 'Stochastic', params: { kPeriod: 14, dPeriod: 3, smooth: 3 }, pane: 'separate' },
  { type: 'ATR', label: 'ATR 14', params: { period: 14 }, pane: 'separate' },
  { type: 'ADX', label: 'ADX 14', params: { period: 14 }, pane: 'separate' },
];

function toBars(candles: Candle[]) {
  return candles
    .filter(candle => [candle.epoch, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
    .slice().sort((a, b) => a.epoch - b.epoch)
    .reduce<ChartSeriesInput['bars']>((bars, candle) => {
      const ts = Math.floor(candle.epoch * 1000);
      if (bars.length && bars[bars.length - 1].ts === ts) return bars;
      bars.push({ ts, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume ?? 0 });
      return bars;
    }, []);
}

export default function NativeMarketChart({ candles, latest, autoScale = true, timeframe, timeframeOptions, onTimeframeChange }: Props) {
  const chartRef = useRef<FastFinancialChartRef | null>(null);
  const [activeTool, setActiveTool] = useState<DrawingToolType | null>(null);
  const [drawingsOpen, setDrawingsOpen] = useState(false);
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [indicators, setIndicators] = useState<IndicatorInstanceInput[]>([]);
  const [timeframeOpen, setTimeframeOpen] = useState(false);
  const [instrumentLabel, setInstrumentLabel] = useState('Select instrument');

  const series = useMemo<ChartSeriesInput[]>(() => [{ id: 'SIRE', label: 'SIRE', bars: toBars(candles), pricePrecision: 8 }], [candles]);

  useEffect(() => {
    const update = () => setInstrumentLabel(document.querySelector('.native-instrument-picker strong')?.textContent?.trim() || 'Select instrument');
    update();
    const observer = new MutationObserver(update);
    const node = document.querySelector('.native-instrument-picker');
    if (node) observer.observe(node, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  const addIndicator = (preset: (typeof INDICATOR_PRESETS)[number]) => {
    setIndicators(current => [...current, { id: `${preset.type}-${Date.now()}`, type: preset.type, seriesId: 'SIRE', params: preset.params, pane: preset.pane }]);
    setIndicatorsOpen(false);
  };

  return (
    <div className="sire-native-chart" style={{ position: 'absolute', inset: 0 }}>
      <FastFinancialChart
        ref={chartRef}
        series={series}
        timeframe={timeframe}
        chartType="candles"
        priceScale={{ mode: 'normal', borderVisible: true, ticksVisible: true, scaleMargins: { top: 0.08, bottom: 0.08 } }}
        timeScale={{ rightOffset: 6, barSpacing: 8, minBarSpacing: 2, shiftVisibleRangeOnNewBar: true }}
        crosshairConfig={{ mode: 'normal', vertLine: { color: '#66717f', width: 1, style: 'dashed', visible: true }, horzLine: { color: '#66717f', width: 1, style: 'dashed', labelVisible: true } }}
        theme={{ background: '#090d12', axisText: '#9aa5b1', hudBg: 'rgba(9,13,18,.92)', hudText: '#e6edf7', layout: { priceAxisWidth: 76, timeAxisHeight: 22, gridRows: 6, gridColumns: 8 } }}
        interaction={{ wheelZoom: true, dragPan: true, handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true }, handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true, smoothWheel: true }, kineticScroll: { touch: true, mouse: true }, drawingSnap: true }}
        indicators={indicators}
        activeTool={activeTool}
        onActiveToolChange={setActiveTool}
        onReady={ref => { chartRef.current = ref; }}
        defaultViewport={{ type: 'last-bars', bars: 200 }}
        className="sire-fast-financial-chart"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        onDrawingsChange={() => undefined}
      />

      <LiveTickBridge chart={chartRef.current} latest={latest} />

      <div className="native-bottom-glass-bar" style={{ pointerEvents: 'auto' }}>
        <div className="native-bottom-instrument-viewport" style={{ pointerEvents: 'auto' }}>
          <button type="button" className="native-bottom-instrument-current" style={{ background: 'transparent', border: 0, width: '100%', height: '100%', textAlign: 'left' }} onClick={() => document.querySelector<HTMLButtonElement>('.native-instrument-picker')?.click()}>{instrumentLabel}</button>
        </div>
        <div className="native-bottom-timeframe-viewport" style={{ pointerEvents: 'auto' }}>
          <button type="button" className="native-bottom-timeframe-current" style={{ background: 'transparent', border: 0, width: '100%', height: '100%' }} onClick={() => setTimeframeOpen(true)}>{timeframeOptions.find(option => option.value === timeframe)?.label || timeframe}</button>
        </div>
        <button type="button" className={`sire-drawing-toggle ${drawingsOpen ? 'active' : ''}`} data-sire-drawing-toggle onClick={() => { setDrawingsOpen(value => !value); setIndicatorsOpen(false); }} aria-label="Drawing tools">✎</button>
        <button type="button" className={`sire-drawing-toggle ${indicatorsOpen ? 'active' : ''}`} onClick={() => { setIndicatorsOpen(value => !value); setDrawingsOpen(false); }} aria-label="Indicators">ƒ</button>
      </div>

      {drawingsOpen && <div className="sire-drawing-palette" data-sire-drawing-palette style={{ left: 188, bottom: 56 }}>
        <div className="sire-drawing-palette-tools">{DRAWING_TOOLS.map(tool => <button key={tool.type} type="button" className={activeTool === tool.type ? 'active' : ''} onClick={() => { setActiveTool(tool.type); setDrawingsOpen(false); }}>{tool.label}</button>)}</div>
        <div className="sire-drawing-palette-actions"><span>{activeTool ? `Active: ${activeTool}` : 'Select a drawing tool'}</span><button type="button" onClick={() => chartRef.current?.undo()}>Undo</button><button type="button" onClick={() => { chartRef.current?.clearDrawings(); setActiveTool(null); }}>Clear</button></div>
      </div>}

      {indicatorsOpen && <div className="sire-drawing-palette" style={{ left: 228, bottom: 56, minWidth: 280 }}>
        <div className="sire-drawing-palette-tools">{INDICATOR_PRESETS.map(preset => <button key={preset.type} type="button" onClick={() => addIndicator(preset)}>{preset.label}</button>)}</div>
        <div className="sire-drawing-palette-actions"><span>{indicators.length ? `${indicators.length} indicator${indicators.length === 1 ? '' : 's'}` : 'Built-in indicators'}</span><button type="button" onClick={() => setIndicators(current => current.slice(0, -1))}>Remove</button><button type="button" onClick={() => setIndicators([])}>Clear</button></div>
      </div>}

      {timeframeOpen && <div className="native-bottom-timeframe-overlay" onClick={event => { if (event.currentTarget === event.target) setTimeframeOpen(false); }}>
        <div className="native-bottom-timeframe-sheet">
          <div className="native-bottom-timeframe-head"><span>TIMEFRAME</span><button type="button" onClick={() => setTimeframeOpen(false)}>Done</button></div>
          <div className="native-bottom-timeframe-list">{timeframeOptions.map(option => <button key={option.value} type="button" className={option.value === timeframe ? 'active' : ''} onClick={() => { onTimeframeChange(option.value); setTimeframeOpen(false); }}>{option.label}</button>)}</div>
        </div>
      </div>}

      <div className="native-fast-chart-status" aria-hidden="true">Fast Financial Charts · {autoScale ? 'Auto scale' : 'Manual scale'}</div>
    </div>
  );
}

function LiveTickBridge({ chart, latest }: { chart: FastFinancialChartRef | null; latest?: { epoch: number; quote: number } | null }) {
  useEffect(() => {
    if (!chart || !latest) return;
    chart.applyTick({ seriesId: 'SIRE', ts: Math.floor(latest.epoch * 1000), price: latest.quote, volume: 0 });
  }, [chart, latest]);
  return null;
}
