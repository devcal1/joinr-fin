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
import com.tenon.joinrfinance.model.Period
import com.tenon.joinrfinance.model.PeriodRow
import com.tenon.joinrfinance.model.SortOrder
import com.tenon.joinrfinance.model.Tone
import com.tenon.joinrfinance.model.dayDollarsTone
import com.tenon.joinrfinance.model.moverRows
import com.tenon.joinrfinance.model.noFigureText
import com.tenon.joinrfinance.model.periodCardWord
import com.tenon.joinrfinance.model.periodMoverRows
import com.tenon.joinrfinance.model.periodTone
import com.tenon.joinrfinance.model.soldFigure
import com.tenon.joinrfinance.model.spokenHolding
import com.tenon.joinrfinance.model.spokenPeriodHolding
import com.tenon.joinrfinance.model.spokenSold
import com.tenon.joinrfinance.model.statusWord
import com.tenon.joinrfinance.model.toneOf
import com.tenon.joinrfinance.net.MobileHoldingDto
import com.tenon.joinrfinance.net.MobilePeriodDto
import com.tenon.joinrfinance.net.MobilePeriodFigureDto
import com.tenon.joinrfinance.net.MobilePeriodsResponse
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

/** One LIST row: its key, five cells, the word under the code and its spoken text; the SOLD row is not clickable. */
private class ListRow(val key: String, val cells: List<Cell>, val word: String?, val spoken: String, val clickable: Boolean)

/** LIST's headers with the sorted column marked. */
private fun listHeaders(sort: SortOrder): List<String> = listOf("SYM", "LAST", "CHG%", "CHG$", "VALUE").mapIndexed { i, label ->
    val marked = (i == 2 && sort == SortOrder.DAY_RATIO) || (i == 3 && sort == SortOrder.DAY_CENTS) || (i == 4 && sort == SortOrder.VALUE)
    if (marked) "$label ▼" else label
}

/** A row's tap and spoken text: a clickable holding, or the SOLD row (no tap; its own description). */
private fun Modifier.rowAction(row: ListRow, onOpen: (String) -> Unit, merge: Boolean): Modifier = if (row.clickable) {
    this
        .clickable(onClickLabel = "Open ${row.cells[0].text}", role = Role.Button) { onOpen(row.key) }
        .semantics(mergeDescendants = merge) { contentDescription = row.spoken }
} else {
    this.semantics(mergeDescendants = merge) { contentDescription = row.spoken }
}

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
    val rows = sorted.map { h ->
        val tint = JoinrColors.textTone(dayDollarsTone(h))
        ListRow(
            key = h.key,
            cells = listOf(
                Cell(h.code, JoinrColors.TextBright, bold = true),
                Cell(Format.priceShort(decOrNull(h.price))),
                if (h.isOk) Cell(Format.arrowPercentShort(decOrNull(h.dayRatio)), JoinrColors.textTone(toneOf(Format.percentSign(decOrNull(h.dayRatio)))), bold = true) else Cell(Format.DASH, JoinrColors.TextSecondary),
                if (h.isOk) Cell(Format.dayShort(h.dayCents), tint) else Cell(Format.DASH, JoinrColors.TextSecondary),
                Cell(Format.valueShort(h.valueCents)),
            ),
            word = statusWord(h, today, withDate = false),
            spoken = spokenHolding(h),
            clickable = true,
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
    ListTableBody(listHeaders(sort), rows, total, onOpen, modifier)
}

/**
 * LIST under a period (Stage 10 plan section 9.4): the same columns; CHG% and CHG$ are the figure's ratio and cents; a
 * row without a figure shows "—" with its status word under the code; under ALL a SOLD row before the total.
 */
@Composable
fun PeriodHoldingsTable(
    answer: MobilePeriodsResponse,
    dto: MobilePeriodDto,
    sorted: List<PeriodRow>,
    sort: SortOrder,
    period: Period,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    fun pctCell(cents: Long?, ratio: java.math.BigDecimal?) =
        if (cents != null) Cell(Format.arrowPercentShort(ratio), JoinrColors.textTone(toneOf(Format.percentSign(ratio))), bold = true) else Cell(Format.DASH, JoinrColors.TextSecondary)
    fun dollarsCell(cents: Long?) =
        if (cents != null) Cell(Format.dayShort(cents), JoinrColors.textTone(periodTone(cents))) else Cell(Format.DASH, JoinrColors.TextSecondary)
    val rows = sorted.map { r ->
        ListRow(
            key = r.key,
            cells = listOf(
                Cell(r.code, JoinrColors.TextBright, bold = true),
                Cell(Format.priceShort(decOrNull(r.holding.price))),
                pctCell(r.cents, r.ratio),
                dollarsCell(r.cents),
                Cell(Format.valueShort(r.holding.valueCents)),
            ),
            word = periodCardWord(r.holding, r.figure, answer, withDate = false),
            spoken = spokenPeriodHolding(r, period),
            clickable = true,
        )
    }
    val sold = dto.soldFigure()?.let { f ->
        ListRow(
            key = MobilePeriodFigureDto.SOLD_HOLDINGS_KEY,
            cells = listOf(
                Cell("SOLD", JoinrColors.TextBright, bold = true),
                Cell(Format.DASH, JoinrColors.TextSecondary),
                pctCell(f.cents, decOrNull(f.ratio)),
                dollarsCell(f.cents),
                Cell(Format.DASH, JoinrColors.TextSecondary),
            ),
            word = "${f.soldCount ?: 0} SOLD",
            spoken = spokenSold(f),
            clickable = false,
        )
    }
    val totalRatio = decOrNull(dto.totals.ratio)
    val total = listOf(
        Cell("TOTAL", JoinrColors.TextBright, bold = true),
        Cell(""),
        Cell(Format.arrowPercentShort(totalRatio), JoinrColors.TextBright, bold = true),
        Cell(Format.dayShort(dto.totals.cents), JoinrColors.Teal, bold = true),
        Cell(Format.valueShort(answer.valueCents), JoinrColors.TextBright, bold = true),
    )
    ListTableBody(listHeaders(sort), rows + listOfNotNull(sold), total, onOpen, modifier)
}

/** The measured LIST body shared by 1D and the periods. */
@Composable
private fun ListTableBody(headers: List<String>, rows: List<ListRow>, total: List<Cell>, onOpen: (String) -> Unit, modifier: Modifier) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val figure = JoinrType.figure(size = 12.5.sp)
    val figureBold = figure.copy(fontWeight = FontWeight.W700)
    val header = JoinrType.label(size = 11.sp, tracking = 0.1f)
    val word = JoinrType.label(size = 9.sp, tracking = 0.08f, color = JoinrColors.TextMuted)

    fun widthOf(text: String, style: TextStyle): Dp = with(density) { measurer.measure(text, style).size.width.toDp() }
    fun heightOf(text: String, style: TextStyle): Dp = with(density) { measurer.measure(text, style).size.height.toDp() }

    val widths = (0 until 5).map { c ->
        val cells = rows.map { it.cells[c] } + total[c]
        val widest = cells.maxOf { widthOf(it.text, if (it.bold) figureBold else figure) }
        val wordWidest = if (c == 0) rows.maxOfOrNull { r -> r.word?.let { widthOf(it, word) } ?: 0.dp } ?: 0.dp else 0.dp
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
                rows.forEach { r ->
                    Box(
                        Modifier
                            .width(cols[0])
                            .height(rowHeight)
                            .background(JoinrColors.Surface)
                            .rowAction(r, onOpen, merge = true)
                            .cellPadding(0)
                            .testTag("row-${r.key}"),
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        Column {
                            Text(r.cells[0].text, style = figureBold.copy(color = JoinrColors.TextBright), maxLines = 1, softWrap = false)
                            r.word?.let { Text(it, style = word, maxLines = 1, softWrap = false, modifier = Modifier.testTag("listword-${r.key}")) }
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
                rows.forEach { r ->
                    Row(
                        Modifier
                            .height(rowHeight)
                            .rowAction(r, onOpen, merge = false),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        for (c in 1 until 5) {
                            val cell = r.cells[c]
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

/** One MOVERS row: the code, its bar (a fraction of the largest |$|), $ and %; the SOLD row is not clickable. */
private class MoverItem(
    val key: String,
    val code: String,
    val fraction: Float,
    val barTone: Tone,
    val dollars: String,
    val dollarsTone: Tone,
    val percent: String,
    val percentTone: Tone,
    val spoken: String,
    val clickable: Boolean,
)

/**
 * MOVERS (plan section 9.7): `ok` holdings only; a bar from a centre axis scaled to the largest |day $| (go to the
 * right, stop to the left; 16 dp, 4 dp rounded data end); day $ and %; then "No day figure: N".
 */
@Composable
fun MoversList(today: MobileTodayResponse, sort: SortOrder, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val items = moverRows(today.holdings, sort).map { row ->
        val h = row.holding
        val ratio = decOrNull(h.dayRatio)
        MoverItem(
            key = h.key,
            code = h.code,
            fraction = row.fraction,
            barTone = h.dayCents?.let { toneOf(it.compareTo(0)) } ?: Tone.NONE,
            dollars = Format.dayShort(h.dayCents),
            dollarsTone = dayDollarsTone(h),
            percent = Format.arrowPercentShort(ratio),
            percentTone = toneOf(Format.percentSign(ratio)),
            spoken = spokenHolding(h),
            clickable = true,
        )
    }
    MoversBody(items, "No day figure: ${today.totals.noChange}", onOpen, modifier)
}

/** MOVERS under a period: every figure with cents, the SOLD row last under ALL; "No figure for 1W: N". */
@Composable
fun PeriodMoversList(
    dto: MobilePeriodDto,
    rows: List<PeriodRow>,
    sort: SortOrder,
    period: Period,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val items = periodMoverRows(rows, dto, sort).map { m ->
        val sold = m.sold
        MoverItem(
            key = m.key,
            code = m.code,
            fraction = m.fraction,
            barTone = toneOf(m.cents.compareTo(0)),
            dollars = Format.dayShort(m.cents),
            dollarsTone = periodTone(m.cents),
            percent = Format.arrowPercentShort(m.ratio),
            percentTone = toneOf(Format.percentSign(m.ratio)),
            spoken = if (sold != null) spokenSold(sold) else spokenPeriodHolding(m.row!!, period),
            clickable = sold == null,
        )
    }
    MoversBody(items, noFigureText(dto, period), onOpen, modifier)
}

/** The MOVERS body shared by 1D and the periods. */
@Composable
private fun MoversBody(items: List<MoverItem>, footer: String, onOpen: (String) -> Unit, modifier: Modifier) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val figure = JoinrType.figure(size = 12.5.sp)
    val bold = figure.copy(fontWeight = FontWeight.W700)
    fun widthOf(text: String, style: TextStyle): Dp = with(density) { measurer.measure(text, style).size.width.toDp() }
    val codeW = (items.maxOfOrNull { widthOf(it.code, bold) } ?: 0.dp) + 6.dp
    val dayW = (items.maxOfOrNull { widthOf(it.dollars, bold) } ?: 0.dp) + 6.dp
    val pctW = (items.maxOfOrNull { widthOf(it.percent, figure) } ?: 0.dp) + 6.dp
    Column(modifier.padding(horizontal = 16.dp).testTag("movers")) {
        items.forEach { m ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 40.dp)
                    .then(
                        if (m.clickable) {
                            Modifier
                                .clickable(onClickLabel = "Open ${m.code}", role = Role.Button) { onOpen(m.key) }
                                .semantics(mergeDescendants = true) { contentDescription = m.spoken }
                        } else {
                            Modifier.semantics(mergeDescendants = true) { contentDescription = m.spoken }
                        },
                    )
                    .testTag("mover-${m.key}"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(m.code, style = bold.copy(color = JoinrColors.TextBright), maxLines = 1, modifier = Modifier.width(codeW))
                MoverBar(m.fraction, m.barTone, Modifier.weight(1f))
                Text(m.dollars, style = bold.copy(color = JoinrColors.textTone(m.dollarsTone)), textAlign = TextAlign.End, maxLines = 1, modifier = Modifier.width(dayW))
                Text(
                    m.percent,
                    style = figure.copy(color = JoinrColors.textTone(m.percentTone)),
                    textAlign = TextAlign.End,
                    maxLines = 1,
                    modifier = Modifier.width(pctW),
                )
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(JoinrColors.Hairline))
        }
        Text(
            footer,
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
