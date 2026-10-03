package com.tenon.joinrfinance.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performScrollToNode
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.model.SortOrder
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.net.ApiError
import com.tenon.joinrfinance.ui.pair.CLEARTEXT_WARNING
import com.tenon.joinrfinance.ui.pair.PREPARING_SCANNER
import com.tenon.joinrfinance.ui.pair.REPLACE_WARNING
import com.tenon.joinrfinance.ui.pair.SCANNER_UNAVAILABLE
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The Compose screens on a 360 × 780 dp phone (plan section 9.13: never Robolectric's default screen). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h780dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TodayUiTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private fun host(state: AppUiState = pairedState()): TestHost {
        val h = TestHost(state)
        rule.setContent { h.Content() }
        return h
    }

    private fun back() {
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
    }

    private val isTab = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)

    @Test
    fun bottomBarHasTwoItemsWithTodaySelected() {
        host()
        rule.onNodeWithTag("bottom-bar").assertIsDisplayed()
        rule.onNodeWithTag("nav-TODAY").assertIsSelected().assert(isTab)
        rule.onNodeWithTag("nav-SETTINGS").assertIsNotSelected().assert(isTab)
        rule.onAllNodesWithTag("nav-TODAY").assertCountEquals(1)
        rule.onNodeWithText("HISTORY").assertDoesNotExist()
        rule.onNodeWithTag("today").assertIsDisplayed()
    }

    @Test
    fun settingsThroughTheBarAndBackKeepsTodaysTabSortAndScroll() {
        val h = host()
        rule.onNodeWithTag("tab-LIST").performClick()
        rule.onNodeWithTag("sort").performClick()
        rule.onNodeWithTag("today-list").performScrollToIndex(4)
        rule.waitForIdle()
        rule.onNodeWithTag("day-block").assertDoesNotExist()
        rule.onNodeWithTag("nav-SETTINGS").performClick()
        rule.onNodeWithTag("settings").assertIsDisplayed()
        rule.onNodeWithTag("nav-SETTINGS").assertIsSelected()
        rule.onNodeWithTag("bottom-bar").assertIsDisplayed()
        back()
        rule.onNodeWithTag("today").assertIsDisplayed()
        rule.onNodeWithTag("nav-TODAY").assertIsSelected()
        assertEquals(TodayTab.LIST, h.state.tab)
        assertEquals(SortOrder.DAY_RATIO, h.state.sort)
        rule.onNodeWithTag("tab-LIST").assertIsSelected()
        // The scroll position was kept: the day block is still scrolled away.
        rule.onNodeWithTag("day-block").assertDoesNotExist()
        // Tapping the selected item scrolls Today to the top.
        rule.onNodeWithTag("nav-TODAY").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("day-block").assertIsDisplayed()
    }

    @Test
    fun theBarIsHiddenOnTheDetailAndTheLicences() {
        host()
        rule.onNodeWithTag("card-i1").performClick()
        rule.onNodeWithTag("detail").assertIsDisplayed()
        rule.onNodeWithTag("bottom-bar").assertDoesNotExist()
        back()
        rule.onNodeWithTag("today").assertIsDisplayed()
        rule.onNodeWithTag("nav-SETTINGS").performClick()
        rule.onNodeWithTag("settings-scroll").performScrollToNode(hasTestTag("licences-link"))
        rule.onNodeWithTag("licences-link").performClick()
        rule.onNodeWithTag("licences").assertIsDisplayed()
        rule.onNodeWithTag("bottom-bar").assertDoesNotExist()
        rule.onNodeWithTag("back").performClick()
        rule.onNodeWithTag("settings").assertIsDisplayed()
    }

    @Test
    fun theBarIsHiddenOnTheFullScreenStates() {
        val h = host(pairedState().copy(lock = LockUi.Locked()))
        rule.onNodeWithTag("lock").assertIsDisplayed()
        rule.onNodeWithTag("bottom-bar").assertDoesNotExist()
        h.state = pairedState().copy(pairing = null, today = null)
        rule.onNodeWithTag("not-paired").assertIsDisplayed()
        rule.onNodeWithTag("bottom-bar").assertDoesNotExist()
        h.state = pairedState().copy(pairing = null, today = null, revoked = true)
        rule.onNodeWithTag("revoked").assertIsDisplayed()
        rule.onNodeWithTag("bottom-bar").assertDoesNotExist()
    }

    @Test
    fun cardsWithTheSilverBullionCard() {
        host()
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("card-bullion-silver"))
        rule.onNodeWithTag("card-bullion-silver").assertIsDisplayed()
        rule.onNode(hasTestTag("per-oz") and hasAnyAncestor(hasTestTag("card-bullion-silver")), useUnmergedTree = true).assertTextContains("/OZ", substring = true)
        rule.onNode(hasText("SILVER") and hasAnyAncestor(hasTestTag("card-bullion-silver")), useUnmergedTree = true).assertExists()
        rule.onNodeWithTag("spark-bullion-silver", useUnmergedTree = true).assertExists()
        // Non-ok holdings show their words instead of a line.
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("card-i16"))
        rule.onNodeWithTag("word-i16", useUnmergedTree = true).assertTextContains("NO PRICE")
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("card-i11"))
        rule.onNodeWithTag("word-i11", useUnmergedTree = true).assertTextContains("DAILY PRICE · Wed 11/09")
    }

    @Test
    fun theSortCyclesAndIsAnnounced() {
        val h = host()
        rule.onNodeWithTag("sort-label", useUnmergedTree = true).assertTextContains("DAY $")
        rule.onNodeWithTag("sort").performClick()
        rule.onNodeWithTag("sort-label", useUnmergedTree = true).assertTextContains("DAY %")
        rule.onNodeWithTag("sort").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Sorted by day percent"))
        rule.onNodeWithTag("sort").performClick()
        rule.onNodeWithTag("sort-label", useUnmergedTree = true).assertTextContains("VALUE")
        assertEquals(SortOrder.VALUE, h.state.sort)
        rule.onNodeWithTag("sort").performClick()
        assertEquals(SortOrder.DAY_CENTS, h.state.sort)
    }

    /** The sort slot is as wide as its widest label, so cycling it never moves the tabs or their underline. */
    private fun tabsStayPutWhileTheSortCycles(fontScale: Float?) {
        val h = TestHost(pairedState())
        rule.setContent { h.Content(fontScale) }
        fun bounds() = TodayTab.entries.map { rule.onNodeWithTag("tab-${it.name}").getUnclippedBoundsInRoot() }
        val before = bounds()
        repeat(SortOrder.entries.size) {
            rule.onNodeWithTag("sort").performClick()
            rule.waitForIdle()
            assertEquals("after sorting by ${h.state.sort}", before, bounds())
        }
    }

    @Test fun theTabsStayPutWhileTheSortCycles() = tabsStayPutWhileTheSortCycles(null)

    @Test fun theTabsStayPutWhileTheSortCyclesAt1_3x() = tabsStayPutWhileTheSortCycles(1.3f)

    @Test
    fun listShowsRowsTheTotalAndTheStatusWords() {
        host()
        rule.onNodeWithTag("tab-LIST").performClick()
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("list"))
        rule.onNodeWithTag("list").assertExists()
        rule.onNodeWithText("CHG$ ▼").assertExists()
        rule.onNodeWithTag("total-3", useUnmergedTree = true).assertTextContains("+1,943")
        rule.onNodeWithTag("listword-i12", useUnmergedTree = true).assertTextContains("HAND PRICE")
        rule.onNodeWithTag("listword-i11", useUnmergedTree = true).assertTextContains("DAILY PRICE")
        rule.onNodeWithTag("row-bullion-silver").assertExists()
    }

    @Test
    fun moversShowOnlyOkHoldingsAndTheCount() {
        host()
        rule.onNodeWithTag("tab-MOVERS").performClick()
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("movers"))
        rule.onAllNodes(SemanticsMatcher("mover") { n ->
            n.config.getOrElseNullable(SemanticsProperties.TestTag) { null }?.startsWith("mover-") == true
        }).assertCountEquals(8)
        rule.onNodeWithTag("mover-i14").assertDoesNotExist()
        rule.onNodeWithTag("movers-nochange", useUnmergedTree = true).assertTextContains("No day figure: 4")
    }

    @Test
    fun theDetailTableOfTheBullionHolding() {
        host()
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("card-bullion-silver"))
        rule.onNodeWithTag("card-bullion-silver").performClick()
        rule.onNodeWithTag("detail").assertIsDisplayed()
        rule.onNodeWithTag("large-chart").assertExists()
        for (text in listOf("PRICE", "DAY % IN USD", "ITEMS", "2 on the Other Assets page", "150.0000 oz", "\$45.68 per oz", "Since 00:00")) {
            rule.onNodeWithTag("detail-scroll").performScrollToNode(hasText(text))
            rule.onNode(hasText(text), useUnmergedTree = true).assertExists()
        }
        rule.onNode(hasText("bought today, measured from cost", substring = true), useUnmergedTree = true).assertExists()
        // The bullion line is the AUD spot per ounce (D153), never the futures' USD (found in the emulator smoke).
        val summary = rule.onNodeWithTag("large-chart").fetchSemanticsNode().config[SemanticsProperties.ContentDescription].joinToString()
        assertTrue(summary, summary.contains("last \$") && summary.endsWith(" per oz") && !summary.contains("USD"))
    }

    @Test
    fun theDetailOfAForeignListingShowsItsOwnCurrencyMove() {
        host()
        rule.onNodeWithTag("today-list").performScrollToNode(hasTestTag("card-i10"))
        rule.onNodeWithTag("card-i10").performClick()
        rule.onNode(hasText("DAY % IN USD"), useUnmergedTree = true).assertExists()
        rule.onNode(hasText("▲ 1.00%"), useUnmergedTree = true).assertExists()
    }

    @Test
    fun firstLoadShowsSkeletons() {
        host(pairedState(today = null))
        rule.onNodeWithTag("skeleton").assertIsDisplayed()
    }

    @Test
    fun emptyPortfolio() {
        host(pairedState(Fixtures.empty))
        rule.onNodeWithText("No holdings yet. Add trades in Joinr Finance on the web.").assertIsDisplayed()
    }

    @Test
    fun unreachableKeepsTheCachedFiguresWithTheirAge() {
        val s = pairedState().let { it.copy(error = ApiError.Unreachable, nowMs = it.nowMs + 2 * 3_600_000L) }
        host(s)
        rule.onNodeWithText("Can't reach the Umbrel — is Tailscale on?").assertIsDisplayed()
        rule.onNodeWithText("Figures from 15:20 (2 h ago)").assertIsDisplayed()
        rule.onNodeWithText("RETRY").assertIsDisplayed()
        rule.onNodeWithTag("day-figure").assertIsDisplayed()
    }

    @Test
    fun stalePricesAndOldPrices() {
        host(pairedState().let { it.copy(nowMs = it.nowMs + 25 * 60_000L) })
        rule.onNodeWithText("1 price is stale (oldest 05/09 16:10)").assertIsDisplayed()
        rule.onNodeWithText("Prices are 30 min old.").assertIsDisplayed()
    }

    @Test
    fun theOneLineErrors() {
        val h = host(pairedState().copy(error = ApiError.ProxyLogin))
        rule.onNodeWithText(ApiError.ProxyLogin.sentence).assertIsDisplayed()
        for (e in listOf(ApiError.ServerTooOld, ApiError.AppTooOld, ApiError.RateLimited, ApiError.ServerError)) {
            h.state = pairedState().copy(error = e)
            rule.onNodeWithText(e.sentence).assertIsDisplayed()
        }
        rule.onNodeWithText("RETRY").performClick()
        assertTrue(h.calls.contains("refresh"))
    }

    @Test
    fun noScreenLockBanner() {
        host(pairedState().copy(lock = LockUi.NoScreenLock))
        rule.onNodeWithText("Set a screen lock on this phone to protect Joinr Finance.").assertIsDisplayed()
    }

    @Test
    fun notPairedAndTheScannerStates() {
        val h = host(pairedState().copy(pairing = null, today = null))
        rule.onNodeWithText("Pair this phone with Joinr Finance on your Umbrel: Settings → Phone → Pair a phone.").assertIsDisplayed()
        rule.onNodeWithText(PREPARING_SCANNER.uppercase()).assertIsDisplayed()
        rule.onNodeWithTag("scan").assertIsNotEnabled()
        h.state = h.state.copy(scanner = ScannerState.READY)
        rule.onNodeWithText("SCAN").performClick()
        assertTrue(h.calls.contains("scan"))
        h.state = h.state.copy(scanMessage = SCANNER_UNAVAILABLE)
        rule.onNodeWithText(SCANNER_UNAVAILABLE).assertIsDisplayed()
        // A cancel says nothing.
        h.state = h.state.copy(scanMessage = null)
        rule.onNodeWithTag("scan-message").assertDoesNotExist()
    }

    @Test
    fun byHandPrefillsHttpAndConfirmsWithTheWarning() {
        val h = host(pairedState().copy(pairing = null, today = null))
        rule.onNodeWithTag("by-hand").performClick()
        rule.onNodeWithTag("address").assertTextContains("http://")
        h.updateByHand("umbrel:4932", "abcde-12345")
        rule.onNodeWithTag("continue").performClick()
        rule.onNodeWithTag("confirm").assertIsDisplayed()
        rule.onNodeWithText("Pair with http://umbrel:4932?").assertIsDisplayed()
        rule.onNodeWithText(CLEARTEXT_WARNING).assertIsDisplayed()
        rule.onNodeWithText("PAIR ANYWAY").assertIsDisplayed()
        rule.onNodeWithText(REPLACE_WARNING).assertDoesNotExist()
        rule.onNodeWithText("PAIR ANYWAY").performClick()
        assertTrue(h.calls.contains("confirm"))
    }

    @Test
    fun confirmationForATailscaleAddressAndAReplacement() {
        host(pairedState().copy(pairStep = PairStep.Confirm("http://umbrel.example-tailnet.ts.net:4932", "ABCDE12345", replacing = true)))
        rule.onNodeWithText("Pair with http://umbrel.example-tailnet.ts.net:4932?").assertIsDisplayed()
        rule.onNodeWithText(CLEARTEXT_WARNING).assertDoesNotExist()
        rule.onNodeWithText(REPLACE_WARNING).assertIsDisplayed()
        rule.onNodeWithText("PAIR").assertIsDisplayed()
        back()
        rule.onNodeWithTag("today").assertIsDisplayed()
    }

    @Test
    fun byHandRejectsABadCode() {
        val step = byHandNext(PairStep.ByHand("umbrel:4932", "ABC"), paired = false)
        assertEquals(CODE_HINT, (step as PairStep.ByHand).error)
        val bad = byHandNext(PairStep.ByHand("http://umbrel:4932/api", "ABCDE12345"), paired = false)
        assertEquals(ADDRESS_HINT, (bad as PairStep.ByHand).error)
        assertEquals(PairStep.Confirm("http://umbrel:4932", "ABCDE12345", true), byHandNext(PairStep.ByHand("Umbrel:4932", "abcde 12345"), paired = true))
    }

    @Test
    fun revokedScreen() {
        val h = host(pairedState().copy(pairing = null, today = null, revoked = true))
        rule.onNodeWithText("This phone was removed in Settings → Phone.").assertIsDisplayed()
        rule.onNodeWithText("PAIR AGAIN").performClick()
        rule.onNodeWithTag("not-paired").assertIsDisplayed()
        assertEquals(false, h.state.revoked)
    }

    @Test
    fun settingsShowsTheServerWarningForAShortName() {
        host(pairedState().copy(pairing = TEST_PAIRING.copy(origin = "http://umbrel:4932")))
        rule.onNodeWithTag("nav-SETTINGS").performClick()
        rule.onNodeWithTag("settings-warning").assertIsDisplayed()
        rule.onNodeWithText("http://umbrel:4932").assertIsDisplayed()
        rule.onNodeWithText("12/09/2030").assertIsDisplayed()
    }

    @Test
    fun settingsUnpairAsksFirst() {
        val h = host()
        rule.onNodeWithTag("nav-SETTINGS").performClick()
        rule.onNodeWithTag("settings-warning").assertDoesNotExist()
        rule.onNodeWithTag("settings-scroll").performScrollToNode(hasTestTag("unpair"))
        rule.onNodeWithTag("unpair").performClick()
        rule.onNodeWithTag("unpair-confirm").performClick()
        assertTrue(h.calls.contains("unpair"))
    }
}
