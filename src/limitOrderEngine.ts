import { TypedDataEncoder } from 'ethers';

import type { SwapToken } from './swapEngine';

export type LimitOrderPayload = { chainId: number; orderHash: string; signature?: string; data: Record<string, any> };

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_POOL = '0x' + '0'.repeat(64);
const SUPPORTED_CHAINS = new Set([1, 56, 137, 8453, 42161, 43114]);

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
  if (!SUPPORTED_CHAINS.has(Number(chainId))) throw new Error('0x Limit monitoring is not enabled for this network.');
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

/**
 * Current 0x architecture used by SIRE:
 * the public 0x API is Swap API v2, not the legacy /orderbook/v1 REST API.
 * SIRE therefore treats a Limit order as a conditional 0x Swap intent and
 * only requests a firm quote when its target price is reached.
 */
export async function buildLimitOrder(args: { maker: string; makerAsset: SwapToken; takerAsset: SwapToken; makingAmount: string; takingAmount: string; expirationSeconds: number }) {
  if (!args.makerAsset?.address || !args.takerAsset?.address) throw new Error('Select both limit-order assets.');
  if (args.makerAsset.native || args.takerAsset.native) throw new Error('Limit orders currently require ERC-20 or wrapped assets.');
  if (args.makerAsset.chainId !== args.takerAsset.chainId) throw new Error('Limit orders are single-chain. Use Swap for cross-chain execution.');
  assertSupportedChain(args.makerAsset.chainId);
  const expiry = Math.floor(Date.now() / 1000) + Math.max(60, Math.floor(args.expirationSeconds));
  const order = {
    makerToken: args.makerAsset.address,
    takerToken: args.takerAsset.address,
    makerAmount: String(args.makingAmount),
    takerAmount: String(args.takingAmount),
    takerTokenFeeAmount: '0',
    maker: args.maker,
    taker: ZERO_ADDRESS,
    sender: ZERO_ADDRESS,
    feeRecipient: ZERO_ADDRESS,
    pool: ZERO_POOL,
    expiry: String(expiry),
    salt: String(BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))),
  };
  const domain = { name: 'SIRE Conditional Limit', version: '1', chainId: Number(args.makerAsset.chainId), verifyingContract: ZERO_ADDRESS };
  const orderHash = TypedDataEncoder.hash(domain, LIMIT_ORDER_TYPES, order);
  return { typedData: jsonSafe({ domain, types: LIMIT_ORDER_TYPES, primaryType: 'LimitOrder', message: order }), orderData: jsonSafe({ ...order, chainId: Number(args.makerAsset.chainId) }), orderHash };
}

export async function signLimitOrder(_typedData: any, _maker: string, _native: boolean, _network: SwapNetwork): Promise<string> {
  return '';
}

export async function submitLimitOrder(payload: LimitOrderPayload & { record?: Record<string, any> }): Promise<any> {
  const response = await fetch('/api/sire/limit-orders/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(String(data?.error || 'Limit order could not be armed.'));
  return data;
}

export async function fetchLimitOrders(chainId: number, maker: string): Promise<any[]> {
  const params = new URLSearchParams({ chainId: String(chainId || 0), maker: String(maker || '') });
  const response = await fetch('/api/sire/limit-orders?' + params.toString(), {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(String(data?.error || 'Limit orders could not be loaded.'));
  return Array.isArray(data?.orders) ? data.orders.slice(0, 100) : [];
}

export async function fetchLimitOrder(_chainId: number, _orderHash: string): Promise<any> {
  return null;
}

export async function cancelLimitOrder(orderHash: string, maker: string): Promise<any> {
  const response = await fetch('/api/sire/limit-orders/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ orderHash, maker }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(String(data?.error || 'Limit order could not be canceled.'));
  return data;
}

export async function getZeroXLimitQuote(order: any, taker: string): Promise<any> {
  const response = await fetch('/api/sire/limit-orders/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      chainId: Number(order.chainId),
      sellToken: order.takerToken,
      buyToken: order.makerToken,
      sellAmount: String(order.takerAmount),
      taker,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(String(data?.error || '0x quote unavailable.'));
  return data.quote;
}
