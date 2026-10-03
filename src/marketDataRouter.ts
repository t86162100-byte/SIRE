import { createDerivDataFeed, type DerivFeedDiagnostic } from './derivMarketData';

export type SireMarketProvider = string;

export type SireMarketQuote = {
  symbol: string;
  price: number;
  epoch: number;
  bid?: number;
  ask?: number;
};

export type SireMarketInstrument = {
  symbol: string;
  name: string;
  provider?: SireMarketProvider;
  [key: string]: unknown;
};

export type SireMarketFeed = ReturnType<typeof createDerivDataFeed>;

type DiagnosticSink = (event: DerivFeedDiagnostic & {
  stack?: string;
  location?: { file: string; line: number; column: number; functionName?: string };
  operation?: string;
}) => void;

export type MarketFeedFactory = (
  instrument: SireMarketInstrument,
  onQuote: (quote: SireMarketQuote) => void,
  reportDiagnostic: DiagnosticSink,
) => SireMarketFeed;

const providers = new Map<string, MarketFeedFactory>([
  ['DERIV', (_instrument, onQuote, reportDiagnostic) => createDerivDataFeed(onQuote, reportDiagnostic)],
]);

export function registerMarketFeed(provider: string, factory: MarketFeedFactory) {
  const key = String(provider || '').trim().toUpperCase();
  if (!key) throw new Error('SIRE market-data provider name is required.');
  providers.set(key, factory);
}

export function hasMarketFeed(provider?: string) {
  return providers.has(String(provider || '').trim().toUpperCase());
}

export function createSireMarketFeed(
  instrument: SireMarketInstrument,
  onQuote: (quote: SireMarketQuote) => void,
  reportDiagnostic: DiagnosticSink,
): SireMarketFeed {
  const provider = String(instrument.provider || '').trim().toUpperCase();
  const factory = providers.get(provider);
  if (!factory) {
    throw new Error(
      `SIRE market-data provider "${provider || 'UNKNOWN'}" has no chart adapter yet. ` +
      'The instrument may be catalogued, but SIRE will not invent a data source for it.',
    );
  }
  return factory(instrument, onQuote, reportDiagnostic);
}

export function listRegisteredMarketFeeds() {
  return Array.from(providers.keys()).sort();
}
