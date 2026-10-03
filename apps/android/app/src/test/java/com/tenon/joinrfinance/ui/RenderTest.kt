package com.tenon.joinrfinance.ui

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasTestTag
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.model.TodayTab
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Renders the main screens from the fixtures to PNGs under `app/build/renders/` (build output, git-ignored) for the
 * style review; asserts only that each render is non-empty. The emulator screencaps (phase B) are the real check.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RenderTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    private val out = File("build/renders").apply { mkdirs() }

    private fun save(name: String) {
        rule.waitForIdle()
        val view = rule.activity.window.decorView
        val bmp = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        rule.runOnUiThread { view.draw(android.graphics.Canvas(bmp)) }
        assertTrue(bmp.width > 0 && bmp.height > 0)
        File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test
    fun renders() {
        val h = TestHost(pairedState())
        rule.setContent { h.Content() }
        save("today-cards")
        h.state = pairedState(Fixtures.priced())
        save("today-cards-priced")
        h.state = pairedState()
        h.state = h.state.copy(tab = TodayTab.LIST)
        save("today-list")
        h.state = h.state.copy(tab = TodayTab.MOVERS)
        save("today-movers")
        h.state = h.state.copy(tab = TodayTab.CARDS)
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("card-bullion-silver"))
        rule.onNodeWithTag("card-bullion-silver").performClick()
        save("detail-silver")
        rule.onNodeWithTag("back").performClick()
        rule.onNodeWithTag("nav-SETTINGS").performClick()
        save("settings")
        h.state = pairedState().copy(pairing = null, today = null, scanner = ScannerState.READY)
        save("not-paired")
        h.state = pairedState().copy(lock = LockUi.Locked())
        save("lock")
        h.state = pairedState().copy(pairStep = PairStep.Confirm("http://umbrel:4932", "ABCDE12345", replacing = true))
        save("confirm")
        h.state = pairedState(Fixtures.allStale).copy(error = com.tenon.joinrfinance.net.ApiError.Unreachable)
        save("today-unreachable-stale")
    }

    /** D155: the header with a known gain at 1.3x font scale (the gain % may sit under its $). */
    @Test
    fun rendersTheHeaderAt1_3() {
        val h = TestHost(pairedState(Fixtures.priced()))
        rule.setContent { h.Content(fontScale = 1.3f) }
        save("today-cards-priced-font1.3")
    }
}
