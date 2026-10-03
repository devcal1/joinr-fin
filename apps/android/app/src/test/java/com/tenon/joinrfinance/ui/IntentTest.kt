package com.tenon.joinrfinance.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.core.view.WindowCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import com.tenon.joinrfinance.FakeBox
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.Graph
import com.tenon.joinrfinance.MainActivity
import com.tenon.joinrfinance.MemoryDataStore
import com.tenon.joinrfinance.Services
import com.tenon.joinrfinance.store.FakeApi
import com.tenon.joinrfinance.store.Pairing
import com.tenon.joinrfinance.ui.lock.LockMemory
import com.tenon.joinrfinance.widget.WidgetConfigActivity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Waits for a screen that appears after the repository's background load (the store and the fake API). */
private fun ComposeTestRule.awaitTag(tag: String) {
    waitUntil(10_000) { onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    onNodeWithTag(tag).assertIsDisplayed()
}

private fun installGraph(): Graph {
    val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
    val graph = Graph(ctx, box = FakeBox(), api = FakeApi(), widgetUpdater = {}, pairingDataStore = MemoryDataStore(), prefsDataStore = MemoryDataStore())
    Services.install(graph)
    return graph
}

/** A launch intent acts once: a recreation never replays a used pairing link or a closed holding (CODE-3). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class IntentTest {
    @get:Rule val rule = createEmptyComposeRule()
    private val auth = FakeAuthenticator()
    private lateinit var graph: Graph

    @Before
    fun setUp() {
        graph = installGraph()
        MainActivity.authenticatorFactory = { auth }
        MainActivity.scannerFactory = { NoScanner() }
        LockMemory.resetForProcessDeath()
        auth.results.add("") // the launch prompt is cancelled; each test unlocks with the button (as LockTest does)
    }

    private fun unlock() {
        rule.awaitTag("unlock")
        auth.results.add(null)
        rule.onNodeWithTag("unlock").performClick()
        rule.waitForIdle()
    }

    @After
    fun tearDown() {
        Services.install(null)
        LockMemory.resetForProcessDeath()
    }

    @Test
    fun aUsedPairingLinkIsNotReplayedOnRecreation() {
        val link = Intent(Intent.ACTION_VIEW, Uri.parse("joinrfinance://pair?v=1&u=http%3A%2F%2F127.0.0.1%3A3614&c=ABCDE12345"))
            .setClass(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(link).use { scenario ->
            unlock()
            rule.awaitTag("confirm")
            rule.onNodeWithTag("pair").performClick()
            rule.waitForIdle()
            rule.onNodeWithTag("confirm").assertDoesNotExist()
            rule.awaitTag("today")
            scenario.recreate()
            rule.waitForIdle()
            rule.onNodeWithTag("confirm").assertDoesNotExist()
            rule.onNodeWithTag("replace-warning").assertDoesNotExist()
            rule.awaitTag("today")
        }
    }

    @Test
    fun aCancelledPairingLinkIsNotReplayedOnRecreation() {
        val link = Intent(Intent.ACTION_VIEW, Uri.parse("joinrfinance://pair?v=1&u=http%3A%2F%2F127.0.0.1%3A3614&c=ABCDE12345"))
            .setClass(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
        ActivityScenario.launch<MainActivity>(link).use { scenario ->
            unlock()
            rule.onNodeWithTag("cancel").performClick()
            rule.waitForIdle()
            rule.onNodeWithTag("confirm").assertDoesNotExist()
            scenario.recreate()
            rule.waitForIdle()
            rule.onNodeWithTag("confirm").assertDoesNotExist()
            rule.awaitTag("not-paired")
        }
    }

    @Test
    fun aClosedHoldingIsNotReopenedOnRecreation() {
        runBlocking {
            graph.pairingStore.save(
                Pairing("http://umbrel.example-tailnet.ts.net:4932", Fixtures.FAKE_KEY, "d_0000000000000001", "Android phone", "2030-09-12T05:10:00.000Z", "1.2.0", "Australia/Melbourne"),
            )
            // Today from the cache (the refresh worker does not run under Robolectric).
            graph.cache.write(Fixtures.open, Fixtures.generatedMs(Fixtures.open))
        }
        val key = Fixtures.open.holdings.first().key
        val open = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_HOLDING_KEY, key)
        ActivityScenario.launch<MainActivity>(open).use { scenario ->
            unlock()
            rule.awaitTag("detail")
            rule.onNodeWithTag("back").performClick()
            rule.waitForIdle()
            rule.onNodeWithTag("detail").assertDoesNotExist()
            scenario.onActivity { assertFalse(it.intent.hasExtra(MainActivity.EXTRA_HOLDING_KEY)) }
            scenario.recreate()
            rule.waitForIdle()
            rule.onNodeWithTag("detail").assertDoesNotExist()
            rule.awaitTag("today")
        }
    }
}

/** The app is dark only: light bar icons even when the phone is in light mode (STYLE-1). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-notnight-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SystemBarsTest {
    @Before
    fun setUp() {
        installGraph()
        MainActivity.authenticatorFactory = { FakeAuthenticator() } // stays locked: the bars do not depend on it
        MainActivity.scannerFactory = { NoScanner() }
        LockMemory.resetForProcessDeath()
    }

    @After
    fun tearDown() {
        Services.install(null)
        LockMemory.resetForProcessDeath()
    }

    private fun assertLightIcons(activity: android.app.Activity) {
        val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        assertFalse("dark status-bar icons on ink", controller.isAppearanceLightStatusBars)
        assertFalse("dark navigation-bar icons on ink", controller.isAppearanceLightNavigationBars)
    }

    @Test
    fun mainActivityKeepsLightIconsInLightMode() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario -> scenario.onActivity(::assertLightIcons) }
    }

    @Test
    fun widgetConfigActivityKeepsLightIconsInLightMode() {
        val activity = Robolectric.buildActivity(WidgetConfigActivity::class.java, Intent()).create().get()
        assertLightIcons(activity)
    }
}
