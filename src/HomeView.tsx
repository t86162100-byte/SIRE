import { useEffect, useMemo, useState } from 'react';
import './home.css';
import AuthGate, { type SireUser } from './AuthGate';
import {
  ArrowRight, Bell, BrainCircuit, ChevronRight, CircleUserRound, Eye, EyeOff, Flame,
  Grid2X2, LineChart, Search, Sparkles, TrendingUp, Wallet, Plus, X, ArrowLeft,
  Megaphone, Trophy, CalendarClock, Gift, CircleHelp,
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

type HomeDestination = 'home' | 'market' | 'trade' | 'discover' | 'portfolio';
type Props = {
  instruments: HomeInstrument[];
  onSelectInstrument?: (item: HomeInstrument) => void;
  onNavigate?: (tab: HomeDestination) => void;
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



export default function HomeView({ instruments, onSelectInstrument, onNavigate, videoSrc = '/sire-home-hero.mp4' }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [accountUser, setAccountUser] = useState<SireUser | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | null>(null);
  const [totalValueVisible, setTotalValueVisible] = useState(true);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [fundingStep, setFundingStep] = useState<'main'|'crypto'|'transfer'|'exchange'|'fiat'|'agents'|'p2p'|'buy'>('main');
  const [fundingCoinSearch, setFundingCoinSearch] = useState('');
  const [fundingCoins, setFundingCoins] = useState<any[]>([]);
  const [fundingCoinsBusy, setFundingCoinsBusy] = useState(false);
  const [fundingCoin, setFundingCoin] = useState<any>(null);
  const [fundingNetwork, setFundingNetwork] = useState('');
  const [fundingAddress, setFundingAddress] = useState<any>(null);
  const [fundingError, setFundingError] = useState('');
  const [fundingAddressBusy, setFundingAddressBusy] = useState(false);

  const accountValue: string | null = null;
  const openFunding = () => {
    setFundingOpen(true);
    setFundingStep('main');
    setFundingError('');
    setFundingAddress(null);
  };
  const filteredFundingCoins = useMemo(() => {
    const q = fundingCoinSearch.trim().toLowerCase();
    return fundingCoins.filter(item => !q || String(item.coin||'').toLowerCase().includes(q) || String(item.name||'').toLowerCase().includes(q));
  }, [fundingCoins, fundingCoinSearch]);
  useEffect(() => {
    if (!fundingOpen || fundingStep !== 'exchange' || fundingCoins.length) return;
    let cancelled = false;
    setFundingCoinsBusy(true);
    fetch('/api/sire/bitget/deposit/coins', { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data?.ok) throw new Error(data?.error || 'Could not load supported deposit assets.');
        if (!cancelled) setFundingCoins(Array.isArray(data.coins) ? data.coins : []);
      })
      .catch(error => { if (!cancelled) setFundingError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setFundingCoinsBusy(false); });
    return () => { cancelled = true; };
  }, [fundingOpen, fundingStep, fundingCoins.length]);
  const requestFundingAddress = async () => {
    if (!fundingCoin?.coin || !fundingNetwork) { setFundingError('Select a crypto and its supported deposit network.'); return; }
    setFundingAddressBusy(true); setFundingError(''); setFundingAddress(null);
    try {
      const params = new URLSearchParams({ coin: String(fundingCoin.coin), chain: fundingNetwork });
      const response = await fetch('/api/sire/bitget/deposit/address?' + params.toString(), { credentials: 'include', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Could not retrieve a deposit address.');
      const match = (Array.isArray(data.addresses) ? data.addresses : []).find((row:any) => String(row.chain||'') === fundingNetwork && row.address);
      if (!match) throw new Error('The exchange did not return an address for this asset/network. No address was invented.');
      setFundingAddress(match);
    } catch (error) { setFundingError(error instanceof Error ? error.message : String(error)); }
    finally { setFundingAddressBusy(false); }
  };
  const copyFundingValue = async (value:string) => {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setFundingError('Copied to clipboard.'); }
    catch { setFundingError('Clipboard access is unavailable on this device.'); }
  };


  useEffect(() => {
    let active = true;
    fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(payload => { if (active && payload?.user) setAccountUser(payload.user); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
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
    <main className="sire-home sire-home-v2">
      <header className="sire-home-header">
        <button type="button" className="sire-home-icon sire-home-profile-button" onClick={() => onNavigate?.('portfolio')} aria-label="Open profile and wallet"><CircleUserRound size={23} /></button>
        <div className="sire-home-header-actions">
          <button type="button" className="sire-home-icon" onClick={() => { setQuery(''); setSearchOpen(true); }} aria-label="Search SIRE"><Search size={21} /></button>
          <button type="button" className="sire-home-icon" onClick={() => setNotificationsOpen(true)} aria-label="Notifications"><Bell size={21} /></button>
          <button type="button" className="sire-home-icon" onClick={() => setSupportOpen(true)} aria-label="Help and support"><CircleHelp size={22} /></button>
        </div>
      </header>
      <div className="sire-home-scroll">

        <section className="sire-home-value-card" aria-label="Total account value">
          <div className="sire-home-value-main">
            <div className="sire-home-value-copy">
              <div className="sire-home-value-card-top"><span>TOTAL VALUE</span><button type="button" onClick={() => setTotalValueVisible(value => !value)} aria-label={totalValueVisible ? 'Hide total value' : 'Show total value'}>{totalValueVisible ? <Eye size={17}/> : <EyeOff size={17}/>}</button></div>
              <div className="sire-home-value-amount">{totalValueVisible ? (accountValue ?? '—') : '••••••'}<small>USD</small></div>
            </div>
            <div className="sire-home-value-chart" aria-label="Illustrative balance progress; real history will appear when connected">
              <svg viewBox="0 0 340 92" preserveAspectRatio="none" aria-hidden="true">
                <defs><linearGradient id="sireBalanceArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ffffff" stopOpacity=".22"/><stop offset="100%" stopColor="#ffffff" stopOpacity="0"/></linearGradient><filter id="sireBalanceGlow" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="5"/></filter></defs>
                <path d="M0 73 C22 70 29 55 48 60 S78 72 98 51 S126 47 145 54 S176 35 197 43 S225 29 245 36 S280 20 299 28 S322 15 340 12 L340 92 L0 92 Z" fill="url(#sireBalanceArea)"/>
                <path d="M0 73 C22 70 29 55 48 60 S78 72 98 51 S126 47 145 54 S176 35 197 43 S225 29 245 36 S280 20 299 28 S322 15 340 12" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="7" filter="url(#sireBalanceGlow)"/>
                <path d="M0 73 C22 70 29 55 48 60 S78 72 98 51 S126 47 145 54 S176 35 197 43 S225 29 245 36 S280 20 299 28 S322 15 340 12" fill="none" stroke="#f8f9f9" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
            </div>
          </div>
          {!accountUser ? <div className="sire-home-value-actions"><button type="button" className="sire-home-value-login" onClick={() => setAuthMode('login')}>Log in</button><button type="button" className="sire-home-value-signup" onClick={() => setAuthMode('signup')}>Sign up <ArrowRight size={15}/></button></div> : <button type="button" className="sire-home-value-add-funds" onClick={openFunding}><Plus size={17}/> Add funds</button>}
        </section>

        <section className="sire-home-launch">
          <div className="sire-home-section-heading"><div><span className="sire-home-kicker">GO DIRECT</span><h2>Open a workspace</h2></div><span className="sire-home-heading-index">01 — 04</span></div>
          <div className="sire-home-launch-grid">
            <button type="button" className="sire-home-launch-tile sire-home-launch-primary"><span className="sire-home-launch-icon"><TrendingUp size={21}/></span><b>Spot</b><small>Buy and sell assets</small><ArrowRight size={16} className="sire-home-launch-arrow"/></button>
            <button type="button" className="sire-home-launch-tile"><span className="sire-home-launch-icon"><LineChart size={21}/></span><b>Futures</b><small>Explore derivatives</small><ArrowRight size={16} className="sire-home-launch-arrow"/></button>
            <button type="button" className="sire-home-launch-tile"><span className="sire-home-launch-icon"><Wallet size={20}/></span><b>Wallet</b><small>Manage assets</small><ArrowRight size={16} className="sire-home-launch-arrow"/></button>
            <button type="button" className="sire-home-launch-tile"><span className="sire-home-launch-icon"><Grid2X2 size={20}/></span><b>Onchain</b><small>Discover networks</small><ArrowRight size={16} className="sire-home-launch-arrow"/></button>
          </div>
        </section>

        <section className="sire-home-section sire-home-markets sire-home-markets-v2">
          <div className="sire-home-section-head"><div><span className="sire-home-kicker">MARKET SCANNER</span><h2>Find your market</h2></div><button type="button" onClick={() => setSearchOpen(true)}>Search <Search size={14}/></button></div>
          <div className="sire-home-market-filter-shell" aria-label="Market discovery filters">
            <div className="sire-home-market-tabs" role="tablist" aria-label="Market filters">
              {['Hot','Favorite','Spot','Futures','New','Gainers','Losers','Vol','Market Cap'].map(filter => (
                <button key={filter} type="button" role="tab" aria-selected={activeMarketFilter === filter} className={activeMarketFilter === filter ? 'active' : ''} onClick={() => {
                  setActiveMarketFilter(filter);
                  setActiveMarketSubfilter(({Hot:'Spot',Spot:'All',Futures:'USD-M',New:'Spot',Gainers:'Spot',Losers:'Spot',Vol:'Spot','Market Cap':'Spot'} as Record<string,string>)[filter] || '');
                }}>{filter}</button>
              ))}
            </div>
            {marketSubfilters.length > 0 && <div className="sire-home-market-subtabs" role="tablist" aria-label={activeMarketFilter + ' categories'}>
              <span className="sire-home-market-subtabs-label">MARKET TYPE</span><div className="sire-home-market-subtabs-track">
                {marketSubfilters.map(filter => <button key={filter} type="button" role="tab" aria-selected={activeMarketSubfilter === filter} className={activeMarketSubfilter === filter ? 'active' : ''} onClick={() => setActiveMarketSubfilter(filter)}>{filter}</button>)}
              </div>
            </div>}
          </div>
          <div className="sire-home-market-table-head"><span>ASSET / SOURCE</span><span>LAST PRICE</span><span>24H</span></div>
          <div className="sire-home-watchlist" aria-label={activeMarketFilter + ' markets'}>
            {marketRows.slice(0,7).map(item => {
              const raw=item as any;
              const change=Number(raw.change24h ?? raw.changePercent24h ?? raw.priceChangePercent ?? raw.percentChange24h ?? raw.changePercent);
              const volume=Number(raw.volume24h ?? raw.quoteVolume ?? raw.volume);
              const displayBase=String(raw.base || item.displaySymbol || item.symbol).replace(new RegExp('/USDT$|/USD$|USDT$|USD$','i'),'').toUpperCase();
              const tone=Number.isFinite(change)?(change>0?'positive':change<0?'negative':'neutral'):'neutral';
              return <article key={item.id} className="sire-home-watch-row">
                <button type="button" className="sire-home-watch-main" onClick={() => onSelectInstrument?.(item)}>
                  <span className="market-asset-logo"><img className="market-token-logo" src={item.logoUrl || fallbackLogo(displayBase)} alt="" onError={event=>{event.currentTarget.onerror=null;event.currentTarget.src=fallbackLogo(displayBase)}}/><span className="market-source-logo"><img src={makeProviderLogoFallback(item)} alt="" onError={event=>{event.currentTarget.onerror=null;event.currentTarget.src=fallbackLogo(String(item.providerLabel||item.provider||'EX'))}}/></span></span>
                  <span className="market-asset-name"><b>{displayBase}</b><small>{String(item.name || item.displaySymbol || item.symbol).replace(/_/g,' ')} · {String(item.providerLabel || item.provider || 'MARKET').toUpperCase()}</small></span>
                  <span className="market-asset-price"><strong>{money(item.price)}</strong><small>{Number.isFinite(volume)?'VOL '+money(volume):'VOLUME —'}</small></span>
                </button>
                <button type="button" className={'market-trade-button '+tone} onClick={() => onSelectInstrument?.(item)} aria-label={Number.isFinite(change)?'24 hour change '+change.toFixed(2)+' percent':'24 hour change unavailable'}>{Number.isFinite(change)?(change>=0?'+':'')+change.toFixed(2)+'%':'—'}</button>
              </article>;
            })}
            {!marketRows.length && <div className="sire-home-empty"><Search size={20}/><b>No markets in this view</b><span>Try another filter to explore available instruments.</span></div>}
          </div>
        </section>

        <section className="sire-home-section sire-home-pulse sire-home-pulse-v2">
          <div className="sire-home-section-head"><div><span className="sire-home-kicker">PRICE SNAPSHOTS</span><h2>Market pulse</h2></div><span className="sire-home-heading-index">LIVE DATA</span></div>
          <div className="sire-home-pulse-viewport" aria-label="Live market pulse"><div className="sire-home-pulse-track">
            {pulseMarkets.map(item => {
              const raw=item as any;
              const change=Number(raw.change24h??raw.changePercent24h??raw.priceChangePercent??raw.percentChange24h??raw.changePercent);
              const tone: 'positive'|'negative'|'neutral'=Number.isFinite(change)?(change>0?'positive':change<0?'negative':'neutral'):'neutral';
              const base=String(raw.base||item.displaySymbol||item.symbol).replace(new RegExp('/USDT$|/USD$|USDT$|USD$','i'),'').toUpperCase();
              return <article key={item.id} className={'sire-home-pulse-card sire-home-pulse-card--'+tone}><button type="button" className="sire-home-pulse-main" onClick={()=>onSelectInstrument?.(item)}>
                <span className="sire-home-pulse-top"><span className="sire-home-pulse-identity"><span className="sire-home-pulse-logo"><img src={item.logoUrl||fallbackLogo(base)} alt="" onError={event=>{event.currentTarget.onerror=null;event.currentTarget.src=fallbackLogo(base)}}/></span><span className="sire-home-pulse-copy"><b>{base}</b><small>{String(item.name||item.displaySymbol||item.symbol).replace(/_/g,' ')}</small></span></span><span className="sire-home-pulse-source"><small>{String(item.providerLabel||item.provider||'MARKET').toUpperCase()}</small></span></span>
                <span className="sire-home-pulse-value"><strong>{money(item.price)}</strong><b className={tone}>{Number.isFinite(change)?(change>=0?'+':'')+change.toFixed(2)+'%':'—'}</b></span>
                <span className="sire-home-pulse-chart"><Sparkline values={pulseHistory.get(item.id)||[]} tone={tone}/></span>
              </button></article>;
            })}
            {!pulseMarkets.length && <div className="sire-home-empty"><LineChart size={20}/><b>Market data will appear here</b><span>Price snapshots appear when instrument data is available.</span></div>}
          </div></div>
        </section>

        <section className="sire-home-bottom-feature"><div className="sire-home-feature-number">02</div><div className="sire-home-feature-copy"><span className="sire-home-kicker">BUILT FOR ACTIVE MARKETS</span><h2>Less noise.<br/>More signal.</h2><p>Move from discovery to a selected instrument without losing your place.</p></div><div className="sire-home-feature-mark"><LineChart size={29}/></div></section>

        <section className="sire-home-section sire-home-discover sire-home-discover-v2">
          <div className="sire-home-section-head"><div><span className="sire-home-kicker">EXPLORE</span><h2>Discover more</h2></div><span className="sire-home-heading-index">03 — 04</span></div>
          <div className="sire-home-new-grid">
            <button type="button"><span className="sire-home-discover-icon"><Flame size={18}/></span><span>Trending markets</span><small>Explore active instruments</small><ChevronRight size={15}/></button>
            <button type="button"><span className="sire-home-discover-icon"><Sparkles size={18}/></span><span>New listings</span><small>Recently added assets</small><ChevronRight size={15}/></button>
            <button type="button"><span className="sire-home-discover-icon"><Trophy size={18}/></span><span>Top performers</span><small>Compare 24h movement</small><ChevronRight size={15}/></button>
            <button type="button"><span className="sire-home-discover-icon"><CalendarClock size={18}/></span><span>Market calendar</span><small>Keep up with events</small><ChevronRight size={15}/></button>
          </div>
        </section>
        <footer className="sire-home-footer"><img src="/sire-logo.svg" alt="SIRE"/><span>MARKETS MOVE. STAY READY.</span><small>Prices and account values appear when live data is available.</small></footer>
        <div className="sire-home-bottom-spacer" />
      </div>

      {searchOpen && (
        <div className="sire-home-search-overlay" onClick={() => setSearchOpen(false)}>
          <div className="sire-home-search-sheet" onClick={event => event.stopPropagation()}>
            <div className="sire-home-search-head"><strong>Search SIRE</strong><button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search">×</button></div>
            <div className="sire-home-search-input"><Search size={17} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search markets, tools and pages…" /></div>
            {<div className="sire-home-global-links"><span>APP PAGES</span>{([{label:'Home',detail:'Overview',tab:'home'},{label:'Markets',detail:'Browse instruments',tab:'market'},{label:'Spot & Futures',detail:'Trading workspace',tab:'trade'},{label:'Discover',detail:'Explore assets',tab:'discover'},{label:'Wallet',detail:'Portfolio and balances',tab:'portfolio'}] as {label:string;detail:string;tab:HomeDestination}[]).filter(link=>!query.trim()||`${link.label} ${link.detail}`.toLowerCase().includes(query.trim().toLowerCase())).map(link=><button type="button" key={link.tab} onClick={()=>{onNavigate?.(link.tab);setSearchOpen(false);}}><span><b>{link.label}</b><small>{link.detail}</small></span><ChevronRight size={16}/></button>)}</div>}
            <div className="sire-home-search-results">{searchResults.map(item => <button key={item.id} onClick={() => { onSelectInstrument?.(item); setSearchOpen(false); }}><img src={item.logoUrl || fallbackLogo(item.displaySymbol || item.symbol)} alt="" /><span><b>{String(item.displaySymbol || item.symbol).toUpperCase()}</b><small>{item.providerLabel || item.provider || 'MARKET'}</small></span><ChevronRight size={15} /></button>)}</div>
          </div>
        </div>
      )}
      {authMode && <AuthGate user={accountUser} initialMode={authMode} onUser={user => { setAccountUser(user); if (user) setAuthMode(null); }} onClose={() => setAuthMode(null)} />}
      {notificationsOpen && <div className="sire-home-support-overlay" onClick={()=>setNotificationsOpen(false)}><section className="sire-home-support-sheet" onClick={event=>event.stopPropagation()}><div className="sire-home-search-head"><strong>Notifications</strong><button type="button" onClick={()=>setNotificationsOpen(false)} aria-label="Close notifications">×</button></div><div className="sire-home-notifications-empty"><Bell size={24}/><b>You're all caught up</b><span>Important account and market updates will appear here.</span></div></section></div>}
              {fundingOpen && <div className="sire-funding-backdrop" onMouseDown={() => setFundingOpen(false)}>
          <section className="sire-funding-drawer" role="dialog" aria-modal="true" aria-label="Add funds" onMouseDown={event => event.stopPropagation()}>
            <div className="sire-funding-head">
              {fundingStep !== 'main' && <button type="button" className="sire-funding-icon-button" onClick={() => { setFundingStep(fundingStep === 'exchange' || fundingStep === 'buy' ? 'crypto' : fundingStep === 'transfer' ? 'crypto' : 'main'); setFundingError(''); }} aria-label="Back"><ArrowLeft size={18}/></button>}
              <div><span>ADD FUNDS</span><h2>{({main:'Choose funding method',crypto:'Crypto funding',transfer:'Transfer crypto',exchange:'To exchange',fiat:'Fiat deposit',agents:'Payment agents',p2p:'P2P funding',buy:'Buy crypto'} as Record<string,string>)[fundingStep]}</h2></div>
              <button type="button" className="sire-funding-icon-button" onClick={() => setFundingOpen(false)} aria-label="Close"><X size={18}/></button>
            </div>
            {fundingStep === 'main' && <div className="sire-funding-options">
              <button type="button" onClick={() => { setFundingStep('crypto'); setFundingError(''); }}><span className="sire-funding-option-icon">₿</span><span><b>Crypto</b><small>Buy crypto or transfer assets</small></span><ChevronRight size={17}/></button>
              <button type="button" onClick={() => { setFundingStep('fiat'); setFundingError(''); }}><span className="sire-funding-option-icon">₦</span><span><b>Fiat</b><small>Deposit with supported local currency methods</small></span><ChevronRight size={17}/></button>
              <button type="button" onClick={() => { setFundingStep('agents'); setFundingError(''); }}><span className="sire-funding-option-icon">↔</span><span><b>Payment Agents</b><small>Fund through a verified payment agent</small></span><ChevronRight size={17}/></button>
              <button type="button" onClick={() => { setFundingStep('p2p'); setFundingError(''); }}><span className="sire-funding-option-icon">P2P</span><span><b>P2P</b><small>Peer-to-peer funding options</small></span><ChevronRight size={17}/></button>
            </div>}
            {fundingStep === 'crypto' && <div className="sire-funding-options">
              <button type="button" onClick={() => { setFundingStep('buy'); setFundingError(''); }}><span className="sire-funding-option-icon">＋</span><span><b>Buy Crypto</b><small>Purchase crypto using an available payment method</small></span><ChevronRight size={17}/></button>
              <button type="button" onClick={() => { setFundingStep('transfer'); setFundingError(''); }}><span className="sire-funding-option-icon">⇄</span><span><b>Transfer Crypto</b><small>Receive crypto into a SIRE destination</small></span><ChevronRight size={17}/></button>
            </div>}
            {fundingStep === 'transfer' && <div className="sire-funding-options">
              <button type="button" onClick={() => { setFundingOpen(false); window.dispatchEvent(new CustomEvent('sire:open-wallet-receive')); }}><span className="sire-funding-option-icon"><Wallet size={20}/></span><span><b>To Wallet</b><small>Receive into your self-custody SIRE Wallet</small></span><ChevronRight size={17}/></button>
              <button type="button" onClick={() => { setFundingStep('exchange'); setFundingError(''); setFundingCoin(null); setFundingNetwork(''); setFundingAddress(null); }}><span className="sire-funding-option-icon">⇢</span><span><b>To Exchange</b><small>Choose a supported asset and deposit network</small></span><ChevronRight size={17}/></button>
            </div>}
            {fundingStep === 'exchange' && <div className="sire-funding-form">
              {!fundingCoin ? <>
                <label className="sire-funding-search"><Search size={16}/><input value={fundingCoinSearch} onChange={event => setFundingCoinSearch(event.target.value)} placeholder="Search supported crypto"/></label>
                {fundingCoinsBusy && <p className="sire-funding-note">Loading supported assets and networks…</p>}
                {!fundingCoinsBusy && !fundingCoins.length && <p className="sire-funding-note">{fundingError || 'No supported deposit assets could be loaded. Sign in and try again.'}</p>}
                <div className="sire-funding-coin-list">{filteredFundingCoins.slice(0,100).map(item => <button type="button" key={item.coin} onClick={() => { setFundingCoin(item); setFundingNetwork(item.networks?.[0]?.chain || ''); setFundingAddress(null); setFundingError(''); }}><span className="sire-funding-coin-icon">{String(item.coin||'?').slice(0,2)}</span><span><b>{item.coin}</b><small>{item.name}</small></span><ChevronRight size={16}/></button>)}</div>
              </> : <>
                <button type="button" className="sire-funding-change" onClick={() => { setFundingCoin(null); setFundingNetwork(''); setFundingAddress(null); }}>‹ Choose another crypto · {fundingCoin.coin}</button>
                <label className="sire-funding-field"><span>Deposit network</span><select value={fundingNetwork} onChange={event => { setFundingNetwork(event.target.value); setFundingAddress(null); setFundingError(''); }}><option value="">Select network</option>{(fundingCoin.networks||[]).map((network:any) => <option key={network.chain} value={network.chain}>{network.chain}{network.memoRequired ? ' · Memo/tag required' : ''}</option>)}</select></label>
                <button type="button" className="sire-funding-primary" disabled={!fundingNetwork || fundingAddressBusy} onClick={() => void requestFundingAddress()}>{fundingAddressBusy ? 'Retrieving address…' : 'Show deposit address'}</button>
                {fundingAddress && <div className="sire-funding-address"><span>{fundingAddress.coin} · {fundingAddress.chain}</span><code>{fundingAddress.address}</code><button type="button" onClick={() => void copyFundingValue(fundingAddress.address)}>Copy address</button>{fundingAddress.tag && <><span>MEMO / TAG — REQUIRED</span><code>{fundingAddress.tag}</code><button type="button" onClick={() => void copyFundingValue(fundingAddress.tag)}>Copy memo/tag</button></>}</div>}
              </>}
              {fundingError && <p className="sire-funding-note">{fundingError}</p>}
              <p className="sire-funding-warning">Only transfer the selected crypto over the exact network shown. Check the address and any memo/tag before sending.</p>
            </div>}
            {(['fiat','agents','p2p','buy'] as string[]).includes(fundingStep) && <div className="sire-funding-unavailable"><div className="sire-funding-unavailable-mark">—</div><h3>{fundingStep === 'fiat' ? 'Fiat deposits' : fundingStep === 'agents' ? 'Payment agents' : fundingStep === 'p2p' ? 'P2P funding' : 'Buy crypto'}</h3><p>{fundingStep === 'fiat' ? 'Fiat currency and payment methods will appear here when a verified deposit provider is connected.' : fundingStep === 'agents' ? 'Verified agents and their supported currencies are not connected yet.' : fundingStep === 'p2p' ? 'P2P offers and payment protection are not connected yet.' : 'Crypto purchase methods and live quotes are not connected yet.'}</p><span>Not available yet · No payment will be initiated</span></div>}
          </section>
        </div>}
        {supportOpen && <div className="sire-home-support-overlay" onClick={()=>setSupportOpen(false)}><section className="sire-home-support-sheet" onClick={event=>event.stopPropagation()}><div className="sire-home-search-head"><strong>Help & support</strong><button type="button" onClick={()=>setSupportOpen(false)} aria-label="Close support">×</button></div><p>What do you need help with?</p><button type="button" onClick={()=>{setSupportOpen(false);onNavigate?.('market')}}><span><b>Markets & prices</b><small>Finding instruments and understanding market data</small></span><ChevronRight size={16}/></button><button type="button" onClick={()=>{setSupportOpen(false);onNavigate?.('trade')}}><span><b>Trading</b><small>Open the Spot and Futures workspace</small></span><ChevronRight size={16}/></button><button type="button" onClick={()=>{setSupportOpen(false);onNavigate?.('portfolio')}}><span><b>Wallet & account</b><small>Open your portfolio and wallet tools</small></span><ChevronRight size={16}/></button></section></div>}
    </main>
  );
}
