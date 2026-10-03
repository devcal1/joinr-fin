package com.tenon.joinrfinance.ui.detail

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tenon.joinrfinance.model.Format
import com.tenon.joinrfinance.model.Spark
import com.tenon.joinrfinance.model.Times
import com.tenon.joinrfinance.model.dayTone
import com.tenon.joinrfinance.model.sessionText
import com.tenon.joinrfinance.model.toneOf
import com.tenon.joinrfinance.net.MobileHoldingDto
import com.tenon.joinrfinance.net.MobileTodayResponse
import com.tenon.joinrfinance.net.dec
import com.tenon.joinrfinance.net.decOrNull
import com.tenon.joinrfinance.ui.components.JoinrIcons
import com.tenon.joinrfinance.ui.components.KeyValueTable
import com.tenon.joinrfinance.ui.components.SpectrumRule
import com.tenon.joinrfinance.ui.components.drawSpark
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.ui.theme.JoinrType
import java.math.BigDecimal

/** A holding's detail (plan section 9.7): the large chart (drag to read) and the key–value table. */
@Composable
fun DetailScreen(today: MobileTodayResponse, holding: MobileHoldingDto?, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().background(JoinrColors.Ink).testTag("detail")) {
        SpectrumRule()
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .clickable(onClickLabel = "Back", role = Role.Button, onClick = onBack)
                    .semantics { contentDescription = "Back" }
                    .testTag("back"),
                contentAlignment = Alignment.Center,
            ) {
                Icon(JoinrIcons.Back, contentDescription = null, tint = JoinrColors.TextSecondary, modifier = Modifier.size(20.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(holding?.code ?: "", style = JoinrType.figure(size = 16.sp, color = JoinrColors.TextBright, weight = FontWeight.W700))
                val sub = holding?.name ?: holding?.symbol
                if (sub != null) Text(sub, style = JoinrType.body(size = 12.sp, color = JoinrColors.TextSecondary), maxLines = 1)
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(JoinrColors.Hairline))
        if (holding == null) {
            Text("No longer held", style = JoinrType.body(color = JoinrColors.TextSecondary), modifier = Modifier.padding(16.dp).testTag("not-held"))
            return@Column
        }
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .testTag("detail-scroll")
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            LargeChart(today, holding)
            KeyValueTable(detailRows(today, holding), valueColor = { label -> valueTint(label, holding) })
        }
    }
}

private fun valueTint(label: String, h: MobileHoldingDto) = when {
    label == "Day $" || label == "Day %" || label == "Change per unit" || label == "Change per ounce" ->
        JoinrColors.textTone(if (h.isOk) dayTone(h) else com.tenon.joinrfinance.model.Tone.NONE)
    label.startsWith("Day % in") -> JoinrColors.textTone(toneOf(Format.percentSign(decOrNull(h.native?.dayRatio))))
    else -> JoinrColors.Text
}

/** A price in its own currency: `$112.40` for AUD, `101.00 USD` otherwise. */
private fun nativePrice(value: BigDecimal, currency: String): String =
    if (currency == "AUD") Format.price(value) else Format.price(value).removePrefix("$") + " " + currency

/** A point of the holding line: its own currency; bullion: the AUD spot per ounce (D153), not the futures USD. */
private fun linePrice(h: MobileHoldingDto, value: BigDecimal): String =
    if (h.isBullion) Format.price(value) + " per oz" else nativePrice(value, h.native?.currency ?: "AUD")

@Composable
private fun LargeChart(today: MobileTodayResponse, h: MobileHoldingDto) {
    val line = h.line
    val zone = Times.zone(today.timeZone)
    if (line == null || line.points.isEmpty()) {
        Box(
            Modifier.fillMaxWidth().height(80.dp).clip(RoundedCornerShape(6.dp)).background(JoinrColors.Surface).padding(12.dp).testTag("no-chart"),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(
                if (h.kind == MobileHoldingDto.KIND_FUND || h.session?.daily == true) "Daily price: no intraday line." else "No line for this session.",
                style = JoinrType.body(size = 13.sp, color = JoinrColors.TextSecondary),
            )
        }
        return
    }
    val tone = dayTone(h)
    val times = LongArray(line.points.size) { line.points[it].first }
    val values = DoubleArray(line.points.size) { dec(line.points[it].second).toDouble() }
    val base = decOrNull(line.base)?.toDouble()
    var selected by remember(h.key) { mutableStateOf<Int?>(null) }
    val readout = selected?.let { i ->
        val idx = i.coerceIn(0, line.points.size - 1)
        Times.hm(line.points[idx].first, zone) + " · " + linePrice(h, dec(line.points[idx].second))
    }
    val summary = buildString {
        append("${h.code} price since ${Times.hm(times.first(), zone)}")
        decOrNull(h.dayRatio)?.let { r ->
            append(
                when (Format.percentSign(r)) {
                    1 -> ", up ${Format.percent(r).removeSuffix("%")} percent"
                    -1 -> ", down ${Format.percent(r).removeSuffix("%")} percent"
                    else -> ", unchanged"
                },
            )
        }
        append(", last ${linePrice(h, dec(line.points.last().second))}")
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            readout ?: "Drag the chart to read a price",
            style = if (readout != null) JoinrType.figure(size = 12.sp, color = JoinrColors.TextBright) else JoinrType.body(size = 12.sp, color = JoinrColors.TextMuted),
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("readout"),
        )
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(200.dp)
                .semantics { contentDescription = summary }
                .testTag("large-chart")
                .pointerInput(h.key) {
                    detectTapGestures { pos ->
                        val g = Spark.geometry(times, values, base, size.width.toFloat(), size.height.toFloat(), 6f)
                        selected = Spark.nearestIndex(g, pos.x).coerceAtMost(times.size - 1)
                    }
                }
                .pointerInput(h.key + "drag") {
                    detectDragGestures(onDragEnd = { }) { change, _ ->
                        val g = Spark.geometry(times, values, base, size.width.toFloat(), size.height.toFloat(), 6f)
                        selected = Spark.nearestIndex(g, change.position.x).coerceAtMost(times.size - 1)
                    }
                },
        ) {
            val g = Spark.geometry(times, values, base, size.width, size.height, 6.dp.toPx())
            drawSpark(g, JoinrColors.markTone(tone), 0.16f, 2.dp.toPx(), 4.dp.toPx())
            selected?.let { i ->
                val idx = i.coerceIn(0, g.size - 1)
                drawLine(JoinrColors.TextSecondary, Offset(g.xs[idx], 0f), Offset(g.xs[idx], size.height), strokeWidth = 1.dp.toPx())
                drawCircle(JoinrColors.Surface, radius = 6.dp.toPx(), center = Offset(g.xs[idx], g.ys[idx]))
                drawCircle(JoinrColors.markTone(tone), radius = 4.dp.toPx(), center = Offset(g.xs[idx], g.ys[idx]))
            }
        }
        val first = times.first()
        val last = times.last()
        Row(Modifier.fillMaxWidth()) {
            val style = JoinrType.figure(size = 11.sp, color = JoinrColors.TextMuted)
            Text(Times.hm(first, zone), style = style)
            Spacer(Modifier.weight(1f))
            Text(Times.hm(first + (last - first) / 2, zone), style = style)
            Spacer(Modifier.weight(1f))
            Text(Times.hm(last, zone), style = style)
        }
    }
}

/** The detail table's rows (plan section 9.7), pure so the tests can read them. */
fun detailRows(today: MobileTodayResponse, h: MobileHoldingDto): List<Pair<String, String>> {
    val zone = Times.zone(today.timeZone)
    val perOz = if (h.isBullion) " per oz" else ""
    val unitWord = if (h.isBullion) "Change per ounce" else "Change per unit"
    val rows = mutableListOf<Pair<String, String>>()
    rows += "Price" to (Format.price(decOrNull(h.price)) + if (h.price != null) perOz else "")
    val change = decOrNull(h.changePerUnit)
    rows += unitWord to (
        if (h.isOk && change != null) {
            when (change.signum()) {
                1 -> Format.UP + " " + Format.unitChange(change)
                -1 -> Format.DOWN + " " + Format.unitChange(change)
                else -> Format.unitChange(change)
            } + perOz
        } else {
            Format.DASH
        }
        )
    rows += "Day $" to (if (h.isOk) Format.signedMoneyCents(h.dayCents) else Format.DASH)
    rows += "Day %" to (if (h.isOk) Format.arrowPercent(decOrNull(h.dayRatio)) else Format.DASH)
    h.native?.let { n -> rows += "Day % in ${n.currency}" to Format.arrowPercent(decOrNull(n.dayRatio)) }
    rows += "Previous close" to (decOrNull(h.previousClose)?.let { Format.price(it) + perOz } ?: Format.DASH)
    rows += "Units" to Format.units(dec(h.units), h.kind)
    val newUnits = dec(h.newUnits)
    if (newUnits.signum() > 0) {
        rows += "New today" to (
            Format.units(newUnits, h.kind) +
                if (h.isBullion) " (bought today, measured from cost)" else " (measured from purchase price)"
            )
    }
    rows += "Value" to Format.moneyCents(h.valueCents)
    rows += "Weight" to Format.weight(decOrNull(h.weightRatio))
    rows += "Cost" to Format.moneyCents(h.position.costCents)
    rows += "Unrealised gain" to (
        if (h.position.unrealisedCents == null) {
            Format.DASH
        } else {
            Format.signedMoneyCents(h.position.unrealisedCents) + " (" + Format.signedPercent(decOrNull(h.position.unrealisedRatio)) + ")"
        }
        )
    rows += "Average price" to (decOrNull(h.position.averagePrice)?.let { Format.price(it) + perOz } ?: Format.DASH)
    if (h.isBullion) rows += "Items" to "${h.items ?: 0} on the Other Assets page"
    rows += "Session" to sessionText(h, today)
    val asOf = Times.instant(h.priceAsOf)
    val word = when (h.priceStatus) {
        "fresh" -> "FRESH"
        "stale" -> "STALE"
        "failed" -> "FAILED"
        "manual" -> "HAND PRICE"
        else -> "NO PRICE"
    }
    rows += "Price as at" to ((asOf?.let { Times.dmyHm(it, zone) + " · " } ?: "") + word)
    return rows
}
