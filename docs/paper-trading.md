# SIRE paper trading / no-money validation

## Enable the isolated simulator

Set the Render service environment variable:

`SIRE_TRADING_MODE=PAPER`

This is an explicit mode switch. In this mode, SIRE's direct Spot/Futures order routes, trigger orders, virtual balances, position updates, order history, and TWAP/Iceberg/Split scheduler route to the in-memory paper simulator. Market prices and order books are read from Bitget's public market-data API; order placement, cancellation, modification, and algorithmic slices do **not** send authenticated order requests to Bitget.

The simulator resets when the Node process restarts. Use the owner-authenticated `POST /api/sire/bitget/paper/reset` endpoint to reset it deliberately while paper mode is enabled.

## Safety rules

- Keep `SIRE_ENABLE_LIVE_FUTURES_SCHEDULER` unset or false during paper testing.
- The scheduler additionally refuses live execution whenever `SIRE_TRADING_MODE=PAPER`.
- Do not change to live mode until the paper tests/build pass and Bitget Demo API credentials are configured and tested separately.
- Do not use the normal live Bitget API key as a substitute for a demo key during test-order validation. Bitget documents a separate Demo API key and the `paptrading: 1` request header for demo trading.
- The paper simulator is process-local and intentionally does not claim to emulate every exchange matching-engine rule, fee tier, liquidation rule, or partial-fill pattern. It is for application lifecycle wiring and regression tests, not a guarantee of live exchange behavior.

## Local checks

`npm run test:paper`

`npm run build`

The GitHub Actions workflow `.github/workflows/paper-lifecycle.yml` runs the paper lifecycle tests and frontend production build on this branch / its pull request.
