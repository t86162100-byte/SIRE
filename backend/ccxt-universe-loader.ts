import ccxt from 'ccxt';

export type GlobalCryptoMarket = {
  id: string; exchange: string; exchangeName: string; symbol: string;
  base?: string; quote?: string; settle?: string; type?: string;
  spot?: boolean; margin?: boolean; swap?: boolean; future?: boolean; option?: boolean;
  active?: boolean; contract?: boolean; expiry?: number | null;
};

const exchangeOptions = { enableRateLimit: true, timeout: 15000 };
const priorityExchanges = ['binance', 'bybit', 'okx', 'coinbase', 'kraken', 'bitget', 'gateio', 'kucoin', 'mexc'];
let cachedMarkets: GlobalCryptoMarket[] = [];
let backgroundLoad: Promise<void> | null = null;

function mergeMarkets(markets: GlobalCryptoMarket[]) {
  const byId = new Map(cachedMarkets.map(m => [m.id, m]));
  for (const market of markets) byId.set(market.id, market);
  cachedMarkets = [...byId.values()];
}

async function loadExchange(id: string): Promise<GlobalCryptoMarket[]> {
  const Exchange = (ccxt as any)[id];
  if (!Exchange) return [];
  const exchange = new Exchange(exchangeOptions);
  const markets = await exchange.loadMarkets();
  return Object.values(markets as Record<string, any>)
    .filter((m: any) => m && m.active !== false)
    .map((m: any) => ({
      id: `CCXT:${id}:${m.id}`,
      exchange: id,
      exchangeName: exchange.name || id,
      symbol: m.symbol || m.id,
      base: m.base, quote: m.quote, settle: m.settle,
      type: m.type, spot: m.spot, margin: m.margin, swap: m.swap,
      future: m.future, option: m.option, active: m.active,
      contract: m.contract, expiry: m.expiry ?? null,
    }));
}

async function loadPriorityMarkets() {
  const settled = await Promise.allSettled(priorityExchanges.map(loadExchange));
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value.length) mergeMarkets(result.value);
  }
}

async function loadAllMarkets() {
  const exchangeIds = Object.keys(ccxt.exchanges);
  const concurrency = 4;
  const failed = new Set<string>();
  for (let i = 0; i < exchangeIds.length; i += concurrency) {
    const batch = exchangeIds.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(loadExchange));
    settled.forEach((result, index) => {
      const id = batch[index];
      if (result.status === 'fulfilled' && result.value.length) {
        mergeMarkets(result.value);
      } else {
        failed.add(id);
        console.warn('[SIRE GLOBAL CRYPTO] exchange load failed:', id, result.status === 'rejected' ? String(result.reason) : 'empty catalogue');
      }
    });
  }
  // Retry failed exchanges once after the full pass, so transient API failures
  // do not permanently exclude an exchange from the scrolling catalogue.
  if (failed.size) {
    const retryIds = [...failed];
    for (let i = 0; i < retryIds.length; i += concurrency) {
      const batch = retryIds.slice(i, i + concurrency);
      const settled = await Promise.allSettled(batch.map(loadExchange));
      settled.forEach((result, index) => {
        const id = batch[index];
        if (result.status === 'fulfilled' && result.value.length) mergeMarkets(result.value);
        else console.warn('[SIRE GLOBAL CRYPTO] exchange retry failed:', id);
      });
    }
  }
}

export async function loadGlobalCryptoUniverse(): Promise<GlobalCryptoMarket[]> {
  // Return the last-known-good cache immediately on every request.
  if (cachedMarkets.length) {
    if (!backgroundLoad) {
      backgroundLoad = loadAllMarkets().catch(error => {
        console.warn('[SIRE GLOBAL CRYPTO] background refresh failed:', error);
      }).finally(() => { backgroundLoad = null; });
    }
    return cachedMarkets;
  }

  // The first request gets a useful catalogue from major exchanges instead of
  // waiting for every CCXT exchange (many of which can be slow/unreachable).
  await loadPriorityMarkets();
  if (!cachedMarkets.length) {
    throw new Error('CCXT global crypto catalogue returned no active markets from priority exchanges.');
  }

  // Continue expanding the universe after the first response is available.
  if (!backgroundLoad) {
    backgroundLoad = loadAllMarkets().catch(error => {
      console.warn('[SIRE GLOBAL CRYPTO] background refresh failed:', error);
    }).finally(() => { backgroundLoad = null; });
  }
  return cachedMarkets;
}
