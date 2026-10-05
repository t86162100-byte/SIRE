import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine, ArrowUpFromLine, ChevronDown, Copy, ExternalLink, Eye, EyeOff,
  Globe2, History, KeyRound, LockKeyhole, Plus, Search, Send, Settings2,
  ShieldCheck, WalletCards, X
} from 'lucide-react';
import {
  type WalletAsset, type WalletHistoryItem, type WalletNetwork,
  createSolanaAccount, createTronAccount, estimateEvmGas, getEvmAssets, getEvmHistory,
  getReceiveAddresses, getSolanaAssets, getSolanaHistory, getTronAssets,
  importEvmToken, sendEvmAsset, sendSolana, sendTron, getTronHistory
} from './sireWalletMultiChain';
import { isNativeWalletUnlocked, unlockNativeWallet } from './sireWalletCore';

const EVM_NETWORKS: WalletNetwork[] = ['Ethereum','BNB Chain','Base','Arbitrum','Optimism','Polygon','Avalanche'];
const ALL_NETWORKS: WalletNetwork[] = [...EVM_NETWORKS,'Solana','TRON'];

function short(value: string) { return value ? value.slice(0,6) + '…' + value.slice(-4) : 'Not created'; }
function num(value?: string | number) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined,{maximumFractionDigits:8}) : '0';
}

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
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendAssetId, setSendAssetId] = useState('');
  const [gasPreview, setGasPreview] = useState('');
  const [tokenNetwork, setTokenNetwork] = useState<WalletNetwork>('Ethereum');
  const [tokenAddress, setTokenAddress] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onState = () => setUnlocked(isNativeWalletUnlocked());
    const onTab = (event: Event) => {
      if ((event as CustomEvent).detail?.tab === 'portfolio') setOpen(true);
    };
    window.addEventListener('sire:open-native-wallet', onOpen);
    window.addEventListener('sire:native-wallet-state', onState);
    window.addEventListener('sire:tab-changed', onTab);
    return () => {
      window.removeEventListener('sire:open-native-wallet', onOpen);
      window.removeEventListener('sire:native-wallet-state', onState);
      window.removeEventListener('sire:tab-changed', onTab);
    };
  }, []);

  const address = network === 'Solana' ? addresses.solana : network === 'TRON' ? addresses.tron : addresses.evm;
  const selectedAsset = useMemo(() => assets.find(item => item.id === sendAssetId) || assets[0], [assets, sendAssetId]);
  const visibleAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter(item => `${item.symbol} ${item.name} ${item.address || ''}`.toLowerCase().includes(q));
  }, [assets, search]);

  const refresh = async () => {
    if (!isNativeWalletUnlocked()) { setUnlocked(false); return; }
    setBusy(true); setMessage('');
    try {
      setAddresses(await getReceiveAddresses());
      const next = EVM_NETWORKS.includes(network)
        ? await getEvmAssets(network as Exclude<WalletNetwork,'Solana'|'TRON'>)
        : network === 'Solana' ? await getSolanaAssets() : await getTronAssets();
      setAssets(next);
      if (historyOpen) {
        const rows = EVM_NETWORKS.includes(network)
          ? await getEvmHistory(network as Exclude<WalletNetwork,'Solana'|'TRON'>)
          : network === 'Solana' ? await getSolanaHistory() : await getTronHistory();
        setHistory(rows);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  useEffect(() => { if (open && unlocked) void refresh(); }, [open, unlocked, network, historyOpen]);

  const copy = async (value: string) => {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    setMessage('Address copied');
  };

  const createChains = async () => {
    if (!password) { setMessage('Enter your wallet password first.'); return; }
    setBusy(true);
    try {
      await createSolanaAccount(password);
      await createTronAccount(password);
      setMessage('Solana and TRON accounts created.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const addToken = async () => {
    if (!tokenAddress.trim()) return;
    setBusy(true);
    try {
      await importEvmToken({ network: tokenNetwork, address: tokenAddress.trim(), symbol:'', name:'', decimals:18 });
      setTokenAddress('');
      setTokenOpen(false);
      setMessage('Token added.');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const previewGas = async () => {
    if (!selectedAsset || !EVM_NETWORKS.includes(network) || !sendTo || !sendAmount) return;
    try {
      const gas = await estimateEvmGas(network as Exclude<WalletNetwork,'Solana'|'TRON'>, selectedAsset, sendTo.trim(), sendAmount.trim());
      setGasPreview(gas.nativeFee + ' native');
    } catch (error) { setGasPreview(error instanceof Error ? error.message : String(error)); }
  };

  const send = async () => {
    if (!selectedAsset) return;
    setBusy(true); setMessage('');
    try {
      if (EVM_NETWORKS.includes(network)) {
        const result = await sendEvmAsset(network as Exclude<WalletNetwork,'Solana'|'TRON'>, selectedAsset, sendTo.trim(), sendAmount.trim());
        setMessage('Transaction confirmed · ' + result.hash);
      } else if (network === 'Solana') {
        if (selectedAsset.symbol !== 'SOL') throw new Error('SPL token transfers are next in the token manager.');
        const result = await sendSolana(password, sendTo.trim(), sendAmount.trim());
        setMessage('Transaction confirmed · ' + result.hash);
      } else {
        if (selectedAsset.symbol !== 'TRX') throw new Error('TRC-20 token transfers are next in the token manager.');
        const result = await sendTron(password, sendTo.trim(), sendAmount.trim());
        setMessage('Transaction submitted · ' + result.hash);
      }
      setSendTo(''); setSendAmount(''); setGasPreview(''); setSendOpen(false);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  if (!open) return null;

  if (!unlocked) return (
    <div className="sire-wallet-shell-backdrop" onMouseDown={() => setOpen(false)}>
      <section className="sire-wallet-shell sire-wallet-lock-shell" onMouseDown={e => e.stopPropagation()}>
        <button className="sire-wallet-close" onClick={() => setOpen(false)}><X size={18}/></button>
        <div className="sire-wallet-lock-icon"><LockKeyhole size={26}/></div>
        <span className="sire-wallet-kicker">SIRE WALLET</span>
        <h2>Unlock your wallet</h2>
        <p>Your keys remain self-custodied. Unlock locally to view balances and sign transactions.</p>
        <input autoFocus type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Wallet password" onKeyDown={e => { if (e.key === 'Enter') void (async () => { try { await unlockNativeWallet(password); setUnlocked(true); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } })(); }} />
        <button className="sire-wallet-primary" onClick={async () => { try { await unlockNativeWallet(password); setUnlocked(true); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>Unlock Wallet</button>
        {message && <small className="sire-wallet-error">{message}</small>}
      </section>
    </div>
  );

  return (
    <div className="sire-wallet-shell-backdrop" onMouseDown={() => setOpen(false)}>
      <section className="sire-wallet-shell" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="SIRE Wallet Portfolio">
        <div className="sire-wallet-mode-toggle" role="tablist" aria-label="Portfolio mode">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="active"
            onClick={() => setOpen(true)}
          >Wallet</button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new CustomEvent('sire:open-trade'));
            }}
          >Exchange</button>
        </div>

        <div className="sire-wallet-search-row">
          <label className="sire-wallet-global-search">
            <Search size={15}/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search assets or tokens" aria-label="Search assets or tokens"/>
          </label>
          <button className="sire-wallet-network-globe" type="button" onClick={() => setNetworkOpen(v => !v)} aria-label="Choose network" title="Networks">
            <Globe2 size={17}/>
          </button>
        </div>

        <div className="sire-wallet-account-row">
          <button className="sire-wallet-account" onClick={() => void copy(address)} aria-label="Copy wallet address">
            <span>Wallet</span><b>{short(address)}</b><Copy size={13}/>
          </button>
        </div>

        <div className="sire-wallet-scroll">
          <section className="sire-wallet-hero">
            <div className="sire-wallet-hero-row">
              <div>
                <button className="sire-wallet-eye" onClick={() => setBalanceVisible(v => !v)}>{balanceVisible ? <Eye size={14}/> : <EyeOff size={14}/>} {balanceVisible ? 'Visible' : 'Hidden'}</button>
                <strong><span className="sire-wallet-currency">$</span><span className="sire-wallet-leading-digit">{balanceVisible ? '0' : '•'}</span><span className="sire-wallet-decimal">{balanceVisible ? '.00' : '••'}</span></strong>
              </div>
            </div>
            <div className="sire-wallet-quick-actions">
              <button onClick={() => setSendOpen(true)}><span><ArrowUpFromLine size={17}/></span><b>Send</b></button>
              <button onClick={() => setReceiveOpen(true)}><span><ArrowDownToLine size={17}/></span><b>Receive</b></button>
              <button onClick={() => setTokenOpen(true)}><span><Plus size={17}/></span><b>Add token</b></button>
              <button onClick={() => setNetworkOpen(v => !v)}><span><WalletCards size={17}/></span><b>Networks</b></button>
            </div>
          </section>

          <section className="sire-wallet-network-bar">
            <div className="sire-wallet-network-title"><span>NETWORK</span><button onClick={() => setNetworkOpen(v => !v)}>{network}<ChevronDown size={14}/></button></div>
            {networkOpen && <div className="sire-wallet-network-menu">{ALL_NETWORKS.map(item => <button key={item} className={item === network ? 'active' : ''} onClick={() => { setNetwork(item); setNetworkOpen(false); setSearch(''); }}>{item}<span>{item === network ? '✓' : ''}</span></button>)}</div>}
          </section>

          <section className="sire-wallet-assets-section">
            <div className="sire-wallet-section-head">
              <div><span>YOUR ASSETS</span><h3>{network}</h3></div>
              <button onClick={() => setTokenOpen(true)}><Plus size={14}/> Manage</button>
            </div>
            <div className="sire-wallet-assets-list">
              {visibleAssets.length ? visibleAssets.map(asset => (
                <button className="sire-wallet-asset-row" key={asset.id} onClick={() => { setSendAssetId(asset.id); setSendOpen(true); }}>
                  <div className="sire-wallet-asset-icon">{asset.logoURI ? <img src={asset.logoURI} alt=""/> : <span>{asset.symbol.slice(0,2)}</span>}</div>
                  <div className="sire-wallet-asset-copy"><b>{asset.symbol}</b><small>{asset.name}</small></div>
                  <div className="sire-wallet-asset-balance"><b>{balanceVisible ? num(asset.balance) : '••••'}</b><small>{asset.symbol}</small></div>
                  <ChevronDown size={14} className="sire-wallet-row-chevron"/>
                </button>
              )) : (
                <div className="sire-wallet-empty"><WalletCards size={22}/><b>No assets yet</b><span>Receive funds or add a token contract for this network.</span></div>
              )}
            </div>
          </section>

          <section className="sire-wallet-tools">
            <button onClick={() => setHistoryOpen(true)}><History size={16}/><span><b>Activity</b><small>Transfers and on-chain transactions</small></span><ChevronDown size={15}/></button>
            <button onClick={() => setReceiveOpen(true)}><ShieldCheck size={16}/><span><b>Security & approvals</b><small>Review signing and wallet safety</small></span><ChevronDown size={15}/></button>
            <button onClick={() => setTokenOpen(true)}><Settings2 size={16}/><span><b>Manage tokens</b><small>Add and organize supported assets</small></span><ChevronDown size={15}/></button>
          </section>

          {historyOpen && <section className="sire-wallet-activity">
            <div className="sire-wallet-section-head"><div><span>RECENT ACTIVITY</span><h3>Transactions</h3></div><button onClick={() => setHistoryOpen(false)}>Close</button></div>
            {history.length ? history.map(item => <a key={item.id} href={item.explorerUrl} target="_blank" rel="noreferrer"><span>{item.direction === 'send' ? 'Sent' : item.direction === 'receive' ? 'Received' : 'Contract'} · {item.symbol || item.network}</span><b>{short(item.hash)}</b><ExternalLink size={12}/></a>) : <div className="sire-wallet-empty"><History size={20}/><span>No transactions found for this network.</span></div>}
          </section>}

          <section className="sire-wallet-multichain">
            <div><span>EXPAND YOUR WALLET</span><b>Solana + TRON</b><small>Create encrypted accounts for additional networks.</small></div>
            <button onClick={() => void createChains()} disabled={busy}>{busy ? 'Creating…' : 'Create accounts'}</button>
          </section>
        </div>

        {message && <div className="sire-wallet-toast"><ShieldCheck size={14}/>{message}</div>}

        {sendOpen && <div className="sire-wallet-modal-backdrop" onMouseDown={() => setSendOpen(false)}><div className="sire-wallet-modal" onMouseDown={e => e.stopPropagation()}>
          <div className="sire-wallet-modal-head"><div><span>SEND</span><h3>{selectedAsset?.symbol || network}</h3></div><button onClick={() => setSendOpen(false)}><X size={17}/></button></div>
          <select value={sendAssetId || assets[0]?.id || ''} onChange={e => setSendAssetId(e.target.value)}>{assets.map(a => <option key={a.id} value={a.id}>{a.symbol} · {a.balance}</option>)}</select>
          <input value={sendTo} onChange={e => setSendTo(e.target.value)} placeholder="Recipient address"/>
          <input value={sendAmount} onChange={e => setSendAmount(e.target.value)} placeholder="Amount"/>
          {EVM_NETWORKS.includes(network) && <button className="sire-wallet-secondary" onClick={() => void previewGas()}>Estimate network fee</button>}
          {gasPreview && <small className="sire-wallet-fee">Estimated fee: {gasPreview}</small>}
          {(network === 'Solana' || network === 'TRON') && <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Wallet password to authorize"/>}
          <div className="sire-wallet-review"><ShieldCheck size={15}/><span>Review the network and destination carefully before signing.</span></div>
          <button className="sire-wallet-primary" disabled={busy} onClick={() => void send()}>{busy ? 'Signing…' : 'Review & Send'}</button>
        </div></div>}

        {receiveOpen && <div className="sire-wallet-modal-backdrop" onMouseDown={() => setReceiveOpen(false)}><div className="sire-wallet-modal sire-wallet-receive" onMouseDown={e => e.stopPropagation()}>
          <div className="sire-wallet-modal-head"><div><span>RECEIVE</span><h3>{network}</h3></div><button onClick={() => setReceiveOpen(false)}><X size={17}/></button></div>
          <div className="sire-wallet-address-box"><span>YOUR ADDRESS</span><code>{address || 'Create this network account first.'}</code></div>
          <button className="sire-wallet-primary" onClick={() => void copy(address)}>Copy address</button>
          <p>Only send assets that belong to this network to this address.</p>
        </div></div>}

        {tokenOpen && <div className="sire-wallet-modal-backdrop" onMouseDown={() => setTokenOpen(false)}><div className="sire-wallet-modal" onMouseDown={e => e.stopPropagation()}>
          <div className="sire-wallet-modal-head"><div><span>MANAGE TOKENS</span><h3>Add asset</h3></div><button onClick={() => setTokenOpen(false)}><X size={17}/></button></div>
          <select value={tokenNetwork} onChange={e => setTokenNetwork(e.target.value as WalletNetwork)}>{EVM_NETWORKS.map(n => <option key={n}>{n}</option>)}</select>
          <input value={tokenAddress} onChange={e => setTokenAddress(e.target.value)} placeholder="ERC-20 contract address"/>
          <button className="sire-wallet-primary" disabled={busy} onClick={() => void addToken()}>{busy ? 'Reading contract…' : 'Add token'}</button>
          <p>SIRE reads symbol, name, decimals and balance directly from the selected chain.</p>
        </div></div>}
      </section>
    </div>
  );
}
