package com.tenon.joinrfinance.model

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Number and date formats (plan section 9.11; STYLE_GUIDE section 8). Pure; every figure from [BigDecimal],
 * half up. Minus is U+2212; gains carry `+` or ▲, losses `−` or ▼, a zero move neither.
 */
object Format {
    const val MINUS = "−"
    const val UP = "▲"
    const val DOWN = "▼"
    const val DASH = "—"
    private val HUNDRED = BigDecimal(100)

    /** The sign of a displayed value: +1, −1 or 0 (a zero move). */
    fun signum(value: BigDecimal): Int = value.signum()

    /** `1234567` → `1,234,567` for a non-negative value at its own scale. */
    fun grouped(value: BigDecimal): String {
        val plain = value.abs().toPlainString()
        val dot = plain.indexOf('.')
        val int = if (dot < 0) plain else plain.substring(0, dot)
        val frac = if (dot < 0) "" else plain.substring(dot)
        val sb = StringBuilder()
        for ((i, c) in int.withIndex()) {
            if (i > 0 && (int.length - i) % 3 == 0) sb.append(',')
            sb.append(c)
        }
        return sb.toString() + frac
    }

    /** Cents to whole dollars, half up (away from zero for negatives): 130249 → 1302. */
    fun wholeDollars(cents: Long): BigDecimal = BigDecimal(cents).movePointLeft(2).setScale(0, RoundingMode.HALF_UP)

    /** A day figure in whole dollars with a sign: `+$1,302`, `−$52`, `$0`; null → `—`. */
    fun dayMoney(cents: Long?): String {
        if (cents == null) return DASH
        val d = wholeDollars(cents)
        return when (d.signum()) {
            1 -> "+$" + grouped(d)
            -1 -> "$MINUS$" + grouped(d)
            else -> "$0"
        }
    }

    /** LIST and MOVERS: `+1,302`, `−407`, `0`; null → `—`. */
    fun dayShort(cents: Long?): String {
        if (cents == null) return DASH
        val d = wholeDollars(cents)
        return when (d.signum()) {
            1 -> "+" + grouped(d)
            -1 -> MINUS + grouped(d)
            else -> "0"
        }
    }

    /** The sign a whole-dollar day figure shows (0 when it rounds to zero). */
    fun daySign(cents: Long?): Int = if (cents == null) 0 else wholeDollars(cents).signum()

    /** A value in whole dollars without a sign: `186,965`; null → `—`. */
    fun valueShort(cents: Long?): String = if (cents == null) DASH else grouped(wholeDollars(cents).abs()).let { if (cents < 0) MINUS + it else it }

    /** A value in whole dollars: `$186,965`. */
    fun valueWhole(cents: Long?): String = if (cents == null) DASH else (if (cents < 0) MINUS else "") + "$" + grouped(wholeDollars(cents).abs())

    /**
     * A short whole-dollar figure for a tight widget (D155's fallback): `$9,999`, `$187k`, `$1.24M`, `$1.24B`, half
     * up. [signed] adds `+` to a gain (a loss always shows `−`; a zero move neither); null → `—`.
     */
    fun compactMoney(cents: Long?, signed: Boolean = false): String {
        if (cents == null) return DASH
        val d = wholeDollars(cents)
        val abs = d.abs()
        val body = when {
            abs < BigDecimal(10_000) -> grouped(abs)
            // 999,500 would round to "1000k": it reads as "$1.00M" instead.
            abs < BigDecimal(999_500) -> abs.movePointLeft(3).setScale(0, RoundingMode.HALF_UP).toPlainString() + "k"
            abs < BigDecimal(999_995_000) -> abs.movePointLeft(6).setScale(2, RoundingMode.HALF_UP).toPlainString() + "M"
            else -> grouped(abs.movePointLeft(9).setScale(2, RoundingMode.HALF_UP)) + "B"
        }
        val sign = when (d.signum()) {
            1 -> if (signed) "+" else ""
            -1 -> MINUS
            else -> ""
        }
        return "$sign$$body"
    }

    /** Money to the cent: `$5,555.00`, `−$12.40`; null → `—`. */
    fun moneyCents(cents: Long?): String {
        if (cents == null) return DASH
        val v = BigDecimal(cents).movePointLeft(2).setScale(2, RoundingMode.HALF_UP)
        return (if (v.signum() < 0) MINUS else "") + "$" + grouped(v.abs())
    }

    /** Money to the cent with a sign: `+$1,302.40`, `−$12.40`, `$0.00`. */
    fun signedMoneyCents(cents: Long?): String {
        if (cents == null) return DASH
        val v = BigDecimal(cents).movePointLeft(2).setScale(2, RoundingMode.HALF_UP)
        return when (v.signum()) {
            1 -> "+$" + grouped(v)
            -1 -> "$MINUS$" + grouped(v)
            else -> "$0.00"
        }
    }

    /** Below 1: 4 significant digits, at most 8 decimals, never fewer than 2 (`0.5000`, `0.001235`). */
    private fun small(value: BigDecimal): BigDecimal {
        val abs = value.abs()
        if (abs.signum() == 0) return BigDecimal.ZERO.setScale(2)
        val rounded = abs.round(MathContext(4, RoundingMode.HALF_UP)).stripTrailingZeros()
        // The scale that keeps four significant digits: 0.5 → 4, 0.0012345 → 6.
        val scale = (4 - (rounded.precision() - rounded.scale())).coerceIn(2, 8)
        return abs.setScale(scale, RoundingMode.HALF_UP)
    }

    /** A price on a card or in the detail: `$112.40`, `$164,820.00`, `$0.5000`; null → `—`. */
    fun price(price: BigDecimal?): String {
        if (price == null) return DASH
        val abs = price.abs()
        val text = if (abs < BigDecimal.ONE) small(abs).toPlainString() else grouped(abs.setScale(2, RoundingMode.HALF_UP))
        return (if (price.signum() < 0) MINUS else "") + "$" + text
    }

    /** LIST's LAST column: ≥ 1000 in whole dollars (`164,820`), else 2 decimals (`112.40`), below 1 four significant digits. */
    fun priceShort(price: BigDecimal?): String {
        if (price == null) return DASH
        val abs = price.abs()
        return when {
            abs >= BigDecimal(1000) -> grouped(abs.setScale(0, RoundingMode.HALF_UP))
            abs >= BigDecimal.ONE -> grouped(abs.setScale(2, RoundingMode.HALF_UP))
            else -> small(abs).toPlainString()
        }
    }

    /**
     * A change per unit without its sign: whole numbers from 1000 (as LIST prices), 2 decimals from 0.1, else four
     * significant digits (`4,000`, `1.58`, `0.01500`).
     */
    fun unitChange(change: BigDecimal): String {
        val abs = change.abs()
        return when {
            abs >= BigDecimal(1000) -> grouped(abs.setScale(0, RoundingMode.HALF_UP))
            abs >= BigDecimal("0.1") || abs.signum() == 0 -> grouped(abs.setScale(2, RoundingMode.HALF_UP))
            else -> small(abs).toPlainString()
        }
    }

    /** A ratio as a percentage with 2 decimals, grouped, and no sign: `1.42%`, `3,179.39%`. */
    fun percent(ratio: BigDecimal): String = grouped((ratio.abs() * HUNDRED).setScale(2, RoundingMode.HALF_UP)) + "%"

    /** The sign a 2-decimal percentage shows. */
    fun percentSign(ratio: BigDecimal?): Int = if (ratio == null) 0 else (ratio * HUNDRED).setScale(2, RoundingMode.HALF_UP).signum()

    /** `▲ 1.42%`, `▼ 2.15%`, `0.00%` (no arrow for a zero move); null → `—`. */
    fun arrowPercent(ratio: BigDecimal?, space: Boolean = true): String {
        if (ratio == null) return DASH
        val gap = if (space) " " else ""
        return when (percentSign(ratio)) {
            1 -> UP + gap + percent(ratio)
            -1 -> DOWN + gap + percent(ratio)
            else -> percent(ratio)
        }
    }

    /** LIST's CHG% column: `▲1.42`, `▼2.15`, `0.00`, `▲3,179.39`. */
    fun arrowPercentShort(ratio: BigDecimal?): String {
        if (ratio == null) return DASH
        val n = grouped((ratio.abs() * HUNDRED).setScale(2, RoundingMode.HALF_UP))
        return when (percentSign(ratio)) {
            1 -> UP + n
            -1 -> DOWN + n
            else -> n
        }
    }

    /** `+12.40%` with a sign (unrealised gain); null → `—`. */
    fun signedPercent(ratio: BigDecimal?): String {
        if (ratio == null) return DASH
        return when (percentSign(ratio)) {
            1 -> "+" + percent(ratio)
            -1 -> MINUS + percent(ratio)
            else -> percent(ratio)
        }
    }

    /** A weight with 1 decimal: `25.8%`; null → `—`. */
    fun weight(ratio: BigDecimal?): String =
        if (ratio == null) DASH else (ratio * HUNDRED).setScale(1, RoundingMode.HALF_UP).toPlainString() + "%"

    /** Units: up to 4 decimals (crypto 8); bullion 4 decimals and ` oz`. */
    fun units(units: BigDecimal, kind: String): String = when (kind) {
        "bullion" -> grouped(units.setScale(4, RoundingMode.HALF_UP)) + " oz"
        "crypto" -> grouped(trim(units.setScale(8, RoundingMode.HALF_UP)))
        else -> grouped(trim(units.setScale(4, RoundingMode.HALF_UP)))
    }

    private fun trim(v: BigDecimal): BigDecimal {
        val s = v.stripTrailingZeros()
        return if (s.scale() < 0) s.setScale(0) else s
    }
}

/** Dates and times, always in the server's zone (plan section 9.7): `dd/mm/yyyy`, `HH:mm`. */
object Times {
    private val HM = DateTimeFormatter.ofPattern("HH:mm", Locale.ENGLISH)
    private val DMY = DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale.ENGLISH)
    private val DM = DateTimeFormatter.ofPattern("dd/MM", Locale.ENGLISH)
    private val WDM = DateTimeFormatter.ofPattern("EEE dd/MM", Locale.ENGLISH)
    private val WHM = DateTimeFormatter.ofPattern("EEE HH:mm", Locale.ENGLISH)
    private val DMHM = DateTimeFormatter.ofPattern("dd/MM HH:mm", Locale.ENGLISH)
    private val DMYHM = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm", Locale.ENGLISH)

    fun zone(id: String?): ZoneId = runCatching { ZoneId.of(id) }.getOrDefault(ZoneId.of("Australia/Melbourne"))

    fun instant(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

    fun hm(at: Instant, zone: ZoneId): String = HM.format(at.atZone(zone))
    fun hm(epochSeconds: Long, zone: ZoneId): String = hm(Instant.ofEpochSecond(epochSeconds), zone)
    fun dmy(at: Instant, zone: ZoneId): String = DMY.format(at.atZone(zone))
    fun dm(at: Instant, zone: ZoneId): String = DM.format(at.atZone(zone))
    fun dmHm(at: Instant, zone: ZoneId): String = DMHM.format(at.atZone(zone))
    fun dmyHm(at: Instant, zone: ZoneId): String = DMYHM.format(at.atZone(zone))
    fun weekdayHm(at: Instant, zone: ZoneId): String = WHM.format(at.atZone(zone))

    /** A plain `YYYY-MM-DD` as `dd/mm/yyyy`. */
    fun isoDateDmy(date: String): String = runCatching { DMY.format(java.time.LocalDate.parse(date)) }.getOrDefault(date)

    /** A plain `YYYY-MM-DD` as `Thu 12/09`. */
    fun isoDateWeekday(date: String): String = runCatching { WDM.format(java.time.LocalDate.parse(date)) }.getOrDefault(date)

    /** A plain `YYYY-MM-DD` as `12/09`. */
    fun isoDateDm(date: String): String = runCatching { DM.format(java.time.LocalDate.parse(date)) }.getOrDefault(date)

    /** "just now", "5 min ago", "2 h ago", "3 d ago". */
    fun ago(fromMs: Long, nowMs: Long): String {
        val minutes = ((nowMs - fromMs).coerceAtLeast(0L)) / 60_000L
        return if (minutes < 1) "just now" else age(minutes) + " ago"
    }

    /** An age in whole minutes, stepped like [ago] but without "ago": `25 min`, `40 h` (under 48 h), `2 d`. */
    fun age(minutes: Long): String {
        val m = minutes.coerceAtLeast(0L)
        return when {
            m < 60 -> "$m min"
            m < 48 * 60 -> "${m / 60} h"
            else -> "${m / (24 * 60)} d"
        }
    }
}
