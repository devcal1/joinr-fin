package com.tenon.joinrfinance.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.PeriodFixtures
import com.tenon.joinrfinance.model.EMPTY_TEXT
import com.tenon.joinrfinance.model.Format
import com.tenon.joinrfinance.model.NOTHING_HELD_TEXT
import com.tenon.joinrfinance.model.NO_LINE_TEXT
import com.tenon.joinrfinance.model.PERIODS_TOO_OLD_TEXT
import com.tenon.joinrfinance.model.Period
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.model.periodOf
import com.tenon.joinrfinance.model.sinceText
import com.tenon.joinrfinance.net.ApiError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Today and the detail under the period chips (Stage 10 plan sections 9.4, 9.5 and 9.7), on a 360 × 780 dp phone. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PeriodUiTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun host(state: AppUiState): PeriodHost {
        val h = PeriodHost(state)
        rule.setContent { h.Content() }
        return h
    }

    private fun text(tag: String): String = rule.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode()
        .config.getOrNull(SemanticsProperties.Text)?.joinToString() ?: ""

    private fun spoken(tag: String): String = rule.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode()
        .config.getOrNull(SemanticsProperties.ContentDescription)?.joinToString() ?: ""

    private fun scrollTo(tag: String) {
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag(tag))
    }

    private fun back() {
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
    }

    private val isTab = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)
    private val noClick = SemanticsMatcher.keyNotDefined(SemanticsActions.OnClick)

    @Test
    fun allEightChipsExistWithTabSemantics() {
        val h = host(pairedState())
        val chips = rule.onAllNodes(SemanticsMatcher("chip") { n ->
            n.config.getOrElseNullable(SemanticsProperties.TestTag) { null }?.startsWith("chip-") == true
        })
        chips.assertCountEquals(8)
        for (p in Period.entries) rule.onNodeWithTag("chip-${p.chip}").assert(isTab)
        rule.onNodeWithTag("chip-1D").assertIsSelected()
        rule.onNodeWithTag("chip-1W").assertIsNotSelected()
        rule.onNodeWithTag("period-chips").assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.SelectableGroup))
        // TalkBack: "1 week, tab, selected, 2 of 8".
        val oneWeek = rule.onNodeWithTag("chip-1W").fetchSemanticsNode().config
        assertEquals("1 week", oneWeek[SemanticsProperties.ContentDescription].joinToString())
        assertEquals(1, oneWeek[SemanticsProperties.CollectionItemInfo].columnIndex)
        assertEquals(8, rule.onNodeWithTag("period-chips").fetchSemanticsNode().config[SemanticsProperties.CollectionInfo].columnCount)
        rule.onNodeWithTag("chip-1W").performClick()
        assertEquals(Period.ONE_WEEK, h.state.period)
        rule.onNodeWithTag("chip-1W").assertIsSelected()
        rule.onNodeWithTag("chip-1D").assertIsNotSelected()
    }

    @Test
    fun aChipIsHitAbove() {
        // The 30 dp chip takes a touch a few dp above its edge (the 48 dp target).
        val h = host(pairedState())
        rule.onNodeWithTag("chip-2W").performTouchInput { click(Offset(centerX, -5.dp.toPx())) }
        assertEquals(Period.TWO_WEEKS, h.state.period)
    }

    @Test
    fun under1DTheStage9ScreenStays() {
        host(pairedState())
        rule.onNodeWithTag("day-block").assertIsDisplayed()
        rule.onNodeWithTag("period-block").assertDoesNotExist()
        rule.onNodeWithTag("sort-label", useUnmergedTree = true).assert(hasText("DAY $"))
        rule.onNodeWithTag("period-chips").assertIsDisplayed()
    }

    @Test
    fun eachPeriodWithTheOpenFixture() {
        val h = host(periodState(Period.ONE_WEEK))
        for (p in Period.entries.drop(1)) {
            h.state = periodState(p).copy(tab = TodayTab.CARDS)
            rule.waitForIdle()
            val dto = PeriodFixtures.open.periodOf(p)!!
            rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("period-block"))
            rule.onNodeWithText("${p.label} · EXCL. CASH").assertExists()
            assertEquals(p.chip, Format.dayMoney(dto.totals.cents), text("day-figure"))
            assertEquals(p.chip, sinceText(dto, p), text("since"))
            assertEquals(p.chip, "Partial: ${dto.totals.missing} holding${if (dto.totals.missing == 1) " has" else "s have"} no figure for ${p.chip}.", spoken("partial-note"))
            rule.onNodeWithTag("sort-label", useUnmergedTree = true).assert(hasText("${p.chip} $"))
            scrollTo("card-i13")
            assertEquals(p.chip, Format.dayMoney(dto.figures.first { it.key == "i13" }.cents), text("cents-i13"))
            h.state = h.state.copy(tab = TodayTab.LIST)
            scrollTo("list")
            rule.onNodeWithTag("total-3", useUnmergedTree = true).assert(hasText(Format.dayShort(dto.totals.cents)))
            if (p == Period.ALL) rule.onNodeWithTag("row-sold").assertExists() else rule.onNodeWithTag("row-sold").assertDoesNotExist()
            h.state = h.state.copy(tab = TodayTab.MOVERS)
            scrollTo("movers")
            assertEquals("No figure for ${p.chip}: ${dto.totals.missing}", text("movers-nochange"))
        }
    }

    @Test
    fun dashCardsAndTheirWordsUnder1W() {
        host(periodState(Period.ONE_WEEK))
        scrollTo("card-i2")
        assertEquals("SPLIT", text("word-i2"))
        assertEquals("—", text("change-i2"))
        assertEquals("—", text("cents-i2"))
        scrollTo("card-i12")
        // D166: the bought-in part of a holding with no start close, marked PARTIAL, with NO HISTORY.
        assertEquals("NO HISTORY", text("word-i12"))
        assertEquals("BOUGHT IN 1W ▲ 2.56% · PARTIAL", text("change-i12"))
        assertEquals("+$5", text("cents-i12"))
        scrollTo("card-i16")
        assertEquals("NO PRICE", text("word-i16"))
        scrollTo("card-i4")
        assertEquals("BOUGHT IN 1W ▲ 11.11%", text("change-i4"))
        scrollTo("card-i15")
        // An ok figure on a stale price keeps the Stage 9 word.
        assertEquals("STALE · 05/09", text("word-i15"))
        scrollTo("card-i13")
        rule.onNodeWithTag("spark-i13", useUnmergedTree = true).assertExists()
    }

    @Test
    fun aNoCostFigureUnderAll() {
        host(periodState(Period.ALL, PeriodFixtures.withNoCost()))
        scrollTo("card-bullion-silver")
        assertEquals("NO COST", text("word-bullion-silver"))
        assertEquals("—", text("cents-bullion-silver"))
    }

    @Test
    fun allKeepsTheHeaderRowAndCaptionsTheLine() {
        host(periodState(Period.ALL, today = Fixtures.priced()))
        // D168: VAL · INVESTED · GAIN under ALL too, no UNREALISED or REALISED cell.
        rule.onNode(hasText("VAL") and hasAnyAncestor(hasTestTag("totals-row")), useUnmergedTree = true).assertExists()
        rule.onNode(hasText("INVESTED") and hasAnyAncestor(hasTestTag("totals-row")), useUnmergedTree = true).assertExists()
        rule.onNode(hasText("GAIN") and hasAnyAncestor(hasTestTag("totals-row")), useUnmergedTree = true).assertExists()
        rule.onNode(hasText("UNREALISED"), useUnmergedTree = true).assertDoesNotExist()
        rule.onNode(hasText("REALISED"), useUnmergedTree = true).assertDoesNotExist()
        // D167: the caption names the realised part that is in the figure but not in the line.
        assertEquals("Line: today's holdings, unrealised · realised +$980 not drawn", text("line-caption"))
        assertTrue(spoken("period-chart").startsWith("All-time line of today's holdings, unrealised gain, ending up 44,503 dollars"))
        assertEquals("Today", text("line-label-end"))
        assertEquals("01/02/2029", text("line-label-start"))
    }

    @Test
    fun theSoldRowsAreNotClickableAndSpeakForThemselves() {
        val h = host(periodState(Period.ALL))
        val want = "Sold holdings, 2 instruments, all-time gain plus 580 dollars, up 11.58 percent"
        scrollTo("sold-line")
        rule.onNodeWithTag("sold-line").assert(noClick)
        assertEquals(want, spoken("sold-line"))
        rule.onNode(hasText("Sold holdings: +$580 · 2 sold"), useUnmergedTree = true).assertExists()
        h.state = h.state.copy(tab = TodayTab.LIST)
        scrollTo("list")
        rule.onNodeWithTag("row-sold").assert(noClick)
        assertEquals(want, spoken("row-sold"))
        assertEquals("2 SOLD", text("listword-sold"))
        h.state = h.state.copy(tab = TodayTab.MOVERS)
        scrollTo("movers")
        rule.onNodeWithTag("mover-sold").assert(noClick)
        assertEquals(want, spoken("mover-sold"))
        // The holdings' rows still open their detail.
        rule.onNodeWithTag("mover-i13").assert(SemanticsMatcher.keyIsDefined(SemanticsActions.OnClick))
    }

    @Test
    fun firstLoadUnderAPeriodShowsSkeletons() {
        host(periodState(Period.ONE_MONTH, answer = null).copy(periodsLoading = true))
        rule.onNodeWithTag("skeleton").assertIsDisplayed()
    }

    @Test
    fun serverTooOldShowsOnlyUnderAPeriod() {
        val h = host(periodState(Period.ONE_DAY, answer = null).copy(periodsError = ApiError.ServerTooOld))
        // Under 1D: no periods notice at all (the Stage 9 screen).
        rule.onNodeWithText(PERIODS_TOO_OLD_TEXT).assertDoesNotExist()
        rule.onNodeWithText(ApiError.ServerTooOld.sentence).assertDoesNotExist()
        rule.onNodeWithTag("day-block").assertIsDisplayed()
        h.state = h.state.copy(period = Period.ONE_WEEK)
        rule.onNodeWithText(PERIODS_TOO_OLD_TEXT).assertIsDisplayed()
        rule.onNodeWithText(ApiError.ServerTooOld.sentence).assertDoesNotExist()
        rule.onNodeWithTag("skeleton").assertDoesNotExist()
        h.state = h.state.copy(period = Period.ALL)
        rule.onNodeWithText(PERIODS_TOO_OLD_TEXT).assertIsDisplayed()
    }

    @Test
    fun offlineKeepsTheCachedPeriodsWithTheirAge() {
        val s = periodState(Period.ONE_WEEK).let { it.copy(error = ApiError.Unreachable, periodsError = ApiError.Unreachable, periodsFetchedAtMs = it.nowMs - 2 * 3_600_000L) }
        host(s)
        rule.onNodeWithText("Can't reach the Umbrel — is Tailscale on?").assertIsDisplayed()
        rule.onNodeWithText("Figures from 13:20 (2 h ago)").assertIsDisplayed()
        rule.onNodeWithTag("period-block").assertIsDisplayed()
    }

    @Test
    fun theRefreshIndicatorCoversThePeriodsFetch() {
        val h = host(periodState(Period.ONE_WEEK).copy(periodsLoading = true))
        rule.onNodeWithTag("refresh").assertIsNotEnabled()
        h.state = h.state.copy(period = Period.ONE_DAY)
        rule.onNodeWithTag("refresh").assertIsEnabled()
        h.state = h.state.copy(refreshing = true)
        rule.onNodeWithTag("refresh").assertIsNotEnabled()
    }

    @Test
    fun noHistoryShowsDashesAndThePartialNote() {
        host(periodState(Period.ONE_WEEK, PeriodFixtures.noHistory))
        assertEquals("Partial: 11 holdings have no figure for 1W.", spoken("partial-note"))
        rule.onNodeWithTag("no-line").assertExists()
        rule.onNodeWithText(NO_LINE_TEXT).assertExists()
        scrollTo("card-i1")
        assertEquals("NO HISTORY", text("word-i1"))
    }

    @Test
    fun soldOnlyUnderAllAndUnder1W() {
        val h = host(periodState(Period.ALL, PeriodFixtures.soldOnly, Fixtures.empty))
        rule.onNodeWithTag("line-nothing-held").assertExists()
        rule.onNodeWithText(NOTHING_HELD_TEXT).assertExists()
        rule.onNodeWithText(EMPTY_TEXT).assertDoesNotExist()
        scrollTo("sold-line")
        h.state = h.state.copy(tab = TodayTab.LIST)
        scrollTo("list")
        rule.onNodeWithTag("row-sold").assertExists()
        h.state = h.state.copy(tab = TodayTab.MOVERS)
        scrollTo("movers")
        rule.onNodeWithTag("mover-sold").assertExists()
        h.state = h.state.copy(period = Period.ONE_WEEK)
        rule.onNodeWithTag("nothing-held").assertExists()
        rule.onNodeWithText(NOTHING_HELD_TEXT).assertExists()
        rule.onNodeWithText(EMPTY_TEXT).assertDoesNotExist()
        rule.onNodeWithTag("period-block").assertExists()
    }

    @Test
    fun emptyShowsTheStage9SentenceUnderEveryPeriod() {
        val h = host(periodState(Period.ONE_WEEK, PeriodFixtures.empty, Fixtures.empty))
        for (p in Period.entries) {
            h.state = h.state.copy(period = p)
            rule.onNodeWithText(EMPTY_TEXT).assertIsDisplayed()
        }
    }

    @Test
    fun thePriceHistoryNote() {
        val h = host(periodState(Period.ONE_WEEK, PeriodFixtures.open.copy(closesThrough = "2030-09-01")))
        assertEquals("Price history to 01/09.", text("history-note"))
        h.state = h.state.copy(period = Period.ONE_DAY)
        rule.onNodeWithTag("history-note").assertDoesNotExist()
        h.state = periodState(Period.ONE_WEEK)
        rule.onNodeWithTag("history-note").assertDoesNotExist()
    }

    @Test
    fun theMiddleLabelIsThePointsMiddleOnAnUnevenGrid() {
        val open = PeriodFixtures.open
        val uneven = open.copy(
            periods = open.periods.map { d ->
                if (d.period != "1W") d else d.copy(line = d.line!!.copy(points = listOf("2030-09-05" to 0L, "2030-09-06" to 100L, "2030-09-09" to 200L, "2030-09-10" to 300L, "2030-09-12" to d.totals.cents!!)))
            },
        )
        host(periodState(Period.ONE_WEEK, uneven))
        assertEquals("05/09", text("line-label-start"))
        assertEquals("09/09", text("line-label-mid"))
        assertEquals("Today", text("line-label-end"))
    }

    @Test
    fun theDetailFollowsThePeriod() {
        val h = host(periodState(Period.ONE_WEEK))
        scrollTo("card-i1")
        rule.onNodeWithTag("card-i1").performClick()
        rule.onNodeWithTag("detail").assertIsDisplayed()
        for (label in listOf("1W CHANGE", "START CLOSE", "CHANGE PER UNIT", "HELD AT START", "BOUGHT IN 1W", "UNREALISED GAIN")) {
            rule.onNodeWithTag("detail-scroll").performScrollToNode(hasText(label))
            rule.onNode(hasText(label), useUnmergedTree = true).assertExists()
        }
        rule.onNode(hasText("DAY $"), useUnmergedTree = true).assertDoesNotExist()
        rule.onNode(hasText("SESSION"), useUnmergedTree = true).assertDoesNotExist()
        // Dates under the chart (not times) and an AUD readout with the date.
        assertEquals("05/09", text("chart-label-start"))
        rule.onNodeWithTag("large-chart").performTouchInput { click(Offset(right - 2f, centerY)) }
        assertTrue(text("readout"), text("readout").matches(Regex("""12/09/2030 · \$[0-9,.]+""")))
        assertTrue(spoken("large-chart").startsWith("ABC price over 1 week since 05/09/2030"))
        back()
        // A holding without a line: the no-line sentence.
        scrollTo("card-i4")
        rule.onNodeWithTag("card-i4").performClick()
        rule.onNodeWithTag("no-chart").assertExists()
        rule.onNode(hasText(NO_LINE_TEXT), useUnmergedTree = true).assertExists()
        back()
        // Under ALL: the ALL rows, and no duplicate unrealised row.
        h.state = h.state.copy(period = Period.ALL)
        scrollTo("card-i1")
        rule.onNodeWithTag("card-i1").performClick()
        for (label in listOf("UNREALISED", "REALISED", "ALL-TIME GAIN", "COST OF EVERYTHING BOUGHT")) {
            rule.onNodeWithTag("detail-scroll").performScrollToNode(hasText(label))
            rule.onNode(hasText(label), useUnmergedTree = true).assertExists()
        }
        rule.onNode(hasText("UNREALISED GAIN"), useUnmergedTree = true).assertDoesNotExist()
        assertTrue(text("chart-label-start"), text("chart-label-start").matches(Regex("""\d\d/\d\d/\d{4}""")))
    }

    @Test
    fun aWidgetTapShowsTheDayAndKeepsThePeriod() {
        val h = host(periodState(Period.ONE_WEEK))
        h.openHolding = "i1"
        rule.waitForIdle()
        rule.onNodeWithTag("detail").assertIsDisplayed()
        rule.onNodeWithTag("detail-scroll").performScrollToNode(hasText("DAY $"))
        rule.onNode(hasText("DAY $"), useUnmergedTree = true).assertExists()
        rule.onNode(hasText("1W CHANGE"), useUnmergedTree = true).assertDoesNotExist()
        assertEquals(Period.ONE_WEEK, h.state.period)
        back()
        rule.onNodeWithTag("chip-1W").assertIsSelected()
        // A tap in the app opens the detail in the held period.
        scrollTo("card-i1")
        rule.onNodeWithTag("card-i1").performClick()
        rule.onNodeWithTag("detail-scroll").performScrollToNode(hasText("1W CHANGE"))
        rule.onNode(hasText("1W CHANGE"), useUnmergedTree = true).assertExists()
    }

    @Test
    fun cardsSpeakThePeriod() {
        host(periodState(Period.ONE_WEEK))
        scrollTo("card-i13")
        assertTrue(spoken("card-i13"), spoken("card-i13").startsWith("BTC, up 5.59 percent, 1 week plus 4,341 dollars"))
        rule.onAllNodesWithTag("card-i13").assertCountEquals(1)
    }
}

