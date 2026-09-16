const BAR_ID = 'sire-glass-action-bar';
const STYLE_ID = 'sire-glass-action-bar-style';

function install() {
  if (document.getElementById(BAR_ID)) return;

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BAR_ID}{
        position:fixed;z-index:9998;left:50%;bottom:calc(max(6px,env(safe-area-inset-bottom)) + 57px);
        transform:translateX(-50%);width:min(720px,calc(100vw - 28px));height:50px;
        box-sizing:border-box;display:flex;align-items:center;gap:5px;padding:5px 7px;
        border:1px solid rgba(255,255,255,.16);border-radius:17px;
        background:rgba(10,13,18,.34);-webkit-backdrop-filter:blur(24px) saturate(145%);
        backdrop-filter:blur(24px) saturate(145%);
        box-shadow:0 14px 38px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.13),
          inset 0 -1px 0 rgba(255,255,255,.025),0 0 18px rgba(255,255,255,.055);
        overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;
        overscroll-behavior-x:contain;touch-action:pan-x;white-space:nowrap;isolation:isolate;
      }
      #${BAR_ID}::-webkit-scrollbar{display:none}
      #${BAR_ID} .glass-action{
        appearance:none;border:1px solid rgba(255,255,255,.09);border-radius:12px;
        background:rgba(255,255,255,.055);color:rgba(255,255,255,.82);height:40px;
        min-width:66px;padding:0 11px;display:inline-flex;align-items:center;justify-content:center;
        gap:7px;flex:0 0 auto;font:700 11px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        letter-spacing:.05em;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;
      }
      #${BAR_ID} .glass-action:active{background:rgba(255,255,255,.12);transform:scale(.98)}
      #${BAR_ID} .glass-action-icon{font-size:17px;line-height:1;opacity:.9}
      #${BAR_ID} .glass-action-label{font-size:11px;font-weight:800;line-height:1}
      #${BAR_ID} .glass-action[data-action="symbol"]{min-width:126px;padding:0 13px;overflow:hidden}
      #${BAR_ID} .glass-action[data-action="symbol"] .glass-action-icon{display:none}
      #${BAR_ID} .symbol-viewport{position:relative;display:block;flex:1;width:100%;height:22px;line-height:22px;overflow:hidden;font-size:18px;font-weight:900;letter-spacing:.01em;text-align:left}
      #${BAR_ID} .symbol-current{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${BAR_ID} .glass-action[data-action="time"] .glass-action-icon{display:none}
      #${BAR_ID} .glass-action[data-action="time"] .glass-action-label{font-size:18px;font-weight:900;letter-spacing:.01em}
      #${BAR_ID} .glass-action[data-action="indicators"] .glass-action-icon{font-size:23px;font-weight:900}
      @media(max-width:520px){#${BAR_ID}{width:calc(100vw - 20px);height:50px}#${BAR_ID} .glass-action{height:40px}}
    `;
    document.head.appendChild(style);
  }

  const bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.setAttribute('aria-label','Chart tools');
  bar.innerHTML = `
    <button type="button" class="glass-action" data-action="symbol" aria-label="Select instrument">
      <span class="symbol-viewport"><span class="symbol-current">Instrument</span></span>
    </button>
    <button type="button" class="glass-action" data-action="time" aria-label="Change timeframe">
      <span class="glass-action-icon">◷</span><span class="glass-action-label">1m</span>
    </button>
    <button type="button" class="glass-action" data-action="indicators" aria-label="Indicators">
      <span class="glass-action-icon">ƒ</span><span class="glass-action-label">INDICATORS</span>
    </button>
    <button type="button" class="glass-action" data-action="draw" aria-label="Drawing tools">
      <span class="glass-action-icon">✎</span><span class="glass-action-label">DRAW</span>
    </button>
    <button type="button" class="glass-action" data-action="tools" aria-label="Chart tools">
      <span class="glass-action-icon">◇</span><span class="glass-action-label">TOOLS</span>
    </button>
  `;

  const chartIsActive = () => document.getElementById('root')?.classList.contains('sire-chart-tab');
  const clickExisting = (selector: string) => {
    const node = document.querySelector(selector);
    if (node instanceof HTMLElement) node.click();
  };

  bar.querySelector('[data-action="symbol"]')?.addEventListener('click', () => {
    clickExisting('.native-instrument-picker');
  });

  bar.querySelector('[data-action="time"]')?.addEventListener('click', () => {
    const buttons = Array.from(document.querySelectorAll('.native-timeframes button')) as HTMLButtonElement[];
    if (!buttons.length) return;
    const active = buttons.findIndex(button => button.classList.contains('active') || button.getAttribute('aria-pressed') === 'true');
    buttons[(active + 1 + buttons.length) % buttons.length]?.click();
  });

  bar.querySelector('[data-action="indicators"]')?.addEventListener('click', () => clickExisting('.native-chart-actions button'));
  bar.querySelector('[data-action="draw"]')?.addEventListener('click', () => clickExisting('.native-chart-actions button[title*="Draw" i], .native-chart-actions button[aria-label*="Draw" i]'));
  bar.querySelector('[data-action="tools"]')?.addEventListener('click', () => clickExisting('.native-chart-actions button:last-child'));

  document.body.appendChild(bar);

  const sync = () => {
    const root = document.getElementById('root');
    bar.style.display = root?.classList.contains('sire-chart-tab') ? 'flex' : 'none';
    const source = document.querySelector('.native-instrument-picker strong');
    const symbol = bar.querySelector('.symbol-current');
    if (symbol instanceof HTMLElement && source?.textContent?.trim()) symbol.textContent = source.textContent.trim();
    const active = document.querySelector('.native-timeframes button.active, .native-timeframes button[aria-pressed="true"]');
    const label = active?.textContent?.trim();
    const time = bar.querySelector('[data-action="time"] .glass-action-label');
    if (time instanceof HTMLElement && label) time.textContent = label;
  };

  sync();
  new MutationObserver(sync).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-pressed']});
  window.setInterval(sync,1000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
