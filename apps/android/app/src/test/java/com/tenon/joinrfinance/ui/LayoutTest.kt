package com.tenon.joinrfinance.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.compose.ui.test.performClick
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.ui.theme.JoinrType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.abs

typealias Rule2 = AndroidComposeTestRule<ActivityScenarioRule<ComponentActivity>, ComponentActivity>

/** The checks shared by the three screen configurations (plan sections 9.7 and 9.13). */
object LayoutChecks {
    /** At least one full row of cards is visible above the bottom bar without scrolling. */
    fun firstCardRowAboveTheBar(rule: Rule2) {
        val row = rule.onNodeWithTag("card-row-0").assertIsDisplayed().getBoundsInRoot()
        val bar = rule.onNodeWithTag("bottom-bar").getBoundsInRoot()
        assertTrue("first card row ${row.top}–${row.bottom} vs bar top ${bar.top}", row.bottom <= bar.top)
    }

    /** The CARDS sparkline is as wide as the card's inner width (card − 2 × 12 dp padding). */
    fun sparklineFillsTheCard(rule: Rule2) {
        val card = rule.onNodeWithTag("card-i13").getBoundsInRoot()
        val spark = rule.onNodeWithTag("spark-i13", useUnmergedTree = true).getBoundsInRoot()
        val inner: Dp = (card.right - card.left) - 24.dp
        val width: Dp = spark.right - spark.left
        assertTrue("sparkline $width vs inner $inner", abs(width.value - inner.value) < 1.5f)
    }

    /** No text on Today is clipped (visual overflow), except an ellipsised status line. */
    fun noClippedText(rule: Rule2) {
        val nodes = rule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult) and hasAnyAncestor(hasTestTag("today")), useUnmergedTree = true)
            .fetchSemanticsNodes()
        assertTrue(nodes.isNotEmpty())
        for (n in nodes) {
            val results = mutableListOf<TextLayoutResult>()
            n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
            val text = n.config.getOrNull(SemanticsProperties.Text)?.joinToString() ?: "?"
            results.forEach { r ->
                // A line's drawn extent (its right edge, which includes Android's half letter-space after the last
                // glyph) may pass the box by a sub-dp sliver without clipping a glyph; more than 1 dp is a clip.
                val tolerance = r.layoutInput.density.density
                val widest = (0 until r.lineCount).maxOf { r.getLineRight(it) }
                val ellipsised = (0 until r.lineCount).any { r.isLineEllipsized(it) }
                assertTrue("clipped width: $text ($widest > ${r.size.width})", widest <= r.size.width + tolerance)
                assertTrue("clipped height: $text", !r.didOverflowHeight)
                assertTrue("ellipsised: $text", !ellipsised)
            }
        }
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class Layout360Test {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun budgetAt360x780() {
        val h = TestHost(pairedState())
        rule.setContent { h.Content() }
        LayoutChecks.firstCardRowAboveTheBar(rule)
        LayoutChecks.sparklineFillsTheCard(rule)
        LayoutChecks.noClippedText(rule)
        // At 1× the status line sits in the header.
        rule.onNode(hasTestTag("status-line") and hasAnyAncestor(hasTestTag("header"))).assertIsDisplayed()
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w411dp-h882dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class Layout411Test {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun budgetAt411x882() {
        val h = TestHost(pairedState())
        rule.setContent { h.Content() }
        LayoutChecks.firstCardRowAboveTheBar(rule)
        LayoutChecks.sparklineFillsTheCard(rule)
        LayoutChecks.noClippedText(rule)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LayoutFontScaleTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun at1_3TheStatusLineMovesAndNothingClips() {
        val h = TestHost(pairedState())
        rule.setContent { h.Content(fontScale = 1.3f) }
        rule.onNode(hasTestTag("status-line") and hasAnyAncestor(hasTestTag("day-block"))).assertIsDisplayed()
        rule.onNode(hasTestTag("status-line") and hasAnyAncestor(hasTestTag("header"))).assertDoesNotExist()
        // D155: the VAL · INVESTED · GAIN row did not push the first card row under the bar at 1.3× either.
        LayoutChecks.firstCardRowAboveTheBar(rule)
        LayoutChecks.noClippedText(rule)
        LayoutChecks.sparklineFillsTheCard(rule)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w411dp-h882dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class Layout411FontScaleTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun at1_3OneCardRowStillShowsAboveTheBar() {
        val h = TestHost(pairedState())
        rule.setContent { h.Content(fontScale = 1.3f) }
        LayoutChecks.firstCardRowAboveTheBar(rule)
        LayoutChecks.noClippedText(rule)
    }
}

/**
 * D155: the header's VAL · INVESTED · GAIN row: the figures, the unknown cases ("—" and a spoken reason) and, at
 * 360 dp × 1.3, no clipping with a known gain and the seven-digit made-up value (the gain's % may go under its $).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TotalsRowTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun text(tag: String) = rule.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode()
        .config.getOrNull(SemanticsProperties.Text)?.joinToString() ?: ""

    private fun spoken() = rule.onNodeWithTag("totals-row").fetchSemanticsNode()
        .config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString() ?: ""

    @Test
    fun knownFigures() {
        val h = TestHost(pairedState(Fixtures.priced()))
        rule.setContent { h.Content() }
        rule.onNodeWithTag("totals-row").assertIsDisplayed()
        assertEquals("$120,630", text("total-value"))
        assertEquals("$76,127", text("total-invested"))
        assertEquals("+$44,503", text("total-gain"))
        assertEquals("▲58.46%", text("total-gain-percent"))
        assertEquals("Value 120,630 dollars, invested 76,127 dollars, gain plus 44,503 dollars, up 58.46 percent", spoken())
        // The value left the counts line (it is in VAL now).
        rule.onNode(hasText("VAL", substring = true) and hasAnyAncestor(hasTestTag("totals-row")), useUnmergedTree = true).assertExists()
        LayoutChecks.firstCardRowAboveTheBar(rule)
        LayoutChecks.noClippedText(rule)
    }

    @Test
    fun anUnknownCostShowsADashAndSaysWhy() {
        val open = Fixtures.priced()
        val holdings = open.holdings.toMutableList()
        holdings[0] = holdings[0].copy(position = holdings[0].position.copy(costCents = null))
        val h = TestHost(pairedState(open.copy(holdings = holdings)))
        rule.setContent { h.Content() }
        assertEquals("—", text("total-invested"))
        assertEquals("—", text("total-gain"))
        rule.onNodeWithTag("total-gain-percent", useUnmergedTree = true).assertDoesNotExist()
        assertEquals("Value 120,630 dollars, invested unknown, 1 holding has no cost base, gain unknown", spoken())
    }

    @Test
    fun anUnpricedHoldingShowsTheGainAsUnknown() {
        val h = TestHost(pairedState(Fixtures.open))
        rule.setContent { h.Content() }
        assertEquals("$76,427", text("total-invested"))
        assertEquals("—", text("total-gain"))
        assertTrue(spoken().endsWith("gain unknown, 1 holding has no price"))
    }

    @Test
    fun wideFiguresAt1_3NeitherClipNorHideTheFirstCardRow() {
        val wide = Fixtures.wideFigures()
        val h = TestHost(pairedState(wide.copy(holdings = wide.holdings.filter { it.valueCents != null })))
        rule.setContent { h.Content(fontScale = 1.3f) }
        rule.onNodeWithTag("total-gain-percent", useUnmergedTree = true).assertExists()
        LayoutChecks.noClippedText(rule)
        LayoutChecks.firstCardRowAboveTheBar(rule)
    }
}

/**
 * Every Today tab at a fractional density (420 dpi = 2.625×, the emulator's and many phones'), where dp-to-px rounding
 * of a measured column plus its padding can leave a cell a pixel narrower than its text (found in the emulator smoke:
 * LIST's CHG$ cell broke "−58,398" onto a hidden second line). Also at 1.3× font scale.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w411dp-h914dp-420dpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LayoutTabsFractionalDensityTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun everyTab(fontScale: Float?) {
        val h = TestHost(pairedState(Fixtures.wideFigures()))
        rule.setContent { h.Content(fontScale) }
        for (tab in TodayTab.entries) {
            rule.onNodeWithTag("tab-${tab.name}").performClick()
            rule.waitForIdle()
            LayoutChecks.noClippedText(rule)
        }
    }

    @Test fun everyTabAt1x() = everyTab(null)

    @Test fun everyTabAt1_3x() = everyTab(1.3f)
}

/** Arimo is one variable font declared at 400 and 700: a bold label measures wider than the regular one (D149). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FontTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun boldIsWiderThanRegular() {
        var regular = 0
        var bold = 0
        rule.setContent { Measure { r, b -> regular = r; bold = b } }
        rule.waitForIdle()
        assertTrue("regular $regular, bold $bold", regular > 0 && bold > regular)
    }

    @Composable
    private fun Measure(out: (Int, Int) -> Unit) {
        val m = rememberTextMeasurer()
        val text = "TODAY · EXCL. CASH"
        val r = m.measure(text, JoinrType.label(size = 20.sp, weight = FontWeight.W400)).size.width
        val b = m.measure(text, JoinrType.label(size = 20.sp, weight = FontWeight.W700)).size.width
        out(r, b)
        Column { Text(text, style = JoinrType.label(size = 20.sp)) }
        LocalDensity.current
    }
}
