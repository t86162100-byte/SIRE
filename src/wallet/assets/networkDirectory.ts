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
      status === 'deprecated' || status === 'incubating' || rpcUrls.length === 0 ||
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
