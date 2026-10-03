package com.tenon.joinrfinance.widget

import android.content.Context
import androidx.compose.ui.unit.DpSize
import androidx.glance.appwidget.testing.unit.GlanceAppWidgetUnitTest
import androidx.glance.appwidget.testing.unit.runGlanceAppWidgetUnitTest
import androidx.glance.testing.GlanceNodeMatcher
import androidx.glance.testing.unit.MappedNode
import androidx.glance.testing.unit.hasTestTag
import androidx.glance.testing.unit.hasText
import androidx.test.core.app.ApplicationProvider
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.model.WIDGET_PAIR_TEXT
import com.tenon.joinrfinance.model.WIDGET_UPDATE_TEXT
import com.tenon.joinrfinance.model.biggestMoves
import com.tenon.joinrfinance.net.MobileTodayResponse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Every widget × {ok fixture, allStale, empty, not paired, revoked, max age passed, holding no longer held} at each
 * declared size (plan section 9.13), the ≤ 10 children rule, and the faces' texts.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "xxhdpi")
class WidgetTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()

    private fun snap(t: MobileTodayResponse?, fetchedAt: Long? = t?.let { Fixtures.generatedMs(it) }) =
        WidgetSnapshot(WidgetSnapshot.Status.PAIRED, t, fetchedAt)

    private fun nowOf(t: MobileTodayResponse) = Fixtures.generatedMs(t) + 5 * 60_000L

    private val tooManyChildren = GlanceNodeMatcher<MappedNode>("a Row or Column with more than 10 children") { it.children().size > 10 }

    private fun render(size: DpSize, content: @androidx.compose.runtime.Composable () -> Unit, check: GlanceAppWidgetUnitTest.() -> Unit) =
        runGlanceAppWidgetUnitTest {
            setContext(ctx)
            setAppWidgetSize(size)
            provideComposable { content() }
            onAllNodes(tooManyChildren).assertCountEquals(0)
            check()
        }

    private val fixtures = listOf(Fixtures.open, Fixtures.saturday, Fixtures.allStale, Fixtures.holiday, Fixtures.preOpen)

    @Test
    fun todayWidgetWithFiguresAtEverySize() {
        for (t in fixtures) {
            for (size in WidgetSizes.TODAY) {
                render(size, { TodayWidgetContent(snap(t), nowOf(t)) }) {
                    onNode(hasTestTag("figure")).assertExists()
                    onNode(hasTestTag("age")).assertExists()
                    val rows = WidgetSizes.todayRows(size)
                    val shown = biggestMoves(t, rows * 3)
                    shown.forEach { h -> onNode(hasTestTag("mini-${h.key}")).assertExists() }
                    t.holdings.filter { h -> shown.none { it.key == h.key } }
                        .forEach { h -> onNode(hasTestTag("mini-${h.key}")).assertDoesNotExist() }
                }
            }
        }
    }

    /** 1.0.2: the mini cards are the biggest day $ moves, biggest first, in reading order, at every size. */
    @Test
    fun todayWidgetMiniCardsAreTheBiggestMovesInOrderAtEverySize() {
        val expected = mapOf(
            Fixtures.open to listOf("i13", "bullion-silver", "i2", "i3", "i1", "i10"),
            Fixtures.holiday to listOf("i13", "i1", "i2"),
            Fixtures.saturday to listOf("i13", "bullion-silver", "i1", "i2", "i12"),
        )
        for ((t, keys) in expected) {
            val anyMini = t.holdings.map { hasTestTag("mini-${it.key}") }.reduce { a, b -> a or b }
            for (size in WidgetSizes.TODAY) {
                val want = keys.take(WidgetSizes.todayRows(size) * 3)
                render(size, { TodayWidgetContent(snap(t), nowOf(t)) }) {
                    val cards = onAllNodes(anyMini)
                    cards.assertCountEquals(want.size)
                    want.forEachIndexed { i, key -> cards[i].assert(hasTestTag("mini-$key")) }
                    val n = t.holdings.size
                    val footer = if (n > want.size) "Biggest moves today · tap for all $n" else "Tap for all $n"
                    if (WidgetSizes.todayBucket(size) == WidgetSizes.TODAY_SMALL) {
                        onNode(hasText(footer)).assertDoesNotExist()
                    } else {
                        onNode(hasText(footer)).assertExists()
                    }
                }
            }
        }
    }

    /** D155: value, (day $), day % at every size, with the counts in the label row (or the age row when small). */
    @Test
    fun todayWidgetLeadsWithTheValueThenTheDayAtEverySize() {
        for (t in fixtures + Fixtures.empty) {
            for (size in WidgetSizes.TODAY) {
                render(size, { TodayWidgetContent(snap(t), nowOf(t)) }) {
                    onNode(hasTestTag("total-line")).assertExists()
                    onNode(hasTestTag("figure")).assertExists()
                    onNode(hasTestTag("day")).assertExists()
                    onNode(hasTestTag("percent")).assertExists()
                    onNode(hasTestTag("counts")).assertExists()
                }
            }
        }
        for (size in WidgetSizes.TODAY) {
            render(size, { TodayWidgetContent(snap(Fixtures.open), nowOf(Fixtures.open)) }) {
                onNode(hasTestTag("figure") and hasText("$120,630")).assertExists()
                onNode(hasTestTag("day") and hasText("(+$1,943)")).assertExists()
                onNode(hasTestTag("percent") and hasText("▲1.82%")).assertExists()
            }
            // No day figure yet: the value still leads; the day and % read "—".
            render(size, { TodayWidgetContent(snap(Fixtures.allStale), nowOf(Fixtures.allStale)) }) {
                onNode(hasTestTag("figure") and hasText("$94,720")).assertExists()
                onNode(hasTestTag("day") and hasText("(—)")).assertExists()
                onNode(hasTestTag("percent") and hasText("—")).assertExists()
            }
        }
    }

    @Test
    fun todayWidgetLabelsAndAge() {
        render(WidgetSizes.TODAY_LARGE, { TodayWidgetContent(snap(Fixtures.open), nowOf(Fixtures.open)) }) {
            onNode(hasText("TODAY · EXCL. CASH")).assertExists()
            onNode(hasText("(+$1,943)")).assertExists()
            onNode(hasText("Biggest moves today · tap for all 12")).assertExists()
            onNode(hasText("Six largest · tap for all 12")).assertDoesNotExist()
            onNode(hasText("15:15 · updated Thu 15:20")).assertExists()
            onNode(hasText("BTC")).assertExists()
        }
        render(WidgetSizes.TODAY_SMALL, { TodayWidgetContent(snap(Fixtures.allStale), nowOf(Fixtures.allStale)) }) {
            onNode(hasText("TODAY · EXCL. CASH")).assertDoesNotExist()
            onAllNodes(hasText("STALE")).assertCountEquals(3)
            onNode(hasTestTag("figure")).assertExists()
        }
        // Over an hour since the last fetch: the warning prefix (text presentation).
        render(WidgetSizes.TODAY_MEDIUM, { TodayWidgetContent(snap(Fixtures.open), Fixtures.generatedMs(Fixtures.open) + 90 * 60_000L) }) {
            onNode(hasText("⚠\uFE0E 15:15 · updated Thu 15:20")).assertExists()
        }
    }

    @Test
    fun everyWidgetShowsThePairAndUpdateFaces() {
        val now = nowOf(Fixtures.open)
        val faces = listOf(
            WidgetSnapshot(WidgetSnapshot.Status.NOT_PAIRED, null, null) to WIDGET_PAIR_TEXT,
            WidgetSnapshot(WidgetSnapshot.Status.REVOKED, null, null) to WIDGET_PAIR_TEXT,
            snap(Fixtures.open, now - 25 * 3_600_000L) to WIDGET_UPDATE_TEXT,
        )
        for ((s, text) in faces) {
            for (size in WidgetSizes.TODAY) render(size, { TodayWidgetContent(s, now) }) { onNode(hasText(text)).assertExists(); onNode(hasTestTag("figure")).assertDoesNotExist() }
            for (size in WidgetSizes.HOLDING) render(size, { HoldingWidgetContent(s, "i13", 1, now) }) { onNode(hasText(text)).assertExists() }
            for (size in WidgetSizes.BEST_WORST) render(size, { BestWorstWidgetContent(s, now) }) { onNode(hasText(text)).assertExists() }
        }
    }

    @Test
    fun emptyPortfolio() {
        val t = Fixtures.empty
        for (size in WidgetSizes.TODAY) render(size, { TodayWidgetContent(snap(t), nowOf(t)) }) { onNode(hasText("No holdings yet.")).assertExists() }
        for (size in WidgetSizes.HOLDING) render(size, { HoldingWidgetContent(snap(t), "i13", 1, nowOf(t)) }) { onNode(hasText("No longer held")).assertExists() }
        for (size in WidgetSizes.BEST_WORST) render(size, { BestWorstWidgetContent(snap(t), nowOf(t)) }) { onNode(hasText("Not enough changes yet")).assertExists() }
    }

    @Test
    fun holdingWidgetAtEverySize() {
        for (t in fixtures) {
            for (h in t.holdings) {
                for (size in WidgetSizes.HOLDING) {
                    render(size, { HoldingWidgetContent(snap(t), h.key, 1, nowOf(t)) }) {
                        onNode(hasTestTag("code")).assertExists()
                        onNode(hasTestTag("change")).assertExists()
                        onNode(hasTestTag("age")).assertExists()
                    }
                }
            }
        }
        render(WidgetSizes.HOLDING_SMALL, { HoldingWidgetContent(snap(Fixtures.open), "i1", 1, nowOf(Fixtures.open)) }) {
            onNode(hasText("ABC")).assertExists()
            onNode(hasText("▲ 1.00%")).assertExists()
            onNode(hasText("+$53")).assertExists()
            onNode(hasText("4.6%")).assertExists()
        }
        render(WidgetSizes.HOLDING_WIDE, { HoldingWidgetContent(snap(Fixtures.open), "bullion-silver", 1, nowOf(Fixtures.open)) }) {
            onNode(hasText("SILVER")).assertExists()
        }
        // A holding no longer held, and a widget not yet configured.
        for (size in WidgetSizes.HOLDING) {
            render(size, { HoldingWidgetContent(snap(Fixtures.saturday), "i3", 1, nowOf(Fixtures.saturday)) }) { onNode(hasText("No longer held")).assertExists() }
            render(size, { HoldingWidgetContent(snap(Fixtures.open), null, 1, nowOf(Fixtures.open)) }) { onNode(hasText("Tap to choose a holding")).assertExists() }
        }
    }

    @Test
    fun bestWorstAtEverySize() {
        for (size in WidgetSizes.BEST_WORST) {
            render(size, { BestWorstWidgetContent(snap(Fixtures.open), nowOf(Fixtures.open)) }) {
                onNode(hasText("BEST / WORST")).assertExists()
                onNode(hasTestTag("best")).assertExists()
                onNode(hasTestTag("worst")).assertExists()
                onNode(hasText("BTC")).assertExists()
                onNode(hasText("XYZ")).assertExists()
            }
            render(size, { BestWorstWidgetContent(snap(Fixtures.allStale), nowOf(Fixtures.allStale)) }) {
                onNode(hasText("Not enough changes yet")).assertExists()
            }
        }
    }
}
