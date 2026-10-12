import { Interface, getAddress } from 'ethers';
import type { WalletAsset, WalletChain } from '../types';
import { requestEvmRpc } from '../providers/evmRpc';

const erc20 = new Interface([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
]);

export type EvmAssetDiscoveryResult = { assets: WalletAsset[]; warnings: string[] };
export type EvmAssetDiscoveryOptions = {
  chain: WalletChain;
  address: string;
  /** Explicit token contracts from the user's saved list or a trusted token source. */
  tokenContracts?: readonly string[];
  fetchImpl?: typeof fetch;
};

/**
 * Reads the native balance and the balances of explicitly supplied ERC-20
 * contracts. It intentionally does not claim to enumerate every token on a
 * chain; that requires a chain-specific indexer with documented coverage.
 */
export async function discoverEvmAssets(options: EvmAssetDiscoveryOptions): Promise<EvmAssetDiscoveryResult> {
  const { chain, tokenContracts = [], fetchImpl } = options;
  if (chain.family !== 'evm' || typeof chain.chainId !== 'number' || chain.rpcUrls.length === 0) {
    throw new Error('This chain does not have a configured EVM discovery adapter.');
  }
  const owner = getAddress(options.address);
  const request = <T>(method: string, params: unknown[]) => requestEvmRpc<T>({
    rpcUrls: chain.rpcUrls,
    expectedChainId: chain.chainId as number,
    method,
    params,
    fetchImpl,
  });
  const nativeBalance = await request<string>('eth_getBalance', [owner, 'latest']);
  const assets: WalletAsset[] = [{
    id: { chainId: chain.id, assetRef: chain.nativeAsset.id },
    kind: 'native',
    name: chain.nativeAsset.name,
    symbol: chain.nativeAsset.symbol,
    decimals: chain.nativeAsset.decimals,
    balanceBaseUnits: BigInt(nativeBalance).toString(),
    metadataSource: 'chain-registry',
    metadataUpdatedAt: new Date().toISOString(),
    verification: 'verified',
  }];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const rawContract of tokenContracts) {
    let contract: string;
    try { contract = getAddress(rawContract); }
    catch { warnings.push('Skipped an invalid token contract address.'); continue; }
    const key = contract.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const [nameRaw, symbolRaw, decimalsRaw, balanceRaw] = await Promise.all([
        request<string>('eth_call', [{ to: contract, data: erc20.encodeFunctionData('name') }, 'latest']),
        request<string>('eth_call', [{ to: contract, data: erc20.encodeFunctionData('symbol') }, 'latest']),
        request<string>('eth_call', [{ to: contract, data: erc20.encodeFunctionData('decimals') }, 'latest']),
        request<string>('eth_call', [{ to: contract, data: erc20.encodeFunctionData('balanceOf', [owner]) }, 'latest']),
      ]);
      const [name] = erc20.decodeFunctionResult('name', nameRaw);
      const [symbol] = erc20.decodeFunctionResult('symbol', symbolRaw);
      const [decimals] = erc20.decodeFunctionResult('decimals', decimalsRaw);
      const normalizedName = String(name).trim();
      const normalizedSymbol = String(symbol).trim();
      const normalizedDecimals = Number(decimals);
      if (!normalizedName || !normalizedSymbol || !Number.isInteger(normalizedDecimals) || normalizedDecimals < 0 || normalizedDecimals > 255) {
        throw new Error('Contract metadata is invalid.');
      }
      assets.push({
        id: { chainId: chain.id, assetRef: key },
        kind: 'token',
        name: normalizedName,
        symbol: normalizedSymbol,
        decimals: normalizedDecimals,
        balanceBaseUnits: BigInt(balanceRaw).toString(),
        metadataSource: 'erc20-contract',
        metadataUpdatedAt: new Date().toISOString(),
        verification: 'verified',
      });
    } catch {
      warnings.push(`Could not verify token metadata or balance for ${contract}; it was omitted.`);
    }
  }
  return { assets, warnings };
}
