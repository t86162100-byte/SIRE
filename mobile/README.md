# SIRE Wallet native foundation

This folder establishes separate native security boundaries for Android and iOS. The existing Vite app remains the web client; it is not the native vault.

## Cryptographic core

Target library: [Trust Wallet Core](https://github.com/trustwallet/wallet-core), pinned to release **4.8.4** for the initial integration spike. It provides chain-aware key derivation and signing for many chain families. It does **not** provide RPC access, balances, indexing, asset discovery, or transaction broadcast; those remain separate SIRE services.

- Android: use the official `com.trustwallet:wallet-core:4.8.4` artifacts from GitHub Packages. Supply a read-only GitHub Packages credential through local Gradle properties/environment; never commit credentials. Verify the artifact checksum and API surface before release.
- iOS: use the matching official Wallet Core 4.8.4 Swift Package release artifact. Vendor/pin the release package in the native Xcode project rather than tracking a floating branch.
- Web: do not import native bindings into Vite. Browser signing remains a separate adapter and is not considered hardware-backed.

The SDK dependency is intentionally isolated in the native projects. A chain is not enabled by the presence of this dependency: its adapter must pass derivation vectors, address validation, transaction review, fee, signing, broadcast, and status tests.

## Platform vaults

- Android `AndroidSeedVault` uses an Android Keystore AES-GCM key to wrap recoverable seed bytes. The Keystore key is device-bound; the seed is still recoverable/exportable by design and must not be described as a non-exportable key.
- iOS `IOSSeedVault` stores seed bytes as a Keychain item with device-unlock access control. This is not a claim that Secure Enclave supports every chain's curve.
- The vault APIs accept bytes only. Never pass seed phrases to logs, analytics, crash reports, RPCs, or app servers. The caller must clear mutable buffers after use as far as the platform permits.

## Build status

These are source foundations, not a release-ready mobile app. Native builds, SDK API integration, biometric UX, migration, test vectors, device testing, and an independent security review remain release gates. No chain should be promoted to send/receive solely because a native shell compiles.

## Local verification

1. Open `android/` in Android Studio and sync Gradle.
2. Configure the private/read-only GitHub Packages credentials locally if required by the official Wallet Core artifact repository.
3. Build and run the Android app on an emulator/device; verify vault round-trip and wrong-key/corruption rejection tests.
4. Open `ios/` in Xcode after adding the pinned Wallet Core release package; run the Keychain vault tests on a simulator and device.
5. Never use a real recovery phrase for test runs. Use generated test fixtures only.
