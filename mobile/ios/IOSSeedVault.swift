import Foundation
import Security

/// Keychain storage for recoverable seed material.
/// This is not a claim that Secure Enclave supports every chain's key curve.
enum IOSSeedVaultError: Error {
    case keychain(OSStatus)
    case missingItem
    case invalidInput
}

final class IOSSeedVault {
    private let service: String
    private let account: String

    init(service: String = "com.sire.wallet", account: String = "seed.v1") {
        self.service = service
        self.account = account
    }

    func save(_ seed: Data) throws {
        guard !seed.isEmpty else { throw IOSSeedVaultError.invalidInput }
        try deleteIfPresent()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: seed,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw IOSSeedVaultError.keychain(status) }
    }

    func load() throws -> Data {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status != errSecItemNotFound else { throw IOSSeedVaultError.missingItem }
        guard status == errSecSuccess, let data = result as? Data, !data.isEmpty else {
            throw IOSSeedVaultError.keychain(status)
        }
        return data
    }

    func delete() throws {
        try deleteIfPresent()
    }

    private func deleteIfPresent() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw IOSSeedVaultError.keychain(status)
        }
    }
}
