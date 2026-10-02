import { useMemo } from 'react';
import { ChevronRight, RotateCcw, Search } from 'lucide-react';
import './sireMarketFilters.css';

export type SireMarketFilter = { universe: 'All' | 'Crypto' | 'TradFi' | 'Onchain' | 'Prediction' | 'Other'; instrument: string; branch: string; detail: string };
type Props = { value: SireMarketFilter; onChange: (next: SireMarketFilter) => void; search: string; onSearchChange: (value: string) => void; count: number };

const cryptoInstruments = ['All','Spot','Margin','Futures','Options'];
const tradfiInstruments = ['Stocks','ETFs','Futures','Forex','Commodities','Indices','Bonds','Funds','CFD'];
const onchainInstruments = ['DEX','Tokens'];
const predictionInstruments = ['All','Sports','Politics','Finance','Crypto','Economics','Other'];
const otherInstruments = ['Tokenized Assets','Synthetic','Baskets','Structured Products','Leveraged Tokens','Index Products','Exchange-Specific'];

const cryptoBranches: Record<string,string[]> = {
  Spot:['All','Quote','Asset Type'], Margin:['All','Quote','Asset Type'],
  Futures:['All','Perpetual','Delivery'], Options:['All','Calls','Puts','Expiry','Strike','Underlying','Other'],
};
const cryptoDetails: Record<string,string[]> = {
  'Spot:Quote':['USDT','USDC','USD','BTC','ETH','BNB','FIAT','Other'],
  'Spot:Asset Type':['Exchange Token','Stablecoin','DeFi','Meme','AI','Gaming','RWA','Infrastructure','Layer-1','Layer-2','Other'],
  'Margin:Quote':['USDT','USDC','USD','BTC','ETH','FIAT','Other'],
  'Margin:Asset Type':['Exchange Token','Stablecoin','DeFi','Meme','AI','Other'],
  'Futures:Perpetual':['All','USDT-M','USDC-M','USD','Coin-M','Other'],
  'Futures:Delivery':['All','USDT','USDC','USD','Coin','Other'],
};
const tradfiBranches: Record<string,string[]> = {
  Stocks:['All','U.S.','International','ADR','Preferred','Other'],
  ETFs:['All','Equity','Bond','Commodity','Crypto','Index','Other'],
  Futures:['All','Equity','Index','Commodity','FX','Other'],
  Forex:['All','Major','Minor','Exotic','Other'],
  Commodities:['All','Energy','Metals','Agriculture','Other'],
  Indices:['All','U.S.','Europe','Asia','Global','Other'],
  Bonds:['All','Government','Corporate','Municipal','Other'],
  Funds:['All','Mutual Funds','Money Market','Index Funds','Other'],
  CFD:['All','Stocks','Forex','Indices','Commodities','Metals','Other'],
};
const tradfiDetails: Record<string,string[]> = {'Futures:Commodity':['All','Energy','Metals','Agriculture','Other']};
const onchainBranches: Record<string,string[]> = {
  DEX:['All','Ethereum','BNB Chain','Solana','Base','Arbitrum','Avalanche','Polygon','Sui','TRON','Optimism','Other'],
  Tokens:['All','DeFi','Meme','AI','Gaming','RWA','NFT','Infrastructure','Layer-1','Layer-2','Stablecoin','Other'],
};

export function getSireMarketChildren(value:SireMarketFilter){
  if(value.universe==='All') return [];
  if(value.universe==='Crypto') return value.instrument ? (cryptoBranches[value.instrument]||[]) : cryptoInstruments;
  if(value.universe==='TradFi') return value.instrument ? (tradfiBranches[value.instrument]||[]) : tradfiInstruments;
  if(value.universe==='Onchain') return value.instrument ? (onchainBranches[value.instrument]||[]) : onchainInstruments;
  if(value.universe==='Prediction') return predictionInstruments;
  return otherInstruments;
}
export function getSireMarketDetail(value:SireMarketFilter){
  if(value.universe==='Crypto') return cryptoDetails[value.instrument+':'+value.branch]||[];
  if(value.universe==='TradFi') return tradfiDetails[value.instrument+':'+value.branch]||[];
  return [];
}
const norm=(item:any)=>({
  text:[item?.name,item?.symbol,item?.displaySymbol,item?.provider,item?.providerLabel,item?.category,item?.marketType,item?.instrumentType,item?.bitgetCategory,item?.base,item?.quote,item?.settlement,item?.chain,item?.network,item?.sector,item?.assetType,item?.assetCategory,item?.region,item?.optionType,item?.side].filter(Boolean).join(' ').toLowerCase(),
  marketType:String(item?.marketType||'').toLowerCase(), category:String(item?.category||'').toLowerCase(), provider:String(item?.provider||'').toLowerCase(),
  quote:String(item?.quote||'').toUpperCase(), symbol:String(item?.symbol||'').toUpperCase(), chain:String(item?.chain||item?.network||'').toLowerCase(),
  optionType:String(item?.optionType||item?.side||'').toUpperCase(),
});
const quoteOf=(n:ReturnType<typeof norm>)=>n.quote||['USDT','USDC','USD','BTC','ETH','BNB','EUR','GBP','JPY'].find(q=>n.symbol.endsWith(q))||'';
const has=(n:ReturnType<typeof norm>,v:string)=>n.text.includes(v.toLowerCase());

export function matchesSireMarketFilter(item:any,f:SireMarketFilter){
  const n=norm(item); if(!f||f.universe==='All') return true;
  if(f.universe==='Crypto'){
    const cryptoProvider=['binance','bitget','bybit','okx','gateio','kucoin','mexc','kraken','coinbase','bitfinex','bitstamp','coinex','htx','phemex','deriv'].includes(n.provider);
    if(!(cryptoProvider||/crypto|spot|margin|perpetual|future|option|coin-m|usdt-m|usdc-m/.test(n.text))) return false;
    if(!f.instrument||f.instrument==='All') return true;
    if(f.instrument==='Spot'){
      if(!(n.marketType.includes('spot')||(n.category==='crypto'&&!/future|perpetual|option|margin/.test(n.marketType)))) return false;
      if(!f.branch||f.branch==='All') return true;
      if(f.branch==='Quote'){const q=quoteOf(n);if(!f.detail)return true;if(f.detail==='Other')return !['USDT','USDC','USD','BTC','ETH','BNB'].includes(q);if(f.detail==='FIAT')return ['EUR','GBP','JPY','NGN','BRL','TRY'].includes(q);return q===f.detail;}
      return !f.detail||f.detail==='Other'||has(n,f.detail);
    }
    if(f.instrument==='Margin'){
      if(!n.marketType.includes('margin')&&!n.text.includes('spot margin')) return false;
      if(!f.branch||f.branch==='All') return true;
      if(f.branch==='Quote'){const q=quoteOf(n);if(f.detail==='Other')return !['USDT','USDC','USD','BTC','ETH'].includes(q);if(f.detail==='FIAT')return ['EUR','GBP','JPY','NGN','BRL','TRY'].includes(q);return !f.detail||q===f.detail;}
      return !f.detail||f.detail==='Other'||has(n,f.detail);
    }
    if(f.instrument==='Futures'){
      if(!/future|perpetual|delivery|coin-m|usdt-m|usdc-m/.test(n.marketType+' '+n.text)) return false;
      if(!f.branch||f.branch==='All') return true;
      if(f.branch==='Perpetual'){
        if(/delivery/.test(n.marketType+' '+n.text)) return false;
        if(!f.detail||f.detail==='All') return true;
        if(f.detail==='USDT-M')return /usdt|usdt-futures/.test(n.text);
        if(f.detail==='USDC-M')return /usdc|usdc-futures/.test(n.text);
        if(f.detail==='Coin-M')return /coin-m|coin-futures/.test(n.text);
        if(f.detail==='USD')return /(^|[^a-z])usd([^a-z]|$)/.test(n.text)&&!/usdt|usdc/.test(n.text);
        return true;
      }
      if(f.branch==='Delivery'){if(!f.detail||f.detail==='All')return true;if(f.detail==='Coin')return /coin|coin-m/.test(n.text);return n.text.includes(f.detail.toLowerCase());}
      return true;
    }
    if(f.instrument==='Options'){
      if(!/option/.test(n.marketType+' '+n.text)) return false;
      if(!f.branch||f.branch==='All') return true;
      if(f.branch==='Calls')return n.optionType==='CALL'||n.text.includes('call');
      if(f.branch==='Puts')return n.optionType==='PUT'||n.text.includes('put');
      if(f.branch==='Expiry')return Boolean(item?.expiryDate||item?.expiry||n.text.includes('expiry'));
      if(f.branch==='Strike')return Boolean(item?.strikePrice||item?.strike||n.text.includes('strike'));
      if(f.branch==='Underlying')return Boolean(item?.underlying||n.text.includes('underlying'));
      return true;
    }
  }
  if(f.universe==='TradFi'){
    const tradfi=/stocks?|etf|forex|commodit|indice|bond|fund|cfd|equity|(^|[^a-z])fx([^a-z]|$)/.test(n.category+' '+n.marketType+' '+n.text);
    if(!tradfi)return false;
    if(!f.instrument)return true;
    if(!(n.category.includes(f.instrument.toLowerCase().replace('etfs','etf'))||n.marketType.includes(f.instrument.toLowerCase())||n.text.includes(f.instrument.toLowerCase())))return false;
    if(!f.branch||f.branch==='All')return true;
    if(f.instrument==='Futures'&&f.branch==='Commodity')return !f.detail||f.detail==='All'||n.text.includes(f.detail.toLowerCase());
    return f.branch==='Other'||n.text.includes(f.branch.toLowerCase());
  }
  if(f.universe==='Onchain'){
    const dex=['uniswap','curve','pancakeswap','sushiswap','raydium','jupiter','orca','aerodrome','traderjoe','oneinch','cowswap','balancer'];
    if(!(dex.includes(n.provider)||n.category.includes('onchain')||n.category.includes('token')||n.text.includes('onchain')))return false;
    if(!f.instrument)return true;
    if(f.instrument==='DEX'){
      if(!(dex.includes(n.provider)||n.category.includes('dex')||n.text.includes('dex')))return false;
      if(!f.branch||f.branch==='All')return true;
      return f.branch==='Other'||!f.detail||n.chain.includes(f.detail.toLowerCase().replace(' chain',''))||n.text.includes(f.detail.toLowerCase());
    }
    if(f.instrument==='Tokens'){
      if(!f.branch||f.branch==='All')return true;
      return f.detail==='Other'||!f.detail||has(n,f.detail);
    }
  }
  if(f.universe==='Prediction'){
    const p=['polymarket','kalshi','opinion'].includes(n.provider)||n.category.includes('prediction')||n.text.includes('prediction');
    return p&&(!f.instrument||f.instrument==='All'||n.text.includes(f.instrument.toLowerCase()));
  }
  if(f.universe==='Other'){
    return !f.instrument||n.category.includes(f.instrument.toLowerCase())||n.marketType.includes(f.instrument.toLowerCase())||n.text.includes(f.instrument.toLowerCase());
  }
  return true;
}

export default function SireMarketFilters({value,onChange,search,onSearchChange,count}:Props){
  const instruments=useMemo(()=>value.universe==='Crypto'?cryptoInstruments:value.universe==='TradFi'?tradfiInstruments:value.universe==='Onchain'?onchainInstruments:value.universe==='Prediction'?predictionInstruments:value.universe==='Other'?otherInstruments:[],[value.universe]);
  const branches=getSireMarketChildren(value), details=getSireMarketDetail(value);
  const reset=()=>onChange({universe:'All',instrument:'',branch:'',detail:''});
  const setUniverse=(universe:SireMarketFilter['universe'])=>onChange({universe,instrument:'',branch:'',detail:''});
  const setInstrument=(instrument:string)=>onChange({...value,instrument,branch:'',detail:''});
  const setBranch=(branch:string)=>onChange({...value,branch,detail:''});
  return <section className="sire-market-taxonomy" aria-label="SIRE Market filters">
    <div className="sire-market-title-row"><div><span className="sire-market-kicker">SIRE MARKET</span><h2>Markets</h2></div><div className="sire-market-count">{count.toLocaleString()} instruments</div></div>
    <div className="sire-market-search"><Search size={16}/><input value={search} onChange={e=>onSearchChange(e.target.value)} placeholder="Search markets, symbols or exchanges"/>{search&&<button type="button" onClick={()=>onSearchChange('')} aria-label="Clear search">×</button>}</div>
    <div className="sire-market-breadcrumb"><span>MARKET</span><ChevronRight size={12}/><b>{value.universe}</b>{value.instrument&&<><ChevronRight size={12}/><b>{value.instrument}</b></>}{value.branch&&<><ChevronRight size={12}/><b>{value.branch}</b></>}{value.detail&&<><ChevronRight size={12}/><b>{value.detail}</b></>}</div>
    <FilterRow label="Market" options={['All','Crypto','TradFi','Onchain','Prediction','Other']} active={value.universe} onSelect={v=>setUniverse(v as SireMarketFilter['universe'])}/>
    {value.universe!=='All'&&<><FilterRow label="Type" options={instruments} active={value.instrument||instruments[0]} onSelect={setInstrument}/>{value.instrument&&branches.length>0&&<FilterRow label={value.universe==='Crypto'?'Structure':'Category'} options={branches} active={value.branch||branches[0]} onSelect={setBranch}/>} {details.length>0&&<FilterRow label="Refine" options={details} active={value.detail||details[0]} onSelect={v=>onChange({...value,detail:v})}/>}</>}
    <div className="sire-market-filter-footer"><button type="button" onClick={reset}><RotateCcw size={13}/> Reset filters</button></div>
  </section>;
}
function FilterRow({label,options,active,onSelect}:{label:string;options:string[];active:string;onSelect:(value:string)=>void}){return <div className="sire-market-filter-row"><span className="sire-market-filter-label">{label}</span><div className="sire-market-chip-scroll">{options.map(option=><button key={option} type="button" className={active===option?'sire-market-chip active':'sire-market-chip'} onClick={()=>onSelect(option)}>{option}</button>)}</div></div>;}
