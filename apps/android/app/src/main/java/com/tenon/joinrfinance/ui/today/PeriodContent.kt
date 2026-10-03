package com.tenon.joinrfinance.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tenon.joinrfinance.model.EMPTY_TEXT
import com.tenon.joinrfinance.model.Format
import com.tenon.joinrfinance.model.NOTHING_HELD_TEXT
import com.tenon.joinrfinance.model.NO_LINE_TEXT
import com.tenon.joinrfinance.model.Notice
import com.tenon.joinrfinance.model.Period
import com.tenon.joinrfinance.model.PeriodBody
import com.tenon.joinrfinance.model.PeriodRow
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.model.allLineCaption
import com.tenon.joinrfinance.model.lineLabels
import com.tenon.joinrfinance.model.partialText
import com.tenon.joinrfinance.model.periodBody
import com.tenon.joinrfinance.model.periodCardWord
import com.tenon.joinrfinance.model.periodChangeLine
import com.tenon.joinrfinance.model.periodInvestedTotals
import com.tenon.joinrfinance.model.periodNotices
import com.tenon.joinrfinance.model.periodOf
import com.tenon.joinrfinance.model.periodRows
import com.tenon.joinrfinance.model.periodMarkTone
import com.tenon.joinrfinance.model.periodTone
import com.tenon.joinrfinance.model.screenDim
import com.tenon.joinrfinance.model.sinceText
import com.tenon.joinrfinance.model.soldFigure
import com.tenon.joinrfinance.model.soldLineText
import com.tenon.joinrfinance.model.sortPeriodRows
import com.tenon.joinrfinance.model.spokenPeriodFigure
import com.tenon.joinrfinance.model.spokenPeriodHolding
import com.tenon.joinrfinance.model.spokenPeriodLine
import com.tenon.joinrfinance.model.spokenSold
import com.tenon.joinrfinance.model.staleHistoryText
import com.tenon.joinrfinance.net.MobilePeriodDto
import com.tenon.joinrfinance.net.MobilePeriodFigureDto
import com.tenon.joinrfinance.net.MobilePeriodsResponse
import com.tenon.joinrfinance.net.dec
import com.tenon.joinrfinance.net.decOrNull
import com.tenon.joinrfinance.ui.AppActions
import com.tenon.joinrfinance.ui.AppUiState
import com.tenon.joinrfinance.ui.LockUi
import com.tenon.joinrfinance.ui.components.JoinrIcons
import com.tenon.joinrfinance.ui.components.LineData
import com.tenon.joinrfinance.ui.components.NoticeBar
import com.tenon.joinrfinance.ui.components.PortfolioLineChart
import com.tenon.joinrfinance.ui.components.Sparkline
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.ui.theme.JoinrType
import com.tenon.joinrfinance.ui.theme.Mono

/** The chart area's height when it shows a sentence instead of the line (the chart's 64 dp plus its date labels). */
private val LINE_AREA_HEIGHT = 80.dp

/**
 * Today under a non-1D chip (Stage 10 plan section 9.4): the notices, the figure block and the header row, the period
 * line, then CARDS · LIST · MOVERS from the periods answer. Empty branches by period: nothing ever bought → the Stage 9
 * empty sentence; nothing held but sales recorded → "Nothing is held now." (ALL keeps its SOLD rows).
 */
@Composable
internal fun PeriodContent(
    state: AppUiState,
    actions: AppActions,
    onOpen: (String) -> Unit,
    listState: LazyListState,
    contentPadding: PaddingValues,
    status: String?,
) {
    val today = state.today
    val period = state.period
    val answer = state.periods
    val dto = answer?.periodOf(period)
    val body = when {
        today == null -> PeriodBody.LOADING
        answer != null && dto == null -> PeriodBody.UNAVAILABLE
        else -> periodBody(answer, period, state.periodsError)
    }
    val notices = periodNotices(today, state.error, answer, state.periodsFetchedAtMs, state.periodsError, state.nowMs, state.lock == LockUi.NoScreenLock)
    val dim = screenDim(period, today != null, state.error, state.refreshing, answer != null, state.periodsError, state.periodsLoading)
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().testTag("today-list"),
        contentPadding = PaddingValues(bottom = contentPadding.calculateBottomPadding() + 16.dp),
    ) {
        if (notices.isNotEmpty()) {
            item(key = "notices") {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    notices.forEach { n -> NoticeBar(n, onRetry = if (n.retry) actions::refresh else null) }
                }
            }
        }
        answer?.let { staleHistoryText(it) }?.let { note ->
            item(key = "history-note") {
                Text(
                    note,
                    style = JoinrType.body(size = 12.sp, color = JoinrColors.TextSecondary),
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp).testTag("history-note"),
                )
            }
        }
        if (body == PeriodBody.LOADING) item(key = "skeleton") { FirstLoadSkeleton() }
        if (body == PeriodBody.LOADING || body == PeriodBody.UNAVAILABLE || today == null || answer == null || dto == null) return@LazyColumn
        item(key = "block") {
            Column(Modifier.alpha(dim)) {
                PeriodBlock(dto, period, status)
                TotalsRow(periodInvestedTotals(today, answer))
            }
        }
        when (body) {
            PeriodBody.EMPTY -> item(key = "empty") {
                NoticeBar(Notice(Notice.Kind.NOTE, EMPTY_TEXT), modifier = Modifier.padding(16.dp).testTag("empty"))
            }
            PeriodBody.NOTHING_HELD -> item(key = "nothing-held") {
                NoticeBar(Notice(Notice.Kind.NOTE, NOTHING_HELD_TEXT), modifier = Modifier.padding(16.dp).testTag("nothing-held"))
            }
            else -> {
                item(key = "line") { PeriodLineBlock(dto, period, nothingHeld = answer.holdings.isEmpty(), Modifier.alpha(dim)) }
                item(key = "tabs") { TabsAndSort(state.tab, state.sort, period, actions) }
                val rows = periodRows(answer, dto)
                val sorted = sortPeriodRows(rows, state.sort)
                when (state.tab) {
                    TodayTab.CARDS -> {
                        itemsIndexed(sorted.chunked(2), key = { i, _ -> "cards-$i" }) { i, pair ->
                            PeriodCardRow(i, pair, answer, period, onOpen, Modifier.alpha(dim))
                        }
                        dto.soldFigure()?.let { f -> item(key = "sold-line") { SoldLine(f, Modifier.alpha(dim)) } }
                    }
                    TodayTab.LIST -> item(key = "list") {
                        PeriodHoldingsTable(answer, dto, sorted, state.sort, period, onOpen, Modifier.alpha(dim))
                    }
                    TodayTab.MOVERS -> item(key = "movers") {
                        PeriodMoversList(dto, rows, state.sort, period, onOpen, Modifier.alpha(dim))
                    }
                }
            }
        }
    }
}

/** The period's figure block (`1 WEEK · EXCL. CASH`, the figure, %, `Since …`, counts) and the partial note. */
@Composable
private fun PeriodBlock(dto: MobilePeriodDto, period: Period, status: String?) {
    Column(Modifier.testTag("period-block")) {
        FigureBlock(
            label = "${period.label} · EXCL. CASH",
            status = status,
            cents = dto.totals.cents,
            ratio = decOrNull(dto.totals.ratio),
            since = sinceText(dto, period),
            up = dto.totals.up,
            down = dto.totals.down,
            spoken = spokenPeriodFigure(dto, period),
        )
        partialText(dto, period)?.let { text ->
            Row(
                Modifier
                    .padding(start = 16.dp, end = 16.dp, bottom = 8.dp)
                    .semantics(mergeDescendants = true) { contentDescription = text }
                    .testTag("partial-note"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(JoinrIcons.Info, contentDescription = null, tint = JoinrColors.TextSecondary, modifier = Modifier.size(14.dp))
                Text(text, style = JoinrType.body(size = 12.sp, color = JoinrColors.TextSecondary))
            }
        }
    }
}

/**
 * The period line (D164, D167): `totals.cents` by point index (each point the same width, so a weekend without crypto
 * takes none) over the dashed zero line; the dates of the first point, of `points[size / 2]` and "Today" under it; under
 * ALL, one caption naming the realised part that is in the figure but not in the line.
 */
@Composable
private fun PeriodLineBlock(dto: MobilePeriodDto, period: Period, nothingHeld: Boolean, modifier: Modifier = Modifier) {
    val points = dto.line?.points.orEmpty()
    Column(modifier.padding(horizontal = 16.dp).testTag("period-line")) {
        when {
            period == Period.ALL && nothingHeld -> LineNote(NOTHING_HELD_TEXT, "line-nothing-held")
            points.isEmpty() -> LineNote(NO_LINE_TEXT, "no-line")
            else -> {
                Column(Modifier.semantics(mergeDescendants = true) { contentDescription = spokenPeriodLine(dto, period) }.testTag("period-chart")) {
                    PortfolioLineChart(
                        LineData(
                            times = LongArray(points.size) { it.toLong() },
                            values = DoubleArray(points.size) { points[it].second.toDouble() },
                            base = 0.0,
                        ),
                    )
                    lineLabels(points.map { it.first }, period)?.let { (a, b, c) ->
                        Row(Modifier.fillMaxWidth().padding(top = 2.dp)) {
                            val style = JoinrType.figure(size = 11.sp, color = JoinrColors.TextMuted)
                            Text(a, style = style, maxLines = 1, softWrap = false, modifier = Modifier.testTag("line-label-start"))
                            Spacer(Modifier.weight(1f))
                            Text(b, style = style, maxLines = 1, softWrap = false, modifier = Modifier.testTag("line-label-mid"))
                            Spacer(Modifier.weight(1f))
                            Text(c, style = style, maxLines = 1, softWrap = false, modifier = Modifier.testTag("line-label-end"))
                        }
                    }
                }
                if (period == Period.ALL) {
                    Text(
                        allLineCaption(dto),
                        style = JoinrType.body(size = 11.sp, color = JoinrColors.TextSecondary),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 2.dp).testTag("line-caption"),
                    )
                }
            }
        }
    }
}

@Composable
private fun LineNote(text: String, tag: String) {
    Box(Modifier.fillMaxWidth().height(LINE_AREA_HEIGHT).testTag(tag), contentAlignment = Alignment.CenterStart) {
        Text(text, style = JoinrType.body(size = 13.sp, color = JoinrColors.TextSecondary))
    }
}

@Composable
private fun PeriodCardRow(
    index: Int,
    pair: List<PeriodRow>,
    answer: MobilePeriodsResponse,
    period: Period,
    onOpen: (String) -> Unit,
    modifier: Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Max)
            .padding(start = 16.dp, end = 16.dp, bottom = 10.dp)
            .testTag("card-row-$index"),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        pair.forEach { r -> PeriodHoldingCard(r, answer, period, onOpen, Modifier.weight(1f).fillMaxHeight()) }
        if (pair.size == 1) Spacer(Modifier.weight(1f))
    }
}

/**
 * A CARDS card under a period: the code and weight; the price; the change line (`▲ 0.50 (1.00%)`, `BOUGHT IN 1W ▲ 1.33%`,
 * `▲ 20.85% ALL TIME`, or the PARTIAL bought-in part); the status word; the figure's line against its dashed base (the start
 * close; ALL: the average cost) or the word; the chip text and the figure's cents.
 */
@Composable
fun PeriodHoldingCard(r: PeriodRow, answer: MobilePeriodsResponse, period: Period, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val h = r.holding
    val f = r.figure
    val cents = r.cents
    val tone = periodMarkTone(cents)
    val shape = RoundedCornerShape(6.dp)
    Column(
        modifier
            .heightIn(min = 150.dp)
            .clip(shape)
            .background(JoinrColors.Surface)
            .border(1.dp, JoinrColors.Hairline, shape)
            .clickable(onClickLabel = "Open ${h.code}", role = Role.Button) { onOpen(h.key) }
            .semantics(mergeDescendants = true) { contentDescription = spokenPeriodHolding(r, period) }
            .padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 8.dp)
            .testTag("card-${h.key}"),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        CodeAndWeight(h.code, Format.weight(decOrNull(h.weightRatio)))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                Format.price(decOrNull(h.price)),
                style = JoinrType.figure(size = 15.sp, color = JoinrColors.Text, weight = FontWeight.W700),
                maxLines = 1,
            )
            if (h.isBullion) {
                Text(" /OZ", style = JoinrType.figure(size = 11.sp, color = JoinrColors.TextSecondary), modifier = Modifier.testTag("per-oz"))
            }
        }
        // Up to three lines on a narrow card at a large font (`BOUGHT IN 12M` / `▲ 2.56%` / `· PARTIAL`); the card grows.
        Text(
            periodChangeLine(f, period),
            style = JoinrType.figure(size = 12.sp, color = JoinrColors.textTone(tone)),
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.testTag("change-${h.key}"),
        )
        val word = periodCardWord(h, f, answer)
        val line = f?.line?.takeIf { it.points.isNotEmpty() }
        val wordStyle = JoinrType.label(size = 10.sp, tracking = 0.12f, color = JoinrColors.TextSecondary)
        if (line != null && word != null) Text(word, style = wordStyle, maxLines = 1, modifier = Modifier.testTag("word-${h.key}"))
        Spacer(Modifier.weight(1f))
        if (line != null) {
            Sparkline(
                LineData(
                    times = LongArray(line.points.size) { it.toLong() },
                    values = DoubleArray(line.points.size) { dec(line.points[it].second).toDouble() },
                    base = decOrNull(line.base)?.toDouble(),
                ),
                stroke = JoinrColors.markTone(tone),
                modifier = Modifier.testTag("spark-${h.key}"),
            )
        } else {
            Box(Modifier.fillMaxWidth().heightIn(min = 40.dp), contentAlignment = Alignment.CenterStart) {
                Text(word ?: "", style = wordStyle, modifier = Modifier.testTag("word-${h.key}"))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(period.chip, style = JoinrType.label(size = 10.sp, tracking = 0.12f, color = JoinrColors.TextMuted), modifier = Modifier.weight(1f))
            Text(
                Format.dayMoney(cents),
                style = JoinrType.figure(size = 12.sp, color = JoinrColors.textTone(periodTone(cents)), weight = FontWeight.W700),
                modifier = Modifier.testTag("cents-${h.key}"),
            )
        }
    }
}

/**
 * CARDS' Sold holdings line under ALL (D162; not a card, not clickable, its own merged description). The words are Arimo
 * and the money and the count mono (STYLE_GUIDE section 2); a second line is the fallback when a large figure does not fit.
 */
@Composable
private fun SoldLine(f: MobilePeriodFigureDto, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(6.dp)
    Row(
        modifier
            .padding(start = 16.dp, end = 16.dp, bottom = 10.dp)
            .fillMaxWidth()
            .heightIn(min = 40.dp)
            .clip(shape)
            .background(JoinrColors.Surface)
            .border(1.dp, JoinrColors.Hairline, shape)
            .semantics(mergeDescendants = true) { contentDescription = spokenSold(f) }
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("sold-line"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val text = soldLineText(f)
        val money = Format.dayMoney(f.cents)
        val count = (f.soldCount ?: 0).toString()
        val at = text.indexOf(money)
        val countAt = if (at < 0) -1 else text.indexOf(count, at + money.length)
        val mono = SpanStyle(fontFamily = Mono, fontFeatureSettings = "tnum")
        Text(
            buildAnnotatedString {
                if (at < 0) {
                    append(text)
                } else {
                    append(text.substring(0, at))
                    withStyle(mono.merge(SpanStyle(color = JoinrColors.textTone(periodTone(f.cents)), fontWeight = FontWeight.W700))) { append(money) }
                    if (countAt < 0) {
                        append(text.substring(at + money.length))
                    } else {
                        append(text.substring(at + money.length, countAt))
                        withStyle(mono) { append(count) }
                        append(text.substring(countAt + count.length))
                    }
                }
            },
            style = JoinrType.body(size = 12.5.sp, color = JoinrColors.Text),
            maxLines = 2,
            softWrap = true,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.testTag("sold-line-text"),
        )
    }
}

