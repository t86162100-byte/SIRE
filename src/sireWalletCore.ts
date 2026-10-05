import { HDNodeWallet, JsonRpcProvider, Wallet, type Provider, type TransactionRequest } from 'ethers';

export type SireEvmNetwork = {
  name: string;
  chainId: number;
  rpcUrl: string;
  rpcUrls?: string[];
  nativeSymbol: string;
};

const STORAGE_KEY = 'sire.wallet.keystore.v1';

export const SIRE_EVM_NETWORKS: Record<string, SireEvmNetwork> = {
  Ethereum: { name: 'Ethereum', chainId: 1, rpcUrl: 'https://ethereum-rpc.publicnode.com', rpcUrls: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://cloudflare-eth.com'], nativeSymbol: 'ETH' },
  'BNB Chain': { name: 'BNB Chain', chainId: 56, rpcUrl: 'https://bsc-dataseed.binance.org', rpcUrls: ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.binance.org', 'https://bsc-rpc.publicnode.com'], nativeSymbol: 'BNB' },
  Base: { name: 'Base', chainId: 8453, rpcUrl: 'https://mainnet.base.org', rpcUrls: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'], nativeSymbol: 'ETH' },
  Arbitrum: { name: 'Arbitrum', chainId: 42161, rpcUrl: 'https://arb1.arbitrum.io/rpc', rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'], nativeSymbol: 'ETH' },
  Optimism: { name: 'Optimism', chainId: 10, rpcUrl: 'https://mainnet.optimism.io', rpcUrls: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'], nativeSymbol: 'ETH' },
  Polygon: { name: 'Polygon', chainId: 137, rpcUrl: 'https://polygon-rpc.com', rpcUrls: ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com'], nativeSymbol: 'POL' },
  Avalanche: { name: 'Avalanche', chainId: 43114, rpcUrl: 'https://api.avax.network/ext/bc/C/rpc', rpcUrls: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com'], nativeSymbol: 'AVAX' },
};

type StoredWallet = {
  version: 1;
  address: string;
  keystore: string;
  createdAt: string;
};

type SireWalletSigner = HDNodeWallet | Wallet;

let unlockedWallet: SireWalletSigner | null = null;
let pendingWallet: HDNodeWallet | null = null;

function storageAvailable() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function saveStoredWallet(value: StoredWallet) {
  if (!storageAvailable()) throw new Error('SIRE Wallet storage is unavailable in this browser.');
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function loadStoredWallet(): StoredWallet | null {
  if (!storageAvailable()) return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredWallet;
    if (parsed?.version !== 1 || !parsed.address || !parsed.keystore) return null;
    return parsed;
  } catch {
    return null;
  }
}

function validatePassword(password: string) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('SIRE Wallet password must contain at least 8 characters.');
  }
}

function emitState() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('sire:native-wallet-state', {
    detail: {
      address: unlockedWallet?.address || loadStoredWallet()?.address || '',
      unlocked: Boolean(unlockedWallet),
      hasWallet: Boolean(loadStoredWallet()),
    },
  }));
}

export function hasNativeWallet() {
  return Boolean(loadStoredWallet());
}

export function isNativeWalletUnlocked() {
  return Boolean(unlockedWallet);
}

export function getNativeWalletAddress() {
  return unlockedWallet?.address || loadStoredWallet()?.address || '';
}

export function prepareNativeWallet() {
  if (hasNativeWallet()) throw new Error('A SIRE Wallet already exists on this device.');
  pendingWallet = HDNodeWallet.createRandom();
  return { address: pendingWallet.address, mnemonic: pendingWallet.mnemonic?.phrase || '' };
}

export async function finalizePreparedNativeWallet(password: string) {
  validatePassword(password);
  if (hasNativeWallet()) throw new Error('A SIRE Wallet already exists on this device.');
  if (!pendingWallet) throw new Error('No pending wallet creation session.');
  const wallet = pendingWallet;
  const keystore = await wallet.encrypt(password);
  saveStoredWallet({ version: 1, address: wallet.address, keystore, createdAt: new Date().toISOString() });
  pendingWallet = null;
  unlockedWallet = wallet;
  emitState();
  return { address: wallet.address };
}

export function cancelPreparedNativeWallet() {
  pendingWallet = null;
}

export async function createNativeWallet(password: string) {
  validatePassword(password);
  if (hasNativeWallet()) throw new Error('A SIRE Wallet already exists on this device.');
  const wallet = HDNodeWallet.createRandom();
  const keystore = await wallet.encrypt(password);
  saveStoredWallet({
    version: 1,
    address: wallet.address,
    keystore,
    createdAt: new Date().toISOString(),
  });
  unlockedWallet = wallet;
  emitState();
  return { address: wallet.address, mnemonic: wallet.mnemonic?.phrase || '' };
}

export async function importNativeWalletFromMnemonic(password: string, mnemonic: string, accountIndex = 0) {
  validatePassword(password);
  if (hasNativeWallet()) throw new Error('A SIRE Wallet already exists on this device.');
  const phrase = mnemonic.trim().replace(/\\s+/g, ' ');
  if (!phrase) throw new Error('Enter a recovery phrase.');
  const path = `m/44'/60'/0'/0/${Math.max(0, Math.floor(accountIndex))}`;
  const wallet = HDNodeWallet.fromPhrase(phrase, undefined, path);
  const keystore = await wallet.encrypt(password);
  saveStoredWallet({
    version: 1,
    address: wallet.address,
    keystore,
    createdAt: new Date().toISOString(),
  });
  unlockedWallet = wallet;
  emitState();
  return { address: wallet.address };
}

export async function importNativeWalletFromPrivateKey(password: string, privateKey: string) {
  validatePassword(password);
  if (hasNativeWallet()) throw new Error('A SIRE Wallet already exists on this device.');
  const key = privateKey.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Invalid EVM private key.');
  const wallet = new Wallet(key);
  const keystore = await wallet.encrypt(password);
  saveStoredWallet({
    version: 1,
    address: wallet.address,
    keystore,
    createdAt: new Date().toISOString(),
  });
  unlockedWallet = wallet;
  emitState();
  return { address: wallet.address };
}

export async function unlockNativeWallet(password: string) {
  validatePassword(password);
  const stored = loadStoredWallet();
  if (!stored) throw new Error('No SIRE Wallet exists on this device.');
  const wallet = await Wallet.fromEncryptedJson(stored.keystore, password);
  if (wallet.address.toLowerCase() !== stored.address.toLowerCase()) {
    throw new Error('Wallet integrity check failed.');
  }
  unlockedWallet = wallet;
  emitState();
  return { address: wallet.address };
}

export function lockNativeWallet() {
  unlockedWallet = null;
  emitState();
}

export function deleteNativeWallet() {
  lockNativeWallet();
  if (storageAvailable()) window.localStorage.removeItem(STORAGE_KEY);
  emitState();
}

export async function exportNativeMnemonic() {
  if (!unlockedWallet) throw new Error('Unlock SIRE Wallet before exporting recovery information.');
  const phrase = 'mnemonic' in unlockedWallet ? unlockedWallet.mnemonic?.phrase : undefined;
  if (!phrase) throw new Error('This wallet does not expose a mnemonic recovery phrase.');
  return phrase;
}

export function getNativeProvider(network: SireEvmNetwork): Provider {
  // Do not use ethers FallbackProvider here. Public RPCs can disagree on
  // transient errors/zero-value responses, which can surface as
  // "quorum not met" in the wallet UI. Each network therefore has one
  // deterministic primary provider; balance reads below explicitly retry
  // the configured fallbacks when the primary fails.
  return new JsonRpcProvider(network.rpcUrl, network.chainId, { staticNetwork: true });
}

export function getNativeSigner(network: SireEvmNetwork) {
  if (!unlockedWallet) throw new Error('Unlock SIRE Wallet before signing.');
  return unlockedWallet.connect(getNativeProvider(network));
}

export async function getNativeBalance(network: SireEvmNetwork, address = getNativeWalletAddress()) {
  if (!address) return 0n;
  const urls = Array.from(new Set([network.rpcUrl, ...(network.rpcUrls || [])]));
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const provider = new JsonRpcProvider(url, network.chainId, { staticNetwork: true });
      return await provider.getBalance(address);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('EVM balance RPCs are temporarily unavailable.');
}

function isRetryableRpcError(error: any) {
  const code = String(error?.code || '');
  const message = String(error?.message || error || '').toLowerCase();
  if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') return true;
  if (code === 'SERVER_ERROR' && !error?.response) return true;
  return /failed to fetch|fetch failed|network|timeout|timed out|econn|enotfound|socket/i.test(message);
}

export async function sendNativeTransaction(network: SireEvmNetwork, request: TransactionRequest) {
  if (!unlockedWallet) throw new Error('Unlock SIRE Wallet before signing.');
  const rpc = async (method: string, params: any[]) => {
    if (typeof window === 'undefined') throw new Error('Browser RPC proxy unavailable.');
    const response = await fetch('/api/sire/evm/rpc', {
      method:'POST',
      headers:{'content-type':'application/json','accept':'application/json'},
      body:JSON.stringify({network:network.name,method,params}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      const detail = String(payload?.error || payload?.detail || ('HTTP ' + response.status));
      throw new Error(detail);
    }
    return payload?.result;
  };

  try {
    // Nonce is read through the same-origin Render proxy. The private key never
    // leaves this browser; only the signed raw transaction is sent to the server.
    const nonce = request.nonce ?? Number(BigInt(await rpc('eth_getTransactionCount',[unlockedWallet.address,'pending'])));
    const tx: TransactionRequest = {
      ...request,
      from: unlockedWallet.address,
      chainId: network.chainId,
      nonce,
    };
    if (tx.gasLimit == null && tx.gas == null) {
      throw new Error('Executable transaction is missing a gas limit.');
    }

    // Sign locally. The raw signed transaction is the only wallet-sensitive
    // transaction material sent to Render for broadcast.
    const signedTransaction = await unlockedWallet.signTransaction(tx);
    const hash = await rpc('eth_sendRawTransaction',[signedTransaction]);
    if (!hash) throw new Error('RPC accepted the transaction but returned no transaction hash.');

    return {
      hash: String(hash),
      wait: async () => waitForNativeTransaction(network, String(hash)),
    };
  } catch (error: any) {
    const detail = error instanceof Error ? error.message : String(error || '');
    if (/failed to fetch|fetch failed|network|timeout|econn|enotfound|socket/i.test(detail)) {
      throw new Error('SIRE transaction RPC proxy unavailable: ' + detail);
    }
    throw error;
  }
}

export async function waitForNativeTransaction(network: SireEvmNetwork, hash: string, timeoutMs = 180000) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch('/api/sire/evm/rpc', {
        method:'POST',
        headers:{'content-type':'application/json','accept':'application/json'},
        body:JSON.stringify({network:network.name,method:'eth_getTransactionReceipt',params:[hash]}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) throw new Error(String(payload?.error || payload?.detail || ('HTTP ' + response.status)));
      if (payload?.result) {
        const status = payload.result.status == null ? 1 : Number(BigInt(payload.result.status));
        return { ...payload.result, status };
      }
    } catch (error: any) {
      lastError = error instanceof Error ? error.message : String(error || '');
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error('Transaction confirmation timed out.' + (lastError ? ' Last RPC error: ' + lastError : ''));
}

export function getStoredWalletMetadata() {
  const stored = loadStoredWallet();
  return stored ? { address: stored.address, createdAt: stored.createdAt } : null;
}
