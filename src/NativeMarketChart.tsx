import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FastFinancialChart } from '@pairlens/fast-financial-charts/react';
import type { ChartSeriesInput, DrawingToolType, FastFinancialChartRef, IndicatorInstanceInput, Timeframe } from '@pairlens/fast-financial-charts/types';
import { isPlaceableTool, MobileDrawingPlacement } from './chart/mobileDrawingPlacement';

type Candle = { epoch: number; open: number; high: number; low: number; close: number; volume?: number };
type TimeframeOption = { value: Timeframe; label: string };
type Props = { candles: Candle[]; latest?: { epoch: number; quote: number; bid?: number; ask?: number } | null; autoScale?: boolean; timeframe: Timeframe; timeframeOptions: readonly TimeframeOption[]; onTimeframeChange: (value: Timeframe) => void };
type CatalogItem = { type: string; label: string; group: string; hint: string };

const DRAWING_GROUPS = ['All', 'Basics', 'Lines', 'Shapes', 'Patterns', 'Fibonacci', 'Gann', 'Channels', 'Analysis', 'Positions', 'Annotation'];
const INDICATOR_GROUPS = ['All', 'Moving Averages', 'Oscillators', 'Bands & Channels', 'Trend', 'Volume', 'Volatility', 'Statistical'];
const OVERLAY_INDICATORS = new Set(['EMA','SMA','WMA','DEMA','TEMA','VWAP','HMA','VWMA','ALMA','KAMA','SMMA','LSMA','McGinleyDynamic','MovingAverageHamming','MovingAverageChannel','MovingAverageMultiple','GuppyMMA','BollingerBands','DonchianChannels','KeltnerChannels','Envelopes','PriceChannel','SuperTrend','Ichimoku','ParabolicSAR','Alligator','WilliamsFractal','ZigZag','ChandeKrollStop','MACross','EMACross','MAWithEMACross','PivotPoints','FiftyTwoWeekHighLow','AveragePrice','MedianPrice','TypicalPrice','LinearRegressionCurve']);
const humanize = (value: string) => value.replace(/^custom:/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const drawingGroup = (type: string) => {
  if (type === 'select') return 'Basics';
  if (['line','arrow','ray','xline','hline','hray','vline','crossline','trend-angle'].includes(type)) return 'Lines';
  if (['rectangle','rotated-rectangle','circle','ellipse','arc','path'].includes(type)) return 'Shapes';
  if (['triangle-pattern','abcd-pattern','xabcd-pattern','head-shoulders','elliott-wave'].includes(type)) return 'Patterns';
  if (type.startsWith('fib') || type === 'fibonacci') return 'Fibonacci';
  if (type.startsWith('gann')) return 'Gann';
  if (['channel','pitchfork'].includes(type)) return 'Channels';
  if (['forecast','anchored-vwap','measure','date-range','price-date-range','info-line'].includes(type)) return 'Analysis';
  if (['long-position','short-position'].includes(type)) return 'Positions';
  return 'Annotation';
};
const drawingHint = (type: string) => {
  const points = ['hline','hray','vline','crossline','text','anchored-vwap'].includes(type) ? 1 : ['channel','pitchfork','fib-extension','fib-channel','triangle-pattern','arc','rotated-rectangle','fib-wedge'].includes(type) ? 3 : type === 'abcd-pattern' ? 4 : type === 'xabcd-pattern' ? 5 : type === 'head-shoulders' ? 7 : 2;
  if (['brush','highlighter','polyline','elliott-wave'].includes(type)) return 'Freehand';
  return points === 1 ? 'One point' : `${points} points`;
};
const indicatorGroup = (type: string) => {
  if (['EMA','SMA','WMA','DEMA','TEMA','VWAP','HMA','VWMA','ALMA','KAMA','SMMA','LSMA','McGinleyDynamic','MovingAverageHamming','MovingAverageChannel','MovingAverageMultiple','GuppyMMA'].includes(type)) return 'Moving Averages';
  if (['RSI','MACD','Stochastic','StochRSI','WilliamsR','CCI','MFI','Momentum','ROC','Aroon','ADX','TRIX','BBPercent','AwesomeOscillator','ChoppinessIndex','FisherTransform','VortexIndicator','UltimateOscillator','CoppockCurve','KST','ElderForceIndex','DPO','CMO','RVI','TSI','SMIErgodic','ConnorsRSI','BalanceOfPower','RelativeVolatilityIndex','AcceleratorOscillator','MassIndex','PriceOscillator','DirectionalMovement','TrendStrengthIndex','RankCorrelationIndex'].includes(type)) return 'Oscillators';
  if (['BollingerBands','DonchianChannels','KeltnerChannels','Envelopes','PriceChannel'].includes(type)) return 'Bands & Channels';
  if (['SuperTrend','Ichimoku','ParabolicSAR','Alligator','WilliamsFractal','ZigZag','ChandeKrollStop','MACross','EMACross','MAWithEMACross'].includes(type)) return 'Trend';
  if (['Volume','OBV','AD','CMF','KlingerOscillator','PVT','EaseOfMovement','VolumeOscillator','NetVolume'].includes(type)) return 'Volume';
  if (['ATR','BBWidth','HistoricalVolatility','PivotPoints','StandardDeviation','ChaikinVolatility','FiftyTwoWeekHighLow'].includes(type)) return 'Volatility';
  return 'Statistical';
};

function toBars(candles: Candle[]) {
  return candles.filter(c => [c.epoch,c.open,c.high,c.low,c.close].every(Number.isFinite)).slice().sort((a,b) => a.epoch-b.epoch).reduce<ChartSeriesInput['bars']>((bars,c) => { const ts=Math.floor(c.epoch*1000); if (bars.length && bars[bars.length-1].ts===ts) return bars; bars.push({ts,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume??0}); return bars; }, []);
}

export default function NativeMarketChart({ candles, latest, autoScale = true, timeframe, timeframeOptions, onTimeframeChange }: Props) {
  const chartRef = useRef<FastFinancialChartRef | null>(null);
  const [activeTool, setActiveTool] = useState<DrawingToolType | null>(null);
  const [drawingsOpen, setDrawingsOpen] = useState(false);
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [indicators, setIndicators] = useState<IndicatorInstanceInput[]>([]);
  const [timeframeOpen, setTimeframeOpen] = useState(false);
  const [instrumentLabel, setInstrumentLabel] = useState('Select instrument');
  const [drawingGroupState, setDrawingGroupState] = useState('All');
  const [indicatorGroupState, setIndicatorGroupState] = useState('All');
  const [drawingSearch, setDrawingSearch] = useState('');
  const [indicatorSearch, setIndicatorSearch] = useState('');
  const [capabilities, setCapabilities] = useState<{ drawingTools:string[]; indicatorTypes:string[] }>({ drawingTools:[], indicatorTypes:[] });
  const [isMobile, setIsMobile] = useState(false);
  const series = useMemo<ChartSeriesInput[]>(() => [{id:'SIRE',label:'SIRE',bars:toBars(candles),pricePrecision:8}], [candles]);

  useEffect(() => { const update=()=>setInstrumentLabel(document.querySelector('.native-instrument-picker strong')?.textContent?.trim()||'Select instrument'); update(); const node=document.querySelector('.native-instrument-picker'); const observer=new MutationObserver(update); if(node) observer.observe(node,{subtree:true,childList:true,characterData:true}); return()=>observer.disconnect(); }, []);
  useEffect(() => { const media=window.matchMedia('(max-width: 767px)'); const update=()=>setIsMobile(media.matches); update(); media.addEventListener?.('change',update); return()=>media.removeEventListener?.('change',update); }, []);

  const onReady=(ref:FastFinancialChartRef)=>{ chartRef.current=ref; const next=ref.getCapabilities(); setCapabilities({drawingTools:next.drawingTools,indicatorTypes:next.indicatorTypes}); };
  const drawings=useMemo<CatalogItem[]>(()=>capabilities.drawingTools.map(type=>({type,label:humanize(type),group:drawingGroup(type),hint:drawingHint(type)})),[capabilities.drawingTools]);
  const indicatorsCatalog=useMemo<CatalogItem[]>(()=>capabilities.indicatorTypes.map(type=>({type,label:humanize(type),group:indicatorGroup(type),hint:OVERLAY_INDICATORS.has(type)?'On price chart':'Separate pane'})),[capabilities.indicatorTypes]);
  const filteredDrawings=useMemo(()=>drawings.filter(item=>(drawingGroupState==='All'||item.group===drawingGroupState)&&`${item.label} ${item.type} ${item.hint}`.toLowerCase().includes(drawingSearch.trim().toLowerCase())),[drawings,drawingGroupState,drawingSearch]);
  const filteredIndicators=useMemo(()=>indicatorsCatalog.filter(item=>(indicatorGroupState==='All'||item.group===indicatorGroupState)&&`${item.label} ${item.type}`.toLowerCase().includes(indicatorSearch.trim().toLowerCase())),[indicatorsCatalog,indicatorGroupState,indicatorSearch]);
  const chooseDrawing=(type:string)=>{setIndicatorsOpen(false);setDrawingsOpen(false);setActiveTool(type as DrawingToolType);};
  const addIndicator=(type:string)=>{setIndicators(current=>[...current,{id:`${type}-${Date.now()}`,type:type as IndicatorInstanceInput['type'],seriesId:'SIRE',pane:OVERLAY_INDICATORS.has(type)?'overlay':'separate'}]);setIndicatorsOpen(false);};
  const isPlacing=isPlaceableTool(activeTool);
  const engineActiveTool=activeTool&&!isPlacing?activeTool:null;
  const sheetStyle:CSSProperties=isMobile
    ? {position:'fixed',zIndex:10040,left:0,right:0,bottom:56,width:'100vw',maxHeight:'72vh',overflow:'hidden',boxSizing:'border-box',padding:'14px 14px 12px',border:'1px solid rgba(72,110,150,.45)',borderBottom:0,borderRadius:'18px 18px 0 0',background:'rgba(9,14,21,.985)',boxShadow:'0 -14px 40px rgba(0,0,0,.48)',color:'#d8e1eb',backdropFilter:'blur(16px)'}
    : {position:'fixed',zIndex:10040,left:12,right:'auto',bottom:56,width:'min(430px, calc(100vw - 24px))',maxHeight:'min(62vh, 520px)',overflow:'hidden',boxSizing:'border-box',padding:10,border:'1px solid rgba(72,110,150,.45)',borderRadius:12,background:'rgba(9,14,21,.97)',boxShadow:'0 14px 40px rgba(0,0,0,.45)',color:'#d8e1eb',backdropFilter:'blur(14px)'};

  return <div className="sire-native-chart" style={{position:'absolute',inset:0,isolation:'isolate'}}>
    <FastFinancialChart ref={chartRef} series={series} timeframe={timeframe} chartType="candles"
      priceScale={{mode:'normal',borderVisible:true,ticksVisible:true,scaleMargins:{top:.08,bottom:.08}}}
      timeScale={{rightOffset:6,barSpacing:8,minBarSpacing:2,shiftVisibleRangeOnNewBar:true}}
      crosshairConfig={{mode:'normal',vertLine:{color:'#66717f',width:1,style:'dashed',visible:!isPlacing},horzLine:{color:'#66717f',width:1,style:'dashed',labelVisible:!isPlacing,visible:!isPlacing}}}
      theme={{background:'#090d12',axisText:'#9aa5b1',hudBg:'rgba(9,13,18,.92)',hudText:'#e6edf7',layout:{priceAxisWidth:76,timeAxisHeight:22,gridRows:6,gridColumns:8}}}
      interaction={{wheelZoom:true,dragPan:true,handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true,axisDoubleClickReset:true,smoothWheel:true},kineticScroll:{touch:true,mouse:true},drawingSnap:true}}
      indicators={indicators} activeTool={engineActiveTool} onActiveToolChange={tool=>{if(!isPlaceableTool(tool))setActiveTool(tool);}} onReady={onReady}
      defaultViewport={{type:'last-bars',bars:200}} className="sire-fast-financial-chart" style={{position:'absolute',inset:0,width:'100%',height:'100%'}} onDrawingsChange={()=>undefined}/>
    <LiveTickBridge chart={chartRef.current} latest={latest}/>
    {isPlacing?<MobileDrawingPlacement chartRef={chartRef} tool={activeTool} seriesId="SIRE" label={drawings.find(item=>item.type===activeTool)?.label||humanize(activeTool||'')} onCancel={()=>setActiveTool(null)} onComplete={()=>undefined}/>:null}
    <div className="native-bottom-glass-bar" style={{pointerEvents:'auto',position:'fixed',zIndex:10003}}>
      <div className="native-bottom-instrument-viewport" style={{pointerEvents:'auto'}}><button type="button" className="native-bottom-instrument-current" style={{background:'transparent',border:0,width:'100%',height:'100%',textAlign:'left'}} onClick={()=>document.querySelector<HTMLButtonElement>('.native-instrument-picker')?.click()}>{instrumentLabel}</button></div>
      <div className="native-bottom-timeframe-viewport" style={{pointerEvents:'auto'}}><button type="button" className="native-bottom-timeframe-current" style={{background:'transparent',border:0,width:'100%',height:'100%'}} onClick={()=>setTimeframeOpen(true)}>{timeframeOptions.find(option=>option.value===timeframe)?.label||timeframe}</button></div>
      <button type="button" className={`sire-drawing-toggle ${drawingsOpen?'active':''}`} data-sire-drawing-toggle style={{position:'relative',zIndex:10005,pointerEvents:'auto',touchAction:'manipulation'}} onClick={()=>{setDrawingsOpen(v=>!v);setIndicatorsOpen(false);}} aria-label="Drawing tools">✎</button>
      <button type="button" className={`sire-drawing-toggle ${indicatorsOpen?'active':''}`} style={{position:'relative',zIndex:10005,pointerEvents:'auto',touchAction:'manipulation'}} onClick={()=>{setIndicatorsOpen(v=>!v);setDrawingsOpen(false);}} aria-label="Indicators">ƒ</button>
    </div>
    {(drawingsOpen||indicatorsOpen)&&isMobile?<div onClick={()=>{setDrawingsOpen(false);setIndicatorsOpen(false);}} style={{position:'fixed',inset:0,zIndex:10030,background:'rgba(0,0,0,.28)'}}/>:null}
    {drawingsOpen?<ToolSheet title="Drawing tools" count={drawings.length} search={drawingSearch} setSearch={setDrawingSearch} groups={DRAWING_GROUPS} group={drawingGroupState} setGroup={setDrawingGroupState} items={filteredDrawings} activeType={activeTool} onChoose={chooseDrawing} onClose={()=>setDrawingsOpen(false)} isMobile={isMobile} sheetStyle={sheetStyle}/>:null}
    {indicatorsOpen?<ToolSheet title="Indicators" count={indicatorsCatalog.length} search={indicatorSearch} setSearch={setIndicatorSearch} groups={INDICATOR_GROUPS} group={indicatorGroupState} setGroup={setIndicatorGroupState} items={filteredIndicators} onChoose={item=>addIndicator(item.type)} onClose={()=>setIndicatorsOpen(false)} isMobile={isMobile} sheetStyle={sheetStyle}/>:null}
    {timeframeOpen&&<div className="native-bottom-timeframe-overlay" onClick={event=>{if(event.currentTarget===event.target)setTimeframeOpen(false);}}><div className="native-bottom-timeframe-sheet"><div className="native-bottom-timeframe-head"><span>TIMEFRAME</span><button type="button" onClick={()=>setTimeframeOpen(false)}>Done</button></div><div className="native-bottom-timeframe-list">{timeframeOptions.map(option=><button key={option.value} type="button" className={option.value===timeframe?'active':''} onClick={()=>{onTimeframeChange(option.value);setTimeframeOpen(false);}}>{option.label}</button>)}</div></div></div>}
    <div className="native-fast-chart-status" aria-hidden="true">Fast Financial Charts · {autoScale?'Auto scale':'Manual scale'}</div>
  </div>;
}

function ToolSheet({title,count,search,setSearch,groups,group,setGroup,items,activeType,onChoose,onClose,isMobile,sheetStyle}:{title:string;count:number;search:string;setSearch:(value:string)=>void;groups:string[];group:string;setGroup:(value:string)=>void;items:CatalogItem[];activeType?:string|null;onChoose:(item:CatalogItem)=>void;onClose:()=>void;isMobile:boolean;sheetStyle:CSSProperties}) {
  return <div className="sire-mobile-tool-sheet" style={sheetStyle} onClick={event=>event.stopPropagation()}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}><div><strong style={{fontSize:16}}>{title}</strong><span style={{display:'block',marginTop:2,fontSize:11,color:'#748395'}}>{count} engine tools · {isMobile?'Touch a tool to arm it':'Choose a tool'}</span></div><button type="button" onClick={onClose} style={{minWidth:44,height:44,border:0,borderRadius:10,background:'rgba(30,40,52,.9)',color:'#d8e1eb',fontSize:18}}>×</button></div>
    <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={`Search ${title.toLowerCase()}…`} aria-label={`Search ${title}`} style={{width:'100%',boxSizing:'border-box',height:46,marginTop:10,padding:'0 12px',borderRadius:11,border:'1px solid rgba(100,125,150,.28)',outline:'none',background:'rgba(20,28,38,.94)',color:'#e6edf5',fontSize:14}}/>
    <div style={{display:'flex',gap:7,overflowX:'auto',padding:'10px 0 8px',scrollbarWidth:'none'}}>{groups.map(g=><button key={g} type="button" onClick={()=>setGroup(g)} style={{flex:'0 0 auto',minHeight:42,border:`1px solid ${group===g?'rgba(0,145,255,.7)':'rgba(100,125,150,.2)'}`,borderRadius:10,padding:'0 12px',background:group===g?'rgba(0,105,190,.28)':'rgba(19,27,36,.9)',color:group===g?'#f3f8ff':'#9aa8b7',fontSize:12,whiteSpace:'nowrap'}}>{g}</button>)}</div>
    <div style={{overflowY:'auto',maxHeight:isMobile?'calc(72vh - 170px)':'min(43vh, 365px)',paddingRight:2,overscrollBehavior:'contain'}}>{items.map(item=><button key={item.type} type="button" onClick={()=>onChoose(item)} style={{width:'100%',minHeight:58,textAlign:'left',display:'block',padding:'10px 12px',border:`1px solid ${activeType===item.type?'rgba(0,145,255,.55)':'rgba(80,105,130,.14)'}`,borderRadius:11,background:activeType===item.type?'rgba(0,105,190,.22)':'rgba(17,24,32,.8)',color:'#d8e1ea',marginBottom:7,touchAction:'manipulation'}}><span style={{display:'block',fontSize:13,fontWeight:650}}>{item.label}</span><span style={{display:'block',marginTop:3,fontSize:11,color:'#718093'}}>{item.hint}</span></button>)}{!items.length?<div style={{padding:24,textAlign:'center',color:'#718093',fontSize:12}}>No matches.</div>:null}</div>
    <div style={{paddingTop:8,display:'flex',justifyContent:'flex-end'}}><button type="button" onClick={onClose} style={{minHeight:44,padding:'0 14px',borderRadius:10,border:'1px solid rgba(100,125,150,.22)',background:'rgba(19,27,36,.9)',color:'#b9c7d4'}}>Done</button></div>
  </div>;
}

function LiveTickBridge({chart,latest}:{chart:FastFinancialChartRef|null;latest?:{epoch:number;quote:number}|null}) { useEffect(()=>{if(!chart||!latest)return;chart.applyTick({seriesId:'SIRE',ts:Math.floor(latest.epoch*1000),price:latest.quote,volume:0});},[chart,latest]); return null; }
