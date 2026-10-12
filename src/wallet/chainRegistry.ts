import type { WalletChain } from './types';

/**
 * Registry metadata is not a claim that a chain is fully usable.
 * Only chains with a registered, tested adapter may expose write capabilities.
 */
export const WALLET_CHAIN_REGISTRY: readonly WalletChain[] = [
  { id: 'eip155:1', name: 'Ethereum', family: 'evm', chainId: 1, slip44: 60, nativeAsset: { id: 'native:eth', name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'], explorerUrl: 'https://etherscan.io', status: 'send-receive', notes: 'Current EVM wallet adapter; must pass release tests before production claims.' },
  { id: 'eip155:8453', name: 'Base', family: 'evm', chainId: 8453, slip44: 60, nativeAsset: { id: 'native:eth', name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'], explorerUrl: 'https://basescan.org', status: 'send-receive' },
  { id: 'eip155:42161', name: 'Arbitrum One', family: 'evm', chainId: 42161, slip44: 60, nativeAsset: { id: 'native:eth', name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'], explorerUrl: 'https://arbiscan.io', status: 'send-receive' },
  { id: 'eip155:10', name: 'Optimism', family: 'evm', chainId: 10, slip44: 60, nativeAsset: { id: 'native:eth', name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'], explorerUrl: 'https://optimistic.etherscan.io', status: 'send-receive' },
  { id: 'eip155:56', name: 'BNB Smart Chain', family: 'evm', chainId: 56, slip44: 60, nativeAsset: { id: 'native:bnb', name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'], explorerUrl: 'https://bscscan.com', status: 'send-receive' },
  { id: 'eip155:137', name: 'Polygon PoS', family: 'evm', chainId: 137, slip44: 60, nativeAsset: { id: 'native:pol', name: 'POL', symbol: 'POL', decimals: 18 }, rpcUrls: ['https://polygon-rpc.com', 'https://polygon-bor-rpc.publicnode.com'], explorerUrl: 'https://polygonscan.com', status: 'send-receive' },
  { id: 'eip155:43114', name: 'Avalanche C-Chain', family: 'evm', chainId: 43114, slip44: 60, nativeAsset: { id: 'native:avax', name: 'Avalanche', symbol: 'AVAX', decimals: 18 }, rpcUrls: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com'], explorerUrl: 'https://snowtrace.io', status: 'send-receive' },
  { id: 'bip122:bitcoin', name: 'Bitcoin', family: 'utxo', slip44: 0, nativeAsset: { id: 'native:btc', name: 'Bitcoin', symbol: 'BTC', decimals: 8 }, rpcUrls: [], explorerUrl: 'https://mempool.space', status: 'listed', notes: 'Requires UTXO indexing, Bitcoin address derivation, fee selection and PSBT signing adapter.' },
  { id: 'solana:mainnet', name: 'Solana', family: 'solana', slip44: 501, nativeAsset: { id: 'native:sol', name: 'Solana', symbol: 'SOL', decimals: 9 }, rpcUrls: [], explorerUrl: 'https://explorer.solana.com', status: 'listed', notes: 'Requires Solana derivation/signing and SPL token account discovery.' },
  { id: 'tron:mainnet', name: 'TRON', family: 'tron', slip44: 195, nativeAsset: { id: 'native:trx', name: 'TRON', symbol: 'TRX', decimals: 6 }, rpcUrls: [], explorerUrl: 'https://tronscan.org', status: 'listed', notes: 'Requires TRON address encoding, TRC-10/TRC-20 metadata and transaction adapter.' },
  { id: 'xrpl:mainnet', name: 'XRP Ledger', family: 'xrp-ledger', slip44: 144, nativeAsset: { id: 'native:xrp', name: 'XRP', symbol: 'XRP', decimals: 6 }, rpcUrls: [], explorerUrl: 'https://livenet.xrpl.org', status: 'listed', notes: 'Requires XRP Ledger account and trust-line handling.' },
  { id: 'cosmos:cosmoshub-4', name: 'Cosmos Hub', family: 'cosmos', slip44: 118, nativeAsset: { id: 'native:atom', name: 'Cosmos', symbol: 'ATOM', decimals: 6 }, rpcUrls: [], explorerUrl: 'https://www.mintscan.io/cosmos', status: 'listed', notes: 'Cosmos SDK chains require per-chain HRP, denom, fee and signing configuration.' },
  { id: 'ton:mainnet', name: 'TON', family: 'ton', slip44: 607, nativeAsset: { id: 'native:ton', name: 'Toncoin', symbol: 'TON', decimals: 9 }, rpcUrls: [], explorerUrl: 'https://tonscan.org', status: 'listed' },
  { id: 'sui:mainnet', name: 'Sui', family: 'move', nativeAsset: { id: 'native:sui', name: 'Sui', symbol: 'SUI', decimals: 9 }, rpcUrls: [], explorerUrl: 'https://suiscan.xyz', status: 'listed', notes: 'Move-family chains still require independent account and transaction adapters.' },
  { id: 'aptos:mainnet', name: 'Aptos', family: 'move', slip44: 637, nativeAsset: { id: 'native:apt', name: 'Aptos', symbol: 'APT', decimals: 8 }, rpcUrls: [], explorerUrl: 'https://explorer.aptoslabs.com', status: 'listed' },
  { id: 'near:mainnet', name: 'NEAR', family: 'near', slip44: 397, nativeAsset: { id: 'native:near', name: 'NEAR', symbol: 'NEAR', decimals: 24 }, rpcUrls: [], explorerUrl: 'https://nearblocks.io', status: 'listed' },
  { id: 'polkadot:relay', name: 'Polkadot', family: 'substrate', slip44: 354, nativeAsset: { id: 'native:dot', name: 'Polkadot', symbol: 'DOT', decimals: 10 }, rpcUrls: [], explorerUrl: 'https://polkadot.subscan.io', status: 'listed' },
  { id: 'cardano:mainnet', name: 'Cardano', family: 'cardano', slip44: 1815, nativeAsset: { id: 'native:ada', name: 'Cardano', symbol: 'ADA', decimals: 6 }, rpcUrls: [], explorerUrl: 'https://cardanoscan.io', status: 'listed' },
] as const;

export const getWalletChain = (id: string) => WALLET_CHAIN_REGISTRY.find(chain => chain.id === id);
export const getChainsByFamily = (family: WalletChain['family']) => WALLET_CHAIN_REGISTRY.filter(chain => chain.family === family);
export const getChainsByCapability = (status: WalletChain['status']) => WALLET_CHAIN_REGISTRY.filter(chain => chain.status === status);
