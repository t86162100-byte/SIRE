export type MarketBar = {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type MarketIntelligence = {
  ok: boolean;
  source: 'deterministic OHLC calculations';
  barsUsed: number;
  range: { from: number; to: number };
  latest: { time: number; open: number; high: number; low: number; close: number };
  trend: {
    label: 'uptrend' | 'downtrend' | 'range_or_mixed';
    highSlope: number;
    lowSlope: number;
    priceVsSma20: 'above' | 'below' | 'at' | 'unavailable';
  };
  volatility: {
    atr14: number | null;
    atrPercent: number | null;
    realizedLogReturnStd: number | null;
    averageRange: number | null;
    rangePercentile: number | null;
  };
  momentum: {
    rsi14: number | null;
    roc10Percent: number | null;
    macd: { line: number | null; signal: number | null; histogram: number | null };
  };
  movingAverages: {
    sma20: number | null; sma50: number | null; sma200: number | null;
    ema20: number | null; ema50: number | null; ema200: number | null;
  };
  marketStructure: {
    bias: 'bullish' | 'bearish' | 'mixed';
    swings: Array<{ type: 'high'|'low'; time: number; price: number; classification: 'HH'|'LH'|'HL'|'LL' }>;
    recentHighs: Array<{ time:number; price:number }>;
    recentLows: Array<{ time:number; price:number }>;
  };
  supportResistance: Array<{ price:number; touches:number; side:'support'|'resistance'|'mixed' }>;
  liquidityAreas: Array<{
    type: 'buy_side'|'sell_side';
    price: number;
    strength: number;
    basis: 'equal_highs'|'equal_lows'|'swing_extreme';
  }>;
  candlePatterns: string[];
  breakout: {
    lookbackBars: number;
    status: 'upside_breakout'|'downside_breakout'|'none';
    priorHigh: number | null;
    priorLow: number | null;
  };
  statistics: {
    positiveCandleRate: number | null;
    averageBody: number | null;
    averageRange: number | null;
    averageCloseChange: number | null;
    maxRange: number | null;
    minRange: number | null;
  };
  session: {
    utcHour: number;
    window: 'asia'|'london'|'new_york'|'london_new_york_overlap'|'off_hours';
    note: 'UTC classification only; not an exchange-session claim';
  };
};

function sma(values:number[], n:number):number|null {
  return values.length < n ? null : values.slice(-n).reduce((a,b)=>a+b,0)/n;
}
function ema(values:number[], n:number):number|null {
  if(values.length<n)return null;
  const k=2/(n+1); let e=values.slice(0,n).reduce((a,b)=>a+b,0)/n;
  for(let i=n;i<values.length;i++)e=values[i]*k+e*(1-k);
  return e;
}
function rsi(values:number[], n=14):number|null {
  if(values.length<n+1)return null;
  let gain=0,loss=0;
  for(let i=1;i<=n;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}
  gain/=n; loss/=n;
  for(let i=n+1;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*(n-1)+Math.max(d,0))/n;loss=(loss*(n-1)+Math.max(-d,0))/n;}
  return loss===0?(gain===0?50:100):100-100/(1+gain/loss);
}
function atr(bars:MarketBar[], n=14):number|null {
  if(bars.length<n+1)return null;
  const tr=bars.map((b,i)=>{const prev=i?bars[i-1].close:b.close;return Math.max(b.high-b.low,Math.abs(b.high-prev),Math.abs(b.low-prev));});
  let a=tr.slice(1,n+1).reduce((x,y)=>x+y,0)/n;
  for(let i=n+1;i<tr.length;i++)a=(a*(n-1)+tr[i])/n;
  return a;
}
function pivots(bars:MarketBar[], left=2, right=2){
  const highs:Array<{time:number;price:number}>=[], lows:Array<{time:number;price:number}>=[];
  for(let i=left;i<bars.length-right;i++){
    let hi=true,lo=true;
    for(let j=i-left;j<=i+right;j++){if(j===i)continue;if(bars[j].high>=bars[i].high)hi=false;if(bars[j].low<=bars[i].low)lo=false;}
    if(hi)highs.push({time:bars[i].epoch,price:bars[i].high});
    if(lo)lows.push({time:bars[i].epoch,price:bars[i].low});
  }
  return {highs,lows};
}
function slope(values:number[]):number {
  if(values.length<2)return 0;
  const n=values.length, xm=(n-1)/2, ym=values.reduce((a,b)=>a+b,0)/n;
  let num=0,den=0;
  for(let i=0;i<n;i++){num+=(i-xm)*(values[i]-ym);den+=(i-xm)**2;}
  return den?num/den:0;
}
function percentileRank(value:number, values:number[]):number|null {
  if(!values.length)return null;
  let count=0; for(const x of values)if(x<=value)count++;
  return count/values.length*100;
}
function clusterLevels(levels:number[], tolerance:number){
  const clusters:number[][]=[];
  for(const price of levels){
    const existing=clusters.find(c=>Math.abs(c.reduce((a,b)=>a+b,0)/c.length-price)<=tolerance);
    if(existing)existing.push(price); else clusters.push([price]);
  }
  return clusters.map(c=>({price:c.reduce((a,b)=>a+b,0)/c.length,touches:c.length}));
}
function macd(values:number[], fast=12, slow=26, signal=9){
  if(values.length<slow+signal-1)return {line:null,signal:null,histogram:null};
  const kf=2/(fast+1),ks=2/(slow+1);
  let ef=values.slice(0,fast).reduce((a,b)=>a+b,0)/fast;
  let es=values.slice(0,slow).reduce((a,b)=>a+b,0)/slow;
  const lines:number[]=[];
  for(let i=fast;i<values.length;i++)ef=values[i]*kf+ef*(1-kf);
  // Recompute aligned EMA streams so MACD has one value per bar after slow-1.
  const efv:number[]=[]; const esv:number[]=[];
  ef=values.slice(0,fast).reduce((a,b)=>a+b,0)/fast;
  es=values.slice(0,slow).reduce((a,b)=>a+b,0)/slow;
  for(let i=0;i<values.length;i++){
    if(i>=fast)ef=values[i]*kf+ef*(1-kf);
    if(i>=slow)es=values[i]*ks+es*(1-ks);
    if(i>=slow-1)efv.push(ef),esv.push(es),lines.push(ef-es);
  }
  if(lines.length<signal)return {line:lines.at(-1)??null,signal:null,histogram:null};
  const sk=2/(signal+1);
  let se=lines.slice(0,signal).reduce((a,b)=>a+b,0)/signal;
  for(let i=signal;i<lines.length;i++)se=lines[i]*sk+se*(1-sk);
  const line=lines.at(-1)??null;
  return {line,signal:se,histogram:line===null?null:line-se};
}
function classifySession(epoch:number){
  const hour=new Date(epoch*1000).getUTCHours()+new Date(epoch*1000).getUTCMinutes()/60;
  const window=hour>=8&&hour<13?'london_new_york_overlap':hour>=13&&hour<21?'new_york':hour>=8&&hour<17?'london':hour<8?'asia':'off_hours';
  return {utcHour:Math.floor(hour),window:window as any,note:'UTC classification only; not an exchange-session claim' as const};
}

export function analyzeMarketIntelligence(input:MarketBar[], lookback=200):MarketIntelligence|{ok:false;error:string;barsUsed:number}{
  const clean=input.filter(b=>[b.epoch,b.open,b.high,b.low,b.close].every(Number.isFinite)).sort((a,b)=>a.epoch-b.epoch);
  const b=clean.slice(-Math.max(30,Math.min(1000,lookback)));
  if(b.length<30)return {ok:false,error:'At least 30 actual candles are required.',barsUsed:b.length};
  const c=b.map(x=>x.close), last=b.at(-1)!;
  const p=pivots(b), rh=p.highs.slice(-8), rl=p.lows.slice(-8);
  const hs=rh.map(x=>x.price),ls=rl.map(x=>x.price);
  const highSlope=slope(hs),lowSlope=slope(ls);
  const trend=highSlope>0&&lowSlope>0?'uptrend':highSlope<0&&lowSlope<0?'downtrend':'range_or_mixed';
  const sma20=sma(c,20), a=atr(b,14);
  const tr=b.map((x,i)=>{const prev=i?b[i-1].close:x.close;return Math.max(x.high-x.low,Math.abs(x.high-prev),Math.abs(x.low-prev));});
  const ranges=b.map(x=>x.high-x.low), bodies=b.map(x=>Math.abs(x.close-x.open));
  const rets=c.slice(1).map((v,i)=>Math.log(v/c[i])).filter(Number.isFinite);
  const mean=rets.length?rets.reduce((x,y)=>x+y,0)/rets.length:0;
  const vol=rets.length?Math.sqrt(rets.reduce((x,y)=>x+(y-mean)**2,0)/rets.length):null;
  const recent20=b.slice(0,-1).slice(-20), priorHigh=recent20.length?Math.max(...recent20.map(x=>x.high)):null, priorLow=recent20.length?Math.min(...recent20.map(x=>x.low)):null;
  const range=ranges.at(-1)??0;
  const pattern:string[]=[];
  const body=Math.abs(last.close-last.open), upper=last.high-Math.max(last.open,last.close), lower=Math.min(last.open,last.close)-last.low;
  if(range>0&&body<=range*.1)pattern.push('doji');
  if(range>0&&lower>=body*2&&upper<=Math.max(body,range*.15))pattern.push('hammer');
  if(range>0&&upper>=body*2&&lower<=Math.max(body,range*.15))pattern.push('shooting_star');
  const prev=b.at(-2);
  if(prev){
    if(last.open<=prev.close&&last.close>=prev.open&&last.close>last.open&&prev.close<prev.open)pattern.push('bullish_engulfing');
    if(last.open>=prev.close&&last.close<=prev.open&&last.close<last.open&&prev.close>prev.open)pattern.push('bearish_engulfing');
    if(last.high<=prev.high&&last.low>=prev.low)pattern.push('inside_bar');
  }
  const swings:Array<{type:'high'|'low';time:number;price:number;classification:'HH'|'LH'|'HL'|'LL'}>=[];
  for(let i=0;i<rh.length;i++){const prevH=rh[i-1];swings.push({type:'high',time:rh[i].time,price:rh[i].price,classification:!prevH?'HH':rh[i].price>prevH.price?'HH':'LH'});}
  for(let i=0;i<rl.length;i++){const prevL=rl[i-1];swings.push({type:'low',time:rl[i].time,price:rl[i].price,classification:!prevL?'HL':rl[i].price>prevL.price?'HL':'LL'});}
  swings.sort((x,y)=>x.time-y.time);
  const bias=highSlope>0&&lowSlope>0?'bullish':highSlope<0&&lowSlope<0?'bearish':'mixed';
  const srClusters=clusterLevels([...rh.map(x=>x.price),...rl.map(x=>x.price)],Math.max(a??range,range)*0.5||Number.EPSILON);
  const sr=srClusters.map(x=>({price:x.price,touches:x.touches,side:(x.price<last.close?'support':x.price>last.close?'resistance':'mixed') as any})).sort((x,y)=>y.touches-x.touches).slice(0,12);
  const eqTol=Math.max((a??range)*0.25,Number.EPSILON);
  const eqH=clusterLevels(rh.map(x=>x.price),eqTol).filter(x=>x.touches>=2).map(x=>({type:'buy_side' as const,price:x.price,strength:x.touches,basis:'equal_highs' as const}));
  const eqL=clusterLevels(rl.map(x=>x.price),eqTol).filter(x=>x.touches>=2).map(x=>({type:'sell_side' as const,price:x.price,strength:x.touches,basis:'equal_lows' as const}));
  const extremes=[
    ...(rh.length?[{type:'buy_side' as const,price:Math.max(...rh.map(x=>x.price)),strength:1,basis:'swing_extreme' as const}]:[]),
    ...(rl.length?[{type:'sell_side' as const,price:Math.min(...rl.map(x=>x.price)),strength:1,basis:'swing_extreme' as const}]:[])
  ];
  const liquidityAreas=[...eqH,...eqL,...extremes].sort((x,y)=>y.strength-x.strength).slice(0,12);
  const m=macd(c);
  return {
    ok:true,source:'deterministic OHLC calculations',barsUsed:b.length,range:{from:b[0].epoch,to:last.epoch},
    latest:{time:last.epoch,open:last.open,high:last.high,low:last.low,close:last.close},
    trend:{label:trend,highSlope,lowSlope,priceVsSma20:sma20===null?'unavailable':last.close>sma20?'above':last.close<sma20?'below':'at'},
    volatility:{atr14:a,atrPercent:a!==null&&last.close!==0?(a/Math.abs(last.close))*100:null,realizedLogReturnStd:vol,averageRange:ranges.reduce((x,y)=>x+y,0)/ranges.length,rangePercentile:percentileRank(range,ranges)},
    momentum:{rsi14:rsi(c,14),roc10Percent:c.length>=11?(last.close/c[c.length-11]-1)*100:null,macd:m},
    movingAverages:{sma20:sma(c,20),sma50:sma(c,50),sma200:sma(c,200),ema20:ema(c,20),ema50:ema(c,50),ema200:ema(c,200)},
    marketStructure:{bias,swings:swings.slice(-12),recentHighs:rh,recentLows:rl},
    supportResistance:sr,liquidityAreas,candlePatterns:pattern,
    breakout:{lookbackBars:20,status:priorHigh!==null&&last.close>priorHigh?'upside_breakout':priorLow!==null&&last.close<priorLow?'downside_breakout':'none',priorHigh,priorLow},
    statistics:{positiveCandleRate:b.length>1?b.slice(1).filter(x=>x.close>b[b.indexOf(x)-1].close).length/(b.length-1):null,averageBody:bodiesAverage(bodies),averageRange:ranges.reduce((x,y)=>x+y,0)/ranges.length,averageCloseChange:rets.length?rets.reduce((x,y)=>x+y,0)/rets.length:null,maxRange:Math.max(...ranges),minRange:Math.min(...ranges)},
    session:classifySession(last.epoch)
  };
}
function bodiesAverage(values:number[]):number|null{return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;}
