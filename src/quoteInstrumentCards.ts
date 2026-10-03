const STYLE_ID = 'sire-quote-instrument-cards-style';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .sire-tab-quote .symbol-list {
      flex:1 1 0!important;
      min-height:0!important;
      overflow-y:auto!important;
      overflow-x:hidden!important;
      -webkit-overflow-scrolling:touch!important;
      touch-action:pan-y!important;
    }
    .sire-tab-quote .symbol-list .symbol-row {
      touch-action:pan-y!important;
    }
    .sire-tab-quote .sire-market-providers {
      max-width:760px;
      width:100%;
      margin:0 auto 8px;
      display:flex;
      gap:5px;
      overflow-x:auto;
      scrollbar-width:none;
      touch-action:pan-x;
    }
    .sire-tab-quote .sire-market-providers::-webkit-scrollbar { display:none }
  `;
  document.head.appendChild(style);
}

if(document.readyState==='loading') {
  document.addEventListener('DOMContentLoaded',installStyles,{once:true});
} else {
  installStyles();
}
