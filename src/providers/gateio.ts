export type GateioCatalogueItem = {
  id: string;
  provider: 'GATEIO';
  providerLabel: 'Gate.io';
  marketType: 'Spot' | 'Futures USDT' | 'Futures BTC';
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
  expiry?: number | null;
};

const PROVIDER_LOGO = 'https://cdn.simpleicons.org/gate';

const assetLogo = (base?: string) =>
  base
    ? 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + encodeURIComponent(base.toLowerCase()) + '.png'
    : '';

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

function normalizeSpot(raw: any): GateioCatalogueItem | null {
  const symbol = String(raw?.id || '').trim();
  const status = String(raw?.trade_status || '').toLowerCase();
  if (!symbol || status !== 'tradable') return null;
  const base = String(raw?.base || '').trim() || undefined;
  const quote = String(raw?.quote || '').trim() || undefined;
  return {
    id: 'GATEIO:Spot:' + symbol,
    provider: 'GATEIO',
    providerLabel: 'Gate.io',
    marketType: 'Spot',
    category: 'Crypto',
    market: 'Crypto',
    submarket: 'Spot',
    subgroup: 'Gate.io',
    symbolType: 'spot',
    symbol,
    displaySymbol: symbol,
    name: base ? base + (quote ? ' / ' + quote : '') : symbol,
    base,
    quote,
    exchangeOpen: 1,
    status: 'Trading',
    logoUrl: assetLogo(base),
    providerLogoUrl: PROVIDER_LOGO,
    instrumentType: 'Spot',
  };
}

function normalizeFuture(raw: any, settlement: 'usdt' | 'btc'): GateioCatalogueItem | null {
  const symbol = String(raw?.name || '').trim();
  const status = String(raw?.status || '').toLowerCase();
  if (!symbol || status !== 'trading') return null;
  const base = String(raw?.underlying || '').split('_')[0].trim() || undefined;
  const quote = settlement.toUpperCase();
  return {
    id: 'GATEIO:Futures-' + settlement.toUpperCase() + ':' + symbol,
    provider: 'GATEIO',
    providerLabel: 'Gate.io',
    marketType: settlement === 'usdt' ? 'Futures USDT' : 'Futures BTC',
    category: 'Crypto',
    market: 'Crypto',
    submarket: 'Futures',
    subgroup: 'Gate.io',
    symbolType: 'futures',
    symbol,
    displaySymbol: symbol,
    name: base ? base + ' / ' + quote : symbol,
    base,
    quote,
    exchangeOpen: 1,
    status: 'Trading',
    logoUrl: assetLogo(base),
    providerLogoUrl: PROVIDER_LOGO,
    instrumentType: 'Futures',
    contractType: String(raw?.type || '').trim() || 'perpetual',
    settlement: String(raw?.settle || settlement).toUpperCase(),
    expiry: raw?.expire_time ?? null,
  };
}

export async function loadGateioCatalogue(): Promise<GateioCatalogueItem[]> {
  const sources = await Promise.allSettled([
    fetchJson('https://api.gateio.ws/api/v4/spot/currency_pairs'),
    fetchJson('https://api.gateio.ws/api/v4/futures/usdt/contracts'),
    fetchJson('https://api.gateio.ws/api/v4/futures/btc/contracts'),
  ]);

  const items: GateioCatalogueItem[] = [];

  if (sources[0].status === 'fulfilled') {
    for (const raw of Array.isArray(sources[0].value) ? sources[0].value : []) {
      const item = normalizeSpot(raw);
      if (item) items.push(item);
    }
  } else {
    console.warn('[SIRE GATEIO] Spot unavailable:', sources[0].reason);
  }

  for (const [index, settlement] of [['usdt', 'usdt'], ['btc', 'btc']] as const) {
    const result = sources[index === 0 ? 1 : 2];
    if (result.status === 'fulfilled') {
      for (const raw of Array.isArray(result.value) ? result.value : []) {
        const item = normalizeFuture(raw, settlement);
        if (item) items.push(item);
      }
    } else {
      console.warn('[SIRE GATEIO] ' + settlement.toUpperCase() + ' futures unavailable:', result.reason);
    }
  }

  const seen = new Set<string>();
  const unique = items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  console.info('[SIRE GATEIO] Clean catalogue total:', unique.length, {
    spot: unique.filter(item => item.marketType === 'Spot').length,
    futures: unique.filter(item => item.marketType.startsWith('Futures')).length,
  });

  if (!unique.length) throw new Error('Gate.io returned no active instruments.');
  return unique;
}
