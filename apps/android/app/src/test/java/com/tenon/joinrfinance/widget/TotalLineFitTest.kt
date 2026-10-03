package com.tenon.joinrfinance.widget

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.model.Format
import com.tenon.joinrfinance.net.MobileTodayResponse
import com.tenon.joinrfinance.net.TotalsDto
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * D155: the Today widget's lead line fits every declared size, at font scale 1.0 and 1.3, measured with the real
 * monospace face (`GraphicsMode.NATIVE`): the step it picks always fits, and it never needs the unfitted fallback.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TotalLineFitTest {
    private val ctx: Context get() = ApplicationProvider.getApplicationContext()

    @After
    fun resetFontScale() = RuntimeEnvironment.setFontScale(1f)

    /** A made-up worst case: an eight-digit value, a six-digit day loss and a two-digit day %. */
    private val extreme: MobileTodayResponse = Fixtures.open.let {
        it.copy(totals = it.totals.copy(valueCents = 1_234_567_890L, dayCents = -12_345_678L, dayRatio = "-0.0909090909"))
    }

    private val all: List<MobileTodayResponse> =
        listOf(Fixtures.open, Fixtures.saturday, Fixtures.allStale, Fixtures.holiday, Fixtures.preOpen, Fixtures.empty, Fixtures.wideFigures(), extreme)

    @Test
    fun theMeasureUsesARealMonospaceFace() {
        val m = TotalLineFit.paintMeasure(ctx)
        val w = m("0000000000", 10f, false)
        assertTrue("ten digits at 10 sp measure $w dp", w in 50f..70f)
        assertEquals(m("1111111111", 10f, false), w, 0.01f) // monospaced
    }

    @Test
    fun everySizeAndFontScaleFitsWithoutTheFallback() {
        for (scale in listOf(1f, 1.3f)) {
            RuntimeEnvironment.setFontScale(scale)
            val measure = TotalLineFit.paintMeasure(ctx)
            for (t in all) {
                for (size in WidgetSizes.TODAY) {
                    val bucket = WidgetSizes.todayBucket(size)
                    val line = TotalLineFit.fit(t.totals, TotalLineFit.maxValueSp(bucket), TotalLineFit.availableDp(size), measure)
                    val width = TotalLineFit.width(Triple(line.value, line.day, line.percent), line.valueSp, line.restSp, measure)
                    val limit = TotalLineFit.availableDp(size) - TotalLineFit.SLACK_DP
                    val what = "${line.value} ${line.day} ${line.percent} at ${line.valueSp}/${line.restSp} sp, scale $scale, $size"
                    assertTrue("$what: $width dp > $limit dp", width <= limit)
                    assertTrue("$what: the value never outgrows its bucket", line.valueSp <= TotalLineFit.maxValueSp(bucket))
                }
            }
        }
    }

    @Test
    fun ordinaryFiguresStayFullAtFontScale1() {
        val measure = TotalLineFit.paintMeasure(ctx)
        val wide = Fixtures.wideFigures()
        for (t in all - extreme) {
            for (size in WidgetSizes.TODAY) {
                val line = TotalLineFit.fit(t.totals, TotalLineFit.maxValueSp(WidgetSizes.todayBucket(size)), TotalLineFit.availableDp(size), measure)
                println("D155 fit: ${line.value} ${line.day} ${line.percent} at ${line.valueSp}/${line.restSp} sp, $size")
                assertFalse("${t.totals.valueCents} at $size", line.compact)
                // A six-digit value keeps a large lead figure; the seven-digit made-up one may step down to 16 sp.
                if (t.totals.valueCents != wide.totals.valueCents) assertTrue("${line.value} at ${line.valueSp} sp", line.valueSp >= 18)
            }
        }
    }

    @Test
    fun theExtremeCaseAbbreviatesRatherThanClips() {
        RuntimeEnvironment.setFontScale(1.3f)
        val line = TotalLineFit.fit(extreme.totals, 20, TotalLineFit.availableDp(WidgetSizes.TODAY_SMALL), TotalLineFit.paintMeasure(ctx))
        assertTrue(line.compact)
        assertEquals("$12.35M", line.value)
        assertEquals("(${Format.MINUS}$123k)", line.day)
        assertEquals("▼9.09%", line.percent)
    }

    /** The fit itself, with a fixed 0.6 em per character (no font): the largest step that fits wins. */
    @Test
    fun theLargestFittingStepWins() {
        val mono: (String, Float, Boolean) -> Float = { s, sp, _ -> s.length * sp * 0.6f }
        val totals = TotalsDto(valueCents = 12_062_996L, dayCents = 194_258L, dayRatio = "0.0182286549599")
        // "$120,630" 8 ch, "(+$1,943)" 9 ch, "▲1.82%" 6 ch, two 6 dp gaps.
        val wide = TotalLineFit.fit(totals, 24, 400f, mono)
        assertEquals(24 to 13, wide.valueSp to wide.restSp)
        val at226 = TotalLineFit.fit(totals, 24, 226f, mono)
        // Limit 226 − 6 = 220: 24/13 is 115.2 + 117 + 12 = 244.2; 22/13 234.6; 20/13 225; 20/12 96 + 108 + 12 = 216 fits.
        assertEquals(20 to 12, at226.valueSp to at226.restSp)
        assertEquals(Triple("$120,630", "(+$1,943)", "▲1.82%"), Triple(at226.value, at226.day, at226.percent))
        val narrow = TotalLineFit.fit(totals, 24, 150f, mono)
        assertTrue(narrow.compact)
        assertEquals("$121k", narrow.value)
    }
}
