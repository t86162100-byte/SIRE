const STYLE_ID = 'sire-quote-instrument-cards-style';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* TradingView-style quote rows: no quote price, Bid/Ask or status dot. */
    .sire-tab-quote .symbol-list .symbol-row {
      position:relative!important;
      display:grid!important;
      grid-template-columns:72px minmax(0,1fr) 104px!important;
      grid-template-rows:1fr!important;
      align-items:center!important;
      gap:0 12px!important;
      min-height:88px!important;
      height:88px!important;
      padding:8px 12px!important;
      border:0!important;
      border-bottom:1px solid rgba(255,255,255,.12)!important;
      border-radius:0!important;
      background:transparent!important;
      box-shadow:none!important;
      overflow:hidden!important;
      text-align:left!important;
      transition:background .16s ease!important;
    }
    .sire-tab-quote .symbol-list .symbol-row:hover,
    .sire-tab-quote .symbol-list .symbol-row:active,
    .sire-tab-quote .symbol-list .symbol-row.active {
      background:rgba(255,255,255,.045)!important;
    }

    .sire-tab-quote .quote-asset-logo-wrap {
      grid-column:1!important;
      grid-row:1!important;
      width:68px!important;
      height:68px!important;
      display:flex!important;
      align-items:center!important;
      justify-content:center!important;
      border-radius:50%!important;
      overflow:hidden!important;
      flex:0 0 68px!important;
    }
    .sire-tab-quote .quote-asset-logo {
      width:68px!important;
      height:68px!important;
      display:block!important;
      flex:0 0 68px!important;
      object-fit:cover!important;
      border-radius:50%!important;
      background:rgba(255,255,255,.07)!important;
      padding:0!important;
      box-sizing:border-box!important;
    }

    .sire-tab-quote .quote-instrument-name {
      grid-column:2!important;
      grid-row:1!important;
      min-width:0!important;
      display:flex!important;
      flex-direction:column!important;
      align-items:flex-start!important;
      justify-content:center!important;
      gap:4px!important;
      text-align:left!important;
      overflow:hidden!important;
    }
    .sire-tab-quote .quote-instrument-name b {
      display:block!important;
      width:100%!important;
      min-width:0!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:19px!important;
      line-height:1.05!important;
      font-weight:900!important;
      letter-spacing:-.01em!important;
      color:#f5f5f5!important;
    }
    .sire-tab-quote .quote-instrument-name small {
      display:block!important;
      width:100%!important;
      min-width:0!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:13px!important;
      line-height:1.2!important;
      font-weight:600!important;
      color:rgba(235,235,240,.62)!important;
      letter-spacing:0!important;
    }

    .sire-tab-quote .quote-broker {
      grid-column:3!important;
      grid-row:1!important;
      min-width:0!important;
      height:72px!important;
      display:flex!important;
      flex-direction:column!important;
      align-items:center!important;
      justify-content:center!important;
      gap:3px!important;
      text-align:center!important;
      overflow:hidden!important;
    }
    .sire-tab-quote .quote-broker-logo {
      width:40px!important;
      height:40px!important;
      flex:0 0 40px!important;
      display:block!important;
      object-fit:contain!important;
      border-radius:50%!important;
      background:rgba(255,255,255,.06)!important;
      padding:2px!important;
      box-sizing:border-box!important;
    }
    .sire-tab-quote .quote-broker b {
      max-width:100%!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:12px!important;
      line-height:1!important;
      font-weight:850!important;
      color:rgba(245,245,250,.92)!important;
    }
    .sire-tab-quote .quote-broker small {
      max-width:100%!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:10px!important;
      line-height:1!important;
      font-weight:650!important;
      color:rgba(235,235,240,.56)!important;
      text-transform:lowercase!important;
    }

    .sire-tab-quote .quote-status-dot,
    .sire-tab-quote .sire-quote-price,
    .sire-tab-quote .sire-quote-details {
      display:none!important;
    }

    .sire-tab-quote .symbol-list .sire-instrument-card {
      width:100%!important;
      box-sizing:border-box!important;
      display:grid!important;
      grid-template-columns:42px minmax(0,1fr) auto!important;
      grid-template-rows:1fr!important;
      align-items:center!important;
      column-gap:11px!important;
      min-height:74px!important;
      height:74px!important;
      padding:7px 10px!important;
      margin:0!important;
      border:0!important;
      border-bottom:1px solid rgba(255,255,255,.075)!important;
      border-radius:0!important;
      background:transparent!important;
      box-shadow:none!important;
      text-align:left!important;
      overflow:hidden!important;
    }
    .sire-tab-quote .symbol-list .sire-instrument-card:hover,
    .sire-tab-quote .symbol-list .sire-instrument-card:active,
    .sire-tab-quote .symbol-list .sire-instrument-card.active {
      background:rgba(255,255,255,.028)!important;
    }

    .sire-instrument-card .sire-card-asset {
      grid-column:1!important;
      grid-row:1!important;
      display:flex!important;
      align-items:center!important;
      justify-content:center!important;
      width:40px!important;
      height:40px!important;
    }
    .sire-instrument-card .sire-card-asset .quote-asset-logo-wrap {
      width:40px!important;
      height:40px!important;
      display:flex!important;
      align-items:center!important;
      justify-content:center!important;
    }
    .sire-instrument-card .sire-card-asset .quote-asset-logo {
      width:40px!important;
      height:40px!important;
      object-fit:contain!important;
      border-radius:50%!important;
      background:rgba(255,255,255,.035)!important;
    }

    .sire-instrument-card .sire-card-main {
      grid-column:2 / span 2!important;
      grid-row:1!important;
      min-width:0!important;
      display:grid!important;
      grid-template-columns:minmax(0,1fr) auto!important;
      grid-template-rows:auto auto!important;
      align-items:center!important;
      column-gap:9px!important;
      row-gap:2px!important;
      overflow:hidden!important;
    }
    .sire-instrument-card .sire-card-identity {
      grid-column:1!important;
      grid-row:1!important;
      min-width:0!important;
      display:flex!important;
      flex-direction:column!important;
      align-items:flex-start!important;
      gap:2px!important;
      overflow:hidden!important;
    }
    .sire-instrument-card .sire-card-identity > b {
      width:100%!important;
      min-width:0!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:15px!important;
      line-height:1.05!important;
      font-weight:850!important;
      letter-spacing:-.01em!important;
      color:#f5f5f5!important;
    }
    .sire-instrument-card .sire-card-identity > small {
      width:100%!important;
      min-width:0!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:10px!important;
      line-height:1.1!important;
      font-weight:600!important;
      color:rgba(235,235,240,.54)!important;
    }

    .sire-instrument-card .sire-card-provider-inline {
      max-width:100%!important;
      min-width:0!important;
      display:flex!important;
      align-items:center!important;
      gap:4px!important;
      overflow:hidden!important;
      line-height:1!important;
    }
    .sire-instrument-card .sire-card-provider-inline .quote-exchange-logo-wrap {
      width:14px!important;
      height:14px!important;
      flex:0 0 14px!important;
      display:flex!important;
      align-items:center!important;
      justify-content:center!important;
    }
    .sire-instrument-card .sire-card-provider-inline .quote-exchange-logo {
      width:13px!important;
      height:13px!important;
      object-fit:contain!important;
      border-radius:50%!important;
      background:transparent!important;
      padding:0!important;
    }
    .sire-instrument-card .sire-card-provider-inline > b {
      min-width:0!important;
      max-width:38%!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:8px!important;
      line-height:1!important;
      font-weight:800!important;
      color:rgba(245,245,250,.62)!important;
    }
    .sire-instrument-card .sire-card-provider-inline > small {
      min-width:0!important;
      max-width:52%!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:8px!important;
      line-height:1!important;
      font-weight:650!important;
      color:rgba(235,235,240,.38)!important;
      text-transform:uppercase!important;
      letter-spacing:.02em!important;
    }
    .sire-instrument-card .sire-card-provider-inline > small::before {
      content:'·'!important;
      margin-right:4px!important;
      color:rgba(235,235,240,.24)!important;
    }

    .sire-instrument-card .sire-card-market {
      grid-column:2!important;
      grid-row:1!important;
      min-width:78px!important;
      display:flex!important;
      flex-direction:column!important;
      align-items:flex-end!important;
      justify-content:center!important;
      gap:3px!important;
      white-space:nowrap!important;
      text-align:right!important;
    }
    .sire-instrument-card .sire-card-market .sire-card-value-label {
      font-size:7px!important;
      line-height:1!important;
      font-weight:750!important;
      letter-spacing:.04em!important;
      color:rgba(235,235,240,.34)!important;
      text-transform:uppercase!important;
    }
    .sire-instrument-card .sire-card-market strong {
      font-size:15px!important;
      line-height:1!important;
      font-weight:850!important;
      color:#fff!important;
    }
    .sire-instrument-card .sire-card-market em {
      font-style:normal!important;
      font-size:10px!important;
      line-height:1!important;
      font-weight:850!important;
    }
    .sire-instrument-card .sire-card-market em.positive { color:#42d99b!important; }
    .sire-instrument-card .sire-card-market em.negative { color:#ff536b!important; }

    .sire-instrument-card .sire-card-metrics {
      grid-column:1 / span 2!important;
      grid-row:2!important;
      min-width:0!important;
      max-width:100%!important;
      display:flex!important;
      align-items:center!important;
      gap:8px!important;
      overflow:hidden!important;
    }
    .sire-instrument-card .sire-card-metrics small {
      min-width:0!important;
      overflow:hidden!important;
      text-overflow:ellipsis!important;
      white-space:nowrap!important;
      font-size:8px!important;
      line-height:1!important;
      font-weight:700!important;
      letter-spacing:.01em!important;
      color:rgba(235,235,240,.40)!important;
    }

    @media(max-width:520px){
      .sire-tab-quote .symbol-list .sire-instrument-card {
        grid-template-columns:40px minmax(0,1fr) auto!important;
        column-gap:9px!important;
        min-height:72px!important;
        height:72px!important;
        padding:7px 8px!important;
      }
      .sire-instrument-card .sire-card-asset,
      .sire-instrument-card .sire-card-asset .quote-asset-logo-wrap,
      .sire-instrument-card .sire-card-asset .quote-asset-logo {
        width:38px!important;
        height:38px!important;
      }
      .sire-instrument-card .sire-card-identity > b { font-size:14px!important }
      .sire-instrument-card .sire-card-identity > small { font-size:9px!important }
      .sire-instrument-card .sire-card-provider-inline > b,
      .sire-instrument-card .sire-card-provider-inline > small { font-size:7px!important }
      .sire-instrument-card .sire-card-market { min-width:72px!important }
      .sire-instrument-card .sire-card-market strong { font-size:14px!important }
      .sire-instrument-card .sire-card-market em { font-size:9px!important }
      .sire-instrument-card .sire-card-metrics small { font-size:7px!important }
    }

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

    @media(max-width:520px){
      .sire-tab-quote .symbol-list .symbol-row {
        grid-template-columns:68px minmax(0,1fr) 88px!important;
        gap:0 10px!important;
        min-height:88px!important;
        height:88px!important;
        padding:7px 8px!important;
      }
      .sire-tab-quote .quote-asset-logo-wrap,
      .sire-tab-quote .quote-asset-logo {
        width:64px!important;
        height:64px!important;
        flex-basis:64px!important;
      }
      .sire-tab-quote .quote-instrument-name b { font-size:18px!important }
      .sire-tab-quote .quote-instrument-name small { font-size:12px!important }
      .sire-tab-quote .quote-broker { height:70px!important }
      .sire-tab-quote .quote-broker-logo { width:38px!important;height:38px!important;flex-basis:38px!important }
      .sire-tab-quote .quote-broker b { font-size:11px!important }
      .sire-tab-quote .quote-broker small { font-size:9px!important }
    }
  `;
  document.head.appendChild(style);
}

if(document.readyState==='loading') {
  document.addEventListener('DOMContentLoaded',installStyles,{once:true});
} else {
  installStyles();
}
