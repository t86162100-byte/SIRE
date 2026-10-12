package com.sire.wallet.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import wallet.core.jni.CoinType

class WalletCoreBridgeTest {
    // BIP-39 "abandon" x 11 + "about"; standard first Ethereum account.
    @Test fun derivesEthereumAddressFromKnownMnemonicVector() {
        val result = WalletCoreBridge.deriveAddress(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            CoinType.ETHEREUM
        )
        assertEquals("0x9858EfFD232B4033E47d90003D41EC34EcaEda94", result.address)
        assertEquals("m/44'/60'/0'/0/0", result.derivationPath)
    }

    @Test fun rejectsEmptyMnemonicWithoutLeakingInput() {
        assertThrows(IllegalArgumentException::class.java) {
            WalletCoreBridge.deriveAddress(" ", CoinType.ETHEREUM)
        }
    }
}
