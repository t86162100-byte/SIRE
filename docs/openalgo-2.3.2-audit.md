# SIRE vs OpenAlgo Charts 2.3.2 — feature audit

Branch audited: `render-migration`
OpenAlgo version: `2.3.2`
Market/data scope: Deriv Synthetic Indices only.

## Implemented and wired

| OpenAlgo 2.3.2 capability | SIRE status | Implementation |
|---|---|---|
| 13 standard chart types | Enabled | OpenAlgo widget chart-type registry/top bar |
| Transform chart types: Heikin Ashi, Renko, Range, Line Break, Point & Figure, Kagi | Enabled | `openalgo-charts/transform` registered before widget creation |
| 102 built-in indicators | Enabled | `openalgo-charts/indicators` + native Indicators picker |
| 85 drawing tools | Enabled | OpenAlgo draw tier + SIRE grouped rack backed by the real drawing registry |
| Drawing selection/editing/anchors/hit testing/magnet/undo/redo/persistence | Enabled | OpenAlgo DrawingController; no custom geometry engine |
| Mobile drawing controls | Enabled | OpenAlgo widget mobile controls |
| Chart settings / generated dialogs | Enabled | OpenAlgo widget |
| Objects panel | Enabled | OpenAlgo widget; SIRE TPO profile is also registered as a managed object |
| Keyboard shortcuts / help | Enabled | OpenAlgo widget keymap |
| Symbol search | Enabled | Deriv Synthetic Index registry is supplied to widget search |
| Multi-pane indicators | Enabled | OpenAlgo indicator lifecycle |
| Crosshair / OHLC status / pan / zoom / pinch / reset / fit | Enabled | OpenAlgo engine/widget |
| Linear/log/percentage/indexed scale options | Enabled | OpenAlgo settings |
| Custom Deriv timeframes | Enabled | Registered 2m, 3m, 10m, 30m, 2h and 4h intervals; Deriv granularity mapping |
| History range loading / older-page requests | Enabled | Feed now honors OpenAlgo `from`/`to` ranges and Deriv history pages |
| Live bar updates | Enabled | Deriv ticks -> forming OHLC bar -> OpenAlgo feed subscription |
| Reconnect/resync | Enabled | Gap detection calls OpenAlgo subscription `onResync`; authoritative history is reloaded |
| Bounded bar cache | Enabled | `withBarCache`, 32 series entries / 250k cached bars |
| Saved chart layout | Enabled | Widget persistence namespace per chart instrument |
| Market replay | Enabled | `ReplayController`, play/pause/step/step-back/exit |
| Multi-symbol comparison | Enabled | `addComparison` + percentage mode |
| Linked 1/2/4 chart workspace | Enabled | `createLinkGroup`, crosshair/viewport/symbol sync, member cleanup |
| WebGL2 rendering | Enabled | WebGL tier + `renderer: 'auto'` + fallback reporting |
| SVG export | Enabled | `Chart.exportSVG` |
| PNG capture | Enabled | `Chart.downloadScreenshot` |
| Price levels | Enabled | OpenAlgo `PriceLevels` primitive; previous/session levels plus live bid/ask when Deriv supplies them |
| Axis session clock / bar countdown | Enabled | OpenAlgo axis chrome |
| Market Profile / TPO | Enabled | OpenAlgo profile tier; SIRE computes a 30-minute TPO profile from Deriv intraday bars and exposes it as an Objects-managed profile |

## Applicable but data-gated

### Volume Profile
OpenAlgo can compute Volume Profile from OHLCV, but the current Deriv Synthetic Index candle payload does not provide authoritative traded volume. SIRE therefore does not fabricate volume. Once a real Deriv volume field is available, the OpenAlgo VolumeProfile primitive can be enabled without changing the chart architecture.

### Footprint / Order Flow
These require trade-by-trade data classified by bid/ask for historical accuracy. The current public Deriv Synthetic Index feed used by SIRE supplies ticks/quotes, not a historical bid/ask trade tape. A fake footprint would be misleading, so it remains data-gated.

### DOM / Order Book
OpenAlgo's DOM ladder is a visualization of supplied market depth; it does not create depth itself. The current Deriv Synthetic Index market-data integration has no authoritative multi-level order-book stream, so SIRE does not render a simulated DOM as if it were real.

### On-chart trading / orders / positions / brackets
OpenAlgo supports these through an authenticated TradeFeed/broker adapter. SIRE's current Deriv integration is public market-data only; there is no authenticated Deriv order-management adapter in the current application. The trade UI is therefore not falsely wired to a non-existent execution endpoint.

### Corporate-action/event markers
OpenAlgo supports event markers, but Deriv Synthetic Indices do not have the stock-style earnings/dividend/split calendar those markers represent.

## Important distinction

Importing an OpenAlgo tier only registers its capabilities. This audit treats a capability as implemented only when SIRE exposes it and wires the required data/lifecycle. The current implementation therefore does not claim Footprint, DOM, or trading execution merely because their OpenAlgo modules are imported.

## Validation target

After each implementation batch, the Render build must pass before the capability is considered deployed. SIRE must remain on `render-migration`; `main` is not modified.
