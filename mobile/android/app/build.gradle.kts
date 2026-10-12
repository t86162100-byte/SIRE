plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.sire.wallet"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.sire.wallet"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    // Pinned candidate crypto core. Verify package availability and checksum in CI.
    implementation("com.trustwallet:wallet-core:4.8.4")
    testImplementation("junit:junit:4.13.2")
}
