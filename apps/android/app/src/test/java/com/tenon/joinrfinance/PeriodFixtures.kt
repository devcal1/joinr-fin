package com.tenon.joinrfinance

import com.tenon.joinrfinance.net.ApiJson
import com.tenon.joinrfinance.net.MobilePeriodFigureDto
import com.tenon.joinrfinance.net.MobilePeriodsResponse
import java.time.Instant

/** The JSON copies of the Stage 10 periods fixtures (`packages/schema/src/fixtures/mobile.ts` `mobilePeriods`, plan section 3.6). */
object PeriodFixtures {
    val FILES = listOf("periods-open.json", "periods-no-history.json", "periods-sold-only.json", "periods-empty.json")

    fun periods(name: String): MobilePeriodsResponse =
        ApiJson.decodeFromString(MobilePeriodsResponse.serializer(), Fixtures.text("periods-$name.json"))

    val open: MobilePeriodsResponse get() = periods("open")
    val noHistory: MobilePeriodsResponse get() = periods("no-history")
    val soldOnly: MobilePeriodsResponse get() = periods("sold-only")
    val empty: MobilePeriodsResponse get() = periods("empty")

    fun generatedMs(p: MobilePeriodsResponse): Long = Instant.parse(p.generatedAt).toEpochMilli()

    /**
     * The `open` answer with one made-up NO COST figure (no fixture has one, step 0's note): the silver holding under ALL
     * becomes `no_cost` with no cents, and the ALL totals drop its figure (partial, one more missing).
     */
    fun withNoCost(): MobilePeriodsResponse {
        val p = open
        return p.copy(
            periods = p.periods.map { d ->
                if (d.period != "ALL") return@map d
                val silver = d.figures.first { it.key == "bullion-silver" }
                val cents = silver.cents ?: 0L
                d.copy(
                    totals = d.totals.copy(cents = d.totals.cents?.minus(cents), missing = d.totals.missing + 1, partial = true, up = d.totals.up - 1),
                    figures = d.figures.map { f ->
                        if (f.key == "bullion-silver") {
                            f.copy(status = MobilePeriodFigureDto.STATUS_NO_COST, cents = null, ratio = null, unrealisedCents = null, line = null)
                        } else {
                            f
                        }
                    },
                )
            },
        )
    }

    /** The `open` answer with a made-up seven-digit ALL total and realised part (for the one-line layout checks). */
    fun sevenDigitAll(): MobilePeriodsResponse {
        val p = open
        return p.copy(
            periods = p.periods.map { d ->
                if (d.period != "ALL") d else d.copy(totals = d.totals.copy(cents = -123_456_789L, realisedCents = 98_765_432L))
            },
        )
    }

    /** The `open` answer with one figure's ratio replaced in every period (e.g. a made-up two-digit bought-in ratio). */
    fun withRatio(key: String, ratio: String): MobilePeriodsResponse {
        val p = open
        return p.copy(periods = p.periods.map { d -> d.copy(figures = d.figures.map { f -> if (f.key == key) f.copy(ratio = ratio) else f }) })
    }

    /** The `open` answer with a made-up Sold figure of [cents] under ALL (for the Sold line's layout check). */
    fun withSoldCents(cents: Long): MobilePeriodsResponse {
        val p = open
        return p.copy(
            periods = p.periods.map { d ->
                if (d.period != "ALL") {
                    d
                } else {
                    d.copy(figures = d.figures.map { f -> if (f.isSold) f.copy(cents = cents, realisedCents = cents) else f })
                }
            },
        )
    }
}
