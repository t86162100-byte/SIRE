import type { WalletChain } from '../types';

export type WalletOperation =
  | 'derive-account'
  | 'validate-address'
  | 'native-balance'
  | 'token-balance'
  | 'token-metadata'
  | 'estimate-fee'
  | 'review-transaction'
  | 'sign-transaction'
  | 'broadcast-transaction'
  | 'transaction-status';

export type AdapterCapabilityReport = {
  chainId: string;
  implemented: readonly WalletOperation[];
  automatedTests: readonly WalletOperation[];
  /** True only when every operation required for the advertised tier is present and tested. */
  canAdvertiseSendReceive: boolean;
  canAdvertiseFull: boolean;
};

const EVM_IMPLEMENTED: readonly WalletOperation[] = [
  'derive-account',
  'validate-address',
  'native-balance',
  'token-balance',
  'token-metadata',
  'sign-transaction',
  'broadcast-transaction',
];

const EVM_TESTED_IN_WALLET_CI: readonly WalletOperation[] = [
  // These are the only adapter operations directly covered by deterministic unit tests today.
  'derive-account',
  'validate-address',
];

export function getAdapterCapabilityReport(chain: WalletChain): AdapterCapabilityReport {
  if (chain.family !== 'evm') {
    return {
      chainId: chain.id,
      implemented: [],
      automatedTests: [],
      canAdvertiseSendReceive: false,
      canAdvertiseFull: false,
    };
  }

  const implemented = [...EVM_IMPLEMENTED];
  const automatedTests = [...EVM_TESTED_IN_WALLET_CI];
  const sendReceiveRequirements: WalletOperation[] = [
    'derive-account', 'validate-address', 'native-balance',
    'estimate-fee', 'review-transaction', 'sign-transaction',
    'broadcast-transaction', 'transaction-status',
  ];
  const fullRequirements: WalletOperation[] = [
    ...sendReceiveRequirements, 'token-balance', 'token-metadata',
  ];
  const has = (ops: WalletOperation[]) =>
    ops.every(op => implemented.includes(op) && automatedTests.includes(op));

  return {
    chainId: chain.id,
    implemented,
    automatedTests,
    canAdvertiseSendReceive: has(sendReceiveRequirements),
    canAdvertiseFull: has(fullRequirements),
  };
}
