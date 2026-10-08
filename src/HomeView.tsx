import { useEffect, useMemo, useState } from 'react';
import './home.css';
import SireVisualEngine from './SireVisualEngine';
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
  quote?: string;
  instrumentType?: string;
};

type Props = {
  instruments: HomeInstrument[];
  onSelectInstrument?: (item: HomeInstrument) => void;
  videoSrc?: string;
};

const makeProviderLogoFallback = (_item: HomeInstrument) => 'https://deriv.com/favicon.ico';

const fallbackLogo = (label: string) => {
  const text = String(label || '?').slice(0, 2).toUpperCase();
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="46" fill="#111a20"/><text x="48" y="55" text-anchor="middle" font-family="Arial" font-size="28" font-weight="800" fill="#e8fbff">' + text + '</text></svg>'
  );
};

function money(value?: number) {
  if (!Number.isFinite(value)) return '—';
  return '$' + Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 });
}function Sparkline({ values, tone }: { values: number[]; tone: 'positive' | 'negative' | 'neutral' }) {
  const width=132, height=42, pad=3;
  const finite=values.filter(Number.isFinite);
  if(!finite.length) return <div className={`sire-home-pulse-spark sire-home-pulse-spark--${tone}`} aria-hidden="true" />;
  const min=Math.min(...finite), max=Math.max(...finite), span=max-min || Math.max(Math.abs(max)*0.0001,1);
  const points=finite.map((value,index)=>{
    const x=finite.length===1 ? width/2 : pad+(index/(finite.length-1))*(width-pad*2);
    const y=height-pad-((value-min)/span)*(height-pad*2);
    return [x,y] as const;
  });
  const line=points.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area=`M ${points[0][0].toFixed(1)} ${height-pad} L ${line.replace(/,/g,' ')} L ${points[points.length-1][0].toFixed(1)} ${height-pad} Z`;
  return <div className={`sire-home-pulse-spark sire-home-pulse-spark--${tone}`} aria-hidden="true"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><path className="sire-home-pulse-spark-fill" d={area}/><polyline className="sire-home-pulse-spark-line" points={line} fill="none"/></svg></div>;
}



export default function HomeView({ instruments, onSelectInstrument, videoSrc = '/sire-home-hero.mp4' }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [activeEvent, setActiveEvent] = useState(0);
  const [activeMarketFilter, setActiveMarketFilter] = useState('Hot');
  const [activeMarketSubfilter, setActiveMarketSubfilter] = useState('Spot');
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => { try { const saved = window.localStorage.getItem('sire.home.marketFavorites'); return saved ? JSON.parse(saved) : []; } catch { return []; } });

  const marketSubfilters = useMemo(() => {
    switch (activeMarketFilter) {
      case 'Hot': case 'New': case 'Gainers': case 'Losers': case 'Vol': case 'Market Cap': return ['Spot', 'Futures'];
      case 'Spot': return ['All', 'USDT', 'USDC', 'Other'];
      case 'Futures': return ['USD-M', 'COIN-M'];
      default: return [];
    }
  }, [activeMarketFilter]);

  const isFutures = (item: HomeInstrument) => String(item.marketType || '').toLowerCase().includes('future') || String(item.marketType || '').toLowerCase().includes('perpetual');
  const isSpot = (item: HomeInstrument) => String(item.marketType || '').toLowerCase() === 'spot';
  const quoteAsset = (item: HomeInstrument) => String((item as any).quote || '').trim().toUpperCase();

  const marketRows = useMemo(() => {
    const change = (item: HomeInstrument) => Number(item.change24h ?? (item as any).priceChangePercent);
    const volume = (item: HomeInstrument) => Number(item.volume24h);
    const cap = (item: HomeInstrument) => Number(item.marketCap);
    let rows = [...instruments];
    if (activeMarketFilter === 'Favorite') rows = rows.filter(item => favoriteIds.includes(item.id));
    if (activeMarketFilter === 'Spot') rows = rows.filter(isSpot);
    if (activeMarketFilter === 'Futures') rows = rows.filter(isFutures);
    if (['Hot','Gainers','Losers','Vol','Market Cap','New'].includes(activeMarketFilter)) {
      rows = rows.filter(item => isSpot(item) || isFutures(item));
    }
    if (activeMarketSubfilter === 'Spot') rows = rows.filter(item => isSpot(item));
    if (activeMarketSubfilter === 'Futures') rows = rows.filter(item => isFutures(item));
    if (activeMarketFilter === 'Gainers') rows.sort((a,b) => change(b)-change(a));
    else if (activeMarketFilter === 'Losers') rows.sort((a,b) => change(a)-change(b));
    else if (activeMarketFilter === 'Vol' || activeMarketFilter === 'Hot') rows.sort((a,b) => volume(b)-volume(a));
    else if (activeMarketFilter === 'Market Cap') rows.sort((a,b) => cap(b)-cap(a));
    else if (activeMarketFilter === 'New') rows.sort((a,b) => Number(b.listedAt ?? b.onboardDate ?? 0)-Number(a.listedAt ?? a.onboardDate ?? 0));
    else rows.sort((a,b) => volume(b)-volume(a));
    return rows;
  }, [instruments, activeMarketFilter, activeMarketSubfilter, favoriteIds]);

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

  const liveMarkets = useMemo(() => instruments.slice(0, 8), [instruments]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return liveMarkets.slice(0, 8);
    return instruments.filter(item => `${item.displaySymbol || item.symbol} ${item.name || ''} ${item.providerLabel || item.provider || ''}`.toLowerCase().includes(q)).slice(0, 12);
  }, [instruments, liveMarkets, query]);

  const pulseMarkets = useMemo(() => marketRows.filter(item => Number.isFinite(Number(item.price))).slice(0, 4), [marketRows]);

  const [pulseHistory, setPulseHistory] = useState<Map<string, number[]>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const loadPulseHistory = async () => {
      const entries = await Promise.all(pulseMarkets.map(async item => {
        try {
          const response = await fetch(
            '/api/sire/market-history?provider=' + encodeURIComponent(String(item.provider || '')) +
            '&symbol=' + encodeURIComponent(String(item.symbol || '')) +
            '&marketType=' + encodeURIComponent(String(item.marketType || 'Spot')),
            { cache: 'no-store' }
          );
          if (!response.ok) return [item.id, []] as const;
          const payload = await response.json();
          const points = Array.isArray(payload?.points)
            ? payload.points.map((point: any) => Number(point?.price)).filter((value: number) => Number.isFinite(value))
            : [];
          return [item.id, points.slice(-24)] as const;
        } catch {
          return [item.id, []] as const;
        }
      }));
      if (cancelled) return;
      setPulseHistory(new Map(entries));
    };
    if (pulseMarkets.length) void loadPulseHistory();
    const timer = window.setInterval(() => {
      if (pulseMarkets.length) void loadPulseHistory();
    }, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pulseMarkets]);


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

      <SireVisualEngine className="sire-home-gpu" />

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
            {marketRows.slice(0, 7).map(item => {
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
                      <img className="market-token-logo" src={item.logoUrl || fallbackLogo(displayBase)} alt="" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = fallbackLogo(displayBase); }} />
                      <span className="market-source-logo" aria-label={String(item.providerLabel || item.provider || 'Market source')}>
                        <img src={makeProviderLogoFallback(item)} alt="" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = fallbackLogo(String(item.providerLabel || item.provider || 'EX')); }} />
                      </span>
                    </span>
                    <span className="market-asset-name">
                      <b>{displayBase}</b>
                      <small>{String(item.name || item.displaySymbol || item.symbol).replace(/_/g, ' ')} · {String(item.providerLabel || item.provider || 'MARKET').toUpperCase()}</small>
                    </span>
                    <span className="market-asset-price">
                      <strong>{money(item.price)}</strong>
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
          <div className="sire-home-pulse-viewport" aria-label="Live market pulse">
            <div className="sire-home-pulse-track">
              {[...pulseMarkets, ...pulseMarkets].map((item, index) => {
                const raw=item as any;
                const change=Number(raw.change24h??raw.changePercent24h??raw.priceChangePercent??raw.percentChange24h??raw.changePercent);
                const tone: 'positive'|'negative'|'neutral'=Number.isFinite(change)?(change>0?'positive':change<0?'negative':'neutral'):'neutral';
                const base=String(raw.base||item.displaySymbol||item.symbol).replace(/\/USDT$|\/USD$|USDT$|USD$/i,'').toUpperCase();
                const source=String(item.providerLabel||item.provider||'Market source').toUpperCase();
                return <article key={item.id + '-' + index} className={`sire-home-pulse-card sire-home-pulse-card--${tone}`}>
                  <button type="button" className="sire-home-pulse-main" onClick={()=>onSelectInstrument?.(item)} aria-label={`Open ${base} on ${source}`}>
                    <span className="sire-home-pulse-top">
                      <span className="sire-home-pulse-identity">
                        <span className="sire-home-pulse-logo"><img src={item.logoUrl||fallbackLogo(base)} alt="" decoding="async" onError={event=>{event.currentTarget.onerror=null;event.currentTarget.src=fallbackLogo(base)}}/></span>
                        <span className="sire-home-pulse-copy"><b>{base}</b><small>{String(item.name||item.displaySymbol||item.symbol).replace(/_/g,' ')}</small></span>
                      </span>
                      <span className="sire-home-pulse-source"><img src={makeProviderLogoFallback(item)} alt="" decoding="async" onError={event=>{event.currentTarget.onerror=null;event.currentTarget.src=fallbackLogo(source)}}/><small>{source}</small></span>
                    </span>
                    <span className="sire-home-pulse-value">
                      <strong>{money(item.price)}</strong>
                      <b className={tone}>{Number.isFinite(change)?`${change>=0?'+':''}${change.toFixed(2)}%`:'—'}</b>
                    </span>
                    <span className="sire-home-pulse-chart"><Sparkline values={pulseHistory.get(item.id)||[]} tone={tone}/></span>
                    <span className="sire-home-pulse-edge" aria-hidden="true"/>
                  </button>
                </article>;
              })}
            </div>
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
