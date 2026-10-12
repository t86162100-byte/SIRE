/** Domain types shared by wallet UI, chain adapters and asset discovery. */
export type ChainFamily =
  | 'evm'
  | 'utxo'
  | 'solana'
  | 'tron'
  | 'xrp-ledger'
  | 'cosmos'
  | 'move'
  | 'ton'
  | 'substrate'
  | 'cardano'
  | 'near';

export type CapabilityLevel = 'listed' | 'read-only' | 'send-receive' | 'full';

export type WalletChain = {
  id: string;
  name: string;
  family: ChainFamily;
  nativeAsset: { id: string; name: string; symbol: string; decimals: number };
  /** Public endpoints only. Never put provider secrets in this registry. */
  rpcUrls: string[];
  explorerUrl?: string;
  chainId?: string | number;
  slip44?: number;
  status: CapabilityLevel;
  /** Explicitly states what has been implemented and verified in this app. */
  notes?: string;
};

export type AssetId = {
  chainId: string;
  /** Native asset identifier or token contract/mint/issuer-specific identifier. */
  assetRef: string;
};

export type WalletAsset = {
  id: AssetId;
  kind: 'native' | 'token' | 'collectible';
  name: string;
  symbol: string;
  decimals?: number;
  balanceBaseUnits?: string;
  priceUsd?: number;
  logoUrl?: string;
  metadataSource?: string;
  metadataUpdatedAt?: string;
  verification: 'verified' | 'unverified' | 'spam' | 'unknown';
};

export type WalletAccount = {
  id: string;
  chainId: string;
  address: string;
  derivationPath?: string;
  publicKey?: string;
};

export type TransactionIntent = {
  chainId: string;
  accountId: string;
  to: string;
  asset?: AssetId;
  amountBaseUnits?: string;
  data?: string;
  memo?: string;
  /** Chain adapter returns a human-readable review model before signing. */
  summary?: string;
};

export type TransactionReview = {
  chainId: string;
  networkName: string;
  from: string;
  to: string;
  assetLabel: string;
  amountLabel: string;
  feeLabel: string;
  warnings: string[];
  decodedActions?: string[];
};
