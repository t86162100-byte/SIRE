import { useEffect } from 'react';
import { createAppKit, useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitProvider } from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { mainnet, bsc, base, arbitrum, optimism, polygon, avalanche } from '@reown/appkit/networks';
import type { Eip1193Provider } from './swapEngine';
import { setExternalWalletProvider } from './swapEngine';

const projectId = String(import.meta.env.VITE_REOWN_PROJECT_ID || '').trim();

const networks = [mainnet, bsc, base, arbitrum, optimism, polygon, avalanche];

export const reownConfigured = Boolean(projectId);

const metadata = {
  name: 'SIRE',
  description: 'SIRE on-chain trading',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://sire-7md9.onrender.com',
  icons: [],
};

export const appKit = reownConfigured
  ? createAppKit({
      adapters: [new EthersAdapter()],
      networks,
      projectId,
      metadata,
      features: { analytics: true },
    })
  : null;

export function openEvmWalletModal() {
  if (!appKit) throw new Error('Wallet connection is not configured. Add VITE_REOWN_PROJECT_ID to the SIRE Render environment.');
  return appKit.open({ view: 'Connect', namespace: 'eip155' });
}

export function WalletKitBridge() {
  if (!appKit) return null;
  return <WalletKitBridgeInner />;
}

function WalletKitBridgeInner() {
  const { address, isConnected } = useAppKitAccount({ namespace: 'eip155' });
  const { chainId } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>('eip155');
  const { open } = useAppKit();

  useEffect(() => {
    setExternalWalletProvider(walletProvider || null);
  }, [walletProvider]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('sire:wallet-state', {
      detail: {
        address: address || '',
        chainId: Number(chainId || 0) || null,
        isConnected: Boolean(isConnected),
      },
    }));
  }, [address, chainId, isConnected]);

  useEffect(() => {
    const handler = () => open({ view: 'Connect', namespace: 'eip155' });
    window.addEventListener('sire:open-wallet', handler);
    return () => window.removeEventListener('sire:open-wallet', handler);
  }, [open]);

  return null;
}
