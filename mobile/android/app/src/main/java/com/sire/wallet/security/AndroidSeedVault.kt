package com.sire.wallet.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Device-bound AES-GCM wrapping for recoverable seed bytes.
 *
 * The Android Keystore protects the wrapping key; it does not make the
 * recoverable seed itself non-exportable. The caller owns backup/recovery UX.
 */
class AndroidSeedVault(private val alias: String = "sire.wallet.seed-wrap.v1") {
    private val transformation = "AES/GCM/NoPadding"
    private val storeType = "AndroidKeyStore"

    private fun keyStore(): KeyStore = KeyStore.getInstance(storeType).apply { load(null) }

    private fun getOrCreateKey(): SecretKey {
        val store = keyStore()
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, storeType)
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    /** Output format: 4-byte IV length, IV, then authenticated ciphertext+tag. */
    fun seal(seedBytes: ByteArray): ByteArray {
        require(seedBytes.isNotEmpty()) { "Seed bytes must not be empty." }
        val cipher = Cipher.getInstance(transformation)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv
        val encrypted = cipher.doFinal(seedBytes)
        return ByteBuffer.allocate(4 + iv.size + encrypted.size)
            .putInt(iv.size).put(iv).put(encrypted).array()
    }

    fun open(sealed: ByteArray): ByteArray {
        require(sealed.size > 4) { "Invalid sealed seed." }
        val buffer = ByteBuffer.wrap(sealed)
        val ivLength = buffer.int
        require(ivLength == 12 && buffer.remaining() > ivLength) { "Invalid sealed seed header." }
        val iv = ByteArray(ivLength).also(buffer::get)
        val ciphertext = ByteArray(buffer.remaining()).also(buffer::get)
        val cipher = Cipher.getInstance(transformation)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(ciphertext) // Authentication failure throws; never return partial data.
    }

    fun deleteKey() {
        keyStore().deleteEntry(alias)
    }
}
