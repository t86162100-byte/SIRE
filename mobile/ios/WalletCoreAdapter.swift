import Foundation

/// Narrow boundary around Trust Wallet Core. Keep SDK-specific types out of UI
/// and chain-provider code. Implementations must reject unsupported coin types,
/// failed derivations, invalid addresses, and missing signing results.
protocol WalletCoreAdapter {
    func deriveAddress(mnemonic: String, coinType: UInt32, derivationPath: String) throws -> String
    func signTransaction(unsignedPayload: Data, coinType: UInt32, privateKey: Data) throws -> Data
}

/// Deliberately fail-closed until the pinned SDK API and chain-specific signing
/// payloads are wired and covered by official test vectors.
enum WalletCoreAdapterError: Error {
    case notIntegrated
    case unsupportedChain
    case invalidDerivation
    case signingFailed
}

struct UnconfiguredWalletCoreAdapter: WalletCoreAdapter {
    func deriveAddress(mnemonic: String, coinType: UInt32, derivationPath: String) throws -> String {
        throw WalletCoreAdapterError.notIntegrated
    }

    func signTransaction(unsignedPayload: Data, coinType: UInt32, privateKey: Data) throws -> Data {
        throw WalletCoreAdapterError.notIntegrated
    }
}
