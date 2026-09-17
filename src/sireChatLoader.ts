const STYLE_ID = 'sire-chat-loader-style';
const PENDING_ID = 'sire-chat-pending';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* The response loader belongs in the conversation, never in the header. */
    .sire-chat-only-header .sire-live-dot { display:none !important; }
    #${PENDING_ID} { display:flex; justify-content:flex-start; width:100%; margin:0; padding:4px 0 18px; pointer-events:none; }
    #${PENDING_ID} .sire-chat-pending-bubble { display:flex; align-items:center; min-height:38px; padding:0 4px; }
    #${PENDING_ID} .sire-chat-pending-star {
      display:block; width:34px; height:34px; line-height:34px; text-align:center;
      color:#fff; font-size:30px; font-weight:900; font-family:system-ui,sans-serif;
      transform-origin:center; animation:sire-chat-pending-star 1.15s cubic-bezier(.45,0,.55,1) infinite;
      -webkit-font-smoothing:antialiased; text-rendering:geometricPrecision;
    }
    @keyframes sire-chat-pending-star {
      0% { transform:rotate(0deg) scale(.78); opacity:.86; }
      45% { transform:rotate(165deg) scale(1.08); opacity:1; }
      100% { transform:rotate(360deg) scale(.78); opacity:.86; }
    }
    .sire-chat-only [class*="activity"],
    .sire-chat-only [class*="thought"],
    .sire-chat-only [class*="thinking"],
    .sire-chat-only [class*="live"] { display:none !important; }
    @media(prefers-reduced-motion:reduce){#${PENDING_ID} .sire-chat-pending-star{animation:none!important}}
  `;
  document.head.appendChild(style);
}

function isBusy() {
  const dot = document.querySelector('.sire-chat-only-header .sire-live-dot');
  return Boolean(dot?.classList.contains('active'));
}

function findMessages() {
  return document.querySelector('.sire-chat-only-messages .sire-chat-only-inner') as HTMLElement | null;
}

function sync() {
  const inner = findMessages();
  if (!inner) return;
  const existing = document.getElementById(PENDING_ID);
  if (isBusy()) {
    if (existing) return;
    const pending = document.createElement('article');
    pending.id = PENDING_ID;
    pending.className = 'sire-chat-only-message sire pending';
    pending.setAttribute('aria-label', 'SIRE is responding');
    pending.innerHTML = '<div class="sire-chat-pending-bubble"><span class="sire-chat-pending-star" aria-hidden="true">✦</span></div>';
    inner.appendChild(pending);
  } else if (existing) {
    existing.remove();
  }
}

function install() {
  installStyles();
  sync();

  const dot = document.querySelector('.sire-chat-only-header .sire-live-dot');
  if (dot) new MutationObserver(sync).observe(dot, { attributes:true, attributeFilter:['class'] });

  const root = document.querySelector('.sire-chat-only') || document.body;
  new MutationObserver(() => sync()).observe(root, { childList:true, subtree:true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
else install();
