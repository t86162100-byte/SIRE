/**
 * Live, per-chain token catalog sourced from CoinGecko's published token lists.
 * Catalog presence is discovery metadata only: token metadata and balance must
 * still be verified against the selected chain before an asset is added.
 */
export type CatalogToken = {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
};

const PLATFORM_BY_CHAIN_ID: Record<number, string> = {
  1: 'ethereum',
  8453: 'base',
  42161: 'arbitrum-one',
  10: 'optimistic-ethereum',
  56: 'binance-smart-chain',
  137: 'polygon-pos',
  43114: 'avalanche',
};

const cache = new Map<number, { expiresAt: number; tokens: CatalogToken[] }>();
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

export function getTokenCatalogUrl(chainId: number): string | null {
  const platform = PLATFORM_BY_CHAIN_ID[chainId];
  return platform ? `https://tokens.coingecko.com/${platform}/all.json` : null;
}

export function parseTokenCatalog(payload: unknown, expectedChainId: number): CatalogToken[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { tokens?: unknown }).tokens)) {
    throw new Error('The token catalog returned an invalid response.');
  }
  const seen = new Set<string>();
  const result: CatalogToken[] = [];
  for (const raw of (payload as { tokens: unknown[] }).tokens) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const chainId = Number(t.chainId);
    const address = typeof t.address === 'string' ? t.address : '';
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    const symbol = typeof t.symbol === 'string' ? t.symbol.trim() : '';
    const decimals = Number(t.decimals);
    if (chainId !== expectedChainId || !/^0x[a-fA-F0-9]{40}$/.test(address) ||
        !name || !symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      chainId,
      address,
      name,
      symbol,
      decimals,
      ...(typeof t.logoURI === 'string' && /^https:\/\//i.test(t.logoURI) ? { logoURI: t.logoURI } : {}),
    });
  }
  return result.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.name.localeCompare(b.name));
}

export async function getTokenCatalog(chainId: number, forceRefresh = false): Promise<CatalogToken[]> {
  const url = getTokenCatalogUrl(chainId);
  if (!url) throw new Error('A public token catalog is not configured for this network yet.');
  const existing = cache.get(chainId);
  if (!forceRefresh && existing && existing.expiresAt > Date.now()) return existing.tokens;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Token catalog request failed (${response.status}).`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('Token catalog response is too large.');
  const payload = await response.json();
  const tokens = parseTokenCatalog(payload, chainId);
  if (!tokens.length) throw new Error('No valid tokens were returned for this network.');
  cache.set(chainId, { expiresAt: Date.now() + CACHE_TTL_MS, tokens });
  return tokens;
}
