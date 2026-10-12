package com.sire.wallet.crypto

import wallet.core.jni.CoinType
import wallet.core.jni.HDWallet

/**
 * Narrow boundary around Trust Wallet Core.
 *
 * Mnemonics are accepted only for derivation and are never returned, logged,
 * persisted, or interpolated into exception messages. Callers should clear
 * their input buffers/strings as soon as practical; Kotlin/JVM strings cannot
 * be reliably zeroized.
 */
object WalletCoreBridge {
    data class DerivedAddress(
        val coin: String,
        val address: String,
        val derivationPath: String
    )

    fun deriveAddress(mnemonic: String, coin: CoinType): DerivedAddress {
        require(mnemonic.isNotBlank()) { "Recovery phrase is required." }
        val wallet = try {
            HDWallet(mnemonic.trim().replace(Regex("\\s+"), " "), "")
        } catch (_: Exception) {
            throw IllegalArgumentException("Recovery phrase is invalid.")
        }

        return try {
            val address = wallet.getAddressForCoin(coin)
            require(address.isNotBlank()) { "The crypto library returned an empty address." }
            DerivedAddress(
                coin = coin.name,
                address = address,
                derivationPath = coin.derivationPath()
            )
        } finally {
            wallet.delete()
        }
    }

    private fun CoinType.derivationPath(): String = when (this) {
        CoinType.ETHEREUM -> "m/44'/60'/0'/0/0"
        CoinType.BITCOIN -> "m/44'/0'/0'/0/0"
        else -> "library-default"
    }
}
