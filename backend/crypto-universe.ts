import ccxt from 'ccxt';

type CryptoInstrument = {
  id: string;
  provider: string;
  providerLabel: string;
  marketType: string;
  category: string;
  symbol: string;
  displaySymbol: string;
  name: string;
  base?: string;
  quote?: string;
  status?: string;
  logoUrl: string;
  providerLogoUrl: string;
};

type Venue = { id: string; name: string; countries?: string[]; hasFetchMarkets: boolean };

const venueCache = new Map<string, { at: number; instruments: CryptoInstrument[] }>();
const CACHE_MS = 10 * 60 * 1000;
const PROVIDER_LOGO = (id: string) => 'https://cdn.simpleicons.org/' + encodeURIComponent(id);
const ASSET_LOGO = (base?: string) => base ? 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + encodeURIComponent(base.toLowerCase()) + '.png' : '';

function label(id: string) {
  return id.split(/[-_]/g).map(part => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout after ' + ms + 'ms')), ms))]);
}

export function listCryptoVenues(): Venue[] {
  const ids = Array.isArray((ccxt as any).exchanges) ? (ccxt as any).exchanges as string[] : [];
  return ids.map(id => {
    const Exchange = (ccxt as any)[id];
    let instance: any = null;
    try { instance = Exchange ? new Exchange({ enableRateLimit: true }) : null; } catch {}
    return { id, name: label(id), countries: instance?.countries || undefined, hasFetchMarkets: Boolean(instance?.has?.fetchMarkets) };
  }).filter(v => v.hasFetchMarkets);
}

function normalizeMarket(exchangeId: string, market: any): CryptoInstrument | null {
  if (!market || market.active === false) return null;
  const symbol = String(market.symbol || market.id || '').trim();
  if (!symbol) return null;
  const type = String(market.type || (market.spot ? 'spot' : market.swap ? 'swap' : market.future ? 'future' : market.option ? 'option' : 'other')).toLowerCase();
  const marketType = type === 'spot' ? 'Spot' : type === 'swap' ? 'Perpetuals' : type === 'future' ? 'Futures' : type === 'option' ? 'Options' : type === 'margin' ? 'Margin' : type;
  const category = ['spot','margin','swap','future','option'].includes(type) ? 'Crypto' : 'Crypto';
  const base = String(market.base || '').trim() || undefined;
  const quote = String(market.quote || '').trim() || undefined;
  return {
    id: 'CRYPTO:' + exchangeId.toUpperCase() + ':' + type + ':' + symbol,
    provider: exchangeId.toUpperCase(),
    providerLabel: label(exchangeId),
    marketType,
    category,
    symbol,
    displaySymbol: symbol,
    name: String(market.info?.displayName || market.symbol || (base ? base + (quote ? ' / ' + quote : '') : symbol)),
    base,
    quote,
    status: market.active === false ? 'inactive' : 'active',
    logoUrl: ASSET_LOGO(base) || PROVIDER_LOGO(exchangeId),
    providerLogoUrl: PROVIDER_LOGO(exchangeId),
  };
}

async function loadVenue(exchangeId: string): Promise<CryptoInstrument[]> {
  const cached = venueCache.get(exchangeId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.instruments;
  const Exchange = (ccxt as any)[exchangeId];
  if (!Exchange) throw new Error('Unknown CCXT exchange: ' + exchangeId);
  const exchange: any = new Exchange({ enableRateLimit: true, timeout: 15000 });
  if (!exchange.has?.fetchMarkets) throw new Error(exchangeId + ' does not expose fetchMarkets');
  const markets = await timeout(exchange.loadMarkets(false), 18000);
  const instruments = Object.values(markets || {}).map(m => normalizeMarket(exchangeId, m)).filter(Boolean) as CryptoInstrument[];
  venueCache.set(exchangeId, { at: Date.now(), instruments });
  console.log('[SIRE CRYPTO UNIVERSE] ' + exchangeId + ': ' + instruments.length);
  return instruments;
}

export async function getCryptoVenueInstruments(exchangeId: string) {
  return loadVenue(String(exchangeId || '').trim().toLowerCase());
}

export async function getCryptoUniverse() {
  const venues = listCryptoVenues().filter(v => v.hasFetchMarkets);
  const out: CryptoInstrument[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  const workers = Math.min(6, venues.length);
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= venues.length) return;
      const venue = venues[index];
      try {
        const items = await loadVenue(venue.id);
        for (const item of items) if (!seen.has(item.id)) { seen.add(item.id); out.push(item); }
      } catch (error) {
        console.warn('[SIRE CRYPTO UNIVERSE] ' + venue.id + ' failed:', error instanceof Error ? error.message : String(error));
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  out.sort((a, b) => (a.providerLabel + a.symbol).localeCompare(b.providerLabel + b.symbol));
  console.log('[SIRE CRYPTO UNIVERSE] complete venues=' + venues.length + ' instruments=' + out.length);
  return { venues, instruments: out };
}
