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
import { openEvmWalletModal, reownConfigured } from './reownWallet';

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
  }, []);

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
    try {
      if (reownConfigured) {
        openEvmWalletModal();
        return;
      }
      const provider = getInjectedProvider();
      if (!provider) throw new Error('Wallet connection is not configured. Add VITE_REOWN_PROJECT_ID in Render, or open SIRE in a browser wallet with an injected EVM provider.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const address = String(accounts?.[0] || '');
      if (!address) throw new Error('Wallet did not return an account.');
      const chainHex = await provider.request({ method: 'eth_chainId' });
      setWallet(address);
      setWalletChain(Number.parseInt(String(chainHex), 16));
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : String(error));
    }
  };

  const selectNetwork = async (value: string) => {
    const selectedNetwork = SWAP_NETWORKS[value];
    if (!selectedNetwork) return;
    setExecutionError('');
    setNetwork(value);
    setQuote(null);

    if (!EVM_SWAP_NETWORKS.some(item => item.chainId === selectedNetwork.chainId)) {
      setExecutionError(value + ' needs its native wallet/router adapter; it is not routed through the EVM transaction path.');
      return;
    }

    try {
      if (wallet) {
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
  const canExecute = Boolean(wallet && quote?.transactionRequest && !busy && EVM_SWAP_NETWORKS.some(item => item.name === network));

  const execute = async () => {
    if (!quote || !wallet) return;
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
                <WalletCards size={15}/> Connect Wallet
              </button>
            ) : walletChain !== (SWAP_NETWORKS[network]?.chainId ?? 1) ? (
              <button type="button" className="sire-review-button" onClick={() => void selectNetwork(network)}>Switch to Ethereum</button>
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
