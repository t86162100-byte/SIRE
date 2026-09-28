import { json } from '@appdeploy/sdk';

type AnyRecord = Record<string, any>;

async function getJson(url: string, timeoutMs = 12000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'SIRE-MarketCatalogue/1.0' } });
    if (!response.ok) throw new Error(response.status + ' ' + response.statusText + ' from ' + url);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function arrays(value: any): AnyRecord[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') for (const key of ['data','products','rows','list','result']) if (Array.isArray(value[key])) return value[key];
  return [];
}

function splitSymbol(symbol: string, separator = '') {
  const clean = String(symbol || '').trim().toUpperCase();
  if (separator && clean.includes(separator)) { const p = clean.split(separator); return { base: p[0], quote: p[1] || '' }; }
  for (const quote of ['USDT','USDC','USD','BTC','ETH','EUR']) if (clean.endsWith(quote) && clean.length > quote.length) return { base: clean.slice(0, -quote.length), quote };
  return { base: clean, quote: '' };
}

function makeInstrument(provider: string, raw: AnyRecord, symbol: string, marketType: string) {
  const parts = splitSymbol(symbol, provider === 'LBANK' ? '_' : '');
  const futures = /future|perpetual|swap/i.test(marketType);
  return {
    id: provider + ':' + marketType.toLowerCase() + ':' + symbol,
    provider, providerLabel: provider === 'PHEMEX' ? 'Phemex' : 'LBank',
    exchange: provider === 'PHEMEX' ? 'Phemex' : 'LBank',
    symbol, displaySymbol: symbol, name: raw.name || symbol, base: raw.base || parts.base, quote: raw.quote || parts.quote,
    marketType, category: futures ? 'Futures' : 'Crypto', instrumentType: marketType.toLowerCase(),
    exchangeOpen: 1, status: 'online', logoUrl: '',
    providerLogoUrl: 'https://www.google.com/s2/favicons?domain=' + (provider === 'PHEMEX' ? 'phemex.com' : 'lbank.com') + '&sz=128'
  };
}

async function phemexCatalogue() {
  const payload = await getJson('https://api.phemex.com/public/products');
  const result = payload?.result || payload?.data || payload || {};
  const families: Array<[AnyRecord[], string]> = [
    [arrays(result.spotProducts), 'Spot'],
    [arrays(result.spotProductsV2), 'Spot'],
    [arrays(result.perpProductsV2), 'Perpetual'],
    [arrays(result.perpProducts), 'Perpetual'],
    [arrays(result.products), 'Futures']
  ];
  const out: AnyRecord[] = []; const seen = new Set<string>();
  for (const [list, forcedType] of families) for (const raw of list) {
    const symbol = String(raw.symbol || raw.name || '').trim(); if (!symbol) continue;
    const status = String(raw.status || raw.symbolStatus || '').toLowerCase();
    if (['deleted','offline','closed','delisted'].some(x => status.includes(x))) continue;
    let marketType = forcedType;
    const t = String(raw.type || raw.productType || '').toLowerCase();
    if (forcedType === 'Futures' && (t.includes('spot'))) marketType = 'Spot';
    else if (forcedType === 'Futures' && (t.includes('perp') || t.includes('swap') || raw.expiryEp === 0 || raw.expiry === 0)) marketType = 'Perpetual';
    const key = marketType + ':' + symbol; if (seen.has(key)) continue; seen.add(key);
    out.push(makeInstrument('PHEMEX', raw, symbol, marketType));
  }
  if (!out.length) throw new Error('Phemex returned no active products');
  return out;
}

async function lbankCatalogue() {
  const [pairs, contracts] = await Promise.allSettled([
    getJson('https://api.lbkex.com/v2/currencyPairs.do'),
    getJson('https://lbkperp.lbank.com/cfd/openApi/v1/pub/instrument')
  ]);
  const out: AnyRecord[] = []; const seen = new Set<string>();
  const add = (raw: AnyRecord, symbol: string, marketType: string) => {
    const s = String(symbol || '').trim().toLowerCase(); if (!s) return;
    const key = marketType + ':' + s; if (seen.has(key)) return; seen.add(key);
    out.push(makeInstrument('LBANK', raw || {}, s, marketType));
  };
  if (pairs.status === 'fulfilled') {
    const list = pairs.value?.data || pairs.value?.pairs || pairs.value;
    if (Array.isArray(list)) for (const item of list) add(typeof item === 'string' ? {} : item, typeof item === 'string' ? item : item?.symbol, 'Spot');
  }
  if (contracts.status === 'fulfilled') {
    const list = contracts.value?.data || contracts.value?.result || contracts.value;
    for (const item of arrays(list)) {
      const symbol = item.symbol || item.contractCode || item.instrumentId || item.name;
      const type = String(item.type || item.productType || '').toLowerCase();
      add(item, symbol, type.includes('future') && !type.includes('perpetual') ? 'Futures' : 'Perpetual');
    }
  }
  if (!out.length) throw new Error('LBank returned no active products');
  return out;
}

export async function providerCatalogue(provider: string) {
  const key = provider.toUpperCase();
  if (key === 'PHEMEX') return phemexCatalogue();
  if (key === 'LBANK') return lbankCatalogue();
  throw new Error('Unsupported standalone provider: ' + provider);
}

export const providerRoute = async (provider: string) => {
  try { const instruments = await providerCatalogue(provider); return json({ ok: true, provider: provider.toUpperCase(), count: instruments.length, instruments, fetchedAt: Date.now() }); }
  catch (error) { return json({ ok: false, provider: provider.toUpperCase(), error: error instanceof Error ? error.message : String(error), instruments: [], fetchedAt: Date.now() }, 502); }
};