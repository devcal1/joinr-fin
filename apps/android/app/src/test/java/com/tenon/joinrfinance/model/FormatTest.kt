package com.tenon.joinrfinance.model

import org.junit.Assert.assertEquals
import org.junit.Test
import java.math.BigDecimal

class FormatTest {
    private val m = Format.MINUS

    @Test
    fun dayFiguresInWholeDollarsWithSignAndRealMinus() {
        assertEquals("+$1,302", Format.dayMoney(130_249))
        assertEquals("+$1,303", Format.dayMoney(130_250)) // half up
        assertEquals("${m}$52", Format.dayMoney(-5_200))
        assertEquals("${m}$1,731", Format.dayMoney(-173_050)) // half away from zero
        assertEquals("$0", Format.dayMoney(0))
        assertEquals("$0", Format.dayMoney(-40)) // rounds to a zero move: no sign
        assertEquals("—", Format.dayMoney(null))
        assertEquals("+1,943", Format.dayShort(194_258))
        assertEquals("${m}407", Format.dayShort(-40_700))
        assertEquals("0", Format.dayShort(0))
    }

    @Test
    fun moneyToTheCent() {
        assertEquals("$5,555.00", Format.moneyCents(555_500))
        assertEquals("${m}$12.40", Format.moneyCents(-1_240))
        assertEquals("+$53.00", Format.signedMoneyCents(5_300))
        assertEquals("${m}$88.11", Format.signedMoneyCents(-8_811))
        assertEquals("$0.00", Format.signedMoneyCents(0))
        assertEquals("186,965", Format.valueShort(18_696_500))
        assertEquals("$120,630", Format.valueWhole(12_062_996))
    }

    @Test
    fun prices() {
        assertEquals("$112.40", Format.price(BigDecimal("112.4")))
        assertEquals("$164,820.00", Format.price(BigDecimal("164820")))
        assertEquals("$0.5000", Format.price(BigDecimal("0.5")))
        assertEquals("$0.001235", Format.price(BigDecimal("0.0012345")))
        assertEquals("$0.00000001", Format.price(BigDecimal("0.00000001")))
        assertEquals("164,820", Format.priceShort(BigDecimal("164820")))
        assertEquals("1,000", Format.priceShort(BigDecimal("1000.4")))
        assertEquals("112.40", Format.priceShort(BigDecimal("112.4")))
        assertEquals("0.5000", Format.priceShort(BigDecimal("0.5")))
        assertEquals("—", Format.price(null))
    }

    @Test
    fun percentagesWithTwoDecimalsAndArrows() {
        assertEquals("▲ 1.42%", Format.arrowPercent(BigDecimal("0.0142")))
        assertEquals("▼ 2.15%", Format.arrowPercent(BigDecimal("-0.0215")))
        assertEquals("0.00%", Format.arrowPercent(BigDecimal("0")))
        assertEquals("0.00%", Format.arrowPercent(BigDecimal("0.00004"))) // a zero move once rounded: no arrow
        assertEquals("▲0.70%", Format.arrowPercent(BigDecimal("0.007"), space = false))
        assertEquals("▲1.82", Format.arrowPercentShort(BigDecimal("0.0182286549599")))
        assertEquals("▼0.55", Format.arrowPercentShort(BigDecimal("-0.005538461536")))
        assertEquals("+28.68%", Format.signedPercent(BigDecimal("0.286811267606")))
        assertEquals("${m}1.02%", Format.signedPercent(BigDecimal("-0.0102272727273")))
        // Grouped like every other figure (the web's decimalBody).
        assertEquals("3,179.39%", Format.percent(BigDecimal("31.7939")))
        assertEquals("▲3,179.39", Format.arrowPercentShort(BigDecimal("31.7939")))
        assertEquals("+3,179.39%", Format.signedPercent(BigDecimal("31.7939")))
        assertEquals("▼ 1,000.00%", Format.arrowPercent(BigDecimal("-10")))
    }

    @Test
    fun weightsUnitsAndChanges() {
        assertEquals("68.0%", Format.weight(BigDecimal("0.679764794749")))
        assertEquals("0.5", Format.units(BigDecimal("0.5"), "crypto"))
        assertEquals("0.12345679", Format.units(BigDecimal("0.123456789"), "crypto"))
        assertEquals("110", Format.units(BigDecimal("110"), "etf"))
        assertEquals("1,000.1235", Format.units(BigDecimal("1000.12345"), "managed_fund"))
        assertEquals("150.0000 oz", Format.units(BigDecimal("150"), "bullion"))
        assertEquals("1.58", Format.unitChange(BigDecimal("1.575")))
        assertEquals("0.47", Format.unitChange(BigDecimal("-0.472027972028")))
        assertEquals("0.01500", Format.unitChange(BigDecimal("0.015")))
        assertEquals("0.00", Format.unitChange(BigDecimal.ZERO))
        assertEquals("4,000", Format.unitChange(BigDecimal("4000")))
    }

    @Test
    fun agesStepFromMinutesToHoursToDays() {
        assertEquals("25 min", Times.age(25))
        assertEquals("3 h", Times.age(180))
        assertEquals("40 h", Times.age(2420)) // under 48 h
        assertEquals("3 d", Times.age(3 * 24 * 60))
        assertEquals("5 min ago", Times.ago(0, 5 * 60_000L))
        assertEquals("40 h ago", Times.ago(0, 2420 * 60_000L))
        assertEquals("just now", Times.ago(0, 30_000L))
    }

    @Test
    fun compactMoneyForATightWidget() {
        assertEquals("$9,999", Format.compactMoney(999_900))
        assertEquals("$10k", Format.compactMoney(1_000_000))
        assertEquals("$187k", Format.compactMoney(18_696_500))
        assertEquals("$999k", Format.compactMoney(99_949_900))
        assertEquals("$1.00M", Format.compactMoney(99_950_000)) // never "1000k"
        assertEquals("$1.23M", Format.compactMoney(123_456_789))
        assertEquals("$1.23B", Format.compactMoney(123_456_789_000))
        assertEquals("${m}$187k", Format.compactMoney(-18_696_500))
        assertEquals("${m}$12k", Format.compactMoney(-1_234_500, signed = true))
        assertEquals("+$1,943", Format.compactMoney(194_258, signed = true))
        assertEquals("$0", Format.compactMoney(0, signed = true))
        assertEquals("$0", Format.compactMoney(-40, signed = true)) // a zero move: no sign
        assertEquals("—", Format.compactMoney(null))
    }
}
