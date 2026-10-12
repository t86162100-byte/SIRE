import type { CatalogToken } from './tokenCatalog';

export type CatalogNetwork = { id: string; family: string; chainId?: number };

const TRUST_WALLET_LISTS: Record<string, string> = {
  tron: 'tron',
  solana: 'solana',
  ton: 'ton',
  ethereum: 'ethereum',
  base: 'base',
  'bnb-smart-chain': 'smartchain',
  polygon: 'polygon',
  'arbitrum-one': 'arbitrum',
  optimism: 'optimism',
  'avalanche-c': 'avalanche',
};

const cache = new Map<string, { expiresAt: number; tokens: CatalogToken[] }>();
const TTL_MS = 30 * 60 * 1000;

function parseTrustWalletList(payload: unknown, chainId: number, evm: boolean): CatalogToken[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { tokens?: unknown }).tokens)) {
    throw new Error('The chain token directory returned an invalid response.');
  }
  const seen = new Set<string>();
  const result: CatalogToken[] = [];
  for (const raw of (payload as { tokens: unknown[] }).tokens) {
    if (!raw || typeof raw !== 'object') continue;
    const token = raw as Record<string, unknown>;
    const address = typeof token.address === 'string' ? token.address.trim() : '';
    const name = typeof token.name === 'string' ? token.name.trim() : '';
    const symbol = typeof token.symbol === 'string' ? token.symbol.trim() : '';
    const decimals = Number(token.decimals);
    if (!address || !name || !symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) continue;
    if (evm && (!/^0x[a-fA-F0-9]{40}$/.test(address) || (token.chainId != null && Number(token.chainId) !== chainId))) continue;
    if (!evm && !/^[1-9A-HJ-NP-Za-km-z]{20,64}$/.test(address) && !/^\d+$/.test(address)) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      chainId,
      address,
      name,
      symbol,
      decimals,
      ...(typeof token.logoURI === 'string' && /^https:\/\//i.test(token.logoURI) ? { logoURI: token.logoURI } : {}),
    });
  }
  return result.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.name.localeCompare(b.name));
}

/** Browse-only catalogs for non-EVM chains. This does not enable wallet operations on those chains. */
export async function getMultiChainTokenCatalog(
  network: CatalogNetwork,
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogToken[]> {
  if (network.family === 'evm' && typeof network.chainId === 'number') {
    const { getTokenCatalog } = await import('./tokenCatalog');
    return getTokenCatalog(network.chainId);
  }
  const slug = TRUST_WALLET_LISTS[network.id];
  if (!slug) throw new Error('No public token catalog is configured for this network yet.');
  const cached = cache.get(network.id);
  if (cached && cached.expiresAt > Date.now()) return cached.tokens;
  const response = await fetchImpl(`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${slug}/tokenlist.json`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Token directory request failed (${response.status}).`);
  const payload: unknown = await response.json();
  const tokens = parseTrustWalletList(payload, network.chainId ?? -1, network.family === 'evm');
  if (!tokens.length) throw new Error('This chain token directory returned no usable entries.');
  cache.set(network.id, { expiresAt: Date.now() + TTL_MS, tokens });
  return tokens;
}
