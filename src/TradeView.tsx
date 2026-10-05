import { useMemo, useState } from 'react';
import { ArrowDownUp, ChevronDown, LockKeyhole, Search, X } from 'lucide-react';
import './tradeSwap.css';

type Token = { symbol: string; name: string; network: string; balance?: number; price?: number };
type Props = { referencePrice?: number; referenceChange?: number };

const NETWORKS = ['Ethereum', 'BNB Chain', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche', 'TRON'];
const TOKENS: Token[] = [
  { symbol: 'ETH', name: 'Ethereum', network: 'Ethereum', balance: 0 },
  { symbol: 'USDT', name: 'Tether', network: 'Ethereum', balance: 0, price: 1 },
  { symbol: 'USDC', name: 'USD Coin', network: 'Ethereum', balance: 0, price: 1 },
  { symbol: 'BTC', name: 'Bitcoin', network: 'Ethereum', balance: 0 },
  { symbol: 'SOL', name: 'Solana', network: 'Solana', balance: 0 },
  { symbol: 'BNB', name: 'BNB', network: 'BNB Chain', balance: 0 },
];
const PRODUCTS = ['Swap', 'Spot', 'Margin', 'Futures', 'Options', 'Alpha', 'Tokenized', 'TradFi'];

const money = (value: number, digits = 2) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';

export default function TradeView({ referencePrice = 0, referenceChange = 0 }: Props) {
  const [network, setNetwork] = useState('Ethereum');
  const [from, setFrom] = useState<Token>(TOKENS[0]);
  const [to, setTo] = useState<Token>(TOKENS[1]);
  const [amount, setAmount] = useState('1');
  const [tradeMode, setTradeMode] = useState<'Swap' | 'Limit'>('Swap');
  const [tokenPicker, setTokenPicker] = useState<'from' | 'to' | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [search, setSearch] = useState('');

  const ethReference = referencePrice > 0 ? referencePrice : 0;
  const output = from.symbol === 'ETH' && to.symbol === 'USDT' && ethReference > 0 ? Number(amount || 0) * ethReference : 0;
  const indicative = output > 0;
  const filteredTokens = useMemo(
    () => TOKENS.filter(token => token.network === network && token.symbol.toLowerCase().includes(search.trim().toLowerCase())),
    [network, search],
  );

  const chooseToken = (token: Token) => {
    if (tokenPicker === 'from') setFrom(token);
    if (tokenPicker === 'to') setTo(token);
    setTokenPicker(null);
    setSearch('');
  };

  return <div className="sire-swap-shell">
    <header className="sire-trade-productbar">
      <div className="sire-trade-product-scroll">
        {PRODUCTS.map(product => <button key={product} type="button" className={product === 'Swap' ? 'active' : ''} disabled={product !== 'Swap'}>{product}</button>)}
      </div>
      <div className="sire-trade-status"><span className="sire-status-dot" /> Aggregated execution layer</div>
    </header>

    <div className="sire-trade-mode-row" role="tablist" aria-label="Trade mode">
      <div className="sire-trade-mode-pills">
        {(['Swap', 'Limit'] as const).map(mode => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={tradeMode === mode}
            className={tradeMode === mode ? 'active' : ''}
            onClick={() => setTradeMode(mode)}
          >
            {mode}
          </button>
        ))}
      </div>
    </div>

    <div className="sire-swap-workspace">
      <aside className="sire-swap-rail">
        <div className="sire-swap-rail-head"><span>NETWORK</span><strong>Choose chain</strong></div>
        <div className="sire-swap-network-list">
          {NETWORKS.map(item => <button key={item} type="button" className={item === network ? 'active' : ''} onClick={() => setNetwork(item)}>
            <span className="sire-network-icon">{item.slice(0, 1)}</span><span>{item}</span>{item === network && <i>✓</i>}
          </button>)}
        </div>
        <div className="sire-swap-rail-divider" />
        <div className="sire-swap-rail-label">POPULAR TOKENS</div>
        {TOKENS.slice(1, 6).map(token => <button key={token.symbol} className="sire-popular-token" type="button" onClick={() => setTo(token)}>
          <span className="sire-token-mark">{token.symbol.slice(0, 1)}</span><span><b>{token.symbol}</b><small>{token.name}</small></span>
        </button>)}
      </aside>

      <main className="sire-swap-main">

        <div className="sire-swap-grid">
          <section className="sire-swap-card sire-swap-form-card">
            <div className="sire-swap-token-box">
              <div className="sire-swap-token-label"><span>From</span><span>Balance —</span></div>
              <div className="sire-swap-token-row">
                <button type="button" className="sire-token-select" onClick={() => setTokenPicker('from')}><span className="sire-token-mark large">{from.symbol.slice(0,1)}</span><span><b>{from.symbol}</b><small>{from.name}</small></span><ChevronDown size={15}/></button>
                <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00"/>
                <button type="button" className="sire-max" onClick={() => setAmount(String(from.balance || 0))}>MAX</button>
              </div>
              <small className="sire-usd-reference">{from.symbol === 'ETH' && ethReference > 0 ? `≈ $${money(Number(amount || 0) * ethReference, 2)}` : 'Indicative value unavailable'}</small>
            </div>

            <button className="sire-swap-flip" type="button" aria-label="Reverse swap" onClick={() => { setFrom(to); setTo(from); }}><ArrowDownUp size={17}/></button>

            <div className="sire-swap-token-box">
              <div className="sire-swap-token-label"><span>To</span><span>Minimum received</span></div>
              <div className="sire-swap-token-row">
                <button type="button" className="sire-token-select" onClick={() => setTokenPicker('to')}><span className="sire-token-mark large">{to.symbol.slice(0,1)}</span><span><b>{to.symbol}</b><small>{to.name}</small></span><ChevronDown size={15}/></button>
                <div className="sire-output-value">{indicative ? money(output, 2) : '—'}</div>
              </div>
              <small className="sire-usd-reference">{indicative ? `≈ $${money(output, 2)}` : 'Waiting for an executable provider quote'}</small>
            </div>

            <div className="sire-swap-safety"><LockKeyhole size={13}/> Quotes expire quickly and are revalidated before signing.</div>
          </section>


        </div>
      </main>
    </div>


    {tokenPicker && <div className="sire-modal-backdrop" onMouseDown={() => setTokenPicker(null)}><section className="sire-token-modal" onMouseDown={e => e.stopPropagation()}><div className="sire-token-modal-head"><div><b>Select token</b><small>{network}</small></div><button type="button" onClick={() => setTokenPicker(null)}><X size={17}/></button></div><div className="sire-token-search"><Search size={15}/><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search token"/></div><div className="sire-token-list">{filteredTokens.map(token => <button key={token.symbol} type="button" onClick={() => chooseToken(token)}><span className="sire-token-mark">{token.symbol.slice(0,1)}</span><span><b>{token.symbol}</b><small>{token.name}</small></span><ChevronDown size={14} className="sire-token-arrow"/></button>)}</div></section></div>}

    {reviewOpen && <div className="sire-modal-backdrop" onMouseDown={() => setReviewOpen(false)}><section className="sire-review-modal" onMouseDown={e => e.stopPropagation()}><div className="sire-token-modal-head"><div><b>Review swap</b><small>Final quote check</small></div><button type="button" onClick={() => setReviewOpen(false)}><X size={17}/></button></div><div className="sire-review-pair"><span>{amount || '0'} {from.symbol}</span><ArrowDownUp size={18}/><span>{indicative ? money(output,2) : '—'} {to.symbol}</span></div><div className="sire-review-list"><div><span>Network</span><b>{network}</b></div><div><span>Slippage</span><b>{slippage === 'Custom' ? `${customSlippage}%` : slippage}</b></div><div><span>Route</span><b>SIRE Smart Route</b></div><div><span>Network fee</span><b>Re-quoted before signing</b></div></div><button className="sire-review-button" type="button" onClick={() => setReviewOpen(false)}>Refresh executable quote</button><div className="sire-swap-safety"><LockKeyhole size={13}/> Nothing is signed until you confirm in your wallet.</div></section></div>}
  </div>;
}
