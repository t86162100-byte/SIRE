import { HDNodeWallet, getAddress, isAddress, type TransactionRequest } from 'ethers';
import type { WalletAccount, WalletChain } from '../types';
import { requestEvmRpc } from '../providers/evmRpc';

function requireEvmChain(chain: WalletChain): asserts chain is WalletChain & { family: 'evm'; chainId: number } {
  if (chain.family !== 'evm' || typeof chain.chainId !== 'number' || chain.rpcUrls.length === 0) {
    throw new Error(`No verified EVM adapter is available for ${chain.id}.`);
  }
}

export function deriveEvmAccount(mnemonic: string, chain: WalletChain, accountIndex = 0): WalletAccount {
  requireEvmChain(chain);
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > 10000) {
    throw new Error('Account index must be an integer between 0 and 10000.');
  }
  const phrase = mnemonic.trim().replace(/\s+/g, ' ');
  if (!phrase) throw new Error('Recovery phrase is required.');
  const path = `m/44'/60'/0'/0/${accountIndex}`;
  const wallet = HDNodeWallet.fromPhrase(phrase, undefined, path);
  return {
    id: `${chain.id}:${accountIndex}`,
    chainId: chain.id,
    address: wallet.address,
    derivationPath: path,
    publicKey: wallet.publicKey,
  };
}

export function validateEvmAddress(address: string): boolean {
  if (!isAddress(address)) return false;
  try {
    return getAddress(address).length === 42;
  } catch {
    return false;
  }
}

export async function getEvmNativeBalance(chain: WalletChain, address: string): Promise<string> {
  requireEvmChain(chain);
  if (!validateEvmAddress(address)) throw new Error('Invalid EVM account address.');
  const result = await requestEvmRpc<string>({
    rpcUrls: chain.rpcUrls,
    expectedChainId: chain.chainId,
    method: 'eth_getBalance',
    params: [getAddress(address), 'latest'],
  });
  if (!/^0x[0-9a-fA-F]+$/.test(result)) throw new Error('RPC returned an invalid native balance.');
  return BigInt(result).toString();
}

export async function getEvmTokenBalance(chain: WalletChain, contract: string, address: string): Promise<string> {
  requireEvmChain(chain);
  if (!validateEvmAddress(contract)) throw new Error('Invalid ERC-20 contract address.');
  if (!validateEvmAddress(address)) throw new Error('Invalid EVM account address.');
  const data = `0x70a08231${getAddress(address).slice(2).toLowerCase().padStart(64, '0')}`;
  const result = await requestEvmRpc<string>({
    rpcUrls: chain.rpcUrls,
    expectedChainId: chain.chainId,
    method: 'eth_call',
    params: [{ to: getAddress(contract), data }, 'latest'],
  });
  if (!/^0x[0-9a-fA-F]+$/.test(result)) throw new Error('RPC returned an invalid token balance.');
  return BigInt(result).toString();
}

/**
 * Signs and broadcasts only after the target RPC's chain identity is verified.
 * UI must display and obtain approval for the complete transaction before calling.
 */
export async function signAndBroadcastEvmTransaction(
  chain: WalletChain,
  mnemonic: string,
  request: TransactionRequest,
  accountIndex = 0,
): Promise<string> {
  requireEvmChain(chain);
  if (!validateEvmAddress(String(request.to ?? ''))) throw new Error('A valid destination address is required.');
  const path = `m/44'/60'/0'/0/${accountIndex}`;
  const signer = HDNodeWallet.fromPhrase(mnemonic.trim().replace(/\s+/g, ' '), undefined, path);
  const { JsonRpcProvider } = await import('ethers');
  const provider = new JsonRpcProvider(chain.rpcUrls[0]);
  try {
    const actual = await provider.getNetwork();
    if (actual.chainId !== BigInt(chain.chainId)) {
      throw new Error(`RPC chain mismatch: expected ${chain.chainId}, received ${actual.chainId.toString()}.`);
    }
    const populated = await signer.connect(provider).populateTransaction({
      ...request,
      to: getAddress(String(request.to)),
      from: signer.address,
      chainId: chain.chainId,
    });
    const signed = await signer.signTransaction(populated);
    const hash = await requestEvmRpc<string>({
      rpcUrls: chain.rpcUrls,
      expectedChainId: chain.chainId,
      method: 'eth_sendRawTransaction',
      params: [signed],
    });
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('RPC returned an invalid transaction hash.');
    return hash;
  } finally {
    provider.destroy();
  }
}
