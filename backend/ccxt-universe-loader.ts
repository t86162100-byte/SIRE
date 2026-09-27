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
let backgroundLoad: Promise<void> | null = null;

function mixMarkets(markets: GlobalCryptoMarket[]): GlobalCryptoMarket[] {
  const byExchange = new Map<string, GlobalCryptoMarket[]>();

  for (const market of markets) {
    const bucket = byExchange.get(market.exchange) || [];
    bucket.push(market);
    byExchange.set(market.exchange, bucket);
  }

  // Keep each exchange internally stable, but interleave exchanges so the
  // catalogue reads like a unified market list instead of exchange blocks.
  const exchanges = [...byExchange.keys()].sort();
  const mixed: GlobalCryptoMarket[] = [];
  const maxLength = Math.max(0, ...exchanges.map(exchange => byExchange.get(exchange)!.length));

  for (let index = 0; index < maxLength; index++) {
    for (const exchange of exchanges) {
      const market = byExchange.get(exchange)![index];
      if (market) mixed.push(market);
    }
  }

  return mixed;
}

function mergeMarkets(markets: GlobalCryptoMarket[]) {
  const byId = new Map(cachedMarkets.map(m => [m.id, m]));
  for (const market of markets) byId.set(market.id, market);
  cachedMarkets = mixMarkets([...byId.values()]);
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

async function loadExchanges(ids: string[]) {
  for (const id of ids) {
    try {
      const markets = await loadExchange(id);
      if (markets.length) {
        mergeMarkets(markets);
        console.info('[SIRE GLOBAL CRYPTO] exchange confirmed and added', {
          exchange: id, markets: markets.length, total: cachedMarkets.length,
        });
      } else {
        console.warn('[SIRE GLOBAL CRYPTO] exchange returned no active markets', { exchange: id });
      }
    } catch (error) {
      console.warn('[SIRE GLOBAL CRYPTO] exchange load failed', {
        exchange: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const initialExchanges = ['coinbase', 'kraken', 'kucoin', 'mexc', 'bitget'];

async function loadAllRemainingExchanges() {
  const all = Array.isArray((ccxt as any).exchanges) ? (ccxt as any).exchanges : Object.keys((ccxt as any).exchanges);
  const remaining = all.filter(id => !initialExchanges.includes(id));
  await loadExchanges(remaining);
  console.info('[SIRE GLOBAL CRYPTO] all exchanges processed', {
    exchanges: all.length, markets: cachedMarkets.length,
  });
}

export async function loadGlobalCryptoUniverse(): Promise<GlobalCryptoMarket[]> {
  if (cachedMarkets.length) {
    if (!backgroundLoad) {
      backgroundLoad = loadAllRemainingExchanges().catch(error => {
        console.warn('[SIRE GLOBAL CRYPTO] background expansion failed', error);
        backgroundLoad = null;
      });
    }
    return cachedMarkets;
  }

  if (!fullLoad) {
    fullLoad = loadExchanges(initialExchanges).then(() => {
      fullLoad = null;
      if (!backgroundLoad) {
        backgroundLoad = loadAllRemainingExchanges().catch(error => {
          console.warn('[SIRE GLOBAL CRYPTO] background expansion failed', error);
          backgroundLoad = null;
        });
      }
      return cachedMarkets;
    }).catch(error => {
      fullLoad = null;
      throw error;
    });
  }

  await fullLoad;
  return cachedMarkets;
}

export async function loadFullGlobalCryptoUniverse(): Promise<GlobalCryptoMarket[]> {
  await loadGlobalCryptoUniverse();
  if (backgroundLoad) await backgroundLoad;
  return cachedMarkets;
}
