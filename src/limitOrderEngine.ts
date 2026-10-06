import { TypedDataEncoder } from 'ethers';
import { approveIfNeeded, getInjectedProvider, type SwapNetwork, type SwapToken } from './swapEngine';
import { getNativeSigner } from './sireWalletCore';

export type LimitOrderPayload = { chainId: number; orderHash: string; signature: string; data: Record<string, any> };

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_POOL = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ZERO_EX_EXCHANGE_PROXY = '0xdef1c0ded9bec7f1a1670819833240f027b25eff';
const ZEROX_LIMIT_ORDERBOOK_CHAINS = new Set([1, 56, 137, 8453, 42161, 43114]);

const LIMIT_ORDER_TYPES = {
  LimitOrder: [
    { name: 'makerToken', type: 'address' },
    { name: 'takerToken', type: 'address' },
    { name: 'makerAmount', type: 'uint128' },
    { name: 'takerAmount', type: 'uint128' },
    { name: 'takerTokenFeeAmount', type: 'uint128' },
    { name: 'maker', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'sender', type: 'address' },
    { name: 'feeRecipient', type: 'address' },
    { name: 'pool', type: 'bytes32' },
    { name: 'expiry', type: 'uint64' },
    { name: 'salt', type: 'uint256' },
  ],
};

function assertSupportedChain(chainId: number) {
  if (!ZEROX_LIMIT_ORDERBOOK_CHAINS.has(Number(chainId))) {
    throw new Error('0x Limit Orders are not enabled for this network yet. Use Swap on this network or select a supported 0x Limit Order network.');
  }
}

function parseDecimal(value: string, decimals: number): bigint {
  const clean = String(value || '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(clean)) throw new Error('Enter a valid limit price.');
  const [whole, fraction = ''] = clean.split('.');
  if (fraction.length > decimals) throw new Error('Limit price has too many decimal places.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals));
}

export function limitTakingAmount(makingAmount: string, makerDecimals: number, takerDecimals: number, price: string): string {
  const priceScaled = parseDecimal(price, 18);
  const numerator = BigInt(makingAmount) * priceScaled * (10n ** BigInt(takerDecimals));
  const denominator = (10n ** BigInt(makerDecimals)) * (10n ** 18n);
  const result = numerator / denominator;
  if (result <= 0n) throw new Error('The limit price and amount produce a zero receive amount.');
  return result.toString();
}

function jsonSafe(value: any): any {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, jsonSafe(v)]));
  return value;
}

export async function buildLimitOrder(args: { maker: string; makerAsset: SwapToken; takerAsset: SwapToken; makingAmount: string; takingAmount: string; expirationSeconds: number }) {
  if (!args.makerAsset?.address || !args.takerAsset?.address) throw new Error('Select both limit-order assets.');
  if (args.makerAsset.native || args.takerAsset.native) throw new Error('Limit orders currently require ERC-20 or wrapped assets. Select the token contract rather than the native coin.');
  if (args.makerAsset.chainId !== args.takerAsset.chainId) throw new Error('Limit orders are single-chain. Use Swap for cross-chain execution.');
  assertSupportedChain(args.makerAsset.chainId);
  const expiration = Math.floor(Date.now() / 1000) + Math.max(60, Math.floor(args.expirationSeconds));
  const order = {
    makerToken: args.makerAsset.address, takerToken: args.takerAsset.address,
    makerAmount: String(args.makingAmount), takerAmount: String(args.takingAmount),
    takerTokenFeeAmount: '0', maker: args.maker, taker: ZERO_ADDRESS, sender: ZERO_ADDRESS,
    feeRecipient: ZERO_ADDRESS, pool: ZERO_POOL, expiry: String(expiration),
    salt: String(BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))),
    chainId: Number(args.makerAsset.chainId), verifyingContract: ZERO_EX_EXCHANGE_PROXY,
  };
  const domain = { name: 'ZeroEx', version: '1.0.0', chainId: order.chainId, verifyingContract: ZERO_EX_EXCHANGE_PROXY };
  const typedData = { domain, types: LIMIT_ORDER_TYPES, primaryType: 'LimitOrder', message: order };
  const orderHash = TypedDataEncoder.hash(domain, LIMIT_ORDER_TYPES, order);
  return { typedData: jsonSafe(typedData), orderData: jsonSafe(order), orderHash, makerTraits: '0', approvalAddress: ZERO_EX_EXCHANGE_PROXY };
}

export async function signLimitOrder(typedData: any, maker: string, native: boolean, network: SwapNetwork): Promise<string> {
  if (native) {
    const signer = getNativeSigner(network);
    return signer.signTypedData(typedData.domain, typedData.types, typedData.message);
  }
  const provider = getInjectedProvider();
  if (!provider) throw new Error('No external wallet provider detected.');
  return String(await provider.request({ method: 'eth_signTypedData_v4', params: [maker, JSON.stringify(typedData)] }));
}

export async function submitLimitOrder(payload: LimitOrderPayload): Promise<any> {
  const response = await fetch('/api/sire/limit-orders/submit', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(String(data?.error || 'Limit order submission failed.'));
  return data;
}

export async function fetchLimitOrders(chainId: number, maker: string): Promise<any[]> {
  assertSupportedChain(chainId);
  const response = await fetch('/api/sire/limit-orders/maker/' + chainId + '/' + encodeURIComponent(maker), { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(String(data?.error || 'Unable to load limit orders.'));
  return Array.isArray(data?.orders) ? data.orders : [];
}

export async function fetchLimitOrder(chainId: number, orderHash: string): Promise<any> {
  assertSupportedChain(chainId);
  const response = await fetch('/api/sire/limit-orders/' + chainId + '/' + encodeURIComponent(orderHash), { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(String(data?.error || 'Unable to load limit order status.'));
  return data.order;
}

export async function cancelLimitOrder(args: { network: SwapNetwork; owner: string; order: Record<string, any>; native: boolean }) {
  assertSupportedChain(args.network.chainId);
  const { Interface } = await import('ethers');
  const iface = new Interface(['function cancelLimitOrder((address makerToken,address takerToken,uint128 makerAmount,uint128 takerAmount,uint128 takerTokenFeeAmount,address maker,address taker,address sender,address feeRecipient,bytes32 pool,uint64 expiry,uint256 salt) order)']);
  const order = {
    makerToken: args.order.makerToken, takerToken: args.order.takerToken,
    makerAmount: BigInt(args.order.makerAmount), takerAmount: BigInt(args.order.takerAmount),
    takerTokenFeeAmount: BigInt(args.order.takerTokenFeeAmount || 0), maker: args.order.maker,
    taker: args.order.taker || ZERO_ADDRESS, sender: args.order.sender || ZERO_ADDRESS,
    feeRecipient: args.order.feeRecipient || ZERO_ADDRESS, pool: args.order.pool || ZERO_POOL,
    expiry: BigInt(args.order.expiry), salt: BigInt(args.order.salt),
  };
  const data = iface.encodeFunctionData('cancelLimitOrder', [order]);
  const tx = { to: ZERO_EX_EXCHANGE_PROXY, data, value: 0n, gasLimit: 180000n };
  if (args.native) return String((await getNativeSigner(args.network).sendTransaction(tx)).hash);
  const provider = getInjectedProvider();
  if (!provider) throw new Error('No external wallet provider detected.');
  return String(await provider.request({ method: 'eth_sendTransaction', params: [{ from: args.owner, to: ZERO_EX_EXCHANGE_PROXY, data, value: '0x0', gas: '0x2bf20' }] }));
}

export async function approveLimitOrderIfNeeded(token: SwapToken, owner: string, amount: string, spender: string, onStatus?: (s: string) => void) {
  await approveIfNeeded(token, owner, spender, amount, onStatus);
}
