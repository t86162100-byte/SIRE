import { JsonRpcProvider, Wallet, HDNodeWallet, formatEther, parseEther, Contract } from 'ethers';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import TronWeb from 'tronweb';
import {
  SIRE_EVM_NETWORKS,
  getNativeProvider,
  getNativeSigner,
  getNativeWalletAddress,
  isNativeWalletUnlocked,
  unlockNativeWallet,
} from './sireWalletCore';

export type WalletNetwork = 'Ethereum' | 'BNB Chain' | 'Base' | 'Arbitrum' | 'Optimism' | 'Polygon' | 'Avalanche' | 'Solana' | 'TRON';

export type WalletAsset = {
  id: string;
  network: WalletNetwork;
  symbol: string;
  name: string;
  address?: string;
  decimals: number;
  balance: string;
  rawBalance: string;
  native: boolean;
  logoURI?: string;
  priceUSD?: number;
};

export type WalletHistoryItem = {
  id: string;
  network: WalletNetwork;
  hash: string;
  timestamp?: number;
  direction: 'send' | 'receive' | 'contract' | 'unknown';
  amount?: string;
  symbol?: string;
  from?: string;
  to?: string;
  status: 'confirmed' | 'pending' | 'failed';
  explorerUrl: string;
};

export const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
export const TRON_RPC = 'https://api.trongrid.io';

const MULTI_STORAGE = 'sire.wallet.multichain.v1';
const PBKDF_ITERATIONS = 250000;

type MultiStore = {
  version: 1;
  solana?: { address: string; encrypted: string };
  tron?: { address: string; encrypted: string };
  importedEvmTokens: Array<{ network: WalletNetwork; address: string; symbol: string; name: string; decimals: number; logoURI?: string }>;
};

const EVM_EXPLORERS: Record<string, string> = {
  Ethereum: 'https://etherscan.io',
  'BNB Chain': 'https://bscscan.com',
  Base: 'https://basescan.org',
  Arbitrum: 'https://arbiscan.io',
  Optimism: 'https://optimistic.etherscan.io',
  Polygon: 'https://polygonscan.com',
  Avalanche: 'https://snowtrace.io',
};

const SOLANA_EXPLORER = 'https://explorer.solana.com';
const TRON_EXPLORER = 'https://tronscan.org';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function transfer(address,uint256) returns (bool)',
];

function readStore(): MultiStore {
  if (typeof window === 'undefined') return { version: 1, importedEvmTokens: [] };
  try {
    const raw = window.localStorage.getItem(MULTI_STORAGE);
    if (!raw) return { version: 1, importedEvmTokens: [] };
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      solana: parsed.solana,
      tron: parsed.tron,
      importedEvmTokens: Array.isArray(parsed.importedEvmTokens) ? parsed.importedEvmTokens : [],
    };
  } catch {
    return { version: 1, importedEvmTokens: [] };
  }
}

function writeStore(store: MultiStore) {
  if (typeof window === 'undefined') throw new Error('Wallet storage is unavailable.');
  window.localStorage.setItem(MULTI_STORAGE, JSON.stringify(store));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function deriveKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptSecret(secret: Uint8Array, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, secret);
  return JSON.stringify({ v: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(ciphertext)) });
}

async function decryptSecret(payload: string, password: string) {
  const parsed = JSON.parse(payload);
  const key = await deriveKey(password, base64ToBytes(parsed.salt));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(parsed.iv) }, key, base64ToBytes(parsed.data));
  return new Uint8Array(plaintext);
}

function requireUnlocked() {
  if (!isNativeWalletUnlocked()) throw new Error('Unlock SIRE Wallet before managing assets.');
}

function networkOrThrow(name: WalletNetwork) {
  const network = SIRE_EVM_NETWORKS[name];
  if (!network) throw new Error('This operation is not available on that network.');
  return network;
}

export function getSupportedWalletNetworks(): WalletNetwork[] {
  return ['Ethereum', 'BNB Chain', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'Solana', 'TRON'];
}

export function getStoredMultiChainMetadata() {
  const store = readStore();
  return {
    solanaAddress: store.solana?.address || '',
    tronAddress: store.tron?.address || '',
    importedEvmTokens: store.importedEvmTokens,
  };
}

export async function createSolanaAccount(password: string) {
  requireUnlocked();
  const store = readStore();
  if (store.solana) return { address: store.solana.address };
  const keypair = Keypair.generate();
  store.solana = { address: keypair.publicKey.toBase58(), encrypted: await encryptSecret(keypair.secretKey, password) };
  writeStore(store);
  return { address: store.solana.address };
}

export async function importSolanaAccount(password: string, secretKey: string) {
  requireUnlocked();
  const bytes = Uint8Array.from(JSON.parse(secretKey));
  const keypair = Keypair.fromSecretKey(bytes);
  const store = readStore();
  store.solana = { address: keypair.publicKey.toBase58(), encrypted: await encryptSecret(keypair.secretKey, password) };
  writeStore(store);
  return { address: store.solana.address };
}

async function loadSolanaKeypair(password: string) {
  const record = readStore().solana;
  if (!record) throw new Error('No Solana account has been created.');
  const secret = await decryptSecret(record.encrypted, password);
  return Keypair.fromSecretKey(secret);
}

export async function getSolanaBalance(address = readStore().solana?.address) {
  if (!address) return 0;
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  return (await connection.getBalance(new PublicKey(address))) / LAMPORTS_PER_SOL;
}

export async function sendSolana(password: string, to: string, amountSol: string) {
  requireUnlocked();
  const keypair = await loadSolanaKeypair(password);
  const destination = new PublicKey(to);
  const amount = Number(amountSol);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid SOL amount.');
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  const transaction = new Transaction().add(SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: destination,
    lamports: Math.round(amount * LAMPORTS_PER_SOL),
  }));
  const signature = await sendAndConfirmTransaction(connection, transaction, [keypair], { commitment: 'confirmed' });
  return { hash: signature, explorerUrl: SOLANA_EXPLORER + '/tx/' + signature };
}

export async function getSolanaHistory(address = readStore().solana?.address): Promise<WalletHistoryItem[]> {
  if (!address) return [];
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  const signatures = await connection.getSignaturesForAddress(new PublicKey(address), { limit: 50 });
  return signatures.map(item => ({
    id: 'sol:' + item.signature,
    network: 'Solana',
    hash: item.signature,
    timestamp: item.blockTime ? item.blockTime * 1000 : undefined,
    direction: 'unknown',
    status: item.err ? 'failed' : 'confirmed',
    explorerUrl: SOLANA_EXPLORER + '/tx/' + item.signature,
  }));
}

export async function createTronAccount(password: string) {
  requireUnlocked();
  const store = readStore();
  if (store.tron) return { address: store.tron.address };
  const account = TronWeb.utils.accounts.generateAccount();
  const privateKeyBytes = Uint8Array.from(account.privateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  store.tron = { address: account.address.base58, encrypted: await encryptSecret(privateKeyBytes, password) };
  writeStore(store);
  return { address: store.tron.address };
}

async function loadTronPrivateKey(password: string) {
  const record = readStore().tron;
  if (!record) throw new Error('No TRON account has been created.');
  return Array.from(await decryptSecret(record.encrypted, password), byte => byte.toString(16).padStart(2, '0')).join('');
}

function tronClient(privateKey?: string) {
  return new TronWeb({ fullHost: TRON_RPC, privateKey });
}

export async function getTronBalance(address = readStore().tron?.address) {
  if (!address) return 0;
  const tron = tronClient();
  return Number(await tron.trx.getBalance(address)) / 1e6;
}

export async function sendTron(password: string, to: string, amountTrx: string) {
  requireUnlocked();
  const privateKey = await loadTronPrivateKey(password);
  const tron = tronClient(privateKey);
  const amount = Number(amountTrx);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid TRX amount.');
  const transaction = await tron.transactionBuilder.sendTrx(to, Math.round(amount * 1e6));
  const signed = await tron.trx.sign(transaction);
  const result = await tron.trx.sendRawTransaction(signed);
  if (!result.result) throw new Error(result.code || 'TRON transaction was rejected.');
  return { hash: result.txid || transaction.txID, explorerUrl: TRON_EXPLORER + '/#/transaction/' + (result.txid || transaction.txID) };
}

export async function getTronHistory(address = readStore().tron?.address): Promise<WalletHistoryItem[]> {
  if (!address) return [];
  const response = await fetch(TRON_RPC + '/v1/accounts/' + encodeURIComponent(address) + '/transactions?limit=50&order_by=block_timestamp,desc');
  if (!response.ok) throw new Error('TRON transaction history is temporarily unavailable.');
  const body = await response.json();
  return (Array.isArray(body?.data) ? body.data : []).map((tx: any) => ({
    id: 'trx:' + tx.txID,
    network: 'TRON',
    hash: tx.txID,
    timestamp: Number(tx.block_timestamp || 0),
    direction: 'unknown',
    status: tx.ret?.[0]?.contractRet === 'SUCCESS' ? 'confirmed' : 'failed',
    explorerUrl: TRON_EXPLORER + '/#/transaction/' + tx.txID,
  }));
}

export async function importEvmToken(token: Omit<MultiStore['importedEvmTokens'][number], 'logoURI'> & { logoURI?: string }) {
  requireUnlocked();
  const network = networkOrThrow(token.network);
  if (!/^0x[a-fA-F0-9]{40}$/.test(token.address)) throw new Error('Enter a valid ERC-20 contract address.');
  const provider = getNativeProvider(network);
  const contract = new Contract(token.address, ERC20_ABI, provider);
  const [symbol, name, decimals] = await Promise.all([contract.symbol(), contract.name(), contract.decimals()]);
  const store = readStore();
  const normalized = {
    network: token.network,
    address: token.address,
    symbol: String(symbol),
    name: String(name),
    decimals: Number(decimals),
    logoURI: token.logoURI,
  };
  const exists = store.importedEvmTokens.some(t => t.network === normalized.network && t.address.toLowerCase() === normalized.address.toLowerCase());
  if (!exists) store.importedEvmTokens.push(normalized);
  writeStore(store);
  return normalized;
}

export function removeEvmToken(network: WalletNetwork, address: string) {
  const store = readStore();
  store.importedEvmTokens = store.importedEvmTokens.filter(t => !(t.network === network && t.address.toLowerCase() === address.toLowerCase()));
  writeStore(store);
}

export async function getEvmAssets(networkName: Exclude<WalletNetwork, 'Solana' | 'TRON'>): Promise<WalletAsset[]> {
  requireUnlocked();
  const network = networkOrThrow(networkName);
  const address = getNativeWalletAddress();
  const provider = getNativeProvider(network);
  const nativeRaw = (await provider.getBalance(address)).toString();
  const nativeBalance = formatEther(nativeRaw);
  const assets: WalletAsset[] = [{
    id: networkName + ':native',
    network: networkName,
    symbol: network.nativeSymbol,
    name: network.name,
    decimals: 18,
    balance: nativeBalance,
    rawBalance: nativeRaw,
    native: true,
  }];
  const tokens = readStore().importedEvmTokens.filter(t => t.network === networkName);
  for (const token of tokens) {
    try {
      const contract = new Contract(token.address, ERC20_ABI, provider);
      const raw = (await contract.balanceOf(address)).toString();
      assets.push({
        id: networkName + ':' + token.address,
        network: networkName,
        symbol: token.symbol,
        name: token.name,
        address: token.address,
        decimals: token.decimals,
        balance: formatToken(raw, token.decimals),
        rawBalance: raw,
        native: false,
        logoURI: token.logoURI,
      });
    } catch {
      assets.push({
        id: networkName + ':' + token.address,
        network: networkName,
        symbol: token.symbol,
        name: token.name,
        address: token.address,
        decimals: token.decimals,
        balance: '0',
        rawBalance: '0',
        native: false,
        logoURI: token.logoURI,
      });
    }
  }
  return assets;
}

function formatToken(raw: string, decimals: number) {
  const value = BigInt(raw || '0');
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').slice(0, 8).replace(/0+$/, '');
  return fraction ? whole + '.' + fraction : whole.toString();
}

export async function getSolanaAssets(): Promise<WalletAsset[]> {
  const address = readStore().solana?.address;
  if (!address) return [];
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  const owner = new PublicKey(address);
  const native = await connection.getBalance(owner);
  const parsed = await connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') });
  return [
    { id: 'Solana:native', network: 'Solana', symbol: 'SOL', name: 'Solana', decimals: 9, balance: String(native / LAMPORTS_PER_SOL), rawBalance: String(native), native: true },
    ...parsed.value.map(item => {
      const info: any = item.account.data.parsed.info;
      const tokenAmount = info.tokenAmount;
      return {
        id: 'Solana:' + info.mint,
        network: 'Solana',
        symbol: info.mint.slice(0, 6),
        name: 'SPL Token',
        address: info.mint,
        decimals: Number(tokenAmount.decimals),
        balance: String(tokenAmount.uiAmountString || '0'),
        rawBalance: String(tokenAmount.amount || '0'),
        native: false,
      };
    }).filter(item => Number(item.balance) > 0),
  ];
}

export async function getTronAssets(): Promise<WalletAsset[]> {
  const address = readStore().tron?.address;
  if (!address) return [];
  return [{ id: 'TRON:native', network: 'TRON', symbol: 'TRX', name: 'TRON', decimals: 6, balance: String(await getTronBalance(address)), rawBalance: String(Math.round((await getTronBalance(address)) * 1e6)), native: true }];
}

export async function getEvmHistory(networkName: Exclude<WalletNetwork, 'Solana' | 'TRON'>): Promise<WalletHistoryItem[]> {
  requireUnlocked();
  const address = getNativeWalletAddress();
  const host = EVM_EXPLORERS[networkName];
  if (!host) return [];
  const url = host + '/api/v2/addresses/' + address + '/transactions?filter=validated';
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(networkName + ' transaction history is temporarily unavailable.');
  const body = await response.json();
  const items = Array.isArray(body?.items) ? body.items : [];
  return items.slice(0, 50).map((tx: any) => {
    const from = String(tx?.from?.hash || '');
    const to = String(tx?.to?.hash || '');
    const direction = from.toLowerCase() === address.toLowerCase() ? 'send' : to.toLowerCase() === address.toLowerCase() ? 'receive' : 'contract';
    return {
      id: networkName + ':' + String(tx.hash),
      network: networkName,
      hash: String(tx.hash),
      timestamp: tx.timestamp ? Date.parse(tx.timestamp) : undefined,
      direction,
      amount: tx.value ? formatToken(String(BigInt(tx.value)), 18) : '0',
      symbol: networkOrThrow(networkName).nativeSymbol,
      from,
      to,
      status: tx.status === 'ok' ? 'confirmed' : 'failed',
      explorerUrl: host + '/tx/' + tx.hash,
    } as WalletHistoryItem;
  });
}

export async function sendEvmAsset(networkName: Exclude<WalletNetwork, 'Solana' | 'TRON'>, asset: WalletAsset, to: string, amount: string) {
  requireUnlocked();
  const network = networkOrThrow(networkName);
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error('Enter a valid destination address.');
  if (!amount || !/^[0-9]+(?:\.[0-9]+)?$/.test(amount)) throw new Error('Enter a valid amount.');
  const signer = getNativeSigner(network);
  if (asset.native) {
    const tx = await signer.sendTransaction({ to, value: parseEther(amount) });
    const receipt = await tx.wait();
    if (!receipt) throw new Error('Transaction was not confirmed.');
    return { hash: tx.hash, explorerUrl: (EVM_EXPLORERS[networkName] || '') + '/tx/' + tx.hash };
  }
  if (!asset.address) throw new Error('Token contract address is missing.');
  const contract = new Contract(asset.address, ERC20_ABI, signer);
  const amountBase = BigInt(parseDecimalUnits(amount, asset.decimals));
  const tx = await contract.transfer(to, amountBase);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('Token transfer was not confirmed.');
  return { hash: tx.hash, explorerUrl: (EVM_EXPLORERS[networkName] || '') + '/tx/' + tx.hash };
}

function parseDecimalUnits(value: string, decimals: number) {
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('Amount has too many decimal places.');
  return (BigInt(whole || '0') * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals))).toString();
}

export async function estimateEvmGas(networkName: Exclude<WalletNetwork, 'Solana' | 'TRON'>, asset: WalletAsset, to: string, amount: string) {
  requireUnlocked();
  const network = networkOrThrow(networkName);
  const provider = getNativeProvider(network);
  const signer = getNativeSigner(network);
  if (asset.native) {
    const value = parseEther(amount);
    const gasLimit = await provider.estimateGas({ from: getNativeWalletAddress(), to, value });
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 0n;
    return { gasLimit: gasLimit.toString(), gasPrice: gasPrice.toString(), nativeFee: formatEther(gasLimit * gasPrice) };
  }
  const contract = new Contract(asset.address!, ERC20_ABI, signer);
  const gasLimit = await contract.transfer.estimateGas(to, parseDecimalUnits(amount, asset.decimals));
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 0n;
  return { gasLimit: gasLimit.toString(), gasPrice: gasPrice.toString(), nativeFee: formatEther(gasLimit * gasPrice) };
}

export async function getReceiveAddresses() {
  return {
    evm: getNativeWalletAddress(),
    solana: readStore().solana?.address || '',
    tron: readStore().tron?.address || '',
  };
}

export async function unlockWalletForAllChains(password: string) {
  return unlockNativeWallet(password);
}
