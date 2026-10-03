package com.tenon.joinrfinance.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tenon.joinrfinance.model.Format
import com.tenon.joinrfinance.model.SortOrder
import com.tenon.joinrfinance.model.Tone
import com.tenon.joinrfinance.model.dayDollarsTone
import com.tenon.joinrfinance.model.moverRows
import com.tenon.joinrfinance.model.spokenHolding
import com.tenon.joinrfinance.model.statusWord
import com.tenon.joinrfinance.model.toneOf
import com.tenon.joinrfinance.net.MobileHoldingDto
import com.tenon.joinrfinance.net.MobileTodayResponse
import com.tenon.joinrfinance.net.decOrNull
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.ui.theme.JoinrType
import kotlin.math.abs

/** The row keeps 8 dp at each edge and 8 dp between columns (as the mock: 8 px row padding, no cell padding). */
private fun startPad(c: Int): Dp = if (c == 0) 8.dp else 4.dp
private fun endPad(c: Int): Dp = if (c == 4) 8.dp else 4.dp
/** Added to every measured column: covers the pixel rounding of the text and of its two paddings. */
private val ROUNDING_SLACK = 1.dp

private fun Modifier.cellPadding(c: Int): Modifier = this.padding(start = startPad(c), end = endPad(c))

/** One LIST cell: its text, tint and weight. */
private data class Cell(val text: String, val color: Color = JoinrColors.Text, val bold: Boolean = false)

/**
 * LIST (plan section 9.7): SYM · LAST · CHG% · CHG$ · VALUE, rows ≥ 40 dp, right-aligned mono figures. Each column is
 * as wide as its widest formatted value at the current font scale (measured with a TextMeasurer); the SYM column stays
 * put while the figures scroll sideways when they do not fit.
 */
@Composable
fun HoldingsTable(
    today: MobileTodayResponse,
    sorted: List<MobileHoldingDto>,
    sort: SortOrder,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val figure = JoinrType.figure(size = 12.5.sp)
    val figureBold = figure.copy(fontWeight = FontWeight.W700)
    val header = JoinrType.label(size = 11.sp, tracking = 0.1f)
    val word = JoinrType.label(size = 9.sp, tracking = 0.08f, color = JoinrColors.TextMuted)

    val headers = listOf("SYM", "LAST", "CHG%", "CHG$", "VALUE").mapIndexed { i, label ->
        val marked = (i == 2 && sort == SortOrder.DAY_RATIO) || (i == 3 && sort == SortOrder.DAY_CENTS) || (i == 4 && sort == SortOrder.VALUE)
        if (marked) "$label ▼" else label
    }
    val rows: List<List<Cell>> = sorted.map { h ->
        val tint = JoinrColors.textTone(dayDollarsTone(h))
        listOf(
            Cell(h.code, JoinrColors.TextBright, bold = true),
            Cell(Format.priceShort(decOrNull(h.price))),
            if (h.isOk) Cell(Format.arrowPercentShort(decOrNull(h.dayRatio)), JoinrColors.textTone(toneOf(Format.percentSign(decOrNull(h.dayRatio)))), bold = true) else Cell(Format.DASH, JoinrColors.TextSecondary),
            if (h.isOk) Cell(Format.dayShort(h.dayCents), tint) else Cell(Format.DASH, JoinrColors.TextSecondary),
            Cell(Format.valueShort(h.valueCents)),
        )
    }
    val totalRatio = decOrNull(today.totals.dayRatio)
    val total = listOf(
        Cell("TOTAL", JoinrColors.TextBright, bold = true),
        Cell(""),
        Cell(Format.arrowPercentShort(totalRatio), JoinrColors.TextBright, bold = true),
        Cell(Format.dayShort(today.totals.dayCents), JoinrColors.Teal, bold = true),
        Cell(Format.valueShort(today.totals.valueCents), JoinrColors.TextBright, bold = true),
    )
    val words = sorted.map { h -> statusWord(h, today, withDate = false) }

    fun widthOf(text: String, style: TextStyle): Dp = with(density) { measurer.measure(text, style).size.width.toDp() }
    fun heightOf(text: String, style: TextStyle): Dp = with(density) { measurer.measure(text, style).size.height.toDp() }

    val widths = (0 until 5).map { c ->
        val cells = rows.map { it[c] } + total[c]
        val widest = cells.maxOf { widthOf(it.text, if (it.bold) figureBold else figure) }
        val wordWidest = if (c == 0) words.maxOfOrNull { w -> w?.let { widthOf(it, word) } ?: 0.dp } ?: 0.dp else 0.dp
        // + ROUNDING_SLACK: the text and each padding are rounded to pixels separately, so at a fractional density
        // (420 dpi = 2.625×) the cell could end up a pixel narrower than its text.
        maxOf(widest, wordWidest, widthOf(headers[c], header)) + startPad(c) + endPad(c) + ROUNDING_SLACK
    }
    val rowHeight = maxOf(40.dp, heightOf("X", figureBold) + heightOf("X", word) + 10.dp)
    val headerHeight = maxOf(28.dp, heightOf("X", header) + 10.dp)

    BoxWithConstraints(
        modifier
            .padding(horizontal = 16.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(JoinrColors.Surface)
            .testTag("list"),
    ) {
        val needed = widths.fold(0.dp) { a, b -> a + b }
        val extra = (maxWidth - needed).coerceAtLeast(0.dp)
        // LAST takes the slack (the mock's 1fr column).
        val cols = widths.mapIndexed { i, w -> if (i == 1) w + extra else w }
        val scroll = rememberScrollState()
        Row(Modifier.fillMaxWidth()) {
            // The sticky SYM column.
            Column(Modifier.width(cols[0])) {
                HeaderCell(0, headers[0], cols[0], headerHeight, header, TextAlign.Start, highlighted = false)
                sorted.forEachIndexed { r, h ->
                    Box(
                        Modifier
                            .width(cols[0])
                            .height(rowHeight)
                            .background(JoinrColors.Surface)
                            .clickable(onClickLabel = "Open ${h.code}", role = Role.Button) { onOpen(h.key) }
                            .semantics(mergeDescendants = true) { contentDescription = spokenHolding(h) }
                            .cellPadding(0)
                            .testTag("row-${h.key}"),
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        Column {
                            Text(rows[r][0].text, style = figureBold.copy(color = JoinrColors.TextBright), maxLines = 1, softWrap = false)
                            words[r]?.let { Text(it, style = word, maxLines = 1, softWrap = false, modifier = Modifier.testTag("listword-${h.key}")) }
                        }
                    }
                    RowRule(cols[0])
                }
                TotalCell(total[0], cols[0], rowHeight, header.copy(color = JoinrColors.TextBright), TextAlign.Start)
            }
            Column(Modifier.weight(1f).horizontalScroll(scroll)) {
                Row {
                    for (c in 1 until 5) {
                        HeaderCell(c, headers[c], cols[c], headerHeight, header, TextAlign.End, highlighted = headers[c].endsWith("▼"))
                    }
                }
                sorted.forEachIndexed { r, h ->
                    Row(
                        Modifier
                            .height(rowHeight)
                            .clickable(onClickLabel = "Open ${h.code}", role = Role.Button) { onOpen(h.key) }
                            .semantics { contentDescription = spokenHolding(h) },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        for (c in 1 until 5) {
                            val cell = rows[r][c]
                            Text(
                                cell.text,
                                style = (if (cell.bold) figureBold else figure).copy(color = cell.color),
                                textAlign = TextAlign.End,
                                maxLines = 1,
                                softWrap = false,
                                modifier = Modifier.width(cols[c]).cellPadding(c),
                            )
                        }
                    }
                    Row { for (c in 1 until 5) RowRule(cols[c]) }
                }
                Row(Modifier.height(rowHeight).background(JoinrColors.Raised), verticalAlignment = Alignment.CenterVertically) {
                    for (c in 1 until 5) {
                        val cell = total[c]
                        Text(
                            cell.text,
                            style = figureBold.copy(color = cell.color),
                            textAlign = TextAlign.End,
                            maxLines = 1,
                            softWrap = false,
                            modifier = Modifier.width(cols[c]).cellPadding(c).testTag("total-$c"),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HeaderCell(c: Int, text: String, width: Dp, height: Dp, style: TextStyle, align: TextAlign, highlighted: Boolean) {
    Box(
        Modifier.width(width).height(height).background(JoinrColors.Raised).cellPadding(c),
        contentAlignment = if (align == TextAlign.End) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        // The box aligns the text; a textAlign here would lay the line out at the box's full width.
        Text(text, style = style.copy(color = if (highlighted) JoinrColors.TextBright else style.color), maxLines = 1, softWrap = false)
    }
}

@Composable
private fun TotalCell(cell: Cell, width: Dp, height: Dp, style: TextStyle, align: TextAlign) {
    Box(Modifier.width(width).height(height).background(JoinrColors.Raised).cellPadding(0), contentAlignment = Alignment.CenterStart) {
        Text(cell.text, style = style, textAlign = align, maxLines = 1, softWrap = false)
    }
}

@Composable
private fun RowRule(width: Dp) {
    Box(Modifier.width(width).height(1.dp).background(JoinrColors.Hairline))
}

/**
 * MOVERS (plan section 9.7): `ok` holdings only; a bar from a centre axis scaled to the largest |day $| (go to the
 * right, stop to the left; 16 dp, 4 dp rounded data end); day $ and %; then "No day figure: N".
 */
@Composable
fun MoversList(today: MobileTodayResponse, sort: SortOrder, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val rows = moverRows(today.holdings, sort)
    val figure = JoinrType.figure(size = 12.5.sp)
    val bold = figure.copy(fontWeight = FontWeight.W700)
    fun widthOf(text: String, style: TextStyle): Dp = with(density) { measurer.measure(text, style).size.width.toDp() }
    val codeW = (rows.maxOfOrNull { widthOf(it.holding.code, bold) } ?: 0.dp) + 6.dp
    val dayW = (rows.maxOfOrNull { widthOf(Format.dayShort(it.holding.dayCents), bold) } ?: 0.dp) + 6.dp
    val pctW = (rows.maxOfOrNull { widthOf(Format.arrowPercentShort(decOrNull(it.holding.dayRatio)), figure) } ?: 0.dp) + 6.dp
    Column(modifier.padding(horizontal = 16.dp).testTag("movers")) {
        rows.forEach { row ->
            val h = row.holding
            val tone = h.dayCents?.let { toneOf(it.compareTo(0)) } ?: Tone.NONE
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 40.dp)
                    .clickable(onClickLabel = "Open ${h.code}", role = Role.Button) { onOpen(h.key) }
                    .semantics(mergeDescendants = true) { contentDescription = spokenHolding(h) }
                    .testTag("mover-${h.key}"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(h.code, style = bold.copy(color = JoinrColors.TextBright), maxLines = 1, modifier = Modifier.width(codeW))
                MoverBar(row.fraction, tone, Modifier.weight(1f))
                Text(Format.dayShort(h.dayCents), style = bold.copy(color = JoinrColors.textTone(dayDollarsTone(h))), textAlign = TextAlign.End, maxLines = 1, modifier = Modifier.width(dayW))
                Text(
                    Format.arrowPercentShort(decOrNull(h.dayRatio)),
                    style = figure.copy(color = JoinrColors.textTone(toneOf(Format.percentSign(decOrNull(h.dayRatio))))),
                    textAlign = TextAlign.End,
                    maxLines = 1,
                    modifier = Modifier.width(pctW),
                )
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(JoinrColors.Hairline))
        }
        Text(
            "No day figure: ${today.totals.noChange}",
            style = JoinrType.body(size = 12.sp, color = JoinrColors.TextSecondary),
            modifier = Modifier.padding(top = 10.dp).testTag("movers-nochange"),
        )
    }
}

@Composable
private fun MoverBar(fraction: Float, tone: Tone, modifier: Modifier) {
    BoxWithConstraints(modifier.height(36.dp)) {
        val half = maxWidth / 2
        val len = half * abs(fraction)
        Box(Modifier.align(Alignment.Center).width(1.dp).height(36.dp).background(JoinrColors.DashedBase))
        if (len > 0.dp) {
            val shape = if (fraction > 0) RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp) else RoundedCornerShape(topStart = 4.dp, bottomStart = 4.dp)
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .padding(start = if (fraction > 0) half else half - len)
                    .width(len)
                    .height(16.dp)
                    .clip(shape)
                    .background(JoinrColors.markTone(tone)),
            )
        }
    }
}
