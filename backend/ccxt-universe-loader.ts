import ccxt from 'ccxt';

export type GlobalCryptoMarket = {
  id: string; exchange: string; exchangeName: string; symbol: string;
  base?: string; quote?: string; settle?: string; type?: string;
  spot?: boolean; margin?: boolean; swap?: boolean; future?: boolean; option?: boolean;
  active?: boolean; contract?: boolean; expiry?: number | null;
};

const exchangeOptions = { enableRateLimit: true, timeout: 15000 };
let cachedMarkets: GlobalCryptoMarket[] = [];
let fullLoad: Promise<GlobalCryptoMarket[]> | null = null;

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

async function loadEveryExchangeAtOnce(): Promise<GlobalCryptoMarket[]> {
  const exchangeIds = Object.keys(ccxt.exchanges);
  console.info('[SIRE GLOBAL CRYPTO] loading ALL CCXT exchanges and markets', { exchanges: exchangeIds.length });
  const concurrency = 8;
  const failed: string[] = [];

  // All exchanges participate in this one catalogue build. Concurrency limits
  // protect Render and exchange APIs, but the HTTP response waits for the
  // complete catalogue instead of returning a partial priority snapshot.
  for (let i = 0; i < exchangeIds.length; i += concurrency) {
    const batch = exchangeIds.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(loadExchange));
    settled.forEach((result, index) => {
      const id = batch[index];
      if (result.status === 'fulfilled' && result.value.length) mergeMarkets(result.value);
      else failed.push(id);
    });
  }

  if (failed.length) {
    console.warn('[SIRE GLOBAL CRYPTO] retrying failed exchanges', { count: failed.length, exchanges: failed });
    for (let i = 0; i < failed.length; i += concurrency) {
      const batch = failed.slice(i, i + concurrency);
      const settled = await Promise.allSettled(batch.map(loadExchange));
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.length) mergeMarkets(result.value);
      });
    }
  }

  console.info('[SIRE GLOBAL CRYPTO] ALL CCXT markets loaded', {
    exchanges: exchangeIds.length,
    markets: cachedMarkets.length,
    failedExchanges: failed.length,
  });
  return cachedMarkets;
}

export async function loadGlobalCryptoUniverse(): Promise<GlobalCryptoMarket[]> {
  // One complete catalogue build. Every caller shares the same promise, so
  // SIRE never serves separate partial snapshots to different clients.
  if (cachedMarkets.length) return cachedMarkets;
  if (!fullLoad) fullLoad = loadEveryExchangeAtOnce().catch(error => {
    fullLoad = null;
    throw error;
  });
  return fullLoad;
}
