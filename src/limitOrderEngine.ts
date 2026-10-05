import { Address, LimitOrder, MakerTraits, getLimitOrderContract, randBigInt } from '@1inch/limit-order-sdk';
import { UINT_40_MAX } from '@1inch/byte-utils';
import { approveIfNeeded, getInjectedProvider, type SwapNetwork, type SwapToken } from './swapEngine';
import { getNativeSigner } from './sireWalletCore';

export type LimitOrderPayload = {
  orderHash: string;
  signature: string;
  data: Record<string, any>;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

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

export async function buildLimitOrder(args: {
  maker: string;
  makerAsset: SwapToken;
  takerAsset: SwapToken;
  makingAmount: string;
  takingAmount: string;
  expirationSeconds: number;
}) {
  if (!args.makerAsset?.address || !args.takerAsset?.address) throw new Error('Select both limit-order assets.');
  if (args.makerAsset.native || args.takerAsset.native) throw new Error('Limit orders currently require ERC-20 or wrapped assets. Select the token contract rather than the native coin.');
  if (args.makerAsset.chainId !== args.takerAsset.chainId) throw new Error('Limit orders are single-chain. Use Swap for cross-chain execution.');
  const expiration = BigInt(Math.floor(Date.now() / 1000)) + BigInt(Math.max(60, Math.floor(args.expirationSeconds)));
  const makerTraits = MakerTraits.default()
    .withExpiration(expiration)
    .withNonce(randBigInt(UINT_40_MAX));
  const order = new LimitOrder({
    makerAsset: new Address(args.makerAsset.address),
    takerAsset: new Address(args.takerAsset.address),
    makingAmount: BigInt(args.makingAmount),
    takingAmount: BigInt(args.takingAmount),
    maker: new Address(args.maker),
    receiver: new Address(ZERO_ADDRESS),
  }, makerTraits);
  const typedData = order.getTypedData();
  return {
    order,
    typedData: jsonSafe(typedData),
    orderData: jsonSafe(order.build()),
    orderHash: order.getOrderHash(args.makerAsset.chainId),
    makerTraits: order.build().makerTraits,
    approvalAddress: getLimitOrderContract(args.makerAsset.chainId),
  };
}

export async function signLimitOrder(typedData: any, maker: string, native: boolean, network: SwapNetwork): Promise<string> {
  if (native) {
    const signer = getNativeSigner(network);
    return signer.signTypedData(
      typedData.domain,
      typedData.types?.Order || typedData.types,
      typedData.message,
    );
  }
  const provider = getInjectedProvider();
  if (!provider) throw new Error('No external wallet provider detected.');
  return String(await provider.request({
    method: 'eth_signTypedData_v4',
    params: [maker, JSON.stringify(typedData)],
  }));
}

export async function submitLimitOrder(payload: LimitOrderPayload): Promise<any> {
  const response = await fetch('/api/sire/limit-orders/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(String(data?.error || 'Limit order submission failed.'));
  return data;
}

export async function fetchLimitOrders(chainId: number, maker: string): Promise<any[]> {
  const response = await fetch('/api/sire/limit-orders/maker/' + chainId + '/' + encodeURIComponent(maker), { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(String(data?.error || 'Unable to load limit orders.'));
  return Array.isArray(data?.orders) ? data.orders : [];
}

export async function fetchLimitOrder(chainId: number, orderHash: string): Promise<any> {
  const response = await fetch('/api/sire/limit-orders/' + chainId + '/' + encodeURIComponent(orderHash), { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(String(data?.error || 'Unable to load limit order status.'));
  return data.order;
}

export async function cancelLimitOrder(args: {
  network: SwapNetwork;
  owner: string;
  makerTraits: string;
  orderHash: string;
  native: boolean;
}) {
  const contract = getLimitOrderContract(args.network.chainId);
  // cancelOrder(uint256,bytes32) is encoded with ethers below without adding another dependency.
  const { Interface } = await import('ethers');
  const iface = new Interface(['function cancelOrder(uint256 makerTraits, bytes32 orderHash)']);
  const data = iface.encodeFunctionData('cancelOrder', [BigInt(args.makerTraits), args.orderHash]);
  const tx = { to: contract, data, value: 0n, gasLimit: 180000n };
  if (args.native) {
    const signer = getNativeSigner(args.network);
    const sent = await signer.sendTransaction(tx);
    return String(sent.hash);
  }
  const provider = getInjectedProvider();
  if (!provider) throw new Error('No external wallet provider detected.');
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: args.owner, to: contract, data, value: '0x0', gas: '0x2bf20' }] });
  return String(hash);
}

export async function approveLimitOrderIfNeeded(token: SwapToken, owner: string, amount: string, spender: string, onStatus?: (s: string) => void) {
  await approveIfNeeded(token, owner, spender, amount, onStatus);
}
