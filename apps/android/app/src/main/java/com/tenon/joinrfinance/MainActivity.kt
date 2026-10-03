package com.tenon.joinrfinance

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.fragment.app.FragmentActivity
import com.tenon.joinrfinance.model.Period
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.ui.AppActions
import com.tenon.joinrfinance.ui.LockUi
import com.tenon.joinrfinance.ui.MainViewModel
import com.tenon.joinrfinance.ui.lock.Authenticator
import com.tenon.joinrfinance.ui.lock.BiometricAuthenticator
import com.tenon.joinrfinance.ui.lock.LockMemory
import com.tenon.joinrfinance.ui.nav.JoinrApp
import com.tenon.joinrfinance.ui.pair.GmsQrScanner
import com.tenon.joinrfinance.ui.pair.QrScanner
import com.tenon.joinrfinance.ui.theme.JoinrTheme

/**
 * The one activity: a FragmentActivity (BiometricPrompt needs one) using setContent; `singleTop`, so a deep link into a
 * running app arrives in [onNewIntent] and goes through the lock, then the confirmation.
 */
class MainActivity : FragmentActivity() {
    private val vm: MainViewModel by viewModels()
    private lateinit var authenticator: Authenticator
    private lateinit var scanner: QrScanner
    private var openHolding by mutableStateOf<String?>(null)
    private var prompting = false

    private val actions = object : AppActions {
        override fun refresh() = vm.refresh()
        override fun selectTab(tab: TodayTab) = vm.selectTab(tab)
        override fun cycleSort() = vm.cycleSort()
        override fun unlock() = promptUnlock()
        override fun startScan() = runCatching {
            scanner.scan(onText = vm::onScanned, onCancel = {}, onFailure = vm::onScanFailed)
        }.let { if (it.isFailure) vm.onScanFailed(false) }
        override fun startByHand() = vm.startByHand()
        override fun updateByHand(address: String, code: String) = vm.updateByHand(address, code)
        override fun submitByHand() = vm.submitByHand()
        override fun confirmPair() = vm.confirmPair()
        override fun cancelPair() = vm.cancelPair()
        override fun pairAgain() = vm.pairAgain()
        override fun unpair() = vm.unpair()
        override fun selectPeriod(p: Period) = vm.selectPeriod(p)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableDarkEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (secureWindow) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        authenticator = authenticatorFactory(this)
        scanner = scannerFactory(this)
        // Only a fresh launch acts on its intent: a recreation (rotation, theme, font scale, process death) or a launch
        // from recents would replay a used pairing link or re-open a holding the owner already closed.
        if (savedInstanceState == null && (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) {
            handleIntent(intent)
        }
        setContent {
            JoinrTheme {
                val state by vm.ui.collectAsState()
                JoinrApp(state, actions, openHolding = openHolding, onHoldingOpened = { openHolding = null })
            }
        }
        runCatching { scanner.prepare { vm.setScannerReady() } }.onFailure { vm.setScannerReady() }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        vm.setVisible(true)
        val needsPrompt = LockMemory.onForeground()
        when {
            // The one case that opens without a prompt: the phone has no screen lock at all (with a banner).
            !authenticator.isDeviceSecure() -> {
                LockMemory.markUnlocked()
                vm.setLock(LockUi.NoScreenLock)
                vm.onOpened()
            }
            needsPrompt -> {
                vm.setLock(LockUi.Locked())
                promptUnlock()
            }
            else -> {
                vm.setLock(LockUi.Unlocked)
                vm.onOpened()
            }
        }
    }

    override fun onStop() {
        super.onStop()
        vm.setVisible(false)
        if (!isChangingConfigurations) LockMemory.onBackground()
    }

    private fun promptUnlock() {
        if (prompting) return
        prompting = true
        authenticator.authenticate(
            onSuccess = {
                prompting = false
                LockMemory.markUnlocked()
                vm.setLock(LockUi.Unlocked)
                vm.onOpened()
            },
            onError = { message ->
                prompting = false
                // Fail closed: every error or cancel keeps the locked brand screen; the activity never finishes itself.
                vm.setLock(LockUi.Locked(message))
            },
        )
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null || intent.getBooleanExtra(EXTRA_CONSUMED, false)) return
        intent.getStringExtra(EXTRA_HOLDING_KEY)?.let { openHolding = it }
        val data = intent.data
        if (intent.action == Intent.ACTION_VIEW && data != null && data.scheme.equals("joinrfinance", ignoreCase = true)) {
            vm.onDeepLink(data.toString())
        }
        // Consumed: the link and the holding act once. Marked in place (extras only): replacing the intent or its data
        // would change its identity (`filterEquals`), which the task, recents and ActivityScenario match on.
        intent.removeExtra(EXTRA_HOLDING_KEY)
        intent.putExtra(EXTRA_CONSUMED, true)
    }

    companion object {
        /**
         * The app is dark only: light system-bar icons on ink in every system theme (the default `SystemBarStyle.auto`
         * would pick dark icons when the phone is in light mode).
         */
        fun androidx.activity.ComponentActivity.enableDarkEdgeToEdge() = enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )

        const val EXTRA_HOLDING_KEY = "com.tenon.joinrfinance.HOLDING_KEY"
        private const val EXTRA_CONSUMED = "com.tenon.joinrfinance.INTENT_CONSUMED"

        /** Release builds block screenshots and blank the app in recents (FLAG_SECURE); debug builds do not. */
        val secureWindow: Boolean get() = !BuildConfig.DEBUG

        /** Replaceable in tests (Robolectric has no biometric prompt or Play services). */
        @Volatile var authenticatorFactory: (FragmentActivity) -> Authenticator = { BiometricAuthenticator(it) }
        @Volatile var scannerFactory: (FragmentActivity) -> QrScanner = { GmsQrScanner(it) }
    }
}
