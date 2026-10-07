import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ChevronDown, CircleAlert, LoaderCircle, LockKeyhole, Search, WalletCards, X } from 'lucide-react';
import './tradeSwap.css';
import {
  SWAP_NETWORKS,
  EVM_SWAP_NETWORKS,
  fetchSupportedSwapNetworks,
  type SwapToken,
  type SwapQuote,
  type SwapNetwork,
  type SwapRouteOrder,
  
  executeSwap,
  simulateSwap,
  fetchSwapStatus,
  fetchNetworkTokens,
  formatUnits,
  getInjectedProvider,
  getSwapQuote,
  SwapQuoteUnavailableError,
  formatSwapQuoteFailure,
  amountToBaseUnits,
  readTokenBalance,
  switchToNetwork,
} from './swapEngine';
import { cancelPreparedNativeWallet, finalizePreparedNativeWallet, getNativeWalletAddress, hasNativeWallet, isNativeWalletUnlocked, prepareNativeWallet, unlockNativeWallet } from './sireWalletCore';
import { limitMakingAmount, limitTakingAmount } from './limitOrderEngine';
const loadLimitOrderEngine = () => import('./limitOrderEngine');

type Props = { referencePrice?: number; referenceChange?: number };

const PRODUCTS = ['Swap', 'Spot', 'Margin', 'Futures', 'Options', 'Alpha', 'Tokenized', 'TradFi'];

const money = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';

const shortAddress = (value: string) => value ? value.slice(0, 6) + '…' + value.slice(-4) : '';

const Logo = ({ src, className = '' }: { src?: string; className?: string }) => src ? (
  <img
    src={src}
    alt=""
    className={className}
    loading="lazy"
    decoding="async"
    onError={event => {
      event.currentTarget.style.display = 'none';
      event.currentTarget.nextElementSibling?.removeAttribute('hidden');
    }}
  />
) : null;

const LogoMark = ({ src, fallback, className = '' }: { src?: string; fallback: string; className?: string }) => (
  <span className={className}>
    <Logo src={src} className="sire-logo-image" />
    <span className="sire-logo-fallback" hidden={Boolean(src)}>{fallback}</span>
  </span>
);

export default function TradeView({ referencePrice = 0 }: Props) {
  const [network, setNetwork] = useState('');
  const [supportedNetworks, setSupportedNetworks] = useState<SwapNetwork[]>([]);
  const [tokens, setTokens] = useState<SwapToken[]>([]);
  const [toTokens, setToTokens] = useState<SwapToken[]>([]);
  const [from, setFrom] = useState<SwapToken>({ symbol:'', name:'', address:'', decimals:18, chainId:0 });
  const [to, setTo] = useState<SwapToken>({ symbol:'', name:'', address:'', decimals:18, chainId:0 });
  const [toNetwork, setToNetwork] = useState('');
  const [amount, setAmount] = useState('1');
  const [wallet, setWallet] = useState('');
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [fromBalance, setFromBalance] = useState('0');
  const [tradeMode, setTradeMode] = useState<'Swap' | 'Limit'>('Swap');
  const [slippage, setSlippage] = useState(0.005);
  const [routeOrder, setRouteOrder] = useState<SwapRouteOrder>('CHEAPEST');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [providerQuotes, setProviderQuotes] = useState<SwapQuote[]>([]);
  const [providerOpen, setProviderOpen] = useState(false);
  const [insufficientBalanceOpen, setInsufficientBalanceOpen] = useState(false);
  const [insufficientBalanceAmount, setInsufficientBalanceAmount] = useState('0');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const quoteRequestId = useRef(0);
  const [quoteError, setQuoteError] = useState('');
  const [tokenPicker, setTokenPicker] = useState<'from' | 'to' | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [executionError, setExecutionError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [simulationResult, setSimulationResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [nativeWallet, setNativeWallet] = useState('');
  const [nativeUnlocked, setNativeUnlocked] = useState(false);
  const [walletOnboarding, setWalletOnboarding] = useState(false);
  const [walletStep, setWalletStep] = useState<'intro' | 'backup' | 'unlock' | 'confirm'>('intro');
  const [walletPassword, setWalletPassword] = useState('');
  const [walletPasswordConfirm, setWalletPasswordConfirm] = useState('');
  const [walletMnemonic, setWalletMnemonic] = useState('');
  const [walletConfirmPhrase, setWalletConfirmPhrase] = useState('');
  const [walletCreationError, setWalletCreationError] = useState('');
  const [walletCreating, setWalletCreating] = useState(false);
  const [walletCreatedAddress, setWalletCreatedAddress] = useState('');
  const [recipient, setRecipient] = useState('');
  const [recipientOpen, setRecipientOpen] = useState(false);
  const [recipientError, setRecipientError] = useState('');
  const [quoteSeconds, setQuoteSeconds] = useState(0);
  const [swapHistory, setSwapHistory] = useState<Array<{hash:string;from:string;to:string;amount:string;output:string;fromNetwork:string;toNetwork:string;time:number;recipient:string}>>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [limitPrice, setLimitPrice] = useState('');
  const [limitPricePreset, setLimitPricePreset] = useState('Market');
  const [limitSide, setLimitSide] = useState<'Buy' | 'Sell'>('Buy');
  const [limitMarketPrice, setLimitMarketPrice] = useState('');
  const [limitMarketLoading, setLimitMarketLoading] = useState(false);
  const [limitExpiry, setLimitExpiry] = useState(86400);
  const [limitExpiryCustom, setLimitExpiryCustom] = useState('');
  const [limitExpiryOpen, setLimitExpiryOpen] = useState(false);
  const [limitKeypad, setLimitKeypad] = useState<'amount' | 'price' | null>(null);
  const [limitKeypadDraft, setLimitKeypadDraft] = useState('');
  const [limitBusy, setLimitBusy] = useState(false);
  const [limitError, setLimitError] = useState('');
  const [limitOrders, setLimitOrders] = useState<any[]>([]);

  useEffect(() => {
    const syncNativeWallet = () => {
      setNativeWallet(getNativeWalletAddress());
      setNativeUnlocked(isNativeWalletUnlocked());
    };
    const openNativeWallet = () => {
      setWalletCreationError('');
      setWalletOnboarding(true);
      setWalletStep(hasNativeWallet() ? 'unlock' : 'intro');
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

  const unlockWallet = async () => {
    if (!walletPassword) {
      setWalletCreationError('Enter your wallet password.');
      return;
    }
    setWalletCreating(true);
    setWalletCreationError('');
    try {
      const result = await unlockNativeWallet(walletPassword);
      setWallet(result.address);
      setWalletCreatedAddress(result.address);
      setNativeWallet(result.address);
      setNativeUnlocked(true);
      setWalletStep('confirm');
    } catch (error) {
      setWalletCreationError(error instanceof Error ? error.message : 'Unable to unlock SIRE Wallet.');
    } finally {
      setWalletCreating(false);
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
    if (walletStep === 'backup') cancelPreparedNativeWallet();
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

  const tokenIdentity = (token: SwapToken) => token.chainId + ':' + token.address.toLowerCase();

  const filteredTokens = useMemo(() => {
    const q = search.trim().toLowerCase();
    const opposite = tokenPicker === 'from' ? to : tokenPicker === 'to' ? from : null;
    const oppositeIdentity = opposite ? tokenIdentity(opposite) : '';
    const pickerTokens = tokenPicker === 'to' ? toTokens : tokens;
    const available = pickerTokens.filter(token => tokenIdentity(token) !== oppositeIdentity);
    if (!q) return available.slice(0, 100);
    return available.filter(token =>
      token.symbol.toLowerCase().includes(q) ||
      token.name.toLowerCase().includes(q) ||
      token.address.toLowerCase() === q
    ).slice(0, 100);
  }, [tokens, toTokens, search, tokenPicker, from, to]);

  useEffect(() => {
    let cancelled = false;
    void fetchSupportedSwapNetworks().then(nextNetworks => {
      if (cancelled) return;
      setSupportedNetworks(nextNetworks);
      const preferred = nextNetworks[0];
      if (preferred) {
        setNetwork(current => current && nextNetworks.some(item => item.name === current) ? current : preferred.name);
        setToNetwork(current => current && nextNetworks.some(item => item.name === current) ? current : preferred.name);
      }
    }).catch(error => {
      if (!cancelled) setExecutionError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const selectedNetwork = SWAP_NETWORKS[network];
    if (!selectedNetwork || !EVM_SWAP_NETWORKS.some(item => item.chainId === selectedNetwork.chainId)) return;
    let cancelled = false;
    void fetchNetworkTokens(selectedNetwork).then(next => {
      if (cancelled) return;
      setTokens(next);
      setFrom(current => {
        const preserved = next.find(token => tokenIdentity(token) === tokenIdentity(current));
        return preserved || next[0] || current;
      });
      setToNetwork(current => current || network);
      setTo(current => {
        if (current.chainId === selectedNetwork.chainId) {
          const preserved = next.find(token => tokenIdentity(token) === tokenIdentity(current));
          if (preserved) return preserved;
        }
        const nextFrom = next[0];
        return next.find(token => !nextFrom || tokenIdentity(token) !== tokenIdentity(nextFrom)) || nextFrom || current;
      });
    }).catch(error => {
      if (!cancelled) {
        setTokens([]);
        setExecutionError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => { cancelled = true; };
  }, [network]);

  useEffect(() => {
    const selectedNetwork = SWAP_NETWORKS[toNetwork];
    if (!selectedNetwork || !EVM_SWAP_NETWORKS.some(item => item.chainId === selectedNetwork.chainId)) return;
    if (toNetwork === network) {
      setToTokens(tokens);
      return;
    }
    let cancelled = false;
    void fetchNetworkTokens(selectedNetwork).then(next => {
      if (cancelled) return;
      setToTokens(next);
      setTo(current => {
        const preserved = next.find(token => tokenIdentity(token) === tokenIdentity(current));
        return preserved || next[0] || current;
      });
    }).catch(error => {
      if (!cancelled) {
        setToTokens([]);
        setExecutionError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => { cancelled = true; };
  }, [toNetwork, network, tokens]);

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
    const requestId = ++quoteRequestId.current;
    setQuote(null);
    setProviderQuotes([]);
    setQuoteError('');
    setQuoteLoading(false);

    const effectiveRecipient = recipient.trim() || wallet;
    const recipientIsValid = /^0x[a-fA-F0-9]{40}$/.test(effectiveRecipient);
    if (!wallet || !EVM_SWAP_NETWORKS.some(item => item.name === network) || !EVM_SWAP_NETWORKS.some(item => item.name === toNetwork) || tradeMode !== 'Swap' || tokenIdentity(from) === tokenIdentity(to) || !recipientIsValid) return;
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (requestId !== quoteRequestId.current) return;
      setQuoteLoading(true);
      try {
        // Quote first: balance is intentionally checked only when Confirm Swap is pressed.
        const orders: SwapRouteOrder[] = routeOrder === 'CHEAPEST'
          ? ['CHEAPEST', 'FASTEST']
          : ['FASTEST', 'CHEAPEST'];
        const settled = await Promise.allSettled(
          orders.map(order => getSwapQuote({
            fromToken: from,
            toToken: to,
            amount,
            wallet,
            toAddress: effectiveRecipient,
            slippage,
            order
          }))
        );
        const candidates = settled
          .filter((item): item is PromiseFulfilledResult<SwapQuote> => item.status === 'fulfilled')
          .map(item => item.value);

        const unique: SwapQuote[] = [];
        const seen = new Set<string>();
        for (const candidate of candidates) {
          const key = [
            candidate.toolName || candidate.tool || 'route',
            candidate.toAmount,
            candidate.transactionRequest?.to || '',
            candidate.transactionRequest?.data || ''
          ].join(':');
          if (!seen.has(key)) {
            seen.add(key);
            unique.push(candidate);
          }
        }
        if (!unique.length) {
          const failures = settled
            .filter((item): item is PromiseRejectedResult => item.status === 'rejected')
            .map(item => item.reason);
          const classified = failures.filter((reason): reason is SwapQuoteUnavailableError => reason instanceof SwapQuoteUnavailableError);
          const priority: SwapQuoteUnavailableError['reason'][] = [
            'INSUFFICIENT_FUNDS',
            'AMOUNT_UNSUPPORTED',
            'INSUFFICIENT_LIQUIDITY',
            'TOOL_UNAVAILABLE',
            'PRICE_IMPACT_TOO_HIGH',
            'WALLET_RESTRICTION',
            'NO_ROUTE'
          ];
          const selected = classified.sort((a,b) => priority.indexOf(a.reason) - priority.indexOf(b.reason))[0];
          if (selected) throw new SwapQuoteUnavailableError(
            selected.reason,
            formatSwapQuoteFailure(selected.reason, from.symbol),
            selected.providerCode,
            classified.map(item => item.providerMessage).filter(Boolean).join(' | ')
          );
          const firstFailure = failures[0];
          throw (firstFailure instanceof Error ? firstFailure : new Error('No executable swap route was returned.'));
        }
        unique.sort((a, b) => {
          try {
            const aa = BigInt(a.toAmount || '0');
            const bb = BigInt(b.toAmount || '0');
            return bb > aa ? 1 : bb < aa ? -1 : 0;
          } catch {
            return 0;
          }
        });
        if (!cancelled && requestId === quoteRequestId.current) {
          setProviderQuotes(unique);
          setQuote(unique[0]);
          setQuoteError('');
        }
      } catch (error) {
        if (!cancelled && requestId === quoteRequestId.current) {
          setQuote(null);
          setProviderQuotes([]);
          setQuoteError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled && requestId === quoteRequestId.current) setQuoteLoading(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (requestId === quoteRequestId.current) setQuoteLoading(false);
    };
  }, [wallet, network, toNetwork, tradeMode, from, to, amount, slippage, recipient, routeOrder]);

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

  const selectNetwork = async (value: string, side: 'from' | 'to' = 'from') => {
    const selectedNetwork = supportedNetworks.find(item => item.name === value) || SWAP_NETWORKS[value];
    if (!selectedNetwork) return;
    setExecutionError('');
    setQuote(null);

    if (!EVM_SWAP_NETWORKS.some(item => item.chainId === selectedNetwork.chainId)) {
      setExecutionError(value + ' is not yet connected to the native SIRE signing adapter.');
      return;
    }

    try {
      if (side === 'from') {
        const previousSource = network;
        setNetwork(value);
        if (toNetwork === previousSource) setToNetwork(value);
        if (wallet && !nativeUnlocked) {
          await switchToNetwork(selectedNetwork);
          setWalletChain(selectedNetwork.chainId);
        }
      } else {
        setToNetwork(value);
        if (value === network) setToTokens(tokens);
        else setToTokens(await fetchNetworkTokens(selectedNetwork));
      }
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : String(error));
    }
  };

  const chooseToken = (token: SwapToken) => {
    const selectedIdentity = tokenIdentity(token);
    if (tokenPicker === 'from') {
      // From/To are independent, but the swap form must never end up with the
      // same asset on both sides after a user selection. If the chosen From
      // asset is currently the To asset, move To to the first different token
      // instead of silently copying From into To.
      setFrom(token);
      if (selectedIdentity === tokenIdentity(to)) {
        const replacement = tokens.find(candidate => tokenIdentity(candidate) !== selectedIdentity);
        if (replacement) setTo(replacement);
      }
    } else if (tokenPicker === 'to') {
      setTo(token);
      setToNetwork(supportedNetworks.find(item => item.chainId === token.chainId)?.name || toNetwork);
      if (selectedIdentity === tokenIdentity(from)) {
        const replacement = tokens.find(candidate => tokenIdentity(candidate) !== selectedIdentity);
        if (replacement) setFrom(replacement);
      }
    }
    setTokenPicker(null);
    setSearch('');
  };

  const output = quote ? formatUnits(quote.toAmount, quote.toToken.decimals, 6) : '';
  const effectiveRecipient = recipient.trim() || wallet;
  const recipientValid = /^0x[a-fA-F0-9]{40}$/.test(effectiveRecipient);
  const isCrossChain = network !== toNetwork;
  const pickerTokens = tokenPicker === 'to' ? toTokens : tokens;
  const pickerNetwork = tokenPicker === 'to' ? toNetwork : network;
  const minimum = quote ? formatUnits(quote.toAmountMin, quote.toToken.decimals, 6) : '';
  const balanceDisplay = formatUnits(fromBalance, from.decimals, 6);
  const limitMaker = limitSide === 'Sell' ? from : to;
  const limitTaker = limitSide === 'Sell' ? to : from;
  const limitPriceLabel = limitTaker.symbol + ' per ' + limitMaker.symbol;
  const limitReceiveToken = limitSide === 'Buy' ? limitMaker : limitTaker;
  const limitTargetAmount = (() => {
    try {
      if (!limitPrice || !amount) return '';
      const paymentUnits = amountToBaseUnits(amount, from);
      if (limitSide === 'Buy') {
        return formatUnits(
          limitMakingAmount(paymentUnits, from.decimals, limitMaker.decimals, limitPrice),
          limitMaker.decimals,
          8
        );
      }
      const makerUnits = amountToBaseUnits(amount, limitMaker);
      return formatUnits(
        limitTakingAmount(makerUnits, limitMaker.decimals, limitTaker.decimals, limitPrice),
        limitTaker.decimals,
        8
      );
    } catch {
      return '';
    }
  })();
  const canExecute = Boolean(nativeUnlocked && nativeWallet && recipientValid && quote?.transactionRequest && !busy && EVM_SWAP_NETWORKS.some(item => item.name === network) && EVM_SWAP_NETWORKS.some(item => item.name === toNetwork));

  useEffect(() => {
    if (
      tradeMode !== 'Limit' ||
      !network ||
      network !== toNetwork ||
      limitMaker.chainId !== limitTaker.chainId ||
      tokenIdentity(limitMaker) === tokenIdentity(limitTaker)
    ) {
      setLimitMarketPrice('');
      setLimitMarketLoading(false);
      return;
    }

    let cancelled = false;

    const setCataloguePrice = () => {
      const makerUSD = Number(limitMaker.priceUSD);
      const takerUSD = Number(limitTaker.priceUSD);
      if (Number.isFinite(makerUSD) && makerUSD > 0 && Number.isFinite(takerUSD) && takerUSD > 0) {
        const derived = makerUSD / takerUSD;
        if (Number.isFinite(derived) && derived > 0) setLimitMarketPrice(String(derived));
      }
    };

    // Use the server-side 0x v2 price endpoint so the top price is available
    // even before the wallet is unlocked. Fall back to the live token catalogue.
    const loadLimitMarketPrice = async () => {
      setLimitMarketLoading(true);
      try {
        const makerUnits = (10n ** BigInt(limitMaker.decimals)).toString();
        const response = await fetch('/api/sire/limit-orders/quote', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            chainId: limitMaker.chainId,
            sellToken: limitMaker.address,
            buyToken: limitTaker.address,
            sellAmount: makerUnits,
            buyDecimals: limitTaker.decimals,
            taker: wallet || ''
          })
        });
        const payload = await response.json().catch(() => ({}));
        const buyAmount = String(payload?.quote?.buyAmount || '');
        // The server requests exactly 1 whole maker token, so buyAmount is
        // already the market price in taker-token base units.  Prefer a
        // server-normalized price when available, then derive it from the
        // 0x v2 base-unit response as a fallback.
        const serverPrice = Number(payload?.price || payload?.quote?.price || 0);
        if (response.ok && Number.isFinite(serverPrice) && serverPrice > 0) {
          if (!cancelled) setLimitMarketPrice(String(serverPrice));
          return;
        }
        if (response.ok && /^\d+$/.test(buyAmount)) {
          const price = Number(formatUnits(buyAmount, limitTaker.decimals, 18));
          if (!cancelled && Number.isFinite(price) && price > 0) setLimitMarketPrice(String(price));
          return;
        }
      } catch {
        // Fall back to catalogue pricing below.
      } finally {
        if (!cancelled) setLimitMarketLoading(false);
      }
      if (!cancelled) setCataloguePrice();
    };

    setCataloguePrice();
    void loadLimitMarketPrice();
    const timer = window.setInterval(() => void loadLimitMarketPrice(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tradeMode, wallet, nativeUnlocked, network, toNetwork, limitSide, limitMaker, limitTaker]);

  useEffect(() => {
    if (!quote?.expiresAt) { setQuoteSeconds(0); return; }
    const tick = () => setQuoteSeconds(Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [quote?.expiresAt]);

  useEffect(() => {
    if (!wallet || !network) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const { fetchLimitOrders } = await loadLimitOrderEngine();
        const orders = await fetchLimitOrders(SWAP_NETWORKS[network]?.chainId || from.chainId, wallet);
        if (!cancelled) setLimitOrders(orders);
      } catch {}
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [wallet, network, from.chainId]);


  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('sire.swap.history.v1');
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setSwapHistory(parsed.slice(0, 20));
    } catch {}
  }, []);

  const refreshLimitOrders = async () => {
    if (!wallet || !network) return;
    try {
      const { fetchLimitOrders } = await loadLimitOrderEngine();
      const orders = await fetchLimitOrders(SWAP_NETWORKS[network]?.chainId || from.chainId, wallet);
      setLimitOrders(orders);
      setLimitError('');
    } catch (error) {
      setLimitError(error instanceof Error ? error.message : String(error));
    }
  };

  const placeLimitOrder = async () => {
    if (!wallet || !nativeUnlocked) {
      setLimitError('Unlock SIRE Wallet before placing a limit order.');
      return;
    }
    if (!limitPrice || Number(limitPrice) <= 0) {
      setLimitError('Enter a limit price.');
      return;
    }

    // A Limit intent uses the current 0x Swap API v2 as its pricing source.
    // Sell = sell "from"; Buy = buy "to". Tokens remain in the wallet until
    // the user chooses to execute a firm quote.
    const makerAsset = limitSide === 'Sell' ? from : to;
    const takerAsset = limitSide === 'Sell' ? to : from;
    if (makerAsset.native || takerAsset.native) {
      setLimitError('Limit orders require ERC-20 or wrapped assets. Select the token contract instead of the native coin.');
      return;
    }
    if (makerAsset.chainId !== takerAsset.chainId) {
      setLimitError('Limit orders are single-chain. Use Swap for cross-chain trades.');
      return;
    }

    setLimitBusy(true);
    setLimitError('');
    setExecutionError('');
    setStatus('Preparing limit order');
    try {
      const paymentAmount = amountToBaseUnits(amount, from);
      const makingAmount = limitSide === 'Buy'
        ? limitMakingAmount(paymentAmount, takerAsset.decimals, makerAsset.decimals, limitPrice)
        : paymentAmount;
      const takingAmount = limitSide === 'Buy'
        ? paymentAmount
        : limitTakingAmount(makingAmount, makerAsset.decimals, takerAsset.decimals, limitPrice);

      // The wallet must have the token that will actually be paid. The amount
      // input is the From token on both Buy and Sell.
      if (BigInt(fromBalance || '0') < BigInt(paymentAmount)) {
        throw new Error('Insufficient ' + from.symbol + ' balance for this limit order.');
      }

      const { buildLimitOrder, submitLimitOrder } = await loadLimitOrderEngine();
      const built = await buildLimitOrder({
        maker: wallet,
        makerAsset,
        takerAsset,
        makingAmount,
        takingAmount,
        expirationSeconds: limitExpiry,
      });

      setStatus('Arming 0x limit monitor');
      const local = {
        orderHash: built.orderHash,
        order: built.orderData,
        chainId: makerAsset.chainId,
        makerAsset: makerAsset.address,
        takerAsset: takerAsset.address,
        makerSymbol: makerAsset.symbol,
        takerSymbol: takerAsset.symbol,
        makingAmount,
        takingAmount,
        paymentAmount,
        receiveAmount: makingAmount,
        limitPrice,
        side: limitSide,
        createdAt: Date.now(),
        status: 'Open',
      };
      const submitted = await submitLimitOrder({
        chainId: makerAsset.chainId,
        orderHash: built.orderHash,
        data: built.orderData,
        record: local,
      });

      setLimitOrders(current => [local, ...current.filter(item => item.orderHash !== local.orderHash)].slice(0, 50));
      try {
        const stored = JSON.parse(window.localStorage.getItem('sire.limit.orders.v1') || '[]');
        window.localStorage.setItem('sire.limit.orders.v1', JSON.stringify([local, ...(Array.isArray(stored) ? stored.filter((item:any) => item.orderHash !== local.orderHash) : [])].slice(0, 50)));
      } catch {}

      setStatus(submitted?.orderHash ? 'Limit order armed · ' + shortAddress(submitted.orderHash) : 'Limit order armed');
      setLimitPrice('');
      setAmount('1');
      await refreshLimitOrders().catch(() => {});
    } catch (error) {
      setLimitError(error instanceof Error ? error.message : String(error));
      setStatus('');
    } finally {
      setLimitBusy(false);
    }
  };

  const cancelLimit = async (order: any) => {
    if (!wallet || !nativeUnlocked) {
      setLimitError('Unlock SIRE Wallet before cancelling a limit order.');
      return;
    }
    setLimitBusy(true);
    setLimitError('');
    try {
      setStatus('Canceling limit order');
      const hash = order.orderHash;
      const { cancelLimitOrder } = await loadLimitOrderEngine();
      await cancelLimitOrder(hash, wallet);
      setStatus('Limit order canceled');
      setLimitOrders(current => current.filter(item => item.orderHash !== order.orderHash));
      return hash;
    } catch (error) {
      setLimitError(error instanceof Error ? error.message : String(error));
    } finally {
      setLimitBusy(false);
    }
  };

  const recordSwap = (hash: string, executedQuote: SwapQuote) => {
    const item = { hash, from: executedQuote.fromToken.symbol, to: executedQuote.toToken.symbol, amount, output: formatUnits(executedQuote.toAmount, executedQuote.toToken.decimals, 8), fromNetwork: network, toNetwork, time: Date.now(), recipient: effectiveRecipient };
    setSwapHistory(current => {
      const next = [item, ...current.filter(entry => entry.hash !== hash)].slice(0, 20);
      try { window.localStorage.setItem('sire.swap.history.v1', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const simulate = async () => {
    if (!quote || !wallet || !nativeUnlocked) return;
    setSimulationBusy(true);
    setSimulationResult('');
    setExecutionError('');
    try {
      const freshQuote = await getSwapQuote({ fromToken: from, toToken: to, amount, wallet, toAddress: effectiveRecipient, slippage, order: routeOrder });
      setQuote(freshQuote);
      const result = await simulateSwap(freshQuote, wallet);
      const gas = result.gasEstimate ? formatUnits(result.gasEstimate, 0, 0) : '—';
      setSimulationResult('No-money test passed · gas estimate ' + gas + ' · nothing was signed or sent.');
    } catch (error) {
      setSimulationResult('');
      setExecutionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSimulationBusy(false);
    }
  };

  const execute = async () => {
    if (!quote || !wallet || !nativeUnlocked) return;
    // Funding is checked only at Confirm Swap, after the quote has been shown.
    try {
      const requestedAmount = BigInt(amountToBaseUnits(amount, from));
      const availableBalance = BigInt(fromBalance || '0');
      if (availableBalance < requestedAmount) {
        setInsufficientBalanceAmount(formatUnits(fromBalance || '0', from.decimals, 6));
        setInsufficientBalanceOpen(true);
        return;
      }
    } catch {}

    setBusy(true);
    setExecutionError('');
    setTxHash('');
    try {
      // Keep the exact provider route the user selected. Refresh only if its
      // executable transaction is missing or the quote has expired.
      let executableQuote = quote;
      if (!executableQuote.transactionRequest?.to || (executableQuote.expiresAt && Date.now() >= executableQuote.expiresAt)) {
        setStatus('Refreshing executable quote');
        executableQuote = await getSwapQuote({ fromToken: from, toToken: to, amount, wallet, toAddress: effectiveRecipient, slippage, order: routeOrder });
        setQuote(executableQuote);
      }
      if (!executableQuote.transactionRequest?.to) throw new Error('The provider returned a non-executable quote.');
      if (executableQuote.expiresAt && Date.now() >= executableQuote.expiresAt) throw new Error('This quote expired before execution. Please request a new quote.');
      const result = await executeSwap(executableQuote, wallet, setStatus);
      setTxHash(result.hash);
      recordSwap(result.hash, executableQuote);
      if (isCrossChain) {
        setStatus('Cross-chain source transaction confirmed · destination processing');
        const started = Date.now();
        const poll = async (): Promise<void> => {
          if (Date.now() - started > 10 * 60 * 1000) {
            setStatus('Source confirmed · destination still processing');
            return;
          }
          try {
            const state = await fetchSwapStatus({
              txHash: result.hash,
              fromChain: executableQuote.fromToken.chainId,
              toChain: executableQuote.toToken.chainId,
              bridge: executableQuote.raw?.tool || executableQuote.tool,
            });
            const normalized = String(state.status || '').toUpperCase();
            const sub = String(state.substatus || '').toUpperCase();
            if (normalized === 'DONE') {
              if (sub === 'REFUNDED') setStatus('Cross-chain swap refunded');
              else if (sub === 'PARTIAL') setStatus('Cross-chain swap partially completed');
              else setStatus('Cross-chain swap completed');
              return;
            }
            if (normalized === 'FAILED') {
              setStatus('Cross-chain swap failed');
              setExecutionError(state.substatusMessage || state.error || 'The destination transfer failed.');
              return;
            }
            setStatus('Cross-chain transfer processing');
          } catch {}
          window.setTimeout(() => { void poll(); }, 5000);
        };
        void poll();
      } else {
        setStatus('Swap confirmed');
      }
      void readTokenBalance(from, wallet).then(setFromBalance).catch(() => {});
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
          {supportedNetworks.map(item => (
            <button key={item.name} type="button" className={item.name === network ? 'active' : ''} onClick={() => void selectNetwork(item.name)}>
              <LogoMark src={item.logoURI} fallback={item.name.slice(0, 1)} className="sire-network-icon" /><span>{item.name}</span>{item.name === network && <i>✓</i>}
            </button>
          ))}
        </div>
        <div className="sire-swap-rail-divider" />
        <div className="sire-swap-rail-label">POPULAR TOKENS</div>
        {tokens.filter(token => tokenIdentity(token) !== tokenIdentity(from)).slice(0, 6).map(token => (
          <button key={tokenIdentity(token)} className="sire-popular-token" type="button" onClick={() => setTo(token)}>
            <LogoMark src={token.logoURI} fallback={token.symbol.slice(0, 1)} className="sire-token-mark" />
            <span><b>{token.symbol}</b><small>{token.name}</small></span>
          </button>
        ))}
      </aside>

      <main className="sire-swap-main">
        <div className="sire-swap-grid">
          <section className={"sire-swap-card sire-swap-form-card" + (tradeMode === "Limit" ? " sire-limit-mode" : "")}>
            <div className="sire-swap-token-box">
              <div className="sire-swap-token-label"><span>From</span><span>Balance {wallet ? balanceDisplay + ' ' + from.symbol : '—'}</span></div>
              <div className="sire-swap-token-row">
                <button type="button" className="sire-token-select" onClick={() => setTokenPicker('from')}>
                  <LogoMark src={from.logoURI} fallback={from.symbol.slice(0,1)} className="sire-token-mark large" />
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
                  <LogoMark src={to.logoURI} fallback={to.symbol.slice(0,1)} className="sire-token-mark large" />
                  <span><b>{to.symbol}</b><small>{to.name}</small></span><ChevronDown size={15}/>
                </button>
                <div className="sire-output-value">{quoteLoading ? <LoaderCircle className="sire-spin" size={21}/> : output || '—'}</div>
              </div>
              <small className="sire-usd-reference">
                {quote ? (isCrossChain ? 'Route: ' + (quote.toolName || quote.tool || 'aggregator') + ' · ' + network + ' → ' + toNetwork : 'Route: ' + (quote.toolName || quote.tool || 'aggregator')) : 'Waiting for an executable provider quote'}
              </small>
            </div>

            {tradeMode === 'Limit' && <div className="sire-limit-panel sire-limit-interface">
              <div className="sire-limit-top-row">
                <button
                  type="button"
                  className="sire-limit-token-pill"
                  aria-label={(limitSide === 'Buy' ? 'Buy ' : 'Sell ') + (limitMaker.symbol || 'token')}
                  onClick={() => setTokenPicker(limitSide === 'Sell' ? 'from' : 'to')}
                >
                  <LogoMark src={limitMaker.logoURI} fallback={limitMaker.symbol.slice(0,1) || 'T'} className="sire-token-mark large" />
                  <span><b>{limitMaker.symbol || 'Select token'}</b><small>{limitMaker.name || ''}</small></span>
                  <ChevronDown size={15}/>
                </button>
                <div className="sire-limit-live-price" aria-live="polite">
                  <span>Price</span>
                  <strong>{limitMarketPrice || '—'}</strong>
                  <small>{limitTaker.symbol || ''} per {limitMaker.symbol || ''}</small>
                </div>
              </div>

              <div className="sire-limit-side-toggle" role="tablist" aria-label="Limit side">
                {(['Buy','Sell'] as const).map(side => (
                  <button
                    key={side}
                    type="button"
                    role="tab"
                    aria-selected={limitSide === side}
                    className={limitSide === side ? 'active ' + side.toLowerCase() : ''}
                    onClick={() => { setLimitSide(side); setLimitPrice(''); setLimitPricePreset('Market'); setLimitError(''); setAmount('1'); }}
                  >
                    {side}
                  </button>
                ))}
              </div>

              <div className={'sire-limit-price-card sire-limit-price-main ' + (limitSide === 'Buy' ? 'buy' : 'sell')}>
                <div className="sire-limit-price-message">
                  {limitSide === 'Buy' ? 'Buy ' : 'Sell '}
                  <LogoMark src={limitMaker.logoURI} fallback={limitMaker.symbol.slice(0,1) || 'T'} className="sire-limit-inline-logo" />
                  <b>{limitMaker.symbol || 'token'}</b>
                  {limitSide === 'Buy' ? ' when price is below ' : ' when price is above '}
                  <strong>{limitPricePreset}</strong>
                </div>
                <button
                  type="button"
                  className="sire-limit-target-price"
                  aria-label="Enter limit price"
                  onClick={() => {
                    setLimitKeypadDraft(limitPrice || limitMarketPrice || '');
                    setLimitKeypad('price');
                    setLimitPricePreset('Custom');
                  }}
                >
                  <span>{limitPrice || (limitMarketPrice || '—')}</span>
                  <small>{limitTaker.symbol}</small>
                </button>
              </div>
              <div className={'sire-limit-price-options sire-limit-price-options-' + limitSide.toLowerCase()}>
                {['Market','-1%','+5%','+10%','Custom'].map(option => (
                  <button
                    key={option}
                    type="button"
                    className={limitPricePreset === option ? 'selected' : ''}
                    onClick={() => {
                      if (!limitMarketPrice) return;
                      const base = Number(limitMarketPrice);
                      if (option === 'Market') {
                        setLimitPrice(String(base));
                        setLimitPricePreset('Market');
                      } else if (option === 'Custom') {
                        setLimitKeypadDraft(limitPrice || String(base));
                        setLimitKeypad('price');
                        setLimitPricePreset('Custom');
                      } else {
                        const pct = Number(option.replace('%',''));
                        const effective = limitSide === 'Buy' ? -Math.abs(pct) : Math.abs(pct);
                        setLimitPrice(String(base * (1 + effective / 100)));
                        setLimitPricePreset(option);
                      }
                      setLimitError('');
                    }}
                  >{option}</button>
                ))}
              </div>

              <div className={'sire-limit-token-card sire-limit-payment-card ' + (limitSide === 'Buy' ? 'buy' : 'sell')}>
                <div className="sire-limit-payment-expiry">
                  <span>Expiry</span>
                  <button type="button" className="sire-limit-expiry-pill" onClick={() => setLimitExpiryOpen(true)}>
                    {limitExpiryCustom ? new Date(limitExpiryCustom).toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) : limitExpiry === 3600 ? '1 hour' : limitExpiry === 86400 ? '24 hours' : limitExpiry === 604800 ? '7 days' : '30 days'}
                    <ChevronDown size={13}/>
                  </button>
                </div>
                <button
                  type="button"
                  className="sire-limit-token-pill sire-limit-payment-pill"
                  aria-label={'Payment ' + (from.symbol || 'token')}
                  onClick={() => setTokenPicker('from')}
                >
                  <LogoMark src={from.logoURI} fallback={from.symbol.slice(0,1) || 'T'} className="sire-token-mark large" />
                  <span><b>{from.symbol || 'Select token'}</b><small>{from.name || ''}</small></span>
                  <ChevronDown size={15}/>
                </button>
              
                <button
                  type="button"
                  className="sire-limit-payment-summary"
                  aria-label="Enter payment amount"
                  onClick={() => { setLimitKeypadDraft(amount || ''); setLimitKeypad('amount'); }}
                >
                  <strong><span>{amount || '0'}</span><em>{from.symbol || ''}</em></strong>
                  <small>{from.priceUSD && Number.isFinite(Number(amount)) ? '$' + money(Number(amount) * from.priceUSD, 2) : '—'}</small>
                  <div><span>Receive</span><b>{limitTargetAmount ? limitTargetAmount : '—'}</b><em>{limitReceiveToken.symbol || ''}</em></div>
                </button>
              </div>

              <div className="sire-limit-price-options sire-limit-payment-percentages" aria-label="Payment amount percentage">
                {[25, 50, 75, 100].map(percent => (
                  <button
                    key={percent}
                    type="button"
                    onClick={() => setAmount(String((Number(formatUnits(fromBalance, from.decimals, 18)) * percent) / 100))}
                  >{percent}%</button>
                ))}
              </div>

              <button type="button" className={'sire-review-button sire-limit-submit ' + (limitSide === 'Buy' ? 'buy' : 'sell')} disabled={limitBusy || !wallet || !nativeUnlocked || !limitPrice || !amount} onClick={() => void placeLimitOrder()}>
                {limitBusy ? <><LoaderCircle className="sire-spin" size={15}/> {status || 'Placing order'}</> : (wallet ? (limitSide === 'Buy' ? 'Buy ' + limitMaker.symbol : 'Sell ' + limitMaker.symbol) : 'Unlock SIRE Wallet')}
              </button>

              <small className="sire-limit-note">Your limit order is monitored through 0x Swap API v2. Your tokens remain in SIRE Wallet until the target is reached and you review the live quote.</small>
              {limitError && <div className="sire-swap-error"><CircleAlert size={14}/><span>{limitError}</span></div>}

              <div className="sire-limit-orders">
                <div className="sire-limit-orders-head"><b>Open orders</b><button type="button" onClick={() => void refreshLimitOrders()}>Refresh</button></div>
                {limitOrders.length > 0 ? limitOrders.slice(0, 8).map((order:any) => (
                  <div className="sire-limit-order-row" key={order.orderHash}>
                    <div>
                      <b>{order.side === 'Buy' ? 'Buy' : 'Sell'} {order.makerSymbol || 'Token'}</b>
                      <small>{order.limitPrice || 'Limit'} {order.takerSymbol ? order.takerSymbol : ''} · {order.orderStatus === 1 || order.status === 'Open' ? 'Open' : String(order.orderStatus || order.status || 'Pending')}</small>
                    </div>
                    <button type="button" disabled={limitBusy} onClick={() => void cancelLimit(order)}>Cancel</button>
                  </div>
                )) : <div className="sire-limit-empty">No open limit orders.</div>}
              </div>
            </div>}

            <div className="sire-swap-route">
              <button type="button" onClick={() => setProviderOpen(true)} disabled={!providerQuotes.length}>
                <span>Providers</span>
                <small>{providerQuotes.length ? providerQuotes.length + ' live route' + (providerQuotes.length === 1 ? '' : 's') + ' · Compare' : 'Waiting for live routes'}</small>
              </button>
              {quote && <div className="sire-route-metrics">
                <span><b>{quote.toolName || quote.tool || 'Router'}</b><small>Selected provider</small></span>
                <span><b>{quote.executionDuration ? '~' + Math.max(1, Math.round(quote.executionDuration)) + 's' : '—'}</b><small>Estimated time</small></span>
                <span><b>{quote.gasUSD ? '$' + Number(quote.gasUSD).toFixed(2) : '—'}</b><small>Network fee</small></span>
              </div>}
            </div>

            {tradeMode === 'Swap' && <div className="sire-swap-confirm-wrap">
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
            </div>}
 
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
               <div><span>{isCrossChain ? 'Destination' : 'Recipient'}</span><b>{recipient ? shortAddress(recipient) : 'You'}</b></div>
               {quote && <div><span>Quote refresh</span><b>{quoteSeconds > 0 ? quoteSeconds + 's' : 'Refresh required'}</b></div>}
             </div>

             <div className="sire-swap-recipient">
               <button type="button" className={recipientOpen ? 'active' : ''} onClick={() => setRecipientOpen(value => !value)}>
                 <span>Send to</span><b>{recipient ? shortAddress(recipient) : 'My wallet'}</b>
               </button>
               {recipientOpen && <div className="sire-recipient-editor">
                 <input value={recipient} onChange={e => { setRecipient(e.target.value.trim()); setRecipientError(''); }} placeholder="0x… destination address" spellCheck={false} />
                 <button type="button" onClick={() => { setRecipient(''); setRecipientError(''); }}>Use my wallet</button>
                 {recipient && !recipientValid && <small>Enter a valid EVM destination address.</small>}
               </div>}
             </div>


            {quote && wallet && nativeUnlocked && !busy && !simulationBusy && <button type="button" className="sire-wallet-secondary sire-test-swap-button" onClick={() => void simulate()}>
              Run no-money test
            </button>}
            {(quoteError || executionError) && <div className="sire-swap-error"><CircleAlert size={14}/><span>{quoteError || executionError}</span></div>}
            {simulationResult && <div className="sire-swap-status sire-swap-simulation-result"><span>{simulationResult}</span></div>}
            {status && !executionError && <div className="sire-swap-status">{status}{txHash && <a href={(network === 'BNB Chain' ? 'https://bscscan.com/tx/' : network === 'Base' ? 'https://basescan.org/tx/' : network === 'Arbitrum' ? 'https://arbiscan.io/tx/' : network === 'Optimism' ? 'https://optimistic.etherscan.io/tx/' : network === 'Polygon' ? 'https://polygonscan.com/tx/' : network === 'Avalanche' ? 'https://snowtrace.io/tx/' : 'https://etherscan.io/tx/') + txHash} target="_blank" rel="noreferrer">View transaction</a>}</div>}

            <div className="sire-swap-safety"><LockKeyhole size={13}/> Quotes expire quickly and are revalidated before signing.</div>
             <button type="button" className="sire-wallet-secondary sire-history-trigger" onClick={() => setHistoryOpen(true)}>View swap history ({swapHistory.length})</button>
          </section>
        </div>
      </main>
    </div>

    {insufficientBalanceOpen && <div className="sire-modal-backdrop sire-insufficient-backdrop" onMouseDown={() => setInsufficientBalanceOpen(false)}>
      <section className="sire-insufficient-sheet" role="dialog" aria-modal="true" aria-label="Insufficient balance" onMouseDown={e => e.stopPropagation()}>
        <div className="sire-insufficient-icon"><CircleAlert size={22}/></div>
        <div className="sire-insufficient-copy">
          <h3>Insufficient {from.symbol} balance</h3>
          <p>You have <b>{insufficientBalanceAmount} {from.symbol}</b>, but this swap requires <b>{amount} {from.symbol}</b>.</p>
          <p className="sire-insufficient-sub">Your quote is still available to review. Add funds to continue with this swap.</p>
        </div>
        <button type="button" className="sire-review-button sire-buy-balance-button" onClick={() => {
          setInsufficientBalanceOpen(false);
          window.dispatchEvent(new CustomEvent('sire:buy-token', { detail: { symbol: from.symbol, network, token: from } }));
        }}>Buy {from.symbol}</button>
        <button type="button" className="sire-wallet-secondary" onClick={() => setInsufficientBalanceOpen(false)}>Not now</button>
      </section>
    </div>}

    {providerOpen && <div className="sire-modal-backdrop sire-provider-backdrop" onMouseDown={() => setProviderOpen(false)}>
      <section className="sire-provider-sheet" role="dialog" aria-modal="true" aria-label="Swap providers" onMouseDown={e => e.stopPropagation()}>
        <div className="sire-provider-handle" aria-hidden="true"><span /></div>
        <div className="sire-provider-head">
          <div><b>Providers</b><small>Live executable routes · sorted by received amount</small></div>
          <button type="button" onClick={() => setProviderOpen(false)} aria-label="Close providers"><X size={18}/></button>
        </div>
        <div className="sire-provider-list">
          {providerQuotes.map((candidate, index) => {
            const selected = quote === candidate;
            const receive = formatUnits(candidate.toAmount, candidate.toToken.decimals, 8);
            const usd = candidate.toToken.priceUSD ? Number(receive) * Number(candidate.toToken.priceUSD) : 0;
            return (
              <button
                type="button"
                className={'sire-provider-card' + (selected ? ' selected' : '')}
                key={(candidate.toolName || candidate.tool || 'route') + ':' + candidate.toAmount + ':' + (candidate.transactionRequest?.data || '')}
                onClick={() => { setQuote(candidate); setProviderOpen(false); }}
              >
                <div className="sire-provider-card-top">
                  <div className="sire-provider-name">
                    <span className="sire-provider-icon">{(candidate.toolName || candidate.tool || 'R').slice(0,1).toUpperCase()}</span>
                    <span><b>{candidate.toolName || candidate.tool || 'Router'}</b><small>Live executable route</small></span>
                  </div>
                  {index === 0 && <em>Best</em>}
                </div>
                <div className="sire-provider-amount">
                  <b>{receive} {candidate.toToken.symbol}</b>
                  <span>{usd > 0 ? '$' + money(usd, 2) : '—'}</span>
                </div>
                <div className="sire-provider-metrics">
                  <span><b>{candidate.executionDuration ? '~' + Math.max(1, Math.round(candidate.executionDuration)) + 's' : '—'}</b><small>Est. time</small></span>
                  <span><b>{candidate.gasUSD ? '$' + Number(candidate.gasUSD).toFixed(4) : '—'}</b><small>Gas fee</small></span>
                  <span><b>{candidate.priceImpact != null ? (candidate.priceImpact * 100).toFixed(2) + '%' : '—'}</b><small>Price impact</small></span>
                </div>
                <div className="sire-provider-route-line">
                  <span>{candidate.fromToken.symbol} · {network}</span><i>→</i><span>{candidate.toToken.symbol} · {toNetwork}</span>
                  <strong>{selected ? 'Selected' : 'Use route'}</strong>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>}

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
        </div>}

        {walletStep === 'unlock' && <div className="sire-wallet-onboarding-body">
          <div className="sire-wallet-hero-icon"><LockKeyhole size={25}/></div>
          <h3>Unlock SIRE Wallet</h3>
          <p>Your SIRE Wallet already exists on this device. Enter its password to make it available to Swap.</p>
          <div className="sire-wallet-form">
            <label>Wallet password<input type="password" autoFocus autoComplete="current-password" value={walletPassword} onChange={e => setWalletPassword(e.target.value)} placeholder="Enter your password" onKeyDown={e => { if (e.key === 'Enter') void unlockWallet(); }}/></label>
          </div>
          {walletCreationError && <div className="sire-swap-error"><CircleAlert size={14}/><span>{walletCreationError}</span></div>}
          <button type="button" className="sire-review-button" disabled={walletCreating} onClick={() => void unlockWallet()}>{walletCreating ? <><LoaderCircle className="sire-spin" size={15}/> Unlocking…</> : 'Unlock Wallet'}</button>
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
    {historyOpen && <div className="sire-modal-backdrop sire-token-picker-backdrop" onMouseDown={() => setHistoryOpen(false)}>
      <section className="sire-token-modal sire-swap-history-sheet" role="dialog" aria-modal="true" aria-label="Swap history" onMouseDown={e => e.stopPropagation()}>
        <div className="sire-token-modal-head"><div><b>Swap history</b><small>Recent SIRE Swap executions on this device</small></div><button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close history"><X size={17}/></button></div>
        <div className="sire-swap-history-list">
          {swapHistory.length ? swapHistory.map(item => <div className="sire-swap-history-row" key={item.hash}><div><b>{item.amount} {item.from} → {item.output} {item.to}</b><small>{item.fromNetwork}{item.fromNetwork !== item.toNetwork ? ' → ' + item.toNetwork : ''} · {new Date(item.time).toLocaleString()}</small></div><a href={(item.fromNetwork === 'BNB Chain' ? 'https://bscscan.com/tx/' : item.fromNetwork === 'Base' ? 'https://basescan.org/tx/' : item.fromNetwork === 'Arbitrum' ? 'https://arbiscan.io/tx/' : item.fromNetwork === 'Optimism' ? 'https://optimistic.etherscan.io/tx/' : item.fromNetwork === 'Polygon' ? 'https://polygonscan.com/tx/' : item.fromNetwork === 'Avalanche' ? 'https://snowtrace.io/tx/' : 'https://etherscan.io/tx/') + item.hash} target="_blank" rel="noreferrer">View</a></div>) : <div className="sire-swap-history-empty">No swaps yet.</div>}
        </div>
      </section>
    </div>}

    {limitExpiryOpen && <div className="sire-modal-backdrop sire-token-picker-backdrop" onMouseDown={() => setLimitExpiryOpen(false)}>
      <section className="sire-token-modal sire-limit-expiry-sheet" role="dialog" aria-modal="true" aria-label="Order expiration" onMouseDown={e => e.stopPropagation()}>
        <div className="sire-token-modal-head">
          <div><b>Order expiration</b><small>Choose how long this limit order stays active</small></div>
          <button type="button" onClick={() => setLimitExpiryOpen(false)} aria-label="Close expiration"><X size={17}/></button>
        </div>
        <div className="sire-limit-expiry-options">
          {[['1 hour',3600],['24 hours',86400],['7 days',604800],['30 days',2592000]].map(([label,value]) => (
            <button key={String(value)} type="button" className={!limitExpiryCustom && limitExpiry === Number(value) ? 'active' : ''} onClick={() => { setLimitExpiry(Number(value)); setLimitExpiryCustom(''); setLimitExpiryOpen(false); }}>{label}</button>
          ))}
        </div>
        <label className="sire-limit-custom-date">
          <span>Custom date & time</span>
          <input type="datetime-local" value={limitExpiryCustom} min={new Date(Date.now() + 60000).toISOString().slice(0,16)} onChange={e => {
            const value = e.target.value;
            setLimitExpiryCustom(value);
            const timestamp = new Date(value).getTime();
            if (Number.isFinite(timestamp) && timestamp > Date.now()) setLimitExpiry(Math.max(60, Math.ceil((timestamp - Date.now()) / 1000)));
          }} />
        </label>
        <button type="button" className="sire-review-button" onClick={() => setLimitExpiryOpen(false)}>Done</button>
      </section>
    </div>}

    {limitKeypad && <div className="sire-modal-backdrop sire-token-picker-backdrop" onMouseDown={() => setLimitKeypad(null)}>
      <section className="sire-token-modal sire-limit-keypad-sheet" role="dialog" aria-modal="true" aria-label={limitKeypad === 'amount' ? 'Enter payment amount' : 'Enter limit price'} onMouseDown={e => e.stopPropagation()}>
        <div className="sire-token-modal-head">
          <div><b>{limitKeypad === 'amount' ? 'Payment amount' : 'Limit price'}</b><small>Use the SIRE numeric keypad</small></div>
          <button type="button" onClick={() => setLimitKeypad(null)} aria-label="Close keypad"><X size={17}/></button>
        </div>
        <div className="sire-limit-keypad-display">
          <strong>{limitKeypadDraft || '0'}</strong>
          <span>{limitKeypad === 'amount' ? from.symbol : limitTaker.symbol}</span>
        </div>
        <div className="sire-limit-keypad-grid">
          {['1','2','3','4','5','6','7','8','9','.','0','⌫'].map(key => (
            <button key={key} type="button" onClick={() => {
              let next = limitKeypadDraft;
              if (key === '⌫') {
                next = next.slice(0, -1);
              } else if (key === '.' && next.includes('.')) {
                return;
              } else {
                next += key;
              }
              setLimitKeypadDraft(next);
              if (limitKeypad === 'amount') {
                setAmount(next);
              } else {
                setLimitPrice(next);
                setLimitPricePreset('Custom');
              }
              setLimitError('');
            }}>{key}</button>
          ))}
        </div>
      </section>
    </div>}

    {tokenPicker && <div className="sire-modal-backdrop sire-token-picker-backdrop" onMouseDown={() => setTokenPicker(null)}>
      <section className="sire-token-modal sire-token-picker-sheet" role="dialog" aria-modal="true" aria-label="Select token" onMouseDown={e => e.stopPropagation()}>
        <div className="sire-token-sheet-handle" aria-hidden="true"><span /></div>
        <div className="sire-token-modal-head">
          <div><b>Select token</b><small>{pickerNetwork} · live token catalogue</small></div>
          <button type="button" onClick={() => setTokenPicker(null)} aria-label="Close token selector"><X size={17}/></button>
        </div>
        <div className="sire-token-search"><Search size={15}/><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search symbol, name or address"/></div>
        <div className="sire-token-network-strip" aria-label="Networks">
          {supportedNetworks.map(item => (
            <button key={item.name} type="button" className={item.name === pickerNetwork ? 'active' : ''} onClick={() => void selectNetwork(item.name, tokenPicker === 'to' ? 'to' : 'from')}>
              <LogoMark src={item.logoURI} fallback={item.name.slice(0, 1)} className="sire-token-network-icon" />
              <span>{item.name}</span>
            </button>
          ))}
        </div>
        <div className="sire-token-list" aria-label="Instruments">
          {filteredTokens.map(token => (
            <button key={token.address} type="button" onClick={() => chooseToken(token)}>
              <span className="sire-token-list-logo">
                <LogoMark src={token.logoURI} fallback={token.symbol.slice(0,1)} className="sire-token-mark" />
                <LogoMark
                  src={supportedNetworks.find(item => item.chainId === token.chainId)?.logoURI}
                  fallback={supportedNetworks.find(item => item.chainId === token.chainId)?.name.slice(0,1) || network.slice(0,1)}
                  className="sire-token-chain-badge"
                />
              </span>
              <span><b>{token.symbol}</b><small>{token.name}</small></span>
              <span className="sire-token-address">{token.address.slice(0,6) + '…' + token.address.slice(-4)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>}


  </div>;
}
