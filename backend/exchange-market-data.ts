type ExchangeInstrument = {
  id: string;
  symbol: string;
  base: string;
  quote: string;
  name: string;
  category: 'spot' | 'margin' | 'perpetual' | 'futures';
  status: 'online' | 'offline';
  contractType?: string;
};

type ExchangeCatalogue = {
  id: 'bittrex' | 'coinex' | 'htx';
  name: string;
  status: 'online' | 'unavailable';
  message?: string;
  instruments: ExchangeInstrument[];
  fetchedAt: number;
};

const COINEX_BASE = 'https://api.coinex.com/v2';
const HTX_BASE = 'https://api.huobi.pro';
const HTX_DERIV_BASE = 'https://api.hbdm.com';

async function getJson(url: string, timeoutMs = 12000): Promise<any> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Invalid JSON from ${url}`); }
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return data;
}

function coinexInstrument(row: any, category: ExchangeInstrument['category']): ExchangeInstrument | null {
  const symbol = String(row?.market || '').trim().toUpperCase();
  const base = String(row?.base_ccy || '').trim().toUpperCase();
  const quote = String(row?.quote_ccy || '').trim().toUpperCase();
  if (!symbol || !base || !quote) return null;
  return {
    id: `coinex:${category}:${symbol}`,
    symbol,
    base,
    quote,
    name: `${base}/${quote}`,
    category,
    status: String(row?.status || '').toLowerCase() === 'online' && row?.is_market_available !== false ? 'online' : 'offline',
    contractType: category === 'perpetual' ? String(row?.contract_type || 'linear') : undefined,
  };
}

async function fetchCoinEx(): Promise<ExchangeCatalogue> {
  const fetchedAt = Date.now();
  const [spot, futures] = await Promise.all([
    getJson(`${COINEX_BASE}/spot/market`),
    getJson(`${COINEX_BASE}/futures/market`),
  ]);

  const instruments: ExchangeInstrument[] = [];
  for (const row of Array.isArray(spot?.data) ? spot.data : []) {
    const item = coinexInstrument(row, 'spot');
    if (item) instruments.push(item);
    if (row?.is_margin_available === true && item) {
      instruments.push({ ...item, id: `coinex:margin:${item.symbol}`, category: 'margin' });
    }
  }
  for (const row of Array.isArray(futures?.data) ? futures.data : []) {
    const item = coinexInstrument(row, 'perpetual');
    if (item) instruments.push(item);
  }

  return {
    id: 'coinex',
    name: 'CoinEx',
    status: 'online',
    instruments: dedupeInstruments(instruments),
    fetchedAt,
  };
}

function htxSpotInstrument(row: any): ExchangeInstrument | null {
  const symbol = String(row?.symbol || '').trim().toUpperCase();
  const base = String(row?.base-currency || row?.base_currency || '').trim().toUpperCase();
  const quote = String(row?.quote-currency || row?.quote_currency || '').trim().toUpperCase();
  if (!symbol || !base || !quote) return null;
  return {
    id: `htx:spot:${symbol}`,
    symbol,
    base,
    quote,
    name: `${base}/${quote}`,
    category: 'spot',
    status: String(row?.state || '').toLowerCase() === 'online' ? 'online' : 'offline',
  };
}

async function fetchHTX(): Promise<ExchangeCatalogue> {
  const fetchedAt = Date.now();
  const [spot, usdtSwap, coinSwap, futures] = await Promise.allSettled([
    getJson(`${HTX_BASE}/v1/common/symbols`),
    getJson(`${HTX_DERIV_BASE}/linear-swap-api/v1/swap_contract_info`),
    getJson(${JSON.stringify(HTX_DERIV_BASE)} + '/swap-api/v1/swap_contract_info'),
    getJson(`${HTX_DERIV_BASE}/api/v1/contract_contract_info`),
  ]);

  const instruments: ExchangeInstrument[] = [];

  if (spot.status === 'fulfilled') {
    for (const row of Array.isArray(spot.value?.data) ? spot.value.data : []) {
      const item = htxSpotInstrument(row);
      if (item) instruments.push(item);
    }
  }

  const addContracts = (result: PromiseSettledResult<any>, category: ExchangeInstrument['category'], quote: string) => {
    if (result.status !== 'fulfilled') return;
    for (const row of Array.isArray(result.value?.data) ? result.value.data : []) {
      const symbol = String(row?.contract_code || '').trim().toUpperCase();
      const base = String(row?.symbol || '').trim().toUpperCase();
      if (!symbol || !base) continue;
      const status = Number(row?.contract_status) === 1 ? 'online' : 'offline';
      instruments.push({
        id: `htx:${category}:${symbol}`,
        symbol,
        base,
        quote,
        name: `${base}/${quote}`,
        category,
        status,
        contractType: category === 'perpetual' ? 'linear' : undefined,
      });
    }
  };

  addContracts(usdtSwap, 'perpetual', 'USDT');
  addContracts(coinSwap, 'perpetual', 'USD');
  addContracts(futures, 'futures', 'USD');

  const successfulSources = [spot, usdtSwap, coinSwap, futures].filter(x => x.status === 'fulfilled').length;
  if (successfulSources === 0) throw new Error('HTX returned no reachable public market catalogue endpoints.');

  return {
    id: 'htx',
    name: 'HTX',
    status: 'online',
    instruments: dedupeInstruments(instruments),
    fetchedAt,
  };
}

function dedupeInstruments(items: ExchangeInstrument[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export async function fetchExchangeCatalogues(): Promise<ExchangeCatalogue[]> {
  const results = await Promise.allSettled([
    fetchCoinEx(),
    fetchHTX(),
  ]);

  const catalogues: ExchangeCatalogue[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') catalogues.push(result.value);
    else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      const id = catalogues.some(item => item.id === 'coinex') ? 'htx' : 'coinex';
      catalogues.push({
        id,
        name: id === 'coinex' ? 'CoinEx' : 'HTX',
        status: 'unavailable',
        message,
        instruments: [],
        fetchedAt: Date.now(),
      });
    }
  }

  catalogues.unshift({
    id: 'bittrex',
    name: 'Bittrex',
    status: 'unavailable',
    message: 'Bittrex Global trading has been suspended and the exchange is in liquidation; no live trading catalogue is exposed.',
    instruments: [],
    fetchedAt: Date.now(),
  });

  return catalogues;
}
