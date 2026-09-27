import ccxt from 'ccxt';

export type GlobalCryptoMarket = {
  id: string; exchange: string; exchangeName: string; symbol: string;
  base?: string; quote?: string; settle?: string; type?: string;
  spot?: boolean; margin?: boolean; swap?: boolean; future?: boolean; option?: boolean;
  active?: boolean; contract?: boolean; expiry?: number | null;
};

export async function loadGlobalCryptoUniverse(): Promise<GlobalCryptoMarket[]> {
  const exchangeIds = Object.keys(ccxt.exchanges);
  const results: GlobalCryptoMarket[] = [];
  const concurrency = 6;
  for (let i = 0; i < exchangeIds.length; i += concurrency) {
    const batch = exchangeIds.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(async id => {
      const Exchange = (ccxt as any)[id];
      if (!Exchange) return [];
      const exchange = new Exchange({ enableRateLimit: true, timeout: 15000 });
      const markets = await exchange.loadMarkets();
      return Object.values(markets as Record<string, any>)
        .filter((m: any) => m && (m.active !== false))
        .map((m: any) => ({
          id: `CCXT:${id}:${m.id}`,
          exchange: id,
          exchangeName: exchange.name || id,
          symbol: m.symbol || m.id,
          base: m.base, quote: m.quote, settle: m.settle,
          type: m.type, spot: m.spot, margin: m.margin, swap: m.swap,
          future: m.future, option: m.option, active: m.active,
          contract: m.contract, expiry: m.expiry ?? null
        }));
    }));
    for (const r of settled) if (r.status === 'fulfilled') results.push(...r.value);
  }
  const seen = new Set<string>();
  return results.filter(m => !seen.has(m.id) && seen.add(m.id));
}
