import { useState, type ReactNode } from 'react';
import type { Instrument } from './App';

type CardProps = {
  item: Instrument;
  active: boolean;
  onSelect: (item: Instrument) => void;
  group: string;
  subgroup: string;
  subSubgroup: string;
};

const esc = (value: unknown) => String(value ?? '').trim();
const upper = (value: unknown) => esc(value).toUpperCase();
const n = (value: unknown) => {
  const v = Number(value);
  return Number.isFinite(v) ? v : NaN;
};
const rawOf = (item: Instrument) => item as any;

const priceOf = (item: Instrument) => {
  const v = n(item.price);
  if (!Number.isFinite(v)) return '';
  return v.toLocaleString(undefined, { maximumFractionDigits: v >= 1 ? 2 : 8 });
};
const compact = (value: unknown) => {
  const v = n(value);
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toLocaleString(undefined, { maximumFractionDigits: 8 });
};
const pctOf = (item: Instrument) => {
  const v = n(item.priceChangePercent ?? item.change24h);
  if (!Number.isFinite(v)) return '';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
};
const pctClass = (item: Instrument) => n(item.priceChangePercent ?? item.change24h) >= 0 ? 'up' : 'down';

const symbolOf = (item: Instrument) => upper(item.displaySymbol || item.symbol);
const nameOf = (item: Instrument) => esc(item.name || item.displaySymbol || item.symbol);
const providerOf = (item: Instrument) => upper(item.providerLabel || item.provider);
const quoteOf = (item: Instrument) => upper(item.quote);
const volumeOf = (item: Instrument) => compact(rawOf(item).volume24h ?? rawOf(item).volume);
const marketCapOf = (item: Instrument) => compact(rawOf(item).marketCap ?? rawOf(item).market_cap ?? rawOf(item).mktCap);
const fdvOf = (item: Instrument) => compact(rawOf(item).fdv ?? rawOf(item).FDV ?? rawOf(item).fullyDilutedValuation);
const supplyOf = (item: Instrument) => compact(rawOf(item).circulatingSupply ?? rawOf(item).circulating_supply ?? rawOf(item).supply);
const oiOf = (item: Instrument) => compact(rawOf(item).openInterest ?? rawOf(item).oi ?? rawOf(item).holdingAmount);
const oiOf = (item: Instrument) => compact(rawOf(item).openInterest ?? rawOf(item).oi ?? rawOf(item).holdingAmount);
const change7dOf = (item: Instrument) => {
  const v = n(rawOf(item).change7d ?? rawOf(item).priceChange7d ?? rawOf(item).change7D);
  return Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '';
};
const highOf = (item: Instrument) => compact(rawOf(item).high24h ?? rawOf(item).high ?? rawOf(item).dayHigh);
const lowOf = (item: Instrument) => compact(rawOf(item).low24h ?? rawOf(item).low ?? rawOf(item).dayLow);
const openOf = (item: Instrument) => compact(rawOf(item).open24h ?? rawOf(item).open ?? rawOf(item).openPrice24h);
const spreadOf = (item: Instrument) => {
  const bid = n(item.bid), ask = n(item.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return '';
  return compact(ask - bid);
};
const ratioOf = (item: Instrument, ...keys: string[]) => {
  const raw = rawOf(item);
  for (const key of keys) {
    const v = n(raw[key]);
    if (Number.isFinite(v)) return v.toFixed(2) + 'x';
  }
  return '';
};
const percentField = (item: Instrument, ...keys: string[]) => {
  const raw = rawOf(item);
  for (const key of keys) {
    const v = n(raw[key]);
    if (Number.isFinite(v)) return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  return '';
};
const ivOf = (item: Instrument) => percentField(item, 'impliedVolatility', 'impliedVol', 'iv');
const deltaOf = (item: Instrument) => rawNumber(item, ['delta']);
const gammaOf = (item: Instrument) => rawNumber(item, ['gamma']);
const thetaOf = (item: Instrument) => rawNumber(item, ['theta']);
const vegaOf = (item: Instrument) => rawNumber(item, ['vega']);
const rhoOf = (item: Instrument) => rawNumber(item, ['rho']);
function rawNumber(item: Instrument, keys: string[]) {
  const raw = rawOf(item);
  for (const key of keys) {
    const v = n(raw[key]);
    if (Number.isFinite(v)) return v.toFixed(4);
  }
  return '';
}
const peOf = (item: Instrument) => ratioOf(item, 'peRatio', 'pe');
const dividendYieldOf = (item: Instrument) => percentField(item, 'dividendYield', 'dividendYieldPercent');
const expenseRatioOf = (item: Instrument) => percentField(item, 'expenseRatio', 'expenseRatioPercent');
const aumOf = (item: Instrument) => compact(rawOf(item).aum ?? rawOf(item).AUM ?? rawOf(item).assetsUnderManagement);
const premiumDiscountOf = (item: Instrument) => percentField(item, 'premiumDiscount', 'navPremiumDiscount');
const couponOf = (item: Instrument) => percentField(item, 'couponRate', 'coupon');
const ytmOf = (item: Instrument) => percentField(item, 'ytm', 'yieldToMaturity');
const ytwOf = (item: Instrument) => percentField(item, 'ytw', 'yieldToWorst');
const ytcOf = (item: Instrument) => percentField(item, 'ytc', 'yieldToCall');
const leverageOf = (item: Instrument) => ratioOf(item, 'leverage', 'maxLeverage');
const nextFundingOf = (item: Instrument) => {
  const value = rawOf(item).nextFundingTime ?? rawOf(item).fundingTime;
  if (!value) return '';
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const lastUpdatedOf = (item: Instrument) => {
  const value = rawOf(item).ts ?? rawOf(item).timestamp ?? rawOf(item).updatedAt;
  if (!value) return '';
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const fundingOf = (item: Instrument) => {
  const v = n(rawOf(item).fundingRate ?? rawOf(item).funding);
  return Number.isFinite(v) ? (v * 100).toFixed(3) + '%' : '';
};
const bidOf = (item: Instrument) => {
  const v = n(item.bid);
  return Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: v >= 1 ? 5 : 8 }) : '';
};
const askOf = (item: Instrument) => {
  const v = n(item.ask);
  return Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: v >= 1 ? 5 : 8 }) : '';
};
const expiryOf = (item: Instrument) => esc(rawOf(item).expiry ?? rawOf(item).expiration ?? rawOf(item).expirationTime);
const settlementOf = (item: Instrument) => upper(rawOf(item).settlement || rawOf(item).settleCoin);
const optionTypeOf = (item: Instrument) => upper(rawOf(item).optionType);
const strikeOf = (item: Instrument) => compact(rawOf(item).strike);
const networkOf = (item: Instrument) => upper(rawOf(item).network || rawOf(item).chain);
const protocolOf = (item: Instrument) => upper(rawOf(item).protocol || rawOf(item).venue);
const tvlOf = (item: Instrument) => compact(rawOf(item).tvl ?? rawOf(item).TVL);
const aprOf = (item: Instrument) => {
  const v = n(rawOf(item).apr ?? rawOf(item).apy);
  return Number.isFinite(v) ? v.toFixed(2) + '%' : '';
};
const providerAliases: Record<string,string> = {
  gateio: 'gate-io', gate: 'gate-io', cryptocom: 'crypto-com', pancakeswap: 'pancake-swap',
  sushiswap: 'sushi', traderjoe: 'trader-joe', coindcx: 'coindcx', digifinex: 'digifinex',
  oneinch: '1inch', nasdaqtrader: 'nasdaq', woox: 'woo-x', globalcrypto: 'binance'
};
const providerDomains: Record<string,string> = {
  binance:'binance.com', bitget:'bitget.com', gateio:'gate.io', bybit:'bybit.com', okx:'okx.com',
  kraken:'kraken.com', coinbase:'coinbase.com', kucoin:'kucoin.com', mexc:'mexc.com',
  gemini:'gemini.com', bitfinex:'bitfinex.com', bitstamp:'bitstamp.net', coinex:'coinex.com',
  htx:'htx.com', phemex:'phemex.com', whitebit:'whitebit.com', bingx:'bingx.com',
  uniswap:'uniswap.org', curve:'curve.fi', pancakeswap:'pancakeswap.finance',
  sushiswap:'sushi.com', raydium:'raydium.io', jupiter:'jup.ag', orca:'orca.so',
  aerodrome:'aerodrome.finance', traderjoe:'traderjoexyz.com', oneinch:'1inch.io',
  cowswap:'swap.cow.fi', balancer:'balancer.fi', polymarket:'polymarket.com',
  kalshi:'kalshi.com', opinion:'opinion.trade', deriv:'deriv.com'
};
const providerKeyOf = (item: Instrument) =>
  String(item.exchange || item.providerLabel || item.provider || '').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const providerLogoSources = (item: Instrument) => {
  const key = providerKeyOf(item);
  const slug = providerAliases[key] || key;
  const domain = providerDomains[key] || (key ? key + '.com' : '');
  const out = [
    item.providerLogoUrl,
    slug ? 'https://cdn.simpleicons.org/' + encodeURIComponent(slug) : '',
    domain ? 'https://' + domain + '/favicon.ico' : '',
    domain ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=128' : '',
  ].filter(Boolean) as string[];
  const label = providerOf(item).slice(0,2) || '?';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#111"/><text x="32" y="38" text-anchor="middle" font-family="Arial" font-size="22" font-weight="900" fill="#fff">' + label + '</text></svg>';
  out.push('data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg));
  return Array.from(new Set(out));
};
const assetLogoSources = (item: Instrument) => {
  const base = esc(item.base).toLowerCase();
  const out = [assetLogo(item)];
  if (base) {
    out.push('https://cdn.jsdelivr.net/gh/vadimmalykhin/binance-icons/crypto/' + encodeURIComponent(base) + '.svg');
    out.push('https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + encodeURIComponent(base) + '.png');
  }
  const label = symbolOf(item).slice(0,2) || '?';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#111"/><text x="32" y="38" text-anchor="middle" font-family="Arial" font-size="22" font-weight="900" fill="#fff">' + label + '</text></svg>';
  out.push('data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg));
  return Array.from(new Set(out.filter(Boolean)));
};

const Logo = ({ item, type }: { item: Instrument; type: 'asset' | 'provider' }) => {
  const sources = type === 'asset' ? assetLogoSources(item) : providerLogoSources(item);
  const [index,setIndex] = useState(0);
  const src = sources[Math.min(index, sources.length - 1)];
  return (
    <span className={type === 'asset' ? 'mc-logo mc-logo-asset' : 'mc-logo mc-logo-provider'}>
      <img
        src={src}
        alt=""
        decoding="async"
        loading="lazy"
        onError={() => setIndex(value => Math.min(value + 1, sources.length - 1))}
      />
    </span>
  );
};

const Venue = ({ item, compactMode = false }: { item: Instrument; compactMode?: boolean }) => (
  <span className={compactMode ? 'mc-venue mc-venue-compact' : 'mc-venue'}>
    <Logo item={item} type="provider" />
    <b>{providerOf(item)}</b>
  </span>
);

const Shell = ({ item, active, onSelect, className, children }: CardProps & { className: string; children: ReactNode }) => (
  <button
    type="button"
    className={'symbol-row mc-card ' + className + (active ? ' is-active' : '')}
    onClick={() => onSelect(item)}
  >
    {children}
  </button>
);

const Identity = ({ item, title, subtitle, extra }: { item: Instrument; title?: string; subtitle?: string; extra?: React.ReactNode }) => (
  <div className="mc-identity">
    <strong>{title || symbolOf(item)}</strong>
    <small>{subtitle || nameOf(item)}</small>
    {extra}
  </div>
);

const Price = ({ item, label }: { item: Instrument; label?: string }) => (
  <div className="mc-price">
    {label && <small>{label}</small>}
    <strong>{priceOf(item) || '—'}</strong>
    {pctOf(item) && <em className={pctClass(item)}>{pctOf(item)}</em>}
  </div>
);

const Meta = ({ children }: { children: React.ReactNode }) => <div className="mc-meta">{children}</div>;
const M = ({ label, value }: { label: string; value?: unknown }) => (
  <span className="mc-metric">
    <b>{label}</b>
    <i>{esc(value) || '—'}</i>
  </span>
);

const CryptoSpotCard = (p: CardProps) => {
  const { item } = p;
  const raw = rawOf(item);
  const variant = upper(p.subSubgroup);
  const quote = quoteOf(item);
  const title = symbolOf(item) + (quote ? ' / ' + quote : '');
  const lower = variant !== 'ALL' ? variant + ' MARKET' : nameOf(item);
  return (
    <Shell {...p} className={'mc-crypto-spot mc-spot-' + variant.toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
      <Logo item={item} type="asset" />
      <Identity item={item} title={title} subtitle={lower} extra={<Venue item={item} compactMode />} />
      <Price item={item} />
      <Meta><M label="VOL" value={volumeOf(item)} /><M label="MC" value={marketCapOf(item)} /><M label="24H" value={pctOf(item)} /><M label="7D" value={change7dOf(item)} /><M label="BID" value={bidOf(item)} /><M label="ASK" value={askOf(item)} /><M label="SPR" value={spreadOf(item)} /><M label="SUP" value={supplyOf(item)} /></Meta>
    </Shell>
  );
};

const CryptoOptionsCard = (p: CardProps) => {
  const { item } = p;
  const raw = rawOf(item);
  return (
    <Shell {...p} className={'mc-crypto-options mc-options-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
      <Logo item={item} type="asset" />
      <div className="mc-option-body">
        <Identity item={item} title={symbolOf(item)} subtitle={[optionTypeOf(item), expiryOf(item)].filter(Boolean).join(' · ') || nameOf(item)} extra={<Venue item={item} compactMode />} />
        <Meta><M label="STR" value={strikeOf(item)} /><M label="BID" value={bidOf(item)} /><M label="ASK" value={askOf(item)} /><M label="IV" value={ivOf(item)} /><M label="VOL" value={volumeOf(item)} /><M label="OI" value={oiOf(item)} /><M label="Δ" value={deltaOf(item)} /><M label="Γ" value={gammaOf(item)} /><M label="Θ" value={thetaOf(item)} /><M label="V" value={vegaOf(item)} /><M label="R" value={rhoOf(item)} /></Meta>
      </div>
      <Price item={item} />
    </Shell>
  );
};

const CryptoFuturesCard = (p: CardProps) => {
  const { item } = p;
  return (
    <Shell {...p} className={'mc-crypto-futures mc-futures-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
      <Logo item={item} type="asset" />
      <div className="mc-derivative-body">
        <Identity item={item} title={symbolOf(item)} subtitle={[settlementOf(item) || 'FUTURES', expiryOf(item) ? 'EXP ' + expiryOf(item) : ''].filter(Boolean).join(' · ')} extra={<Venue item={item} compactMode />} />
        <Meta><M label="VOL" value={volumeOf(item)} /><M label="OI" value={oiOf(item)} /><M label="MARK" value={compact(rawOf(item).markPrice ?? rawOf(item).markPr)} /><M label="INDEX" value={compact(rawOf(item).indexPrice ?? rawOf(item).indexPr)} /><M label="FUND" value={fundingOf(item)} /><M label="HIGH" value={highOf(item)} /><M label="LOW" value={lowOf(item)} /><M label="SET" value={settlementOf(item)} /><M label="EXP" value={expiryOf(item)} /></Meta>
      </div>
      <Price item={item} />
    </Shell>
  );
};

const CryptoPerpetualCard = (p: CardProps) => (
  <Shell {...p} className={'mc-crypto-perpetual mc-perp-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
    <Logo item={p.item} type="asset" />
    <div className="mc-perp-body">
      <div className="mc-perp-title"><strong>{symbolOf(p.item)} PERP</strong><span>{settlementOf(p.item) || 'PERPETUAL'}</span></div>
      <Venue item={p.item} compactMode />
      <Meta><M label="VOL" value={volumeOf(p.item)} /><M label="OI" value={oiOf(p.item)} /><M label="FUND" value={fundingOf(p.item)} /><M label="NEXT" value={nextFundingOf(p.item)} /><M label="MARK" value={compact(rawOf(p.item).markPrice ?? rawOf(p.item).markPr)} /><M label="INDEX" value={compact(rawOf(p.item).indexPrice ?? rawOf(p.item).indexPr)} /><M label="LEV" value={leverageOf(p.item)} /><M label="TICK" value={lastUpdatedOf(p.item)} /></Meta>
    </div>
    <Price item={p.item} />
  </Shell>
);

const CryptoAlphaCard = (p: CardProps) => (
  <Shell {...p} className="mc-crypto-alpha">
    <Logo item={p.item} type="asset" />
    <div className="mc-alpha-body">
      <Identity item={p.item} title={symbolOf(p.item)} subtitle={nameOf(p.item)} />
      <Venue item={p.item} compactMode />
      <Meta><M label="MC" value={marketCapOf(p.item)} /><M label="FDV" value={fdvOf(p.item)} /><M label="VOL" value={volumeOf(p.item)} /><M label="SUP" value={supplyOf(p.item)} /><M label="24H" value={pctOf(p.item)} /><M label="7D" value={change7dOf(p.item)} /><M label="CHAIN" value={networkOf(p.item)} /></Meta>
    </div>
    <Price item={p.item} />
  </Shell>
);

const ForexCard = (p: CardProps) => (
  <Shell {...p} className={'mc-forex mc-forex-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
    <span className="mc-fx-badge">{symbolOf(p.item).slice(0, 3)}</span>
    <div className="mc-fx-body">
      <strong>{symbolOf(p.item)}</strong>
      <small>{nameOf(p.item)}</small>
      <Venue item={p.item} compactMode />
      <Meta><M label="BID" value={bidOf(p.item)} /><M label="ASK" value={askOf(p.item)} /><M label="SPR" value={spreadOf(p.item)} /><M label="24H" value={pctOf(p.item)} /><M label="HIGH" value={highOf(p.item)} /><M label="LOW" value={lowOf(p.item)} /></Meta>
    </div>
    <Price item={p.item} />
  </Shell>
);

const StockCard = (p: CardProps) => (
  <Shell {...p} className={'mc-stock mc-stock-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
    <Logo item={p.item} type="asset" />
    <div className="mc-stock-body">
      <strong>{symbolOf(p.item)}</strong>
      <small>{nameOf(p.item)}</small>
      <Venue item={p.item} compactMode />
      <Meta><M label="VOL" value={volumeOf(p.item)} /><M label="MC" value={marketCapOf(p.item)} /><M label="PE" value={peOf(p.item)} /><M label="DIV" value={dividendYieldOf(p.item)} /><M label="HIGH" value={highOf(p.item)} /><M label="LOW" value={lowOf(p.item)} /></Meta>
    </div>
    <Price item={p.item} />
  </Shell>
);

const FundCard = (p: CardProps) => (
  <Shell {...p} className={'mc-fund mc-fund-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
    <Logo item={p.item} type="asset" />
    <div className="mc-fund-body">
      <strong>{symbolOf(p.item)}</strong>
      <small>{nameOf(p.item)}</small>
      <Venue item={p.item} compactMode />
      <Meta><M label="VOL" value={volumeOf(p.item)} /><M label="AUM" value={aumOf(p.item)} /><M label="NAV" value={priceOf(p.item)} /><M label="P/D" value={premiumDiscountOf(p.item)} /><M label="YLD" value={percentField(p.item,'yield','yieldPercent')} /><M label="FEE" value={expenseRatioOf(p.item)} /></Meta>
    </div>
    <Price item={p.item} label="NAV" />
  </Shell>
);

const CommodityCard = (p: CardProps) => (
  <Shell {...p} className={'mc-commodity mc-commodity-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
    <span className="mc-commodity-mark">{symbolOf(p.item).slice(0, 3)}</span>
    <div className="mc-commodity-body">
      <strong>{symbolOf(p.item)}</strong>
      <small>{nameOf(p.item)}</small>
      <Venue item={p.item} compactMode />
      <Meta><M label="VOL" value={volumeOf(p.item)} /><M label="OI" value={oiOf(p.item)} /><M label="HIGH" value={highOf(p.item)} /><M label="LOW" value={lowOf(p.item)} /><M label="OPEN" value={openOf(p.item)} /><M label="EXP" value={expiryOf(p.item)} /></Meta>
    </div>
    <Price item={p.item} />
  </Shell>
);

const IndexCard = (p: CardProps) => (
  <Shell {...p} className={'mc-index mc-index-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
    <span className="mc-index-mark">{symbolOf(p.item).slice(0, 4)}</span>
    <div className="mc-index-body">
      <strong>{nameOf(p.item)}</strong>
      <small>{symbolOf(p.item)}</small>
      <Venue item={p.item} compactMode />
      <Meta><M label="HIGH" value={highOf(p.item)} /><M label="LOW" value={lowOf(p.item)} /><M label="OPEN" value={openOf(p.item)} /><M label="VOL" value={volumeOf(p.item)} /><M label="MC" value={marketCapOf(p.item)} /></Meta>
    </div>
    <Price item={p.item} />
  </Shell>
);

const BondCard = (p: CardProps) => {
  const y = n(rawOf(p.item).yield ?? rawOf(p.item).yieldPercent ?? rawOf(p.item).ytm);
  return (
    <Shell {...p} className={'mc-bond mc-bond-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
      <span className="mc-bond-mark">BOND</span>
      <div className="mc-bond-body">
        <strong>{nameOf(p.item)}</strong>
        <small>{symbolOf(p.item)}</small>
        <Venue item={p.item} compactMode />
        <Meta><M label="MAT" value={rawOf(p.item).maturity ?? rawOf(p.item).maturityDate} /><M label="PX" value={priceOf(p.item)} /><M label="COUP" value={couponOf(p.item)} /><M label="YTM" value={ytmOf(p.item)} /><M label="YTW" value={ytwOf(p.item)} /><M label="YTC" value={ytcOf(p.item)} /><M label="RATING" value={rawOf(p.item).creditRating ?? rawOf(p.item).rating} /></Meta>
      </div>
      <div className="mc-price mc-bond-price"><small>YIELD</small><strong>{Number.isFinite(y) ? y.toFixed(2) + '%' : priceOf(p.item) || '—'}</strong><em className={pctClass(p.item)}>{pctOf(p.item)}</em></div>
    </Shell>
  );
};

const TradFiOptionsCard = (p: CardProps) => (
  <Shell {...p} className={'mc-tradfi-options mc-tf-options-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
    <span className="mc-contract-mark">OPT</span>
    <div className="mc-contract-body">
      <strong>{symbolOf(p.item)}</strong>
      <small>{[optionTypeOf(p.item), expiryOf(p.item)].filter(Boolean).join(' · ') || nameOf(p.item)}</small>
      <Venue item={p.item} compactMode />
      <Meta><M label="STR" value={strikeOf(p.item)} /><M label="BID" value={bidOf(p.item)} /><M label="ASK" value={askOf(p.item)} /><M label="MARK" value={compact(rawOf(p.item).markPrice ?? rawOf(p.item).mark)} /><M label="IV" value={ivOf(p.item)} /><M label="VOL" value={volumeOf(p.item)} /><M label="OI" value={oiOf(p.item)} /><M label="Δ" value={deltaOf(p.item)} /><M label="Γ" value={gammaOf(p.item)} /><M label="Θ" value={thetaOf(p.item)} /><M label="V" value={vegaOf(p.item)} /></Meta>
    </div>
    <Price item={p.item} />
  </Shell>
);

const TradFiFuturesCard = (p: CardProps) => (
  <Shell {...p} className={'mc-tradfi-futures mc-tf-futures-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
    <span className="mc-contract-mark">FUT</span>
    <div className="mc-contract-body">
      <strong>{symbolOf(p.item)}</strong>
      <small>{[nameOf(p.item), expiryOf(p.item) ? 'EXP ' + expiryOf(p.item) : ''].filter(Boolean).join(' · ')}</small>
      <Venue item={p.item} compactMode />
      <Meta><M label="VOL" value={volumeOf(p.item)} /><M label="OI" value={oiOf(p.item)} /><M label="HIGH" value={highOf(p.item)} /><M label="LOW" value={lowOf(p.item)} /><M label="INDEX" value={compact(rawOf(p.item).indexPrice)} /><M label="MARK" value={compact(rawOf(p.item).markPrice)} /><M label="EXP" value={expiryOf(p.item)} /></Meta>
    </div>
    <Price item={p.item} />
  </Shell>
);

const TradFiPerpetualCard = (p: CardProps) => (
  <Shell {...p} className={'mc-tradfi-perpetual mc-tf-perp-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
    <span className="mc-contract-mark">PERP</span>
    <div className="mc-contract-body">
      <strong>{symbolOf(p.item)}</strong>
      <small>{nameOf(p.item)}</small>
      <Venue item={p.item} compactMode />
      <Meta><M label="VOL" value={volumeOf(p.item)} /><M label="OI" value={oiOf(p.item)} /><M label="FUND" value={fundingOf(p.item)} /><M label="NEXT" value={nextFundingOf(p.item)} /><M label="MARK" value={compact(rawOf(p.item).markPrice)} /><M label="INDEX" value={compact(rawOf(p.item).indexPrice)} /><M label="LEV" value={leverageOf(p.item)} /></Meta>
    </div>
    <Price item={p.item} />
  </Shell>
);

const OnchainCard = (p: CardProps) => {
  const raw = rawOf(p.item);
  const pool = upper(raw.instrumentType).includes('POOL') || raw.tvl != null || raw.apr != null;
  return pool ? (
    <Shell {...p} className={'mc-onchain-pool mc-onchain-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
      <span className="mc-pair-logos"><Logo item={p.item} type="asset" /></span>
      <div className="mc-pool-body">
        <strong>{upper(raw.pair || raw.poolName || symbolOf(p.item))}</strong>
        <small>{[networkOf(p.item), protocolOf(p.item)].filter(Boolean).join(' · ')}</small>
        <Venue item={p.item} compactMode />
        <Meta><M label="TVL" value={tvlOf(p.item)} /><M label="VOL" value={volumeOf(p.item)} /><M label="APR" value={aprOf(p.item)} /><M label="FEES" value={compact(raw.tvlFees ?? raw.fees24h ?? raw.fees)} /><M label="1D" value={compact(raw.volume1d ?? raw.volume24h)} /><M label="30D" value={compact(raw.volume30d)} /><M label="FEE" value={percentField(p.item,'feeTier','fee')} /></Meta>
      </div>
      <Price item={p.item} label="RATE" />
    </Shell>
  ) : (
    <Shell {...p} className={'mc-onchain-token mc-onchain-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
      <Logo item={p.item} type="asset" />
      <div className="mc-token-body">
        <strong>{symbolOf(p.item)}</strong>
        <small>{nameOf(p.item)}</small>
        <Venue item={p.item} compactMode />
        <Meta><M label="VOL" value={volumeOf(p.item)} /><M label="FDV" value={fdvOf(p.item)} /><M label="MC" value={marketCapOf(p.item)} /><M label="TVL" value={tvlOf(p.item)} /><M label="SUP" value={supplyOf(p.item)} /><M label="CHAIN" value={networkOf(p.item)} /><M label="LIQ" value={compact(raw.liquidity)} /><M label="HOLD" value={compact(raw.holders)} /></Meta>
      </div>
      <Price item={p.item} />
    </Shell>
  );
};

const PredictionCard = (p: CardProps) => {
  const raw = rawOf(p.item);
  const prob = n(raw.probability ?? raw.impliedProbability);
  const probability = Number.isFinite(prob) ? (prob <= 1 ? prob * 100 : prob).toFixed(1) + '%' : '';
  return (
    <Shell {...p} className={'mc-prediction mc-pred-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
      <span className="mc-event-mark">?</span>
      <div className="mc-event-body">
        <strong>{esc(raw.question || raw.event || nameOf(p.item))}</strong>
        <small>{esc(raw.outcome || raw.selectedOutcome || 'MARKET')}</small>
        <Venue item={p.item} compactMode />
        <Meta><M label="VOL" value={volumeOf(p.item)} /><M label="TODAY" value={compact(raw.volume24h ?? raw.dailyVolume)} /><M label="LIQ" value={compact(raw.liquidity)} /><M label="END" value={expiryOf(p.item)} /><M label="OUTCOME" value={esc(raw.outcome ?? raw.selectedOutcome)} /></Meta>
      </div>
      <div className="mc-price mc-prob-price"><small>PROB</small><strong>{probability || priceOf(p.item) || '—'}</strong><em className={pctClass(p.item)}>{pctOf(p.item)}</em></div>
    </Shell>
  );
};

const SyntheticCard = (p: CardProps) => (
  <Shell {...p} className={'mc-synthetic mc-synth-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
    <span className="mc-synthetic-mark">IDX</span>
    <div className="mc-synthetic-body">
      <strong>{nameOf(p.item)}</strong>
      <small>{symbolOf(p.item)}</small>
      <Venue item={p.item} compactMode />
      <Meta><M label="VOL" value={volumeOf(p.item)} /><M label="HIGH" value={highOf(p.item)} /><M label="LOW" value={lowOf(p.item)} /><M label="24H" value={pctOf(p.item)} /><M label="BETA" value={rawOf(p.item).beta} /><M label="VOLAT" value={percentField(p.item,'volatility')} /></Meta>
    </div>
    <Price item={p.item} />
  </Shell>
);

const BasketCard = (p: CardProps) => (
  <Shell {...p} className={'mc-basket mc-basket-' + upper(p.subSubgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
    <span className="mc-basket-mark">BKT</span>
    <div className="mc-basket-body">
      <strong>{nameOf(p.item)}</strong>
      <small>{symbolOf(p.item)}</small>
      <Venue item={p.item} compactMode />
      <Meta><M label="CNT" value={rawOf(p.item).constituentCount ?? rawOf(p.item).constituentsCount} /><M label="VOL" value={volumeOf(p.item)} /><M label="MC" value={marketCapOf(p.item)} /><M label="24H" value={pctOf(p.item)} /><M label="WEIGHT" value={rawOf(p.item).weighting ?? rawOf(p.item).topWeight} /></Meta>
    </div>
    <Price item={p.item} />
  </Shell>
);

const DefaultCard = (p: CardProps) => (
  <Shell {...p} className="mc-default">
    <Logo item={p.item} type="asset" />
    <Identity item={p.item} extra={<Venue item={p.item} compactMode />} />
    <Price item={p.item} />
  </Shell>
);

export const MarketInstrumentCard = (props: CardProps) => {
  const group = upper(props.group);
  const sub = upper(props.subgroup);
  if (group === 'CRYPTO' && sub === 'SPOT') return <CryptoSpotCard {...props} />;
  if (group === 'CRYPTO' && sub === 'OPTIONS') return <CryptoOptionsCard {...props} />;
  if (group === 'CRYPTO' && sub === 'FUTURES') return <CryptoFuturesCard {...props} />;
  if (group === 'CRYPTO' && sub === 'PERPETUALS') return <CryptoPerpetualCard {...props} />;
  if (group === 'CRYPTO' && sub === 'ALPHA') return <CryptoAlphaCard {...props} />;
  if (group === 'TRADE FI' && sub === 'FOREX') return <ForexCard {...props} />;
  if (group === 'TRADE FI' && sub === 'STOCKS') return <StockCard {...props} />;
  if (group === 'TRADE FI' && sub === 'FUNDS') return <FundCard {...props} />;
  if (group === 'TRADE FI' && sub === 'COMMODITIES') return <CommodityCard {...props} />;
  if (group === 'TRADE FI' && sub === 'INDICES') return <IndexCard {...props} />;
  if (group === 'TRADE FI' && sub === 'BONDS') return <BondCard {...props} />;
  if (group === 'TRADE FI' && sub === 'OPTIONS') return <TradFiOptionsCard {...props} />;
  if (group === 'TRADE FI' && sub === 'FUTURES') return <TradFiFuturesCard {...props} />;
  if (group === 'TRADE FI' && sub === 'PERPETUALS') return <TradFiPerpetualCard {...props} />;
  if (group === 'ON CHAIN') return <OnchainCard {...props} />;
  if (group === 'PREDICTIONS') return <PredictionCard {...props} />;
  if (group === 'OTHERS' && sub === 'SYNTHETIC INDICES') return <SyntheticCard {...props} />;
  if (group === 'OTHERS' && sub === 'BASKETS') return <BasketCard {...props} />;
  return <DefaultCard {...props} />;
};

const styleId = 'sire-independent-market-cards-style';
if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = String.raw`
    .mc-card {
      --mc-pad: 10px;
      width:100%!important;
      min-height:76px!important;
      height:76px!important;
      padding:9px var(--mc-pad)!important;
      margin:0!important;
      border:0!important;
      border-bottom:1px solid rgba(255,255,255,.075)!important;
      border-radius:0!important;
      background:#000!important;
      color:#f5f5f7!important;
      display:grid!important;
      grid-template-columns:42px minmax(0,1fr) 92px!important;
      align-items:center!important;
      column-gap:10px!important;
      overflow:hidden!important;
      text-align:left!important;
      box-shadow:none!important;
      transition:background .12s ease!important;
    }
    .mc-card:hover,.mc-card:active,.mc-card.is-active { background:#050505!important; }
    .mc-card > * { min-width:0!important; }
    .mc-logo { width:38px!important;height:38px!important;aspect-ratio:1/1!important;border-radius:50%!important;overflow:hidden!important;display:grid!important;place-items:center!important;flex:0 0 38px!important;background:#20242b!important; }
    .mc-logo img { width:100%!important;height:100%!important;aspect-ratio:1/1!important;object-fit:contain!important;display:block!important;border-radius:50%!important; }
    .mc-logo-asset { grid-column:1!important; }
    .mc-logo-provider { width:14px!important;height:14px!important;flex:0 0 14px!important;background:#0b0b0b!important;border:1px solid rgba(255,255,255,.10)!important; }
    .mc-logo-provider img { width:14px!important;height:14px!important;object-fit:contain!important; }
    .mc-identity,.mc-option-body,.mc-derivative-body,.mc-perp-body,.mc-alpha-body,.mc-fx-body,.mc-stock-body,.mc-fund-body,.mc-commodity-body,.mc-index-body,.mc-bond-body,.mc-contract-body,.mc-pool-body,.mc-token-body,.mc-event-body,.mc-synthetic-body,.mc-basket-body {
      min-width:0!important;display:flex!important;flex-direction:column!important;gap:2px!important;overflow:hidden!important;
    }
    .mc-identity strong,.mc-option-body strong,.mc-derivative-body strong,.mc-alpha-body strong,.mc-fx-body strong,.mc-stock-body strong,.mc-fund-body strong,.mc-commodity-body strong,.mc-index-body strong,.mc-bond-body strong,.mc-contract-body strong,.mc-pool-body strong,.mc-token-body strong,.mc-event-body strong,.mc-synthetic-body strong,.mc-basket-body strong {
      min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:14px!important;line-height:1.05!important;font-weight:850!important;letter-spacing:-.015em!important;color:#f7f7f8!important;
    }
    .mc-identity small,.mc-option-body small,.mc-derivative-body small,.mc-alpha-body small,.mc-fx-body small,.mc-stock-body small,.mc-fund-body small,.mc-commodity-body small,.mc-index-body small,.mc-bond-body small,.mc-contract-body small,.mc-pool-body small,.mc-token-body small,.mc-event-body small,.mc-synthetic-body small,.mc-basket-body small {
      min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:9px!important;line-height:1.1!important;font-weight:600!important;color:rgba(235,235,240,.52)!important;
    }
    .mc-venue { display:flex!important;align-items:center!important;gap:4px!important;min-width:0!important;overflow:hidden!important; }
    .mc-venue b { min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:7px!important;line-height:1!important;font-weight:850!important;letter-spacing:.035em!important;color:rgba(240,240,245,.47)!important; }
    .mc-venue-compact { margin-top:1px!important; }
    .mc-price { grid-column:3!important;display:flex!important;flex-direction:column!important;align-items:flex-end!important;justify-content:center!important;gap:3px!important;white-space:nowrap!important;text-align:right!important; }
    .mc-price small { font-size:7px!important;line-height:1!important;font-weight:750!important;letter-spacing:.05em!important;color:rgba(235,235,240,.35)!important;text-transform:uppercase!important; }
    .mc-price strong { font-size:14px!important;line-height:1!important;font-weight:900!important;color:#fff!important;letter-spacing:-.02em!important; }
    .mc-price em { font-style:normal!important;font-size:9px!important;line-height:1!important;font-weight:850!important; }
    .mc-price em.up { color:#36d79b!important; }.mc-price em.down { color:#ff5570!important; }
    .mc-meta { display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;align-items:end!important;gap:5px 9px!important;min-width:0!important;overflow:hidden!important;margin-top:3px!important; }
    .mc-meta span { min-width:0!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;gap:2px!important;white-space:nowrap!important;font-size:7px!important;line-height:1!important;color:rgba(235,235,240,.52)!important;font-weight:700!important; }
    .mc-meta b { overflow:hidden!important;text-overflow:ellipsis!important;color:rgba(235,235,240,.28)!important;font-size:6px!important;line-height:1!important;font-weight:850!important;letter-spacing:.05em!important; }\n.mc-meta i { overflow:hidden!important;text-overflow:ellipsis!important;font-style:normal!important;color:rgba(245,245,248,.72)!important;font-size:7px!important;line-height:1!important;font-weight:800!important; }
    .mc-card > .mc-price { grid-row:1!important; }

    /* SPOT: Bitget-Wallet-like identity left / price right, with venue tucked into metadata. */
    .mc-crypto-spot { grid-template-columns:38px minmax(0,1fr) 92px!important; min-height:72px!important;height:72px!important; }
    .mc-crypto-spot .mc-meta { gap:7px!important; }
    .mc-crypto-spot .mc-logo { width:36px!important;height:36px!important;flex-basis:36px!important; }

    /* OPTIONS: contract identity and terms are deliberately denser and taller. */
    .mc-crypto-options,.mc-tradfi-options { grid-template-columns:38px minmax(0,1fr) 92px!important;min-height:86px!important;height:86px!important;align-items:center!important; }
    .mc-crypto-options .mc-meta,.mc-tradfi-options .mc-meta { margin-top:4px!important;gap:6px!important; }
    .mc-crypto-options .mc-price strong,.mc-tradfi-options .mc-price strong { font-size:15px!important; }
    .mc-contract-mark,.mc-commodity-mark,.mc-index-mark,.mc-bond-mark,.mc-event-mark,.mc-synthetic-mark,.mc-basket-mark {
      width:36px!important;height:36px!important;border-radius:11px!important;display:grid!important;place-items:center!important;font-size:7px!important;font-weight:900!important;letter-spacing:.04em!important;color:rgba(255,255,255,.72)!important;background:rgba(255,255,255,.07)!important;border:1px solid rgba(255,255,255,.09)!important;
    }

    /* FUTURES: expiry/settlement occupy a contract strip under the identity. */
    .mc-crypto-futures,.mc-tradfi-futures { grid-template-columns:38px minmax(0,1fr) 96px!important;min-height:82px!important;height:82px!important; }
    .mc-crypto-futures .mc-logo { width:36px!important;height:36px!important;flex-basis:36px!important; }
    .mc-crypto-futures .mc-meta,.mc-tradfi-futures .mc-meta { gap:7px!important; }
    .mc-crypto-futures .mc-price strong,.mc-tradfi-futures .mc-price strong { font-size:15px!important; }

    /* PERPETUALS: funding gets a distinct bottom data rail. */
    .mc-crypto-perpetual,.mc-tradfi-perpetual { grid-template-columns:38px minmax(0,1fr) 96px!important;min-height:80px!important;height:80px!important; }
    .mc-perp-title { display:flex!important;align-items:center!important;gap:6px!important;min-width:0!important; }
    .mc-perp-title strong { font-size:14px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important; }
    .mc-perp-title span { font-size:7px!important;color:rgba(255,255,255,.38)!important;font-weight:800!important; }
    .mc-crypto-perpetual .mc-meta,.mc-tradfi-perpetual .mc-meta { gap:8px!important; }

    /* ALPHA: flatter discovery row, more room for name/network. */
    .mc-crypto-alpha { grid-template-columns:38px minmax(0,1fr) 92px!important;min-height:78px!important;height:78px!important; }
    .mc-crypto-alpha .mc-meta { gap:8px!important; }

    /* FX: quote-pair badge rather than a generic token logo. */
    .mc-forex { grid-template-columns:38px minmax(0,1fr) 96px!important;min-height:80px!important;height:80px!important; }
    .mc-fx-badge { width:34px!important;height:34px!important;border-radius:50%!important;display:grid!important;place-items:center!important;background:rgba(255,255,255,.06)!important;border:1px solid rgba(255,255,255,.09)!important;font-size:7px!important;font-weight:900!important; }
    .mc-forex .mc-price strong { font-size:15px!important; }
    .mc-forex .mc-meta { gap:7px!important; }

    /* STOCKS: clean equity row with company name and exchange in metadata. */
    .mc-stock,.mc-fund { grid-template-columns:38px minmax(0,1fr) 94px!important;min-height:78px!important;height:78px!important; }
    .mc-stock .mc-logo,.mc-fund .mc-logo { width:34px!important;height:34px!important;flex-basis:34px!important; }
    .mc-stock .mc-price strong,.mc-fund .mc-price strong { font-size:15px!important; }

    /* FUNDS: NAV is the right anchor, AUM sits below identity. */
    .mc-fund { background:linear-gradient(90deg,rgba(255,255,255,.012),transparent 58%)!important; }

    /* COMMODITIES: physical/contract mark on the left, contract metrics below. */
    .mc-commodity,.mc-index,.mc-bond { grid-template-columns:40px minmax(0,1fr) 94px!important;min-height:82px!important;height:82px!important; }
    .mc-commodity .mc-meta,.mc-index .mc-meta,.mc-bond .mc-meta { gap:7px!important; }

    /* INDICES: index name is primary, symbol is secondary. */
    .mc-index .mc-index-mark { border-radius:8px!important;background:rgba(72,150,255,.08)!important;border-color:rgba(72,150,255,.16)!important; }
    .mc-index .mc-price strong { font-size:15px!important; }

    /* BONDS: yield is the right anchor while clean price remains in the data rail. */
    .mc-bond .mc-bond-mark { width:40px!important;border-radius:7px!important;font-size:6px!important; }
    .mc-bond-price strong { font-size:15px!important; }
    .mc-bond-price em { font-size:8px!important; }

    /* ONCHAIN TOKEN: logo + network/protocol identity; no exchange column. */
    .mc-onchain-token,.mc-onchain-pool { grid-template-columns:38px minmax(0,1fr) 96px!important;min-height:82px!important;height:82px!important; }
    .mc-onchain-token .mc-logo { width:36px!important;height:36px!important;flex-basis:36px!important; }
    .mc-pair-logos { width:36px!important;height:36px!important;display:grid!important;place-items:center!important; }
    .mc-pair-logos .mc-logo { width:36px!important;height:36px!important; }
    .mc-onchain-pool .mc-price strong { font-size:14px!important; }
    .mc-onchain-pool .mc-meta { gap:7px!important; }

    /* PREDICTIONS: question left, probability right. */
    .mc-prediction { grid-template-columns:38px minmax(0,1fr) 92px!important;min-height:84px!important;height:84px!important; }
    .mc-event-mark { border-radius:50%!important;background:rgba(112,90,255,.09)!important;border-color:rgba(112,90,255,.16)!important;font-size:14px!important; }
    .mc-prob-price strong { font-size:16px!important; }
    .mc-prob-price small { color:rgba(255,255,255,.42)!important; }

    /* SYNTHETIC / BASKET: analytical rows, intentionally not token-like. */
    .mc-synthetic,.mc-basket { grid-template-columns:42px minmax(0,1fr) 94px!important;min-height:78px!important;height:78px!important; }
    .mc-synthetic-mark,.mc-basket-mark { border-radius:8px!important; }
    .mc-synthetic-mark { background:rgba(0,220,190,.07)!important;border-color:rgba(0,220,190,.13)!important; }
    .mc-basket-mark { background:rgba(255,190,80,.07)!important;border-color:rgba(255,190,80,.13)!important; }

    /* Sub-filter-specific treatments: same data hierarchy, deliberately different visual rhythm. */
    .mc-spot-usdt { border-left:2px solid rgba(44,196,255,.18)!important; }
    .mc-spot-usdc { border-left:2px solid rgba(55,220,190,.18)!important; }
    .mc-spot-fdusd { border-left:2px solid rgba(255,190,80,.18)!important; }
    .mc-spot-btc { border-left:2px solid rgba(255,160,70,.18)!important; }
    .mc-spot-fiat { border-left:2px solid rgba(150,150,255,.18)!important; }
    .mc-futures-usd-m .mc-meta { padding-left:4px!important;border-left:2px solid rgba(65,160,255,.18)!important; }
    .mc-futures-coin-m .mc-meta { padding-left:4px!important;border-left:2px solid rgba(255,170,70,.18)!important; }
    .mc-futures-expiring { background:rgba(255,185,70,.018)!important; }
    .mc-perp-usd-m .mc-meta,.mc-perp-usdc-m .mc-meta { border-top:1px solid rgba(255,255,255,.055)!important;padding-top:3px!important; }
    .mc-options-calls .mc-price em.up { text-shadow:0 0 8px rgba(54,215,155,.18)!important; }
    .mc-options-puts .mc-price em.down { text-shadow:0 0 8px rgba(255,85,112,.18)!important; }
    .mc-forex-major-pairs { min-height:82px!important;height:82px!important; }
    .mc-forex-minor-pairs { min-height:76px!important;height:76px!important; }
    .mc-forex-exotic-pairs { min-height:84px!important;height:84px!important; }
    .mc-stock-us-stocks .mc-price,.mc-stock-european-stocks .mc-price,.mc-stock-asian-stocks .mc-price { border-left:1px solid rgba(255,255,255,.06)!important;padding-left:8px!important; }
    .mc-fund-etfs .mc-price { background:rgba(255,255,255,.018)!important;padding:5px 6px!important;border-radius:7px!important; }
    .mc-fund-mutual-funds .mc-meta { font-size:7px!important; }
    .mc-commodity-metals .mc-commodity-mark { background:rgba(245,190,80,.08)!important; }
    .mc-commodity-energy .mc-commodity-mark { background:rgba(100,120,140,.09)!important; }
    .mc-index-us-indices .mc-index-mark { border-radius:50%!important; }
    .mc-index-european-indices .mc-index-mark { border-radius:6px!important; }
    .mc-index-asian-indices .mc-index-mark { border-radius:3px!important; }
    .mc-bond-government .mc-bond-mark,.mc-bond-corporate .mc-bond-mark { letter-spacing:.02em!important; }
    .mc-tf-options-calls .mc-price,.mc-tf-options-puts .mc-price { border-left:1px solid rgba(255,255,255,.06)!important;padding-left:8px!important; }
    .mc-tf-futures-equity-index-futures,.mc-tf-futures-interest-rate-futures { min-height:84px!important;height:84px!important; }
    .mc-tf-perp-index-perpetuals .mc-contract-mark { border-radius:50%!important; }
    .mc-onchain-dex .mc-meta { border-top:1px solid rgba(255,255,255,.05)!important;padding-top:3px!important; }
    .mc-onchain-lending .mc-price strong { font-size:15px!important; }
    .mc-onchain-staking .mc-meta span:last-child { color:rgba(54,215,155,.65)!important; }
    .mc-onchain-liquidity-pools { min-height:86px!important;height:86px!important; }
    .mc-pred-sports .mc-event-mark { border-radius:8px!important; }
    .mc-pred-politics .mc-event-mark { border-radius:50%!important; }
    .mc-pred-crypto .mc-event-mark { border-radius:6px!important; }
    .mc-pred-finance .mc-event-mark { border-radius:3px!important; }
    .mc-synth-volatility .mc-price,.mc-synth-volatility-index .mc-price { border-left:1px solid rgba(255,255,255,.06)!important;padding-left:8px!important; }
    .mc-basket-crypto-baskets .mc-basket-mark { border-radius:50%!important; }
    .mc-basket-stock-baskets .mc-basket-mark { border-radius:8px!important; }
    .mc-basket-commodity-baskets .mc-basket-mark { border-radius:3px!important; }

    @media(max-width:520px){
      .mc-card { --mc-pad:8px;grid-template-columns:38px minmax(0,1fr) 88px!important;column-gap:9px!important; }
      .mc-logo,.mc-logo-asset { width:34px!important;height:34px!important;flex-basis:34px!important; }
      .mc-logo-provider,.mc-logo-provider img { width:12px!important;height:12px!important;flex-basis:12px!important; }
      .mc-price { min-width:0!important; }
      .mc-price strong { font-size:13px!important; }
      .mc-price em { font-size:8px!important; }
      .mc-identity strong,.mc-option-body strong,.mc-derivative-body strong,.mc-alpha-body strong,.mc-fx-body strong,.mc-stock-body strong,.mc-fund-body strong,.mc-commodity-body strong,.mc-index-body strong,.mc-bond-body strong,.mc-contract-body strong,.mc-pool-body strong,.mc-token-body strong,.mc-event-body strong,.mc-synthetic-body strong,.mc-basket-body strong { font-size:13px!important; }
      .mc-meta { gap:6px!important; }
      .mc-meta span { font-size:6.5px!important; }
      .mc-venue b { font-size:6.5px!important; }
    }
  `;
  document.head.appendChild(style);
}
