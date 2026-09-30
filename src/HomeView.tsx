import { useEffect, useMemo, useState } from 'react';
import { getBinanceHotFromCatalogue } from './binanceMarketData';
import './home.css';
import {
  ArrowRight, Bell, BrainCircuit, ChevronRight, CircleUserRound, Eye, EyeOff, Flame,
  Grid2X2, LineChart, Search, Sparkles, TrendingUp, Wallet, ArrowDownToLine, ArrowUpFromLine, Repeat2,
  BadgePercent, Megaphone, Trophy, CalendarClock, Gift, MoreHorizontal,
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
  change24h?: number;
  volume24h?: number;
  tradeCount24h?: number;
  listedAt?: number;
  onboardDate?: number;
  marketCap?: number;
  circulatingSupply?: number;
  newListing?: boolean;
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
  const [activeMarketSubfilter, setActiveMarketSubfilter] = useState('Spot');
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => { try { const saved = window.localStorage.getItem('sire.home.marketFavorites'); return saved ? JSON.parse(saved) : []; } catch { return []; } });
  const [binanceNewFeed, setBinanceNewFeed] = useState<Array<{ symbol: string; marketType: string; listedAt: number }>>([]);
  const binanceUniverse = useMemo(
    () => instruments.filter(item => item.provider === 'BINANCE'),
    [instruments],
  );
  useEffect(() => {
    let cancelled = false;
    fetch('/api/sire/binance/new-listings', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (!cancelled && Array.isArray(payload?.items)) setBinanceNewFeed(payload.items);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const binanceSpot = useMemo(() => {
    const rows = binanceUniverse
      .filter(item => String(item.marketType || '').toLowerCase().includes('spot'))
      .filter(item => String(item.symbol || '').toUpperCase().endsWith('USDT'));
    const byBase = new Map<string, HomeInstrument>();
    for (const item of rows) {
      const base = String((item as any).base || item.symbol).replace(/USDT$/i, '').toUpperCase();
      const current = byBase.get(base);
      if (!current || String((item as any).quote || '').toUpperCase() === 'USDT') byBase.set(base, item);
    }
    return Array.from(byBase.values());
  }, [binanceUniverse]);

  const binanceFutures = useMemo(
    () => binanceUniverse
      .filter(item => {
        const mt = String(item.marketType || '').toLowerCase();
        return mt.includes('future') || mt.includes('perpetual');
      })
      .sort((a, b) => Number(b.volume24h || 0) - Number(a.volume24h || 0)),
    [binanceUniverse],
  );

  const binanceHotMarkets = useMemo(() => getBinanceHotFromCatalogue(binanceUniverse, 8) as HomeInstrument[], [binanceUniverse]);

  const binanceHotFutures = useMemo(() => {
    const change = (item: HomeInstrument) => Number(item.change24h ?? (item as any).priceChangePercent);
    const volume = (item: HomeInstrument) => Number(item.volume24h);
    return [...binanceFutures]
      .filter(item => Number.isFinite(Number(item.price)))
      .sort((a, b) => {
        const score = (item: HomeInstrument) => {
          const volumeScore = Math.log10(Math.max(1, volume(item) || 0));
          const movementScore = Math.min(12, Math.abs(change(item) || 0));
          const participationScore = Math.log10(Math.max(1, Number(item.tradeCount24h) || 1)) * 0.35;
          return volumeScore * 1.15 + movementScore * 1.8 + participationScore;
        };
        return score(b) - score(a);
      })
      .slice(0, 8);
  }, [binanceFutures]);

  const marketSubfilters = useMemo(() => {
    switch (activeMarketFilter) {
      case 'Hot':
      case 'New':
      case 'Gainers':
      case 'Losers':
      case 'Vol':
      case 'Market Cap':
        return ['Spot', 'Futures'];
      case 'Spot':
        return ['All', 'USDT', 'USDC', 'Other'];
      case 'Futures':
        return ['USD-M', 'COIN-M'];
      default:
        return [];
    }
  }, [activeMarketFilter]);

  const isCoinM = (item: HomeInstrument) => {
    const id = String(item.id || '').toUpperCase();
    const symbol = String(item.symbol || '').toUpperCase();
    return id.startsWith('BINANCE:COIN-M:') || symbol.includes('_');
  };

  const isFutures = (item: HomeInstrument) => {
    const mt = String(item.marketType || '').toLowerCase();
    return mt.includes('future') || mt.includes('perpetual');
  };

  const isSpot = (item: HomeInstrument) => String(item.marketType || '').toLowerCase() === 'spot';

  const filterSpotSubcategory = (rows: HomeInstrument[]) => {
    if (activeMarketSubfilter === 'All') return rows;
    return rows.filter(item => {
      const quote = String((item as any).quote || '').toUpperCase();
      if (activeMarketSubfilter === 'USDT') return quote === 'USDT' || (!quote && String(item.symbol || '').toUpperCase().endsWith('USDT'));
      if (activeMarketSubfilter === 'USDC') return quote === 'USDC' || (!quote && String(item.symbol || '').toUpperCase().endsWith('USDC'));
      return quote !== 'USDT' && quote !== 'USDC';
    });
  };

  const filterFuturesSubcategory = (rows: HomeInstrument[]) => {
    if (activeMarketSubfilter === 'COIN-M') return rows.filter(isCoinM);
    if (activeMarketSubfilter === 'USD-M') return rows.filter(item => !isCoinM(item));
    return rows;
  };

  // Binance's New market is split into Crypto and Futures. Keep both
  // families in SIRE's single New filter and order them by their actual
  // listing/onboarding time.
  const binanceNewCrypto = useMemo(() => {
    const listedAt = (item: HomeInstrument) => Number(item.listedAt ?? item.onboardDate);
    return [...binanceSpot]
      .filter(item => item.newListing === true || Number.isFinite(listedAt(item)))
      .sort((a, b) => Number(b.newListing === true) - Number(a.newListing === true) || listedAt(b) - listedAt(a));
  }, [binanceSpot]);

  const binanceNewFutures = useMemo(() => {
    const listedAt = (item: HomeInstrument) => Number(item.onboardDate ?? item.listedAt);
    return [...binanceFutures]
      .filter(item => Number.isFinite(listedAt(item)))
      .sort((a, b) => listedAt(b) - listedAt(a));
  }, [binanceFutures]);

  const binanceNewAnnouncementRows = useMemo(() => {
    if (!binanceNewFeed.length) return [] as HomeInstrument[];
    const out: HomeInstrument[] = [];
    const seen = new Set<string>();
    for (const entry of binanceNewFeed) {
      const target = String(entry.symbol || '').toUpperCase();
      const future = String(entry.marketType || '').toLowerCase().includes('future');
      const pool = future ? binanceFutures : binanceSpot;
      for (const item of pool) {
        const symbol = String(item.symbol || '').toUpperCase();
        const base = String((item as any).base || '').toUpperCase();
        const matches = symbol === target || base === target || symbol.replace(/USDT$|USDC$|BUSD$/,'') === target;
        if (!matches || seen.has(item.id)) continue;
        seen.add(item.id);
        out.push({ ...item, listedAt: Number(entry.listedAt), onboardDate: Number(entry.listedAt), newListing: true });
      }
    }
    return out.sort((a,b) => Number(b.listedAt ?? 0) - Number(a.listedAt ?? 0));
  }, [binanceNewFeed, binanceSpot, binanceFutures]);

  const binanceMarketRows = useMemo(() => {
    const change = (item: HomeInstrument) => Number(item.change24h ?? item.priceChangePercent);
    const volume = (item: HomeInstrument) => Number(item.volume24h);
    const listedAt = (item: HomeInstrument) => Number(item.listedAt ?? item.onboardDate);
    const marketCap = (item: HomeInstrument) => Number(item.marketCap);

    switch (activeMarketFilter) {
      case 'Favorite':
        return binanceUniverse.filter(item => favoriteIds.includes(item.id) && Number.isFinite(Number(item.price)));
      case 'Hot':
        return activeMarketSubfilter === 'Futures' ? binanceHotFutures : binanceHotMarkets;
      case 'Spot':
        return filterSpotSubcategory([...binanceSpot].sort((a, b) => volume(b) - volume(a)));
      case 'Futures':
        return filterFuturesSubcategory(binanceFutures);
      case 'New': {
        const rows = binanceNewAnnouncementRows.length
          ? binanceNewAnnouncementRows
          : [...binanceNewCrypto, ...binanceNewFutures].sort((a, b) => {
              const aTime = Number(a.onboardDate ?? a.listedAt);
              const bTime = Number(b.onboardDate ?? b.listedAt);
              return bTime - aTime;
            });
        return activeMarketSubfilter === 'Futures'
          ? rows.filter(isFutures)
          : rows.filter(item => !isFutures(item));
      }
      case 'Gainers': {
        const rows = [...binanceUniverse].filter(item => Number.isFinite(change(item))).sort((a, b) => change(b) - change(a));
        return activeMarketSubfilter === 'Futures'
          ? rows.filter(isFutures)
          : rows.filter(isSpot);
      }
      case 'Losers': {
        const rows = [...binanceUniverse].filter(item => Number.isFinite(change(item))).sort((a, b) => change(a) - change(b));
        return activeMarketSubfilter === 'Futures'
          ? rows.filter(isFutures)
          : rows.filter(isSpot);
      }
      case 'Vol': {
        const rows = [...binanceUniverse].filter(item => Number.isFinite(volume(item))).sort((a, b) => volume(b) - volume(a));
        return activeMarketSubfilter === 'Futures'
          ? rows.filter(isFutures)
          : rows.filter(isSpot);
      }
      case 'Market Cap': {
        const spotCaps = new Map<string, number>();
        for (const item of binanceSpot) {
          const base = String((item as any).base || item.symbol || '').replace(/USDT$|USDC$|BUSD$/i, '').toUpperCase();
          const cap = marketCap(item);
          if (base && Number.isFinite(cap)) spotCaps.set(base, cap);
        }
        const rows = [...binanceUniverse]
          .map(item => {
            const base = String((item as any).base || item.symbol || '').replace(/USDT$|USDC$|BUSD$/i, '').toUpperCase();
            const cap = marketCap(item);
            return Number.isFinite(cap) ? item : (Number.isFinite(spotCaps.get(base)) ? { ...item, marketCap: spotCaps.get(base) } : item);
          })
          .filter(item => Number.isFinite(marketCap(item)))
          .sort((a, b) => marketCap(b) - marketCap(a));
        return activeMarketSubfilter === 'Futures'
          ? rows.filter(isFutures)
          : rows.filter(isSpot);
      }
      default:
        return binanceSpot;
    }
  }, [activeMarketFilter, activeMarketSubfilter, binanceUniverse, binanceSpot, binanceFutures, binanceHotMarkets, binanceHotFutures, binanceNewCrypto, binanceNewFutures, binanceNewAnnouncementRows, favoriteIds]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveEvent(current => (current + 1) % 4);
    }, 6500);
    return () => window.clearInterval(timer);
  }, []);

  // Keep the visual system responsive while the user is actively swiping.
  // This only toggles a CSS class; it does not update React state on every scroll event.
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.sire-home-scroll');
    const homeRoot = scroller?.closest<HTMLElement>('.sire-home');
    if (!scroller || !homeRoot) return;
    let settleTimer = 0;
    const onScroll = () => {
      scroller.classList.add('is-scrolling');
      homeRoot.classList.add('is-scrolling');
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        scroller.classList.remove('is-scrolling');
        homeRoot.classList.remove('is-scrolling');
      }, 120);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.clearTimeout(settleTimer);
      scroller.classList.remove('is-scrolling');
      homeRoot.classList.remove('is-scrolling');
    };
  }, []);

  const liveMarkets = useMemo(() => {
    const crypto = instruments.filter(item => item.category?.toLowerCase().includes('crypto')).slice(0, 8);
    return crypto.length ? crypto : instruments.slice(0, 8);
  }, [instruments]);

  const marketRows = binanceMarketRows;

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
          <div className="sire-home-market-filter-shell" aria-label="Market discovery filters">
            <div className="sire-home-market-tabs" role="tablist" aria-label="Market filters">
              {['Favorite', 'Hot', 'Spot', 'Futures', 'New', 'Gainers', 'Losers', 'Vol', 'Market Cap'].map(filter => (
                <button
                  key={filter}
                  type="button"
                  role="tab"
                  aria-selected={activeMarketFilter === filter}
                  className={activeMarketFilter === filter ? 'active' : ''}
                  onClick={() => {
                    setActiveMarketFilter(filter);
                    setActiveMarketSubfilter(({
                      Hot: 'Spot',
                      Spot: 'All',
                      Futures: 'USD-M',
                      New: 'Spot',
                      Gainers: 'Spot',
                      Losers: 'Spot',
                      Vol: 'Spot',
                      'Market Cap': 'Spot',
                    } as Record<string, string>)[filter] || '');
                  }}
                >
                  {filter}
                </button>
              ))}
            </div>
            {marketSubfilters.length > 0 && (
              <div className="sire-home-market-subtabs" role="tablist" aria-label={activeMarketFilter + ' categories'}>
                <span className="sire-home-market-subtabs-label">VIEW</span>
                <div className="sire-home-market-subtabs-track">
                  {marketSubfilters.map(filter => (
                    <button
                      key={filter}
                      type="button"
                      role="tab"
                      aria-selected={activeMarketSubfilter === filter}
                      className={activeMarketSubfilter === filter ? 'active' : ''}
                      onClick={() => setActiveMarketSubfilter(filter)}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="sire-home-watchlist" aria-label={activeMarketFilter + ' markets'}>
            {(marketRows.length ? marketRows.slice(0, 8) : []).map(item => {
              const raw = item as any;
              const change = Number(raw.change24h ?? raw.changePercent24h ?? raw.priceChangePercent ?? raw.percentChange24h ?? raw.changePercent);
              const volume = Number(raw.volume24h ?? raw.quoteVolume ?? raw.volume);
              const isFavorite = favoriteIds.includes(item.id);
              if (activeMarketFilter === 'Favorite' && !isFavorite) return null;
              const displayBase = String(raw.base || item.displaySymbol || item.symbol).replace(/\/USDT$|\/USD$|USDT$|USD$/i, '').toUpperCase();
              const tradeTone = Number.isFinite(change) ? (change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral') : 'neutral';
              return (
                <article key={item.id} className="sire-home-watch-row">
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
                  <button type="button" className={`market-trade-button ${tradeTone}`} onClick={() => onSelectInstrument?.(item)} aria-label={Number.isFinite(change) ? `24 hour change ${change.toFixed(2)} percent` : '24 hour change unavailable'}>{Number.isFinite(change) ? ((change >= 0 ? '+' : '') + change.toFixed(2) + '%') : '—'}</button>
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
