package com.tenon.joinrfinance.ui.lock

import android.app.KeyguardManager
import android.content.Context
import android.os.SystemClock
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.tenon.joinrfinance.ui.components.BannerBackdrop
import com.tenon.joinrfinance.ui.components.JoinrButton
import com.tenon.joinrfinance.ui.components.SpectrumRule
import com.tenon.joinrfinance.ui.components.Wordmark
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.ui.theme.JoinrType

/**
 * The unlocked state (D139, plan section 9.6). It lives in process memory only: never in saved state, a bundle or
 * storage, so after process death the lock always shows. The background time uses `elapsedRealtime`.
 */
object LockMemory {
    const val RELOCK_AFTER_MS: Long = 5 * 60_000L

    @Volatile var unlocked: Boolean = false
        private set

    @Volatile private var backgroundedAt: Long? = null

    /** The clock (`SystemClock.elapsedRealtime`, never the wall clock); replaceable in tests. */
    @Volatile var clock: () -> Long = { SystemClock.elapsedRealtime() }

    fun markUnlocked() {
        unlocked = true
        backgroundedAt = null
    }

    fun lock() {
        unlocked = false
        backgroundedAt = null
    }

    /** The app went to the background. */
    fun onBackground() {
        if (unlocked) backgroundedAt = clock()
    }

    /** The app came back: true when the prompt is needed (cold start, or 5 minutes or more away). */
    fun onForeground(): Boolean {
        val at = backgroundedAt
        if (unlocked && at != null && clock() - at >= RELOCK_AFTER_MS) unlocked = false
        backgroundedAt = null
        return !unlocked
    }

    /** Tests: simulate a new process. */
    fun resetForProcessDeath() {
        unlocked = false
        backgroundedAt = null
    }
}

/** The device check and the prompt, behind an interface so the lock tests can drive every result. */
interface Authenticator {
    /** False only when the phone has no screen lock at all (the one case that opens without a prompt). */
    fun isDeviceSecure(): Boolean

    /** Shows the prompt; `onError` gets the system's sentence for a lockout, else null (cancel, back, …). */
    fun authenticate(onSuccess: () -> Unit, onError: (String?) -> Unit)
}

class BiometricAuthenticator(private val activity: FragmentActivity) : Authenticator {
    override fun isDeviceSecure(): Boolean =
        (activity.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure

    override fun authenticate(onSuccess: () -> Unit, onError: (String?) -> Unit) {
        val allowed = BIOMETRIC_STRONG or DEVICE_CREDENTIAL
        val can = BiometricManager.from(activity).canAuthenticate(allowed)
        if (can != BiometricManager.BIOMETRIC_SUCCESS) {
            // Fail closed: a secure phone whose prompt cannot run stays locked.
            onError("This phone cannot show its unlock prompt right now.")
            return
        }
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onSuccess()

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    val lockout = errorCode == BiometricPrompt.ERROR_LOCKOUT || errorCode == BiometricPrompt.ERROR_LOCKOUT_PERMANENT
                    onError(if (lockout) errString.toString() else null)
                }
            },
        )
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock Joinr Finance")
                .setAllowedAuthenticators(allowed)
                .build(),
        )
    }
}

/** The locked brand screen: nothing but the brand behind it, an Unlock button (≥ 48 dp) and a lockout sentence. */
@Composable
fun LockScreen(message: String?, onUnlock: () -> Unit) {
    BannerBackdrop(Modifier.testTag("lock")) {
        Column(
            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            SpectrumRule()
            Column(
                Modifier.weight(1f).fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Wordmark(height = 40.dp)
                Text("FINANCE", style = JoinrType.label(size = 11.sp, tracking = 0.16f, color = JoinrColors.Teal))
                JoinrButton("Unlock", onClick = onUnlock, modifier = Modifier.fillMaxWidth().testTag("unlock"))
                if (message != null) {
                    Text(message, style = JoinrType.body(size = 13.sp, color = JoinrColors.TextSecondary), textAlign = TextAlign.Center, modifier = Modifier.testTag("lock-message"))
                }
            }
        }
    }
}
