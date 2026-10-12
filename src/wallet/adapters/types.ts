import type { TransactionIntent, TransactionReview, WalletAccount, WalletAsset, WalletChain } from '../types';

/**
 * Chain adapters are responsible for chain-specific semantics. Implementations
 * must never silently fall back to EVM assumptions for another chain family.
 */
export interface WalletChainAdapter {
  readonly family: WalletChain['family'];
  supports(chain: WalletChain): boolean;
  deriveAccount(input: { seed: Uint8Array; chain: WalletChain; accountIndex: number }): Promise<WalletAccount>;
  validateAddress(input: { chain: WalletChain; address: string }): Promise<boolean>;
  discoverAssets(input: { chain: WalletChain; account: WalletAccount; signal?: AbortSignal }): Promise<WalletAsset[]>;
  estimateFee(input: { chain: WalletChain; account: WalletAccount; intent: TransactionIntent }): Promise<{ feeBaseUnits: string; feeSymbol: string }>;
  reviewTransaction(input: { chain: WalletChain; account: WalletAccount; intent: TransactionIntent }): Promise<TransactionReview>;
  signTransaction(input: { chain: WalletChain; account: WalletAccount; intent: TransactionIntent; approvedReview: TransactionReview }): Promise<string>;
  broadcastTransaction(input: { chain: WalletChain; signedTransaction: string }): Promise<{ transactionId: string }>;
  getTransactionStatus(input: { chain: WalletChain; transactionId: string }): Promise<'pending' | 'confirmed' | 'failed' | 'unknown'>;
}

export type AdapterRegistration = {
  family: WalletChain['family'];
  chainIds: readonly string[];
  capability: WalletChain['status'];
  adapter: WalletChainAdapter;
};
