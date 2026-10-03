package com.tenon.joinrfinance.ui

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.PeriodFixtures
import com.tenon.joinrfinance.model.Period
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.net.MobilePeriodsResponse
import com.tenon.joinrfinance.ui.today.chipScrollTarget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** Layout checks under the period chips (Stage 10 plan section 9.7). */
object PeriodLayoutChecks {
    /** As [LayoutChecks.noClippedText], except the ALL line caption, which may end in an ellipsis by design (plan section 9.4). */
    fun noClippedText(rule: Rule2) {
        val nodes = rule.onAllNodes(
            SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult) and hasAnyAncestor(hasTestTag("today")),
            useUnmergedTree = true,
        ).fetchSemanticsNodes()
        assertTrue(nodes.isNotEmpty())
        for (n in nodes) {
            if (n.config.getOrNull(SemanticsProperties.TestTag) == "line-caption") continue
            val results = mutableListOf<TextLayoutResult>()
            n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
            val text = n.config.getOrNull(SemanticsProperties.Text)?.joinToString() ?: "?"
            results.forEach { r ->
                val tolerance = r.layoutInput.density.density
                val widest = (0 until r.lineCount).maxOf { r.getLineRight(it) }
                assertTrue("clipped width: $text ($widest > ${r.size.width})", widest <= r.size.width + tolerance)
                assertTrue("clipped height: $text", !r.didOverflowHeight)
                assertTrue("ellipsised: $text", (0 until r.lineCount).none { r.isLineEllipsized(it) })
            }
        }
    }

    /** The text layout of a node (its first result). */
    fun layoutOf(rule: Rule2, tag: String): TextLayoutResult {
        val results = mutableListOf<TextLayoutResult>()
        rule.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action!!.invoke(results)
        return results.first()
    }

    /** Every chip lies fully inside the chip row (nothing cut at either edge). */
    fun everyChipInsideTheRow(rule: Rule2) {
        for (p in Period.entries) chipInsideTheRow(rule, p)
    }

    /**
     * One chip lies fully inside the visible chip row. The chip's bounds are the unclipped ones: `getBoundsInRoot` is
     * already clipped to the row, so a chip cut off at the edge would still report bounds inside it.
     */
    fun chipInsideTheRow(rule: Rule2, p: Period) {
        val row = rule.onNodeWithTag("period-chips").getBoundsInRoot()
        val chip = rule.onNodeWithTag("chip-${p.chip}").getUnclippedBoundsInRoot()
        val slack = 0.5.dp
        assertTrue(
            "${p.chip} ${chip.left}–${chip.right} vs row ${row.left}–${row.right}",
            chip.left >= row.left - slack && chip.right <= row.right + slack,
        )
    }

    /** The lines of a text layout, trimmed. */
    private fun linesOf(r: TextLayoutResult): List<String> {
        val text = r.layoutInput.text.text
        return (0 until r.lineCount).map { text.substring(r.getLineStart(it), r.getLineEnd(it)).trim() }
    }

    /** A text layout shows all of its text: no line cut, ellipsised or overflowing its box. */
    fun wholeText(r: TextLayoutResult) {
        val text = r.layoutInput.text.text
        val widest = (0 until r.lineCount).maxOf { r.getLineRight(it) }
        assertFalse("overflowing height: $text ${linesOf(r)}", r.didOverflowHeight)
        assertTrue("clipped width: $text ($widest > ${r.size.width})", widest <= r.size.width + r.layoutInput.density.density)
        assertTrue("ellipsised: $text", (0 until r.lineCount).none { r.isLineEllipsized(it) })
    }

    /** Scrolls Today to a card and returns its change line's layout. */
    fun changeLineOf(rule: Rule2, key: String): TextLayoutResult {
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("card-$key"))
        rule.waitForIdle()
        return layoutOf(rule, "change-$key")
    }

    /** D166: a no-start card's bought-in line keeps its PARTIAL marker whole (three lines at most, nothing cut). */
    fun partialMarkerShown(rule: Rule2, key: String) {
        val r = changeLineOf(rule, key)
        wholeText(r)
        assertTrue(r.layoutInput.text.text.endsWith("PARTIAL"))
        val lines = linesOf(r)
        assertTrue("$lines", lines.size <= 3 && lines.last().endsWith("PARTIAL") && lines.none { it.endsWith("·") })
    }

    /** Under ALL, no card's change line splits ALL from TIME. */
    fun allTimeNeverSplit(rule: Rule2, answer: MobilePeriodsResponse) {
        for (h in answer.holdings) {
            val r = changeLineOf(rule, h.key)
            wholeText(r)
            val lines = linesOf(r)
            assertTrue("${h.key} $lines", lines.none { it.endsWith("ALL") || it.startsWith("TIME") })
        }
    }

    /** The first card row is above the bottom bar, with the chip row in place under the header. */
    fun firstCardRowAboveTheBarWithChips(rule: Rule2) {
        LayoutChecks.firstCardRowAboveTheBar(rule)
        val chips = rule.onNodeWithTag("period-chips").assertIsDisplayed().getBoundsInRoot()
        val header = rule.onNodeWithTag("header").getBoundsInRoot()
        assertTrue("chips under the header", chips.top >= header.bottom)
    }

    /** A seven-digit ALL total and a seven-digit negative GAIN stay on one line (D168), as does the caption. */
    fun sevenDigitsOnOneLine(rule: Rule2, host: PeriodHost) {
        // A made-up cost that makes the header's GAIN a seven-digit loss under ALL.
        val today = Fixtures.priced().let { t ->
            val h = t.holdings.toMutableList()
            h[0] = h[0].copy(position = h[0].position.copy(costCents = (h[0].position.costCents ?: 0L) + 123_456_789L))
            t.copy(holdings = h)
        }
        val answer = PeriodFixtures.sevenDigitAll().let { a -> a.copy(holdings = a.holdings.filter { it.valueCents != null }) }
        host.state = periodState(Period.ALL, answer, today)
        rule.waitForIdle()
        assertEquals("−$1,234,568", rule.onNodeWithTag("day-figure", useUnmergedTree = true).fetchSemanticsNode().config[SemanticsProperties.Text].joinToString())
        assertEquals(1, layoutOf(rule, "day-figure").lineCount)
        assertTrue(layoutOf(rule, "total-gain").layoutInput.text.text.startsWith("−$1,"))
        assertEquals(1, layoutOf(rule, "total-gain").lineCount)
        assertEquals(1, layoutOf(rule, "line-caption").lineCount)
        noClippedText(rule)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w411dp-h882dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PeriodLayout411Test {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun everyChipIsVisibleAt411x1() {
        val h = PeriodHost(pairedState())
        rule.setContent { h.Content() }
        PeriodLayoutChecks.everyChipInsideTheRow(rule)
        PeriodLayoutChecks.firstCardRowAboveTheBarWithChips(rule)
        for (p in listOf(Period.ONE_WEEK, Period.ALL)) {
            h.state = periodState(p)
            rule.waitForIdle()
            PeriodLayoutChecks.firstCardRowAboveTheBarWithChips(rule)
            PeriodLayoutChecks.noClippedText(rule)
        }
    }

    @Test
    fun aTwoDigitPartialLineKeepsItsMarkerAt1_3() {
        // A made-up two-digit bought-in ratio on the no-start card (▲ 24.56%).
        val h = PeriodHost(periodState(Period.TWELVE_MONTHS, PeriodFixtures.withRatio("i12", "0.245641025641")))
        rule.setContent { h.Content(fontScale = 1.3f) }
        PeriodLayoutChecks.partialMarkerShown(rule, "i12")
    }

    @Test
    fun sevenDigitsAt1_3() {
        val h = PeriodHost(periodState(Period.ALL))
        rule.setContent { h.Content(fontScale = 1.3f) }
        PeriodLayoutChecks.sevenDigitsOnOneLine(rule, h)
        h.state = periodState(Period.ONE_WEEK)
        rule.waitForIdle()
        PeriodLayoutChecks.firstCardRowAboveTheBarWithChips(rule)
        PeriodLayoutChecks.noClippedText(rule)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PeriodLayout360Test {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun at1xTheCardsStayAboveTheBar() {
        val h = PeriodHost(periodState(Period.ONE_WEEK))
        rule.setContent { h.Content() }
        for (p in Period.entries) {
            h.state = periodState(p)
            rule.waitForIdle()
            PeriodLayoutChecks.firstCardRowAboveTheBarWithChips(rule)
            PeriodLayoutChecks.noClippedText(rule)
        }
    }

    @Test
    fun at1_3AllIsReachableAndNothingClips() {
        val h = PeriodHost(pairedState())
        rule.setContent { h.Content(fontScale = 1.3f) }
        // The row scrolls (never the page): ALL is reachable.
        rule.onNodeWithTag("chip-ALL").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("chip-ALL").performClick()
        assertEquals(Period.ALL, h.state.period)
        h.state = periodState(Period.ALL)
        rule.waitForIdle()
        PeriodLayoutChecks.firstCardRowAboveTheBarWithChips(rule)
        PeriodLayoutChecks.noClippedText(rule)
        h.state = periodState(Period.ONE_WEEK)
        rule.waitForIdle()
        PeriodLayoutChecks.firstCardRowAboveTheBarWithChips(rule)
        PeriodLayoutChecks.noClippedText(rule)
        PeriodLayoutChecks.sevenDigitsOnOneLine(rule, h)
    }

    @Test
    fun aHeldAllChipIsInViewOnTheFirstComposition() {
        // D163: Today composed afresh with ALL already held (back out and reopen, rotation): the row scrolls at 1.3, and
        // the held chip must be brought into view once the row is laid out.
        val h = PeriodHost(periodState(Period.ALL))
        rule.setContent { h.Content(fontScale = 1.3f) }
        rule.waitForIdle()
        rule.mainClock.advanceTimeBy(2_000)
        rule.waitForIdle()
        PeriodLayoutChecks.chipInsideTheRow(rule, Period.ALL)
    }

    @Test
    fun thePartialMarkerAndAllTimeStayWholeAt1_3() {
        val h = PeriodHost(periodState(Period.TWELVE_MONTHS))
        rule.setContent { h.Content(fontScale = 1.3f) }
        PeriodLayoutChecks.partialMarkerShown(rule, "i12")
        h.state = periodState(Period.ONE_WEEK)
        rule.waitForIdle()
        PeriodLayoutChecks.partialMarkerShown(rule, "i12")
        h.state = periodState(Period.ALL)
        rule.waitForIdle()
        PeriodLayoutChecks.allTimeNeverSplit(rule, PeriodFixtures.open)
    }

    @Test
    fun aLargeSoldFigureIsNotClippedAt1_3() {
        // A made-up seven-digit Sold figure: the words are Arimo, and a second line is the fallback.
        val h = PeriodHost(periodState(Period.ALL, PeriodFixtures.withSoldCents(123_456_700L)))
        rule.setContent { h.Content(fontScale = 1.3f) }
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("sold-line"))
        rule.waitForIdle()
        val r = PeriodLayoutChecks.layoutOf(rule, "sold-line-text")
        assertEquals("Sold holdings: +$1,234,567 · 2 sold", r.layoutInput.text.text)
        PeriodLayoutChecks.wholeText(r)
        assertFalse(r.didOverflowWidth)
    }
}

/** The chip row's scroll target (pure). */
class ChipScrollTargetTest {
    @Test
    fun theLeastMoveThatShowsTheChipWithItsEdge() {
        // Content 0..500 px, a 360 px window, 16 px edges, max 140.
        assertEquals(0, chipScrollTarget(left = 16, right = 60, value = 0, viewport = 360, edge = 16, max = 140))
        assertEquals(140, chipScrollTarget(left = 430, right = 484, value = 0, viewport = 360, edge = 16, max = 140))
        assertEquals(50, chipScrollTarget(left = 200, right = 250, value = 50, viewport = 360, edge = 16, max = 140))
        assertEquals(0, chipScrollTarget(left = 16, right = 60, value = 140, viewport = 360, edge = 16, max = 140))
        // Before layout (no viewport) nothing moves.
        assertEquals(30, chipScrollTarget(left = 430, right = 484, value = 30, viewport = 0, edge = 16, max = 140))
    }
}

/** Every period on every tab at a fractional density (420 dpi), at 1× and 1.3× (the Stage 9 LIST rule). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w411dp-h914dp-420dpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PeriodLayoutFractionalDensityTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun everyPeriodAndTab(fontScale: Float?) {
        val h = PeriodHost(periodState(Period.ONE_WEEK))
        rule.setContent { h.Content(fontScale) }
        for (p in Period.entries.drop(1)) {
            for (tab in TodayTab.entries) {
                h.state = periodState(p).copy(tab = tab)
                rule.waitForIdle()
                PeriodLayoutChecks.noClippedText(rule)
            }
        }
    }

    @Test fun everyPeriodAndTabAt1x() = everyPeriodAndTab(null)

    @Test fun everyPeriodAndTabAt1_3x() = everyPeriodAndTab(1.3f)
}

/**
 * Renders Today and the detail under the periods to PNGs under `app/build/renders/` (build output) for the style review;
 * asserts only that each render is non-empty. The emulator screencaps (phase B) are the real check.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PeriodRenderTest {
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
        val h = PeriodHost(periodState(Period.ONE_WEEK))
        rule.setContent { h.Content() }
        for (p in listOf(Period.ONE_WEEK, Period.ONE_MONTH, Period.TWELVE_MONTHS, Period.ALL)) {
            for (tab in TodayTab.entries) {
                h.state = periodState(p).copy(tab = tab)
                save("period-${p.chip}-${tab.name.lowercase()}")
            }
        }
        h.state = periodState(Period.ALL).copy(tab = TodayTab.CARDS)
        rule.waitForIdle()
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("sold-line"))
        save("period-ALL-cards-sold-line")
        h.state = periodState(Period.ONE_WEEK, PeriodFixtures.noHistory)
        save("period-1W-no-history")
        h.state = periodState(Period.ALL, PeriodFixtures.soldOnly, Fixtures.empty)
        save("period-ALL-sold-only")
        h.state = periodState(Period.ONE_WEEK, answer = null).copy(periodsError = com.tenon.joinrfinance.net.ApiError.ServerTooOld)
        save("period-1W-server-too-old")
        h.state = periodState(Period.ONE_WEEK).let { it.copy(error = com.tenon.joinrfinance.net.ApiError.Unreachable, periodsError = com.tenon.joinrfinance.net.ApiError.Unreachable) }
        save("period-1W-offline")
        h.state = periodState(Period.ONE_WEEK)
        rule.waitForIdle()
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("card-i1"))
        rule.onNodeWithTag("card-i1").performClick()
        save("detail-1W-abc")
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        h.state = periodState(Period.ALL)
        rule.waitForIdle()
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("card-i3"))
        rule.onNodeWithTag("card-i3").performClick()
        save("detail-ALL-def")
    }

    @Test
    fun rendersAt1_3() {
        val h = PeriodHost(periodState(Period.ALL, today = Fixtures.priced()))
        rule.setContent { h.Content(fontScale = 1.3f) }
        save("period-ALL-cards-font1.3")
        h.state = periodState(Period.ONE_WEEK)
        save("period-1W-cards-font1.3")
    }
}
