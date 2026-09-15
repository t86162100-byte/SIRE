const STYLE_ID = 'sire-tab-navigation-style';
const NAV_ID = 'sire-bottom-tabs';

type Tab = 'sire' | 'chart' | 'quote';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .sire-tab-mode .symbol-sidebar { display: none !important; }
    .sire-tab-mode .chart-terminal { width: 100% !important; }
    .sire-tab-quote .terminal-body { display: block !important; padding-bottom: 76px !important; }
    .sire-tab-quote .chart-terminal { display: none !important; }
    .sire-tab-quote .symbol-sidebar { display: flex !important; width: 100% !important; height: calc(100vh - 132px) !important; border-right: 0 !important; padding: 16px !important; box-sizing: border-box; }
    .sire-tab-quote .sidebar-search { max-width: 760px; width: 100%; margin: 0 auto 12px; }
    .sire-tab-quote .sidebar-meta { max-width: 760px; width: 100%; margin: 0 auto 10px; }
    .sire-tab-quote .symbol-list { width: 100%; max-width: 760px; margin: 0 auto; display: grid !important; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; overflow-y: auto; align-content: start; }
    .sire-tab-quote .symbol-row { min-height: 82px; padding: 14px !important; border: 1px solid rgba(255,255,255,.08); border-radius: 14px; background: rgba(255,255,255,.025); text-align: left; }
    .sire-tab-quote .symbol-row.active { border-color: rgba(120,190,255,.65); background: rgba(80,150,220,.09); }
    .sire-tab-quote .catalogue-refresh { width: min(760px, 100%); margin: 12px auto 0; }
    #${NAV_ID} { position: fixed; z-index: 9999; left: 0; right: 0; bottom: 0; height: 68px; display: grid; grid-template-columns: repeat(3, 1fr); padding: 8px 12px max(8px, env(safe-area-inset-bottom)); gap: 6px; box-sizing: border-box; background: rgba(8,11,17,.96); border-top: 1px solid rgba(255,255,255,.09); backdrop-filter: blur(18px); }
    #${NAV_ID} button { border: 0; border-radius: 12px; background: transparent; color: rgba(255,255,255,.55); font: 700 11px/1 system-ui,sans-serif; letter-spacing: .08em; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; cursor: pointer; }
    #${NAV_ID} button.active { color: #fff; background: rgba(255,255,255,.09); }
    #${NAV_ID} .tab-icon { font-size: 17px; line-height: 1; }
    @media (min-width: 800px) { #${NAV_ID} { left: 50%; right: auto; transform: translateX(-50%); width: 430px; border: 1px solid rgba(255,255,255,.1); border-bottom: 0; border-radius: 16px 16px 0 0; } }
  `;
  document.head.appendChild(style);
}

function findSireOpenButton() {
  return Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('title') === 'Open GPT research laboratory') as HTMLButtonElement | undefined;
}

function findChatCloseButton() {
  return document.querySelector('.sire-chat-only-close') as HTMLButtonElement | null;
}

function setTab(tab: Tab) {
  const root = document.getElementById('root');
  const nav = document.getElementById(NAV_ID);
  if (!root || !nav) return;

  root.classList.toggle('sire-tab-mode', tab !== 'quote');
  root.classList.toggle('sire-tab-quote', tab === 'quote');
  nav.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));

  if (tab === 'sire') {
    findSireOpenButton()?.click();
  } else {
    findChatCloseButton()?.click();
  }
}

function mountNavigation() {
  injectStyles();
  if (document.getElementById(NAV_ID)) return;

  const nav = document.createElement('nav');
  nav.id = NAV_ID;
  nav.setAttribute('aria-label', 'Primary navigation');
  const tabs: Array<[Tab, string, string]> = [
    ['sire', '✦', 'SIRE'],
    ['chart', '⌁', 'CHART'],
    ['quote', '▦', 'QUOTE'],
  ];
  tabs.forEach(([tab, icon, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tab = tab;
    button.innerHTML = `<span class="tab-icon">${icon}</span><span>${label}</span>`;
    button.addEventListener('click', () => setTab(tab));
    nav.appendChild(button);
  });
  document.body.appendChild(nav);
  setTab('chart');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountNavigation, { once: true });
else mountNavigation();

const observer = new MutationObserver(() => {
  if (!document.getElementById(NAV_ID)) mountNavigation();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
