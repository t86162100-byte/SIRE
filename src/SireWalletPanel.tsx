import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Copy, ExternalLink, History, KeyRound, LockKeyhole, Plus, RefreshCw, Send, ShieldCheck, WalletCards, X } from 'lucide-react';
import {
  type WalletAsset, type WalletHistoryItem, type WalletNetwork,
  createSolanaAccount, createTronAccount, estimateEvmGas, getEvmAssets, getEvmHistory, getReceiveAddresses,
  getSolanaAssets, getSolanaBalance, getSolanaHistory, getStoredMultiChainMetadata, getTronAssets, getTronBalance,
  importEvmToken, removeEvmToken, sendEvmAsset, sendSolana, sendTron
} from './sireWalletMultiChain';
import { getStoredWalletMetadata, hasNativeWallet, isNativeWalletUnlocked, lockNativeWallet, unlockNativeWallet } from './sireWalletCore';

const EVM_NETWORKS: WalletNetwork[] = ['Ethereum','BNB Chain','Base','Arbitrum','Optimism','Polygon','Avalanche'];
const ALL_NETWORKS: WalletNetwork[] = [...EVM_NETWORKS,'Solana','TRON'];

function short(value: string) { return value ? value.slice(0,6) + '…' + value.slice(-4) : '—'; }
function money(value: string | number) { const n = Number(value); if (!Number.isFinite(n)) return '0'; return n.toLocaleString(undefined,{maximumFractionDigits:8}); }

export default function SireWalletPanel() {
  const [open, setOpen] = useState(false);
  const [network, setNetwork] = useState<WalletNetwork>('Ethereum');
  const [assets, setAssets] = useState<WalletAsset[]>([]);
  const [history, setHistory] = useState<WalletHistoryItem[]>([]);
  const [addresses, setAddresses] = useState({evm:'',solana:'',tron:''});
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(isNativeWalletUnlocked());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendAssetId, setSendAssetId] = useState('');
  const [gasPreview, setGasPreview] = useState('');
  const [tokenNetwork, setTokenNetwork] = useState<WalletNetwork>('Ethereum');
  const [tokenAddress, setTokenAddress] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onTab = (event: Event) => {
      const tab = (event as CustomEvent).detail?.tab;
      if (tab === 'portfolio') setOpen(true);
    };
    const onState = () => setUnlocked(isNativeWalletUnlocked());
    window.addEventListener('sire:open-native-wallet', onOpen);
    window.addEventListener('sire:tab-changed', onTab);
    window.addEventListener('sire:native-wallet-state', onState);
    return () => {
      window.removeEventListener('sire:open-native-wallet', onOpen);
      window.removeEventListener('sire:tab-changed', onTab);
      window.removeEventListener('sire:native-wallet-state', onState);
    };
  }, []);

  const refresh = async () => {
    if (!isNativeWalletUnlocked()) { setUnlocked(false); return; }
    setBusy(true); setMessage('');
    try {
      const nextAddresses = await getReceiveAddresses(); setAddresses(nextAddresses);
      let nextAssets: WalletAsset[] = [];
      if (EVM_NETWORKS.includes(network)) nextAssets = await getEvmAssets(network as any);
      else if (network === 'Solana') nextAssets = await getSolanaAssets();
      else nextAssets = await getTronAssets();
      setAssets(nextAssets);
      if (historyOpen) {
        const nextHistory = EVM_NETWORKS.includes(network)
          ? await getEvmHistory(network as any)
          : network === 'Solana' ? await getSolanaHistory() : await import('./sireWalletMultiChain').then(m => m.getTronHistory());
        setHistory(nextHistory);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (open && unlocked) void refresh(); }, [open, unlocked, network, historyOpen]);

  const selectedAsset = useMemo(() => assets.find(item => item.id === sendAssetId) || assets[0], [assets, sendAssetId]);

  const send = async () => {
    if (!selectedAsset) return;
    setBusy(true); setMessage('');
    try {
      if (EVM_NETWORKS.includes(network)) {
        const result = await sendEvmAsset(network as any, selectedAsset, sendTo.trim(), sendAmount.trim());
        setMessage('Transaction confirmed · ' + result.hash);
      } else if (network === 'Solana') {
        if (selectedAsset.symbol !== 'SOL') throw new Error('SPL token sending will be enabled from the token manager.');
        if (!password) throw new Error('Enter your wallet password to authorize Solana signing.');
        const result = await sendSolana(password, sendTo.trim(), sendAmount.trim());
        setMessage('Transaction confirmed · ' + result.hash);
      } else {
        if (selectedAsset.symbol !== 'TRX') throw new Error('TRC-20 token sending will be enabled from the token manager.');
        if (!password) throw new Error('Enter your wallet password to authorize TRON signing.');
        const result = await sendTron(password, sendTo.trim(), sendAmount.trim());
        setMessage('Transaction submitted · ' + result.hash);
      }
      setSendTo(''); setSendAmount(''); setGasPreview('');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const previewGas = async () => {
    if (!selectedAsset || !EVM_NETWORKS.includes(network) || !sendTo || !sendAmount) return;
    try {
      const gas = await estimateEvmGas(network as any, selectedAsset, sendTo, sendAmount);
      setGasPreview(gas.nativeFee + ' ' + (network === 'Polygon' ? 'POL' : selectedAsset.native ? selectedAsset.symbol : (EVM_NETWORKS.includes(network) ? 'native' : '')));
    } catch (error) { setGasPreview(error instanceof Error ? error.message : String(error)); }
  };

  const copy = async (value: string) => { if (value) { await navigator.clipboard?.writeText(value); setMessage('Copied'); } };

  const createChains = async () => {
    if (!password) { setMessage('Enter your SIRE Wallet password first.'); return; }
    setBusy(true); setMessage('');
    try { await createSolanaAccount(password); await createTronAccount(password); setMessage('Solana and TRON accounts are ready.'); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const addToken = async () => {
    if (!tokenAddress) return;
    setBusy(true); setMessage('');
    try {
      await importEvmToken({ network: tokenNetwork, address: tokenAddress, symbol:'', name:'', decimals:18 });
      setTokenAddress(''); setMessage('Token added to SIRE Wallet.'); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  if (!open) return null;

  return <div className="sire-wallet-panel-backdrop" onMouseDown={() => setOpen(false)}>
    <section className="sire-wallet-panel" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="SIRE Wallet">
      <header className="sire-wallet-panel-head">
        <div><span>SIRE WALLET</span><b>Self-custody · multi-chain</b></div>
        <div className="sire-wallet-head-actions"><button type="button" onClick={() => void refresh()}><RefreshCw size={15}/></button><button type="button" onClick={() => setOpen(false)}><X size={17}/></button></div>
      </header>
      {!unlocked ? <div className="sire-wallet-lock">
        <LockKeyhole size={28}/><h3>Unlock SIRE Wallet</h3><p>Unlock the wallet before balances, signing and asset controls become available.</p>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Wallet password" onKeyDown={e=>{if(e.key==='Enter')void (async()=>{try{await unlockNativeWallet(password);setUnlocked(true)}catch(error){setMessage(error instanceof Error?error.message:String(error))}})()}}/>
        <button type="button" onClick={async()=>{try{await unlockNativeWallet(password);setUnlocked(true)}catch(error){setMessage(error instanceof Error?error.message:String(error))}}>Unlock</button>
        {message && <small>{message}</small>}
      </div> : <div className="sire-wallet-panel-body">
        <div className="sire-wallet-network-scroll">{ALL_NETWORKS.map(item=><button key={item} className={network===item?'active':''} onClick={()=>setNetwork(item)}>{item}</button>)}</div>
        <div className="sire-wallet-identity">
          <div><span>{network} address</span><b>{network==='Solana'?short(addresses.solana):network==='TRON'?short(addresses.tron):short(addresses.evm)}</b></div>
          <button type="button" onClick={()=>void copy(network==='Solana'?addresses.solana:network==='TRON'?addresses.tron:addresses.evm)}><Copy size={14}/></button>
        </div>
        <div className="sire-wallet-actions">
          <button onClick={()=>setSendOpen(true)}><ArrowUpFromLine size={16}/>Send</button>
          <button onClick={()=>setReceiveOpen(true)}><ArrowDownToLine size={16}/>Receive</button>
          <button onClick={()=>setHistoryOpen(v=>!v)}><History size={16}/>History</button>
          <button onClick={()=>setTokenOpen(true)}><Plus size={16}/>Token</button>
        </div>
        {message && <div className="sire-wallet-message"><ShieldCheck size={14}/>{message}</div>}
        <div className="sire-wallet-assets">{assets.map(asset=><div className="sire-wallet-asset" key={asset.id}><div><b>{asset.symbol}</b><span>{asset.name}</span></div><strong>{money(asset.balance)}</strong></div>)}</div>
        {historyOpen && <div className="sire-wallet-history">{history.map(item=><a key={item.id} href={item.explorerUrl} target="_blank" rel="noreferrer"><span>{item.direction} · {item.symbol || item.network}</span><b>{short(item.hash)}</b><ExternalLink size={12}/></a>)}</div>}
        <button className="sire-wallet-create-chains" onClick={()=>void createChains()}><WalletCards size={15}/> Create Solana + TRON accounts</button>
        <button className="sire-wallet-recovery" onClick={()=>setShowRecovery(v=>!v)}><KeyRound size={14}/> Recovery & security</button>
        {showRecovery && <div className="sire-wallet-security"><p>Recovery phrase/private keys never leave this device during normal signing. The current browser keystore is encrypted at rest, but this is not yet hardware-backed secure storage.</p><p>Never paste recovery material into chat or a website.</p></div>}
      </div>}
      {sendOpen && <div className="sire-wallet-submodal" onMouseDown={()=>setSendOpen(false)}><div onMouseDown={e=>e.stopPropagation()}><h3>Send {network}</h3><select value={sendAssetId||assets[0]?.id||''} onChange={e=>setSendAssetId(e.target.value)}>{assets.map(a=><option key={a.id} value={a.id}>{a.symbol} · {a.balance}</option>)}</select><input value={sendTo} onChange={e=>setSendTo(e.target.value)} placeholder="Destination address"/><input value={sendAmount} onChange={e=>setSendAmount(e.target.value)} placeholder="Amount"/>{EVM_NETWORKS.includes(network)&&<button type="button" onClick={()=>void previewGas()}>Estimate gas</button>}{gasPreview&&<small>Estimated network fee: {gasPreview}</small>}{(network==='Solana'||network==='TRON')&&<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Wallet password to sign"/>}<button type="button" disabled={busy} onClick={()=>void send()}>{busy?'Signing…':'Review & Send'}</button></div></div>}
      {receiveOpen && <div className="sire-wallet-submodal" onMouseDown={()=>setReceiveOpen(false)}><div onMouseDown={e=>e.stopPropagation()}><h3>Receive {network}</h3><code>{network==='Solana'?addresses.solana:network==='TRON'?addresses.tron:addresses.evm}</code><button onClick={()=>void copy(network==='Solana'?addresses.solana:network==='TRON'?addresses.tron:addresses.evm)}><Copy size={14}/>Copy address</button><p>Only send assets compatible with this network to this address.</p></div></div>}
      {tokenOpen && <div className="sire-wallet-submodal" onMouseDown={()=>setTokenOpen(false)}><div onMouseDown={e=>e.stopPropagation()}><h3>Add ERC-20 token</h3><select value={tokenNetwork} onChange={e=>setTokenNetwork(e.target.value as WalletNetwork)}>{EVM_NETWORKS.map(n=><option key={n}>{n}</option>)}</select><input value={tokenAddress} onChange={e=>setTokenAddress(e.target.value)} placeholder="ERC-20 contract address"/><button disabled={busy} onClick={()=>void addToken()}>Add token</button><p>The token contract metadata is read directly from the selected chain.</p></div></div>}
    </section>
  </div>;
}
