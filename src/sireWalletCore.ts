// Compatibility facade for existing SIRE trading flows.
// The wallet implementation now lives in ./sireWallet.
export {
  cancelWalletCreation as cancelPreparedNativeWallet,
  finishWalletCreation as finalizePreparedNativeWallet,
  getWalletAddress as getNativeWalletAddress,
  hasWallet as hasNativeWallet,
  isWalletUnlocked as isNativeWalletUnlocked,
  beginWalletCreation as prepareNativeWallet,
  unlockWallet as unlockNativeWallet,
  getWalletState,
  getNativeBalance,
  getTokenBalance,
  sendTransaction,
} from './sireWallet';
