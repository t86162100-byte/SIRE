# SIRE paper trading / no-money validation

## Enable the isolated simulator

The safe default is paper mode when `SIRE_TRADING_MODE` is unset or invalid. To be explicit, set the Render service environment variable:

`SIRE_TRADING_MODE=PAPER`

In this mode, SIRE's direct Spot/Futures order routes, trigger orders, virtual balances, position updates, order history, and TWAP/Iceberg/Split scheduler route to the in-memory paper simulator. Market prices and order books are read from Bitget's public market-data API; order placement, cancellation, modification, and algorithmic slices do **not** send authenticated order requests to Bitget.

The simulator resets when the Node process restarts. Use the owner-authenticated `POST /api/sire/bitget/paper/reset` endpoint to reset it deliberately while paper mode is enabled.

For a later exchange-demo phase, set `SIRE_TRADING_MODE=BITGET_DEMO` only with a Bitget Demo API key. SIRE adds Bitget's `paptrading: 1` header to authenticated requests in that mode. Automated TWAP/Iceberg/Split execution remains disabled in demo mode. The `LIVE` mode is the only mode that can send real authenticated orders, and live Futures schedules additionally require `SIRE_ENABLE_LIVE_FUTURES_SCHEDULER=true`.

## Safety rules

- Keep `SIRE_ENABLE_LIVE_FUTURES_SCHEDULER` unset or false during paper testing.
- The scheduler additionally refuses live execution whenever `SIRE_TRADING_MODE=PAPER`.
- Do not change to `LIVE` until the paper tests/build pass and the `BITGET_DEMO` order lifecycle is verified separately.
- Do not use the normal live Bitget API key as a substitute for a demo key during test-order validation. Bitget documents a separate Demo API key and the `paptrading: 1` request header for demo trading.
- The paper simulator is process-local and intentionally does not claim to emulate every exchange matching-engine rule, fee tier, liquidation rule, or partial-fill pattern. It is for application lifecycle wiring and regression tests, not a guarantee of live exchange behavior.

## Local checks

`npm run test:paper`

`npm run build`

The GitHub Actions workflow `.github/workflows/paper-lifecycle.yml` runs the paper lifecycle tests and frontend production build on this branch / its pull request.

## Bitget Demo integration pass

After the paper test/build checks pass, configure a **separate Bitget Demo API key** in an isolated test environment (never paste its values into chat). Set:

- `SIRE_TRADING_MODE=BITGET_DEMO`
- `SIRE_RUN_BITGET_DEMO_INTEGRATION=true`
- `BITGET_API_KEY`, `BITGET_API_SECRET`, and `BITGET_API_PASSPHRASE` to the Demo key values

Then run:

`npm run test:bitget-demo`

This opt-in integration test places only far-from-market **demo** Spot and USDT-Futures limit orders, queries status, amends and cancels them, and places/lists/cancels a Spot trigger order. The demo mode sends Bitget's `paptrading: 1` header. The test is skipped unless both the explicit test flag and `BITGET_DEMO` mode are set. It is not part of default CI, and it must never be run with a live API key.

A passing simulator test suite is not a substitute for this exchange-demo pass. Keep `SIRE_TRADING_MODE` out of `LIVE` until the demo integration test and manual reconciliation of fills, partial fills, cancels/modifies, trigger activation, TP/SL and schedule recovery all pass.
