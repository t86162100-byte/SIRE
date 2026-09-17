import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MutableRefObject } from 'react';
import type { DrawingObject, DrawingPoint, DrawingToolType, FastFinancialChartRef } from '@pairlens/fast-financial-charts/types';

const RETICLE_FINGER_OFFSET_Y = 48;
const DEFAULT_COLOR = '#ffb020';
const DEFAULT_LINE_WIDTH = 1.5;
const POINT_COUNTS: Partial<Record<DrawingToolType, number>> = {
  hline:1, hray:1, vline:1, crossline:1, text:1, 'anchored-vwap':1,
  channel:3, pitchfork:3, 'fib-extension':3, 'fib-channel':3, 'triangle-pattern':3,
  arc:3, 'rotated-rectangle':3, 'fib-wedge':3, 'abcd-pattern':4, 'xabcd-pattern':5, 'head-shoulders':7,
};
const FREEHAND = new Set<DrawingToolType>(['brush','highlighter','polyline','elliott-wave']);
const FIB_LEVELS: Partial<Record<DrawingToolType, number[]>> = {
  fibonacci:[0,.236,.382,.5,.618,.786,1], 'fib-extension':[0,.236,.382,.5,.618,1,1.618,2.618],
  'fib-channel':[0,.236,.382,.5,.618,1], 'gann-box':[0,.25,.5,.75,1], 'fib-time-zone':[0,1,2,3,5,8,13], 'fib-wedge':[0,.236,.382,.5,.618,1],
};
export function placementPointCount(tool: DrawingToolType | null) { if (!tool || tool === 'select' || FREEHAND.has(tool) || tool.startsWith('custom:')) return 0; return POINT_COUNTS[tool] ?? 2; }
export function isPlaceableTool(tool: DrawingToolType | null) { return placementPointCount(tool) > 0; }
function clamp(p:{x:number;y:number}, width:number, height:number, priceAxisWidth:number, timeAxisHeight:number) { return { x:Math.min(Math.max(p.x,0),Math.max(0,width-priceAxisWidth-1)), y:Math.min(Math.max(p.y,0),Math.max(0,height-timeAxisHeight-1)) }; }
function buildDrawing(tool: DrawingToolType, points: DrawingPoint[], seriesId:string, content?:string): Omit<DrawingObject,'id'> | null {
  const needed=placementPointCount(tool); if(!needed || points.length<needed) return null;
  const base={ color:tool==='long-position'?'#22c55e':tool==='short-position'?'#ef4444':DEFAULT_COLOR, lineWidth:DEFAULT_LINE_WIDTH, visible:true, seriesId };
  const first=points[0];
  switch(tool){
    case 'hline': return {...base,type:'hline',price:first.price};
    case 'hray': return {...base,type:'hray',price:first.price,ts:first.ts};
    case 'vline': return {...base,type:'vline',ts:first.ts};
    case 'crossline': return {...base,type:'crossline',point:first};
    case 'anchored-vwap': return {...base,type:'anchored-vwap',point:first};
    case 'text': return {...base,type:'text',point:first,content:content?.trim()||'Text',fontSize:12};
    case 'callout': return {...base,type:'callout',points:[first,points[1]],content:content?.trim()||'Label'};
    case 'ray': return {...base,type:'ray',points:[first,points[1]],extend:'right'};
    default: return {...base,type:tool,points:points.slice(0,needed),...(FIB_LEVELS[tool]?{levels:FIB_LEVELS[tool]}:{})} as Omit<DrawingObject,'id'>;
  }
}
function formatPrice(value:number){return Number.isFinite(value)?new Intl.NumberFormat(undefined,{maximumFractionDigits:8}).format(value):'—';}
function formatTime(value:number){return Number.isFinite(value)?new Intl.DateTimeFormat(undefined,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'—';}

type Props={chartRef:MutableRefObject<FastFinancialChartRef|null>;tool:DrawingToolType|null;seriesId:string;label:string;onCancel:()=>void;onComplete:()=>void};

export function MobileDrawingPlacement({chartRef,tool,seriesId,label,onCancel,onComplete}:Props){
  const [frame,setFrame]=useState({width:0,height:0});
  const [reticle,setReticle]=useState<{x:number;y:number}|null>(null);
  const [placed,setPlaced]=useState<DrawingPoint[]>([]);
  const [content,setContent]=useState('');
  const [cursorValue,setCursorValue]=useState<{price:number;ts:number}|null>(null);
  const captureRef=useRef<HTMLDivElement|null>(null);
  const hostRef=useRef<HTMLDivElement|null>(null);
  const needed=placementPointCount(tool);

  useEffect(()=>{const el=hostRef.current;if(!el)return;const measure=()=>setFrame({width:el.clientWidth,height:el.clientHeight});measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();},[]);
  useEffect(()=>{setPlaced([]);setContent('');setReticle(null);setCursorValue(null);},[tool]);

  const cursor=useMemo(()=>{const width=Math.max(0,frame.width-76);const height=Math.max(0,frame.height-22);return clamp(reticle??{x:width/2,y:height/2},frame.width,frame.height,76,22);},[frame,reticle]);

  // The engine exposes these conversions, but keep them out of render-time failure paths.
  const readPoint=useCallback((p:{x:number;y:number})=>{
    const chart=chartRef.current;
    if(!chart || frame.width<2 || frame.height<2)return null;
    try{
      const price=chart.coordinateToPrice(p.y);
      const ts=chart.coordinateToTime(p.x);
      return price==null||ts==null||!Number.isFinite(price)||!Number.isFinite(ts)?null:{price,ts};
    }catch{return null;}
  },[chartRef,frame.height,frame.width]);

  useEffect(()=>{setCursorValue(readPoint(cursor));},[cursor,readPoint]);

  const finish=useCallback((points:DrawingPoint[],text?:string)=>{if(!tool)return;const drawing=buildDrawing(tool,points,seriesId,text);if(!drawing)return;try{chartRef.current?.executeCommand({type:'addDrawing',payload:drawing});}catch{return;}setPlaced([]);setContent('');setReticle(null);setCursorValue(null);onComplete();},[chartRef,onComplete,seriesId,tool]);
  const confirmPoint=useCallback(()=>{if(!tool||!needed)return;const point=readPoint(cursor);if(!point)return;const next=[...placed,point];if(next.length<needed){setPlaced(next);return;}if(tool==='text'||tool==='callout'){setPlaced(next);return;}finish(next);},[cursor,finish,needed,placed,readPoint,tool]);
  const commitText=useCallback(()=>{if(placed.length>=needed)finish(placed,content);},[content,finish,needed,placed]);
  const move=useCallback((event:ReactPointerEvent<HTMLDivElement>)=>{const rect=event.currentTarget.getBoundingClientRect();setReticle(clamp({x:event.clientX-rect.left,y:event.clientY-rect.top-RETICLE_FINGER_OFFSET_Y},rect.width,rect.height,76,22));},[]);

  if(!tool||!needed)return null;
  const anchors=placed.flatMap(item=>{try{const x=chartRef.current?.timeToCoordinate(item.ts);const y=chartRef.current?.priceToCoordinate(item.price);return x==null||y==null||!Number.isFinite(x)||!Number.isFinite(y)?[]:[{x,y}];}catch{return[];}});
  const guide=[...anchors,cursor];

  return <div ref={hostRef} className="sire-mobile-placement-layer" style={{position:'absolute',inset:0,zIndex:10020,pointerEvents:'none',background:'transparent'}}>
    <svg aria-hidden style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}} viewBox={`0 0 ${Math.max(frame.width,1)} ${Math.max(frame.height,1)}`}>
      {guide.length>1?<polyline fill="none" points={guide.map(p=>`${p.x},${p.y}`).join(' ')} stroke="#3ea6ff" strokeWidth="1.5" strokeDasharray="5 4"/>:null}
    </svg>
    {anchors.map((a,i)=><span key={i} style={{position:'absolute',width:10,height:10,left:a.x-5,top:a.y-5,border:'2px solid #3ea6ff',borderRadius:3,background:'#091018'}}/>)}
    <span style={{position:'absolute',left:0,top:cursor.y,width:Math.max(0,frame.width-76),borderTop:'1px dashed rgba(62,166,255,.75)'}}/>
    <span style={{position:'absolute',left:cursor.x,top:0,height:Math.max(0,frame.height-22),borderLeft:'1px dashed rgba(62,166,255,.75)'}}/>
    <span style={{position:'absolute',left:cursor.x-9,top:cursor.y-9,width:18,height:18,border:'2px solid #3ea6ff',borderRadius:'50%'}}/>
    {cursorValue?<div style={{position:'absolute',left:Math.min(cursor.x+12,Math.max(8,frame.width-190)),top:Math.max(8,cursor.y-54),padding:'6px 8px',borderRadius:8,background:'rgba(8,14,21,.94)',border:'1px solid rgba(62,166,255,.4)',color:'#e7eef7',fontSize:11,lineHeight:1.35,whiteSpace:'nowrap'}}><strong>{formatPrice(cursorValue.price)}</strong><span style={{display:'block',color:'#94a4b5',fontSize:10}}>{formatTime(cursorValue.ts)}</span></div>:null}
    <div ref={captureRef} onPointerDown={event=>{captureRef.current?.setPointerCapture(event.pointerId);move(event);}} onPointerMove={event=>{if(captureRef.current?.hasPointerCapture(event.pointerId))move(event);}} style={{position:'absolute',left:0,top:0,width:'calc(100% - 76px)',height:'calc(100% - 22px)',pointerEvents:'auto',touchAction:'none',background:'transparent'}}/>
    <div style={{position:'absolute',left:12,right:12,bottom:28,pointerEvents:'auto',display:'flex',justifyContent:'center'}}><div style={{width:'min(520px,100%)',display:'flex',alignItems:'center',gap:8,padding:8,borderRadius:14,background:'rgba(9,14,21,.96)',border:'1px solid rgba(72,110,150,.45)',boxShadow:'0 12px 32px rgba(0,0,0,.45)',color:'#dce7f2'}}>
      <button type="button" onClick={onCancel} style={{minWidth:48,height:48,border:0,borderRadius:12,background:'rgba(30,40,52,.9)',color:'#c9d5e0',fontSize:20}}>×</button>
      <div style={{minWidth:0,flex:1}}><strong style={{display:'block',fontSize:13}}>{label}</strong><span style={{display:'block',color:'#8798aa',fontSize:11}}>{placed.length<needed?`Set point ${placed.length+1} of ${needed}`:'Add text to finish'}</span></div>
      {placed.length>=needed&&(tool==='text'||tool==='callout')?<input value={content} onChange={e=>setContent(e.target.value)} placeholder="Enter text" style={{width:120,height:42,borderRadius:10,border:'1px solid rgba(100,125,150,.35)',background:'#141c26',color:'#eef5fb',padding:'0 9px'}}/>:null}
      <button type="button" onClick={placed.length>=needed&&(tool==='text'||tool==='callout')?commitText:confirmPoint} style={{minWidth:108,height:48,border:0,borderRadius:12,background:'#1677ff',color:'white',fontSize:13,fontWeight:700}}>{placed.length>=needed&&(tool==='text'||tool==='callout')?'Finish':'Set point'}</button>
    </div></div>
  </div>;
}
