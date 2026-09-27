export type BinanceCatalogueItem = {
  id: string;
  provider: 'BINANCE';
  providerLabel: 'Binance';
  marketType: string;
  category: 'crypto';
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
  expiry?: string | number;
  strike?: number;
  optionType?: string;
  supportsMargin?: boolean;
};

type Source = {
  marketType: string;
  urls: string[];
  rows: (payload: any) => any[];
};

const PROVIDER = 'https://cdn.simpleicons.org/binance';
const assetLogo = (base?: string) =>
  base ? 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + encodeURIComponent(base.toLowerCase()) + '.png' : '';

const sources: Source[] = [
  {
    marketType: 'Spot',
    urls: [
      'https://data-api.binance.vision/api/v3/exchangeInfo',
      'https://api.binance.com/api/v3/exchangeInfo',
    ],
    rows: payload => Array.isArray(payload?.symbols) ? payload.symbols : [],
  },
  {
    marketType: 'Margin',
    urls: [
      'https://api.binance.com/sapi/v1/margin/allPairs',
    ],
    rows: payload => Array.isArray(payload) ? payload : [],
  },
  {
    marketType: 'USD-M',
    urls: [
      'https://fapi.binance.com/fapi/v1/exchangeInfo',
    ],
    rows: payload => Array.isArray(payload?.symbols) ? payload.symbols : [],
  },
  {
    marketType: 'COIN-M',
    urls: [
      'https://dapi.binance.com/dapi/v1/exchangeInfo',
    ],
    rows: payload => Array.isArray(payload?.symbols) ? payload.symbols : [],
  },
  {
    marketType: 'Options',
    urls: [
      'https://eapi.binance.com/eapi/v1/exchangeInfo',
    ],
    rows: payload => Array.isArray(payload?.optionSymbols) ? payload.optionSymbols : [],
  },
];

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

async function fetchSource(source: Source): Promise<BinanceCatalogueItem[]> {
  let lastError: unknown = null;
  for (const url of source.urls) {
    try {
      const payload = await fetchJson(url);
      const result: BinanceCatalogueItem[] = [];
      for (const raw of source.rows(payload)) {
        const status = String(raw?.status || raw?.contractStatus || '').toUpperCase();
        if (status && !['TRADING', 'ONLINE', 'ENABLED', 'LIVE'].includes(status)) continue;

        const symbol = String(raw?.symbol || '').trim();
        if (!symbol) continue;

        const contractType = String(raw?.contractType || '').trim();
        const marketType =
          source.marketType === 'USD-M'
            ? contractType.toUpperCase().includes('PERPETUAL') ? 'USD-M Perpetuals' : 'USD-M Futures'
            : source.marketType === 'COIN-M'
              ? contractType.toUpperCase().includes('PERPETUAL') ? 'COIN-M Perpetuals' : 'COIN-M Futures'
              : source.marketType;

        const underlying = String(raw?.underlying || '').trim();
        const base = String(
          raw?.baseAsset ||
          raw?.baseCoin ||
          (underlying ? underlying.replace(/USDT$|USDC$|USD$/i, '') : '')
        ).trim() || undefined;
        const quote = String(raw?.quoteAsset || raw?.quoteCoin || '').trim() || undefined;

        result.push({
          id: 'BINANCE:' + marketType + ':' + symbol,
          provider: 'BINANCE',
          providerLabel: 'Binance',
          marketType,
          category: 'crypto',
          market: 'Crypto',
          submarket: marketType,
          subgroup: 'Binance',
          symbolType: marketType,
          symbol,
          displaySymbol: symbol,
          name: base ? base + (quote ? ' / ' + quote : '') : symbol,
          base,
          quote,
          exchangeOpen: 1,
          status: status || 'TRADING',
          logoUrl: assetLogo(base),
          providerLogoUrl: PROVIDER,
          instrumentType: marketType,
          contractType: contractType || undefined,
          settlement: raw?.marginAsset || raw?.settleAsset || raw?.settleCoin || undefined,
          expiry: raw?.deliveryDate || raw?.deliveryTime || raw?.expirationTime || raw?.expiryDate || undefined,
          strike: Number.isFinite(Number(raw?.strikePrice)) ? Number(raw.strikePrice) : undefined,
          optionType: raw?.side || raw?.optionType || undefined,
          supportsMargin: source.marketType === 'Margin',
        });
      }
      console.info('[SIRE BINANCE] ' + source.marketType + ': ' + result.length);
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(source.marketType + ' Binance endpoints failed');
}

export async function loadBinanceCatalogue(): Promise<BinanceCatalogueItem[]> {
  const results = await Promise.allSettled(sources.map(fetchSource));
  const instruments = results.flatMap(result =>
    result.status === 'fulfilled' ? result.value : []
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn('[SIRE BINANCE] ' + sources[index].marketType + ' unavailable:', result.reason);
    }
  });

  const seen = new Set<string>();
  const unique = instruments.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  console.info('[SIRE BINANCE] Clean catalogue total:', unique.length);
  return unique;
}
