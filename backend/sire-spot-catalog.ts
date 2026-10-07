type Json = Record<string, any>;

const API_HOST = 'https://api.coingecko.com/api/v3';
const CACHE_TTL_MS = 5 * 60_000;
const MIN_REFRESH_GAP_MS = 30_000;
const MAX_PAGES = 4;
const PER_PAGE = 250;
const MAX_RETRIES_429 = 3;

let cache: { at: number; data: Json } | null = null;
let inflight: Promise<Json> | null = null;
let lastAttemptAt = 0;

const s = (value: unknown) => String(value ?? '').trim();
const n = (value: unknown) => {
  const valueNumber = Number(value);
  return Number.isFinite(valueNumber) ? valueNumber : undefined;
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(15_000, Math.max(1_000, retryAfter * 1_000));
  }
  return Math.min(15_000, 1_500 * 2 ** attempt);
}

async function getJson(url: string) {
  const apiKey = s(process.env.COINGECKO_API_KEY || process.env.CG_API_KEY);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'SIRE-Spot-Catalog/1.1',
  };
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

  for (let attempt = 0; attempt <= MAX_RETRIES_429; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, { cache: 'no-store', headers, signal: controller.signal });
      const raw = await response.text();
      let data: any = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch {
        throw new Error('CoinGecko returned invalid JSON.');
      }

      if (response.status === 429 && attempt < MAX_RETRIES_429) {
        const delay = retryDelayMs(response, attempt);
        console.warn(`[SIRE SPOT] CoinGecko rate limited; retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES_429}).`);
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        const detail = s(data?.status?.error_message || data?.error || raw).slice(0, 300);
        throw new Error('CoinGecko ' + response.status + (detail ? ': ' + detail : ''));
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('CoinGecko rate limit could not be cleared after retries.');
}

async function loadCatalog(): Promise<Json> {
  const pages: Json[][] = [];

  // Pace pages instead of bursting all four requests concurrently.
  for (let index = 0; index < MAX_PAGES; index++) {
    const page = index + 1;
    const url = new URL(API_HOST + '/coins/markets');
    url.searchParams.set('vs_currency', 'usd');
    url.searchParams.set('order', 'market_cap_desc');
    url.searchParams.set('per_page', String(PER_PAGE));
    url.searchParams.set('page', String(page));
    url.searchParams.set('sparkline', 'false');
    url.searchParams.set('price_change_percentage', '24h');

    if (index > 0) await sleep(750);
    const result = await getJson(url.toString());
    pages.push(Array.isArray(result) ? result : []);
  }

  const seen = new Set<string>();
  const markets: Json[] = [];

  for (const row of pages.flat()) {
    const id = s(row?.id);
    const symbol = s(row?.symbol).toUpperCase();
    const name = s(row?.name);
    if (!id || !symbol || !name || seen.has(id)) continue;
    seen.add(id);

    markets.push({
      id: 'SIRE:' + symbol + 'USDT',
      symbol: symbol + 'USDT',
      name: symbol + '/USDT',
      baseAsset: symbol,
      quote: 'USDT',
      quoteAsset: 'USDT',
      status: 'TRADING',
      marketType: 'Spot',
      marketGroup: 'CRYPTO',
      provider: 'COINGECKO',
      sourceAssetId: id,
      assetName: name,
      logoUrl: s(row?.image),
      priceUSD: n(row?.current_price),
      price: n(row?.current_price),
      priceChangePercent: n(row?.price_change_percentage_24h_in_currency ?? row?.price_change_percentage_24h),
      marketCapUSD: n(row?.market_cap),
      volume24hUSD: n(row?.total_volume),
      high24hUSD: n(row?.high_24h),
      low24hUSD: n(row?.low_24h),
      circulatingSupply: n(row?.circulating_supply),
      marketCapRank: n(row?.market_cap_rank),
      decimals: 8,
    });
  }

  return {
    ok: true,
    provider: 'CoinGecko',
    pairPolicy: 'SIRE-managed USDT spot pairs',
    generatedAt: Date.now(),
    count: markets.length,
    markets,
  };
}

export async function fetchSireSpotCatalogServer(force = false): Promise<Json> {
  const now = Date.now();

  // Even forced refreshes cannot hammer CoinGecko repeatedly.
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.data;
  if (cache && now - lastAttemptAt < MIN_REFRESH_GAP_MS) return cache.data;
  if (inflight) return inflight;

  lastAttemptAt = now;
  inflight = loadCatalog()
    .then(data => {
      cache = { at: Date.now(), data };
      return data;
    })
    .catch(error => {
      if (cache?.data) {
        console.warn('[SIRE SPOT] CoinGecko refresh failed; serving cached catalog:', error instanceof Error ? error.message : String(error));
        return cache.data;
      }
      throw error;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function sireSpotCatalogStatus() {
  return {
    ok: Boolean(cache?.data),
    provider: 'CoinGecko',
    cachedAt: cache?.at || null,
    count: cache?.data?.count || 0,
    ttlMs: CACHE_TTL_MS,
    minRefreshGapMs: MIN_REFRESH_GAP_MS,
    refreshInFlight: Boolean(inflight),
  };
}
