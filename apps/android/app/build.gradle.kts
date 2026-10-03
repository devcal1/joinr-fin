import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Release signing (plan 9.1): JOINR_ANDROID_SIGNING names a properties file OUTSIDE the repo
// (storeFile, storePassword, keyAlias, keyPassword). Without it a release build is refused:
// an unsigned release APK is never produced.
val signingRefusal =
    "Release builds need JOINR_ANDROID_SIGNING: the absolute path of a properties file with " +
        "storeFile, storePassword, keyAlias and keyPassword. No unsigned APK is built."
val signingProps: Properties? = System.getenv("JOINR_ANDROID_SIGNING")
    ?.takeIf { it.isNotBlank() }
    ?.let { path -> file(path) }
    ?.takeIf { it.isAbsolute && it.isFile }
    ?.let { f -> Properties().apply { f.inputStream().use { load(it) } } }
    ?.takeIf { p -> listOf("storeFile", "storePassword", "keyAlias", "keyPassword").all { !p.getProperty(it).isNullOrBlank() } }
    ?.takeIf { p -> file(p.getProperty("storeFile")).isFile }

android {
    namespace = "com.tenon.joinrfinance"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tenon.joinrfinance"
        minSdk = 30
        targetSdk = 35
        versionCode = 4
        versionName = "1.1.0"
    }

    signingConfigs {
        signingProps?.let { p ->
            create("release") {
                storeFile = file(p.getProperty("storeFile"))
                storePassword = p.getProperty("storePassword")
                keyAlias = p.getProperty("keyAlias")
                keyPassword = p.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = true
        warningsAsErrors = false
        // The versions are the plan section 9.1 pins (the toolchain spike): newer ones are not tried in this stage.
        disable += setOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable")
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            it.maxHeapSize = "3g"
            // The wordmark and icon tests read the SVG master from the repo at test time.
            it.systemProperty("joinr.repoRoot", rootDir.parentFile.parentFile.absolutePath)
        }
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/LICENSE*", "/META-INF/NOTICE*")
    }
}

gradle.taskGraph.whenReady {
    val wantsRelease = allTasks.any { t ->
        t.project == project && t.name in setOf("packageRelease", "bundleRelease", "assembleRelease", "installRelease")
    }
    if (wantsRelease && signingProps == null) throw GradleException(signingRefusal)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.glance.appwidget)
    implementation(libs.glance.material3)
    implementation(libs.biometric)
    implementation(libs.work.runtime)
    implementation(libs.gms.code.scanner)
    implementation(libs.okhttp)
    implementation(libs.serialization.json)
    implementation(libs.datastore.preferences)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.work.testing)
    testImplementation(libs.glance.appwidget.testing)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
