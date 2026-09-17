import type { Timeframe } from '@pairlens/fast-financial-charts/types';

/**
 * Fast Financial Charts is the chart engine used by SIRE.
 * Keep the timeframe contract identical to the engine instead of maintaining
 * a second TradingView-style resolution catalogue in the app.
 */
export type TradingViewResolution = Timeframe;

export type TradingViewResolutionOption = {
  value: TradingViewResolution;
  label: string;
  seconds: number;
};

export const TRADING_VIEW_RESOLUTIONS: readonly TradingViewResolutionOption[] = [
  { value: '1m', label: '1m', seconds: 60 },
  { value: '5m', label: '5m', seconds: 300 },
  { value: '15m', label: '15m', seconds: 900 },
  { value: '30m', label: '30m', seconds: 1800 },
  { value: '1h', label: '1h', seconds: 3600 },
  { value: '2h', label: '2h', seconds: 7200 },
  { value: '4h', label: '4h', seconds: 14400 },
  { value: '1d', label: '1D', seconds: 86400 },
  { value: '3d', label: '3D', seconds: 259200 },
  { value: '1w', label: '1W', seconds: 604800 },
  { value: '1M', label: '1M', seconds: 2592000 },
];

const BY_VALUE = new Map(TRADING_VIEW_RESOLUTIONS.map(item => [item.value, item]));

export function resolutionInfo(value: TradingViewResolution) {
  return BY_VALUE.get(value) ?? TRADING_VIEW_RESOLUTIONS[0];
}

export function resolutionLabel(value: TradingViewResolution) {
  return resolutionInfo(value).label;
}
