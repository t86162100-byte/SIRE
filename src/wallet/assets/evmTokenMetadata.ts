import { Interface, JsonRpcProvider, getAddress } from 'ethers';

const tokenInterface = new Interface([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

export type EvmTokenMetadata = { address: string; name: string; symbol: string; decimals: number };

/** Reads metadata from the selected chain. No guessed symbol/name/decimals fallback. */
export async function readEvmTokenMetadata(rpcUrls: readonly string[], contractAddress: string, chainId: number): Promise<EvmTokenMetadata> {
  const address = getAddress(contractAddress);
  if (!rpcUrls.length) throw new Error('No RPC endpoints are configured for this network.');
  let lastError: unknown;

  for (const rpcUrl of rpcUrls) {
    const provider = new JsonRpcProvider(rpcUrl);
    try {
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(chainId)) throw new Error(`RPC chain mismatch: expected ${chainId}, received ${network.chainId.toString()}.`);
      const [nameRaw, symbolRaw, decimalsRaw] = await Promise.all([
        provider.call({ to: address, data: tokenInterface.encodeFunctionData('name') }),
        provider.call({ to: address, data: tokenInterface.encodeFunctionData('symbol') }),
        provider.call({ to: address, data: tokenInterface.encodeFunctionData('decimals') }),
      ]);
      const [name] = tokenInterface.decodeFunctionResult('name', nameRaw);
      const [symbol] = tokenInterface.decodeFunctionResult('symbol', symbolRaw);
      const [decimals] = tokenInterface.decodeFunctionResult('decimals', decimalsRaw);
      const normalizedName = String(name).trim();
      const normalizedSymbol = String(symbol).trim();
      const normalizedDecimals = Number(decimals);
      if (!normalizedName || !normalizedSymbol || !Number.isInteger(normalizedDecimals) || normalizedDecimals < 0 || normalizedDecimals > 255) {
        throw new Error('The contract returned invalid token metadata.');
      }
      return { address, name: normalizedName, symbol: normalizedSymbol, decimals: normalizedDecimals };
    } catch (error) {
      lastError = error;
    } finally {
      provider.destroy();
    }
  }

  throw new Error(lastError instanceof Error ? `Could not read token metadata from this chain: ${lastError.message}` : 'Could not read token metadata from the configured RPC providers.');
}
