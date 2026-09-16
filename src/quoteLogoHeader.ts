const STYLE_ID = 'sire-quote-logo-header-style';
const HEADER_ID = 'sire-quote-logo-header';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* Quote uses the SIRE logo directly above the search bar. */
    body.sire-active-quote .terminal-topbar { display: none !important; }
    .sire-tab-quote #sire-quote-logo-header {
      width: min(760px, 100%);
      margin: 0 auto 10px;
      padding: 0 2px;
      display: flex !important;
      align-items: center;
      gap: 11px;
      min-height: 44px;
      color: #fff;
      box-sizing: border-box;
      order: 0 !important;
      flex: 0 0 auto !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .sire-tab-quote #sire-quote-logo-header .quote-logo-mark {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 11px;
      background: rgba(255,255,255,.025);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.07);
      font-size: 24px;
      line-height: 1;
      font-weight: 800;
      flex: 0 0 auto;
    }
    .sire-tab-quote #sire-quote-logo-header .quote-logo-name {
      font-size: 18px;
      line-height: 1;
      font-weight: 900;
      letter-spacing: .16em;
    }
  `;
  document.head.appendChild(style);
}

function mount() {
  installStyles();
  const sidebar = document.querySelector('.sire-tab-quote .symbol-sidebar') as HTMLElement | null;
  const search = sidebar?.querySelector('.sidebar-search') as HTMLElement | null;
  if (!sidebar || !search) return;

  let header = document.getElementById(HEADER_ID) as HTMLElement | null;
  if (!header || !sidebar.contains(header)) {
    header = document.createElement('div');
    header.id = HEADER_ID;
    header.innerHTML = '<div class="quote-logo-mark">✦</div><div class="quote-logo-name">SIRE</div>';
  }

  /* Always keep the logo immediately before Search, even after React rerenders Quote. */
  if (search.previousElementSibling !== header) sidebar.insertBefore(header, search);
}

function install() {
  mount();
  window.setTimeout(mount, 100);
  window.setTimeout(mount, 300);
  window.setTimeout(mount, 800);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();

const observer = new MutationObserver(() => mount());
observer.observe(document.documentElement, { childList: true, subtree: true });

// Quote can be activated by a class change after its DOM already exists.
const rootObserver = new MutationObserver(() => mount());
rootObserver.observe(document.getElementById('root') || document.documentElement, {
  attributes: true,
  attributeFilter: ['class'],
});

window.setInterval(mount, 300);
