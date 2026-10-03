package com.tenon.joinrfinance.model

import com.tenon.joinrfinance.widget.WidgetSizes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SparkTest {
    @Test
    fun baseIsInsideTheRangeEvenWhenAllPointsAreAboveIt() {
        val g = Spark.geometry(longArrayOf(0, 1, 2), doubleArrayOf(10.0, 11.0, 12.0), base = 5.0, width = 100f, height = 40f, pad = 3f)
        assertEquals(37f, g.baseY!!, 1e-4f) // the base is the minimum: the bottom of the usable band
        assertEquals(3f, g.ys[2], 1e-4f) // the top
        assertTrue(g.ys.all { it in 3f..37f })
        assertEquals(0f, g.xs[0], 0f)
        assertEquals(100f, g.xs[2], 0f)
    }

    @Test
    fun onePointIsAFlatLineAcrossTheWidth() {
        val g = Spark.geometry(longArrayOf(10), doubleArrayOf(5.0), base = 5.0, width = 80f, height = 28f, pad = 2f)
        assertEquals(2, g.size)
        assertEquals(0f, g.xs[0], 0f)
        assertEquals(80f, g.xs[1], 0f)
        assertEquals(g.ys[0], g.ys[1], 0f)
        assertEquals(14f, g.ys[0], 1e-4f)
    }

    @Test
    fun aFlatLineSitsInTheMiddle() {
        val g = Spark.geometry(longArrayOf(0, 5, 9), doubleArrayOf(7.0, 7.0, 7.0), base = 7.0, width = 90f, height = 40f, pad = 3f)
        assertTrue(g.ys.all { it == 20f })
        assertEquals(20f, g.baseY!!, 0f)
    }

    @Test
    fun aWindowPlacesPointsByTime() {
        val g = Spark.geometry(longArrayOf(50, 100), doubleArrayOf(1.0, 2.0), base = 0.0, width = 100f, height = 10f, pad = 0f, from = 0, to = 100)
        assertEquals(50f, g.xs[0], 1e-4f)
        assertEquals(100f, g.xs[1], 1e-4f)
        assertEquals(1, Spark.nearestIndex(g, 90f))
        assertEquals(0, Spark.nearestIndex(g, 10f))
    }

    @Test
    fun emptyInputDrawsNothing() {
        assertEquals(0, Spark.geometry(LongArray(0), DoubleArray(0), 1.0, 10f, 10f, 1f).size)
    }

    /** Plan section 9.9: every declared size's bitmaps together stay within 400 KB, at a 2× density cap, RGB_565. */
    @Test
    fun widgetBitmapBudget() {
        for (density in listOf(1f, 2f, 2.75f, 3.5f)) {
            val today = WidgetSizes.bitmapBytes("today", WidgetSizes.TODAY, density)
            val holding = WidgetSizes.bitmapBytes("holding", WidgetSizes.HOLDING, density)
            val best = WidgetSizes.bitmapBytes("best", WidgetSizes.BEST_WORST, density)
            assertTrue("today $today", today <= WidgetSizes.BITMAP_BUDGET_BYTES)
            assertTrue("holding $holding", holding <= WidgetSizes.BITMAP_BUDGET_BYTES)
            assertEquals(0L, best)
        }
        // The cap: a 3.5× phone costs what a 2× phone costs.
        assertEquals(WidgetSizes.bitmapBytes("today", WidgetSizes.TODAY, 2f), WidgetSizes.bitmapBytes("today", WidgetSizes.TODAY, 3.5f))
        assertTrue(WidgetSizes.TODAY.size <= 3 && WidgetSizes.HOLDING.size <= 2 && WidgetSizes.BEST_WORST.size <= 2)
    }
}
