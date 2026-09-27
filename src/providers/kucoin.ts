export type KucoinCatalogueItem = {
  id: string;
  provider: 'KUCOIN';
  providerLabel: 'KuCoin';
  marketType: 'Spot' | 'Futures';
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
  expiry?: string | number | null;
};

const PROVIDER_LOGO = 'https://cdn.simpleicons.org/kucoin';
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
  const payload = await response.json();
  if (String(payload?.code) !== '200000') {
    throw new Error(String(payload?.msg || 'KuCoin API returned an error'));
  }
  return payload;
}

function spotRows(payload: any): any[] {
  return Array.isArray(payload?.data) ? payload.data : [];
}

function futuresRows(payload: any): any[] {
  return Array.isArray(payload?.data) ? payload.data : [];
}

function normalizeSpot(raw: any): KucoinCatalogueItem | null {
  const symbol = String(raw?.symbol || '').trim();
  if (!symbol || raw?.enableTrading !== true) return null;
  const base = String(raw?.baseCurrency || '').trim() || undefined;
  const quote = String(raw?.quoteCurrency || '').trim() || undefined;
  const marketType = 'Spot' as const;
  return {
    id: 'KUCOIN:Spot:' + symbol,
    provider: 'KUCOIN',
    providerLabel: 'KuCoin',
    marketType,
    category: 'Crypto',
    market: 'Crypto',
    submarket: marketType,
    subgroup: 'KuCoin',
    symbolType: 'spot',
    symbol,
    displaySymbol: symbol,
    name: String(raw?.name || (base ? base + (quote ? ' / ' + quote : '') : symbol)),
    base,
    quote,
    exchangeOpen: 1,
    status: 'Trading',
    logoUrl: assetLogo(base),
    providerLogoUrl: PROVIDER_LOGO,
    instrumentType: marketType,
  };
}

function normalizeFuture(raw: any): KucoinCatalogueItem | null {
  const symbol = String(raw?.symbol || '').trim();
  const status = String(raw?.status || '').trim();
  if (!symbol || !['OPEN', 'TRADING', 'ONLINE'].includes(status.toUpperCase())) return null;
  const base = String(raw?.baseCurrency || raw?.displayBaseCurrency || '').trim() || undefined;
  const quote = String(raw?.quoteCurrency || '').trim() || undefined;
  const marketType = 'Futures' as const;
  return {
    id: 'KUCOIN:Futures:' + symbol,
    provider: 'KUCOIN',
    providerLabel: 'KuCoin',
    marketType,
    category: 'Crypto',
    market: 'Crypto',
    submarket: marketType,
    subgroup: 'KuCoin',
    symbolType: 'futures',
    symbol,
    displaySymbol: String(raw?.displaySymbol || symbol),
    name: base ? base + (quote ? ' / ' + quote : '') : symbol,
    base,
    quote,
    exchangeOpen: 1,
    status,
    logoUrl: assetLogo(base),
    providerLogoUrl: PROVIDER_LOGO,
    instrumentType: marketType,
    contractType: String(raw?.type || '').trim() || undefined,
    settlement: String(raw?.settleCurrency || '').trim() || undefined,
    expiry: raw?.expireDate ?? null,
  };
}

export async function loadKucoinCatalogue(): Promise<KucoinCatalogueItem[]> {
  const sources = await Promise.allSettled([
    fetchJson('https://api.kucoin.com/api/v2/symbols'),
    fetchJson('https://api-futures.kucoin.com/api/v1/contracts/active'),
  ]);

  const items: KucoinCatalogueItem[] = [];

  if (sources[0].status === 'fulfilled') {
    for (const raw of spotRows(sources[0].value)) {
      const item = normalizeSpot(raw);
      if (item) items.push(item);
    }
  } else {
    console.warn('[SIRE KUCOIN] Spot unavailable:', sources[0].reason);
  }

  if (sources[1].status === 'fulfilled') {
    for (const raw of futuresRows(sources[1].value)) {
      const item = normalizeFuture(raw);
      if (item) items.push(item);
    }
  } else {
    console.warn('[SIRE KUCOIN] Futures unavailable:', sources[1].reason);
  }

  const seen = new Set<string>();
  const unique = items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  console.info('[SIRE KUCOIN] Clean catalogue total:', unique.length, {
    spot: unique.filter(item => item.marketType === 'Spot').length,
    futures: unique.filter(item => item.marketType === 'Futures').length,
  });

  if (!unique.length) throw new Error('KuCoin returned no active instruments.');
  return unique;
}
