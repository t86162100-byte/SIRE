export type HyperliquidCatalogueItem = {
  id: string;
  provider: 'HYPERLIQUID';
  providerLabel: 'Hyperliquid';
  marketType: 'Perpetuals' | 'Spot';
  category: 'Crypto';
  market: string;
  submarket: string;
  subgroup: string;
  symbolType: string;
  symbol: string;
  displaySymbol: string;
  name: string;
  base?: string;
  quote?: string;
  exchangeOpen: 1;
  status: string;
  logoUrl: string;
  providerLogoUrl: string;
  instrumentType?: string;
  contractType?: string;
  settlement?: string;
  maxLeverage?: number;
  szDecimals?: number;
};

const INFO_URL = 'https://api.hyperliquid.xyz/info';
const PROVIDER_LOGO = 'https://cdn.simpleicons.org/hyperliquid';

const assetLogo = (base?: string) =>
  base
    ? 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + encodeURIComponent(base.toLowerCase()) + '.png'
    : '';

async function info(type: string): Promise<any> {
  const response = await fetch(INFO_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

function normalizePerp(raw: any): HyperliquidCatalogueItem | null {
  const symbol = String(raw?.name || '').trim();
  if (!symbol || raw?.isDelisted === true) return null;
  return {
    id: 'HYPERLIQUID:Perpetuals:' + symbol,
    provider: 'HYPERLIQUID',
    providerLabel: 'Hyperliquid',
    marketType: 'Perpetuals',
    category: 'Crypto',
    market: 'Crypto',
    submarket: 'Perpetuals',
    subgroup: 'Hyperliquid',
    symbolType: 'perpetual',
    symbol,
    displaySymbol: symbol,
    name: symbol + ' / USDC',
    base: symbol.split(':').pop() || symbol,
    quote: 'USDC',
    exchangeOpen: 1,
    status: 'Trading',
    logoUrl: assetLogo(symbol.split(':').pop() || symbol),
    providerLogoUrl: PROVIDER_LOGO,
    instrumentType: 'Perpetuals',
    contractType: 'Perpetual',
    settlement: 'USDC',
    maxLeverage: Number.isFinite(Number(raw?.maxLeverage)) ? Number(raw.maxLeverage) : undefined,
    szDecimals: Number.isFinite(Number(raw?.szDecimals)) ? Number(raw.szDecimals) : undefined,
  };
}

function normalizeSpot(pair: any, tokens: any[]): HyperliquidCatalogueItem | null {
  const symbol = String(pair?.name || '').trim();
  const tokenIndexes = Array.isArray(pair?.tokens) ? pair.tokens : [];
  if (!symbol || tokenIndexes.length !== 2) return null;
  const baseToken = tokens[Number(tokenIndexes[0])];
  const quoteToken = tokens[Number(tokenIndexes[1])];
  const base = String(baseToken?.name || '').trim();
  const quote = String(quoteToken?.name || '').trim();
  if (!base || !quote) return null;
  const displaySymbol = symbol.startsWith('@') ? base + '/' + quote : symbol.replace('/', '/');
  return {
    id: 'HYPERLIQUID:Spot:' + symbol,
    provider: 'HYPERLIQUID',
    providerLabel: 'Hyperliquid',
    marketType: 'Spot',
    category: 'Crypto',
    market: 'Crypto',
    submarket: 'Spot',
    subgroup: 'Hyperliquid',
    symbolType: 'spot',
    symbol,
    displaySymbol,
    name: base + ' / ' + quote,
    base,
    quote,
    exchangeOpen: 1,
    status: 'Trading',
    logoUrl: assetLogo(base),
    providerLogoUrl: PROVIDER_LOGO,
    instrumentType: 'Spot',
  };
}

export async function loadHyperliquidCatalogue(): Promise<HyperliquidCatalogueItem[]> {
  const results = await Promise.allSettled([
    info('meta'),
    info('spotMeta'),
  ]);

  const items: HyperliquidCatalogueItem[] = [];

  if (results[0].status === 'fulfilled') {
    const universe = Array.isArray(results[0].value?.universe) ? results[0].value.universe : [];
    for (const raw of universe) {
      const item = normalizePerp(raw);
      if (item) items.push(item);
    }
  } else {
    console.warn('[SIRE HYPERLIQUID] Perpetuals unavailable:', results[0].reason);
  }

  if (results[1].status === 'fulfilled') {
    const tokens = Array.isArray(results[1].value?.tokens) ? results[1].value.tokens : [];
    const universe = Array.isArray(results[1].value?.universe) ? results[1].value.universe : [];
    for (const pair of universe) {
      const item = normalizeSpot(pair, tokens);
      if (item) items.push(item);
    }
  } else {
    console.warn('[SIRE HYPERLIQUID] Spot unavailable:', results[1].reason);
  }

  const seen = new Set<string>();
  const unique = items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  console.info('[SIRE HYPERLIQUID] Clean catalogue total:', unique.length, {
    spot: unique.filter(item => item.marketType === 'Spot').length,
    perpetuals: unique.filter(item => item.marketType === 'Perpetuals').length,
  });

  if (!unique.length) throw new Error('Hyperliquid returned no active instruments.');
  return unique;
}
