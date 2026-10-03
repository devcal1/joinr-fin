package com.tenon.joinrfinance.model

import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.net.ApiError
import com.tenon.joinrfinance.net.MobileHoldingDto
import com.tenon.joinrfinance.widget.WidgetMode
import com.tenon.joinrfinance.widget.WidgetSnapshot
import com.tenon.joinrfinance.widget.widgetMode
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.TimeZone

class TodayModelTest {
    private val open = Fixtures.open
    private val now = Fixtures.generatedMs(open)
    private var savedZone: TimeZone? = null

    /** The phone's own zone differs from the server's: every time must still come out in the server's zone. */
    @Before
    fun phoneInAnotherZone() {
        savedZone = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))
    }

    @After
    fun restoreZone() {
        TimeZone.setDefault(savedZone)
    }

    @Test
    fun sortByDayDollarsNullsLastTiesByCode() {
        val codes = sortHoldings(open.holdings, SortOrder.DAY_CENTS).map { it.code }
        assertEquals(
            listOf("BTC", "DEF", "ABC", "0PEXAMPLE1", "MNO", "EXUS", "XYZ", "SILVER", "ETH", "EXA", "EXAMPLEFUND2", "EXB"),
            codes,
        )
    }

    @Test
    fun sortByValueAndPercent() {
        assertEquals(
            listOf("BTC", "ETH", "SILVER", "ABC", "DEF", "XYZ", "EXUS", "0PEXAMPLE1", "MNO", "EXA", "EXAMPLEFUND2", "EXB"),
            sortHoldings(open.holdings, SortOrder.VALUE).map { it.code },
        )
        val byPct = sortHoldings(open.holdings, SortOrder.DAY_RATIO).map { it.code }
        assertEquals("BTC", byPct.first())
        assertEquals(listOf("ETH", "EXA", "EXAMPLEFUND2", "EXB"), byPct.takeLast(4))
    }

    @Test
    fun sortCycles() {
        assertEquals(SortOrder.DAY_RATIO, SortOrder.DAY_CENTS.next())
        assertEquals(SortOrder.VALUE, SortOrder.DAY_RATIO.next())
        assertEquals(SortOrder.DAY_CENTS, SortOrder.VALUE.next())
    }

    @Test
    fun moversScaleToTheLargestMove() {
        val rows = moverRows(open.holdings, SortOrder.DAY_CENTS)
        assertEquals(open.totals.up + open.totals.down + open.totals.flat, rows.size)
        assertTrue(rows.all { it.holding.isOk })
        assertEquals(1f, rows.first().fraction, 0f)
        val silver = rows.first { it.holding.code == "SILVER" }
        assertEquals(-8811f / 200000f, silver.fraction, 1e-6f)
        assertEquals(0f, rows.first { it.holding.code == "MNO" }.fraction, 0f)
        assertTrue(rows.all { it.fraction in -1f..1f })
    }

    @Test
    fun moversWithNoMoveAtAll() {
        assertTrue(moverRows(Fixtures.allStale.holdings, SortOrder.DAY_CENTS).isEmpty())
    }

    @Test
    fun statusWords() {
        fun word(code: String) = statusWord(open.holdings.first { it.code == code }, open)
        assertNull(word("ABC"))
        assertEquals("DAILY PRICE · Wed 11/09", word("0PEXAMPLE1"))
        assertEquals("HAND PRICE", word("EXAMPLEFUND2"))
        assertEquals("STALE · 05/09", word("EXA"))
        assertEquals("NO CHANGE YET", word("ETH"))
        assertEquals("NO PRICE", word("EXB"))
        assertNull(word("SILVER"))
    }

    @Test
    fun cardChangeLineAndSpokenSummary() {
        val abc = open.holdings.first { it.code == "ABC" }
        assertEquals("▲${NBSP}0.50 (1.00%)", changeLine(abc))
        assertEquals("ABC, up 1.00 percent, day plus 53 dollars, weight 4.6 percent", spokenHolding(abc))
        val silver = open.holdings.first { it.code == "SILVER" }
        assertEquals("▼${NBSP}0.47 (1.02%)", changeLine(silver))
        assertTrue(spokenHolding(silver).startsWith("Silver bullion, down 1.02 percent, day minus 88 dollars, price per ounce 45.68 dollars"))
        val mno = open.holdings.first { it.code == "MNO" }
        assertEquals("0.00 (0.00%)", changeLine(mno))
        assertEquals("—", changeLine(open.holdings.first { it.code == "EXA" }))
    }

    @Test
    fun marketLineInTheServerZone() {
        assertEquals("15:15 · ASX open", marketLine(open))
        assertEquals("ASX pre-open", marketLine(Fixtures.preOpen).substringAfter(" · "))
        assertTrue(marketLine(Fixtures.saturday).endsWith("ASX closed"))
        assertEquals("ASX open", marketLine(Fixtures.empty))
    }

    @Test
    fun portfolioSummary() {
        assertEquals("Portfolio day change since 00:00, up 1.82 percent, 1,943 dollars", spokenPortfolio(open))
        assertEquals("Portfolio day change: no day figure yet", spokenPortfolio(Fixtures.empty))
    }

    @Test
    fun noticesForStaleAndOldPrices() {
        val n = todayNotices(open, now, now, null, false).map { it.text }
        assertEquals(listOf("1 price is stale (oldest 05/09 16:10)"), n)
        val later = todayNotices(open, now, now + 25 * 60_000L, null, false).map { it.text }
        assertTrue(later.contains("Prices are 30 min old."))
        // The age steps like every other age (latest price: now − 5 min).
        fun aged(minutes: Long) = todayNotices(open, now, now + (minutes - 5) * 60_000L, null, false).map { it.text }
        assertTrue(aged(25).contains("Prices are 25 min old."))
        assertTrue(aged(180).contains("Prices are 3 h old."))
        assertTrue(aged(2420).contains("Prices are 40 h old."))
        assertTrue(aged(3 * 24 * 60).contains("Prices are 3 d old."))
        val stale = todayNotices(Fixtures.allStale, now, now, null, false).map { it.text }
        assertTrue(stale.first().startsWith("4 prices are stale (oldest "))
    }

    @Test
    fun noticesForErrorsKeepTheCachedFigures() {
        val n = todayNotices(open, now, now + 2 * 3_600_000L, ApiError.Unreachable, true)
        assertEquals("Set a screen lock on this phone to protect Joinr Finance.", n[0].text)
        assertEquals("Can't reach the Umbrel — is Tailscale on?", n[1].text)
        assertTrue(n[1].retry)
        assertEquals("Figures from 15:20 (2 h ago)", n[2].text)
        // Revoked is a full screen, never a notice.
        assertTrue(todayNotices(open, now, now, ApiError.Revoked, false).none { it.retry })
    }

    @Test
    fun widgetAgeLineIsAbsoluteInTheServerZone() {
        val fresh = widgetAgeLine(open, now, now + 5 * 60_000L)
        assertEquals("15:15 · updated Thu 15:20", fresh.text)
        assertFalse(fresh.old)
        val old = widgetAgeLine(open, now, now + 61 * 60_000L)
        assertEquals("⚠\uFE0E 15:15 · updated Thu 15:20", old.text)
        assertTrue(old.old)
        val week = widgetAgeLine(open, now, now + 7 * 24 * 3_600_000L)
        assertTrue(week.text.endsWith("updated 12/09 15:20"))
    }

    @Test
    fun widgetsShowNoFiguresAfter24Hours() {
        val snap = WidgetSnapshot(WidgetSnapshot.Status.PAIRED, open, now)
        assertEquals(WidgetMode.FIGURES, widgetMode(snap, now + 23 * 3_600_000L))
        assertEquals(WidgetMode.UPDATE, widgetMode(snap, now + 25 * 3_600_000L))
        assertEquals(WidgetMode.PAIR, widgetMode(snap.copy(status = WidgetSnapshot.Status.REVOKED), now))
        assertEquals(WidgetMode.PAIR, widgetMode(WidgetSnapshot(WidgetSnapshot.Status.NOT_PAIRED, null, null), now))
        assertEquals(WidgetMode.UPDATE, widgetMode(WidgetSnapshot(WidgetSnapshot.Status.PAIRED, null, null), now))
    }

    @Test
    fun bestAndWorst() {
        val (best, worst) = bestAndWorst(open)!!
        assertEquals("BTC", best.code)
        assertEquals("XYZ", worst.code)
        assertNull(bestAndWorst(Fixtures.allStale))
        assertNull(bestAndWorst(Fixtures.empty))
    }

    @Test
    fun sessionTexts() {
        fun s(code: String) = sessionText(open.holdings.first { it.code == code }, open)
        assertEquals("Daily price, 11/09", s("0PEXAMPLE1"))
        assertEquals("Since 00:00", s("BTC"))
        assertEquals("Since 00:00", s("SILVER"))
        assertTrue(s("ABC").matches(Regex("\\d\\d:\\d\\d–\\d\\d:\\d\\d, Thu 12/09")))
    }

    // ─── 1.0.2: the Today widget's mini cards are the biggest day $ moves ───

    /** A made-up holding from the fixture's first row: code, value and day $ only matter here. */
    private fun h(code: String, value: Long?, day: Long?) =
        open.holdings.first().copy(key = "k-$code", code = code, valueCents = value, dayCents = day)

    private fun movesOf(vararg hs: MobileHoldingDto) = biggestMoves(open.copy(holdings = hs.toList()), 6).map { it.code }

    @Test
    fun biggestMovesForTheWidgetFromTheFixtures() {
        // |day $|: BTC 2,000.00, SILVER −88.11, XYZ −80.00, DEF 60.00, ABC 53.00, EXUS −17.31; then 0PEXAMPLE1, MNO (0).
        assertEquals(listOf("BTC", "SILVER", "XYZ", "DEF", "ABC", "EXUS"), biggestMoves(open, 6).map { it.code })
        assertEquals(listOf("BTC", "SILVER", "XYZ"), biggestMoves(open, 3).map { it.code })
        // A tie on |day $| (ABC +20.00, XYZ −20.00): the larger value first.
        assertEquals(listOf("BTC", "ABC", "XYZ"), biggestMoves(Fixtures.holiday, 6).map { it.code })
        // Four with a figure, then the rest by value.
        assertEquals(listOf("BTC", "SILVER", "ABC", "XYZ", "EXAMPLEFUND2"), biggestMoves(Fixtures.saturday, 6).map { it.code })
        // A zero move is still a figure, ahead of none; nothing has a figure → by value, as before.
        assertEquals(listOf("ABC", "XYZ", "DEF"), biggestMoves(Fixtures.preOpen, 6).map { it.code })
        assertEquals(listOf("BTC", "SILVER", "ABC", "XYZ"), biggestMoves(Fixtures.allStale, 6).map { it.code })
        assertEquals(emptyList<String>(), biggestMoves(Fixtures.empty, 6).map { it.code })
    }

    @Test
    fun biggestMovesMixSignsByAbsoluteSize() {
        assertEquals(
            listOf("D", "A", "C", "B"),
            movesOf(h("A", 100, 500), h("B", 900, -100), h("C", 50, 300), h("D", 10, -700)),
        )
    }

    @Test
    fun biggestMovesBreakTiesByValueThenCode() {
        assertEquals(
            listOf("B", "A", "C", "D", "E"),
            // A, B and C move 4.00 either way: value desc (B, then A and C equal → code); D's null value goes last of the tie.
            movesOf(h("C", 200, 400), h("A", 200, -400), h("B", 900, 400), h("D", null, -400), h("E", 999_999, 1)),
        )
    }

    @Test
    fun aHoldingWithNoDayFigureNeverComesFirst() {
        // The largest holding by far has no figure (stale); even a zero move comes before it.
        assertEquals(
            listOf("A", "Z", "BIG", "U"),
            movesOf(h("BIG", 9_000_000, null), h("A", 100, -5), h("Z", 50, 0), h("U", null, null)),
        )
        // More than six with a figure: the ones without never show.
        val many = (1..7).map { h("M$it", 100L * it, -10L * it) } + h("BIG", 9_000_000, null)
        assertEquals(listOf("M7", "M6", "M5", "M4", "M3", "M2"), biggestMoves(open.copy(holdings = many), 6).map { it.code })
    }

    @Test
    fun fewerThanSixWithAFigureFillByValue() {
        assertEquals(
            listOf("S", "T", "V2", "V1", "V3", "V4"),
            movesOf(h("V1", 5_000, null), h("S", 10, 30), h("V3", 4_000, null), h("T", 20, -20), h("V2", 6_000, null), h("N", null, null), h("V4", 1, null)),
        )
    }

    @Test
    fun aDayFigureThatRoundsToZeroDollarsIsNotTinted() {
        val h = open.holdings.first { it.isOk && it.dayCents != null }.copy(dayCents = 47)
        assertEquals("0", Format.dayShort(h.dayCents))
        assertEquals(Tone.FLAT, dayDollarsTone(h))
        assertEquals(Tone.GAIN, dayDollarsTone(h.copy(dayCents = 50)))
        assertEquals(Tone.LOSS, dayDollarsTone(h.copy(dayCents = -50)))
        assertEquals(Tone.FLAT, dayDollarsTone(h.copy(dayCents = -49)))
    }

    // ─── D155: value, invested, gain ───

    @Test
    fun investedAndGainWhenEveryCostIsKnown() {
        val t = investedTotals(Fixtures.holiday)
        assertEquals(9_023_000L, t.valueCents)
        assertEquals(5_310_000L, t.investedCents)
        assertEquals(3_713_000L, t.gainCents)
        assertEquals("▲69.92%", Format.arrowPercent(t.gainRatio, space = false))
        assertEquals("+$37,130", Format.dayMoney(t.gainCents))
        assertNull(investedUnknownReason(t))
        assertNull(gainUnknownReason(t))
        assertEquals("Value 90,230 dollars, invested 53,100 dollars, gain plus 37,130 dollars, up 69.92 percent", spokenInvested(t))
        // A loss: sign, arrow and the real minus.
        val loss = investedTotals(Fixtures.holiday.let { it.copy(totals = it.totals.copy(valueCents = 5_000_000L)) })
        assertEquals(-310_000L, loss.gainCents)
        assertEquals("${Format.MINUS}$3,100", Format.dayMoney(loss.gainCents))
        assertEquals("▼5.84%", Format.arrowPercent(loss.gainRatio, space = false))
        assertTrue(spokenInvested(loss).endsWith("gain minus 3,100 dollars, down 5.84 percent"))
    }

    @Test
    fun oneUnknownCostMakesInvestedAndGainUnknownNeverAPartialSum() {
        val base = Fixtures.holiday
        val holdings = base.holdings.toMutableList()
        holdings[1] = holdings[1].copy(position = holdings[1].position.copy(costCents = null))
        val t = investedTotals(base.copy(holdings = holdings))
        assertNull(t.investedCents)
        assertNull(t.gainCents)
        assertNull(t.gainRatio)
        assertEquals(1, t.unknownCost)
        assertEquals("1 holding has no cost base", investedUnknownReason(t))
        assertEquals("Value 90,230 dollars, invested unknown, 1 holding has no cost base, gain unknown", spokenInvested(t))
        assertEquals("—", Format.valueWhole(t.investedCents))
    }

    @Test
    fun anUnpricedHoldingKeepsInvestedButMakesTheGainUnknown() {
        // The open fixture's EXB has a cost but no price: its cost is in the invested total, not in the value.
        val t = investedTotals(open)
        assertEquals(7_642_700L, t.investedCents)
        assertNull(t.gainCents)
        assertEquals(1, t.unpriced)
        assertEquals("1 holding has no price", gainUnknownReason(t))
        assertEquals("Value 120,630 dollars, invested 76,427 dollars, gain unknown, 1 holding has no price", spokenInvested(t))
    }

    @Test
    fun zeroInvestedHasAGainButNoPercent() {
        val empty = investedTotals(Fixtures.empty)
        assertEquals(0L, empty.investedCents)
        assertEquals(0L, empty.gainCents)
        assertNull(empty.gainRatio)
        assertEquals("Value 0 dollars, invested 0 dollars, gain 0 dollars", spokenInvested(empty))
        val base = Fixtures.holiday
        val free = investedTotals(base.copy(holdings = base.holdings.map { it.copy(position = it.position.copy(costCents = 0L)) }))
        assertEquals(0L, free.investedCents)
        assertEquals(9_023_000L, free.gainCents)
        assertNull(free.gainRatio)
    }
}
