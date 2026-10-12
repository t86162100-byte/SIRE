package com.sire.wallet

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Minimal native entry point. This is deliberately not a WebView around the
 * production wallet: native secret handling must remain in the native process.
 */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(32, 32, 32, 32)
        }
        root.addView(TextView(this).apply {
            text = "SIRE Wallet"
            textSize = 28f
            gravity = Gravity.CENTER
        })
        root.addView(TextView(this).apply {
            text = "Native foundation · wallet operations are not enabled yet"
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 0)
        })
        setContentView(root)
    }
}
