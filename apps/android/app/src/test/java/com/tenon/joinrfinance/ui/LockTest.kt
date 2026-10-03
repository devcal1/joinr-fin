package com.tenon.joinrfinance.ui

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Looper
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.tenon.joinrfinance.FakeBox
import com.tenon.joinrfinance.Graph
import com.tenon.joinrfinance.MainActivity
import com.tenon.joinrfinance.MemoryDataStore
import com.tenon.joinrfinance.Services
import com.tenon.joinrfinance.store.FakeApi
import com.tenon.joinrfinance.ui.lock.Authenticator
import com.tenon.joinrfinance.ui.lock.LockMemory
import com.tenon.joinrfinance.ui.pair.QrScanner
import com.tenon.joinrfinance.widget.WidgetConfigActivity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowSystemClock
import java.time.Duration

/** A scripted prompt: each authenticate() answers with the next queued result. */
class FakeAuthenticator(var secure: Boolean = true) : Authenticator {
    /** null = success; a value = an error with that sentence ("" = a cancel with no sentence). */
    val results = ArrayDeque<String?>()
    var prompts = 0

    override fun isDeviceSecure(): Boolean = secure

    override fun authenticate(onSuccess: () -> Unit, onError: (String?) -> Unit) {
        prompts++
        val next = if (results.isEmpty()) "" else results.removeFirst()
        when (next) {
            null -> onSuccess()
            "" -> onError(null)
            else -> onError(next)
        }
    }
}

class NoScanner : QrScanner {
    override fun prepare(onReady: () -> Unit) = onReady()
    override fun scan(onText: (String) -> Unit, onCancel: () -> Unit, onFailure: (Boolean) -> Unit) = onCancel()
}

/** The app lock's fail-closed rules (plan section 9.6), on the real activity with a scripted prompt. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LockTest {
    @get:Rule val rule = createEmptyComposeRule()
    private val auth = FakeAuthenticator()

    @Before
    fun setUp() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        Services.install(Graph(ctx, box = FakeBox(), api = FakeApi(), widgetUpdater = {}, pairingDataStore = MemoryDataStore(), prefsDataStore = MemoryDataStore()))
        MainActivity.authenticatorFactory = { auth }
        MainActivity.scannerFactory = { NoScanner() }
        LockMemory.resetForProcessDeath()
    }

    @After
    fun tearDown() {
        Services.install(null)
        LockMemory.resetForProcessDeath()
        LockMemory.clock = { android.os.SystemClock.elapsedRealtime() }
    }

    @Test
    fun anAuthErrorStaysLockedWithTheUnlockButton() {
        auth.results.add("Too many attempts. Try again later.")
        ActivityScenario.launch(MainActivity::class.java).use {
            rule.waitForIdle()
            rule.onNodeWithTag("lock").assertIsDisplayed()
            rule.onNodeWithTag("unlock").assertIsDisplayed()
            rule.onNodeWithText("Too many attempts. Try again later.").assertIsDisplayed()
            rule.onNodeWithTag("today").assertDoesNotExist()
            rule.onNodeWithTag("not-paired").assertDoesNotExist()
            assertFalse(LockMemory.unlocked)
            it.onActivity { a -> assertFalse("the activity never finishes itself", a.isFinishing) }
        }
    }

    @Test
    fun aCancelStaysLockedAndUnlockPromptsAgain() {
        auth.results.add("") // cancel
        auth.results.add(null) // then success
        ActivityScenario.launch(MainActivity::class.java).use {
            rule.waitForIdle()
            rule.onNodeWithTag("lock").assertIsDisplayed()
            assertEquals(1, auth.prompts)
            rule.onNodeWithTag("unlock").performClick()
            rule.waitForIdle()
            assertEquals(2, auth.prompts)
            assertTrue(LockMemory.unlocked)
            rule.onNodeWithTag("lock").assertDoesNotExist()
            rule.onNodeWithTag("not-paired").assertIsDisplayed()
        }
    }

    @Test
    fun afterProcessDeathTheLockShowsAgain() {
        auth.results.add(null)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            rule.waitForIdle()
            assertTrue(LockMemory.unlocked)
            // Simulated process death: the in-memory state is gone; the recreated activity is locked.
            LockMemory.resetForProcessDeath()
            auth.results.add("")
            scenario.recreate()
            rule.waitForIdle()
            rule.onNodeWithTag("lock").assertIsDisplayed()
            assertFalse(LockMemory.unlocked)
        }
    }

    @Test
    fun noScreenLockOpensWithTheBanner() {
        auth.secure = false
        ActivityScenario.launch(MainActivity::class.java).use {
            rule.waitForIdle()
            assertEquals(0, auth.prompts)
            rule.onNodeWithTag("lock").assertDoesNotExist()
            rule.onNodeWithTag("not-paired").assertIsDisplayed()
        }
    }

    @Test
    fun theBackgroundTimerUsesElapsedRealtime() {
        LockMemory.markUnlocked()
        LockMemory.onBackground()
        ShadowSystemClock.advanceBy(Duration.ofMinutes(4))
        assertFalse("4 minutes away: still unlocked", LockMemory.onForeground())
        LockMemory.onBackground()
        ShadowSystemClock.advanceBy(Duration.ofMinutes(5))
        assertTrue("5 minutes away: locked", LockMemory.onForeground())
        assertFalse(LockMemory.unlocked)
        shadowOf(Looper.getMainLooper()).idle()
    }

    @Test
    fun aDeepLinkGoesThroughTheLockThenTheConfirmation() {
        auth.results.add("")
        val link = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("joinrfinance://pair?v=1&u=http%3A%2F%2F127.0.0.1%3A3614&c=ABCDE12345"))
            .setClass(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(link).use {
            rule.waitForIdle()
            rule.onNodeWithTag("lock").assertIsDisplayed()
            rule.onNodeWithTag("confirm").assertDoesNotExist()
            auth.results.add(null)
            rule.onNodeWithTag("unlock").performClick()
            rule.waitForIdle()
            rule.onNodeWithTag("confirm").assertIsDisplayed()
            rule.onNodeWithText("Pair with http://127.0.0.1:3614?").assertIsDisplayed()
        }
    }
}

/** The widget configuration activity refuses anything but a valid id of this app's holding widget. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WidgetConfigActivityTest {
    @Test
    fun withoutAWidgetIdItIsCancelled() {
        val activity = Robolectric.buildActivity(WidgetConfigActivity::class.java, Intent()).create().get()
        assertTrue(activity.isFinishing)
        assertEquals(Activity.RESULT_CANCELED, shadowOf(activity).resultCode)
    }

    @Test
    fun withAnUnknownWidgetIdItIsCancelled() {
        val intent = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 4242)
        val activity = Robolectric.buildActivity(WidgetConfigActivity::class.java, intent).create().get()
        assertTrue(activity.isFinishing)
        assertEquals(Activity.RESULT_CANCELED, shadowOf(activity).resultCode)
    }
}
