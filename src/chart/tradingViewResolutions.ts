import type { Timeframe } from '@pairlens/fast-financial-charts/types';

export type SireTimeframe = Timeframe;
export type SireTimeframeOption = { value: SireTimeframe; label: string; seconds: number };

export const SIRE_TIMEFRAMES: readonly SireTimeframeOption[] = [
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

const BY_VALUE = new Map(SIRE_TIMEFRAMES.map(item => [item.value, item]));

export function timeframeInfo(value: SireTimeframe) {
  return BY_VALUE.get(value) ?? SIRE_TIMEFRAMES[0];
}

export function timeframeLabel(value: SireTimeframe) {
  return timeframeInfo(value).label;
}

// Compatibility exports for the existing terminal shell; values now come directly from Fast Financial Charts.
export type TradingViewResolution = SireTimeframe;
export type TradingViewResolutionOption = SireTimeframeOption;
export const TRADING_VIEW_RESOLUTIONS = SIRE_TIMEFRAMES;
export const resolutionInfo = timeframeInfo;
export const resolutionLabel = timeframeLabel;
