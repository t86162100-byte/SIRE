import type { SireNetwork } from '../../sireWallet';

type ChainRecord = {
  name?: unknown; shortName?: unknown; chainId?: unknown; network?: unknown;
  rpc?: unknown; nativeCurrency?: unknown; explorers?: unknown; status?: unknown; redFlags?: unknown;
};

const DIRECTORY_URL = 'https://chainid.network/chains_mini.json';
const CACHE_TTL_MS = 30 * 60 * 1000;
let cache: { expiresAt: number; networks: SireNetwork[] } | null = null;

function cleanRpcUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(entry => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && typeof (entry as { url?: unknown }).url === 'string') {
      return (entry as { url: string }).url;
    }
    return '';
  }).filter(url => url.startsWith('https://') && !url.includes('${') &&
    !/localhost|127\.0\.0\.1|\.example\b/i.test(url)))].slice(0, 4);
}

export function parseEvmNetworkDirectory(payload: unknown, knownChainIds: readonly number[] = []): SireNetwork[] {
  if (!Array.isArray(payload)) throw new Error('Network directory returned an invalid response.');
  const known = new Set(knownChainIds);
  const seen = new Set<number>();
  const networks: SireNetwork[] = [];
  for (const item of payload as ChainRecord[]) {
    if (!item || typeof item !== 'object') continue;
    const chainId = Number(item.chainId);
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const native = item.nativeCurrency && typeof item.nativeCurrency === 'object'
      ? item.nativeCurrency as Record<string, unknown> : {};
    const nativeName = typeof native.name === 'string' ? native.name.trim() : '';
    const nativeSymbol = typeof native.symbol === 'string' ? native.symbol.trim() : '';
    const decimals = Number(native.decimals);
    const network = typeof item.network === 'string' ? item.network.toLowerCase() : '';
    const status = typeof item.status === 'string' ? item.status.toLowerCase() : 'active';
    const rpcUrls = cleanRpcUrls(item.rpc);
    if (!Number.isSafeInteger(chainId) || chainId <= 0 || !name || !nativeName || !nativeSymbol ||
      !Number.isInteger(decimals) || decimals < 0 || decimals > 36 || known.has(chainId) || seen.has(chainId) ||
      network === 'testnet' || /testnet|sepolia|goerli|devnet|test network|hoodi/i.test(name) ||
      status === 'deprecated' || rpcUrls.length === 0 ||
      (Array.isArray(item.redFlags) && item.redFlags.length > 0)) continue;
    seen.add(chainId);
    const explorers = Array.isArray(item.explorers) ? item.explorers as Array<Record<string, unknown>> : [];
    const explorerUrl = explorers.map(x => x.url).find((x): x is string =>
      typeof x === 'string' && x.startsWith('https://')) || '';
    networks.push({
      id: `evm-${chainId}`, name, family: 'evm', chainId, nativeSymbol, nativeName,
      rpcUrls, explorerUrl, directorySource: 'chainid.network',
      shortName: typeof item.shortName === 'string' ? item.shortName : '',
    } as SireNetwork);
  }
  return networks.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getEvmNetworkDirectory(
  knownChainIds: readonly number[] = [], fetchImpl: typeof fetch = fetch, forceRefresh = false,
): Promise<SireNetwork[]> {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) {
    const known = new Set(knownChainIds);
    return cache.networks.filter(n => !known.has(n.chainId));
  }
  const response = await fetchImpl(DIRECTORY_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Network directory request failed (${response.status}).`);
  const networks = parseEvmNetworkDirectory(await response.json());
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, networks };
  const known = new Set(knownChainIds);
  return networks.filter(n => !known.has(n.chainId));
}


export type DiscoveredCatalogNetwork = SireNetwork & { family: 'catalog'; catalogSlug: string };

/** Load chain folders directly from Trust Wallet's maintained asset repository.
 * This directory is discovery metadata only; it does not imply wallet-operation support.
 */
export async function getTrustWalletChainDirectory(fetchImpl: typeof fetch = fetch, forceRefresh = false): Promise<DiscoveredCatalogNetwork[]> {
  const key = 'sire.trustwallet.chain-directory.v1';
  const ttl = 30 * 60 * 1000;
  if (!forceRefresh && typeof sessionStorage !== 'undefined') {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved) as { expiresAt: number; networks: DiscoveredCatalogNetwork[] };
        if (parsed.expiresAt > Date.now() && Array.isArray(parsed.networks)) return parsed.networks;
      }
    } catch { /* ignore invalid local cache */ }
  }
  const response = await fetchImpl('https://api.github.com/repos/trustwallet/assets/contents/blockchains?ref=master', {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`Asset network directory request failed (${response.status}).`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('Asset network directory returned an invalid response.');
  const networks: DiscoveredCatalogNetwork[] = payload
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .filter(entry => entry.type === 'dir' && typeof entry.name === 'string' && /^[a-z0-9][a-z0-9_-]{0,60}$/i.test(entry.name))
    .map(entry => {
      const slug = String(entry.name);
      const name = slug.split(/[-_]/g).map(part => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
      return {
        id: `catalog-${slug}`, name, family: 'catalog' as const, chainId: -1,
        nativeSymbol: '', nativeName: name, rpcUrls: [], explorerUrl: '',
        directorySource: 'trustwallet/assets', catalogSlug: slug,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  if (typeof sessionStorage !== 'undefined') {
    try { sessionStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + ttl, networks })); } catch { /* storage is optional */ }
  }
  return networks;
}
