type Json = Record<string, any>;

const CG_PRO_KEY = String(process.env.COINGECKO_PRO_API_KEY || (String(process.env.COINGECKO_API_PLAN || '').toLowerCase() === 'pro' ? process.env.COINGECKO_API_KEY : '')).trim();
const CG_DEMO_KEY = String(process.env.COINGECKO_DEMO_API_KEY || (String(process.env.COINGECKO_API_PLAN || 'demo').toLowerCase() !== 'pro' ? process.env.COINGECKO_API_KEY : '')).trim();
const API_HOST = String(process.env.COINGECKO_API_HOST || '').trim() || (CG_PRO_KEY ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3');
const CACHE_TTL_MS = 5 * 60_000;
const MIN_REFRESH_GAP_MS = 30_000;
const MAX_PAGES = 4;
const PER_PAGE = 250;
const MAX_RETRIES_429 = 1;

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
  const demoKey = CG_DEMO_KEY || s(process.env.CG_API_KEY);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'SIRE-Spot-Catalog/1.2',
  };
  if (CG_PRO_KEY) headers['x-cg-pro-api-key'] = CG_PRO_KEY;
  else if (demoKey) headers['x-cg-demo-api-key'] = demoKey;

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

  // CoinGecko's coins/list is the complete active asset directory; market pages
  // enrich the highest-ranked assets with live reference data.
  const allCoinsPayload = await getJson(API_HOST + '/coins/list');
  if (!Array.isArray(allCoinsPayload)) throw new Error('CoinGecko full coin directory returned an unexpected response.');

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

  // CoinGecko's RWA directory adds tokenized stocks, commodities and ETFs.
  // RWA market quotes are kept separate from underlying exchange spot prices.
  let rwaRows: Json[] = [];
  try {
    const rwaList = await getJson(API_HOST + '/rwas/list');
    const rwaMarkets: Json[] = [];
    if (Array.isArray(rwaList)) {
      for (let index = 0; index < Math.ceil(rwaList.length / 250); index++) {
        const url = new URL(API_HOST + '/rwas/markets');
        url.searchParams.set('per_page', String(PER_PAGE));
        url.searchParams.set('page', String(index + 1));
        url.searchParams.set('price_change_percentage', '24h');
        if (index > 0) await sleep(750);
        const pageRows = await getJson(url.toString());
        if (Array.isArray(pageRows)) rwaMarkets.push(...pageRows);
      }
      const marketById = new Map(rwaMarkets.map(row => [s(row?.id), row]));
      rwaRows = rwaList.map((asset: Json) => {
        const id = s(asset?.id), symbol = s(asset?.symbol).toUpperCase(), name = s(asset?.name);
        if (!id || !symbol || !name) return null;
        const market = marketById.get(id);
        const data = market?.tokenized_market_data || {};
        const rawType = s(asset?.asset_type).toLowerCase();
        const type = rawType === 'commodity' ? 'Commodities' : rawType === 'etf' ? 'ETFs' : 'Stocks';
        return {
          id: 'SIRE:RWA:' + id,
          symbol,
          name,
          baseAsset: symbol,
          quote: 'USD',
          quoteAsset: 'USD',
          status: 'REFERENCE_ONLY',
          marketType: type,
          category: type,
          marketSubcategory: type,
          marketSubSubcategory: 'Tokenized ' + type,
          marketGroup: 'TRADE FI',
          marketFilters: ['TRADE FI', type, 'Tokenized RWA'],
          instrumentType: 'Tokenized ' + type,
          instrumentSubtype: 'CoinGecko aggregated RWA',
          provider: 'COINGECKO',
          sourceAssetId: id,
          assetType: rawType,
          price: n(data?.current_price),
          priceChangePercent: n(data?.price_change_percentage_24h_in_currency ?? data?.price_change_percentage_24h),
          marketCap: n(data?.market_cap),
          volume24h: n(data?.total_volume),
          logoUrl: '',
          tradableOnSire: false,
          dataSource: 'CoinGecko tokenized RWA aggregate',
        };
      }).filter(Boolean) as Json[];
    }
  } catch (error) {
    // CoinGecko RWA endpoints may require a plan/key not configured in this deployment.
    console.warn('[SIRE UNIVERSE] CoinGecko RWA directory unavailable:', error instanceof Error ? error.message : String(error));
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
      id: 'SIRE:COIN:' + id,
      symbol: symbol + 'USDT',
      name: symbol + '/USDT',
      baseAsset: symbol,
      quote: 'USDT',
      quoteAsset: 'USDT',
      status: 'REFERENCE_ONLY',
      tradableOnSire: false,
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

  const rwaIds = new Set<string>();
  for (const item of rwaRows) {
    const key = String(item.sourceAssetId || '');
    if (!key || rwaIds.has(key)) continue;
    rwaIds.add(key);
    markets.push(item);
  }

  const marketIds = new Set(markets.map(item => String(item.sourceAssetId || '')));
  let directoryOnlyCount = 0;
  for (const coin of allCoinsPayload) {
    const id = s(coin?.id);
    const symbol = s(coin?.symbol).toUpperCase();
    const name = s(coin?.name);
    if (!id || !symbol || !name || marketIds.has(id)) continue;
    // Preserve every CoinGecko-listed asset in the directory even when the
    // market-data pages do not include a current quote for it. These entries
    // are discoverable, but are explicitly not represented as priced markets.
    markets.push({
      id: 'SIRE:' + id,
      symbol: symbol + 'USDT',
      name: symbol + '/USDT',
      baseAsset: symbol,
      quote: 'USDT',
      quoteAsset: 'USDT',
      status: 'CATALOG_ONLY',
      tradableOnSire: false,
      marketType: 'Spot',
      marketGroup: 'CRYPTO',
      provider: 'COINGECKO',
      sourceAssetId: id,
      assetName: name,
      logoUrl: '',
      decimals: 8,
    });
    marketIds.add(id);
    directoryOnlyCount++;
  }

  return {
    ok: true,
    provider: 'CoinGecko',
    source: 'CoinGecko full active coin directory + market data + tokenized RWA directory',
    pairPolicy: 'SIRE-managed USDT spot catalog; quotes are reference data, not proof of executable liquidity',
    generatedAt: Date.now(),
    count: markets.length,
    pricedCount: markets.filter(item => Number.isFinite(Number(item.price))).length,
    directoryOnlyCount,
    rwaCount: rwaRows.length,
    assetClasses: [...new Set(markets.map(item => String(item.marketType || 'Crypto Asset')))],
    markets,
  };
}


function buildFallbackCatalog(cause: unknown): Json {
  // Keep the symbol picker usable during a CoinGecko outage/rate limit.
  // This small fallback is explicitly marked as directory-only; the full
  // CoinGecko directory is restored automatically once the API responds.
  const seed: Array<[string, string, string]> = [
    ['bitcoin','BTC','Bitcoin'], ['ethereum','ETH','Ethereum'], ['tether','USDT','Tether'],
    ['binancecoin','BNB','BNB'], ['solana','SOL','Solana'], ['ripple','XRP','XRP'],
    ['usd-coin','USDC','USDC'], ['staked-ether','STETH','Lido Staked Ether'],
    ['dogecoin','DOGE','Dogecoin'], ['tron','TRX','TRON'], ['the-open-network','TON','Toncoin'],
    ['cardano','ADA','Cardano'], ['avalanche-2','AVAX','Avalanche'], ['shiba-inu','SHIB','Shiba Inu'],
    ['chainlink','LINK','Chainlink'], ['bitcoin-cash','BCH','Bitcoin Cash'], ['sui','SUI','Sui'],
    ['polkadot','DOT','Polkadot'], ['litecoin','LTC','Litecoin'], ['stellar','XLM','Stellar'],
    ['hedera-hashgraph','HBAR','Hedera'], ['uniswap','UNI','Uniswap'], ['near','NEAR','NEAR Protocol'],
    ['aptos','APT','Aptos'], ['internet-computer','ICP','Internet Computer'], ['ethereum-classic','ETC','Ethereum Classic'],
    ['render-token','RENDER','Render'], ['cosmos','ATOM','Cosmos'], ['arbitrum','ARB','Arbitrum'],
    ['optimism','OP','Optimism'], ['filecoin','FIL','Filecoin'], ['aave','AAVE','Aave'],
    ['pepe','PEPE','Pepe'], ['bonk','BONK','Bonk'], ['fetch-ai','FET','Artificial Superintelligence Alliance'],
    ['pax-gold','PAXG','PAX Gold'], ['tether-gold','XAUT','Tether Gold']
  ];
  const markets = seed.map(([id, symbol, name]) => ({
    id: 'SIRE:COIN:' + id, symbol: symbol + 'USDT', name: symbol + '/USDT',
    baseAsset: symbol, quote: 'USDT', quoteAsset: 'USDT', status: 'CATALOG_ONLY',
    tradableOnSire: false, marketType: 'Spot', marketGroup: 'CRYPTO',
    provider: 'COINGECKO', sourceAssetId: id, assetName: name, logoUrl: '',
    decimals: 8, dataSource: 'CoinGecko fallback directory (no live quote)'
  }));
  return {
    ok: true, provider: 'CoinGecko', source: 'CoinGecko fallback symbol directory',
    warning: 'CoinGecko API is temporarily rate-limited. Showing a small directory fallback until API access recovers.',
    error: cause instanceof Error ? cause.message : String(cause),
    generatedAt: Date.now(), count: markets.length, pricedCount: 0,
    directoryOnlyCount: markets.length, rwaCount: 0, markets
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
      const fallbackData = buildFallbackCatalog(error);
      cache = { at: Date.now(), data: fallbackData };
      console.warn('[SIRE SPOT] Serving fallback CoinGecko directory:', fallbackData.error);
      return fallbackData;
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
