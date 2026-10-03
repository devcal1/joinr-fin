package com.tenon.joinrfinance.model

import com.tenon.joinrfinance.net.ApiError
import com.tenon.joinrfinance.net.MobileHoldingDto
import com.tenon.joinrfinance.net.MobileTodayResponse
import com.tenon.joinrfinance.net.Sentences
import com.tenon.joinrfinance.net.dec
import com.tenon.joinrfinance.net.decOrNull
import java.math.BigDecimal
import java.time.Instant

/** How a figure is tinted: a gain, a loss, a zero move, or no figure at all. Never colour alone (a sign or word too). */
enum class Tone { GAIN, LOSS, FLAT, NONE }

fun toneOf(sign: Int): Tone = when {
    sign > 0 -> Tone.GAIN
    sign < 0 -> Tone.LOSS
    else -> Tone.FLAT
}

/** The Today sort (plan section 9.7): cycles day $ → day % → value. */
enum class SortOrder(val label: String, val spoken: String) {
    DAY_CENTS("DAY $", "day dollars"),
    DAY_RATIO("DAY %", "day percent"),
    VALUE("VALUE", "value"),
    ;

    fun next(): SortOrder = entries[(ordinal + 1) % entries.size]
}

/** The Today tabs. */
enum class TodayTab(val label: String) { CARDS("CARDS"), LIST("LIST"), MOVERS("MOVERS") }

/** Holdings in the chosen order: descending, nulls last, ties by code. */
fun sortHoldings(holdings: List<MobileHoldingDto>, order: SortOrder): List<MobileHoldingDto> {
    fun key(h: MobileHoldingDto): BigDecimal? = when (order) {
        SortOrder.DAY_CENTS -> h.dayCents?.let { BigDecimal(it) }
        SortOrder.DAY_RATIO -> decOrNull(h.dayRatio)
        SortOrder.VALUE -> h.valueCents?.let { BigDecimal(it) }
    }
    return holdings.sortedWith { a, b ->
        val ka = key(a)
        val kb = key(b)
        when {
            ka == null && kb == null -> a.code.compareTo(b.code)
            ka == null -> 1
            kb == null -> -1
            else -> kb.compareTo(ka).takeIf { it != 0 } ?: a.code.compareTo(b.code)
        }
    }
}

/** One MOVERS row: an `ok` holding and its bar as a fraction of the largest |day $| (−1 … 1). */
data class MoverRow(val holding: MobileHoldingDto, val fraction: Float)

fun moverRows(holdings: List<MobileHoldingDto>, order: SortOrder): List<MoverRow> {
    val ok = sortHoldings(holdings.filter { it.isOk && it.dayCents != null }, order)
    val max = ok.maxOfOrNull { kotlin.math.abs(it.dayCents!!) } ?: 0L
    return ok.map { h ->
        MoverRow(h, if (max == 0L) 0f else (h.dayCents!!.toDouble() / max.toDouble()).toFloat())
    }
}

/** The status word shown instead of a day figure (CARDS, LIST, widgets), or null for an `ok` intraday holding. */
fun statusWord(h: MobileHoldingDto, today: MobileTodayResponse, withDate: Boolean = true): String? {
    val zone = Times.zone(today.timeZone)
    return when (h.dayStatus) {
        MobileHoldingDto.DAY_OK -> if (h.kind == MobileHoldingDto.KIND_FUND || h.session?.daily == true) {
            val d = h.session?.date
            if (withDate && d != null) "DAILY PRICE · ${Times.isoDateWeekday(d)}" else "DAILY PRICE"
        } else {
            null
        }
        MobileHoldingDto.DAY_MANUAL -> "HAND PRICE"
        MobileHoldingDto.DAY_STALE -> {
            val at = Times.instant(h.priceAsOf)
            if (withDate && at != null) "STALE · ${Times.dm(at, zone)}" else "STALE"
        }
        MobileHoldingDto.DAY_NO_BASE -> "NO CHANGE YET"
        MobileHoldingDto.DAY_UNPRICED -> "NO PRICE"
        else -> "NO CHANGE YET"
    }
}

/** The tone of a holding's day figure: by its day cents when `ok`, else none. */
fun dayTone(h: MobileHoldingDto): Tone = if (h.isOk && h.dayCents != null) toneOf(h.dayCents.compareTo(0)) else Tone.NONE

/**
 * The tint of a whole-dollar day figure (LIST's CHG$, MOVERS' day $): by the sign it shows, so a move that rounds to
 * `0` is never coloured (STYLE_GUIDE section 8: no colour without a sign); none without a day figure.
 */
fun dayDollarsTone(h: MobileHoldingDto): Tone = if (h.isOk && h.dayCents != null) toneOf(Format.daySign(h.dayCents)) else Tone.NONE

const val NBSP = "\u00A0"

/** The change line of a card: `▲ 1.58 (1.42%)` (a no-break space after the arrow, so a narrow card wraps before the %); `—` without a day figure. */
fun changeLine(h: MobileHoldingDto): String {
    val change = decOrNull(h.changePerUnit)
    val ratio = decOrNull(h.dayRatio)
    if (!h.isOk || change == null || ratio == null) return Format.DASH
    val arrow = when (change.signum()) {
        1 -> Format.UP + NBSP
        -1 -> Format.DOWN + NBSP
        else -> ""
    }
    return arrow + Format.unitChange(change) + " (" + Format.percent(ratio) + ")"
}

/** The spoken summary of a card or row (plan section 9.12). */
fun spokenHolding(h: MobileHoldingDto): String {
    val name = if (h.isBullion) h.name ?: h.code else h.code
    val parts = mutableListOf(name)
    val ratio = decOrNull(h.dayRatio)
    if (h.isOk && ratio != null && h.dayCents != null) {
        val pct = Format.percent(ratio).removeSuffix("%")
        parts += when (Format.percentSign(ratio)) {
            1 -> "up $pct percent"
            -1 -> "down $pct percent"
            else -> "unchanged"
        }
        val dollars = Format.grouped(Format.wholeDollars(h.dayCents).abs())
        parts += when (Format.daySign(h.dayCents)) {
            1 -> "day plus $dollars dollars"
            -1 -> "day minus $dollars dollars"
            else -> "day 0 dollars"
        }
    } else {
        parts += when (h.dayStatus) {
            MobileHoldingDto.DAY_MANUAL -> "hand price, no day figure"
            MobileHoldingDto.DAY_STALE -> "stale price, no day figure"
            MobileHoldingDto.DAY_UNPRICED -> "no price"
            else -> "no change yet"
        }
    }
    if (h.isBullion && h.price != null) parts += "price per ounce ${Format.price(dec(h.price)).removePrefix("$")} dollars"
    decOrNull(h.weightRatio)?.let { parts += "weight ${Format.weight(it).removeSuffix("%")} percent" }
    return parts.joinToString(", ")
}

/** `16:10 · ASX closed` for the header (the newest price time, in the server's zone). */
fun marketLine(today: MobileTodayResponse): String {
    val zone = Times.zone(today.timeZone)
    val word = when (today.market.asx) {
        "open" -> "ASX open"
        "pre_open" -> "ASX pre-open"
        else -> "ASX closed"
    }
    val at = Times.instant(today.freshness.latestPriceAt) ?: return word
    return Times.hm(at, zone) + " · " + word
}

/** `6▲ 4▼` for the Today block and the widget. */
fun countsLine(today: MobileTodayResponse): Pair<String, String> =
    "${today.totals.up}${Format.UP}" to "${today.totals.down}${Format.DOWN}"

/**
 * D155: the value, the total invested and the gain for the Today header. The holdings in the response are the held
 * ones (the DTO's rule), so the invested total is the cost base of the holdings held now, as the web shows it.
 * Never a partial sum presented as complete: one held holding with an unknown cost makes the invested total and the
 * gain unknown, and one without a value (unpriced: its cost is in the invested total but not in the value) makes the
 * gain unknown.
 */
data class InvestedTotals(
    val valueCents: Long,
    /** Σ `position.costCents`; null when any held holding's cost is unknown. */
    val investedCents: Long?,
    /** value − invested; null when the invested total is unknown or a held holding is unpriced. */
    val gainCents: Long?,
    /** gain ÷ invested; null when the gain is unknown or nothing is invested. */
    val gainRatio: BigDecimal?,
    /** Held holdings whose cost is unknown. */
    val unknownCost: Int,
    /** Held holdings without a value (no price). */
    val unpriced: Int,
)

fun investedTotals(today: MobileTodayResponse): InvestedTotals {
    val held = today.holdings
    val unknownCost = held.count { it.position.costCents == null }
    val unpriced = held.count { it.valueCents == null }
    val invested = if (unknownCost > 0) null else held.sumOf { it.position.costCents!! }
    val gain = if (invested == null || unpriced > 0) null else today.totals.valueCents - invested
    val ratio = if (gain == null || invested == null || invested <= 0L) {
        null
    } else {
        BigDecimal(gain).divide(BigDecimal(invested), java.math.MathContext(12, java.math.RoundingMode.HALF_UP))
    }
    return InvestedTotals(today.totals.valueCents, invested, gain, ratio, unknownCost, unpriced)
}

private fun holdingsWord(n: Int) = if (n == 1) "1 holding has" else "$n holdings have"

/** Why the invested total is unknown (TalkBack), or null when it is known. */
fun investedUnknownReason(t: InvestedTotals): String? =
    if (t.investedCents == null) "${holdingsWord(t.unknownCost)} no cost base" else null

/** Why the gain is unknown (TalkBack), or null when it is known. */
fun gainUnknownReason(t: InvestedTotals): String? = when {
    t.gainCents != null -> null
    t.investedCents == null -> "${holdingsWord(t.unknownCost)} no cost base"
    else -> "${holdingsWord(t.unpriced)} no price"
}

/** The header's spoken totals: "Value 120,630 dollars, invested 76,427 dollars, gain plus 44,203 dollars, up 57.84 percent". */
fun spokenInvested(t: InvestedTotals): String {
    fun dollars(cents: Long) = Format.grouped(Format.wholeDollars(cents).abs()) + " dollars"
    val parts = mutableListOf("Value " + (if (t.valueCents < 0) "minus " else "") + dollars(t.valueCents))
    parts += t.investedCents?.let { "invested " + dollars(it) } ?: "invested unknown, ${investedUnknownReason(t)}"
    val gain = t.gainCents
    if (gain == null) {
        parts += "gain unknown" + (if (t.investedCents != null) ", ${gainUnknownReason(t)}" else "")
    } else {
        parts += when (Format.daySign(gain)) {
            1 -> "gain plus " + dollars(gain)
            -1 -> "gain minus " + dollars(gain)
            else -> "gain 0 dollars"
        }
        t.gainRatio?.let { r ->
            val pct = Format.percent(r).removeSuffix("%")
            parts += when (Format.percentSign(r)) {
                1 -> "up $pct percent"
                -1 -> "down $pct percent"
                else -> "unchanged"
            }
        }
    }
    return parts.joinToString(", ")
}

/** The portfolio chart's spoken summary (plan section 9.12). */
fun spokenPortfolio(today: MobileTodayResponse): String {
    val line = today.portfolioLine
    val zone = Times.zone(today.timeZone)
    val since = Times.instant(line?.from)?.let { " since " + Times.hm(it, zone) } ?: ""
    val cents = today.totals.dayCents
    val ratio = decOrNull(today.totals.dayRatio)
    if (cents == null) return "Portfolio day change$since: no day figure yet"
    val dir = when (Format.daySign(cents)) {
        1 -> "up"
        -1 -> "down"
        else -> "unchanged"
    }
    val pct = ratio?.let { " " + Format.percent(it).removeSuffix("%") + " percent," } ?: ","
    return "Portfolio day change$since, $dir$pct ${Format.grouped(Format.wholeDollars(cents).abs())} dollars"
}

/** A one-line state shown inside Today (plan section 9.8). */
data class Notice(val kind: Kind, val text: String, val retry: Boolean = false) {
    enum class Kind { IMPORTANT, NOTE }
}

/** The Today notices: the error (with Retry), stale prices, old prices and the missing screen lock. */
fun todayNotices(
    today: MobileTodayResponse?,
    fetchedAtMs: Long?,
    nowMs: Long,
    error: ApiError?,
    noScreenLock: Boolean,
): List<Notice> {
    val out = mutableListOf<Notice>()
    if (noScreenLock) out += Notice(Notice.Kind.IMPORTANT, "Set a screen lock on this phone to protect Joinr Finance.")
    if (error != null && error != ApiError.Revoked) {
        out += Notice(Notice.Kind.IMPORTANT, error.sentence, retry = true)
        if (today != null && fetchedAtMs != null) {
            val zone = Times.zone(today.timeZone)
            out += Notice(
                Notice.Kind.NOTE,
                "Figures from ${Times.hm(Instant.ofEpochMilli(fetchedAtMs), zone)} (${Times.ago(fetchedAtMs, nowMs)})",
            )
        }
    }
    if (today != null) {
        val zone = Times.zone(today.timeZone)
        val staleCount = today.freshness.stale + today.freshness.failed
        if (staleCount > 0) {
            val oldest = Times.instant(today.freshness.oldestPriceAt)?.let { " (oldest ${Times.dmHm(it, zone)})" } ?: ""
            val noun = if (staleCount == 1) "1 price is stale" else "$staleCount prices are stale"
            out += Notice(Notice.Kind.IMPORTANT, noun + oldest)
        }
        val latest = Times.instant(today.freshness.latestPriceAt)
        if (today.market.asx == "open" && latest != null) {
            val ageMin = (nowMs - latest.toEpochMilli()) / 60_000L
            if (ageMin > 20) out += Notice(Notice.Kind.IMPORTANT, "Prices are ${Times.age(ageMin)} old.")
        }
    }
    return out
}

/** The widgets' absolute age line (plan section 9.9): `16:10 · updated Thu 14:10`. */
data class AgeLine(val text: String, val old: Boolean)

const val WIDGET_FIGURES_MAX_AGE_MS: Long = 24L * 60 * 60 * 1000
const val WIDGET_AGE_WARN_MS: Long = 60L * 60 * 1000

fun widgetAgeLine(today: MobileTodayResponse, fetchedAtMs: Long, nowMs: Long): AgeLine {
    val zone = Times.zone(today.timeZone)
    val fetched = Instant.ofEpochMilli(fetchedAtMs)
    val sixDays = 6L * 24 * 60 * 60 * 1000
    val updated = if (nowMs - fetchedAtMs > sixDays) {
        Times.dm(fetched, zone) + " " + Times.hm(fetched, zone)
    } else {
        Times.weekdayHm(fetched, zone)
    }
    val price = Times.instant(today.freshness.latestPriceAt)?.let { Times.hm(it, zone) + " · " } ?: ""
    val old = nowMs - fetchedAtMs > WIDGET_AGE_WARN_MS
    val text = (if (old) "⚠\uFE0E " else "") + price + "updated " + updated
    return AgeLine(text, old)
}

/**
 * The Today widget's mini cards: the holdings with the largest absolute day $ move, biggest first (gains and losses
 * mixed; ties by value descending, then code). A holding with no day figure (null `dayCents`: stale, unpriced, no base)
 * never comes ahead of one with a figure; when fewer than [n] have one, the rest fill in by value as before.
 */
fun biggestMoves(today: MobileTodayResponse, n: Int): List<MobileHoldingDto> {
    val (moved, rest) = today.holdings.partition { it.dayCents != null }
    val byMove = moved.sortedWith(
        compareByDescending<MobileHoldingDto> { kotlin.math.abs(it.dayCents!!) }
            .thenByDescending { it.valueCents }
            .thenBy { it.code },
    )
    return (byMove + sortHoldings(rest, SortOrder.VALUE)).take(n)
}

/** The best and the worst `ok` holding by day %; null when fewer than two have a figure. */
fun bestAndWorst(today: MobileTodayResponse): Pair<MobileHoldingDto, MobileHoldingDto>? {
    val ok = today.holdings.filter { it.isOk && it.dayRatio != null }
    if (ok.size < 2) return null
    val sorted = sortHoldings(ok, SortOrder.DAY_RATIO)
    return sorted.first() to sorted.last()
}

/** The detail's session text ("10:00–16:10, Thu 12/09", "Daily price, 11/09", "Since 00:00"). */
fun sessionText(h: MobileHoldingDto, today: MobileTodayResponse): String {
    val s = h.session ?: return Format.DASH
    val zone = Times.zone(today.timeZone)
    if (s.daily || h.kind == MobileHoldingDto.KIND_FUND) return "Daily price, ${Times.isoDateDm(s.date)}"
    if (h.kind == MobileHoldingDto.KIND_CRYPTO || h.isBullion) return "Since 00:00"
    val pts = h.line?.points.orEmpty()
    if (pts.size >= 2) {
        return Times.hm(pts.first().first, zone) + "–" + Times.hm(pts.last().first, zone) + ", " + Times.isoDateWeekday(s.date)
    }
    return Times.isoDateWeekday(s.date)
}

/** A not-paired or revoked phone shows this instead of figures in every widget. */
const val WIDGET_PAIR_TEXT = "Open Joinr Finance to pair."
const val WIDGET_UPDATE_TEXT = "Open Joinr Finance to update"
const val EMPTY_TEXT = "No holdings yet. Add trades in Joinr Finance on the web."
const val NOT_PAIRED_TEXT = "Pair this phone with Joinr Finance on your Umbrel: Settings → Phone → Pair a phone."

/** Re-exported for the UI: the revoked screen's sentence. */
val REVOKED_TEXT: String get() = Sentences.REVOKED_SCREEN
