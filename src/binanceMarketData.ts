export type BinanceInstrument = {
  symbol: string;
  name: string;
  provider: 'BINANCE';
  exchange: string;
  marketGroup: 'CRYPTO' | 'TRADE FI' | 'ALPHA';
  marketType: string;
  category: string;
  marketSubcategory: string;
  marketSubSubcategory?: string;
  marketFilters: string[];
  marketFilter?: string;
  instrumentType: string;
  instrumentSubtype?: string;
  quote?: string;
  baseAsset?: string;
  settlement?: string;
  status?: string;
  pipSize?: number;
  onboardDate?: number;
  expiry?: number;
  newListing?: boolean;
  margin?: boolean;
  price?: number;
  priceChangePercent?: number;
  change24h?: number;
  volume24h?: number;
  high24h?: number;
  low24h?: number;
  marketCap?: number;
  fdv?: number;
  liquidity?: number;
  holders?: number;
  listedAt?: number;
};

export type BinanceTick = {
  provider: 'BINANCE';
  symbol: string;
  price: number;
  epoch: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  quoteVolume?: number;
  bid?: number;
  ask?: number;
  percent?: number;
  marketCap?: number;
};

/**
 * Binance catalog is deliberately isolated from all live-price code.
 *
 * This module contains no Binance price WebSocket, REST quote, polling,
 * subscription, cache, fallback, or browser/server relay logic.
 * The catalog endpoint remains the sole Binance request here so the
 * Market catalogue can continue to populate unchanged while the new
 * live-price implementation is built from a clean starting point.
 */
export async function fetchBinanceInstruments(): Promise<BinanceInstrument[]> {
  const response = await fetch('/api/sire/binance/catalog', { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok || !Array.isArray(payload.instruments)) {
    throw new Error(payload?.error || 'Binance native catalog is unavailable.');
  }
  return payload.instruments as BinanceInstrument[];
}
