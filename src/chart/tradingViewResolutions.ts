export type TradingViewResolution =
  | '1T' | '10T' | '100T' | '1000T'
  | '1S' | '5S' | '10S' | '15S' | '30S' | '45S'
  | '1' | '2' | '3' | '5' | '10' | '15' | '30' | '45'
  | '60' | '120' | '180' | '240'
  | '1D' | '1W' | '1M';

export type TradingViewResolutionOption = {
  value: TradingViewResolution;
  label: string;
  seconds: number;
};

// Resolution formats and interval families follow TradingView's documented
// resolution model: ticks, seconds, minutes, hours expressed as minutes,
// days, weeks, and months.
export const TRADING_VIEW_RESOLUTIONS: readonly TradingViewResolutionOption[] = [
  { value: '1T', label: '1 Tick', seconds: 0 },
  { value: '10T', label: '10 Tick', seconds: 0 },
  { value: '100T', label: '100 Tick', seconds: 0 },
  { value: '1000T', label: '1000 Tick', seconds: 0 },
  { value: '1S', label: '1s', seconds: 1 },
  { value: '5S', label: '5s', seconds: 5 },
  { value: '10S', label: '10s', seconds: 10 },
  { value: '15S', label: '15s', seconds: 15 },
  { value: '30S', label: '30s', seconds: 30 },
  { value: '45S', label: '45s', seconds: 45 },
  { value: '1', label: '1m', seconds: 60 },
  { value: '2', label: '2m', seconds: 120 },
  { value: '3', label: '3m', seconds: 180 },
  { value: '5', label: '5m', seconds: 300 },
  { value: '10', label: '10m', seconds: 600 },
  { value: '15', label: '15m', seconds: 900 },
  { value: '30', label: '30m', seconds: 1800 },
  { value: '45', label: '45m', seconds: 2700 },
  { value: '60', label: '1h', seconds: 3600 },
  { value: '120', label: '2h', seconds: 7200 },
  { value: '180', label: '3h', seconds: 10800 },
  { value: '240', label: '4h', seconds: 14400 },
  { value: '1D', label: '1D', seconds: 86400 },
  { value: '1W', label: '1W', seconds: 604800 },
  { value: '1M', label: '1M', seconds: 2592000 },
];

const BY_VALUE = new Map(TRADING_VIEW_RESOLUTIONS.map(item => [item.value, item]));

export function resolutionInfo(value: TradingViewResolution) {
  return BY_VALUE.get(value) ?? TRADING_VIEW_RESOLUTIONS[10];
}

export function resolutionLabel(value: TradingViewResolution) {
  return resolutionInfo(value).label;
}
