export type CoinbaseInstrumentType = 'spot' | 'perpetual' | 'future' | 'other';

export type CoinbaseInstrument = {
  symbol: string;
  name: string;
  provider: 'coinbase';
  broker: 'Coinbase';
  category: CoinbaseInstrumentType;
  instrumentType: CoinbaseInstrumentType;
  productType: string;
  productVenue?: string;
  baseCurrency?: string;
  quoteCurrency?: string;
  status?: string;
  tradingDisabled?: boolean;
  contractExpiry?: string;
  contractExpiryType?: string;
  contractRootUnit?: string;
  contractSize?: number;
  displayName?: string;
  alias?: string;
  aliasTo?: string[];
  raw: any;
};

const COINBASE_PRODUCTS_URL = '/api/v3/brokerage/market/products';
const COINBASE_REQUEST_TIMEOUT = 20000;
const COINBASE_PAGE_LIMIT = 1000;
const MAX_PAGES_PER_QUERY = 100;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function finiteNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function classifyProduct(raw: any): CoinbaseInstrumentType {
  const productType = lower(raw?.product_type);
  const expiryType = lower(raw?.future_product_details?.contract_expiry_type);
  const display = lower(
    String(raw?.display_name ?? '') + ' ' +
    String(raw?.product_id ?? '') + ' ' +
    String(raw?.future_product_details?.contract_display_name ?? ''),
  );

  if (productType === 'spot') return 'spot';
  if (productType === 'future' && expiryType === 'perpetual') return 'perpetual';
  if (productType === 'future' || expiryType === 'expiring') return 'future';
  if (display.includes('perpetual') || /(^|[-_])perp([-_]|$)/i.test(display)) return 'perpetual';
  return 'other';
}

export function normalizeCoinbaseInstrument(raw: any): CoinbaseInstrument | null {
  const productId = text(raw?.product_id);
  if (!productId) return null;

  const category = classifyProduct(raw);
  const details = raw?.future_product_details ?? {};
  const displayName = text(raw?.display_name || details?.contract_display_name || productId);
  const base = text(raw?.base_currency_id || details?.contract_root_unit);
  const quote = text(raw?.quote_currency_id);

  return {
    symbol: productId,
    name: displayName,
    provider: 'coinbase',
    broker: 'Coinbase',
    category,
    instrumentType: category,
    productType: text(raw?.product_type) || 'UNKNOWN',
    productVenue: text(raw?.product_venue || details?.venue) || undefined,
    baseCurrency: base || undefined,
    quoteCurrency: quote || undefined,
    status: text(raw?.status) || undefined,
    tradingDisabled: raw?.trading_disabled === true || raw?.is_disabled === true,
    contractExpiry: text(details?.contract_expiry) || undefined,
    contractExpiryType: text(details?.contract_expiry_type) || undefined,
    contractRootUnit: text(details?.contract_root_unit) || undefined,
    contractSize: finiteNumber(details?.contract_size),
    displayName: displayName || undefined,
    alias: text(raw?.alias) || undefined,
    aliasTo: Array.isArray(raw?.alias_to) ? raw.alias_to.map(text).filter(Boolean) : undefined,
    raw,
  };
}

export function sortCoinbaseInstruments(items: CoinbaseInstrument[]) {
  const order: Record<CoinbaseInstrumentType, number> = {
    spot: 0,
    perpetual: 1,
    future: 2,
    other: 3,
  };

  return [...items].sort((a, b) =>
    order[a.category] - order[b.category] ||
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
    a.symbol.localeCompare(b.symbol),
  );
}

async function fetchCoinbasePage(params: Record<string, string>) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), COINBASE_REQUEST_TIMEOUT);

  try {
    const query = new URLSearchParams({
      limit: String(COINBASE_PAGE_LIMIT),
      ...params,
    });
    const response = await fetch(COINBASE_PRODUCTS_URL + '?' + query.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });

    const rawText = await response.text();
    let data: any = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new Error('Coinbase returned invalid JSON (HTTP ' + response.status + ').');
    }

    if (!response.ok) {
      throw new Error(data?.error || data?.message || 'Coinbase products request failed (HTTP ' + response.status + ').');
    }

    return data;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchAllCoinbaseProducts(params: Record<string, string>) {
  const products: any[] = [];
  let cursor = '';

  for (let page = 0; page < MAX_PAGES_PER_QUERY; page += 1) {
    const data = await fetchCoinbasePage(cursor ? { ...params, cursor } : params);
    if (Array.isArray(data?.products)) products.push(...data.products);

    const next = text(data?.pagination?.next_cursor);
    if (!next || next === cursor) break;
    cursor = next;
  }

  return products;
}

/**
 * Loads the complete public Coinbase Advanced/market product catalogue.
 *
 * The unfiltered catalogue is the baseline. Explicit SPOT, FUTURE and
 * PERPETUAL-FUTURE queries are also unioned because Coinbase supports
 * product-type filtering and derivative visibility can vary by query.
 * Products are deduplicated by product_id, so repeated results never create
 * duplicate cards.
 */
export async function fetchCoinbaseInstruments(): Promise<CoinbaseInstrument[]> {
  const queries: Record<string, string>[] = [
    {},
    { product_type: 'SPOT' },
    { product_type: 'FUTURE' },
    { product_type: 'FUTURE', contract_expiry_type: 'PERPETUAL' },
  ];

  const responses = await Promise.all(queries.map(fetchAllCoinbaseProducts));
  const byProductId = new Map<string, CoinbaseInstrument>();

  for (const products of responses) {
    for (const raw of products) {
      const item = normalizeCoinbaseInstrument(raw);
      if (item) byProductId.set(item.symbol, item);
    }
  }

  const instruments = sortCoinbaseInstruments([...byProductId.values()]);
  if (!instruments.length) throw new Error('Coinbase returned an empty public product catalogue.');
  return instruments;
}

export function coinbaseCategoryLabel(category: CoinbaseInstrumentType) {
  switch (category) {
    case 'spot': return 'Spot';
    case 'perpetual': return 'Perpetual Futures';
    case 'future': return 'Futures';
    default: return 'Other';
  }
}
