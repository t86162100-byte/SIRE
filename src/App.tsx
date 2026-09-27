import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createLinkGroup, type LinkGroup } from 'openalgo-charts';
import { Search } from 'lucide-react';
import ResearchLab from './ResearchLab';
import FinancialChart from './FinancialChart';
import type { DerivInstrument } from './derivMarketData';
import { SireErrorScreen } from './SireErrorBoundary';
import './nativeTerminal.css';

type MarketProvider = 'DERIV' | 'BINANCE' | 'BITGET' | 'BYBIT' | 'OKX' | 'KRAKEN' | 'COINBASE' | 'GATEIO' | 'KUCOIN' | 'GEMINI' | 'BITSO' | 'BITFINEX' | 'BITVAVO' | 'COINEX' | 'LBANK' | 'WOOX' | 'CRYPTOCOM' | 'HTX' | 'BITKUB' | 'UPBIT' | 'PIONEX' | 'POLONIEX' | 'BITHUMB' | 'MEXC' | 'PHEMEX' | 'WHITEBIT' | 'TWELVEDATA' | 'NASDAQTRADER' | 'NSE' | 'BITSTAMP' | 'OANDA' | 'TRADINGVIEW' | 'FOREXCOM' | 'INTERACTIVEBROKERS' | 'TRADESTATION' | 'WEBULL' | 'MOOMOO' | 'NINJATRADER' | 'TRADOVATE' | 'AMPFUTURES' | 'TASTYTRADE' | 'TASTYFX' | 'CRYPTOCOMEXCHANGE' | 'COINBASEADVANCED' | 'ALPACA' | 'TRADIERBROKERAGE' | 'TRADEZERO' | 'COBRATRADING' | 'CLEARSTREET' | 'INVESTRADE' | 'PUBLIC' | 'PLUS500US' | 'OPTIMUSFUTURES' | 'EDGECLEAR' | 'IRONBEAM' | 'STONEX' | 'DORMANTRADING' | 'TRADIERFUTURES';
type Instrument = DerivInstrument & {
  id: string;
  provider: MarketProvider;
  providerLabel: string;
  marketType: string;
  category: string;
  displaySymbol: string;
  price?: number;
  bid?: number;
  ask?: number;
  logoUrl: string;
  providerLogoUrl: string;
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
const makeProviderLogoFallback = (item: Instrument) =>
  'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(
    item.provider === 'DERIV' ? 'deriv.com' : item.provider.toLowerCase() + '.com'
  ) + '&sz=128';

const augmentBinanceDerivativesInBrowser = async (items: Instrument[]): Promise<Instrument[]> => {
  const existing = new Set(items.map(item => item.id));
  const additions: Instrument[] = [];
  const sources: Array<{ marketType: string; urls: string[]; rows: (payload: any) => any[] }> = [
    {
      marketType: 'Spot',
      urls: [
        'https://data-api.binance.vision/api/v3/exchangeInfo',
        'https://api-gcp.binance.com/api/v3/exchangeInfo',
        'https://api1.binance.com/api/v3/exchangeInfo',
        'https://api2.binance.com/api/v3/exchangeInfo',
        'https://api3.binance.com/api/v3/exchangeInfo',
        'https://api4.binance.com/api/v3/exchangeInfo',
        'https://api.binance.com/api/v3/exchangeInfo',
      ],
      rows: payload => Array.isArray(payload?.symbols) ? payload.symbols : [],
    },
    {
      marketType: 'Margin',
      urls: [
        'https://api-gcp.binance.com/sapi/v1/margin/allPairs',
        'https://api1.binance.com/sapi/v1/margin/allPairs',
        'https://api.binance.com/sapi/v1/margin/allPairs',
      ],
      rows: payload => Array.isArray(payload) ? payload : [],
    },
    {
      marketType: 'USD-M Futures',
      urls: ['https://fapi.binance.com/fapi/v1/exchangeInfo'],
      rows: payload => Array.isArray(payload?.symbols) ? payload.symbols : [],
    },
    {
      marketType: 'COIN-M Futures',
      urls: ['https://dapi.binance.com/dapi/v1/exchangeInfo'],
      rows: payload => Array.isArray(payload?.symbols) ? payload.symbols : [],
    },
    {
      marketType: 'Options',
      urls: ['https://eapi.binance.com/eapi/v1/exchangeInfo'],
      rows: payload => Array.isArray(payload?.optionSymbols) ? payload.optionSymbols : [],
    },
  ];

  const toInstrument = (marketType: string, raw: any): Instrument | null => {
    const symbol = String(raw?.symbol || '').trim();
    if (!symbol) return null;
    const status = String(raw?.status || raw?.contractStatus || raw?.state || '').toUpperCase();
    if (status && !['TRADING', 'ONLINE', 'ENABLED', 'LIVE'].includes(status)) return null;
    const underlying = String(raw?.underlying || '').trim();
    const base = String(raw?.baseAsset || raw?.baseCoin || (underlying.replace(/USDT$|USDC$|USD$/i, '')) || '').trim() || undefined;
    const quote = String(raw?.quoteAsset || raw?.quoteCoin || '').trim() || undefined;
    const id = 'BINANCE:' + marketType + ':' + symbol;
    const normalizedMarketType = marketType === 'USD-M Futures'
      ? (String(raw?.contractType || '').toUpperCase().includes('PERPETUAL') ? 'USD-M Perpetuals' : 'USD-M Futures')
      : marketType === 'COIN-M Futures'
        ? (String(raw?.contractType || '').toUpperCase().includes('PERPETUAL') ? 'COIN-M Perpetuals' : 'COIN-M Futures')
        : marketType;
    return {
      ...(raw as any),
      id: 'BINANCE:' + normalizedMarketType + ':' + symbol,
      provider: 'BINANCE',
      providerLabel: 'Binance',
      marketType: normalizedMarketType,
      category: 'Crypto',
      symbol,
      displaySymbol: symbol,
      name: base ? base + (quote ? ' / ' + quote : '') : symbol,
      base,
      quote,
      exchangeOpen: 1,
      status: status || 'TRADING',
      logoUrl: base ? 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + encodeURIComponent(base.toLowerCase()) + '.png' : '',
      providerLogoUrl: 'https://cdn.simpleicons.org/binance',
      instrumentType: normalizedMarketType,
      contractType: raw?.contractType || raw?.type || undefined,
      settlement: raw?.marginAsset || raw?.settleAsset || raw?.settleCoin || undefined,
      expiry: raw?.deliveryDate || raw?.deliveryTime || raw?.expirationTime || undefined,
      strike: Number.isFinite(Number(raw?.strikePrice)) ? Number(raw.strikePrice) : undefined,
      optionType: raw?.side || raw?.optionType || undefined,
      supportsMargin: marketType === 'Margin',
    } as Instrument;
  };

  const fetchFirstReachable = async (urls: string[]) => {
    let lastError: unknown = null;
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) {
          lastError = new Error('HTTP ' + response.status);
          continue;
        }
        return await response.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('All Binance browser endpoints failed');
  };

  await Promise.all(sources.map(async source => {
    try {
      const payload = await fetchFirstReachable(source.urls);
      for (const raw of source.rows(payload)) {
        const item = toInstrument(source.marketType, raw);
        if (item && !existing.has(item.id)) {
          existing.add(item.id);
          additions.push(item);
        }
      }
      console.info('[SIRE BINANCE BROWSER] ' + source.marketType + ': ' + source.rows(payload).length);
    } catch (error) {
      console.warn('[SIRE BINANCE BROWSER] ' + source.marketType + ' unavailable:', error);
    }
  }));

  return additions.length ? items.concat(additions) : items;
};
const augmentBybitInstrumentsInBrowser = async (items: Instrument[]): Promise<Instrument[]> => {
  const existing = new Set(items.map(item => item.id));
  const additions: Instrument[] = [];
  const sources: Array<{ marketType: string; category: string; paginate: boolean }> = [
    { marketType: 'Spot', category: 'spot', paginate: false },
    { marketType: 'Linear', category: 'linear', paginate: true },
    { marketType: 'Inverse', category: 'inverse', paginate: true },
    { marketType: 'Options', category: 'option', paginate: true },
  ];

  const toInstrument = (marketType: string, raw: any): Instrument | null => {
    const symbol = String(raw?.symbol || '').trim();
    if (!symbol) return null;
    const status = String(raw?.status || '').trim();
    const normalizedStatus = status.toUpperCase();
    if (normalizedStatus && normalizedStatus !== 'TRADING') return null;
    const base = String(raw?.baseCoin || '').trim() || undefined;
    const quote = String(raw?.quoteCoin || '').trim() || undefined;
    const id = 'BYBIT:' + marketType + ':' + symbol;
    return {
      ...(raw as any),
      id,
      provider: 'BYBIT',
      providerLabel: 'Bybit',
      marketType,
      category: 'Crypto',
      symbol,
      displaySymbol: symbol,
      name: base ? base + (quote ? ' / ' + quote : '') : symbol,
      base,
      quote,
      exchangeOpen: 1,
      status: status || 'Trading',
      logoUrl: base ? 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + encodeURIComponent(base.toLowerCase()) + '.png' : '',
      providerLogoUrl: 'https://cdn.simpleicons.org/bybit',
    };
  };

  const fetchCategory = async (source: typeof sources[number]) => {
    let cursor = '';
    let page = 0;
    const maxPages = 100;
    while (page < maxPages) {
      const params = new URLSearchParams({ category: source.category, limit: '1000' });
      if (source.category === 'option') params.set('baseCoin', 'All');
      if (source.paginate && cursor) params.set('cursor', cursor);
      const query = params.toString();
      const endpoints = [
        'https://api.bybit.com/v5/market/instruments-info?' + query,
        'https://api.bybit.tr/v5/market/instruments-info?' + query,
        'https://api.bybit.ae/v5/market/instruments-info?' + query,
        'https://api.bybit.eu/v5/market/instruments-info?' + query,
        'https://api.bybit.kz/v5/market/instruments-info?' + query,
        'https://api.bybitgeorgia.ge/v5/market/instruments-info?' + query,
        'https://api.bybit.id/v5/market/instruments-info?' + query,
        'https://api.spark-fintech.com/v5/market/instruments-info?' + query,
        'https://api.bytick.com/v5/market/instruments-info?' + query,
      ];
      let payload: any = null;
      let lastError: unknown = null;
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          });
          if (!response.ok) {
            lastError = new Error('HTTP ' + response.status);
            continue;
          }
          const candidate = await response.json();
          if (Number(candidate?.retCode) !== 0) {
            lastError = new Error(String(candidate?.retMsg || 'Bybit API error'));
            continue;
          }
          payload = candidate;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!payload) throw lastError || new Error('All Bybit endpoints failed');
      const rows = Array.isArray(payload?.result?.list) ? payload.result.list : [];
      for (const raw of rows) {
        const item = toInstrument(source.marketType, raw);
        if (item && !existing.has(item.id)) {
          existing.add(item.id);
          additions.push(item);
        }
      }
      const nextCursor = String(payload?.result?.nextPageCursor || '');
      page += 1;
      if (!source.paginate || !nextCursor || nextCursor === cursor || rows.length === 0) break;
      cursor = nextCursor;
    }
    if (page >= maxPages) throw new Error('pagination safety limit reached');
    console.info('[SIRE BYBIT BROWSER] ' + source.marketType + ': ' + additions.filter(item => item.marketType === source.marketType).length);
  };

  await Promise.all(sources.map(source => fetchCategory(source).catch(error => {
    console.warn('[SIRE BYBIT BROWSER] ' + source.marketType + ' unavailable:', error);
  })));

  return additions.length ? items.concat(additions) : items;
};

const augmentMajorCryptoProvidersInBrowser = async (items: Instrument[]): Promise<Instrument[]> => {
  const existing = new Set(items.map(item => item.id));
  const additions: Instrument[] = [];
  const add = (provider: MarketProvider, marketType: string, raw: any) => {
    const symbol = String(raw?.symbol || raw?.instId || raw?.market || '').trim();
    if (!symbol) return;
    const status = String(raw?.status || raw?.state || raw?.tradeStatus || '').toUpperCase();
    if (status && ['OFFLINE','SUSPENDED','BREAK','HALT'].includes(status)) return;
    const base = String(raw?.baseCoin || raw?.baseAsset || raw?.baseCcy || raw?.base_currency || '').trim() || undefined;
    const quote = String(raw?.quoteCoin || raw?.quoteAsset || raw?.quoteCcy || raw?.quote_currency || '').trim() || undefined;
    const id = provider + ':' + marketType + ':' + symbol;
    if (existing.has(id)) return;
    existing.add(id);
    additions.push({
      ...(raw as any),
      id,
      provider,
      providerLabel: provider === 'BITGET' ? 'Bitget' : provider === 'OKX' ? 'OKX' : 'MEXC',
      marketType,
      category: 'Crypto',
      symbol,
      displaySymbol: symbol,
      name: base ? base + (quote ? ' / ' + quote : '') : symbol,
      base,
      quote,
      exchangeOpen: 1,
      status: status || 'online',
      logoUrl: base ? 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + encodeURIComponent(base.toLowerCase()) + '.png' : '',
      providerLogoUrl: provider === 'BITGET' ? 'https://cdn.simpleicons.org/bitget' : provider === 'OKX' ? 'https://cdn.simpleicons.org/okx' : 'https://cdn.simpleicons.org/mexc',
      instrumentType: marketType,
    } as Instrument);
  };
  const fetchJson = async (urls: string[]) => {
    let last: unknown = null;
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) { last = new Error('HTTP ' + response.status); continue; }
        return await response.json();
      } catch (error) { last = error; }
    }
    throw last || new Error('All browser endpoints failed');
  };

  try {
    const r = await fetchJson(['https://api.bitget.com/api/v2/spot/public/symbols']);
    for (const raw of Array.isArray(r?.data) ? r.data : []) {
      if (String(raw?.status || '').toLowerCase() !== 'online') continue;
      add('BITGET','Spot',{...raw,symbol:raw?.symbol,baseCoin:raw?.baseCoin,quoteCoin:raw?.quoteCoin});
    }
    console.info('[SIRE BITGET BROWSER] Spot:', additions.filter(x=>x.provider==='BITGET').length);
  } catch (error) { console.warn('[SIRE BITGET BROWSER] Spot unavailable:', error); }

  try {
    const r = await fetchJson(['https://www.okx.com/api/v5/public/instruments?instType=SPOT','https://app.okx.com/api/v5/public/instruments?instType=SPOT']);
    for (const raw of Array.isArray(r?.data) ? r.data : []) {
      if (String(raw?.state || '').toLowerCase() !== 'live') continue;
      add('OKX','Spot',raw);
    }
    console.info('[SIRE OKX BROWSER] Spot:', additions.filter(x=>x.provider==='OKX').length);
  } catch (error) { console.warn('[SIRE OKX BROWSER] Spot unavailable:', error); }

  try {
    const r = await fetchJson(['https://api.mexc.com/api/v3/exchangeInfo']);
    for (const raw of Array.isArray(r?.symbols) ? r.symbols : []) {
      if (String(raw?.status || '').toUpperCase() !== 'ENABLED') continue;
      add('MEXC','Spot',raw);
    }
    console.info('[SIRE MEXC BROWSER] Spot:', additions.filter(x=>x.provider==='MEXC').length);
  } catch (error) { console.warn('[SIRE MEXC BROWSER] Spot unavailable:', error); }

  return additions.length ? items.concat(additions) : items;
};

const chooseInitialDerivInstrument = (items: Instrument[]) =>
  items.find(item => item.provider === 'DERIV' && item.exchangeOpen !== 0 && item.tradingSuspended !== 1) ||
  items.find(item => item.provider === 'DERIV') || items[0] || null;

export default function App() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [derivLoading, setDerivLoading] = useState(true);
  const [derivError, setDerivError] = useState('');
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<'ALL' | MarketProvider>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [quoteScrollTop, setQuoteScrollTop] = useState(0);
  const deferredSearch = useDeferredValue(search);
  const [instrumentSearchOpen, setInstrumentSearchOpen] = useState(false);
  const [instrumentSearchMode, setInstrumentSearchMode] = useState<'main' | 'multi'>('main');
  const [researchLabOpen, setResearchLabOpen] = useState(false);
  const [chartLayout, setChartLayout] = useState<1 | 2>(1);
  const [activeChartIndex, setActiveChartIndex] = useState(0);
  const [linked, setLinked] = useState(false);
  const [multiChartOpen, setMultiChartOpen] = useState(false);
  const [multiChartInstrument, setMultiChartInstrument] = useState('');
  const [multiChartPosition, setMultiChartPosition] = useState<'up' | 'down' | 'left' | 'right'>('right');
  const [chartSymbols, setChartSymbols] = useState<string[]>([]);
  const linkGroupRef = useRef<LinkGroup | null>(null);


  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;

    const startup = async (): Promise<Instrument[]> => {
      const maxAttempts = 3;
      const retryDelaysMs = [0, 2500, 5000];

      let lastError = 'SIRE market catalogue failed to load.';
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (cancelled) throw new Error('SIRE startup cancelled.');
        if (retryDelaysMs[attempt - 1] > 0) {
          await new Promise<void>(resolve => {
            retryTimer = window.setTimeout(() => {
              retryTimer = null;
              resolve();
            }, retryDelaysMs[attempt - 1]);
          });
        }

        try {
          console.info('[SIRE MARKET STARTUP] requesting unified market catalogue', { attempt, maxAttempts });
          const response = await fetch('/api/sire/markets/catalog', {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          });
          let payload: any = null;
          try { payload = await response.json(); } catch {}
          if (!response.ok || !payload?.ok || !Array.isArray(payload?.instruments)) {
            lastError = payload?.error || `SIRE market catalogue returned HTTP ${response.status}`;
            console.warn('[SIRE MARKET STARTUP] attempt failed', { attempt, maxAttempts, error: lastError });
            continue;
          }
          const items = payload.instruments as Instrument[];
          if (!items.length) {
            lastError = 'SIRE market catalogue returned no instruments.';
            continue;
          }
          return items;
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Deriv market catalogue failed to load.';
          console.warn('[DERIV STARTUP] health request failed', { attempt, maxAttempts, error: lastError });
        }
      }

      throw new Error(lastError);
    };

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
      setInstruments(items);
      setSelected(current => current && items.some(item => item.id === current.id) ? current : initial);
      setChartSymbols(current => current.length ? current : [initial.symbol]);

      // Binance/Bybit browser augmentation is additive only. If a provider is slow,
      // blocked, or unavailable, the already-loaded catalogue remains usable.
      try {
        const withBinance = await augmentBinanceDerivativesInBrowser(items);
        if (cancelled) return;
        setInstruments(current => {
          const existing = new Set(current.map(item => item.id));
          const additions = withBinance.filter(item => !existing.has(item.id));
          return additions.length ? current.concat(additions) : current;
        });
        const next = withBinance;
        console.info('[SIRE MARKET STARTUP] catalogue after Binance browser augmentation', {
          total: next.length,
          binance: next.filter(item => item.provider === 'BINANCE').length,
          binanceMarketTypes: Array.from(new Set(next.filter(item => item.provider === 'BINANCE').map(item => item.marketType)))
        });
      } catch (error) {
        console.warn('[SIRE MARKET STARTUP] Binance browser augmentation skipped:', error);
      }

      try {
        const currentItems = items;
        const next = await augmentBybitInstrumentsInBrowser(currentItems);
        if (cancelled) return;
        setInstruments(current => {
          const existing = new Set(current.map(item => item.id));
          const additions = next.filter(item => !existing.has(item.id));
          return additions.length ? current.concat(additions) : current;
        });
        console.info('[SIRE MARKET STARTUP] catalogue after Bybit browser augmentation', {
          total: next.length,
          bybit: next.filter(item => item.provider === 'BYBIT').length,
          bybitMarketTypes: Array.from(new Set(next.filter(item => item.provider === 'BYBIT').map(item => item.marketType)))
        });
      } catch (error) {
        console.warn('[SIRE MARKET STARTUP] Bybit browser augmentation skipped:', error);
      }

      try {
        const currentItems = items;
        const next = await augmentMajorCryptoProvidersInBrowser(currentItems);
        if (cancelled) return;
        setInstruments(current => {
          const existing = new Set(current.map(item => item.id));
          const additions = next.filter(item => !existing.has(item.id));
          return additions.length ? current.concat(additions) : current;
        });
        console.info('[SIRE MARKET STARTUP] catalogue after major crypto browser augmentation', {
          total: next.length,
          bitget: next.filter(item => item.provider === 'BITGET').length,
          okx: next.filter(item => item.provider === 'OKX').length,
          mexc: next.filter(item => item.provider === 'MEXC').length
        });
      } catch (error) {
        console.warn('[SIRE MARKET STARTUP] major crypto browser augmentation skipped:', error);
      }
    }).catch(error => {
      if (cancelled || error?.message === 'SIRE startup cancelled.') return;
      console.error('[DERIV MARKET DATA] active symbol discovery failed', error);
      setDerivLoading(false);
      setDerivError(error instanceof Error ? error.message : 'Deriv market catalogue failed to load.');
      setInstruments([]);
      setSelected(null);
      setChartSymbols([]);
    });

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
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
    return () => {};
  }, [linked]);

  useEffect(() => () => { linkGroupRef.current?.destroy(); linkGroupRef.current = null; }, []);

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

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return instruments.filter(item => {
      const providerMatch = providerFilter === 'ALL' || item.provider === providerFilter;
      const marketType = String(item.marketType || '').toLowerCase();
      const categoryMatch = categoryFilter === 'ALL'
        || item.category === categoryFilter
        || (categoryFilter === 'Options' && marketType.includes('option'))
        || (categoryFilter === 'Futures' && (marketType.includes('future') || marketType.includes('perpetual') || marketType.includes('swap')))
        || (categoryFilter === 'Crypto' && item.category === 'Crypto' && !marketType.includes('future') && !marketType.includes('option') && !marketType.includes('perpetual') && !marketType.includes('swap'));
      const searchMatch = !q || `${item.name} ${item.symbol} ${item.providerLabel} ${item.marketType} ${item.category}`.toLowerCase().includes(q);
      return providerMatch && categoryMatch && searchMatch;
    });
  }, [instruments, search, providerFilter, categoryFilter]);

  const chartableInstruments = useMemo(() => instruments.filter(item => item.provider === 'DERIV'), [instruments]);
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
    if (item.provider === 'DERIV') {
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
      message="Deriv startup completed without a usable instrument catalogue or selected instrument."
    />;
  }

  const chartItems = chartSymbols.slice(0, chartLayout);
  const openMultiChartManager = () => {
    setMultiChartInstrument(chartSymbols[1] || chartableInstruments[1]?.symbol || chartableInstruments[0]?.symbol || '');
    setMultiChartOpen(true);
  };
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
    if (!chartSymbols[1]) return;
    setChartSymbols(current => [current[1], current[0] || current[1]]);
    setActiveChartIndex(0);
    setSelected(chartableInstruments.find(item => item.symbol === chartSymbols[1]) || selected);
    setMultiChartOpen(false);
  };
  return <main className={`native-terminal-shell${researchLabOpen ? ' sire-research-open' : ''}`}>
    <div className="native-terminal-body">
      <aside className="native-symbol-sidebar symbol-sidebar"><div className="sidebar-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search" /></div><div className="sidebar-meta"><span>{derivLoading ? "LOADING MARKETS" : derivError ? "MARKET ERROR" : "ALL MARKETS"}</span><b>{instruments.length}</b></div>
        <div className="sire-market-providers">
          {(['ALL','DERIV','BINANCE','BITGET','BYBIT','OKX','KRAKEN','COINBASE','GATEIO','KUCOIN','GEMINI','BITSO','BITFINEX','BITVAVO','COINEX','LBANK','WOOX','CRYPTOCOM','HTX','BITKUB','UPBIT','PIONEX','POLONIEX','BITHUMB','MEXC','PHEMEX','WHITEBIT','TWELVEDATA','NASDAQTRADER','XETR','XFRA','EUREX','ASX','TWSE','PSX','IDX','HKEX','BSE','TSE','NSE','BITSTAMP','OANDA','FOREXCOM','INTERACTIVEBROKERS','TRADESTATION','WEBULL','MOOMOO','NINJATRADER','TRADOVATE','AMPFUTURES','TASTYTRADE','TASTYFX','CRYPTOCOMEXCHANGE','COINBASEADVANCED','ALPACA','TRADIERBROKERAGE','TRADEZERO','COBRATRADING','CLEARSTREET','INVESTRADE','PUBLIC','PLUS500US','OPTIMUSFUTURES','EDGECLEAR','IRONBEAM','STONEX','DORMANTRADING','TRADIERFUTURES','TRADINGVIEW'] as const).map(provider => (
            <button key={provider} type="button" className={providerFilter === provider ? 'active' : ''} onClick={() => setProviderFilter(provider)}>{provider === 'ALL' ? 'All' : provider[0] + provider.slice(1).toLowerCase()}</button>
          ))}
        </div><div className="sire-market-providers sire-market-categories">
          {(['ALL','Forex','Stocks','Funds','Commodities','Indices','Bonds','Options','Futures','Crypto','Synthetic Indices','Baskets'] as const).map(category => (
            <button key={category} type="button" className={categoryFilter === category ? 'active' : ''} onClick={() => setCategoryFilter(category)}>{category}</button>
          ))}
        </div>{derivError && <div className="sire-deriv-error">{derivError}</div>}<div className="native-symbol-list symbol-list" onScroll={event => setQuoteScrollTop(event.currentTarget.scrollTop)}><div style={{height: quoteWindow.top}} aria-hidden="true" /><div className="sire-quote-window">{quoteWindow.items.map(item => <button key={item.id} className={`symbol-row ${selected?.id === item.id ? 'active' : ''}`} data-provider={item.provider} onClick={() => selectInstrument(item)}><span className="quote-asset-logo-wrap"><img className="quote-asset-logo" src={item.logoUrl || item.providerLogoUrl} alt="" decoding="async" onError={event => { const image = event.currentTarget; image.style.display='none'; }} /></span><span className="quote-instrument-name"><b>{item.displaySymbol || item.symbol}</b><small>{item.name}</small></span><span className="quote-broker"><img className="quote-broker-logo" src={item.providerLogoUrl} alt="" decoding="async" onError={event => {
  const image=event.currentTarget;
  const stage=image.dataset.logoStage || '0';
  image.dataset.logoStage=stage === '0' ? '1' : '2';
  image.onerror=null;
  if(stage === '0'){ image.onerror=event2 => { const next=event2.currentTarget; next.onerror=null; next.src=makeLogoFallback(item.providerLabel); }; image.src=makeProviderLogoFallback(item); }
  else image.src=makeLogoFallback(item.providerLabel);
}} /><b>{item.providerLabel}</b><small>{item.category === 'Crypto' && item.marketType !== 'Spot' ? item.marketType.toLowerCase() : item.category === 'Crypto' && item.marketType === 'Spot' ? 'spot crypto' : String(item.marketType || item.category).toLowerCase()}</small></span></button>)}</div><div style={{height: quoteWindow.bottom}} aria-hidden="true" /></div></aside>
      <section className="native-chart-panel">
        <div className={`sire-chart-grid sire-chart-grid--${chartLayout}${chartLayout === 2 ? ` sire-chart-grid--${multiChartPosition}` : ''}`} onContextMenu={event => event.preventDefault()}>
          {chartItems.map((chartSymbol, index) => <div className={`sire-chart-cell${activeChartIndex === index ? ' sire-chart-cell--active' : ''}`} key={index} onPointerDown={() => setActiveChartIndex(index)}>{chartSymbol && <FinancialChart
            symbol={chartSymbol}
            isActive={activeChartIndex === index}
            instruments={chartableInstruments.map(item => ({ symbol: item.symbol, name: item.name, pipSize: item.pipSize }))}
            onInstrumentTap={() => openInstrumentPicker('main')}
            onSelectInstrument={item => {
              setChartSymbols(current => current.map((value, slot) => slot === index ? item.symbol : value));
              if (index === 0) setSelected(current => current?.symbol === item.symbol ? current : instruments.find(candidate => candidate.symbol === item.symbol) || current);
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
                <span className="quote-asset-logo-wrap"><img className="quote-asset-logo" src={item.logoUrl || item.providerLogoUrl} alt="" onError={event => {
  const image=event.currentTarget;
  const stage=image.dataset.logoStage || '0';
  image.dataset.logoStage=stage === '0' ? '1' : '2';
  image.onerror=null;
  if(stage === '0'){ image.onerror=event2 => { const next=event2.currentTarget; next.onerror=null; next.src=makeLogoFallback(item.displaySymbol || item.symbol); }; image.src=makeAssetLogoFallback(item); }
  else image.src=makeLogoFallback(item.displaySymbol || item.symbol);
}} /></span><span className="quote-instrument-name"><b>{item.displaySymbol || item.symbol}</b><small>{item.name}</small></span><span className="quote-broker"><img className="quote-broker-logo" src={item.providerLogoUrl} alt="" /><b>{item.providerLabel}</b><small>{item.category === 'Crypto' && item.marketType !== 'Spot' ? item.marketType.toLowerCase() : item.category === 'Crypto' && item.marketType === 'Spot' ? 'spot crypto' : String(item.marketType || item.category).toLowerCase()}</small></span>
              </button>)}
            </div>
          </div>
        </div>}      </section>
    </div>
    {researchLabOpen && <ResearchLab symbol={chartSymbols[activeChartIndex] || selected?.symbol || ''} instruments={instruments.map(item => ({ symbol: item.symbol, name: item.name }))} onClose={() => setResearchLabOpen(false)} onSelectInstrument={symbol => { const item = instruments.find(candidate => candidate.symbol === symbol); if (item) selectInstrument(item); }} />}
  </main>;
}
