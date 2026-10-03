package com.tenon.joinrfinance.model

import com.tenon.joinrfinance.net.ApiError
import com.tenon.joinrfinance.net.MobilePeriodDto
import com.tenon.joinrfinance.net.MobilePeriodFigureDto
import com.tenon.joinrfinance.net.MobilePeriodHoldingDto
import com.tenon.joinrfinance.net.MobilePeriodsResponse
import com.tenon.joinrfinance.net.MobileTodayResponse
import com.tenon.joinrfinance.net.dec
import com.tenon.joinrfinance.net.decOrNull
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * The phone's periods (Stage 10 plan section 9.2, D158): 1D is the Stage 9 day figure from `/today`; the other seven come
 * from `/api/mobile/periods`, keyed by the chip text.
 */
enum class Period(val chip: String, val label: String, val spoken: String) {
    ONE_DAY("1D", "TODAY", "today"),
    ONE_WEEK("1W", "1 WEEK", "1 week"),
    TWO_WEEKS("2W", "2 WEEKS", "2 weeks"),
    ONE_MONTH("1M", "1 MONTH", "1 month"),
    THREE_MONTHS("3M", "3 MONTHS", "3 months"),
    SIX_MONTHS("6M", "6 MONTHS", "6 months"),
    TWELVE_MONTHS("12M", "12 MONTHS", "12 months"),
    ALL("ALL", "ALL TIME", "all time"),
    ;

    /** The server's key for this period (the chip text). */
    val key: String get() = chip

    /** 1D: the Stage 9 screen, from `/today`. */
    val isDay: Boolean get() = this == ONE_DAY

    companion object {
        fun ofKey(key: String): Period? = entries.firstOrNull { it.chip == key }
    }
}

/** A cached periods answer older than this is refetched when a non-1D chip is shown (plan section 9.3). */
const val PERIODS_MAX_AGE_MS: Long = 30L * 60 * 1000

/** "Price history to dd/mm" shows when `closesThrough` is more than this many days before `localDate` (plan section 3.5). */
const val CLOSES_STALE_NOTE_DAYS: Long = 6

const val PERIODS_TOO_OLD_TEXT = "Periods need Joinr Finance 1.3.0 or later on the Umbrel."
const val PERIODS_FAILED_TEXT = "The period figures could not be updated."
const val NO_LINE_TEXT = "No price history for this period yet."
const val NOTHING_HELD_TEXT = "Nothing is held now."
const val SOLD_LABEL = "Sold holdings"
const val WORD_NO_HISTORY = "NO HISTORY"
const val WORD_SPLIT = "SPLIT"
const val WORD_NO_PRICE = "NO PRICE"
const val WORD_NO_COST = "NO COST"

private val HUNDRED = BigDecimal(100)
private val DM: DateTimeFormatter = DateTimeFormatter.ofPattern("dd/MM", Locale.ENGLISH)
private val DMY: DateTimeFormatter = DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale.ENGLISH)
private val SPOKEN_DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.ENGLISH)

private fun date(iso: String?): LocalDate? = iso?.let { runCatching { LocalDate.parse(it) }.getOrNull() }

/** The answer's figures for one period, or null (1D, or a server period missing from the answer). */
fun MobilePeriodsResponse.periodOf(period: Period): MobilePeriodDto? =
    if (period.isDay) null else periods.firstOrNull { it.period == period.key }

/** The Sold holdings figure (ALL only, when something was sold). */
fun MobilePeriodDto.soldFigure(): MobilePeriodFigureDto? = figures.firstOrNull { it.isSold && (it.soldCount ?: 0) > 0 }

fun MobilePeriodDto.figureOf(key: String): MobilePeriodFigureDto? = figures.firstOrNull { it.key == key && !it.isSold }

/** One held holding under a period: its row of the answer and its figure there (null only for a malformed answer). */
data class PeriodRow(val holding: MobilePeriodHoldingDto, val figure: MobilePeriodFigureDto?) {
    val key: String get() = holding.key
    val code: String get() = holding.code

    /** The figure's cents when it shows one (`ok`, or a `no_start` holding's bought-in part, D165/D166). */
    val cents: Long? get() = figure?.takeIf { it.isOk || it.status == MobilePeriodFigureDto.STATUS_NO_START }?.cents
    val ratio: BigDecimal? get() = if (cents == null) null else decOrNull(figure?.ratio)
}

fun periodRows(answer: MobilePeriodsResponse, dto: MobilePeriodDto): List<PeriodRow> =
    answer.holdings.map { h -> PeriodRow(h, dto.figureOf(h.key)) }

/**
 * Under a period the sort (plan section 9.4) keeps [SortOrder]: DAY $ and DAY % sort by the figure's cents and ratio,
 * VALUE by value; descending, nulls last, ties by code. The Sold row is never in this list (it is always last).
 */
fun sortPeriodRows(rows: List<PeriodRow>, order: SortOrder): List<PeriodRow> {
    fun key(r: PeriodRow): BigDecimal? = when (order) {
        SortOrder.DAY_CENTS -> r.cents?.let { BigDecimal(it) }
        SortOrder.DAY_RATIO -> r.ratio
        SortOrder.VALUE -> r.holding.valueCents?.let { BigDecimal(it) }
    }
    return rows.sortedWith { a, b ->
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

/** The sort's shown label under a period: `1W $`, `1W %`, `ALL $`, `VALUE`; 1D keeps the Stage 9 label. */
fun sortLabel(order: SortOrder, period: Period): String = when {
    period.isDay -> order.label
    order == SortOrder.DAY_CENTS -> "${period.chip} $"
    order == SortOrder.DAY_RATIO -> "${period.chip} %"
    else -> order.label
}

/** The sort's spoken name under a period. */
fun sortSpoken(order: SortOrder, period: Period): String = when {
    period.isDay -> order.spoken
    order == SortOrder.DAY_CENTS -> "${period.spoken} dollars"
    order == SortOrder.DAY_RATIO -> "${period.spoken} percent"
    else -> order.spoken
}

/** One MOVERS row under a period: a holding (or the Sold row) and its bar as a fraction of the largest |cents|. */
data class PeriodMoverRow(val row: PeriodRow?, val sold: MobilePeriodFigureDto?, val cents: Long, val ratio: BigDecimal?, val fraction: Float) {
    val key: String get() = row?.key ?: MobilePeriodFigureDto.SOLD_HOLDINGS_KEY
    val code: String get() = row?.code ?: "SOLD"
}

/** Every figure with cents (`ok`, a `no_start` bought-in part, and the Sold figure under ALL, last). */
fun periodMoverRows(rows: List<PeriodRow>, dto: MobilePeriodDto, order: SortOrder): List<PeriodMoverRow> {
    val withCents = sortPeriodRows(rows.filter { it.cents != null }, order)
    val sold = dto.soldFigure()?.takeIf { it.cents != null }
    val max = (withCents.map { kotlin.math.abs(it.cents!!) } + listOfNotNull(sold?.cents?.let { kotlin.math.abs(it) })).maxOrNull() ?: 0L
    fun frac(c: Long) = if (max == 0L) 0f else (c.toDouble() / max.toDouble()).toFloat()
    return withCents.map { PeriodMoverRow(it, null, it.cents!!, it.ratio, frac(it.cents!!)) } +
        listOfNotNull(sold?.let { PeriodMoverRow(null, it, it.cents!!, decOrNull(it.ratio), frac(it.cents!!)) })
}

/** The status word of a figure with no value: NO HISTORY, SPLIT, NO PRICE, NO COST (plan section 9.6). */
fun periodStatusWord(f: MobilePeriodFigureDto?): String? = when (f?.status) {
    null -> WORD_NO_PRICE
    MobilePeriodFigureDto.STATUS_OK -> null
    MobilePeriodFigureDto.STATUS_NO_START -> WORD_NO_HISTORY
    MobilePeriodFigureDto.STATUS_SPLIT -> WORD_SPLIT
    MobilePeriodFigureDto.STATUS_NO_COST -> WORD_NO_COST
    else -> WORD_NO_PRICE
}

/**
 * The word under a card's price under a period: the figure's status word, else the Stage 9 price word for an `ok`
 * figure on a stale or hand price (`STALE · dd/mm`, `HAND PRICE`), else null.
 */
fun periodCardWord(h: MobilePeriodHoldingDto, f: MobilePeriodFigureDto?, answer: MobilePeriodsResponse, withDate: Boolean = true): String? {
    periodStatusWord(f)?.let { return it }
    return when (h.priceStatus) {
        "manual" -> "HAND PRICE"
        "stale", "failed" -> {
            val at = Times.instant(h.priceAsOf)
            if (withDate && at != null) "STALE · ${Times.dm(at, Times.zone(answer.timeZone))}" else "STALE"
        }
        else -> null
    }
}

private fun arrowed(ratio: BigDecimal): String = Format.arrowPercent(ratio)

/** `BOUGHT IN 1W` bound with no-break spaces, so it never splits across lines on a narrow card. */
private fun boughtIn(period: Period): String = "BOUGHT" + NBSP + "IN" + NBSP + period.chip

/**
 * A card's change line under a period (plan section 9.4): `▲ 0.50 (1.00%)` from the start close; `BOUGHT IN 1W ▲ 1.33%`
 * for a holding bought entirely in the period; `▲ 20.85% ALL TIME`; `BOUGHT IN 1W ▲ 5.00% · PARTIAL` for the bought-in part
 * of a holding with no start close (D166); `—` otherwise. The groups are bound with no-break spaces (`BOUGHT IN 1W`, the
 * arrowed percentage, `ALL TIME`, `· PARTIAL`) and joined by ordinary spaces, so a narrow card wraps between groups only.
 */
fun periodChangeLine(f: MobilePeriodFigureDto?, period: Period): String {
    if (f == null) return Format.DASH
    val ratio = decOrNull(f.ratio)
    if (period == Period.ALL) {
        return if (f.isOk && f.cents != null && ratio != null) arrowed(ratio).replace(" ", NBSP) + " ALL" + NBSP + "TIME" else Format.DASH
    }
    if (f.status == MobilePeriodFigureDto.STATUS_NO_START) {
        return if (f.cents != null && ratio != null) boughtIn(period) + " " + arrowed(ratio).replace(" ", NBSP) + " ·" + NBSP + "PARTIAL" else Format.DASH
    }
    if (!f.isOk || f.cents == null) return Format.DASH
    val change = decOrNull(f.changePerUnit)
    val priceRatio = decOrNull(f.priceRatio)
    if (f.startClose != null && change != null && priceRatio != null) {
        val arrow = when (change.signum()) {
            1 -> Format.UP + NBSP
            -1 -> Format.DOWN + NBSP
            else -> ""
        }
        return arrow + Format.unitChange(change) + " (" + Format.percent(priceRatio) + ")"
    }
    return if (ratio != null) boughtIn(period) + " " + arrowed(ratio).replace(" ", NBSP) else Format.DASH
}

/** The tone of a figure: by the sign its whole-dollar cents show; none without cents. */
fun periodTone(cents: Long?): Tone = if (cents == null) Tone.NONE else toneOf(Format.daySign(cents))

/**
 * The tone of a card's change line and sparkline and of the detail's chart: by the figure's own sign, as Stage 9's
 * `dayTone` tints the 1D card (a figure that rounds to `$0` still shows its ▲/▼ in colour); none without cents.
 */
fun periodMarkTone(cents: Long?): Tone = if (cents == null) Tone.NONE else toneOf(cents.compareTo(0))

private fun dollarsWord(cents: Long): String = Format.grouped(Format.wholeDollars(cents).abs()) + " dollars"

private fun percentWords(ratio: BigDecimal?): String? = ratio?.let {
    val pct = Format.percent(it).removeSuffix("%")
    when (Format.percentSign(it)) {
        1 -> "up $pct percent"
        -1 -> "down $pct percent"
        else -> "unchanged"
    }
}

/** The spoken summary of a card or row under a period. */
fun spokenPeriodHolding(r: PeriodRow, period: Period): String {
    val h = r.holding
    val parts = mutableListOf(if (h.isBullion) h.name ?: h.code else h.code)
    val cents = r.cents
    if (cents != null) {
        if (r.figure?.status == MobilePeriodFigureDto.STATUS_NO_START) parts += "bought in ${period.spoken}, partial"
        percentWords(r.ratio)?.let { parts += it }
        parts += when (Format.daySign(cents)) {
            1 -> "${period.spoken} plus ${dollarsWord(cents)}"
            -1 -> "${period.spoken} minus ${dollarsWord(cents)}"
            else -> "${period.spoken} 0 dollars"
        }
    } else {
        parts += when (r.figure?.status) {
            MobilePeriodFigureDto.STATUS_NO_START -> "no price history for ${period.spoken}"
            MobilePeriodFigureDto.STATUS_SPLIT -> "split in this period, no figure"
            MobilePeriodFigureDto.STATUS_NO_COST -> "no cost, no figure"
            else -> "no price"
        }
    }
    if (h.isBullion && h.price != null) parts += "price per ounce ${Format.price(dec(h.price)).removePrefix("$")} dollars"
    decOrNull(h.weightRatio)?.let { parts += "weight ${Format.weight(it).removeSuffix("%")} percent" }
    return parts.joinToString(", ")
}

/** CARDS' Sold line under ALL: `Sold holdings: +$580 · 2 sold`. */
fun soldLineText(f: MobilePeriodFigureDto): String = "$SOLD_LABEL: ${Format.dayMoney(f.cents)} · ${f.soldCount ?: 0} sold"

/** The Sold row's own merged description (never [spokenHolding]). */
fun spokenSold(f: MobilePeriodFigureDto): String {
    val n = f.soldCount ?: 0
    val parts = mutableListOf(SOLD_LABEL, if (n == 1) "1 instrument" else "$n instruments")
    val cents = f.cents
    parts += when {
        cents == null -> "no all-time figure"
        Format.daySign(cents) > 0 -> "all-time gain plus ${dollarsWord(cents)}"
        Format.daySign(cents) < 0 -> "all-time loss minus ${dollarsWord(cents)}"
        else -> "all-time gain 0 dollars"
    }
    percentWords(decOrNull(f.ratio))?.let { parts += it }
    return parts.joinToString(", ")
}

private fun holdingsHave(n: Int) = if (n == 1) "1 holding has" else "$n holdings have"

/** The partial note (D165): "Partial: 3 holdings have no figure for 1W."; null when the total is complete. */
fun partialText(dto: MobilePeriodDto, period: Period): String? =
    if (!dto.totals.partial) null else "Partial: ${holdingsHave(dto.totals.missing)} no figure for ${period.chip}."

/** MOVERS' footer: "No figure for 1W: 3". */
fun noFigureText(dto: MobilePeriodDto, period: Period): String = "No figure for ${period.chip}: ${dto.totals.missing}"

/** `Since 05/09/2030` (S; ALL: the line's first date, or nothing). */
fun sinceText(dto: MobilePeriodDto, period: Period): String? {
    val d = if (period == Period.ALL) date(dto.line?.from) else date(dto.startDate)
    return d?.let { "Since " + DMY.format(it) }
}

/** The line's three labels: the first point's date, the date of `points[size / 2]` and "Today" (ALL: dd/mm/yyyy). */
fun lineLabels(points: List<String>, period: Period): Triple<String, String, String>? {
    if (points.isEmpty()) return null
    val fmt = if (period == Period.ALL) DMY else DM
    fun f(s: String) = date(s)?.let { fmt.format(it) } ?: s
    return Triple(f(points.first()), f(points[points.size / 2]), "Today")
}

/** ALL's caption (D167): `Line: today's holdings, unrealised · realised +$480 not drawn`. */
fun allLineCaption(dto: MobilePeriodDto): String {
    val realised = dto.totals.realisedCents
    val head = "Line: today's holdings, unrealised"
    return if (realised == null || Format.daySign(realised) == 0) head else "$head · realised ${Format.dayMoney(realised)} not drawn"
}

/** The period line's spoken summary (plan section 9.4). */
fun spokenPeriodLine(dto: MobilePeriodDto, period: Period): String {
    val totals = dto.totals
    if (period == Period.ALL) {
        val end = dto.line?.points?.lastOrNull()?.second ?: totals.unrealisedCents
        val head = "All-time line of today's holdings, unrealised gain"
        val ending = when {
            end == null -> ""
            Format.daySign(end) > 0 -> ", ending up ${dollarsWord(end)}"
            Format.daySign(end) < 0 -> ", ending down ${dollarsWord(end)}"
            else -> ", ending at 0 dollars"
        }
        val realised = totals.realisedCents
        val tail = if (realised == null || Format.daySign(realised) == 0) {
            ""
        } else {
            val word = if (realised > 0) "gains" else "losses"
            "; realised $word of ${dollarsWord(realised)} are in the all-time total but not in the line"
        }
        return head + ending + tail
    }
    val since = date(dto.startDate)?.let { " since " + SPOKEN_DATE.format(it) } ?: ""
    val cents = totals.cents ?: return "Change over ${period.spoken}$since: no figure"
    val dir = when (Format.daySign(cents)) {
        1 -> "up"
        -1 -> "down"
        else -> "unchanged"
    }
    val pct = decOrNull(totals.ratio)?.let { " " + Format.percent(it).removeSuffix("%") + " percent," } ?: ","
    val partial = if (totals.partial) "; partial, ${holdingsHave(totals.missing)} no figure" else ""
    return "Change over ${period.spoken}$since, $dir$pct ${dollarsWord(cents)}$partial"
}

/** The figure block's spoken summary. */
fun spokenPeriodFigure(dto: MobilePeriodDto, period: Period): String {
    val cents = dto.totals.cents ?: return "${period.spoken}: no figure"
    val sign = when (Format.daySign(cents)) {
        1 -> "plus "
        -1 -> "minus "
        else -> ""
    }
    val pct = percentWords(decOrNull(dto.totals.ratio))?.let { ", $it" } ?: ""
    return "${period.spoken}, $sign${dollarsWord(cents)}$pct"
}

/** "Price history to 10/09." when the oldest series' newest close is more than six days before `localDate`. */
fun staleHistoryText(answer: MobilePeriodsResponse): String? {
    val through = date(answer.closesThrough) ?: return null
    val local = date(answer.localDate) ?: return null
    return if (ChronoUnit.DAYS.between(through, local) > CLOSES_STALE_NOTE_DAYS) "Price history to ${DM.format(through)}." else null
}

/**
 * D155/D168 under a period: VAL from the periods answer, INVESTED from `/today` (costs do not move with prices), GAIN =
 * VAL − INVESTED, with the D155 "—" rules (an unknown cost → INVESTED and GAIN unknown; an unpriced holding → GAIN unknown).
 */
fun periodInvestedTotals(today: MobileTodayResponse, answer: MobilePeriodsResponse): InvestedTotals {
    val base = investedTotals(today)
    val unpriced = answer.holdings.count { it.valueCents == null }
    val invested = base.investedCents
    val gain = if (invested == null || unpriced > 0) null else answer.valueCents - invested
    val ratio = if (gain == null || invested == null || invested <= 0L) {
        null
    } else {
        BigDecimal(gain).divide(BigDecimal(invested), MathContext(12, RoundingMode.HALF_UP))
    }
    return InvestedTotals(answer.valueCents, invested, gain, ratio, base.unknownCost, unpriced)
}

/** Which body Today shows under a period (plan section 9.4, "Empty branches by period"). */
enum class PeriodBody {
    /** No answer yet: the skeleton. */
    LOADING,

    /** No answer and an error: only the notices. */
    UNAVAILABLE,

    /** Nothing ever bought: the Stage 9 empty sentence. */
    EMPTY,

    /** Nothing held, sales recorded, under 1W–12M: the figure block and "Nothing is held now.". */
    NOTHING_HELD,

    /** The figure block, the line (or its note), the tabs and the rows. */
    FULL,
}

fun periodBody(answer: MobilePeriodsResponse?, period: Period, error: ApiError?): PeriodBody {
    if (answer == null) return if (error == null) PeriodBody.LOADING else PeriodBody.UNAVAILABLE
    if (answer.holdings.isNotEmpty()) return PeriodBody.FULL
    val sold = answer.periodOf(Period.ALL)?.soldFigure() != null
    return when {
        !sold -> PeriodBody.EMPTY
        period == Period.ALL -> PeriodBody.FULL
        else -> PeriodBody.NOTHING_HELD
    }
}

/** Whether a cached answer needs a fetch when a non-1D chip is shown (plan section 9.3 (b)). */
fun periodsStale(periodsFetchedAtMs: Long?, todayFetchedAtMs: Long?, nowMs: Long): Boolean =
    periodsFetchedAtMs == null || nowMs - periodsFetchedAtMs > PERIODS_MAX_AGE_MS ||
        (todayFetchedAtMs != null && periodsFetchedAtMs < todayFetchedAtMs)

/** Whether to warm the cache on open under 1D (plan section 9.3 (c)): absent or older than 30 minutes. */
fun periodsWarmNeeded(periodsFetchedAtMs: Long?, nowMs: Long): Boolean =
    periodsFetchedAtMs == null || nowMs - periodsFetchedAtMs > PERIODS_MAX_AGE_MS

/** The period line as chart values (cents, by index: each point takes the same width, plan section 9.4). */
fun periodLineValues(dto: MobilePeriodDto): List<Long> = dto.line?.points?.map { it.second }.orEmpty()

/** A plain `YYYY-MM-DD` as `dd/mm/yyyy` (or the text itself). */
fun periodDateDmy(iso: String?): String = date(iso)?.let { DMY.format(it) } ?: Format.DASH

/** A plain `YYYY-MM-DD` as `dd/mm` (or the text itself). */
fun periodDateDm(iso: String?): String = date(iso)?.let { DM.format(it) } ?: Format.DASH

/** The detail's rows under a period (D169, plan section 9.5), pure so the tests can read them. */
fun periodDetailRows(answer: MobilePeriodsResponse, today: MobileTodayResponse?, h: MobilePeriodHoldingDto, period: Period): List<Pair<String, String>> {
    val dto = answer.periodOf(period)
    val f = dto?.figureOf(h.key)
    val perOz = if (h.isBullion) " per oz" else ""
    val zone = Times.zone(answer.timeZone)
    val rows = mutableListOf<Pair<String, String>>()
    rows += "Price" to (Format.price(decOrNull(h.price)) + if (h.price != null) perOz else "")
    val word = periodStatusWord(f)
    if (period == Period.ALL) {
        rows += "Unrealised" to Format.signedMoneyCents(f?.unrealisedCents)
        rows += "Realised" to Format.signedMoneyCents(f?.realisedCents)
        val gain = if (f?.isOk == true) f.cents else null
        rows += "All-time gain" to (
            if (gain == null) {
                Format.DASH + (word?.let { " · $it" } ?: "")
            } else {
                Format.signedMoneyCents(gain) + " (" + Format.signedPercent(decOrNull(f?.ratio)) + ")"
            }
            )
        rows += "Cost of everything bought" to Format.moneyCents(f?.costEverCents)
    } else {
        val cents = f?.cents?.takeIf { f.isOk || f.status == MobilePeriodFigureDto.STATUS_NO_START }
        rows += "${period.chip} change" to (
            if (cents == null) {
                Format.DASH + (word?.let { " · $it" } ?: "")
            } else {
                Format.signedMoneyCents(cents) + " (" + Format.arrowPercent(decOrNull(f.ratio)) + ")" +
                    if (f.status == MobilePeriodFigureDto.STATUS_NO_START) " · PARTIAL" else ""
            }
            )
        rows += "Start close" to (
            decOrNull(f?.startClose)?.let { Format.price(it) + perOz + " · " + periodDateDmy(f?.startCloseDate) } ?: Format.DASH
            )
        val change = decOrNull(f?.changePerUnit)
        rows += (if (h.isBullion) "Change per ounce" else "Change per unit") to (
            if (change == null) {
                Format.DASH
            } else {
                val arrow = when (change.signum()) {
                    1 -> Format.UP + " "
                    -1 -> Format.DOWN + " "
                    else -> ""
                }
                arrow + Format.unitChange(change) + perOz + (decOrNull(f?.priceRatio)?.let { " (" + Format.percent(it) + ")" } ?: "")
            }
            )
        rows += "Held at start" to Format.units(dec(f?.startUnits ?: "0"), h.kind)
        val bought = dec(f?.newUnits ?: "0")
        rows += "Bought in ${period.chip}" to (
            Format.units(bought, h.kind) + if (bought.signum() > 0) " (measured from purchase price)" else ""
            )
    }
    // The position rows (as the Stage 9 detail), from the same answer; ALL drops "Unrealised gain" (its own row above).
    val position = today?.holdings?.firstOrNull { it.key == h.key }?.position
    rows += "Units" to Format.units(dec(h.units), h.kind)
    rows += "Value" to Format.moneyCents(h.valueCents)
    rows += "Weight" to Format.weight(decOrNull(h.weightRatio))
    rows += "Cost" to Format.moneyCents(position?.costCents)
    if (period != Period.ALL) {
        rows += "Unrealised gain" to (
            if (position?.unrealisedCents == null) {
                Format.DASH
            } else {
                Format.signedMoneyCents(position.unrealisedCents) + " (" + Format.signedPercent(decOrNull(position.unrealisedRatio)) + ")"
            }
            )
    }
    rows += "Average price" to (decOrNull(position?.averagePrice)?.let { Format.price(it) + perOz } ?: Format.DASH)
    if (h.isBullion) rows += "Items" to "${h.items ?: 0} on the Other Assets page"
    val asOf = Times.instant(h.priceAsOf)
    val priceWord = when (h.priceStatus) {
        "fresh" -> "FRESH"
        "stale" -> "STALE"
        "failed" -> "FAILED"
        "manual" -> "HAND PRICE"
        else -> "NO PRICE"
    }
    rows += "Price as at" to ((asOf?.let { Times.dmyHm(it, zone) + " · " } ?: "") + priceWord)
    return rows
}

/** A percentage helper for tests and labels: the ratio × 100 at two decimals. */
internal fun pct2(ratio: BigDecimal): BigDecimal = (ratio * HUNDRED).setScale(2, RoundingMode.HALF_UP)

/**
 * The notices under a period (plan sections 9.4 and 9.6): Today's own notices with "Figures from …" following the periods
 * answer's fetch time; a 404 on `/periods` → the 1.3.0 line (never the Stage 9 "1.2.0" sentence); any other periods error
 * (when Today itself is fine) → one line with Retry, and the cached answer's age.
 */
fun periodNotices(
    today: MobileTodayResponse?,
    todayError: ApiError?,
    periods: MobilePeriodsResponse?,
    periodsFetchedAtMs: Long?,
    periodsError: ApiError?,
    nowMs: Long,
    noScreenLock: Boolean,
): List<Notice> {
    val out = todayNotices(today, periodsFetchedAtMs.takeIf { periods != null }, nowMs, todayError, noScreenLock).toMutableList()
    when {
        periodsError == null || periodsError == ApiError.Revoked -> Unit
        periodsError == ApiError.ServerTooOld -> out += Notice(Notice.Kind.IMPORTANT, PERIODS_TOO_OLD_TEXT)
        todayError == null -> {
            out += Notice(Notice.Kind.IMPORTANT, PERIODS_FAILED_TEXT, retry = true)
            if (periods != null && periodsFetchedAtMs != null) {
                val zone = Times.zone(periods.timeZone)
                out += Notice(
                    Notice.Kind.NOTE,
                    "Figures from ${Times.hm(java.time.Instant.ofEpochMilli(periodsFetchedAtMs), zone)} (${Times.ago(periodsFetchedAtMs, nowMs)})",
                )
            }
        }
    }
    return out
}

/**
 * How much the figures are dimmed: 1D exactly as Stage 9 (Today's error 0.6, a refresh 0.8; the periods state never
 * counts); under a period by the cached answer (an error 0.6, a refresh or periods fetch 0.8).
 */
fun screenDim(
    period: Period,
    hasToday: Boolean,
    todayError: ApiError?,
    refreshing: Boolean,
    hasPeriods: Boolean,
    periodsError: ApiError?,
    periodsLoading: Boolean,
): Float = if (period.isDay) {
    when {
        hasToday && todayError != null -> 0.6f
        hasToday && refreshing -> 0.8f
        else -> 1f
    }
} else {
    when {
        hasPeriods && (todayError != null || (periodsError != null && periodsError != ApiError.ServerTooOld)) -> 0.6f
        hasPeriods && (refreshing || periodsLoading) -> 0.8f
        else -> 1f
    }
}
