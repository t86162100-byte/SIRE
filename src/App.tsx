import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createLinkGroup, type LinkGroup } from 'openalgo-charts';
import { Search } from 'lucide-react';
import ResearchLab from './ResearchLab';
import HomeView from './HomeView';
import MarketTab from './MarketTab';
import FinancialChart from './FinancialChart';
import { fetchDerivInstruments, type DerivInstrument } from './derivMarketData';
import { fetchBinanceBrowserCatalogue, fetchBinanceLiveQuotes, fetchBinanceMarketMetadata, createBinanceCatalogueLiveFeed } from './binanceMarketData';
import { SireErrorScreen } from './SireErrorBoundary';
import './nativeTerminal.css';

type MarketProvider = 'BINGX' | 'DERIV' | 'FXCM' | 'HYPERLIQUID' | 'GLOBALCRYPTO' | 'BINANCE' | 'BITGET' | 'BYBIT' | 'OKX' | 'KRAKEN' | 'COINBASE' | 'GATEIO' | 'KUCOIN' | 'GEMINI' | 'BITSO' | 'BITFINEX' | 'BITVAVO' | 'COINEX' | 'LBANK' | 'WOOX' | 'CRYPTOCOM' | 'HTX' | 'BITKUB' | 'UPBIT' | 'PIONEX' | 'POLONIEX' | 'BITHUMB' | 'MEXC' | 'PHEMEX' | 'WHITEBIT' | 'TWELVEDATA' | 'NASDAQTRADER' | 'NSE' | 'BITSTAMP' | 'OANDA' | 'TRADINGVIEW' | 'FOREXCOM' | 'INTERACTIVEBROKERS' | 'TRADESTATION' | 'WEBULL' | 'MOOMOO' | 'NINJATRADER' | 'TRADOVATE' | 'AMPFUTURES' | 'TASTYTRADE' | 'TASTYFX' | 'CRYPTOCOMEXCHANGE' | 'COINBASEADVANCED' | 'ALPACA' | 'TRADIERBROKERAGE' | 'TRADEZERO' | 'COBRATRADING' | 'CLEARSTREET' | 'INVESTRADE' | 'PUBLIC' | 'PLUS500US' | 'OPTIMUSFUTURES' | 'EDGECLEAR' | 'IRONBEAM' | 'STONEX' | 'DORMANTRADING' | 'TRADIERFUTURES' | 'BITTREX' | 'BLANK' | 'XT' | 'DEEPCOIN' | 'TOOBIT' | 'WEEX' | 'BITUNIX' | 'BLOFIN' | 'COINCATCH' | 'ZOOMEX' | 'BTCC' | 'DIGIFINEX' | 'COINSTORE' | 'PROBIT' | 'POLONIEX' | 'COINDCX' | 'POLYMARKET' | 'KALSHI' | 'OPINION' | 'UNISWAP' | 'CURVE' | 'PANCAKESWAP' | 'SUSHISWAP' | 'RAYDIUM' | 'JUPITER' | 'ORCA' | 'AERODROME' | 'TRADERJOE' | 'ONEINCH' | 'COWSWAP' | 'BALANCER';
type Instrument = DerivInstrument & {
  id: string;
  provider: MarketProvider;
  providerLabel: string;
  exchange?: string;
  marketType: string;
  category: string;
  displaySymbol: string;
  price?: number;
  bid?: number;
  ask?: number;
  logoUrl: string;
  providerLogoUrl: string;
  change24h?: number;
  priceChangePercent?: number;
  volume24h?: number;
  tradeCount24h?: number;
  listedAt?: number;
  onboardDate?: number;
  circulatingSupply?: number;
  marketCap?: number;
  newListing?: boolean;
};

const makeLogoFallback = (label: string) => {
  const text = String(label || '?').slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><circle cx="64" cy="64" r="62" fill="#20242b"/><text x="64" y="69" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="42" font-weight="900" fill="#fff">${text}</text></svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
};

const makeAssetLogoFallback = (item: Instrument) => {
  const base = String(item.base || '').trim().toLowerCase();
  return base ? 'https://cdn.jsdelivr.net/gh/vadimmalykhin/binance-icons/crypto/' + encodeURIComponent(base) + '.svg' : makeLogoFallback(item.displaySymbol || item.symbol);
};
/*
 * Exchange logos use the same working image-loading path as the existing
 * Deriv/provider logos. No npm icon package or runtime CDN is used.
 */
const exchangeDomains: Record<string, string> = {
  bingx: 'bingx.com',
  bitrue: 'bitrue.com',
  ascendex: 'ascendex.com',
  whitebit: 'whitebit.com',
  coinw: 'coinw.com',
  xt: 'xt.com',
  deepcoin: 'deepcoin.com',
  toobit: 'toobit.com',
  weex: 'weex.com',
  bitunix: 'bitunix.com',
  blofin: 'blofin.com',
  coincatch: 'coincatch.com',
  zoomex: 'zoomex.com',
  btcc: 'btcc.com',
  digifinex: 'digifinex.com',
  coinstore: 'coinstore.com',
  probit: 'probit.com',
  poloniex: 'poloniex.com',
  coindcx: 'coindcx.com',
  binance: 'binance.com',
  bitget: 'bitget.com',
  bybit: 'bybit.com',
  okx: 'okx.com',
  kraken: 'kraken.com',
  coinbase: 'coinbase.com',
  gate: 'gate.io',
  gateio: 'gate.io',
  kucoin: 'kucoin.com',
  mexc: 'mexc.com',
  gemini: 'gemini.com',
  bitfinex: 'bitfinex.com',
  bitstamp: 'bitstamp.net',
  bitvavo: 'bitvavo.com',
  coinex: 'coinex.com',
  lbank: 'lbank.com',
  cryptocom: 'crypto.com',
  htx: 'htx.com',
  upbit: 'upbit.com',
  bithumb: 'bithumb.com',
  phemex: 'phemex.com',
  bitso: 'bitso.com',
  bitkub: 'bitkub.com',
  pionex: 'pionex.com',
  hyperliquid: 'hyperliquid.xyz',
  oanda: 'oanda.com',
  woox: 'woo.org',
  uniswap: 'uniswap.org', curve: 'curve.fi', pancakeswap: 'pancakeswap.finance',
};

const makeProviderLogoFallback = (item: Instrument) => {
  const key = String(item.exchange || item.providerLabel || item.provider || '')
    .trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const domain = item.provider === 'DERIV'
    ? 'deriv.com'
    : (exchangeDomains[key] || (key ? key + '.com' : 'deriv.com'));
  return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=128';
};

const bitgetWebSocketUrl = 'wss://ws.bitget.com/v3/ws/public';

const getBitgetInstType = (item: Instrument) => {
  const category = String((item as any).bitgetCategory || item.instrumentType || '').toUpperCase();
  const marketType = String(item.marketType || '').toLowerCase();
  if (marketType.includes('spot') || marketType.includes('margin') || category === 'SPOT' || category === 'MARGIN') return 'spot';
  if (category === 'USDC-FUTURES') return 'usdc-futures';
  if (category === 'COIN-FUTURES') return 'coin-futures';
  return 'usdt-futures';
};

const getBitgetCardMarketLabel = (item: Instrument) => {
  if (item.provider !== 'BITGET') {
    return String(item.marketType || item.category).toLowerCase();
  }
  const rawType = String(item.marketType || item.instrumentType || '').trim().toLowerCase();
  const type = rawType === 'perpetuals' || rawType === 'perpetual' ? 'perpetual' : rawType;
  const group = String((item as any).marketGroup || item.category || '').trim().toLowerCase();
  if (type && group) return type + '_' + group;
  return type || group || 'market';
};

const getBitgetInstId = (item: Instrument) => {
  const base = String((item as any).base || '').trim().toUpperCase();
  const quote = String((item as any).quote || '').trim().toUpperCase();
  if (base && quote) return base + quote;
  const raw = String(item.symbol || item.displaySymbol || '').trim().toUpperCase();
  return raw
    .replace(/^BITGET[:_]/, '')
    .replace(/[^A-Z0-9]/g, '');
};

const chooseInitialDerivInstrument = (items: Instrument[]) =>
  items.find(item => item.provider === 'DERIV' && item.exchangeOpen !== 0 && item.tradingSuspended !== 1) ||
  items.find(item => item.provider === 'DERIV') || items[0] || null;

export default function App() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  // One random seed per page load keeps the mixed order stable during browsing.
  const catalogueShuffleSeedRef = useRef<number>(Math.floor(Math.random() * 0xffffffff));
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [derivLoading, setDerivLoading] = useState(true);
  const [derivError, setDerivError] = useState('');
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<'ALL' | MarketProvider>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [marketSubcategoryFilter, setMarketSubcategoryFilter] = useState<string>('ALL');
  const [quoteScrollTop, setQuoteScrollTop] = useState(0);
  const deferredSearch = useDeferredValue(search);
  const [instrumentSearchOpen, setInstrumentSearchOpen] = useState(false);
  const [instrumentSearchMode, setInstrumentSearchMode] = useState<'main' | 'multi'>('main');
  const [researchLabOpen, setResearchLabOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [chartLayout, setChartLayout] = useState<1 | 2>(1);
  const [activeChartIndex, setActiveChartIndex] = useState(0);
  const [linked, setLinked] = useState(false);
  const [multiChartOpen, setMultiChartOpen] = useState(false);
  const [multiChartInstrument, setMultiChartInstrument] = useState('');
  const [multiChartPosition, setMultiChartPosition] = useState<'up' | 'down' | 'left' | 'right'>('right');
  const [chartSymbols, setChartSymbols] = useState<string[]>([]);
  const linkGroupRef = useRef<LinkGroup | null>(null);
  const binanceQuoteCacheRef = useRef<Record<string, any>>({});
  const binanceMetadataCacheRef = useRef<Record<string, any>>({});
  const [bitgetPriorityIds, setBitgetPriorityIds] = useState<string[]>([]);
  // Bitget live quotes are kept outside the shared catalogue state. This prevents
  // its high-frequency ticks from competing with Binance's live update path.
  const [bitgetQuotes, setBitgetQuotes] = useState<Map<string, any>>(() => new Map());
  // Binance live quotes are isolated from the shared catalogue for the same reason: catalogue refreshes must never overwrite ticks.
  const [binanceQuotes, setBinanceQuotes] = useState<Map<string, any>>(() => new Map());

  useEffect(() => {
    const onBitgetPrioritySymbols = (event: Event) => {
      const detail = (event as CustomEvent).detail as { ids?: unknown } | undefined;
      const ids = Array.isArray(detail?.ids) ? detail.ids.map(value => String(value)).filter(Boolean) : [];
      setBitgetPriorityIds(ids);
    };
    window.addEventListener('sire:bitget-priority-symbols', onBitgetPrioritySymbols);
    return () => window.removeEventListener('sire:bitget-priority-symbols', onBitgetPrioritySymbols);
  }, []);

  const bitgetSubscriptionSignature = useMemo(() => (
    instruments
      .filter(item => item.provider === 'BITGET')
      .map(item => item.id + ':' + getBitgetInstType(item) + ':' + getBitgetInstId(item))
      .sort()
      .join('|') + '||priority:' + bitgetPriorityIds.join('|')
  ), [instruments]);

  useEffect(() => {    if (!instruments.some(item => item.provider === 'BITGET')) return;
    let cancelled = false;
    const refresh = async () => {
      const categories = ['SPOT', 'USDT-FUTURES', 'COIN-FUTURES', 'USDC-FUTURES'];
      const updates = new Map<string, any>();
      await Promise.all(categories.map(async category => {
        try {
          const response = await fetch('/api/sire/bitget/tickers?category=' + encodeURIComponent(category), { cache: 'no-store' });
          if (!response.ok) return;
          const payload = await response.json();
          const rows = Array.isArray(payload?.data) ? payload.data : [];
          for (const row of rows) {
            const symbol = String(row?.symbol || '').toUpperCase();
            const price = Number(row?.lastPrice ?? row?.lastPr ?? row?.last);
            if (!symbol || !Number.isFinite(price)) continue;
            const open = Number(row?.openPrice24h);
            const pct = Number(row?.price24hPcnt);
            const change = Number.isFinite(open) && open !== 0
              ? ((price - open) / open) * 100
              : (Number.isFinite(pct) ? (Math.abs(pct) <= 1 ? pct * 100 : pct) : undefined);
            updates.set(category.toLowerCase() + ':' + symbol, {
              price,
              bid: Number.isFinite(Number(row?.bid1Price)) ? Number(row.bid1Price) : undefined,
              ask: Number.isFinite(Number(row?.ask1Price)) ? Number(row.ask1Price) : undefined,
              volume24h: Number.isFinite(Number(row?.turnover24h)) ? Number(row.turnover24h) : undefined,
              change24h: Number.isFinite(change) ? change : undefined,
              priceChangePercent: Number.isFinite(change) ? change : undefined,
            });
          }
        } catch {}
      }));
      if (cancelled || !updates.size) return;
      setBitgetQuotes(current => {
        const next = new Map(current);
        updates.forEach((update, key) => next.set(key, update));
        return next;
      });
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [instruments.length]);


  useEffect(() => {
    if (!bitgetSubscriptionSignature) return;
    let cancelled = false;
    const sockets: WebSocket[] = [];
    const reconnectTimers: number[] = [];
    const pingTimers: number[] = [];
    let flushTimer: number | null = null;    const pending = new Map<string, any>();
    let reconnectAttempt = 0;

    const currentItems = () => {
      const items = instruments.filter(item => item.provider === 'BITGET');
      const priority = new Set(bitgetPriorityIds);
      return [...items].sort((a, b) => {
        const ap = priority.has(a.id) ? 0 : 1;
        const bp = priority.has(b.id) ? 0 : 1;
        return ap - bp || Number((b as any).volume24h || 0) - Number((a as any).volume24h || 0);
      });
    };

    const flush = () => {
      flushTimer = null;
      if (cancelled || !pending.size) return;
      const updates = new Map(pending);
      pending.clear();
      setBitgetQuotes(current => {
        const next = new Map(current);
        updates.forEach((update, key) => next.set(key, update));
        return next;
      });
    };

    const queueUpdate = (key: string, update: any) => {
      pending.set(key, update);
      if (flushTimer === null) flushTimer = window.setTimeout(flush, 250);
    };

    const connect = (items: Instrument[]) => {
      if (cancelled || !items.length) return;
      const socket = new WebSocket(bitgetWebSocketUrl);
      sockets.push(socket);

      socket.onopen = () => {
        reconnectAttempt = 0;
        // Bitget allows up to 1000 channel subscriptions per connection.
        // We deliberately subscribe to the complete product-family list rather
        // than silently limiting live coverage to the first 40 symbols.
        const args = items.slice(0, 1000).map(item => ({
          instType: getBitgetInstType(item),
          topic: 'ticker',
          symbol: getBitgetInstId(item),
        }));
        if (args.length) socket.send(JSON.stringify({ op: 'subscribe', args }));

        const ping = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send('ping');
        }, 25000);
        pingTimers.push(ping);
        console.info('[SIRE BITGET LIVE] ticker connection active', {
          subscriptions: args.length,
          first: args[0],
          endpoint: bitgetWebSocketUrl,
          protocol: 'Bitget UTA v3 ticker',
        });
      };

      socket.onmessage = event => {
        if (event.data === 'pong') return;
        let message: any;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message?.event === 'subscribe') return;
        if (message?.event === 'error' || (message?.code !== undefined && message?.code !== '00000')) {
          console.warn('[SIRE BITGET LIVE] subscription/message error', message);
          return;
        }
        if (!Array.isArray(message?.data) || !message?.arg) return;

        // UTA v3 identifies the ticker by arg.symbol. Keep v2 instId support
        // as a compatibility fallback so older Bitget responses cannot break
        // live prices during an endpoint transition.
        const rawInstType = String(message.arg.instType || '');
        const instType = rawInstType.toLowerCase();
        const instId = String(message.arg.symbol || message.arg.instId || '').toUpperCase();
        if (!instId) return;
        const key = instType + ':' + instId;
        const ticker = message.data[0] || {};
        const price = Number(ticker.lastPr ?? ticker.lastPrice ?? ticker.last);
        if (!Number.isFinite(price)) return;

        const open24h = Number(ticker.open24h ?? ticker.openPrice24h);
        const rawChange = Number(ticker.change24h ?? ticker.price24hPcnt);
        const change24h = Number.isFinite(open24h) && open24h !== 0
          ? ((price - open24h) / open24h) * 100
          : Number.isFinite(rawChange)
            ? (Math.abs(rawChange) <= 1 ? rawChange * 100 : rawChange)
            : undefined;

        const bid = Number(ticker.bidPr ?? ticker.bid1Price);
        const ask = Number(ticker.askPr ?? ticker.ask1Price);
        const volume = Number(ticker.baseVolume ?? ticker.volume24h ?? ticker.quoteVolume);

        queueUpdate(key, {
          price,
          bid: Number.isFinite(bid) ? bid : undefined,
          ask: Number.isFinite(ask) ? ask : undefined,
          volume24h: Number.isFinite(volume) ? volume : undefined,
          change24h: Number.isFinite(change24h) ? change24h : undefined,
          priceChangePercent: Number.isFinite(change24h) ? change24h : undefined,
        });
      };

      socket.onerror = () => {
        console.warn('[SIRE BITGET LIVE] ticker connection error');
      };

      socket.onclose = () => {
        if (cancelled) return;
        const delay = Math.min(15000, 1000 * Math.pow(2, reconnectAttempt++));
        const timer = window.setTimeout(() => connect(items), delay);
        reconnectTimers.push(timer);
      };
    };

    // Subscribe to the most liquid symbols in each Bitget product family, but
    // always put the symbols currently displayed in Home's market section first.
    // The Home filters can surface a lower-volume symbol, so volume-only ranking
    // can otherwise leave its displayed price stuck at the startup REST snapshot.
    const grouped = new Map<string, Instrument[]>();
    for (const item of currentItems()) {
      const type = getBitgetInstType(item);
      const list = grouped.get(type) || [];
      list.push(item);
      grouped.set(type, list);
    }

    for (const [type, items] of grouped) {
      const ranked = [...items].sort((a, b) => {
        const priority = new Set(bitgetPriorityIds);
        const ap = priority.has(a.id) ? 0 : 1;
        const bp = priority.has(b.id) ? 0 : 1;
        return ap - bp || Number((b as any).volume24h || 0) - Number((a as any).volume24h || 0);
      });
      // Subscribe to the complete product family. Bitget's hard limit is
      // 1000 channel subscriptions per connection, so only very large
      // families are split into 1000-symbol connections. Nothing is dropped.
      for (let offset = 0; offset < ranked.length; offset += 1000) {
        connect(ranked.slice(offset, offset + 1000));
      }
    }

    return () => {
      cancelled = true;
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      reconnectTimers.forEach(timer => window.clearTimeout(timer));
      pingTimers.forEach(timer => window.clearInterval(timer));
      sockets.forEach(socket => socket.close());      pending.clear();
    };
  }, [bitgetSubscriptionSignature]);







  const liveInstruments = useMemo(() => (
    instruments.map(item => {
      if (item.provider === 'BITGET') {
        const key = getBitgetInstType(item).toLowerCase() + ':' + getBitgetInstId(item);
        const update = bitgetQuotes.get(key);
        return update ? { ...item, ...update } : item;
      }
      if (item.provider === 'BINANCE') {
        const update = binanceQuotes.get(item.id);
        return update ? { ...item, ...update, priceChangePercent: update.change24h } : item;
      }
      return item;
    })
  ), [instruments, bitgetQuotes, binanceQuotes]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    let globalCryptoRefresh: number | null = null;
    let closeBinanceStream: (() => void) | null = null;

    const startup = async (): Promise<Instrument[]> => {
      // Keep the recreated Market tab on the same per-provider data path that
      // powered the old Market tab. This preserves each provider's full native
      // catalogue/taxonomy instead of passing everything through the unified
      // startup aggregator, which can drop slow providers before their catalogue
      // reaches the UI.
      const providers: MarketProvider[] = [
        'BINGX','BITRUE','ASCENDEX','WHITEBIT','COINW','DERIV','BINANCE',
        'COINBASE','KRAKEN','BYBIT','OKX','BITGET','GATEIO','KUCOIN','MEXC',
        'CRYPTOCOM','BITFINEX','GEMINI','BITSTAMP','COINEX','HTX','BITTREX',
        'BITMART','PHEMEX','BLANK','XT','DEEPCOIN','TOOBIT','WEEX','BITUNIX',
        'BLOFIN','COINCATCH','ZOOMEX','BTCC','DIGIFINEX','COINSTORE','PROBIT',
        'POLONIEX','COINDCX','POLYMARKET','KALSHI','OPINION','UNISWAP','CURVE',
        'PANCAKESWAP','SUSHISWAP','RAYDIUM','JUPITER','ORCA','AERODROME',
        'TRADERJOE','ONEINCH','COWSWAP','BALANCER',
      ];
      const fetchProvider = async (provider: MarketProvider) => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 60000);
        try {
          const response = await fetch('/api/sire/markets/provider/' + encodeURIComponent(provider), {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
            signal: controller.signal,
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.ok || !Array.isArray(payload?.instruments)) {
            throw new Error(payload?.error || ('Provider ' + provider + ' unavailable.'));
          }
          return payload.instruments as Instrument[];
        } finally {
          window.clearTimeout(timer);
        }
      };

      const settled = await Promise.allSettled(providers.map(fetchProvider));
      const all: Instrument[] = [];
      const seen = new Set<string>();
      settled.forEach((result, index) => {
        const provider = providers[index];
        if (result.status === 'rejected') {
          console.warn('[SIRE MARKET STARTUP] provider failed:', provider, result.reason);
          return;
        }
        for (const item of result.value) {
          if (!item?.id || seen.has(item.id)) continue;
          seen.add(item.id);
          all.push(item);
        }
        console.info('[SIRE MARKET STARTUP] provider loaded', {
          provider,
          count: result.value.length,
        });
      });
      if (!all.length) throw new Error('Market providers returned no instruments.');
      console.info('[SIRE MARKET STARTUP] per-provider catalogue published', {
        total: all.length,
        providers: Array.from(new Set(all.map(item => item.provider))),
      });
      if (!cancelled) setInstruments(all);
      return all;
    };

    // Binance live data starts immediately, but quotes are cached so a catalogue
    // that arrives a moment later still receives the latest snapshot.
    void (async () => {
      try {
        let pendingQuotes: Record<string, any> = {};
        let flushTimer: number | null = null;
        const applyQuotes = (quotes: Record<string, any>) => {
          if (cancelled) return;          Object.assign(pendingQuotes, quotes);
          if (flushTimer !== null) return;
          flushTimer = window.setTimeout(() => {
            flushTimer = null;
            if (cancelled) return;
            const batch = pendingQuotes;
            pendingQuotes = {};
            Object.assign(binanceQuoteCacheRef.current, batch);
            setBinanceQuotes(current => {
              const next = new Map(current);
              Object.entries(batch).forEach(([id, quote]) => next.set(id, quote));
              return next;
            });
          }, 1000);
        };
        const initialQuotes = await fetchBinanceLiveQuotes();
        applyQuotes(initialQuotes);
        closeBinanceStream = createBinanceCatalogueLiveFeed(applyQuotes);
        // REST refresh is an isolated Binance fallback/verification path. It keeps Home live even if a browser WebSocket is blocked.
        const binanceRestTimer = window.setInterval(() => {
          void fetchBinanceLiveQuotes().then(quotes => applyQuotes(quotes));
        }, 2000);
        const previousCloseBinanceStream = closeBinanceStream;
        closeBinanceStream = () => {
          window.clearInterval(binanceRestTimer);
          previousCloseBinanceStream?.();
        };
        void fetchBinanceMarketMetadata().then(metadata => {
          if (cancelled) return;
          Object.assign(binanceMetadataCacheRef.current, metadata);
          setInstruments(current => current.map(item => {
            if (item.provider !== 'BINANCE') return item;
            const meta = metadata[String(item.base || '').toUpperCase()];
            if (!meta) return item;
            const supply = Number(meta.circulatingSupply);
            const marketCap = Number.isFinite(supply) && Number.isFinite(Number(item.price))
              ? supply * Number(item.price)
              : meta.marketCap;
            return {
              ...item,
              circulatingSupply: Number.isFinite(supply) ? supply : item.circulatingSupply,
              marketCap: Number.isFinite(Number(marketCap)) ? Number(marketCap) : item.marketCap,
              listedAt: ['Spot', 'Margin'].includes(String(item.marketType)) && Number.isFinite(Number(meta.listedAt)) ? Number(meta.listedAt) : item.listedAt,
              onboardDate: ['Spot', 'Margin'].includes(String(item.marketType)) && Number.isFinite(Number(meta.listedAt)) ? Number(meta.listedAt) : item.onboardDate,
              newListing: ['Spot', 'Margin'].includes(String(item.marketType)) && meta.newListing === true ? true : item.newListing,
            };
          }));
        }).catch(error => console.warn('[SIRE BINANCE] market metadata failed:', error));
      } catch (error) {
        console.warn('[SIRE BINANCE LIVE] stream startup failed:', error);
      }
    })();


    void (async () => {
      try {
        console.info('[SIRE BINANCE BROWSER] INDEPENDENT START');

        // Hosted catalogue is generated by GitHub Actions from Binance's official
        // exchangeInfo endpoints. This is the authoritative fallback when Render
        // or the user's region receives HTTP 451 from Binance derivatives APIs.
        try {
          const hostedResponse = await fetch('/binance-catalogue.json?ts=' + Date.now(), { cache: 'no-store' });
          if (hostedResponse.ok) {
            const hosted = await hostedResponse.json();
            const hostedItems = [
              ...(Array.isArray(hosted?.spot) ? hosted.spot : []),
              ...(Array.isArray(hosted?.margin) ? hosted.margin : []),
              ...(Array.isArray(hosted?.derivatives) ? hosted.derivatives : []),
            ];
            const hostedMetadata = hosted?.metadata && typeof hosted.metadata === 'object' ? hosted.metadata : {};
            Object.assign(binanceMetadataCacheRef.current, hostedMetadata);
            if (hostedItems.length && !cancelled) {
              setInstruments(current => {
                const incoming = new Map(hostedItems.map((item:any) => [item.id, item]));
                const mergedCurrent = current.map(item => {
                  const incomingItem = incoming.get(item.id);
                  if (!incomingItem) return item;
                  incoming.delete(item.id);
                  const meta = hostedMetadata[String(incomingItem.base || '').toUpperCase()];
                  return {
                    ...item,
                    ...incomingItem,
                    price: item.price ?? incomingItem.price,
                    ...(['Spot', 'Margin'].includes(String(item.marketType)) && Number.isFinite(Number(meta?.listedAt)) ? { listedAt: Number(meta.listedAt), onboardDate: Number(meta.listedAt) } : {}),
                    ...(['Spot', 'Margin'].includes(String(item.marketType)) && meta?.newListing === true ? { newListing: true } : {}),
                  };
                });
                const additions = Array.from(incoming.values()).map((item:any) => {
                  const quote = binanceQuoteCacheRef.current[item.id];
                  const meta = hostedMetadata[String(item.base || '').toUpperCase()];
                  return {
                    ...item,
                    ...(quote || {}),
                    ...(quote ? { priceChangePercent: quote.change24h } : {}),
                    ...(['Spot', 'Margin'].includes(String(item.marketType)) && Number.isFinite(Number(meta?.listedAt)) ? { listedAt: Number(meta.listedAt), onboardDate: Number(meta.listedAt) } : {}),
                    ...(['Spot', 'Margin'].includes(String(item.marketType)) && meta?.newListing === true ? { newListing: true } : {}),
                  };
                });
                console.info('[SIRE BINANCE HOSTED CATALOGUE] publishing', {
                  generatedAt: hosted?.generatedAt,
                  spot: hostedItems.filter((x:any) => x.marketType === 'Spot').length,
                  margin: hostedItems.filter((x:any) => x.marketType === 'Margin').length,
                  derivatives: hostedItems.filter((x:any) => x.marketType === 'Futures' || x.marketType === 'Perpetuals').length,
                  added: additions.length,
                });
                return mergedCurrent.concat(additions);
              });
            }
          }
        } catch (error) {
          console.warn('[SIRE BINANCE HOSTED CATALOGUE] failed:', error);
        }

        await fetch('/api/sire/binance/browser-diagnostic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'browser-start', total: 0, counts: {}, failures: {}, reportedAt: Date.now() }),
          keepalive: true,
        });
        const browserItems = await fetchBinanceBrowserCatalogue();        // Render can receive HTTP 451 from Binance's derivatives REST endpoints.
        // The live miniTicker streams still expose every actively trading contract,
        // so materialize those real symbols into the catalogue when exchangeInfo is blocked.
        const liveFallbackItems: any[] = [];
        for (const [id, quote] of Object.entries(binanceQuoteCacheRef.current)) {
          const match = id.match(/^(BINANCE(?::COIN-M)?):(Perpetuals|Futures):(.+)$/);
          if (!match) continue;
          const [, prefix, marketType, symbol] = match;
          const base = symbol.includes('_')
            ? symbol.split('_')[0]
            : symbol.replace(/USDT$|USDC$|BUSD$|USD$/i, '');
          const quoteAsset = symbol.includes('_')
            ? symbol.split('_')[1]
            : (symbol.match(/(USDT|USDC|BUSD|USD)$/i)?.[1] || 'USDT').toUpperCase();
          liveFallbackItems.push({
            id,
            provider: 'BINANCE',
            providerLabel: 'Binance',
            exchange: 'BINANCE',
            marketType,
            category: 'Crypto',
            symbol,
            displaySymbol: symbol,
            name: base && quoteAsset ? base + ' / ' + quoteAsset : symbol,
            base,
            quote: quoteAsset,
            exchangeOpen: 1,
            status: 'online',
            price: (quote as any)?.price,
            change24h: (quote as any)?.change24h,
            priceChangePercent: (quote as any)?.change24h,
            volume24h: (quote as any)?.volume24h,
            tradeCount24h: (quote as any)?.tradeCount24h,
            logoUrl: 'https://cdn.jsdelivr.net/gh/vadimmalykhin/binance-icons/crypto/' + encodeURIComponent(String(base).toLowerCase()) + '.svg',
            providerLogoUrl: 'https://www.binance.com/favicon.ico',
            instrumentType: marketType,
            contractType: marketType === 'Perpetuals' ? 'PERPETUAL' : 'FUTURE',
          });
        }
        const catalogueWithLiveDerivatives = browserItems.concat(liveFallbackItems.filter(item =>
          !browserItems.some(existing => existing.id === item.id)
        ));
        if (!cancelled && catalogueWithLiveDerivatives.length) {
          if (liveFallbackItems.length) {
            console.info('[SIRE BINANCE BROWSER] live derivatives fallback', { count: liveFallbackItems.length });
          }
          const binanceItems = catalogueWithLiveDerivatives;
          setInstruments(current => {
            const incoming = new Map(browserItems.map((item:any) => [item.id, item]));
            const mergedCurrent = current.map(item => {
              const incomingItem = incoming.get(item.id);
              if (!incomingItem) return item;
              incoming.delete(item.id);
              return { ...item, ...incomingItem, price: item.price ?? incomingItem.price };
            });
            const additions = Array.from(incoming.values()).map((item:any) => {
              const quote = binanceQuoteCacheRef.current[item.id];
              const meta = binanceMetadataCacheRef.current[String(item.base || '').toUpperCase()];
              const supply = Number(meta?.circulatingSupply);
              const marketCap = Number.isFinite(supply) && Number.isFinite(Number(quote?.price)) ? supply * Number(quote.price) : meta?.marketCap;
              return {
                ...item,
                ...(quote || {}),
                ...(quote ? { priceChangePercent: quote.change24h } : {}),
                ...(Number.isFinite(supply) ? { circulatingSupply: supply } : {}),
                ...(Number.isFinite(Number(marketCap)) ? { marketCap: Number(marketCap) } : {}),
                ...(['Spot', 'Margin'].includes(String(item.marketType)) && Number.isFinite(Number(meta?.listedAt)) ? { listedAt: Number(meta.listedAt), onboardDate: Number(meta.listedAt) } : {}),
                ...(['Spot', 'Margin'].includes(String(item.marketType)) && meta?.newListing === true ? { newListing: true } : {}),
              } as Instrument;
            });
            console.info('[SIRE BINANCE BROWSER] publishing instruments to SIRE', {received:browserItems.length,added:additions.length});
            return mergedCurrent.concat(additions);
          });
        }
      } catch (error) {
        console.warn('[SIRE BINANCE BROWSER] independent discovery failed:', error);
      }
    })();

    startup().then(async items => {
      if (cancelled) return;
      // The server catalogue already contains the required startup data (including
      // Deriv). Publish it immediately so optional third-party browser augmentation
      // can never block the entire SIRE interface.
      const initial = chooseInitialDerivInstrument(items);
      if (!initial) throw new Error('SIRE returned an empty active instrument catalogue.');
      const hasDeriv = items.some(item => item.provider === 'DERIV');
      setDerivError(hasDeriv ? '' : 'Deriv market data is temporarily unavailable; other market providers remain available.');
      setDerivLoading(false);
      setInstruments(current => {
        const existing = new Set(current.map(item => item.id));
        const additions = items.filter(item => !existing.has(item.id));
        const merged = additions.length ? current.concat(additions.map((item: any) => {
          if (item.provider !== 'BINANCE') return item;
          const quote = binanceQuoteCacheRef.current[item.id];
          const meta = binanceMetadataCacheRef.current[String(item.base || '').toUpperCase()];
          const supply = Number(meta?.circulatingSupply);
          const marketCap = Number.isFinite(supply) && Number.isFinite(Number(quote?.price)) ? supply * Number(quote.price) : meta?.marketCap;
          return {
            ...item,
            ...(quote || {}),
            ...(quote ? { priceChangePercent: quote.change24h } : {}),
            ...(Number.isFinite(supply) ? { circulatingSupply: supply } : {}),
            ...(Number.isFinite(Number(marketCap)) ? { marketCap: Number(marketCap) } : {}),
            ...(['Spot', 'Margin'].includes(String(item.marketType)) && Number.isFinite(Number(meta?.listedAt)) ? { listedAt: Number(meta.listedAt), onboardDate: Number(meta.listedAt) } : {}),
            ...(['Spot', 'Margin'].includes(String(item.marketType)) && meta?.newListing === true ? { newListing: true } : {}),
          };
        })) : current;
        console.info('[SIRE MARKET STARTUP] publishing unified catalogue', {
          received: items.length,
          added: additions.length,
          total: merged.length,
          binance: merged.filter(item => item.provider === 'BINANCE').length,
        });
        return merged;
      });
      setSelected(current => current && (
        items.some(item => item.id === current.id) ||
        current.provider === 'BINANCE'
      ) ? current : initial);
      setChartSymbols(current => current.length ? current : [initial.symbol]);
      try {
        const response = await fetch('/api/sire/markets/global-crypto', { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !Array.isArray(payload?.instruments)) throw new Error(payload?.error || 'Global crypto catalogue unavailable');
        const globalItems = payload.instruments.map((raw: any) => ({
          ...raw,
          provider: 'GLOBALCRYPTO',
          exchange: raw.exchange,
          providerLabel: raw.exchangeName || raw.exchange,          marketType: raw.type || 'Crypto',
          category: 'Crypto',
          displaySymbol: raw.symbol,
          name: raw.symbol,
          exchangeOpen: 1,
          status: 'online',
          logoUrl: raw.base ? makeAssetLogoFallback({ ...raw, base: raw.base, displaySymbol: raw.symbol } as Instrument) : '',
          providerLogoUrl: makeProviderLogoFallback({ ...raw, provider: 'GLOBALCRYPTO' } as Instrument),
          instrumentType: raw.type || 'crypto',
        })) as Instrument[];
        if (cancelled) return;
        setInstruments(current => {
          const existing = new Set(current.map(item => item.id));
          const additions = globalItems.filter(item => !existing.has(item.id));
          return additions.length ? current.concat(additions) : current;
        });
        console.info('[SIRE MARKET STARTUP] Global CCXT crypto universe loaded', { total: globalItems.length });
      } catch (error) {
        console.warn('[SIRE MARKET STARTUP] Global CCXT crypto universe unavailable:', error);
      }

      // CCXT expands the global universe in the backend after the fast first response.
      // Keep polling so newly loaded exchanges/market types appear without requiring a reload.
      globalCryptoRefresh = window.setInterval(async () => {
        try {
          const response = await fetch('/api/sire/markets/global-crypto', { cache: 'no-store' });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.ok || !Array.isArray(payload?.instruments) || cancelled) return;
          const refreshedItems = payload.instruments.map((raw: any) => ({
            ...raw, provider: 'GLOBALCRYPTO', exchange: raw.exchange, providerLabel: raw.exchangeName || raw.exchange,
            marketType: raw.type || 'Crypto', category: 'Crypto', displaySymbol: raw.symbol, name: raw.symbol,
            exchangeOpen: 1, status: 'online',
            logoUrl: raw.base ? makeAssetLogoFallback({ ...raw, base: raw.base, displaySymbol: raw.symbol } as Instrument) : '',
            providerLogoUrl: makeProviderLogoFallback({ ...raw, provider: 'GLOBALCRYPTO' } as Instrument),
            instrumentType: raw.type || 'crypto',
          })) as Instrument[];
          setInstruments(current => {
            const existing = new Set(current.map(item => item.id));
            const additions = refreshedItems.filter(item => !existing.has(item.id));
            return additions.length ? current.concat(additions) : current;
          });
        } catch (error) {
          console.warn('[SIRE MARKET STARTUP] Global CCXT catalogue refresh failed:', error);
        }
      }, 3000);

    }).catch(error => {
      if (cancelled || error?.message === 'SIRE startup cancelled.') return;
      console.error('[DERIV MARKET DATA] active symbol discovery failed', error);
      setDerivLoading(false);
      setDerivError(error instanceof Error ? error.message : 'Deriv market catalogue failed to load.');
      setInstruments(current => {
        const preserved = current;
        console.info('[SIRE MARKET STARTUP] preserving already-loaded standalone provider catalogues after startup failure', {
          total: preserved.length,
        });
        return preserved;
      });
      setSelected(current => current?.provider === 'BINANCE' ? current : null);
      setChartSymbols(current => current.length ? current : []);
    });

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (globalCryptoRefresh !== null) window.clearInterval(globalCryptoRefresh);
      if (closeBinanceStream) closeBinanceStream();
    };
  }, []);
  useEffect(() => {
    if (!instruments.length) return;
    setChartSymbols(current => Array.from(
      { length: chartLayout },
      (_, index) => current[index] || (index === 0
        ? (selected?.provider === 'DERIV' ? selected.symbol : (chooseInitialDerivInstrument(instruments)?.symbol || chartableInstruments[0]?.symbol || instruments[0].symbol))
        : chartableInstruments[index % Math.max(1, chartableInstruments.length)]?.symbol || ''),
    ));
  }, [chartLayout, selected?.symbol]);

  useEffect(() => {
    setActiveChartIndex(current => Math.min(current, chartLayout - 1));
  }, [chartLayout]);

  useEffect(() => {
    linkGroupRef.current?.destroy();
    linkGroupRef.current = linked
      ? createLinkGroup({ crosshair: true, viewport: true, symbol: true })
      : null;
  }, [linked]);

  useEffect(() => () => { linkGroupRef.current?.destroy(); linkGroupRef.current = null; }, []);

  useEffect(() => {
    const openHome = () => setHomeOpen(true);
    const closeHome = () => setHomeOpen(false);
    window.addEventListener('sire:open-home', openHome);
    window.addEventListener('sire:close-home', closeHome);
    return () => {
      window.removeEventListener('sire:open-home', openHome);
      window.removeEventListener('sire:close-home', closeHome);
    };
  }, []);

  useEffect(() => {
    const openMarket = () => { setMarketOpen(true); setHomeOpen(false); };
    const closeMarket = () => setMarketOpen(false);
    window.addEventListener('sire:open-market', openMarket);
    window.addEventListener('sire:close-market', closeMarket);
    return () => {
      window.removeEventListener('sire:open-market', openMarket);
      window.removeEventListener('sire:close-market', closeMarket);
    };
  }, []);

  useEffect(() => {
    const openMultiChart = () => setMultiChartOpen(true);
    window.addEventListener('sire:open-multichart', openMultiChart);
    return () => window.removeEventListener('sire:open-multichart', openMultiChart);
  }, []);

  useEffect(() => {
    const open = () => setResearchLabOpen(true);
    window.addEventListener('sire:open-research', open);
    return () => window.removeEventListener('sire:open-research', open);
  }, []);

  useEffect(() => {
    const onAgentChartAction = (event: Event) => {
      const detail = (event as CustomEvent).detail as Record<string, unknown> | undefined;
      if (!detail) return;
      const action = String(detail.__sireAction || detail.type || '');
      if (action === 'set_multi_chart') {
        const requestedLayout = Number(detail.layout ?? detail.count ?? 1);
        const layout = requestedLayout >= 2 ? 2 : 1;
        const requestedSymbols = Array.isArray(detail.symbols) ? detail.symbols.map(value => String(value)).filter(Boolean) : [];
        setChartLayout(layout as 1 | 2);
        if (requestedSymbols.length) setChartSymbols(current => layout === 2
          ? [requestedSymbols[0] || current[0] || selected?.symbol || instruments[0]?.symbol || '', requestedSymbols[1] || current[1] || instruments[1]?.symbol || '']
          : [requestedSymbols[0] || current[0] || selected?.symbol || instruments[0]?.symbol || '']);
        if (detail.position === 'up' || detail.position === 'down' || detail.position === 'left' || detail.position === 'right') {
          setMultiChartPosition(detail.position);
        }
      } else if (action === 'set_chart_linking') {
        setLinked(Boolean(detail.enabled));
      }
    };
    window.addEventListener('sire:agent-chart-action', onAgentChartAction);
    return () => window.removeEventListener('sire:agent-chart-action', onAgentChartAction);
  }, [instruments, selected?.symbol]);

  const randomizedInstruments = useMemo(() => {
    const seed = catalogueShuffleSeedRef.current >>> 0;
    const score = (id: string) => {
      let hash = (seed ^ 0x9e3779b9) >>> 0;
      for (let i = 0; i < id.length; i += 1) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 0x85ebca6b) >>> 0;
        hash ^= hash >>> 13;
      }
      hash = Math.imul(hash ^ (hash >>> 16), 0xc2b2ae35) >>> 0;
      return (hash ^ (hash >>> 16)) >>> 0;
    };
    return instruments
      .map((item, index) => ({ item, index, randomScore: score(item.id || (item.provider + ':' + item.symbol + ':' + index)) }))
      .sort((a, b) => a.randomScore - b.randomScore || a.index - b.index)
      .map(entry => entry.item);
  }, [liveInstruments]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return randomizedInstruments.filter(item => {
      const providerMatch = providerFilter === 'ALL' || item.provider === providerFilter;
      const marketType = String(item.marketType || '').trim().toLowerCase();
      const isBinance = providerFilter === 'BINANCE' && item.provider === 'BINANCE';
      const selectedTaxonomy = String(marketSubcategoryFilter || 'ALL');
      const itemSubcategory = String((item as any).marketSubcategory || '');
      const itemFilter = String((item as any).marketFilter || 'ALL');
      const itemFilters = Array.isArray((item as any).marketFilters) ? (item as any).marketFilters.map((value: unknown) => String(value)) : [];
      const taxonomyMatches = itemFilters.length
        ? itemFilters.some(value =>
            value === selectedTaxonomy ||
            value === selectedTaxonomy.replace(/^Futures:/, '') ||
            value.endsWith(':' + selectedTaxonomy) ||
            selectedTaxonomy.startsWith(value + ':')
          )
        : selectedTaxonomy === itemFilter || selectedTaxonomy === itemFilter.split(':')[0];
      const subcategoryMatch = selectedTaxonomy === 'ALL'
        || selectedTaxonomy === itemSubcategory
        || selectedTaxonomy === itemFilter
        || selectedTaxonomy === itemFilter.split(':')[0]
        || taxonomyMatches;
      const categoryMatch = categoryFilter === 'ALL'
        || item.category === categoryFilter
        || (categoryFilter === 'Options' && marketType.includes('option'))
        || (categoryFilter === 'Futures' && marketType === 'futures')
        || (categoryFilter === 'Perpetuals' && marketType === 'perpetuals')
        || (categoryFilter === 'Crypto' && item.category === 'Crypto' && (
          providerFilter === 'GATEIO'
            ? true
            : !marketType.includes('future') && !marketType.includes('option') && !marketType.includes('perpetual') && !marketType.includes('swap')
        ));
      const searchMatch = !q || `${item.name} ${item.symbol} ${item.providerLabel} ${item.marketType} ${item.category}`.toLowerCase().includes(q);
      return providerMatch && categoryMatch && subcategoryMatch && searchMatch;
    });
  }, [randomizedInstruments, search, providerFilter, categoryFilter, marketSubcategoryFilter]);

  const chartableInstruments = useMemo(() => liveInstruments.filter(item => ['DERIV','FXCM','GLOBALCRYPTO','YFINANCE','SP','NASDAQTRADER','NYSEAMERICAN','CME','CBOT','NYMEX','COMEX','OANDA','TWELVEDATA'].includes(String(item.provider))), [instruments]);
  const quoteWindow = useMemo(() => {
    const rowHeight = 88;
    const buffer = 18;
    const start = Math.max(0, Math.floor(quoteScrollTop / rowHeight) - buffer);
    const end = Math.min(filtered.length, Math.ceil((quoteScrollTop + window.innerHeight) / rowHeight) + buffer);
    return { start, end, items: filtered.slice(start, end), top: start * rowHeight, bottom: Math.max(0, (filtered.length - end) * rowHeight) };
  }, [filtered, quoteScrollTop]);

  const selectInstrument = (item: Instrument) => {
    setSelected(item);
    setSearch('');
    if (chartableInstruments.some(candidate => candidate.id === item.id)) {
      setChartSymbols(current => current.length
        ? current.map((value, index) => index === 0 ? item.symbol : value)
        : [item.symbol]);
    }
  };

  const openInstrumentPicker = (mode: 'main' | 'multi') => {
    setInstrumentSearchMode(mode);
    setSearch('');
    setProviderFilter('ALL');
    setInstrumentSearchOpen(true);
  };

  if (derivLoading) {
    return <SireErrorScreen
      source="SIRE startup"
      message="Loading the active market catalogue. The interface will remain usable if an individual provider is unavailable."
    />;
  }

  if (!instruments.length || !selected) {
    return <SireErrorScreen
      source="SIRE startup validation"
      message={derivError || "No market provider returned a usable instrument catalogue yet. Retrying startup."}
    />;
  }

  const chartItems = chartSymbols.slice(0, chartLayout);
  const openMultiChartManager = () => {
    setMultiChartInstrument(chartSymbols[1] || chartableInstruments[1]?.symbol || chartableInstruments[0]?.symbol || '');
    setMultiChartOpen(true);  };
  const confirmMultiChart = () => {
    if (!multiChartInstrument) return;
    setChartSymbols(current => [current[0] || selected?.symbol || chartableInstruments[0]?.symbol || multiChartInstrument, multiChartInstrument]);
    setChartLayout(2);
    setMultiChartOpen(false);
  };
  const removeSelectedChart = () => {
    if (chartLayout !== 2) return;
    const selectedIndex = Math.min(activeChartIndex, 1);
    const remainingSymbol = chartSymbols[selectedIndex === 0 ? 1 : 0] || selected?.symbol || chartableInstruments[0]?.symbol || '';
    setChartSymbols([remainingSymbol]);
    setChartLayout(1);
    setActiveChartIndex(0);
    setSelected(chartableInstruments.find(item => item.symbol === remainingSymbol) || selected);
    setMultiChartOpen(false);
  };
  const makeSecondMainChart = () => {
    if (!chartSymbols[1]) return;    setChartSymbols(current => [current[1], current[0] || current[1]]);
    setActiveChartIndex(0);
    setSelected(chartableInstruments.find(item => item.symbol === chartSymbols[1]) || selected);
    setMultiChartOpen(false);
  };
  if (homeOpen) {
    return <HomeView instruments={liveInstruments} onSelectInstrument={item => { const match = liveInstruments.find(candidate => candidate.id === item.id); if (match) selectInstrument(match); }} />;
  }

  if (marketOpen) {
    return <main className="sire-market-root"><MarketTab instruments={liveInstruments} onSelectInstrument={item => {
      const match = liveInstruments.find(candidate => candidate.id === item.id);
      if (match) {
        selectInstrument(match);
        window.dispatchEvent(new CustomEvent('sire:navigate', { detail: { tab: 'trade' } }));
      }
    }} /></main>;
  }

  return <main className={`native-terminal-shell${researchLabOpen ? ' sire-research-open' : ''}`}>

    <div className="native-terminal-body">
      <aside className="native-symbol-sidebar symbol-sidebar"><div className="sidebar-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" /></div><div className="sidebar-meta"><span>{derivLoading ? "LOADING MARKETS" : derivError ? "MARKET ERROR" : "ALL MARKETS"}</span><b>{instruments.length}</b></div>
        <div className="sire-market-providers">
          {(['ALL','BINGX','BITRUE','ASCENDEX','WHITEBIT','COINW','DERIV','BINANCE','COINBASE','KRAKEN','BYBIT','OKX','BITGET','GATEIO','KUCOIN','MEXC','CRYPTOCOM','BITFINEX','GEMINI','BITSTAMP','COINEX','HTX','BITTREX','PHEMEX','LBANK','XT','DEEPCOIN','TOOBIT','WEEX','BITUNIX','BLOFIN','COINCATCH','ZOOMEX','BTCC','DIGIFINEX','COINSTORE','PROBIT','POLONIEX','COINDCX','POLYMARKET','KALSHI','OPINION','FXCM','TWELVEDATA','NASDAQTRADER','XETR','XFRA','EUREX','ASX','TWSE','PSX','IDX','HKEX','BSE','TSE','NSE','BITSTAMP','OANDA','FOREXCOM','INTERACTIVEBROKERS','TRADESTATION','WEBULL','MOOMOO','NINJATRADER','TRADOVATE','AMPFUTURES','TASTYTRADE','TASTYFX','ALPACA','TRADIERBROKERAGE','TRADEZERO','COBRATRADING','CLEARSTREET','INVESTRADE','PUBLIC','PLUS500US','OPTIMUSFUTURES','EDGECLEAR','IRONBEAM','STONEX','DORMANTRADING','TRADIERFUTURES','TRADINGVIEW','UNISWAP','CURVE','PANCAKESWAP','SUSHISWAP','RAYDIUM','JUPITER','ORCA','AERODROME','TRADERJOE','ONEINCH','COWSWAP','BALANCER'] as const).map(provider => (
            <button key={provider} type="button" className={providerFilter === provider ? 'active' : ''} onClick={() => setProviderFilter(provider)}>{provider === 'ALL' ? 'All' : provider[0] + provider.slice(1).toLowerCase()}</button>
          ))}
        </div><div className="sire-market-providers sire-market-categories">
          {(providerFilter === 'BINANCE'
            ? (['ALL','Crypto','TradFi','Alpha'] as const)
            : providerFilter === 'GATEIO'
              ? (['ALL','Crypto','TradFi'] as const)
              : (['ALL','Forex','Stocks','Funds','Commodities','Indices','Bonds','Options','Futures','Perpetuals','Crypto','Onchain','Prediction Markets','Synthetic Indices','Baskets'] as const)
          ).map(category => (
            <button key={category} type="button" className={categoryFilter === category ? 'active' : ''} onClick={() => { setCategoryFilter(category); setMarketSubcategoryFilter('ALL'); }}>{category}</button>
          ))}
          {providerFilter === 'GATEIO' && categoryFilter === 'Crypto' && <div className="sire-market-providers sire-market-subcategories">
            {(['ALL','Spot','Margin','Futures','Options'] as const).map(subcategory => {
              const value = subcategory === 'ALL' ? 'ALL' : subcategory;
              return <button key={subcategory} type="button" className={marketSubcategoryFilter === value ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(value)}>{subcategory}</button>;
            })}
            {marketSubcategoryFilter === 'Spot' && <div className="sire-market-providers sire-market-subcategories">
              {(['ALL','USDT','USDC','USD','BTC','ETH','GT','FIAT','ALTs'] as const).map(filter => {
                const value = filter === 'ALL' ? 'Spot' : 'Spot:' + filter;
                return <button key={filter} type="button" className={marketSubcategoryFilter === value ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(value)}>{filter}</button>;
              })}
            </div>}
            {marketSubcategoryFilter === 'Margin' && <div className="sire-market-providers sire-market-subcategories">
              {(['ALL','USDT','USDC','USD','BTC','ETH','FIAT','ALTs'] as const).map(filter => {
                const value = filter === 'ALL' ? 'Margin' : 'Margin:' + filter;
                return <button key={filter} type="button" className={marketSubcategoryFilter === value ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(value)}>{filter}</button>;
              })}
            </div>}
            {marketSubcategoryFilter === 'Futures' && <div className="sire-market-providers sire-market-subcategories">
              {(['ALL','Perpetuals','Delivery'] as const).map(filter => {
                const value = filter === 'ALL' ? 'Futures' : 'Futures:' + filter;
                return <button key={filter} type="button" className={marketSubcategoryFilter === value ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(value)}>{filter}</button>;
              })}
            </div>}
            {marketSubcategoryFilter === 'Perpetuals' && <div className="sire-market-providers sire-market-subcategories">
              {(['ALL','USDT','USD1','BTC'] as const).map(filter => {
                const value = filter === 'ALL' ? 'Perpetuals' : 'Perpetuals:' + filter;
                return <button key={filter} type="button" className={marketSubcategoryFilter === value ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(value)}>{filter}</button>;
              })}
            </div>}
            {marketSubcategoryFilter === 'Delivery' && <div className="sire-market-providers sire-market-subcategories">
              {(['ALL','USDT'] as const).map(filter => {
                const value = filter === 'ALL' ? 'Futures:Delivery' : 'Futures:Delivery:' + filter;
                return <button key={filter} type="button" className={marketSubcategoryFilter === value ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(value)}>{filter}</button>;
              })}
            </div>}
            {marketSubcategoryFilter === 'Options' && <div className="sire-market-providers sire-market-subcategories">
              {(['ALL','Calls','Puts'] as const).map(filter => {
                const value = filter === 'ALL' ? 'Options' : 'Options:' + filter;
                return <button key={filter} type="button" className={marketSubcategoryFilter === value ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(value)}>{filter}</button>;
              })}
            </div>}
          </div>}
          {providerFilter === 'GATEIO' && categoryFilter === 'TradFi' && <div className="sire-market-providers sire-market-subcategories">
            {(['Stocks','CFD'] as const).map(subcategory => (
              <button key={subcategory} type="button" className={marketSubcategoryFilter === subcategory ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(subcategory)}>{subcategory}</button>
            ))}
            {marketSubcategoryFilter === 'Stocks' && <div className="sire-market-providers sire-market-subcategories">
              {(['ALL','U.S. stock','ETFs','ADR','ETV','Preferred','ETS','ETN','Funds','US','HK','KR','JP'] as const).map(filter => {
                const value = filter === 'ALL' ? 'Stocks' : 'Stocks:' + filter;
                return <button key={filter} type="button" className={marketSubcategoryFilter === value ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(value)}>{filter}</button>;
              })}
            </div>}
            {marketSubcategoryFilter === 'CFD' && <div className="sire-market-providers sire-market-subcategories">
              {(['ALL','Stocks','Forex','Commodities','Metals','Indices'] as const).map(filter => {
                const value = filter === 'ALL' ? 'CFD' : 'CFD:' + filter;
                return <button key={filter} type="button" className={marketSubcategoryFilter === value ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(value)}>{filter}</button>;
              })}
            </div>}
          </div>}
          {providerFilter === 'BINANCE' && categoryFilter === 'Alpha' && <div className="sire-market-providers sire-market-subcategories">
            {(['ALL','Point+','Tokenized Securities','BSC','Robinhood','Ethereum','Solana','Base','Arbitrum','Sonic','Sui','TRON'] as const).map(filter => {
              const value = filter === 'ALL' ? 'ALL' : 'Alpha:' + filter;
              return <button key={filter} type="button" className={marketSubcategoryFilter === value ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(value)}>{filter}</button>;
            })}
          </div>}
          {providerFilter === 'BINANCE' && categoryFilter === 'TradFi' && <div className="sire-market-providers sire-market-subcategories">
            {(['Stocks','Futures','Spot'] as const).map(subcategory => (
              <button key={subcategory} type="button" className={marketSubcategoryFilter === subcategory ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(subcategory)}>{subcategory}</button>
            ))}
            {marketSubcategoryFilter === 'Stocks' && <div className="sire-market-providers sire-market-subcategories">
              {(['U.S. stock','ETFs'] as const).map(filter => <button key={filter} type="button" className={marketSubcategoryFilter === 'Stocks:' + filter ? 'active' : ''} onClick={() => setMarketSubcategoryFilter('Stocks:' + filter)}>{filter}</button>)}
            </div>}
            {marketSubcategoryFilter === 'Futures' && <div className="sire-market-providers sire-market-subcategories">
              {(['Commodities','ETFs','Stocks','FX','Pre-IPO'] as const).map(filter => <button key={filter} type="button" className={marketSubcategoryFilter === 'Futures:' + filter ? 'active' : ''} onClick={() => setMarketSubcategoryFilter('Futures:' + filter)}>{filter}</button>)}
            </div>}
            {marketSubcategoryFilter === 'Spot' && <div className="sire-market-providers sire-market-subcategories">
              {(['Stocks','Commodities'] as const).map(filter => <button key={filter} type="button" className={marketSubcategoryFilter === 'Spot:' + filter ? 'active' : ''} onClick={() => setMarketSubcategoryFilter('Spot:' + filter)}>{filter}</button>)}
            </div>}
          </div>}
          {providerFilter === 'BINANCE' && categoryFilter === 'Crypto' && <div className="sire-market-providers sire-market-subcategories">
            {(['ALL','Spot','Futures','Margin'] as const).map(subcategory => (
              <button key={subcategory} type="button" className={marketSubcategoryFilter === subcategory ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(subcategory)}>{subcategory}</button>
            ))}
            {marketSubcategoryFilter === 'Spot' && <div className="sire-market-providers sire-market-subcategories">
              {(['ALL','USDT','USDC','USD','BNB','BTC','FIAT','BTCC','ETH','ALTs'] as const).map(filter => {
                const value = filter === 'ALL' ? 'Spot' : 'Spot:' + filter;
                return <button key={filter} type="button" className={marketSubcategoryFilter === value ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(value)}>{filter}</button>;
              })}
            </div>}
            {marketSubcategoryFilter === 'Futures' && <div className="sire-market-providers sire-market-subcategories">
              {(['USDT-M','COIN-M'] as const).map(market => (
                <button key={market} type="button" className={marketSubcategoryFilter === market ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(market)}>{market}</button>
              ))}
            </div>}
            {marketSubcategoryFilter === 'USDT-M' && <div className="sire-market-providers sire-market-subcategories">
              {(['All','New','Crypto','DeFi','Metaverse','Payment','PoW','Storage','NFT','TradFi','Index','Pre-IPO','USDC','Chinese','Alpha','AI','Layer-1','RWA','Layer-2','Gaming','Meme','Infrastructure'] as const).map(filter => (
                <button key={filter} type="button" className={marketSubcategoryFilter === 'USDT-M:' + filter ? 'active' : ''} onClick={() => setMarketSubcategoryFilter('USDT-M:' + filter)}>{filter}</button>
              ))}
            </div>}
            {marketSubcategoryFilter === 'COIN-M' && <div className="sire-market-providers sire-market-subcategories">
              {(['All','PoW','Storage','Layer-1','Layer-2','Meme','infrastructure','Payment'] as const).map(filter => (
                <button key={filter} type="button" className={marketSubcategoryFilter === 'COIN-M:' + filter ? 'active' : ''} onClick={() => setMarketSubcategoryFilter('COIN-M:' + filter)}>{filter}</button>
              ))}
            </div>}
            {marketSubcategoryFilter === 'Margin' && <div className="sire-market-providers sire-market-subcategories">
              {(['ALL','ETH','XAU','BTC','XAG','SOL','XRP','DOGE'] as const).map(filter => {
                const value = filter === 'ALL' ? 'Margin' : 'Margin:' + filter;
                return <button key={filter} type="button" className={marketSubcategoryFilter === value ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(value)}>{filter}</button>;
              })}
            </div>}
          </div>}
          {categoryFilter === 'Onchain' && <div className="sire-market-providers sire-market-subcategories">
            {(['ALL','Trending','Latest'] as const).map(subcategory => (
              <button key={subcategory} type="button" className={marketSubcategoryFilter === subcategory ? 'active' : ''} onClick={() => setMarketSubcategoryFilter(subcategory)}>{subcategory}</button>
            ))}
          </div>}
        </div>{derivError && <div className="sire-deriv-error">{derivError}</div>}<div className="native-symbol-list symbol-list" onScroll={event => setQuoteScrollTop(event.currentTarget.scrollTop)}><div style={{height: quoteWindow.top}} aria-hidden="true" /><div className="sire-quote-window">{quoteWindow.items.map(item => <button key={item.id} className={`symbol-row ${selected?.id === item.id ? 'active' : ''}`} data-provider={item.provider} onClick={() => selectInstrument(item)}><span className="quote-asset-logo-wrap"><img className="quote-asset-logo" src={item.logoUrl || makeAssetLogoFallback(item)} alt="" decoding="async" onError={event => { const image = event.currentTarget; image.onerror = null; image.src = makeLogoFallback(item.displaySymbol || item.symbol); }} /></span><span className="quote-instrument-name"><b>{String(item.displaySymbol || item.symbol).toUpperCase()}</b><small>{String(item.name || item.displaySymbol || item.symbol).toUpperCase()}</small></span><span className="quote-broker"><span className="quote-exchange-logo-wrap"><img className="quote-exchange-logo" src={makeProviderLogoFallback(item)} alt="" decoding="async" onError={event => {
  const image = event.currentTarget;
  image.onerror = null;
  image.src = makeLogoFallback(item.providerLabel || item.provider);
}} /></span><b>{String(item.providerLabel || item.provider).toUpperCase()}</b><small>{getBitgetCardMarketLabel(item)}</small></span></button>)}</div><div style={{height: quoteWindow.bottom}} aria-hidden="true" /></div></aside>
      <section className="native-chart-panel">
        <div className={`sire-chart-grid sire-chart-grid--${chartLayout}${chartLayout === 2 ? ` sire-chart-grid--${multiChartPosition}` : ''}`} onContextMenu={event => event.preventDefault()}>
          {chartItems.map((chartSymbol, index) => <div className={`sire-chart-cell${activeChartIndex === index ? ' sire-chart-cell--active' : ''}`} key={index} onPointerDown={() => setActiveChartIndex(index)}>{chartSymbol && <FinancialChart
            symbol={chartSymbol}
            isActive={activeChartIndex === index}
            instruments={chartableInstruments.map(item => ({ symbol: item.symbol, name: item.name, pipSize: item.pipSize, provider: item.provider, exchange: item.exchange, marketType: item.marketType, category: item.category }))}
            onInstrumentTap={() => openInstrumentPicker('main')}
            onSelectInstrument={item => {
              setChartSymbols(current => current.map((value, slot) => slot === index ? item.symbol : value));
              if (index === 0) setSelected(current => current?.symbol === item.symbol ? current : instruments.find(candidate => candidate.symbol === item.symbol && candidate.provider === item.provider) || current);
            }}
            onWidgetReady={widget => {
              if (!linked) return;
              const group = linkGroupRef.current || createLinkGroup({ crosshair: true, viewport: true, symbol: true });
              linkGroupRef.current = group;
              group.add(widget.chart, {
                symbol: chartSymbol,
                onSymbol: next => setChartSymbols(current => current.map((value, slot) => slot === index ? next : value)),
              });
            }}
            onWidgetDestroyed={widget => linkGroupRef.current?.remove(widget.chart)}
          />}</div>)}
        </div>
        {multiChartOpen && <div className="sire-multichart-overlay" onContextMenu={event => event.preventDefault()}>
          <div className="sire-multichart-panel">
            <div className="sire-multichart-head"><div><strong>Multi-chart</strong><small>{chartLayout === 2 ? 'Manage the second window' : 'Add a second window'}</small></div><button type="button" onClick={() => setMultiChartOpen(false)} aria-label="Close multi-chart manager">×</button></div>
            <div className="sire-multichart-field"><span>Chart linking</span><button type="button" className={`sire-multichart-link-toggle${linked ? ' active' : ''}`} onClick={() => setLinked(value => !value)} aria-pressed={linked}>{linked ? 'Link · On' : 'Link · Off'}</button></div><div className="sire-multichart-field"><span>Instrument</span><button type="button" className="sire-multichart-instrument-picker" onClick={() => openInstrumentPicker('multi')}><span>{instruments.find(item => item.symbol === multiChartInstrument)?.name || 'Select instrument'} · {multiChartInstrument || 'Choose'}</span><span aria-hidden="true">⌄</span></button></div>
            <div className="sire-multichart-field"><span>New window position</span><div className="sire-multichart-directions">{(['up','down','left','right'] as const).map(position => <button key={position} type="button" className={multiChartPosition === position ? 'active' : ''} onClick={() => setMultiChartPosition(position)}>{position === 'up' ? '↑ Up' : position === 'down' ? '↓ Down' : position === 'left' ? '← Left' : '→ Right'}</button>)}</div></div>
            <div className="sire-multichart-actions">{chartLayout === 2 && <button type="button" className="danger" onClick={removeSelectedChart}>Delete selected</button>}<button type="button" className="primary" onClick={confirmMultiChart}>{chartLayout === 2 ? 'Apply' : 'Confirm'}</button></div>
          </div>
        </div>}
        {instrumentSearchOpen && <div className="sire-instrument-search-overlay" onContextMenu={event => event.preventDefault()}>
          <div className="sire-instrument-search-panel">
            <div className="sire-instrument-search-head">
              <strong>Instruments</strong>
              <button type="button" onClick={() => setInstrumentSearchOpen(false)} aria-label="Close instrument search">×</button>
            </div>
            <div className="sire-instrument-search-input">
              <Search size={16} />
              <input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search instruments" />
            </div>
            <div className="sire-instrument-search-list">
              {filtered.slice(0, 120).map(item => <button key={item.id} type="button" onClick={() => { if (instrumentSearchMode === 'multi') { setMultiChartInstrument(item.symbol); setSearch(''); setInstrumentSearchOpen(false); } else { selectInstrument(item); setInstrumentSearchOpen(false); } }}>
                <span className="quote-asset-logo-wrap"><img className="quote-asset-logo" src={item.logoUrl || makeAssetLogoFallback(item)} alt="" onError={event => { const image=event.currentTarget; image.onerror=null; image.src=makeLogoFallback(item.displaySymbol || item.symbol); }} /></span><span className="quote-instrument-name"><b>{String(item.displaySymbol || item.symbol).toUpperCase()}</b><small>{String(item.name || item.displaySymbol || item.symbol).toUpperCase()}</small></span><span className="quote-broker"><span className="quote-exchange-logo-wrap"><img className="quote-exchange-logo" src={makeProviderLogoFallback(item)} alt="" onError={event => { const image = event.currentTarget; image.onerror = null; image.src = makeLogoFallback(item.providerLabel || item.provider); }} /></span><b>{String(item.providerLabel || item.provider).toUpperCase()}</b><small>{getBitgetCardMarketLabel(item)}</small></span>
              </button>)}
            </div>
          </div>
        </div>}      </section>
    </div>
    {researchLabOpen && <ResearchLab symbol={chartSymbols[activeChartIndex] || selected?.symbol || ''} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onClose={() => setResearchLabOpen(false)} onSelectInstrument={symbol => { const item = instruments.find(candidate => candidate.symbol === symbol); if (item) selectInstrument(item); }} />}
  </main>;
}