pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Trust Wallet Core artifacts are distributed through GitHub Packages.
        // Credentials are read from local environment variables; never commit tokens.
        maven {
            url = uri("https://maven.pkg.github.com/trustwallet/wallet-core")
            credentials {
                username = System.getenv("GITHUB_PACKAGES_USER") ?: ""
                password = System.getenv("GITHUB_PACKAGES_TOKEN") ?: ""
            }
        }
    }
}
rootProject.name = "SIREWallet"
include(":app")
