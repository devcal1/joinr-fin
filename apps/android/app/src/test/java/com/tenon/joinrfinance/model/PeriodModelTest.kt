package com.tenon.joinrfinance.model

import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.PeriodFixtures
import com.tenon.joinrfinance.net.ApiError
import com.tenon.joinrfinance.net.MobilePeriodFigureDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

/** The pure period rules of the app (Stage 10 plan sections 9.2–9.6) over the `mobilePeriods` fixtures. */
class PeriodModelTest {
    private val open = PeriodFixtures.open
    private val w1 = open.periodOf(Period.ONE_WEEK)!!
    private val all = open.periodOf(Period.ALL)!!

    @Test
    fun theEightPeriodsAndTheirKeys() {
        assertEquals(listOf("1D", "1W", "2W", "1M", "3M", "6M", "12M", "ALL"), Period.entries.map { it.chip })
        assertEquals(listOf("TODAY", "1 WEEK", "2 WEEKS", "1 MONTH", "3 MONTHS", "6 MONTHS", "12 MONTHS", "ALL TIME"), Period.entries.map { it.label })
        assertEquals("1 week", Period.ONE_WEEK.spoken)
        assertEquals(Period.TWELVE_MONTHS, Period.ofKey("12M"))
        assertNull(Period.ofKey("5Y"))
        // Every server period of the answer maps to a chip, in order; 1D is never in the answer.
        assertEquals(Period.entries.drop(1).map { it.key }, open.periods.map { it.period })
        assertNull(open.periodOf(Period.ONE_DAY))
    }

    @Test
    fun figureAccessorsFollowTheHoldingsOrder() {
        val rows = periodRows(open, w1)
        assertEquals(open.holdings.map { it.key }, rows.map { it.key })
        assertEquals(434100L, rows.first { it.key == "i13" }.cents)
        // A no_start figure with cents (D165/D166): its bought-in part counts.
        assertEquals(500L, rows.first { it.key == "i12" }.cents)
        assertNull(rows.first { it.key == "i2" }.cents)
        assertNull(rows.first { it.key == "i16" }.cents)
        // The Sold figure is never a holding's row.
        assertNull(all.figureOf("sold"))
        assertEquals(58000L, all.soldFigure()!!.cents)
        assertNull(w1.soldFigure())
    }

    @Test
    fun thePeriodSortKeepsSortOrder() {
        val rows = periodRows(open, w1)
        assertEquals(
            listOf("BTC", "SILVER", "MNO", "ABC", "EXUS", "0PEXAMPLE1", "EXA", "EXAMPLEFUND2", "DEF", "ETH", "EXB", "XYZ"),
            sortPeriodRows(rows, SortOrder.DAY_CENTS).map { it.code },
        )
        val byRatio = sortPeriodRows(rows, SortOrder.DAY_RATIO)
        assertEquals(listOf("EXB", "XYZ"), byRatio.takeLast(2).map { it.code })
        val ratios = byRatio.mapNotNull { it.ratio }
        assertEquals(ratios.sortedDescending(), ratios)
        assertEquals("BTC", sortPeriodRows(rows, SortOrder.VALUE).first().code)
        assertEquals("1W $", sortLabel(SortOrder.DAY_CENTS, Period.ONE_WEEK))
        assertEquals("1W %", sortLabel(SortOrder.DAY_RATIO, Period.ONE_WEEK))
        assertEquals("ALL $", sortLabel(SortOrder.DAY_CENTS, Period.ALL))
        assertEquals("VALUE", sortLabel(SortOrder.VALUE, Period.ALL))
        assertEquals("DAY $", sortLabel(SortOrder.DAY_CENTS, Period.ONE_DAY))
        assertEquals("1 week percent", sortSpoken(SortOrder.DAY_RATIO, Period.ONE_WEEK))
    }

    @Test
    fun moverRowsCarryEveryFigureWithCentsAndTheSoldRowLast() {
        val m = periodMoverRows(periodRows(open, w1), w1, SortOrder.DAY_CENTS)
        assertEquals(10, m.size)
        assertEquals(1f, m.first().fraction)
        assertTrue(m.any { it.key == "i12" })
        assertTrue(m.none { it.sold != null })
        val a = periodMoverRows(periodRows(open, all), all, SortOrder.DAY_CENTS)
        assertEquals("sold", a.last().key)
        assertEquals("SOLD", a.last().code)
        assertEquals(58000L, a.last().cents)
        assertEquals(12, a.size)
        assertEquals("No figure for 1W: 3", noFigureText(w1, Period.ONE_WEEK))
    }

    @Test
    fun totalsLabelsAndThePartialText() {
        assertEquals("Partial: 3 holdings have no figure for 1W.", partialText(w1, Period.ONE_WEEK))
        assertEquals("Partial: 1 holding has no figure for ALL.", partialText(all, Period.ALL))
        assertNull(partialText(w1.copy(totals = w1.totals.copy(partial = false)), Period.ONE_WEEK))
        assertEquals("Since 05/09/2030", sinceText(w1, Period.ONE_WEEK))
        assertEquals("Since 12/09/2029", sinceText(open.periodOf(Period.TWELVE_MONTHS)!!, Period.TWELVE_MONTHS))
        assertEquals("Since 01/02/2029", sinceText(all, Period.ALL))
        assertNull(sinceText(PeriodFixtures.soldOnly.periodOf(Period.ALL)!!, Period.ALL))
        assertEquals("1 week, plus 4,651 dollars, up 4.18 percent", spokenPeriodFigure(w1, Period.ONE_WEEK))
    }

    @Test
    fun theChangeLineVariants() {
        val nb = NBSP
        assertEquals("▲${nb}8,682 (5.59%)", periodChangeLine(w1.figureOf("i13"), Period.ONE_WEEK))
        assertEquals("BOUGHT${nb}IN${nb}1W ▲${nb}11.11%", periodChangeLine(w1.figureOf("i4"), Period.ONE_WEEK))
        assertEquals("BOUGHT${nb}IN${nb}1W ▲${nb}2.56% ·${nb}PARTIAL", periodChangeLine(w1.figureOf("i12"), Period.ONE_WEEK))
        assertEquals(Format.DASH, periodChangeLine(w1.figureOf("i2"), Period.ONE_WEEK))
        assertEquals(Format.DASH, periodChangeLine(w1.figureOf("i16"), Period.ONE_WEEK))
        assertEquals("▲${nb}11.06% ALL${nb}TIME", periodChangeLine(all.figureOf("i1"), Period.ALL))
        assertEquals(Format.DASH, periodChangeLine(all.figureOf("i16"), Period.ALL))
        // A loss over the period.
        assertTrue(periodChangeLine(w1.figureOf("i14"), Period.ONE_WEEK).startsWith(Format.DOWN))
    }

    @Test
    fun theChangeLineWrapsBetweenGroupsOnly() {
        val nb = NBSP
        // The only ordinary spaces separate the groups, so a narrow card never splits ALL from TIME, BOUGHT IN 1W, the
        // arrowed percentage, or the PARTIAL marker from its dot.
        assertEquals(listOf("▲${nb}11.06%", "ALL${nb}TIME"), periodChangeLine(all.figureOf("i1"), Period.ALL).split(" "))
        for (p in Period.entries.filter { it != Period.ONE_DAY && it != Period.ALL }) {
            val d = open.periodOf(p)!!
            assertEquals(listOf("BOUGHT${nb}IN${nb}${p.chip}", "▲${nb}2.56%", "·${nb}PARTIAL"), periodChangeLine(d.figureOf("i12"), p).split(" "))
        }
        assertEquals(listOf("BOUGHT${nb}IN${nb}1W", "▲${nb}11.11%"), periodChangeLine(w1.figureOf("i4"), Period.ONE_WEEK).split(" "))
    }

    @Test
    fun statusWordsAndThePriceWordsUnderAPeriod() {
        fun word(key: String, period: Period = Period.ONE_WEEK) =
            periodCardWord(open.holdings.first { it.key == key }, open.periodOf(period)!!.figureOf(key), open)
        assertEquals(WORD_SPLIT, word("i2"))
        assertEquals(WORD_NO_PRICE, word("i16"))
        assertEquals(WORD_NO_HISTORY, word("i12"))
        assertEquals("STALE · 05/09", word("i15"))
        assertEquals("HAND PRICE", word("i12", Period.ALL))
        assertNull(word("i13"))
        val noCost = PeriodFixtures.withNoCost()
        assertEquals(WORD_NO_COST, periodCardWord(noCost.holdings.first { it.key == "bullion-silver" }, noCost.periodOf(Period.ALL)!!.figureOf("bullion-silver"), noCost))
        assertEquals(WORD_NO_HISTORY, periodStatusWord(MobilePeriodFigureDto(key = "x", status = "no_start")))
    }

    @Test
    fun theSoldRowTexts() {
        val f = all.soldFigure()!!
        assertEquals("Sold holdings: +$580 · 2 sold", soldLineText(f))
        assertEquals("Sold holdings, 2 instruments, all-time gain plus 580 dollars, up 11.58 percent", spokenSold(f))
    }

    @Test
    fun theAllLineEndsAtTheUnrealisedGainAndItsCaption() {
        // D167: the ALL line is today's holdings only; its last point is totals.unrealisedCents, not the ALL figure.
        assertEquals(all.totals.unrealisedCents, periodLineValues(all).last())
        assertEquals(all.totals.cents, all.totals.unrealisedCents!! + all.totals.realisedCents!!)
        assertEquals("Line: today's holdings, unrealised · realised +$980 not drawn", allLineCaption(all))
        val noRealised = all.copy(totals = all.totals.copy(realisedCents = 0))
        assertEquals("Line: today's holdings, unrealised", allLineCaption(noRealised))
        // 1W–12M: the last point is the total.
        for (p in Period.entries.drop(1).dropLast(1)) {
            val d = open.periodOf(p)!!
            assertEquals(p.chip, d.totals.cents, periodLineValues(d).last())
        }
    }

    @Test
    fun spokenLines() {
        assertEquals(
            "Change over 1 week since Thursday 5 September, up 4.18 percent, 4,651 dollars; partial, 3 holdings have no figure",
            spokenPeriodLine(w1, Period.ONE_WEEK),
        )
        assertEquals(
            "All-time line of today's holdings, unrealised gain, ending up 44,503 dollars; realised gains of 980 dollars are in the all-time total but not in the line",
            spokenPeriodLine(all, Period.ALL),
        )
    }

    @Test
    fun theLineLabelsUseThePointsNotTime() {
        assertEquals(Triple("05/09", "08/09", "Today"), lineLabels(w1.line!!.points.map { it.first }, Period.ONE_WEEK))
        // An uneven grid (a weekend without crypto): the middle label is points[size / 2]'s date, not the time midpoint.
        assertEquals(Triple("05/09", "09/09", "Today"), lineLabels(listOf("2030-09-05", "2030-09-06", "2030-09-09", "2030-09-10", "2030-09-12"), Period.ONE_WEEK))
        assertEquals(Triple("01/02/2029", all.line!!.points[all.line!!.points.size / 2].first.let { periodDateDmy(it) }, "Today"), lineLabels(all.line!!.points.map { it.first }, Period.ALL))
        assertNull(lineLabels(emptyList(), Period.ONE_WEEK))
    }

    @Test
    fun theHeaderRowUnderEveryPeriod() {
        // D168: VAL · INVESTED · GAIN under every period, ALL included; VAL from the periods answer, GAIN = VAL − INVESTED.
        val today = Fixtures.priced()
        val answer = open.copy(holdings = open.holdings.filter { it.valueCents != null })
        val t = periodInvestedTotals(today, answer)
        val invested = investedTotals(today).investedCents!!
        assertEquals(answer.valueCents, t.valueCents)
        assertEquals(invested, t.investedCents)
        assertEquals(answer.valueCents - invested, t.gainCents)
        // Under ALL the GAIN is not the big ALL figure (that adds the realised gains and the Sold holdings).
        assertTrue(t.gainCents != all.totals.cents)
        // The D155 "—" rules: an unpriced holding → GAIN unknown; an unknown cost → INVESTED and GAIN unknown.
        val withUnpriced = periodInvestedTotals(Fixtures.open, open)
        assertNull(withUnpriced.gainCents)
        assertEquals(1, withUnpriced.unpriced)
        val h = today.holdings.toMutableList()
        h[0] = h[0].copy(position = h[0].position.copy(costCents = null))
        val unknownCost = periodInvestedTotals(today.copy(holdings = h), answer)
        assertNull(unknownCost.investedCents)
        assertNull(unknownCost.gainCents)
        assertEquals("Value 120,630 dollars, invested unknown, 1 holding has no cost base, gain unknown", spokenInvested(unknownCost))
    }

    @Test
    fun thePriceHistoryNote() {
        assertNull(staleHistoryText(open))
        assertNull(staleHistoryText(open.copy(closesThrough = "2030-09-06")))
        assertEquals("Price history to 05/09.", staleHistoryText(open.copy(closesThrough = "2030-09-05")))
        assertNull(staleHistoryText(PeriodFixtures.noHistory))
    }

    @Test
    fun bodiesByPeriod() {
        assertEquals(PeriodBody.FULL, periodBody(open, Period.ONE_WEEK, null))
        assertEquals(PeriodBody.LOADING, periodBody(null, Period.ONE_WEEK, null))
        assertEquals(PeriodBody.UNAVAILABLE, periodBody(null, Period.ONE_WEEK, ApiError.ServerTooOld))
        for (p in Period.entries.drop(1)) assertEquals(PeriodBody.EMPTY, periodBody(PeriodFixtures.empty, p, null))
        assertEquals(PeriodBody.FULL, periodBody(PeriodFixtures.soldOnly, Period.ALL, null))
        assertEquals(PeriodBody.NOTHING_HELD, periodBody(PeriodFixtures.soldOnly, Period.ONE_WEEK, null))
    }

    @Test
    fun whenTheAnswerIsFetched() {
        val now = 1_915_401_600_000L
        assertTrue(periodsStale(null, null, now))
        assertTrue(periodsStale(now - PERIODS_MAX_AGE_MS - 1, null, now))
        assertFalse(periodsStale(now - 60_000, null, now))
        assertTrue("older than the last Today", periodsStale(now - 60_000, now - 30_000, now))
        assertFalse(periodsStale(now - 30_000, now - 60_000, now))
        assertTrue(periodsWarmNeeded(null, now))
        assertTrue(periodsWarmNeeded(now - PERIODS_MAX_AGE_MS - 1, now))
        assertFalse(periodsWarmNeeded(now - 60_000, now))
    }

    @Test
    fun noticesUnderAPeriod() {
        val today = Fixtures.open
        val now = Fixtures.generatedMs(today)
        // A 404 on /periods: only the 1.3.0 line, never the Stage 9 "1.2.0" sentence.
        val tooOld = periodNotices(today, null, null, null, ApiError.ServerTooOld, now, false)
        assertTrue(tooOld.any { it.text == PERIODS_TOO_OLD_TEXT })
        assertTrue(tooOld.none { it.text == ApiError.ServerTooOld.sentence })
        // Another error with a cached answer: one line with Retry and the answer's age.
        val fetched = now - 2 * 3_600_000L
        val failed = periodNotices(today, null, open, fetched, ApiError.Unreachable, now, false)
        assertTrue(failed.any { it.text == PERIODS_FAILED_TEXT && it.retry })
        assertTrue(failed.any { it.text == "Figures from 13:20 (2 h ago)" })
        assertTrue(failed.none { it.text == ApiError.Unreachable.sentence })
        // Today's own error: its notice, with "Figures from …" following the periods answer.
        val offline = periodNotices(today, ApiError.Unreachable, open, fetched, ApiError.Unreachable, now, false)
        assertTrue(offline.any { it.text == ApiError.Unreachable.sentence })
        assertTrue(offline.any { it.text == "Figures from 13:20 (2 h ago)" })
        assertTrue(offline.none { it.text == PERIODS_FAILED_TEXT })
    }

    @Test
    fun dimmingByPeriod() {
        // Under 1D the periods state never dims (a /periods 404 under 1D is silent).
        assertEquals(1f, screenDim(Period.ONE_DAY, true, null, false, false, ApiError.ServerTooOld, false))
        assertEquals(1f, screenDim(Period.ONE_DAY, true, null, false, true, ApiError.Unreachable, true))
        assertEquals(0.6f, screenDim(Period.ONE_DAY, true, ApiError.Unreachable, false, false, null, false))
        assertEquals(0.6f, screenDim(Period.ONE_WEEK, true, null, false, true, ApiError.Unreachable, false))
        assertEquals(0.8f, screenDim(Period.ONE_WEEK, true, null, false, true, null, true))
        assertEquals(1f, screenDim(Period.ONE_WEEK, true, null, false, false, null, true))
    }

    @Test
    fun theDetailRowsUnderAPeriod() {
        val today = Fixtures.open
        val abc = open.holdings.first { it.key == "i1" }
        val w = periodDetailRows(open, today, abc, Period.ONE_WEEK).toMap()
        assertTrue(w.keys.containsAll(listOf("1W change", "Start close", "Change per unit", "Held at start", "Bought in 1W", "Units", "Value", "Weight", "Cost", "Unrealised gain", "Average price", "Price as at")))
        assertTrue(w.keys.none { it.startsWith("Day") || it == "Previous close" || it == "Session" })
        val f = w1.figureOf("i1")!!
        assertEquals(Format.signedMoneyCents(f.cents) + " (" + Format.arrowPercent(BigDecimal(f.ratio)) + ")", w["1W change"])
        assertEquals(Format.price(BigDecimal(f.startClose)) + " · " + periodDateDmy(f.startCloseDate), w["Start close"])
        val a = periodDetailRows(open, today, abc, Period.ALL)
        val keys = a.map { it.first }
        assertTrue(keys.containsAll(listOf("Unrealised", "Realised", "All-time gain", "Cost of everything bought")))
        // No duplicate unrealised row under ALL (the position's "Unrealised gain" is dropped).
        assertFalse(keys.contains("Unrealised gain"))
        assertEquals("$5,002.00", a.toMap()["Cost of everything bought"])
        // A split holding says why it has no figure.
        val xyz = open.holdings.first { it.key == "i2" }
        assertEquals("— · SPLIT", periodDetailRows(open, today, xyz, Period.ONE_WEEK).toMap()["1W change"])
    }

    @Test
    fun aFigureThatRoundsToZeroDollarsKeepsItsSignOnTheCardButNotOnItsDollars() {
        // Phase B: a coin up 40 cents showed a grey "▲ 0.97 (0.85%)" on its card; the 1D card tints by the raw sign.
        assertEquals(Tone.GAIN, periodMarkTone(40))
        assertEquals(Tone.LOSS, periodMarkTone(-40))
        assertEquals(Tone.FLAT, periodMarkTone(0))
        assertEquals(Tone.NONE, periodMarkTone(null))
        assertEquals(Tone.FLAT, periodTone(40))
        assertEquals(Tone.GAIN, periodTone(50))
    }
}
