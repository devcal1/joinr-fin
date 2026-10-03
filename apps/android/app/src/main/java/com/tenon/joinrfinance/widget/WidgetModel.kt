package com.tenon.joinrfinance.widget

import android.content.Context
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import com.tenon.joinrfinance.Services
import com.tenon.joinrfinance.model.Format
import com.tenon.joinrfinance.model.WIDGET_FIGURES_MAX_AGE_MS
import com.tenon.joinrfinance.net.MobileTodayResponse
import com.tenon.joinrfinance.net.TotalsDto
import com.tenon.joinrfinance.net.decOrNull

/** What a widget renders from: the pairing state, the cached Today answer and the phone's fetch time. */
data class WidgetSnapshot(val status: Status, val today: MobileTodayResponse?, val fetchedAtMs: Long?) {
    enum class Status { PAIRED, NOT_PAIRED, REVOKED }

    companion object {
        suspend fun load(context: Context): WidgetSnapshot {
            val repo = Services.get(context).repository
            val d = repo.load().let { repo.data.value }
            val status = when {
                d.pairing != null -> Status.PAIRED
                d.revoked -> Status.REVOKED
                else -> Status.NOT_PAIRED
            }
            return WidgetSnapshot(status, if (d.pairing != null) d.today else null, if (d.pairing != null) d.fetchedAtMs else null)
        }
    }
}

/** Which face a widget shows (plan section 9.9). */
enum class WidgetMode { PAIR, UPDATE, FIGURES }

fun widgetMode(snapshot: WidgetSnapshot, nowMs: Long): WidgetMode = when {
    snapshot.status != WidgetSnapshot.Status.PAIRED -> WidgetMode.PAIR
    snapshot.today == null || snapshot.fetchedAtMs == null -> WidgetMode.UPDATE
    nowMs - snapshot.fetchedAtMs > WIDGET_FIGURES_MAX_AGE_MS -> WidgetMode.UPDATE
    else -> WidgetMode.FIGURES
}

/** The frozen sizes (plan section 9.9) and the responsive buckets. */
object WidgetSizes {
    val TODAY_SMALL = DpSize(250.dp, 110.dp)
    val TODAY_MEDIUM = DpSize(250.dp, 200.dp)
    val TODAY_LARGE = DpSize(250.dp, 270.dp)
    val TODAY = setOf(TODAY_SMALL, TODAY_MEDIUM, TODAY_LARGE)

    val HOLDING_SMALL = DpSize(110.dp, 110.dp)
    val HOLDING_WIDE = DpSize(180.dp, 110.dp)
    val HOLDING = setOf(HOLDING_SMALL, HOLDING_WIDE)

    val BEST_SMALL = DpSize(110.dp, 110.dp)
    val BEST_WIDE = DpSize(180.dp, 110.dp)
    val BEST_WORST = setOf(BEST_SMALL, BEST_WIDE)

    /** The Today widget's bucket: small (< 200 dp tall), large (≥ 270 dp) and one between. */
    fun todayBucket(size: DpSize): DpSize = when {
        size.height < 200.dp -> TODAY_SMALL
        size.height >= 270.dp -> TODAY_LARGE
        else -> TODAY_MEDIUM
    }

    /** Mini cards: one row of three at the small size, else two rows of three (one Column of ≤ 2 Rows: ≤ 10 children). */
    fun todayRows(size: DpSize): Int = if (todayBucket(size) == TODAY_SMALL) 1 else 2

    fun todaySparklines(size: DpSize): Boolean = todayBucket(size) == TODAY_LARGE

    const val MINI_SPARK_W = 82
    const val MINI_SPARK_H = 28
    const val HOLDING_SPARK_H = 40
    /** The 2 × 2 widgets side padding (12 dp: a 2 × 2 cell can be ≈ 150 dp wide). */
    const val HOLDING_PADDING = 12

    /** The holding sparkline bitmap width: the widest bucket's inner width (scaled down to a narrower cell, never up). */
    fun holdingSparkWidthDp(size: DpSize): Float =
        (maxOf(size.width, HOLDING_WIDE.width).value - 2 * HOLDING_PADDING).coerceAtLeast(40f)

    /** Bitmaps are drawn at a density capped at 2×. */
    const val DENSITY_CAP = 2f

    /** The sparkline bitmaps (width × height in px) a widget renders at one of its sizes. */
    fun sparkBitmaps(widget: String, size: DpSize, density: Float): List<Pair<Int, Int>> {
        val d = minOf(density, DENSITY_CAP)
        fun px(dp: Float) = kotlin.math.ceil(dp * d).toInt().coerceAtLeast(1)
        return when (widget) {
            "today" -> if (todaySparklines(size)) List(todayRows(size) * 3) { px(MINI_SPARK_W.toFloat()) to px(MINI_SPARK_H.toFloat()) } else emptyList()
            "holding" -> listOf(px(holdingSparkWidthDp(size)) to px(HOLDING_SPARK_H.toFloat()))
            else -> emptyList()
        }
    }

    /** RGB_565: two bytes a pixel. */
    fun bitmapBytes(widget: String, sizes: Set<DpSize>, density: Float): Long =
        sizes.sumOf { s -> sparkBitmaps(widget, s, density).sumOf { (w, h) -> w.toLong() * h * 2 } }

    const val BITMAP_BUDGET_BYTES: Long = 400L * 1024
}

/**
 * D155: the Today widget's lead line, `$53,320  (−$140)  ▼0.26%`: the value (white), the day $ in brackets and the
 * day % (gain/loss tints). Fitted to the width the widget is given, so it never clips: the largest [STEPS] that fits,
 * then the same steps with compact figures (`$1.24M (−$12k)`), never a second line.
 */
data class TotalLine(val value: String, val day: String, val percent: String, val valueSp: Int, val restSp: Int, val compact: Boolean)

object TotalLineFit {
    /** (value sp, day and % sp), largest first; a bucket's own maximum caps the value size. */
    val STEPS: List<Pair<Int, Int>> = listOf(24 to 13, 22 to 13, 20 to 13, 20 to 12, 18 to 12, 16 to 11, 14 to 10)

    /** The full figures stop at this value size; below it the compact figures read better. */
    const val FULL_MIN_SP = 16

    /** The gap between the three parts. */
    const val GAP_DP = 6f

    /** Width kept free for rounding and the launcher's own text metrics. */
    const val SLACK_DP = 6f

    /** The value size at the small bucket (as the old day figure: 20 sp) and at the others (24 sp). */
    fun maxValueSp(bucket: DpSize): Int = if (bucket == WidgetSizes.TODAY_SMALL) 20 else 24

    /** The width the line may take: the widget's width less its 12 dp padding on each side. */
    fun availableDp(size: DpSize): Float = size.width.value - 2 * 12f

    fun texts(totals: TotalsDto, compact: Boolean): Triple<String, String, String> {
        val value = if (compact) Format.compactMoney(totals.valueCents) else Format.valueWhole(totals.valueCents)
        val day = "(" + (if (compact) Format.compactMoney(totals.dayCents, signed = true) else Format.dayMoney(totals.dayCents)) + ")"
        val pct = Format.arrowPercent(decOrNull(totals.dayRatio), space = false)
        return Triple(value, day, pct)
    }

    /** The line's width in dp at the given sizes; [measure] takes (text, sp, bold) and answers dp at the font scale. */
    fun width(t: Triple<String, String, String>, valueSp: Int, restSp: Int, measure: (String, Float, Boolean) -> Float): Float =
        measure(t.first, valueSp.toFloat(), true) + GAP_DP + measure(t.second, restSp.toFloat(), true) + GAP_DP + measure(t.third, restSp.toFloat(), true)

    fun fit(totals: TotalsDto, maxValueSp: Int, availableDp: Float, measure: (String, Float, Boolean) -> Float): TotalLine {
        val steps = STEPS.filter { it.first <= maxValueSp }
        val limit = availableDp - SLACK_DP
        val full = texts(totals, compact = false)
        for ((v, r) in steps.filter { it.first >= FULL_MIN_SP }) {
            if (width(full, v, r, measure) <= limit) return TotalLine(full.first, full.second, full.third, v, r, compact = false)
        }
        val short = texts(totals, compact = true)
        for ((v, r) in steps) {
            if (width(short, v, r, measure) <= limit) return TotalLine(short.first, short.second, short.third, v, r, compact = true)
        }
        val (v, r) = STEPS.last()
        return TotalLine(short.first, short.second, short.third, v, r, compact = true)
    }

    /**
     * Measures with the platform's monospace face (the face Glance's `FontFamily.Monospace` renders in), at the
     * phone's font scale: widget text in sp follows it.
     */
    fun paintMeasure(context: Context): (String, Float, Boolean) -> Float {
        val metrics = context.resources.displayMetrics
        val fontScale = context.resources.configuration.fontScale
        val regular = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.MONOSPACE }
        val bold = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            isFakeBoldText = !typeface.isBold
        }
        return { text, sp, isBold ->
            val p = if (isBold) bold else regular
            p.textSize = sp * fontScale * metrics.density
            p.measureText(text) / metrics.density
        }
    }

    /** The spoken line: "Value 120,630 dollars, day plus 1,943 dollars, up 1.82 percent". */
    fun spoken(totals: TotalsDto): String {
        fun dollars(cents: Long) = Format.grouped(Format.wholeDollars(cents).abs()) + " dollars"
        val parts = mutableListOf("Value " + dollars(totals.valueCents))
        val cents = totals.dayCents
        parts += when {
            cents == null -> "no day figure yet"
            Format.daySign(cents) > 0 -> "day plus " + dollars(cents)
            Format.daySign(cents) < 0 -> "day minus " + dollars(cents)
            else -> "day 0 dollars"
        }
        decOrNull(totals.dayRatio)?.let { r ->
            val pct = Format.percent(r).removeSuffix("%")
            parts += when (Format.percentSign(r)) {
                1 -> "up $pct percent"
                -1 -> "down $pct percent"
                else -> "unchanged"
            }
        }
        return parts.joinToString(", ")
    }
}
