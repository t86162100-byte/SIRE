import { useEffect, useMemo, useState } from 'react';
import './home.css';
import {
  ArrowRight, Bell, BrainCircuit, ChevronRight, CircleUserRound, Eye, EyeOff, Flame,
  Grid2X2, LineChart, Search, Sparkles, TrendingUp, Wallet, ArrowDownToLine, ArrowUpFromLine, Repeat2,
  BadgePercent, Megaphone, Trophy, CalendarClock, Gift, MoreHorizontal, Star,
} from 'lucide-react';

type HomeInstrument = {
  id: string;
  symbol: string;
  displaySymbol?: string;
  name?: string;
  provider?: string;
  providerLabel?: string;
  category?: string;
  marketType?: string;
  price?: number;
  logoUrl?: string;
};

type Props = {
  instruments: HomeInstrument[];
  onSelectInstrument?: (item: HomeInstrument) => void;
  videoSrc?: string;
};

const fallbackLogo = (label: string) => {
  const text = String(label || '?').slice(0, 2).toUpperCase();
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="46" fill="#111a20"/><text x="48" y="55" text-anchor="middle" font-family="Arial" font-size="28" font-weight="800" fill="#e8fbff">' + text + '</text></svg>'
  );
};

const demoMarkets = [
  { symbol: 'BTC/USDT', price: '$83,572.21', change: '-1.54%', down: true, provider: 'BINANCE' },
  { symbol: 'ETH/USDT', price: '$2,686.32', change: '-0.46%', down: true, provider: 'BYBIT' },
  { symbol: 'SOL/USDT', price: '$142.38', change: '+2.17%', down: false, provider: 'MEXC' },
  { symbol: 'XRP/USDT', price: '$2.45', change: '+0.83%', down: false, provider: 'DERIV' },
];

function money(value?: number) {
  if (!Number.isFinite(value)) return '—';
  return '$' + Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export default function HomeView({ instruments, onSelectInstrument, videoSrc = '/sire-home-hero.mp4' }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [activeEvent, setActiveEvent] = useState(0);
  const [activeMarketFilter, setActiveMarketFilter] = useState('Hot');
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => { try { const saved = window.localStorage.getItem('sire.home.marketFavorites'); return saved ? JSON.parse(saved) : []; } catch { return []; } });

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveEvent(current => (current + 1) % 4);
    }, 6500);
    return () => window.clearInterval(timer);
  }, []);

  const liveMarkets = useMemo(() => {
    const crypto = instruments.filter(item => item.category?.toLowerCase().includes('crypto')).slice(0, 12);
    return crypto.length ? crypto : instruments.slice(0, 12);
  }, [instruments]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return liveMarkets.slice(0, 8);
    return instruments.filter(item => `${item.displaySymbol || item.symbol} ${item.name || ''} ${item.providerLabel || item.provider || ''}`.toLowerCase().includes(q)).slice(0, 12);
  }, [instruments, liveMarkets, query]);

  return (
    <main className="sire-home">
      <header className="sire-home-header">
        <div className="sire-home-brand">
          <img className="sire-home-logo" src="/sire-logo.svg" alt="SIRE" />
        </div>
        <div className="sire-home-header-actions">
          <button type="button" className="sire-home-icon" onClick={() => setSearchOpen(true)} aria-label="Search markets"><Search size={20} /></button>
          <button type="button" className="sire-home-icon" aria-label="Notifications"><Bell size={19} /><i /></button>
          <button type="button" className="sire-home-icon" aria-label="Profile"><CircleUserRound size={21} /></button>
        </div>
      </header>

      <div className="sire-home-liquid" aria-hidden="true">
        <span className="sire-liquid-dark" />
        <span className="sire-liquid-blue blue-a" />
        <span className="sire-liquid-blue blue-b" />
        <span className="sire-liquid-blue blue-c" />
        <span className="sire-liquid-purple purple-a" />
        <span className="sire-liquid-purple purple-b" />
        <span className="sire-liquid-purple purple-c" />
        <span className="sire-liquid-sheen" />
      </div>

      <div className="sire-home-scroll">
        <section className="sire-home-hero">
          <video
            className="sire-home-video"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onCanPlay={event => { event.currentTarget.play().catch(() => {}); }}
          >
            <source src={videoSrc} type="video/mp4" />
            <source src="/sire-home-hero.mp4" type="video/mp4" />
            <source src="/magichour_image_to_video-2026-09-28--1x-1-cmullyqw300zgi0017dnt2dar.mp4" type="video/mp4" />
          </video>
        </section>

        <section className="sire-home-balance" aria-label="Total balance">
          <div className="sire-home-balance-head">
            <div className="sire-home-balance-title">
              <span>TOTAL BALANCE</span>
              <button type="button" className="sire-home-balance-eye" aria-label={balanceVisible ? 'Hide balance' : 'Show balance'} onClick={() => setBalanceVisible(value => !value)}>
                {balanceVisible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
            <button type="button" className="sire-home-balance-wallet"><Wallet size={14} /><span>Wallet</span><ChevronRight size={12} /></button>
          </div>

          <div className="sire-home-balance-main">
            <div className="sire-home-balance-value">{balanceVisible ? '$0.00' : '••••••'} <small>USD</small></div>
            <div className="sire-home-balance-pnl">
              <span>Today's P&amp;L</span>
              <strong className="up">{balanceVisible ? '+$0.00' : '••••'}</strong>
              <b className="up">{balanceVisible ? '0.00%' : '•••'}</b>
            </div>
          </div>

          <div className="sire-home-balance-available">
            <span>Available to trade</span>
            <strong>{balanceVisible ? '$0.00 USD' : '••••••'}</strong>
          </div>

          <div className="sire-home-balance-actions" aria-label="Balance actions">
            <button type="button" aria-label="Deposit"><span className="balance-action-icon"><ArrowDownToLine size={18} /></span><small>Deposit</small></button>
            <button type="button" aria-label="Withdraw"><span className="balance-action-icon"><ArrowUpFromLine size={18} /></span><small>Withdraw</small></button>
            <button type="button" aria-label="Transfer"><span className="balance-action-icon"><Repeat2 size={18} /></span><small>Transfer</small></button>
            <button type="button" aria-label="Rewards"><span className="balance-action-icon">%</span><small>Rewards</small></button>
            <button type="button" aria-label="More"><span className="balance-action-icon">•••</span><small>More</small></button>
          </div>
        </section>

        <section className="sire-home-events-media" aria-label="SIRE events, notices and updates">
          <div className="sire-home-events-media-stage" aria-live="polite">
            <article className={`sire-home-event-media ${activeEvent === 0 ? 'is-active' : ''}`}>
              <div className="sire-home-event-media-art event-art-notice">
                <span className="sire-home-event-media-icon"><Megaphone size={22} /></span>
                <div><b>NOTICE</b><strong>Important SIRE announcements</strong><small>New notices, maintenance updates and platform information.</small></div>
              </div>
            </article>
            <article className={`sire-home-event-media ${activeEvent === 1 ? 'is-active' : ''}`}>
              <div className="sire-home-event-media-art event-art-competition">
                <span className="sire-home-event-media-icon"><Trophy size={22} /></span>
                <div><b>COMPETITION</b><strong>Upcoming trading events</strong><small>Challenges, competitions and community events will appear here.</small></div>
              </div>
            </article>
            <article className={`sire-home-event-media ${activeEvent === 2 ? 'is-active' : ''}`}>
              <div className="sire-home-event-media-art event-art-update">
                <span className="sire-home-event-media-icon"><CalendarClock size={22} /></span>
                <div><b>UPCOMING</b><strong>New platform updates</strong><small>Product launches, market updates and new features.</small></div>
              </div>
            </article>
            <article className={`sire-home-event-media ${activeEvent === 3 ? 'is-active' : ''}`}>
              <div className="sire-home-event-media-art event-art-rewards">
                <span className="sire-home-event-media-icon"><Gift size={22} /></span>
                <div><b>INCENTIVES &amp; REWARDS</b><strong>New opportunities are coming</strong><small>Promotions and reward campaigns can be featured here.</small></div>
              </div>
            </article>
          </div>
          <div className="sire-home-events-dots" role="tablist" aria-label="Event slides">
            {[0, 1, 2, 3].map(index => (
              <button
                key={index}
                type="button"
                role="tab"
                aria-selected={activeEvent === index}
                aria-label={`Show event ${index + 1} of 4`}
                className={activeEvent === index ? 'is-active' : ''}
                onClick={() => setActiveEvent(index)}
              />
            ))}
          </div>
        </section>

        <section className="sire-home-section sire-home-markets">
          <div className="sire-home-section-head">
            <div><span>MARKET DISCOVERY</span><h2>Markets</h2></div>
            <button type="button">See All <ChevronRight size={15} /></button>
          </div>
          <div className="sire-home-market-tabs" role="tablist" aria-label="Market filters">
            {['Favorite', 'Hot', 'Spot', 'Futures', 'New', 'Gainers', 'Losers', 'Vol', 'Market Cap'].map(filter => (
              <button key={filter} type="button" role="tab" aria-selected={activeMarketFilter === filter} className={activeMarketFilter === filter ? 'active' : ''} onClick={() => setActiveMarketFilter(filter)}>
                {filter}
              </button>
            ))}
          </div>
          <div className="sire-home-watchlist" aria-label={activeMarketFilter + ' markets'}>
            {(liveMarkets.length ? liveMarkets.slice(0, 12) : []).map(item => {
              const raw = item as any;
              const change = Number(raw.change24h ?? raw.changePercent24h ?? raw.priceChangePercent ?? raw.percentChange24h ?? raw.changePercent);
              const volume = Number(raw.volume24h ?? raw.quoteVolume ?? raw.volume);
              const listedAt = Number(raw.listedAt ?? raw.dateListed ?? raw.createdAt);
              const marketType = String(item.marketType || '').toLowerCase();
              const isFavorite = favoriteIds.includes(item.id);
              const showItem = activeMarketFilter === 'Favorite' ? isFavorite :
                activeMarketFilter === 'Spot' ? marketType.includes('spot') || marketType.includes('margin') :
                activeMarketFilter === 'Futures' ? marketType.includes('future') || marketType.includes('perpetual') :
                activeMarketFilter === 'New' ? (Number.isFinite(listedAt) ? Date.now() - listedAt < 30 * 86400000 : true) : true;
              if (!showItem) return null;
              const displayBase = String(raw.base || item.displaySymbol || item.symbol).replace(/\/USDT$|\/USD$|USDT$|USD$/i, '').toUpperCase();
              return (
                <article key={item.id} className="sire-home-watch-row">
                  <button type="button" className={isFavorite ? 'market-favorite is-active' : 'market-favorite'} aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => {
                    setFavoriteIds(current => {
                      const next = current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id];
                      try { window.localStorage.setItem('sire.home.marketFavorites', JSON.stringify(next)); } catch {}
                      return next;
                    });
                  }}><Star size={14} fill={isFavorite ? 'currentColor' : 'none'} /></button>
                  <button type="button" className="sire-home-watch-main" onClick={() => onSelectInstrument?.(item)}>
                    <span className="market-asset-logo">
                      <img src={item.logoUrl || fallbackLogo(displayBase)} alt="" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = fallbackLogo(displayBase); }} />
                      <i>{String(item.providerLabel || item.provider || 'MARKET').slice(0, 1).toUpperCase()}</i>
                    </span>
                    <span className="market-asset-name">
                      <b>{displayBase}</b>
                      <small>{String(item.name || item.displaySymbol || item.symbol).replace(/_/g, ' ')} · {String(item.providerLabel || item.provider || 'MARKET')}</small>
                    </span>
                    <span className="market-asset-price">
                      <strong>{money(item.price)}</strong>
                      <small>{Number.isFinite(change) ? ((change >= 0 ? '+' : '') + change.toFixed(2) + '%') : '24h —'}</small>
                    </span>
                    <span className={Number.isFinite(change) ? (change >= 0 ? 'market-change up' : 'market-change down') : 'market-change'}>
                      {Number.isFinite(change) ? ((change >= 0 ? '+' : '') + change.toFixed(2) + '%') : '—'}
                    </span>
                    <span className="market-asset-volume"><small>24H VOL</small><b>{Number.isFinite(volume) ? money(volume) : '—'}</b></span>
                  </button>
                  <button type="button" className="market-trade-button" onClick={() => onSelectInstrument?.(item)}>Trade</button>
                </article>
              );
            })}
          </div>
        </section>

        <section className="sire-home-section sire-home-pulse">
          <div className="sire-home-section-head"><div><span>LIVE MARKET</span><h2>Market Pulse</h2></div><button type="button">See All <ChevronRight size={15} /></button></div>
          <div className="sire-home-market-row">
            {demoMarkets.map(market => (
              <article key={market.symbol} className="sire-home-market-card">
                <div className="sire-home-market-top"><b>{market.symbol}</b><small>{market.provider}</small></div>
                <strong>{market.price}</strong>
                <span className={market.down ? 'down' : 'up'}>{market.change}</span>
                <div className={market.down ? 'sire-home-spark down' : 'sire-home-spark'}><i /><i /><i /><i /><i /></div>
              </article>
            ))}
          </div>
        </section>



        <section className="sire-home-intelligence">
          <div className="sire-home-intel-top">
            <div className="sire-home-intel-icon"><BrainCircuit size={22} /></div>
            <div><span>SIRE INTELLIGENCE</span><strong>Market conditions detected</strong></div>
            <button type="button">Analyze <ArrowRight size={15} /></button>
          </div>
          <div className="sire-home-intel-stats">
            <div><small>Trend</small><b className="up">↗ Bullish</b></div>
            <div><small>Momentum</small><b className="up">↗ Strong</b></div>
            <div><small>Volatility</small><b>〰 Medium</b></div>
            <div><small>Structure</small><b className="up">↗ Higher Highs</b></div>
          </div>
          <div className="sire-home-intel-note"><Sparkles size={17} /><p><strong>SIRE AI</strong> BTC is showing increasing momentum while volatility remains elevated.</p></div>
        </section>



        <section className="sire-home-section">
          <div className="sire-home-section-head"><div><span>ACTION</span><h2>Quick Trade</h2></div><button type="button">See All <ChevronRight size={15} /></button></div>
          <div className="sire-home-actions-grid">
            <button><TrendingUp size={20} /><b>Spot</b><small>Buy & sell</small></button>
            <button><LineChart size={20} /><b>Futures</b><small>Perpetuals</small></button>
            <button><Wallet size={20} /><b>Derivatives</b><small>Advanced markets</small></button>
            <button><Grid2X2 size={20} /><b>Onchain</b><small>DEX markets</small></button>
          </div>
        </section>

        <section className="sire-home-copy-card">
          <div><span>COPY TRADING</span><h2>Follow strategies.<br />Trade with confidence.</h2><p>Discover traders, compare performance and follow strategies from one place.</p><button>Explore Copy Trading <ArrowRight size={15} /></button></div>
          <div className="sire-home-copy-orbit"><div /><div /><div /></div>
        </section>

        <section className="sire-home-ai-card">
          <div className="sire-home-ai-icon"><Sparkles size={22} /></div>
          <div><span>ASK SIRE AI</span><h2>What do you want to know?</h2><div className="sire-home-prompts"><button>What's moving?</button><button>Find opportunities</button><button>Analyze BTC</button><button>Compare markets</button></div></div>
          <button className="sire-home-ai-cta">Ask SIRE <ArrowRight size={16} /></button>
        </section>

        <section className="sire-home-section">
          <div className="sire-home-section-head"><div><span>GROW YOUR ASSETS</span><h2>Earn</h2></div><button type="button">See All <ChevronRight size={15} /></button></div>
          <div className="sire-home-earn-grid"><button><span>%</span><b>Flexible Earn</b><small>Earn on supported assets</small></button><button><span>◎</span><b>Staking</b><small>Put assets to work</small></button><button><Flame size={19} /><b>Opportunities</b><small>Explore current products</small></button></div>
        </section>

        <section className="sire-home-section sire-home-discover">
          <div className="sire-home-section-head"><div><span>DISCOVERY</span><h2>What's New</h2></div><button type="button">See All <ChevronRight size={15} /></button></div>
          <div className="sire-home-new-grid"><button><b>NEW</b><span>New Listings</span><small>Discover new assets</small><ChevronRight size={15} /></button><button><Flame size={18} /><span>Trending Tokens</span><small>Top gainers & losers</small><ChevronRight size={15} /></button><button><TrendingUp size={18} /><span>Hot Sectors</span><small>Explore trending sectors</small><ChevronRight size={15} /></button><button><Grid2X2 size={18} /><span>On-chain Activity</span><small>Live blockchain data</small><ChevronRight size={15} /></button></div>
        </section>

        <section className="sire-home-brief"><LineChart size={17} /><span>MARKET BRIEF</span><p>Market intelligence and important movements, summarized by SIRE.</p><ChevronRight size={16} /></section>
        <div className="sire-home-bottom-spacer" />
      </div>

      {searchOpen && (
        <div className="sire-home-search-overlay" onClick={() => setSearchOpen(false)}>
          <div className="sire-home-search-sheet" onClick={event => event.stopPropagation()}>
            <div className="sire-home-search-head"><strong>Search Markets</strong><button type="button" onClick={() => setSearchOpen(false)}>×</button></div>
            <div className="sire-home-search-input"><Search size={17} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search instruments, markets..." /></div>
            <div className="sire-home-search-results">{searchResults.map(item => <button key={item.id} onClick={() => { onSelectInstrument?.(item); setSearchOpen(false); }}><img src={item.logoUrl || fallbackLogo(item.displaySymbol || item.symbol)} alt="" /><span><b>{String(item.displaySymbol || item.symbol).toUpperCase()}</b><small>{item.providerLabel || item.provider || 'MARKET'}</small></span><ChevronRight size={15} /></button>)}</div>
          </div>
        </div>
      )}
    </main>
  );
}
