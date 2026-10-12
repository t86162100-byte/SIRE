# iOS native foundation

Create/open the Xcode app target here and add the **pinned Trust Wallet Core 4.8.4 release package** to the app target. Do not use a floating `master` branch for release builds. Keep Wallet Core usage behind a small signing/derivation adapter and verify all returned optional values before use.

`IOSSeedVault.swift` is a Keychain storage primitive for seed bytes. It is not a substitute for Wallet Core, chain RPC/indexing, transaction review, or a complete wallet app. Device/simulator tests and a reviewed recovery flow are required before production use.
