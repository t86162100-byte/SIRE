const STYLE_ID = 'sire-tab-navigation-style';
const NAV_ID = 'sire-bottom-tabs-v2';
const FLOAT_ID = 'sire-chart-floating-quote';
type Tab = 'home' | 'market' | 'trade' | 'discover' | 'portfolio';
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style'); style.id = STYLE_ID;
  style.textContent = `
    .sire-tab-mode .symbol-sidebar{display:none!important}.sire-tab-mode .chart-terminal{width:100%!important}
    .sire-tab-mode .terminal-topbar{display:none!important}.sire-tab-mode .terminal-topbar .instrument-picker,.sire-tab-mode .terminal-topbar .live-state,.sire-tab-mode .chart-subbar,.sire-tab-mode button[title="Open GPT research laboratory"]{display:none!important}
    .sire-tab-mode .chart-toolbar,html .chart-toolbar{display:none!important;height:0!important;min-height:0!important;max-height:0!important;padding:0!important;margin:0!important;overflow:hidden!important;pointer-events:none!important}
    .sire-chart-tab .research-controls{display:none!important}
    .sire-tab-quote .research-controls{display:none!important}
    .sire-tab-quote .terminal-body{display:block!important;padding-bottom:108px!important}.sire-tab-quote .native-chart-panel{display:none!important}.sire-tab-quote .native-symbol-sidebar{display:flex!important;flex-direction:column!important;width:100%!important;height:calc(100vh - 132px)!important;min-height:0!important;border-right:0!important;padding:16px 16px 108px!important;box-sizing:border-box;overflow:hidden!important;position:relative!important;z-index:2!important}.sire-tab-quote .native-symbol-sidebar > .sidebar-search,.sire-tab-quote .native-symbol-sidebar > .sidebar-meta{flex-shrink:0!important}.sire-tab-quote .native-symbol-sidebar > .native-symbol-list{flex:1 1 0!important;flex-shrink:1!important;min-height:0!important}.sire-tab-quote .sidebar-search{max-width:760px;width:100%;margin:0 auto 12px}.sire-tab-quote .sidebar-meta{max-width:760px;width:100%;margin:0 auto 10px}.sire-tab-quote .native-symbol-list{width:100%;max-width:760px;margin:0 auto;display:block!important;flex:1 1 auto!important;min-height:0!important;height:auto!important;visibility:visible!important;overflow-y:auto;align-content:start;padding:0 0 8px!important;box-sizing:border-box!important}.sire-tab-quote .sire-quote-window{display:block!important;width:100%!important}.sire-tab-quote .native-symbol-list > button{display:flex!important;visibility:visible!important;min-height:88px;height:88px!important;width:100%!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;padding:8px 12px!important;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.025);text-align:left}.sire-tab-quote .native-symbol-list > button.active{border-color:rgba(255,255,255,.72);background:rgba(255,255,255,.07);box-shadow:0 0 18px rgba(255,255,255,.08)}.sire-tab-quote .catalogue-refresh{width:min(760px,100%);margin:12px auto 0}
    .sire-chat-only-header .sire-chat-context,.sire-chat-only-header .sire-chat-only-close{display:none!important}.sire-chat-only-composer{bottom:62px!important;transition:transform .22s ease,opacity .22s ease}.sire-chat-only-composer.is-scroll-hidden{transform:translateY(calc(100% + 22px))!important;opacity:0!important;pointer-events:none!important}
    #${FLOAT_ID}{position:fixed;z-index:9000;top:14px;left:14px;display:none;pointer-events:none;color:#fff;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:left;line-height:1.05;text-shadow:0 2px 10px rgba(0,0,0,.9)}#${FLOAT_ID}.show{display:block}#${FLOAT_ID} .float-name{font-size:14px;font-weight:700;letter-spacing:.02em;color:rgba(255,255,255,.94);margin-bottom:6px}#${FLOAT_ID} .float-price-row{display:flex;align-items:baseline;gap:9px;white-space:nowrap}#${FLOAT_ID} .float-price{font-size:22px;font-weight:700;letter-spacing:.01em;color:#fff}#${FLOAT_ID} .float-change{font-size:12px;font-weight:700;letter-spacing:.01em;color:rgba(255,255,255,.62)}#${FLOAT_ID} .float-change.up{color:#4fd1c5}#${FLOAT_ID} .float-change.down{color:#ff5b63}
    #${NAV_ID}{position:fixed;z-index:9999;left:50%;right:auto;bottom:max(6px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:10px;padding:0;margin:0;pointer-events:none;background:transparent;border:0}#${NAV_ID} button{pointer-events:auto;min-width:86px;height:46px;padding:0 17px;border:1px solid rgba(255,255,255,.32);border-radius:999px;background:rgba(20,22,28,.34);color:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(18px) saturate(125%);backdrop-filter:blur(18px) saturate(125%);box-shadow:0 7px 22px rgba(0,0,0,.22),inset 0 0 0 1px rgba(255,255,255,.035),0 0 12px rgba(255,255,255,.035);font:700 11px/1 system-ui,sans-serif;letter-spacing:.09em;display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}#${NAV_ID} button.active{color:#fff;border-color:rgba(255,255,255,.9);background:rgba(255,255,255,.08);box-shadow:0 8px 26px rgba(0,0,0,.24),inset 0 0 0 1px rgba(255,255,255,.08),0 0 22px rgba(255,255,255,.18)}#${NAV_ID} .tab-icon{font-size:15px;line-height:1}.sire-tab-mode .terminal-body{padding-bottom:82px!important}.sire-chat-only{padding-bottom:82px!important}
    .sire-chart-bottom-glass{bottom:var(--sire-chart-bottom-glass-bottom,84px)!important;transition:bottom .22s ease;will-change:bottom}
    @media(max-width:520px){html,body,#root{margin:0!important;padding:0!important;min-height:100%!important;background:#000!important}.sire-tab-mode.sire-chart-tab .terminal-shell,.sire-tab-mode.sire-chart-tab .terminal-body,.sire-tab-mode.sire-chart-tab .chart-terminal,.sire-tab-mode.sire-chart-tab .chart-stage{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100%!important;height:100dvh!important;min-height:100dvh!important;margin:0!important;padding:0!important;box-sizing:border-box!important;transform:none!important}.sire-tab-mode.sire-chart-tab .terminal-shell{overflow:hidden!important;border:0!important;border-radius:0!important}.sire-tab-mode.sire-chart-tab .terminal-body{overflow:hidden!important}.sire-tab-mode.sire-chart-tab .chart-terminal,.sire-tab-mode.sire-chart-tab .chart-stage,.sire-tab-mode.sire-chart-tab .chart-area,.sire-tab-mode.sire-chart-tab .chart-container{background:#000!important}.sire-tab-mode.sire-chart-tab .chart-terminal{z-index:1!important}#${FLOAT_ID}{top:12px;left:14px}#${FLOAT_ID} .float-name{font-size:14px;margin-bottom:5px}#${FLOAT_ID} .float-price{font-size:21px}#${FLOAT_ID} .float-change{font-size:11px}#${NAV_ID}{gap:7px;bottom:max(6px,env(safe-area-inset-bottom));width:calc(100vw - 28px)}#${NAV_ID} button{flex:1 1 0;min-width:0;height:44px;padding:0 10px}.sire-chat-only-composer{bottom:60px!important}.sire-chart-tab .research-controls{display:none!important}}
    @media(min-width:800px){#${NAV_ID}{gap:12px}#${NAV_ID} button{min-width:94px;height:48px}}
    /* SIRE five-tab navigation — glass rail with a true center notch */
    #${NAV_ID}{position:fixed;z-index:9999;left:50%;right:auto;bottom:max(8px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;justify-content:center;width:min(500px,calc(100vw - 24px));height:60px;box-sizing:border-box;gap:2px;padding:6px 7px;margin:0;pointer-events:none;background:transparent;border:0;border-radius:30px;overflow:visible;isolation:isolate}
    #${NAV_ID}::before{content:"";position:absolute;inset:0;z-index:0;border:1px solid rgba(229,215,255,.16);border-radius:30px;background:rgba(16,12,25,.48);-webkit-backdrop-filter:blur(24px) saturate(135%);backdrop-filter:blur(24px) saturate(135%);box-shadow:0 14px 38px rgba(0,0,0,.34),inset 0 1px rgba(255,255,255,.09);-webkit-mask:radial-gradient(circle 34px at 50% 0,transparent 0 32px,#000 33px);mask:radial-gradient(circle 34px at 50% 0,transparent 0 32px,#000 33px);pointer-events:none}
    #${NAV_ID} button{position:relative;z-index:1;pointer-events:auto;flex:1 1 0;width:auto;min-width:0;height:48px;padding:0 4px;border:0;border-radius:16px;background:transparent;color:rgba(231,224,243,.58);font:600 9px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.075em;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:color .18s ease,transform .18s ease,filter .18s ease;box-shadow:none}
    #${NAV_ID} button:hover{color:rgba(255,255,255,.86)}
    #${NAV_ID} button.active:not(.trade-tab){color:#d7bdff;transform:translateY(-1px);background:transparent;border:0;box-shadow:none;text-shadow:0 0 14px rgba(164,108,255,.42)}
    #${NAV_ID} button.active:not(.trade-tab) .tab-icon svg{filter:drop-shadow(0 0 6px rgba(169,112,255,.55))}
    #${NAV_ID} .tab-icon{width:22px;height:22px;display:grid;place-items:center}
    #${NAV_ID} .tab-icon svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;transition:filter .18s ease,transform .18s ease}
    #${NAV_ID} .trade-tab{
      flex:0 0 66px;width:66px;min-width:66px;height:66px;margin:-22px 2px 0;
      border-radius:50%;padding:0;z-index:3;position:relative;overflow:hidden;
      border:1px solid rgba(241,231,255,.48);
      color:#fff;
      background:
        radial-gradient(circle at 29% 20%,rgba(255,255,255,.74) 0%,rgba(235,215,255,.34) 10%,transparent 27%),
        radial-gradient(circle at 69% 74%,rgba(78,24,157,.55) 0%,transparent 48%),
        radial-gradient(circle at 52% 44%,rgba(167,103,255,.30) 0%,rgba(82,35,153,.18) 46%,rgba(19,9,43,.38) 100%);
      -webkit-backdrop-filter:blur(14px) saturate(155%);
      backdrop-filter:blur(14px) saturate(155%);
      box-shadow:
        0 0 0 5px rgba(5,4,13,.94),
        0 0 0 6px rgba(164,103,255,.16),
        0 10px 30px rgba(82,30,176,.42),
        0 0 28px rgba(166,103,255,.22),
        inset 0 1px 1px rgba(255,255,255,.72),
        inset 0 -10px 18px rgba(26,8,57,.46);
      isolation:isolate;
    }
    #${NAV_ID} .trade-tab::before{
      content:"";position:absolute;inset:-10%;z-index:-1;pointer-events:none;border-radius:50%;
      background:
        radial-gradient(ellipse 65% 24% at 28% 18%,rgba(255,255,255,.78),transparent 68%),
        radial-gradient(ellipse 46% 28% at 78% 68%,rgba(211,139,255,.28),transparent 72%),
        linear-gradient(118deg,transparent 22%,rgba(255,255,255,.16) 42%,rgba(190,125,255,.08) 52%,transparent 72%);
      filter:blur(2px);
      mix-blend-mode:screen;
      transform:rotate(-12deg);
    }
    #${NAV_ID} .trade-tab::after{
      content:"";position:absolute;inset:8px;z-index:0;border-radius:50%;pointer-events:none;
      background:
        radial-gradient(circle at 32% 24%,rgba(255,255,255,.24),transparent 20%),
        radial-gradient(circle at 70% 76%,rgba(111,55,205,.28),transparent 44%),
        linear-gradient(145deg,rgba(255,255,255,.10),rgba(154,91,242,.08) 42%,rgba(23,9,49,.12));
      box-shadow:inset 0 1px rgba(255,255,255,.36),inset 0 -7px 13px rgba(16,5,39,.34);
      -webkit-backdrop-filter:blur(7px) saturate(170%);
      backdrop-filter:blur(7px) saturate(170%);
    }
    #${NAV_ID} .trade-tab:hover{transform:translateY(-1px)}
    #${NAV_ID} .trade-tab.active{
      box-shadow:
        0 0 0 5px rgba(5,4,13,.94),
        0 0 0 6px rgba(177,122,255,.25),
        0 12px 34px rgba(111,53,216,.54),
        0 0 34px rgba(177,113,255,.27),
        inset 0 1px 1px rgba(255,255,255,.78),
        inset 0 -10px 18px rgba(26,8,57,.46);
    }
    #${NAV_ID} .trade-tab .trade-logo{
      position:relative;z-index:2;width:38px;height:38px;object-fit:contain;
      opacity:.94;
      filter:
        brightness(1.28) saturate(.9)
        drop-shadow(0 0 2px rgba(255,255,255,.9))
        drop-shadow(0 0 7px rgba(181,117,255,.9))
        drop-shadow(0 4px 10px rgba(71,25,150,.58));
      mix-blend-mode:screen;
    }
    #${NAV_ID} .trade-label{position:absolute;top:66px;color:rgba(235,222,255,.70);font-size:7px;font-weight:700;letter-spacing:.11em;white-space:nowrap;pointer-events:none}
    @media(max-width:520px){#${NAV_ID}{width:calc(100vw - 20px);height:58px;bottom:max(7px,env(safe-area-inset-bottom));gap:1px;padding:5px;border-radius:29px}#${NAV_ID}::before{border-radius:29px;-webkit-mask:radial-gradient(circle 32px at 50% 0,transparent 0 30px,#000 31px);mask:radial-gradient(circle 32px at 50% 0,transparent 0 30px,#000 31px)}#${NAV_ID} button{height:47px;border-radius:14px;font-size:8px;gap:4px}#${NAV_ID} .tab-icon{width:21px;height:21px}#${NAV_ID} .tab-icon svg{width:19px;height:19px}#${NAV_ID} .trade-tab{flex:0 0 58px;width:58px;min-width:58px;height:58px;margin:-19px 2px 0}#${NAV_ID} .trade-tab .trade-logo{width:33px;height:33px}#${NAV_ID} .trade-label{top:59px;font-size:6.5px}}
    @media(min-width:800px){#${NAV_ID}{height:62px;gap:2px}#${NAV_ID}::before{border-radius:31px;-webkit-mask:radial-gradient(circle 35px at 50% 0,transparent 0 33px,#000 34px);mask:radial-gradient(circle 35px at 50% 0,transparent 0 33px,#000 34px)}#${NAV_ID} button{height:50px;font-size:9px}#${NAV_ID} .trade-tab{flex-basis:64px;width:64px;min-width:64px;height:64px;margin-top:-21px}}  `; document.head.appendChild(style);
}
function findChatCloseButton(){return document.querySelector('.sire-chat-only-close') as HTMLButtonElement|null}
function wireChatComposer(){const messages=document.querySelector('.sire-chat-only-messages') as HTMLElement|null,composer=document.querySelector('.sire-chat-only-composer') as HTMLElement|null;if(!messages||!composer||composer.dataset.scrollWired==='true')return;composer.dataset.scrollWired='true';composer.classList.remove('is-scroll-hidden');let previousTop=messages.scrollTop;messages.addEventListener('scroll',()=>{const nextTop=messages.scrollTop,delta=nextTop-previousTop;if(Math.abs(delta)>=4){composer.classList.toggle('is-scroll-hidden',delta>0&&nextTop>12);previousTop=nextTop}},{passive:true})}
function ensureFloatingQuote(){let el=document.getElementById(FLOAT_ID);if(el)return el;el=document.createElement('div');el.id=FLOAT_ID;el.innerHTML='<div class="float-name"></div><div class="float-price-row"><span class="float-price"></span><span class="float-change"></span></div>';document.body.appendChild(el);return el}
function updateFloatingQuote(){const el=ensureFloatingQuote();const source=document.querySelector('.chart-subbar');if(!source)return;const main=source.children[0] as HTMLElement|null;const ohlc=source.children[1] as HTMLElement|null;const priceNode=main?.querySelector('i') as HTMLElement|null;const nameNode=main?.querySelector('b') as HTMLElement|null;if(!main||!priceNode||!nameNode)return;const name=nameNode.textContent?.trim()||'';const price=priceNode.textContent?.trim()||'—';const raw=ohlc?.textContent||'';const numbers=raw.match(/[0-9][0-9,]*(?:\.[0-9]+)?/g)||[];let change='';if(numbers.length>=4){const open=Number(numbers[0].replace(/,/g,''));const close=Number(numbers[3].replace(/,/g,''));if(Number.isFinite(open)&&open!==0&&Number.isFinite(close)){const pct=((close-open)/open)*100;change=`${pct>=0?'▲ +':'▼ '}${pct.toFixed(2)}%`;}}el.querySelector('.float-name')!.textContent=name;el.querySelector('.float-price')!.textContent=price;const changeNode=el.querySelector('.float-change')!;changeNode.textContent=change;changeNode.classList.toggle('up',change.startsWith('▲'));changeNode.classList.toggle('down',change.startsWith('▼'));}
function setFloatingVisible(visible:boolean){ensureFloatingQuote().classList.toggle('show',visible)}
function wireFloatingQuote(){updateFloatingQuote()}
function updateChartGlassPosition(){const nav=document.getElementById(NAV_ID);if(!nav)return;const glass=document.querySelector('.sire-chart-bottom-glass') as HTMLElement|null;if(!glass)return;const style=getComputedStyle(nav);const rect=nav.getBoundingClientRect();const visible=style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>0&&rect.height>0&&rect.top<window.innerHeight&&rect.bottom>0;if(visible){const gap=16;const navBottomDistance=window.innerHeight-rect.bottom;const raisedBottom=navBottomDistance+rect.height+gap;const minimumRaise=window.innerWidth<=520?108:116;glass.style.setProperty('--sire-chart-bottom-glass-bottom',`${Math.max(minimumRaise,raisedBottom)}px`);}else{glass.style.setProperty('--sire-chart-bottom-glass-bottom','84px');}}
function setTab(tab:Tab){const root=document.getElementById('root'),nav=document.getElementById(NAV_ID);if(!root||!nav)return;const quote=tab==='market';const chart=tab==='trade';root.classList.toggle('sire-tab-mode',!quote);root.classList.toggle('sire-tab-quote',quote);root.classList.toggle('sire-chart-tab',chart);root.classList.toggle('sire-home-tab',tab==='home');setFloatingVisible(chart);nav.querySelectorAll('button').forEach(button=>button.classList.toggle('active',button.dataset.tab===tab));window.dispatchEvent(new CustomEvent('sire:tab-changed',{detail:{tab}}));if(tab==='home'){window.dispatchEvent(new CustomEvent('sire:open-home'));findChatCloseButton()?.click()}else{window.dispatchEvent(new CustomEvent('sire:close-home'));window.dispatchEvent(new CustomEvent('sire:close-market'));if(tab==='market')window.dispatchEvent(new CustomEvent('sire:open-market'));if(tab==='discover'){window.dispatchEvent(new CustomEvent('sire:open-research'));window.setTimeout(wireChatComposer,0)}else if(tab==='portfolio'){window.dispatchEvent(new CustomEvent('sire:open-portfolio'));findChatCloseButton()?.click()}else findChatCloseButton()?.click();}window.setTimeout(updateChartGlassPosition,0)}
function removeLegacyNavigation(){document.querySelectorAll('#sire-bottom-tabs,.sire-tab-navigation,.sire-bottom-navigation,.sire-legacy-tabs').forEach(node=>node.remove());}
function mountNavigation(){injectStyles();removeLegacyNavigation();if(document.getElementById(NAV_ID))return;ensureFloatingQuote();wireFloatingQuote();const nav=document.createElement('nav');nav.id=NAV_ID;nav.setAttribute('aria-label','Primary navigation');const tabs:Array<[Tab,string,string]>=[['home','<svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>','HOME'],['market','<svg viewBox="0 0 24 24"><path d="M4 19V9m5 10V5m6 14v-7m5 7V3"/></svg>','MARKET'],['trade','logo','TRADE'],['discover','<svg viewBox="0 0 24 24"><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="m19 16 .8 2.2L22 19l-2.2.8z"/></svg>','DISCOVER'],['portfolio','<svg viewBox="0 0 24 24"><path d="M4 7h16v13H4z"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M4 12h16"/><path d="M10 12v2h4v-2"/></svg>','PORTFOLIO']];tabs.forEach(([tab,icon,label])=>{const button=document.createElement('button');button.type='button';button.dataset.tab=tab;button.className=tab==='trade'?'trade-tab':'';button.innerHTML=tab==='trade'?'<img class="trade-logo" src="/sire-logo.svg" alt=""/><span class="trade-label">TRADE</span>':`<span class="tab-icon">${icon}</span><span>${label}</span>`;button.addEventListener('click',()=>setTab(tab));nav.appendChild(button)});document.body.appendChild(nav);window.dispatchEvent(new CustomEvent('sire:navigation-mounted'));setTab('home')}
window.addEventListener('sire:navigate',event=>{const detail=(event as CustomEvent).detail as {tab?:Tab}|undefined;if(detail?.tab)setTab(detail.tab);});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountNavigation,{once:true});else mountNavigation();
window.addEventListener('resize',updateChartGlassPosition,{passive:true});
let floatingFrame=0;
let floatingObserver:MutationObserver|null=null;
function watchFloatingQuote(){
  if(floatingObserver || !document.querySelector('.chart-subbar')) return;
  const source=document.querySelector('.chart-subbar') as HTMLElement;
  floatingObserver=new MutationObserver(()=>{
    if(floatingFrame) return;
    floatingFrame=window.requestAnimationFrame(()=>{floatingFrame=0;if(document.querySelector('.sire-chart-tab'))updateFloatingQuote();});
  });
  floatingObserver.observe(source,{childList:true,subtree:true,characterData:true});
}
window.addEventListener('sire:tab-changed',()=>{watchFloatingQuote();updateChartGlassPosition();});
