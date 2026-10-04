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

const volumeField = (item: Instrument) =>
  metric(item, 'VOL', compact(raw(item).quoteVolume ?? item.volume24h ?? raw(item).volume));

const marketCapField = (item: Instrument) =>
  metric(item, 'MC', compact(item.marketCap ?? raw(item).market_cap));

const fundingField = (item: Instrument) =>
  metric(item, 'FUND', pctField(raw(item).fundingRate ?? raw(item).funding));

const spotFields = (item: Instrument): Field[] =>
  [volumeField(item), marketCapField(item)].filter(Boolean) as Field[];

const newFields = (item: Instrument): Field[] =>
  [volumeField(item), marketCapField(item)].filter(Boolean) as Field[];

const futuresFields = (item: Instrument): Field[] =>
  [volumeField(item), fundingField(item)].filter(Boolean) as Field[];

const optionsFields = (item: Instrument): Field[] => [
  metric(item, 'BID SIZE', raw(item).bidSize),
  metric(item, 'ASK SIZE', raw(item).askSize),
  metric(item, 'HIGH', compact(raw(item).high24h ?? raw(item).high)),
  metric(item, 'LOW', compact(raw(item).low24h ?? raw(item).low)),
  metric(item, 'LEVERAGE', raw(item).leverage),
  volumeField(item),
  metric(item, 'GAMMA', raw(item).gamma),
  metric(item, 'VEGA', raw(item).vega),
  metric(item, 'THETA', raw(item).theta),
].filter(Boolean) as Field[];

const perpetualFields = (item: Instrument): Field[] =>
  [volumeField(item), fundingField(item)].filter(Boolean) as Field[];

const alphaFields = (item: Instrument): Field[] =>
  [volumeField(item), marketCapField(item)].filter(Boolean) as Field[];

const genericFields = (item: Instrument): Field[] =>
  [volumeField(item), marketCapField(item)].filter(Boolean) as Field[];

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
}: CardProps & { fields: Field[]; className: string; children: ReactNode }) => {
  const volume = compact(raw(item).quoteVolume ?? item.volume24h ?? raw(item).volume);
  const visibleFields = fields.filter(f => str(f.value));

  return (
    <button
      type="button"
      className={'bn-card ' + className + (active ? ' is-active' : '')}
      onClick={() => onSelect(item)}
    >
      <div className="bn-identity">
        <Logo item={item} />
        <div className="bn-name">
          <strong>
            {children}
            {quote(item) && upper(item.subgroup) === 'SPOT' ? ' / ' + quote(item) : ''}
          </strong>
          <span>{name(item)}{volume ? <><b> | </b>{volume}</> : ''}</span>
          <small><Logo item={item} providerLogo />{provider(item)}</small>
          {visibleFields.length > 0 ? (
            <div className="bn-metrics" aria-label="Additional market data">
              <div className="bn-metrics-set">
                {visibleFields.map((f, i) => (
                  <span className="bn-metric" key={i}>
                    <b>{f.label}</b><i>{f.value}</i>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="bn-quote">
        <div className="bn-price">
          <strong>{price(item) || '—'}</strong>
        </div>
        <div className={'bn-change ' + changeClass(item)}>
          {pct(item) || '—'}
        </div>
      </div>
    </button>
  );
};

const Row = (p: CardProps & { fields?: Field[]; className?: string; title?: string }) => (
  <BinanceShell
    {...p}
    fields={p.fields ?? fieldsFor(p.item, upper(p.group), upper(p.subgroup))}
    className={p.className || ''}
  >
    {p.title || symbol(p.item)}
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

const styleId = 'sire-binance-market-cards-v3';
if (!document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .bn-card {
      width:100%!important;
      min-height:83px!important;
      height:83px!important;
      box-sizing:border-box!important;
      display:grid!important;
      grid-template-columns:minmax(0,1fr) minmax(128px,36%)!important;
      align-items:center!important;
      gap:7px!important;
      padding:7px 10px!important;
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

    .bn-card:hover,.bn-card:active,.bn-card.is-active{background:#000!important}

    /* Binance-style left identity: logo, pair on top, asset name + volume below. */
    .bn-identity{
      min-width:0!important;
      display:flex!important;
      align-items:center!important;
      gap:9px!important;
      overflow:hidden!important;
    }
     .bn-logo{
      width:38px!important;
      height:38px!important;
      min-width:38px!important;
      border-radius:50%!important;
      overflow:hidden!important;
      display:grid!important;
      place-items:center!important;
      background:#151515!important;
    }
    .bn-logo img{
      width:100%!important;
      height:100%!important;
      display:block!important;
      object-fit:contain!important;
      border-radius:50%!important;
    }
    .bn-name{
      min-width:0!important;
      display:flex!important;
      flex-direction:column!important;
      gap:3px!important;
      overflow:hidden!important;
    }
    .bn-name strong{
      display:block!important;
      min-width:0!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:16.8px!important;
      line-height:.98!important;
      font-weight:900!important;
      color:#f5f5f7!important;
      letter-spacing:-.015em!important;
    }
    .bn-name span{
      display:block!important;
      min-width:0!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:10.8px!important;
      line-height:1!important;
      color:rgba(255,255,255,.53)!important;
      font-weight:650!important;
    }
    .bn-name span b{color:rgba(255,255,255,.27)!important;font-weight:700!important}
    .bn-name small{
      display:flex!important;
      align-items:center!important;
      gap:4px!important;
      min-width:0!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:7.6px!important;
      line-height:1!important;
      color:rgba(255,255,255,.28)!important;
      font-weight:800!important;
      letter-spacing:.03em!important;
    }
    .bn-provider-logo{
      width:12px!important;
      height:12px!important;
      min-width:12px!important;
      background:#0d0d0d!important;
      border:1px solid rgba(255,255,255,.08)!important;
    }
    .bn-provider-logo img{width:12px!important;height:12px!important;object-fit:contain!important}

    /* Compact Binance-style secondary data: directly below the venue, never in the price column. */
    .bn-metrics{
      min-width:0!important;
      max-width:100%!important;
      overflow:hidden!important;
      position:relative!important;
      margin-top:1px!important;
    }
    .bn-metrics-set{
      display:flex!important;
      align-items:center!important;
      gap:10px!important;
      width:max-content!important;
      max-width:100%!important;
      overflow:hidden!important;
    }
    .bn-metric{
      display:inline-flex!important;
      align-items:baseline!important;
      gap:3px!important;
      min-width:max-content!important;
      white-space:nowrap!important;
    }
    .bn-metric b{
      font-size:7.2px!important;
      line-height:1!important;
      color:rgba(255,255,255,.40)!important;
      font-weight:900!important;
      letter-spacing:.045em!important;
    }
    .bn-metric i{
      font-style:normal!important;
      font-size:8.4px!important;
      line-height:1!important;
      color:rgba(255,255,255,.78)!important;
      font-weight:850!important;
    }

    /* Right side deliberately mirrors the supplied Binance layout:
       LAST PRICE first, then the 24h percentage in a filled bar. */
    .bn-quote{
      min-width:0!important;
      display:grid!important;
      grid-template-columns:minmax(48px,1fr) minmax(58px,78px)!important;
      align-items:center!important;
      gap:8px!important;
      justify-content:end!important;
    }
    .bn-price{
      min-width:0!important;
      display:flex!important;
      justify-content:flex-end!important;
      align-items:center!important;
      text-align:right!important;
    }
    .bn-price strong{
      font-size:18px!important;
      line-height:.95!important;
      font-weight:900!important;
      color:#f7f7f8!important;
      letter-spacing:-.025em!important;
      white-space:nowrap!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      max-width:100%!important;
    }
     .bn-change{
      min-width:74px!important;
      height:29px!important;
      padding:0 7px!important;
      border-radius:7px!important;
      display:flex!important;
      align-items:center!important;
      justify-content:center!important;
      box-sizing:border-box!important;
      font-size:12px!important;
      line-height:1!important;
      font-weight:900!important;
      white-space:nowrap!important;
    }
    .bn-change.up{background:#20bf8b!important;color:#fff!important}
    .bn-change.down{background:#f04460!important;color:#fff!important}

      .bn-options,.bn-futures,.bn-perpetual{min-height:83px!important;height:83px!important}
    .bn-options .bn-logo,.bn-futures .bn-logo,.bn-perpetual .bn-logo{
      width:38px!important;height:38px!important;min-width:38px!important
    }
    .bn-options .bn-provider-logo,.bn-futures .bn-provider-logo,.bn-perpetual .bn-provider-logo,
    .bn-options .bn-provider-logo img,.bn-futures .bn-provider-logo img,.bn-perpetual .bn-provider-logo img{
      width:12px!important;height:12px!important;min-width:12px!important;
    }

    @keyframes bn-metrics-scroll{
      from{transform:translate3d(0,0,0)}
      to{transform:translate3d(calc(-50% - 13px),0,0)}
    }

    @media(max-width:620px){
      .bn-card{
        grid-template-columns:minmax(0,1fr) minmax(220px,42%)!important;
        gap:6px!important;
        padding:7px 9px!important;
      }
      .bn-logo{width:36px!important;height:36px!important;min-width:36px!important}
       .bn-name strong{font-size:16.8px!important}
       .bn-name span{font-size:10.8px!important}
       .bn-name small{font-size:7.6px!important}
      .bn-provider-logo,.bn-provider-logo img{width:12px!important;height:12px!important;min-width:12px!important}
      .bn-metrics-set{gap:8px!important}
       .bn-metric b{font-size:7.2px!important}
       .bn-metric i{font-size:8.4px!important}
       .bn-quote{grid-template-columns:minmax(44px,1fr) minmax(48px,68px)!important;gap:6px!important}
       .bn-price strong{font-size:15.6px!important}
       .bn-change{min-width:68px!important;height:29px!important;padding:0 6px!important;font-size:10.8px!important}
    }
  `;
  document.head.appendChild(style);
}
