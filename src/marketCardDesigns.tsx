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

type Field = { label: string; value: string };

const raw = (item: Instrument) => item as any;
const str = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const upper = (v: unknown) => str(v).toUpperCase();

const price = (item: Instrument) => {
  const v = num(item.price);
  return Number.isFinite(v)
    ? v.toLocaleString(undefined, { maximumFractionDigits: v >= 1 ? 2 : 8 })
    : '';
};
const compact = (v: unknown) => {
  const n = num(v);
  if (!Number.isFinite(n)) return '';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
};
const pct = (item: Instrument) => {
  const v = num(item.priceChangePercent ?? item.change24h);
  return Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '';
};
const changeClass = (item: Instrument) => num(item.priceChangePercent ?? item.change24h) >= 0 ? 'up' : 'down';
const symbol = (item: Instrument) => upper(item.displaySymbol || item.symbol);
const name = (item: Instrument) => str(item.name || item.displaySymbol || item.symbol);
const provider = (item: Instrument) => upper(item.exchange || item.providerLabel || item.provider);
const quote = (item: Instrument) => upper(item.quote);

const field = (label: string, value: unknown): Field | null => {
  const v = str(value);
  return v ? { label, value: v } : null;
};
const metric = (item: Instrument, label: string, value: unknown) => field(label, value);

const pctField = (v: unknown) => {
  const n = num(v);
  return Number.isFinite(n) ? (n >= 0 ? '+' : '') + n.toFixed(2) + '%' : '';
};
const dateField = (v: unknown) => {
  if (!v) return '';
  const d = new Date(Number(v));
  return Number.isNaN(d.getTime()) ? str(v) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
};

const spotFields = (item: Instrument): Field[] => [
  metric(item, '24H HIGH', compact(raw(item).high24h ?? raw(item).high)),
  metric(item, '24H LOW', compact(raw(item).low24h ?? raw(item).low)),
  metric(item, '24H VOL', compact(item.volume24h ?? raw(item).volume)),
  metric(item, 'MARKET CAP', compact(item.marketCap ?? raw(item).market_cap)),
].filter(Boolean) as Field[];

const newFields = (item: Instrument): Field[] => [
  ...spotFields(item),
  metric(item, 'DATE LISTED', dateField(item.listedAt ?? item.onboardDate ?? raw(item).dateListed)),
].filter(Boolean) as Field[];

const futuresFields = (item: Instrument): Field[] => [
  metric(item, '24H HIGH', compact(raw(item).high24h ?? raw(item).high)),
  metric(item, '24H LOW', compact(raw(item).low24h ?? raw(item).low)),
  metric(item, '24H VOL', compact(item.volume24h ?? raw(item).volume)),
  metric(item, 'MARKET CAP', compact(item.marketCap ?? raw(item).market_cap)),
].filter(Boolean) as Field[];

const optionsFields = (item: Instrument): Field[] => [
  metric(item, 'STRIKE', compact(raw(item).strike)),
  metric(item, 'EXPIRY', str(raw(item).expiry ?? raw(item).expiration)),
  metric(item, 'TYPE', upper(raw(item).optionType)),
  metric(item, '24H VOL', compact(item.volume24h ?? raw(item).volume)),
  metric(item, 'OPEN INT', compact(raw(item).openInterest ?? raw(item).oi)),
].filter(Boolean) as Field[];

const perpetualFields = (item: Instrument): Field[] => [
  metric(item, '24H HIGH', compact(raw(item).high24h ?? raw(item).high)),
  metric(item, '24H LOW', compact(raw(item).low24h ?? raw(item).low)),
  metric(item, '24H VOL', compact(item.volume24h ?? raw(item).volume)),
  metric(item, 'OPEN INT', compact(raw(item).openInterest ?? raw(item).oi ?? raw(item).holdingAmount)),
].filter(Boolean) as Field[];

const alphaFields = (item: Instrument): Field[] => [
  metric(item, '24H VOL', compact(item.volume24h ?? raw(item).volume)),
  metric(item, 'MARKET CAP', compact(item.marketCap ?? raw(item).market_cap)),
].filter(Boolean) as Field[];

const genericFields = (item: Instrument): Field[] => [
  metric(item, '24H HIGH', compact(raw(item).high24h ?? raw(item).high)),
  metric(item, '24H LOW', compact(raw(item).low24h ?? raw(item).low)),
  metric(item, '24H VOL', compact(item.volume24h ?? raw(item).volume)),
  metric(item, 'MARKET CAP', compact(item.marketCap ?? raw(item).market_cap)),
].filter(Boolean) as Field[];

const fieldsFor = (item: Instrument, group: string, subgroup: string): Field[] => {
  if (group === 'CRYPTO' && subgroup === 'SPOT') return spotFields(item);
  if (group === 'CRYPTO' && subgroup === 'OPTIONS') return optionsFields(item);
  if (group === 'CRYPTO' && subgroup === 'FUTURES') return futuresFields(item);
  if (group === 'CRYPTO' && subgroup === 'PERPETUALS') return perpetualFields(item);
  if (group === 'CRYPTO' && subgroup === 'ALPHA') return alphaFields(item);
  if (group === 'TRADE FI' && subgroup === 'FUTURES') return futuresFields(item);
  if (group === 'TRADE FI' && subgroup === 'PERPETUALS') return perpetualFields(item);
  if (group === 'TRADE FI' && subgroup === 'OPTIONS') return optionsFields(item);
  return genericFields(item);
};

const assetLogoSources = (item: Instrument) => {
  const r = raw(item);
  const base = str(item.base).toLowerCase();
  const sources = [
    str(item.logoUrl),
    str(r.assetLogoUrl),
    str(r.tokenLogoUrl),
    str(r.iconUrl),
    base ? 'https://cdn.jsdelivr.net/gh/vadimmalykhin/binance-icons/crypto/' + encodeURIComponent(base) + '.svg' : '',
    base ? 'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/' + encodeURIComponent(base) + '.png' : '',
  ].filter(Boolean);
  const label = symbol(item).slice(0, 2) || '?';
  const fallback = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#151515"/><text x="32" y="38" text-anchor="middle" font-family="Arial" font-size="21" font-weight="800" fill="#fff">' + label + '</text></svg>';
  sources.push('data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(fallback));
  return Array.from(new Set(sources));
};

const providerDomains: Record<string, string> = {
  binance:'binance.com', bitget:'bitget.com', gate:'gate.io', gateio:'gate.io', bybit:'bybit.com',
  okx:'okx.com', kraken:'kraken.com', coinbase:'coinbase.com', kucoin:'kucoin.com', mexc:'mexc.com',
  gemini:'gemini.com', bitfinex:'bitfinex.com', bitstamp:'bitstamp.net', coinex:'coinex.com',
  htx:'htx.com', phemex:'phemex.com', bingx:'bingx.com', hyperliquid:'hyperliquid.xyz',
  oanda:'oanda.com', uniswap:'uniswap.org', curve:'curve.fi', pancakeswap:'pancakeswap.finance',
  sushiswap:'sushi.com', raydium:'raydium.io', jupiter:'jup.ag', orca:'orca.so',
  polymarket:'polymarket.com', kalshi:'kalshi.com',
};
const providerLogoSources = (item: Instrument) => {
  const r = raw(item);
  const key = str(item.exchange || item.providerLabel || item.provider).toLowerCase().replace(/[^a-z0-9]/g, '');
  const domain = providerDomains[key] || '';
  const sources = [
    str(item.providerLogoUrl),
    domain ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=64' : '',
    domain ? 'https://' + domain + '/favicon.ico' : '',
    str(r.exchangeLogoUrl),
  ].filter(Boolean);
  const label = provider(item).slice(0, 2) || '?';
  const fallback = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#151515"/><text x="32" y="38" text-anchor="middle" font-family="Arial" font-size="19" font-weight="800" fill="#fff">' + label + '</text></svg>';
  sources.push('data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(fallback));
  return Array.from(new Set(sources));
};

const Logo = ({ item, providerLogo = false }: { item: Instrument; providerLogo?: boolean }) => {
  const sources = providerLogo ? providerLogoSources(item) : assetLogoSources(item);
  const [index, setIndex] = useState(0);
  const src = sources[Math.min(index, sources.length - 1)];
  return (
    <span className={providerLogo ? 'bn-logo bn-provider-logo' : 'bn-logo'}>
      <img
        src={src}
        alt=""
        decoding="async"
        loading="lazy"
        onError={() => setIndex(v => Math.min(v + 1, sources.length - 1))}
      />
    </span>
  );
};

const BinanceShell = ({
  item, active, onSelect, fields, className, children,
}: CardProps & { fields: Field[]; className: string; children: ReactNode }) => (
  <button
    type="button"
    className={'bn-card ' + className + (active ? ' is-active' : '')}
    onClick={() => onSelect(item)}
  >
    <div className="bn-identity">
      <Logo item={item} />
      <div className="bn-name">
        <strong>{children}</strong>
        <span>{name(item)}</span>
        <small><Logo item={item} providerLogo />{provider(item)}</small>
      </div>
    </div>

    <div className="bn-metrics">
      {fields.length > 0 ? (
        <div className="bn-metrics-track">
          <div className="bn-metrics-set">{fields.map((f, i) => <span className="bn-metric" key={'a' + i}><b>{f.label}</b><i>{f.value}</i></span>)}</div>
          {fields.length > 1 && <div className="bn-metrics-set" aria-hidden="true">{fields.map((f, i) => <span className="bn-metric" key={'b' + i}><b>{f.label}</b><i>{f.value}</i></span>)}</div>}
        </div>
      ) : null}
    </div>

    <div className="bn-price">
      <strong>{price(item) || '—'}</strong>
      <em className={changeClass(item)}>{pct(item) || '—'}</em>
    </div>
  </button>
);

const Row = (p: CardProps & { fields?: Field[]; className?: string; title?: string }) => (
  <BinanceShell {...p} fields={p.fields ?? fieldsFor(p.item, upper(p.group), upper(p.subgroup))} className={p.className || ''}>
    {p.title || symbol(p.item)}
    {quote(p.item) && upper(p.subgroup) === 'SPOT' ? ' / ' + quote(p.item) : ''}
  </BinanceShell>
);

const CryptoSpot = (p: CardProps) => <Row {...p} className="bn-spot" fields={spotFields(p.item)} />;
const CryptoOptions = (p: CardProps) => <Row {...p} className="bn-options" fields={optionsFields(p.item)} />;
const CryptoFutures = (p: CardProps) => <Row {...p} className="bn-futures" fields={futuresFields(p.item)} />;
const CryptoPerpetual = (p: CardProps) => <Row {...p} className="bn-perpetual" fields={perpetualFields(p.item)} />;
const CryptoAlpha = (p: CardProps) => <Row {...p} className="bn-alpha" fields={alphaFields(p.item)} />;

const TradFiRow = (p: CardProps) => <Row {...p} className={'bn-tradfi bn-' + upper(p.subgroup).toLowerCase().replace(/[^a-z0-9]+/g, '-')} />;

const Onchain = (p: CardProps) => <Row {...p} className="bn-onchain" />;
const Prediction = (p: CardProps) => <Row {...p} className="bn-prediction" />;
const Other = (p: CardProps) => <Row {...p} className="bn-other" />;

export const MarketInstrumentCard = (props: CardProps) => {
  const g = upper(props.group);
  const s = upper(props.subgroup);
  if (g === 'CRYPTO' && s === 'SPOT') return <CryptoSpot {...props} />;
  if (g === 'CRYPTO' && s === 'OPTIONS') return <CryptoOptions {...props} />;
  if (g === 'CRYPTO' && s === 'FUTURES') return <CryptoFutures {...props} />;
  if (g === 'CRYPTO' && s === 'PERPETUALS') return <CryptoPerpetual {...props} />;
  if (g === 'CRYPTO' && s === 'ALPHA') return <CryptoAlpha {...props} />;
  if (g === 'TRADE FI') return <TradFiRow {...props} />;
  if (g === 'ON CHAIN') return <Onchain {...props} />;
  if (g === 'PREDICTIONS') return <Prediction {...props} />;
  return <Other {...props} />;
};

const styleId = 'sire-binance-market-cards-v2';
if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .bn-card {
      width:100%!important;
      min-height:74px!important;
      height:74px!important;
      box-sizing:border-box!important;
      display:grid!important;
      grid-template-columns:minmax(150px,32%) minmax(0,1fr) 96px!important;
      align-items:center!important;
      gap:10px!important;
      padding:9px 10px!important;
      margin:0!important;
      border:0!important;
      border-bottom:1px solid rgba(255,255,255,.075)!important;
      border-radius:0!important;
      background:#000!important;
      color:#fff!important;
      text-align:left!important;
      overflow:hidden!important;
      box-shadow:none!important;
    }
    .bn-card:hover,.bn-card:active,.bn-card.is-active{background:#030303!important}
    .bn-identity{min-width:0!important;display:flex!important;align-items:center!important;gap:9px!important;overflow:hidden!important}
    .bn-logo{width:36px!important;height:36px!important;min-width:36px!important;border-radius:50%!important;overflow:hidden!important;display:grid!important;place-items:center!important;background:#151515!important}
    .bn-logo img{width:100%!important;height:100%!important;display:block!important;object-fit:contain!important;border-radius:50%!important}
    .bn-name{min-width:0!important;display:flex!important;flex-direction:column!important;gap:2px!important;overflow:hidden!important}
    .bn-name strong{display:block!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:13px!important;line-height:1.05!important;font-weight:850!important;color:#f6f6f7!important;letter-spacing:-.01em!important}
    .bn-name span{display:block!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:8px!important;line-height:1.05!important;color:rgba(255,255,255,.48)!important;font-weight:600!important}
    .bn-name small{display:flex!important;align-items:center!important;gap:4px!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:7px!important;line-height:1!important;color:rgba(255,255,255,.34)!important;font-weight:800!important;letter-spacing:.035em!important}
    .bn-provider-logo{width:11px!important;height:11px!important;min-width:11px!important;background:#0d0d0d!important;border:1px solid rgba(255,255,255,.08)!important}
    .bn-provider-logo img{width:11px!important;height:11px!important}
    .bn-metrics{min-width:0!important;overflow:hidden!important;position:relative!important;mask-image:linear-gradient(90deg,transparent 0,#000 6%,#000 94%,transparent 100%)!important;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 6%,#000 94%,transparent 100%)!important}
    .bn-metrics-track{display:flex!important;width:max-content!important;min-width:100%!important;gap:28px!important;animation:bn-metrics-scroll 24s linear infinite!important;will-change:transform!important}
    .bn-metrics:hover .bn-metrics-track{animation-play-state:paused!important}
    .bn-metrics-set{display:flex!important;align-items:center!important;gap:28px!important;flex:0 0 auto!important}
    .bn-metric{display:flex!important;flex-direction:column!important;justify-content:center!important;gap:3px!important;min-width:58px!important;white-space:nowrap!important}
    .bn-metric b{font-size:6px!important;line-height:1!important;color:rgba(255,255,255,.32)!important;font-weight:800!important;letter-spacing:.055em!important}
    .bn-metric i{font-style:normal!important;font-size:8px!important;line-height:1!important;color:rgba(255,255,255,.76)!important;font-weight:800!important}
    .bn-price{min-width:0!important;display:flex!important;flex-direction:column!important;align-items:flex-end!important;justify-content:center!important;gap:4px!important;text-align:right!important}
    .bn-price strong{font-size:14px!important;line-height:1!important;font-weight:900!important;color:#fff!important;letter-spacing:-.02em!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;max-width:100%!important}
    .bn-price em{font-style:normal!important;font-size:9px!important;line-height:1!important;font-weight:850!important}
    .bn-price em.up{color:#22c993!important}.bn-price em.down{color:#ff536d!important}
    @keyframes bn-metrics-scroll{from{transform:translate3d(0,0,0)}to{transform:translate3d(calc(-50% - 14px),0,0)}}
    .bn-options,.bn-futures,.bn-perpetual{min-height:78px!important;height:78px!important}
    .bn-options .bn-logo{width:34px!important;height:34px!important;min-width:34px!important}
    .bn-futures .bn-logo,.bn-perpetual .bn-logo{width:34px!important;height:34px!important;min-width:34px!important}
    .bn-alpha{min-height:74px!important;height:74px!important}
    .bn-alpha .bn-metrics-track{animation-duration:20s!important}
    .bn-onchain,.bn-prediction,.bn-other{min-height:74px!important;height:74px!important}
    @media(max-width:620px){
      .bn-card{grid-template-columns:minmax(116px,39%) minmax(0,1fr) 78px!important;gap:7px!important;padding:8px!important}
      .bn-logo{width:32px!important;height:32px!important;min-width:32px!important}
      .bn-name strong{font-size:12px!important}
      .bn-name span{font-size:7px!important}
      .bn-name small{font-size:6px!important}
      .bn-provider-logo,.bn-provider-logo img{width:10px!important;height:10px!important;min-width:10px!important}
      .bn-metrics-set{gap:20px!important}.bn-metrics-track{gap:20px!important}
      .bn-metric{min-width:52px!important}.bn-metric b{font-size:5.5px!important}.bn-metric i{font-size:7px!important}
      .bn-price strong{font-size:13px!important}.bn-price em{font-size:8px!important}
    }
    @media(prefers-reduced-motion:reduce){
      .bn-metrics-track{animation:none!important}
    }
  `;
  document.head.appendChild(style);
}
