# SIRE Wallet platform architecture

## Product target

Build a self-custody, multi-chain wallet platform with the same categories of engineering responsibility found in mature wallets: chain-specific signing, account derivation, asset discovery, transaction simulation/validation, RPC/indexing infrastructure, dApp connectivity, and platform-appropriate key protection. Do not label a chain as supported merely because it appears in a registry.

## Architecture boundaries

```
Wallet UI (web / Android / iOS)
        |
Wallet application services (accounts, portfolio, send/receive, activity)
        |
Chain capability registry ---- Asset metadata / risk registry
        |                              |
Chain adapter interface          Asset discovery/indexers
        |
Provider routing (RPC/indexer failover, timeouts, rate limits)
        |
Public blockchain nodes / approved providers

Signing boundary:
UI -> reviewed transaction intent -> chain-specific signer -> signature
Private key material must never be sent to SIRE servers, analytics, RPC providers, or logs.
```

## Native and web security

- Android: use Android Keystore for device-bound encryption/authentication keys, with hardware-backed protection when available and capability detection. Do not claim a BIP-39 seed itself is non-exportable if the wallet must export/recover it.
- iOS: use Keychain with access controls and biometric/passcode gating where appropriate. Secure Enclave is not a universal storage mechanism for imported mnemonic seeds or every chain's signing curve; design a platform vault that encrypts seed material and clearly distinguishes hardware-backed keys from encrypted recoverable seeds.
- Web: browser storage is a fallback, not hardware-backed storage. Encrypt recoverable wallet material with a password-derived key; lock on inactivity; minimize secret lifetime in memory; never log secrets. A native app must not silently share web storage as its vault.
- Recovery phrase is shown only during creation/import and never transmitted. Require explicit confirmation of backup before completing onboarding.
- Transaction review must show network, destination, amount, asset, fees, and decoded contract actions when possible. Unknown/unverified contracts receive warnings; never auto-approve signatures.
- Threat model includes malicious dApps, clipboard substitution, phishing tokens, RPC spoofing, chain ID mismatch, compromised providers, and malicious transaction calldata.

## Chain support levels

1. **Listed**: metadata only; not selectable for sending or receiving.
2. **Read-only**: address and balance/asset discovery verified; no signing/broadcast.
3. **Send/receive**: address derivation, fee estimation, transaction validation, signing, broadcast and receipt tracking tested.
4. **Full**: send/receive plus history, token discovery, dApp connection, and applicable chain-specific features tested.

The UI and API must expose these levels. Never imply every chain or token is fully supported.

## Chain adapters

Each adapter owns chain-specific account derivation, address validation, balance discovery, fee estimation, transaction building, signing, broadcasting, receipt/status tracking, token metadata and chain-specific tests. EVM, UTXO (Bitcoin-family), Solana account/program tokens, Tron, XRP Ledger, Cosmos SDK, MoveVM chains, TON, and Substrate must not be forced through a single EVM-shaped implementation.

## Asset discovery

- Discover assets by wallet address through a chain-specific indexer or provider where available; use direct RPC calls as a limited fallback.
- Resolve token metadata from chain contracts/programs plus trusted token lists/indexers. Never assume 18 decimals or fabricate a symbol/name.
- Keep chain ID + contract/mint/asset identifier as the canonical asset identity. Symbols are not unique.
- Show zero-balance assets only where appropriate; allow users to hide spam; label verification/risk and the source/freshness of metadata.
- Portfolio price data is separate from token identity and balance data; stale/missing prices must not affect on-chain balances.

## Provider and operations layer

- Provider routing supports multiple endpoints per chain, deadlines, retries with backoff, health checks, circuit breakers and response validation.
- Do not expose provider API secrets in the browser. Paid/indexing providers with credentials must be proxied by a server-side service with quotas and abuse controls.
- Cache public metadata and portfolio reads; avoid unbounded full-chain token scans.
- Telemetry is privacy-minimizing and must never include seed phrases, private keys, signed transaction payloads or unredacted sensitive user data.

## Implementation sequence

1. Separate chain registry, adapter contract, asset identity and discovery interfaces from the existing EVM implementation.
2. Fix EVM token metadata and balance discovery; add tests for decimals, malformed contracts, provider failures and wrong chain.
3. Build provider routing and transaction-intent validation; test on testnets before mainnet sends.
4. Add a native mobile shell and platform vault implementations (Android Keystore, iOS Keychain/biometric gating), with a clear migration/import path from the web wallet.
5. Integrate an audited multi-chain cryptographic library such as Trust Wallet Core where its actual chain, curve, derivation and platform bindings fit. Its documented scope is key derivation/signing, not node access, balance indexing or broadcasting; those remain separate services.
6. Add chain families incrementally behind capability gates, each with fixtures, test vectors, integration tests, independent security review and documented limitations.
7. Add dApp connectivity, swaps/bridges and other high-risk features only after transaction simulation, approval controls and chain adapters are mature.

## Release gates

- No mainnet send capability until chain ID, address derivation, fee handling, signing, broadcast and receipt tests pass for that chain.
- No "all tokens" claim: arbitrary tokens are unbounded and can be malicious. Promise supported-chain discovery with explicit coverage and verification labels.
- No production security claim without threat modeling, dependency review, external audit and incident/recovery procedures.
