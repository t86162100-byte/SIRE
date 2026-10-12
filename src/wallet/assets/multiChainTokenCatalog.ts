import type { CatalogToken } from './tokenCatalog';

export type CatalogNetwork = { id: string; family: string; chainId?: number };

const TRUST_WALLET_LISTS: Record<string, string> = {
  tron: 'tron', solana: 'solana', ton: 'ton',
  ethereum: 'ethereum', base: 'base', 'bnb-smart-chain': 'smartchain',
  polygon: 'polygon', 'arbitrum-one': 'arbitrum', optimism: 'optimism', 'avalanche-c': 'avalanchec',
};
const UNISWAP_LIST_URL = 'https://tokens.uniswap.org';
const cache = new Map<string, { expiresAt: number; tokens: CatalogToken[] }>();
const TTL_MS = 30 * 60 * 1000;

function parseTokenList(payload: unknown, chainId: number, family: string): CatalogToken[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { tokens?: unknown }).tokens)) {
    throw new Error('The chain token directory returned an invalid response.');
  }
  const evm = family === 'evm';
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
    if (evm && (!/^0x[a-fA-F0-9]{40}$/.test(address) ||
      (token.chainId != null && Number(token.chainId) !== chainId))) continue;
    if (!evm && !(
      /^[1-9A-HJ-NP-Za-km-z]{20,64}$/.test(address) ||
      /^(EQ|UQ)[A-Za-z0-9_-]{46,48}$/.test(address) ||
      /^[0-9a-fA-F]{64}$/.test(address) || /^\d+$/.test(address)
    )) continue;
    const key = evm ? address.toLowerCase() : address;
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

async function fetchList(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Token directory request failed (${response.status}).`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 20 * 1024 * 1024) throw new Error('Token directory response is too large.');
  return response.json();
}

/** Discovery metadata only; it does not enable wallet operations for a chain. */
export async function getMultiChainTokenCatalog(
  network: CatalogNetwork,
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogToken[]> {
  const cached = cache.get(network.id);
  if (cached && cached.expiresAt > Date.now()) return cached.tokens;

  let tokens: CatalogToken[] = [];
  let firstError: unknown;
  if (network.family === 'evm' && typeof network.chainId === 'number') {
    try {
      const { getTokenCatalog } = await import('./tokenCatalog');
      tokens = await getTokenCatalog(network.chainId);
    } catch (error) {
      firstError = error;
      try {
        tokens = parseTokenList(await fetchList(UNISWAP_LIST_URL, fetchImpl), network.chainId, 'evm');
      } catch {
        if (firstError instanceof Error) throw new Error(`${firstError.message} Community fallback also failed.`);
        throw new Error('No public token catalog is available for this EVM network.');
      }
    }
  } else {
    const slug = TRUST_WALLET_LISTS[network.id];
    if (!slug) throw new Error('No public token catalog is configured for this network yet.');
    tokens = parseTokenList(
      await fetchList(`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${slug}/tokenlist.json`, fetchImpl),
      network.chainId ?? -1,
      network.family,
    );
  }
  if (!tokens.length) throw new Error('This chain token directory returned no usable entries.');
  cache.set(network.id, { expiresAt: Date.now() + TTL_MS, tokens });
  return tokens;
}
