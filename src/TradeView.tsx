import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ChevronDown, CircleAlert, LoaderCircle, LockKeyhole, Search, WalletCards, X } from 'lucide-react';
import './tradeSwap.css';
import {
  ETHEREUM_TOKENS,
  SWAP_NETWORKS,
  EVM_SWAP_NETWORKS,
  type SwapToken,
  type SwapQuote,
  
  executeSwap,
  fetchNetworkTokens,
  formatUnits,
  getInjectedProvider,
  getSwapQuote,
  readTokenBalance,
  switchToNetwork,
} from './swapEngine';
import { cancelPreparedNativeWallet, finalizePreparedNativeWallet, getNativeWalletAddress, hasNativeWallet, isNativeWalletUnlocked, prepareNativeWallet } from './sireWalletCore';

type Props = { referencePrice?: number; referenceChange?: number };

const PRODUCTS = ['Swap', 'Spot', 'Margin', 'Futures', 'Options', 'Alpha', 'Tokenized', 'TradFi'];
const NETWORKS = ['Ethereum', 'BNB Chain', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'TRON'];

const money = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';

const shortAddress = (value: string) => value ? value.slice(0, 6) + '…' + value.slice(-4) : '';

export default function TradeView({ referencePrice = 0 }: Props) {
  const [network, setNetwork] = useState('Ethereum');
  const [tokens, setTokens] = useState<SwapToken[]>(ETHEREUM_TOKENS);
  const [from, setFrom] = useState<SwapToken>(ETHEREUM_TOKENS[0]);
  const [to, setTo] = useState<SwapToken>(ETHEREUM_TOKENS[1]);
  const [amount, setAmount] = useState('1');
  const [wallet, setWallet] = useState('');
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [fromBalance, setFromBalance] = useState('0');
  const [tradeMode, setTradeMode] = useState<'Swap' | 'Limit'>('Swap');
  const [slippage, setSlippage] = useState(0.005);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [tokenPicker, setTokenPicker] = useState<'from' | 'to' | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [executionError, setExecutionError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [nativeWallet, setNativeWallet] = useState('');
  const [nativeUnlocked, setNativeUnlocked] = useState(false);
  const [walletOnboarding, setWalletOnboarding] = useState(false);
  const [walletStep, setWalletStep] = useState<'intro' | 'backup' | 'confirm'>('intro');
  const [walletPassword, setWalletPassword] = useState('');
  const [walletPasswordConfirm, setWalletPasswordConfirm] = useState('');
  const [walletMnemonic, setWalletMnemonic] = useState('');
  const [walletConfirmPhrase, setWalletConfirmPhrase] = useState('');
  const [walletCreationError, setWalletCreationError] = useState('');
  const [walletCreating, setWalletCreating] = useState(false);
  const [walletCreatedAddress, setWalletCreatedAddress] = useState('');

  useEffect(() => {
    const syncNativeWallet = () => {
      setNativeWallet(getNativeWalletAddress());
      setNativeUnlocked(isNativeWalletUnlocked());
    };
    const openNativeWallet = () => {
      setWalletCreationError('');
      setWalletOnboarding(true);
      setWalletStep(hasNativeWallet() ? 'intro' : 'intro');
    };
    syncNativeWallet();
    window.addEventListener('sire:native-wallet-state', syncNativeWallet);
    window.addEventListener('sire:open-native-wallet', openNativeWallet);
    return () => {
      window.removeEventListener('sire:native-wallet-state', syncNativeWallet);
      window.removeEventListener('sire:open-native-wallet', openNativeWallet);
    };
  }, []);

  const beginWalletCreation = () => {
    try {
      const prepared = prepareNativeWallet();
      setWalletMnemonic(prepared.mnemonic);
      setWalletConfirmPhrase('');
      setWalletPassword('');
      setWalletPasswordConfirm('');
      setWalletCreationError('');
      setWalletStep('backup');
    } catch (error) {
      setWalletCreationError(error instanceof Error ? error.message : String(error));
    }
  };

  const finishWalletCreation = async () => {
    if (walletPassword.length < 8) {
      setWalletCreationError('Use a password of at least 8 characters.');
      return;
    }
    if (walletPassword !== walletPasswordConfirm) {
      setWalletCreationError('The passwords do not match.');
      return;
    }
    if (walletConfirmPhrase.trim().replace(/\\s+/g, ' ') !== walletMnemonic.trim().replace(/\\s+/g, ' ')) {
      setWalletCreationError('Recovery phrase does not match. Enter all words in the exact order.');
      return;
    }
    setWalletCreating(true);
    setWalletCreationError('');
    try {
      const result = await finalizePreparedNativeWallet(walletPassword);
      setWalletCreatedAddress(result.address);
      setWalletStep('confirm');
      setNativeWallet(result.address);
      setNativeUnlocked(true);
      setWallet('');
      window.setTimeout(() => {
        setWalletOnboarding(false);
        setWalletStep('intro');
        setWalletMnemonic('');
        setWalletConfirmPhrase('');
        setWalletPassword('');
        setWalletPasswordConfirm('');
        setWalletCreatedAddress('');
      }, 1800);
    } catch (error) {
      setWalletCreationError(error instanceof Error ? error.message : String(error));
    } finally {
      setWalletCreating(false);
    }
  };

  const closeWalletOnboarding = () => {
    if (walletStep === 'backup' || walletStep === 'confirm') cancelPreparedNativeWallet();
    setWalletOnboarding(false);
    setWalletStep('intro');
    setWalletMnemonic('');
    setWalletConfirmPhrase('');
    setWalletPassword('');
    setWalletPasswordConfirm('');
    setWalletCreationError('');
  };

  useEffect(() => {
    const onWalletState = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setWallet(String(detail.address || ''));
      setWalletChain(Number(detail.chainId || 0) || null);
    };
    window.addEventListener('sire:wallet-state', onWalletState);
    return () => window.removeEventListener('sire:wallet-state', onWalletState);
  }, []);

  const filteredTokens = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tokens.slice(0, 100);
    return tokens.filter(token =>
      token.symbol.toLowerCase().includes(q) ||
      token.name.toLowerCase().includes(q) ||
      token.address.toLowerCase() === q
    ).slice(0, 100);
  }, [tokens, search]);

  useEffect(() => {
    const selectedNetwork = SWAP_NETWORKS[network];
    if (!selectedNetwork || !EVM_SWAP_NETWORKS.some(item => item.chainId === selectedNetwork.chainId)) return;
    void fetchNetworkTokens(selectedNetwork).then(next => {
      setTokens(next);
      setFrom(current => next.find(token => token.address.toLowerCase() === current.address.toLowerCase()) || next[0] || current);
      setTo(current => next.find(token => token.address.toLowerCase() === current.address.toLowerCase()) || next[1] || next[0] || current);
    });
  }, [network]);

  useEffect(() => {
    if (!wallet || !EVM_SWAP_NETWORKS.some(item => item.name === network)) return;
    void readTokenBalance(from, wallet).then(setFromBalance).catch(() => setFromBalance('0'));
  }, [wallet, from, network]);

  useEffect(() => {
    if (nativeUnlocked && nativeWallet) {
      setWallet(nativeWallet);
      setWalletChain(SWAP_NETWORKS[network]?.chainId ?? null);
      return;
    }
    const provider = getInjectedProvider();
    if (!provider) return;
    const onAccounts = (accounts: string[]) => setWallet(String(accounts?.[0] || ''));
    const onChain = (chain: string) => setWalletChain(Number.parseInt(String(chain), 16));
    provider.request({ method: 'eth_accounts' }).then((accounts: string[]) => onAccounts(accounts)).catch(() => {});
    provider.request({ method: 'eth_chainId' }).then((chain: string) => onChain(chain)).catch(() => {});
    provider.on?.('accountsChanged', onAccounts);
    provider.on?.('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, [nativeUnlocked, nativeWallet, network]);

  useEffect(() => {
    setQuote(null);
    setQuoteError('');
    if (!wallet || !EVM_SWAP_NETWORKS.some(item => item.name === network) || tradeMode !== 'Swap' || from.address.toLowerCase() === to.address.toLowerCase()) return;
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const next = await getSwapQuote({ fromToken: from, toToken: to, amount, wallet, slippage });
        if (!cancelled) {
          setQuote(next);
          setQuoteError('');
        }
      } catch (error) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [wallet, network, tradeMode, from, to, amount, slippage]);

  const connect = async () => {
    setExecutionError('');
    if (isNativeWalletUnlocked() && getNativeWalletAddress()) {
      setWallet(getNativeWalletAddress());
      setWalletChain(SWAP_NETWORKS[network]?.chainId ?? null);
      return;
    }
    if (hasNativeWallet()) {
      setExecutionError('Unlock your SIRE Wallet to use Swap. No external wallet is required.');
      window.dispatchEvent(new CustomEvent('sire:open-native-wallet'));
      return;
    }
    setExecutionError('Create your SIRE Wallet first. Swap uses your native SIRE Wallet and does not require an external wallet.');
    window.dispatchEvent(new CustomEvent('sire:open-native-wallet'));
  };

  const selectNetwork = async (value: string) => {
    const selectedNetwork = SWAP_NETWORKS[value];
    if (!selectedNetwork) return;
    setExecutionError('');
    setNetwork(value);
    setQuote(null);

    if (!EVM_SWAP_NETWORKS.some(item => item.chainId === selectedNetwork.chainId)) {
      setExecutionError(value + ' is not yet connected to the native SIRE signing adapter.');
      return;
    }

    try {
      if (wallet && !nativeUnlocked) {
        await switchToNetwork(selectedNetwork);
        const nextTokens = await fetchNetworkTokens(selectedNetwork);
        setTokens(nextTokens);
        setWalletChain(selectedNetwork.chainId);
        setFrom(nextTokens[0] || from);
        setTo(nextTokens[1] || nextTokens[0] || to);
      }
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : String(error));
    }
  };

  const chooseToken = (token: SwapToken) => {
    if (tokenPicker === 'from') {
      if (token.address.toLowerCase() === to.address.toLowerCase()) setTo(from);
      setFrom(token);
    } else if (tokenPicker === 'to') {
      if (token.address.toLowerCase() === from.address.toLowerCase()) setFrom(to);
      setTo(token);
    }
    setTokenPicker(null);
    setSearch('');
  };

  const output = quote ? formatUnits(quote.toAmount, quote.toToken.decimals, 6) : '';
  const minimum = quote ? formatUnits(quote.toAmountMin, quote.toToken.decimals, 6) : '';
  const balanceDisplay = formatUnits(fromBalance, from.decimals, 6);
  const canExecute = Boolean(nativeUnlocked && nativeWallet && quote?.transactionRequest && !busy && EVM_SWAP_NETWORKS.some(item => item.name === network));

  const execute = async () => {
    if (!quote || !wallet || !nativeUnlocked) return;
    setBusy(true);
    setExecutionError('');
    setTxHash('');
    try {
      setStatus('Refreshing executable quote');
      const freshQuote = await getSwapQuote({ fromToken: from, toToken: to, amount, wallet, slippage });
      setQuote(freshQuote);
      if (!freshQuote.transactionRequest?.to) throw new Error('The provider returned a non-executable quote.');
      if (freshQuote.expiresAt && Date.now() >= freshQuote.expiresAt) throw new Error('The refreshed quote expired before execution. Please try again.');
      const result = await executeSwap(freshQuote, wallet, setStatus);
      setTxHash(result.hash);
      setStatus('Swap confirmed');
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return <div className="sire-swap-shell">
    <header className="sire-trade-productbar">
      <div className="sire-trade-product-scroll">
        {PRODUCTS.map(product => (
          <button key={product} type="button" className={product === 'Swap' ? 'active' : ''} disabled={product !== 'Swap'}>{product}</button>
        ))}
      </div>
      <div className="sire-trade-status">
        <span className="sire-status-dot" />
        {wallet ? shortAddress(wallet) : 'Wallet not connected'}
      </div>
    </header>

    <div className="sire-trade-mode-row" role="tablist" aria-label="Trade mode">
      <div className="sire-trade-mode-pills">
        {(['Swap', 'Limit'] as const).map(mode => (
          <button key={mode} type="button" role="tab" aria-selected={tradeMode === mode}
            className={tradeMode === mode ? 'active' : ''} onClick={() => setTradeMode(mode)}>
            {mode}
          </button>
        ))}
      </div>
    </div>

    <div className="sire-swap-workspace">
      <aside className="sire-swap-rail">
        <div className="sire-swap-rail-head"><span>NETWORK</span><strong>Choose chain</strong></div>
        <div className="sire-swap-network-list">
          {NETWORKS.map(item => (
            <button key={item} type="button" className={item === network ? 'active' : ''} onClick={() => void selectNetwork(item)}>
              <span className="sire-network-icon">{item.slice(0, 1)}</span><span>{item}</span>{item === network && <i>✓</i>}
            </button>
          ))}
        </div>
        <div className="sire-swap-rail-divider" />
        <div className="sire-swap-rail-label">POPULAR TOKENS</div>
        {tokens.slice(0, 6).map(token => (
          <button key={token.address} className="sire-popular-token" type="button" onClick={() => setTo(token)}>
            <span className="sire-token-mark">{token.symbol.slice(0, 1)}</span>
            <span><b>{token.symbol}</b><small>{token.name}</small></span>
          </button>
        ))}
      </aside>

      <main className="sire-swap-main">
        <div className="sire-swap-grid">
          <section className="sire-swap-card sire-swap-form-card">
            <div className="sire-swap-token-box">
              <div className="sire-swap-token-label"><span>From</span><span>Balance {wallet ? balanceDisplay + ' ' + from.symbol : '—'}</span></div>
              <div className="sire-swap-token-row">
                <button type="button" className="sire-token-select" onClick={() => setTokenPicker('from')}>
                  <span className="sire-token-mark large">{from.symbol.slice(0,1)}</span>
                  <span><b>{from.symbol}</b><small>{from.name}</small></span><ChevronDown size={15}/>
                </button>
                <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00"/>
                <button type="button" className="sire-max" onClick={() => setAmount(balanceDisplay)}>MAX</button>
              </div>
              <small className="sire-usd-reference">
                {referencePrice > 0 && from.symbol === 'ETH' ? '≈ $' + money(Number(amount || 0) * referencePrice, 2) : quote ? 'Live executable quote' : 'Connect wallet for a live quote'}
              </small>
            </div>

            <button className="sire-swap-flip" type="button" aria-label="Reverse swap" onClick={() => { setFrom(to); setTo(from); }}>
              <ArrowDownUp size={17}/>
            </button>

            <div className="sire-swap-token-box">
              <div className="sire-swap-token-label"><span>To</span><span>Minimum received {quote ? minimum + ' ' + to.symbol : '—'}</span></div>
              <div className="sire-swap-token-row">
                <button type="button" className="sire-token-select" onClick={() => setTokenPicker('to')}>
                  <span className="sire-token-mark large">{to.symbol.slice(0,1)}</span>
                  <span><b>{to.symbol}</b><small>{to.name}</small></span><ChevronDown size={15}/>
                </button>
                <div className="sire-output-value">{quoteLoading ? <LoaderCircle className="sire-spin" size={21}/> : output || '—'}</div>
              </div>
              <small className="sire-usd-reference">
                {quote ? 'Route: ' + (quote.toolName || quote.tool || 'aggregator') : 'Waiting for an executable provider quote'}
              </small>
            </div>

            <div className="sire-slippage">
              <span>Slippage</span>
              <div>
                {[0.001, 0.005, 0.01].map(value => (
                  <button key={value} type="button" className={slippage === value ? 'active' : ''} onClick={() => setSlippage(value)}>
                    {(value * 100).toFixed(1)}%
                  </button>
                ))}
              </div>
            </div>

            <div className="sire-swap-details">
              <div><span>Price impact</span><b>{quote?.priceImpact != null ? (quote.priceImpact * 100).toFixed(2) + '%' : '—'}</b></div>
              <div><span>Network fee</span><b>{quote?.gasUSD ? '$' + Number(quote.gasUSD).toFixed(2) : '—'}</b></div>
              <div><span>Minimum received</span><b>{quote ? minimum + ' ' + to.symbol : '—'}</b></div>
            </div>

            {!wallet ? (
              <button type="button" className="sire-review-button sire-connect-button" onClick={() => void connect()}>
                <WalletCards size={15}/> {hasNativeWallet() ? 'Unlock SIRE Wallet' : 'Create SIRE Wallet'}
              </button>
            ) : walletChain !== (SWAP_NETWORKS[network]?.chainId ?? 1) ? (
              <button type="button" className="sire-review-button" onClick={() => void selectNetwork(network)}>Switch to {network}</button>
            ) : (
              <button type="button" className="sire-review-button" disabled={!canExecute} onClick={() => void execute()}>
                {busy ? <><LoaderCircle className="sire-spin" size={15}/> {status || 'Executing'}</> : quote ? 'Confirm Swap' : quoteLoading ? 'Getting live quote…' : 'Waiting for executable quote'}
              </button>
            )}

            {(quoteError || executionError) && <div className="sire-swap-error"><CircleAlert size={14}/><span>{quoteError || executionError}</span></div>}
            {status && !executionError && <div className="sire-swap-status">{status}{txHash && <a href={'https://etherscan.io/tx/' + txHash} target="_blank" rel="noreferrer">View transaction</a>}</div>}

            <div className="sire-swap-safety"><LockKeyhole size={13}/> Quotes expire quickly and are revalidated before signing.</div>
          </section>
        </div>
      </main>
    </div>

    {walletOnboarding && <div className="sire-modal-backdrop" onMouseDown={closeWalletOnboarding}>
      <section className="sire-token-modal sire-wallet-onboarding" role="dialog" aria-modal="true" aria-label="Create SIRE Wallet" onMouseDown={e => e.stopPropagation()}>
        <div className="sire-token-modal-head">
          <div><b>{walletStep === 'intro' ? 'Create SIRE Wallet' : walletStep === 'backup' ? 'Secure your wallet' : 'Wallet created'}</b><small>Native self-custody wallet · no external wallet required</small></div>
          {walletStep !== 'confirm' && <button type="button" onClick={closeWalletOnboarding} aria-label="Close wallet setup"><X size={17}/></button>}
        </div>

        {walletStep === 'intro' && <div className="sire-wallet-onboarding-body">
          <div className="sire-wallet-hero-icon"><WalletCards size={25}/></div>
          <h3>Create your SIRE Wallet</h3>
          <p>Your wallet is created on this device and its recovery phrase is controlled by you. Swap will use this wallet directly instead of asking you to connect an external wallet.</p>
          <div className="sire-wallet-warning"><LockKeyhole size={15}/><span>Never share your recovery phrase or password. SIRE cannot recover a lost recovery phrase.</span></div>
          <button type="button" className="sire-review-button" onClick={beginWalletCreation}>Create Wallet</button>
          {hasNativeWallet() && <button type="button" className="sire-wallet-secondary" onClick={() => { closeWalletOnboarding(); window.dispatchEvent(new CustomEvent('sire:native-wallet-state')); }}>I already have a wallet</button>}
        </div>}

        {walletStep === 'backup' && <div className="sire-wallet-onboarding-body">
          <h3>Back up your recovery phrase</h3>
          <p>Write these words down offline, in the exact order. This phrase is the recovery key for the wallet.</p>
          <div className="sire-wallet-mnemonic">{walletMnemonic.split(' ').map((word, index) => <span key={word + index}><i>{index + 1}</i><b>{word}</b></span>)}</div>
          <div className="sire-wallet-form">
            <label>Set wallet password<input type="password" autoComplete="new-password" value={walletPassword} onChange={e => setWalletPassword(e.target.value)} placeholder="At least 8 characters"/></label>
            <label>Confirm password<input type="password" autoComplete="new-password" value={walletPasswordConfirm} onChange={e => setWalletPasswordConfirm(e.target.value)} placeholder="Repeat password"/></label>
            <label>Confirm recovery phrase<input value={walletConfirmPhrase} onChange={e => setWalletConfirmPhrase(e.target.value)} placeholder="Type all words in order"/></label>
          </div>
          {walletCreationError && <div className="sire-swap-error"><CircleAlert size={14}/><span>{walletCreationError}</span></div>}
          <button type="button" className="sire-review-button" disabled={walletCreating || !walletMnemonic} onClick={() => void finishWalletCreation()}>{walletCreating ? <><LoaderCircle className="sire-spin" size={15}/> Creating wallet…</> : 'Confirm & Create Wallet'}</button>
          <button type="button" className="sire-wallet-secondary" onClick={closeWalletOnboarding}>Cancel</button>
        </div>}

        {walletStep === 'confirm' && <div className="sire-wallet-onboarding-body sire-wallet-created">
          <div className="sire-wallet-success">✓</div>
          <h3>SIRE Wallet created</h3>
          <p>Your native wallet is unlocked and ready for Swap.</p>
          <code>{shortAddress(walletCreatedAddress)}</code>
        </div>}
      </section>
    </div>}
    {tokenPicker && <div className="sire-modal-backdrop sire-token-picker-backdrop" onMouseDown={() => setTokenPicker(null)}>
      <section className="sire-token-modal sire-token-picker-sheet" role="dialog" aria-modal="true" aria-label="Select token" onMouseDown={e => e.stopPropagation()}>
        <div className="sire-token-sheet-handle" aria-hidden="true"><span /></div>
        <div className="sire-token-modal-head">
          <div><b>Select token</b><small>{network} · live token catalogue</small></div>
          <button type="button" onClick={() => setTokenPicker(null)} aria-label="Close token selector"><X size={17}/></button>
        </div>
        <div className="sire-token-search"><Search size={15}/><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search symbol, name or address"/></div>
        <div className="sire-token-network-strip" aria-label="Networks">
          {NETWORKS.map(item => (
            <button key={item} type="button" className={item === network ? 'active' : ''} onClick={() => void selectNetwork(item)}>
              <span className="sire-token-network-icon">{item.slice(0, 1)}</span>
              <span>{item}</span>
            </button>
          ))}
        </div>
        <div className="sire-token-list" aria-label="Instruments">
          {filteredTokens.map(token => (
            <button key={token.address} type="button" onClick={() => chooseToken(token)}>
              <span className="sire-token-mark">{token.symbol.slice(0,1)}</span>
              <span><b>{token.symbol}</b><small>{token.name}</small></span>
              <span className="sire-token-address">{token.address.slice(0,6) + '…' + token.address.slice(-4)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>}
  </div>;
}
