# SIRE UI-Only Handoff

This branch is a **design handoff**, intentionally separated from the active application work.

## Purpose

Use this branch as the visual starting point for rebuilding SIRE from scratch. The file:

- `ui-only/index.html`

is a dependency-free static HTML/CSS reference. It contains **no API calls, wallet logic, trading logic, exchange SDKs, database code, authentication, network adapters, or backend dependencies**.

## Interfaces preserved as visual references

1. **Home**
   - SIRE branding/header
   - dark terminal aesthetic
   - portfolio summary
   - market pulse / asset cards
   - primary/secondary actions

2. **Markets**
   - asset universe header
   - category filter pills
   - market table
   - price / 24h change presentation
   - overview card

3. **Trade / Swap**
   - trading header
   - Buy/Sell floating controls
   - chart surface
   - Swap/Limit controls
   - From/To asset cards
   - wallet/action CTA

4. **Trade / Limit**
   - Buy/Sell floating controls
   - rounded black condition card
   - instrument token pill
   - inline condition sentence
   - computed price area
   - Market / percentage / Custom selector
   - payment card
   - allocation selector

5. **Trade / Spot**
   - deliberately larger order/settings workspace
   - smaller order-book pane
   - no heavy divider treatment
   - Buy/Sell controls
   - order fields
   - Market/Limit/Stop controls

6. **Discover**
   - research navigation
   - research workspace
   - message bubbles
   - input surface

7. **Portfolio / Wallet**
   - wallet shell
   - balance hierarchy
   - network selector
   - Send / Receive / Buy actions
   - asset rows
   - dark rounded cards
   - cyan wallet accent

8. **Chart terminal**
   - full-screen chart surface
   - instrument header
   - timeframe controls
   - grid/chart area
   - terminal-style spacing

## Visual language

- Near-black / black base.
- Cyan is the primary SIRE accent.
- Pink/red is used for sell/danger states.
- Green is used for positive market movement.
- Rounded cards, but avoid excessive pill-shaped containers except for compact selectors/tokens.
- High information density with small secondary labels.
- Strong numeric hierarchy.
- Thin, low-contrast borders.
- Minimal shadows and restrained glass/blur treatment.
- Responsive layout for mobile widths.

## Important

This branch is **not intended to be the production application**. It is the visual contract for the next implementation.

The next builder should recreate the UI first and independently decide the architecture for:

- data providers
- authentication
- wallet/key management
- chain discovery
- token discovery
- trading execution
- order management
- market data
- backend/API
- persistence

Do not treat the placeholder values in the static reference as real data.

## Relationship to the active work

The active application remains on **`render-migration`**. This UI handoff is a separate branch so another AI/developer can connect to GitHub and use it as a clean visual reference without modifying the active branch.
