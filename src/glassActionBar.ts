const BAR_ID = 'sire-glass-action-bar';
const STYLE_ID = 'sire-glass-action-bar-style';

function install() {
  if (document.getElementById(BAR_ID)) return;

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BAR_ID}{
        position:fixed;z-index:10050;left:50%;bottom:calc(max(6px,env(safe-area-inset-bottom)) + 57px);
        transform:translateX(-50%);width:min(720px,calc(100vw - 20px));height:54px;
        box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:6px 8px;
        border:1px solid rgba(150,190,255,.22);border-radius:18px;
        background:rgba(14,19,28,.24);color:#fff;
        -webkit-backdrop-filter:blur(26px) saturate(150%);backdrop-filter:blur(26px) saturate(150%);
        box-shadow:0 16px 40px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.14),
          inset 0 -1px 0 rgba(255,255,255,.035),0 0 22px rgba(65,145,255,.10);
        overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;
        overscroll-behavior-x:contain;touch-action:pan-x;white-space:nowrap;isolation:isolate;
        pointer-events:auto;
      }
      #${BAR_ID}::-webkit-scrollbar{display:none}
      #${BAR_ID} .glass-action{
        appearance:none;-webkit-appearance:none;border:1px solid rgba(255,255,255,.13);border-radius:13px;
        background:rgba(255,255,255,.075);color:rgba(255,255,255,.92);height:42px;
        min-width:70px;padding:0 12px;display:inline-flex;align-items:center;justify-content:center;
        gap:7px;flex:0 0 auto;font:800 11px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        letter-spacing:.04em;cursor:pointer;touch-action:manipulation;pointer-events:auto;
        -webkit-tap-highlight-color:transparent;user-select:none;
      }
      #${BAR_ID} .glass-action:hover{background:rgba(255,255,255,.11);border-color:rgba(120,180,255,.34)}
      #${BAR_ID} .glass-action:active{background:rgba(120,180,255,.16);border-color:rgba(120,190,255,.48);transform:scale(.98)}
      #${BAR_ID} .glass-action-icon{font-size:18px;line-height:1;opacity:.95}
      #${BAR_ID} .glass-action-label{font-size:11px;font-weight:850;line-height:1}
      #${BAR_ID} .glass-action[data-action="symbol"]{min-width:132px;padding:0 13px;overflow:hidden;justify-content:flex-start}
      #${BAR_ID} .glass-action[data-action="symbol"] .glass-action-icon{display:none}
      #${BAR_ID} .symbol-viewport{position:relative;display:block;flex:1;width:100%;height:22px;line-height:22px;overflow:hidden;font-size:18px;font-weight:900;letter-spacing:.01em;text-align:left}
      #${BAR_ID} .symbol-current{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${BAR_ID} .glass-action[data-action="time"] .glass-action-icon{display:none}
      #${BAR_ID} .glass-action[data-action="time"] .glass-action-label{font-size:18px;font-weight:900;letter-spacing:.01em}
      #${BAR_ID} .glass-action[data-action="indicators"] .glass-action-icon{font-size:23px;font-weight:900}
      @media(max-width:520px){#${BAR_ID}{width:calc(100vw - 14px);height:54px}#${BAR_ID} .glass-action{height:42px}}
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

  const clickFirst = (selectors: string[]) => {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node instanceof HTMLElement) { node.click(); return true; }
    }
    return false;
  };

  const buttonByText = (patterns: RegExp[]) => {
    const buttons = Array.from(document.querySelectorAll('button,[role="button"]')) as HTMLElement[];
    return buttons.find(button => {
      if (bar.contains(button)) return false;
      const text = (button.textContent || button.getAttribute('aria-label') || button.getAttribute('title') || '').trim();
      return patterns.some(pattern => pattern.test(text));
    });
  };

  bar.querySelector('[data-action="symbol"]')?.addEventListener('click', () => {
    clickFirst([
      '.native-instrument-picker',
      '[data-testid*="instrument" i]',
      '[aria-label*="instrument" i]',
      '[title*="instrument" i]',
      '.instrument-picker',
    ]) || buttonByText([/instrument|symbol/i])?.click();
  });

  bar.querySelector('[data-action="time"]')?.addEventListener('click', () => {
    const timeButtons = Array.from(document.querySelectorAll('button,[role="button"]')) as HTMLElement[];
    const frames = /^(tick|\d+s|\d+m|\d+h|\d+d|1D|1W|1M)$/i;
    const buttons = timeButtons.filter(button => !bar.contains(button) && frames.test((button.textContent || '').trim()));
    if (!buttons.length) return;
    const active = buttons.findIndex(button => button.classList.contains('active') || button.classList.contains('tool-active') || button.getAttribute('aria-pressed') === 'true');
    buttons[(active + 1 + buttons.length) % buttons.length]?.click();
  });

  bar.querySelector('[data-action="indicators"]')?.addEventListener('click', () => {
    clickFirst(['[aria-label*="indicator" i]','[title*="indicator" i]','.native-chart-actions button']) || buttonByText([/indicator/i])?.click();
  });

  bar.querySelector('[data-action="draw"]')?.addEventListener('click', () => {
    clickFirst(['[aria-label*="draw" i]','[title*="draw" i]']) || buttonByText([/draw/i])?.click();
  });

  bar.querySelector('[data-action="tools"]')?.addEventListener('click', () => {
    clickFirst(['[aria-label*="tool" i]','[title*="tool" i]']) || buttonByText([/tool/i])?.click();
  });

  document.body.appendChild(bar);

  const sync = () => {
    const root = document.getElementById('root');
    const activeChart = root?.classList.contains('sire-chart-tab');
    bar.style.display = activeChart ? 'flex' : 'none';

    const source = document.querySelector('.native-instrument-picker strong, .native-instrument-picker [data-symbol-name], .instrument-picker strong');
    const symbol = bar.querySelector('.symbol-current');
    if (symbol instanceof HTMLElement && source?.textContent?.trim()) symbol.textContent = source.textContent.trim();

    const active = Array.from(document.querySelectorAll('button,[role="button"]')).find(button => {
      if (bar.contains(button)) return false;
      const text = (button.textContent || '').trim();
      return /^(tick|\d+s|\d+m|\d+h|\d+d|1D|1W|1M)$/i.test(text) && (button.classList.contains('active') || button.classList.contains('tool-active') || button.getAttribute('aria-pressed') === 'true');
    });
    const time = bar.querySelector('[data-action="time"] .glass-action-label');
    if (time instanceof HTMLElement && active?.textContent?.trim()) time.textContent = active.textContent.trim();
  };

  sync();
  new MutationObserver(sync).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-pressed']});
  window.setInterval(sync,1000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
