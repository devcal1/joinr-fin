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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.tenon.joinrfinance.model.EMPTY_TEXT
import com.tenon.joinrfinance.model.Format
import com.tenon.joinrfinance.model.Notice
import com.tenon.joinrfinance.model.SortOrder
import com.tenon.joinrfinance.model.Times
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.model.changeLine
import com.tenon.joinrfinance.model.dayTone
import com.tenon.joinrfinance.model.investedTotals
import com.tenon.joinrfinance.model.marketLine
import com.tenon.joinrfinance.model.sortHoldings
import com.tenon.joinrfinance.model.spokenHolding
import com.tenon.joinrfinance.model.spokenInvested
import com.tenon.joinrfinance.model.spokenPortfolio
import com.tenon.joinrfinance.model.statusWord
import com.tenon.joinrfinance.model.toneOf
import com.tenon.joinrfinance.model.todayNotices
import com.tenon.joinrfinance.net.MobileHoldingDto
import com.tenon.joinrfinance.net.MobileTodayResponse
import com.tenon.joinrfinance.net.dec
import com.tenon.joinrfinance.net.decOrNull
import com.tenon.joinrfinance.ui.AppActions
import com.tenon.joinrfinance.ui.AppUiState
import com.tenon.joinrfinance.ui.LockUi
import com.tenon.joinrfinance.ui.components.BrandBlock
import com.tenon.joinrfinance.ui.components.JoinrIcons
import com.tenon.joinrfinance.ui.components.LineData
import com.tenon.joinrfinance.ui.components.NoticeBar
import com.tenon.joinrfinance.ui.components.PortfolioLineChart
import com.tenon.joinrfinance.ui.components.SkeletonBlock
import com.tenon.joinrfinance.ui.components.SpectrumRule
import com.tenon.joinrfinance.ui.components.Sparkline
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.ui.theme.JoinrType
import java.time.Instant

/** Above this font scale the header's status line moves under the Today label (plan section 9.7). */
const val STATUS_LINE_MAX_FONT_SCALE = 1.15f

/** The Today destination: header, the day block, the portfolio line, CARDS · LIST · MOVERS and the sort. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    state: AppUiState,
    actions: AppActions,
    onOpen: (String) -> Unit,
    listState: LazyListState = rememberLazyListState(),
    contentPadding: PaddingValues = PaddingValues(0.dp),
) {
    val today = state.today
    val bigFont = LocalDensity.current.fontScale > STATUS_LINE_MAX_FONT_SCALE
    val status = today?.let { marketLine(it) }
    Column(Modifier.fillMaxSize().background(JoinrColors.Ink).testTag("today")) {
        SpectrumRule()
        Header(status = if (bigFont) null else status, refreshing = state.refreshing, onRefresh = actions::refresh)
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = actions::refresh,
            modifier = Modifier.weight(1f).fillMaxWidth(),
        ) {
            val notices = todayNotices(today, state.fetchedAtMs, state.nowMs, state.error, state.lock == LockUi.NoScreenLock)
            val dim = when {
                today != null && state.error != null -> 0.6f
                today != null && state.refreshing -> 0.8f
                else -> 1f
            }
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
                when {
                    today == null -> item(key = "skeleton") { FirstLoadSkeleton() }
                    today.holdings.isEmpty() -> {
                        item(key = "block") {
                            Column {
                                DayBlock(today, if (bigFont) status else null, Modifier.alpha(dim))
                                TotalsRow(today, Modifier.alpha(dim))
                            }
                        }
                        item(key = "empty") {
                            NoticeBar(Notice(Notice.Kind.NOTE, EMPTY_TEXT), modifier = Modifier.padding(16.dp).testTag("empty"))
                        }
                    }
                    else -> {
                        item(key = "block") {
                            Column {
                                DayBlock(today, if (bigFont) status else null, Modifier.alpha(dim))
                                TotalsRow(today, Modifier.alpha(dim))
                            }
                        }
                        item(key = "line") { PortfolioLine(today, Modifier.alpha(dim)) }
                        item(key = "tabs") { TabsAndSort(state.tab, state.sort, actions) }
                        val sorted = sortHoldings(today.holdings, state.sort)
                        when (state.tab) {
                            TodayTab.CARDS -> {
                                val rows = sorted.chunked(2)
                                itemsIndexed(rows, key = { i, _ -> "cards-$i" }) { i, pair ->
                                    CardRow(i, pair, today, onOpen, Modifier.alpha(dim))
                                }
                            }
                            TodayTab.LIST -> item(key = "list") {
                                HoldingsTable(today, sorted, state.sort, onOpen, Modifier.alpha(dim))
                            }
                            TodayTab.MOVERS -> item(key = "movers") {
                                MoversList(today, state.sort, onOpen, Modifier.alpha(dim))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Header(status: String?, refreshing: Boolean, onRefresh: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .padding(start = 16.dp, end = 4.dp)
            .testTag("header"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BrandBlock()
        Spacer(Modifier.weight(1f))
        if (status != null) {
            Text(
                status,
                style = JoinrType.figure(size = 11.sp, color = JoinrColors.TextMuted),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.testTag("status-line"),
            )
        }
        Box(
            Modifier
                .size(48.dp)
                .clip(RoundedCornerShape(24.dp))
                .clickable(onClickLabel = "Refresh prices", role = Role.Button, enabled = !refreshing, onClick = onRefresh)
                .semantics { contentDescription = "Refresh prices" }
                .testTag("refresh"),
            contentAlignment = Alignment.Center,
        ) {
            Icon(JoinrIcons.Refresh, contentDescription = null, tint = JoinrColors.TextSecondary, modifier = Modifier.size(20.dp))
        }
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(JoinrColors.Hairline))
}

@Composable
private fun DayBlock(today: MobileTodayResponse, status: String?, modifier: Modifier = Modifier) {
    val cents = today.totals.dayCents
    val tone = if (cents == null) com.tenon.joinrfinance.model.Tone.NONE else toneOf(Format.daySign(cents))
    val ratio = decOrNull(today.totals.dayRatio)
    Row(
        modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 10.dp)
            .testTag("day-block"),
        verticalAlignment = Alignment.Bottom,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("TODAY · EXCL. CASH", style = JoinrType.label(size = 11.sp, tracking = 0.14f))
            if (status != null) {
                Text(status, style = JoinrType.figure(size = 11.sp, color = JoinrColors.TextMuted), modifier = Modifier.testTag("status-line"))
            }
            Text(
                Format.dayMoney(cents),
                style = JoinrType.figure(size = 34.sp, color = JoinrColors.textTone(tone), weight = androidx.compose.ui.text.font.FontWeight.W700)
                    .copy(letterSpacing = (-0.02).em),
                modifier = Modifier.testTag("day-figure"),
            )
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                Format.arrowPercent(ratio),
                style = JoinrType.figure(size = 16.sp, color = JoinrColors.textTone(toneOf(Format.percentSign(ratio))), weight = androidx.compose.ui.text.font.FontWeight.W700),
            )
            Text(
                buildAnnotatedString {
                    withStyle(androidx.compose.ui.text.SpanStyle(color = JoinrColors.GoTint)) { append("${today.totals.up}${Format.UP}") }
                    append(" ")
                    withStyle(androidx.compose.ui.text.SpanStyle(color = JoinrColors.StopTint)) { append("${today.totals.down}${Format.DOWN}") }
                },
                style = JoinrType.figure(size = 12.5.sp),
                modifier = Modifier.semantics { contentDescription = "${today.totals.up} up, ${today.totals.down} down" },
            )
        }
    }
}

/**
 * D155: VAL · INVESTED · GAIN under the day block (the value moved here from the counts line). Unknown figures show
 * `—` and say why to TalkBack; the gain's % goes under its $ when both do not fit (a narrow phone at a large font).
 */
@Composable
private fun TotalsRow(today: MobileTodayResponse, modifier: Modifier = Modifier) {
    val t = investedTotals(today)
    val labelStyle = JoinrType.label(size = 10.sp, tracking = 0.12f, color = JoinrColors.TextMuted)
    val figureSize = 13.sp
    val bold = androidx.compose.ui.text.font.FontWeight.W700
    Column(
        modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, bottom = 6.dp)
            .semantics(mergeDescendants = true) { contentDescription = spokenInvested(t) }
            .testTag("totals-row"),
    ) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(JoinrColors.Hairline))
        Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text("VAL", style = labelStyle, maxLines = 1)
                Text(
                    Format.valueWhole(t.valueCents),
                    style = JoinrType.figure(size = figureSize, color = JoinrColors.TextBright, weight = bold),
                    maxLines = 1,
                    softWrap = false,
                    modifier = Modifier.testTag("total-value"),
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text("INVESTED", style = labelStyle, maxLines = 1)
                Text(
                    Format.valueWhole(t.investedCents),
                    style = JoinrType.figure(size = figureSize, color = if (t.investedCents == null) JoinrColors.TextSecondary else JoinrColors.Text, weight = bold),
                    maxLines = 1,
                    softWrap = false,
                    modifier = Modifier.testTag("total-invested"),
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text("GAIN", style = labelStyle, maxLines = 1)
                val gain = t.gainCents
                if (gain == null) {
                    Text(
                        Format.DASH,
                        style = JoinrType.figure(size = figureSize, color = JoinrColors.TextSecondary, weight = bold),
                        maxLines = 1,
                        modifier = Modifier.testTag("total-gain"),
                    )
                } else {
                    val money = JoinrType.figure(size = figureSize, color = JoinrColors.textTone(toneOf(Format.daySign(gain))), weight = bold)
                    val ratio = t.gainRatio
                    InlineOrUnder(
                        first = { Text(Format.dayMoney(gain), style = money, maxLines = 1, softWrap = false, modifier = Modifier.testTag("total-gain")) },
                        second = if (ratio == null) {
                            null
                        } else {
                            {
                                Text(
                                    Format.arrowPercent(ratio, space = false),
                                    style = JoinrType.figure(size = figureSize, color = JoinrColors.textTone(toneOf(Format.percentSign(ratio))), weight = bold),
                                    maxLines = 1,
                                    softWrap = false,
                                    modifier = Modifier.testTag("total-gain-percent"),
                                )
                            }
                        },
                    )
                }
            }
        }
    }
}

/** Two texts side by side with a 6 dp gap, or the second under the first when both do not fit the width. */
@Composable
private fun InlineOrUnder(first: @Composable () -> Unit, second: (@Composable () -> Unit)?) {
    androidx.compose.ui.layout.Layout(
        content = {
            first()
            second?.invoke()
        },
    ) { measurables, constraints ->
        val gap = 6.dp.roundToPx()
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val a = measurables[0].measure(loose)
        val b = measurables.getOrNull(1)?.measure(loose)
        if (b == null) {
            layout(a.width, a.height) { a.placeRelative(0, 0) }
        } else if (a.width + gap + b.width <= constraints.maxWidth) {
            val h = maxOf(a.height, b.height)
            layout(a.width + gap + b.width, h) {
                a.placeRelative(0, h - a.height)
                b.placeRelative(a.width + gap, h - b.height)
            }
        } else {
            layout(maxOf(a.width, b.width), a.height + b.height) {
                a.placeRelative(0, 0)
                b.placeRelative(0, a.height)
            }
        }
    }
}

@Composable
private fun PortfolioLine(today: MobileTodayResponse, modifier: Modifier = Modifier) {
    val line = today.portfolioLine ?: return
    val zone = Times.zone(today.timeZone)
    val from = Times.instant(line.from)?.epochSecond
    val to = Times.instant(line.to)?.epochSecond
    val data = LineData(
        times = LongArray(line.points.size) { line.points[it].first },
        values = DoubleArray(line.points.size) { line.points[it].second.toDouble() },
        base = 0.0,
        from = from,
        to = to,
    )
    Column(
        modifier
            .padding(horizontal = 16.dp)
            .semantics(mergeDescendants = true) { contentDescription = spokenPortfolio(today) }
            .testTag("portfolio-line"),
    ) {
        PortfolioLineChart(data)
        if (from != null && to != null) {
            val mid = from + (to - from) / 2
            Row(Modifier.fillMaxWidth().padding(top = 2.dp)) {
                val style = JoinrType.figure(size = 11.sp, color = JoinrColors.TextMuted)
                Text(Times.hm(from, zone), style = style)
                Spacer(Modifier.weight(1f))
                Text(Times.hm(mid, zone), style = style)
                Spacer(Modifier.weight(1f))
                Text(Times.hm(to, zone), style = style)
            }
        }
    }
}

@Composable
private fun TabsAndSort(tab: TodayTab, sort: SortOrder, actions: AppActions) {
    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).selectableGroup().testTag("tabs")) {
                TodayTab.entries.forEach { t ->
                    val selected = t == tab
                    Box(
                        Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp)
                            .selectable(selected = selected, role = Role.Tab, onClick = { actions.selectTab(t) })
                            .testTag("tab-${t.name}"),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            t.label,
                            style = JoinrType.label(size = 12.sp, tracking = 0.14f, color = if (selected) JoinrColors.TextBright else JoinrColors.TextSecondary),
                            maxLines = 1,
                        )
                        if (selected) {
                            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(2.dp).background(JoinrColors.Teal))
                        }
                    }
                }
            }
            Row(
                Modifier
                    .heightIn(min = 48.dp)
                    .widthIn(min = 48.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .clickable(onClickLabel = "Change the sort", role = Role.Button, onClick = actions::cycleSort)
                    .semantics(mergeDescendants = true) {
                        contentDescription = "Sort by ${sort.spoken}"
                        stateDescription = "Sorted by ${sort.spoken}"
                        liveRegion = LiveRegionMode.Polite
                    }
                    .padding(horizontal = 8.dp)
                    .testTag("sort"),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(JoinrIcons.Sort, contentDescription = null, tint = JoinrColors.TextSecondary, modifier = Modifier.size(18.dp))
                // The slot is as wide as the widest label at any font scale, so cycling the sort never moves the tabs.
                Box {
                    val style = JoinrType.label(size = 11.sp, tracking = 0.1f)
                    SortOrder.entries.forEach { Text(it.label, style = style, maxLines = 1, modifier = Modifier.alpha(0f).clearAndSetSemantics {}) }
                    Text(sort.label, style = style, maxLines = 1, modifier = Modifier.testTag("sort-label"))
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(JoinrColors.Hairline))
    }
}

@Composable
private fun CardRow(index: Int, pair: List<MobileHoldingDto>, today: MobileTodayResponse, onOpen: (String) -> Unit, modifier: Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Max)
            .padding(start = 16.dp, end = 16.dp, bottom = 10.dp)
            .testTag("card-row-$index"),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        pair.forEach { h -> HoldingCard(h, today, onOpen, Modifier.weight(1f).fillMaxHeight()) }
        if (pair.size == 1) Spacer(Modifier.weight(1f))
    }
}

/** A CARDS card (plan section 9.7): code and weight; the price; the change; the sparkline or a status word; DAY. */
@Composable
fun HoldingCard(h: MobileHoldingDto, today: MobileTodayResponse, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val tone = dayTone(h)
    val shape = RoundedCornerShape(6.dp)
    Column(
        modifier
            .heightIn(min = 150.dp)
            .clip(shape)
            .background(JoinrColors.Surface)
            .border(1.dp, JoinrColors.Hairline, shape)
            .clickable(onClickLabel = "Open ${h.code}", role = Role.Button) { onOpen(h.key) }
            .semantics(mergeDescendants = true) { contentDescription = spokenHolding(h) }
            .padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 8.dp)
            .testTag("card-${h.key}"),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        CodeAndWeight(h.code, Format.weight(decOrNull(h.weightRatio)))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                Format.price(decOrNull(h.price)),
                style = JoinrType.figure(size = 15.sp, color = JoinrColors.Text, weight = androidx.compose.ui.text.font.FontWeight.W700),
                maxLines = 1,
            )
            if (h.isBullion) {
                Text(" /OZ", style = JoinrType.figure(size = 11.sp, color = JoinrColors.TextSecondary), modifier = Modifier.testTag("per-oz"))
            }
        }
        Text(changeLine(h), style = JoinrType.figure(size = 12.sp, color = JoinrColors.textTone(tone)), maxLines = 2)
        Spacer(Modifier.weight(1f))
        val word = statusWord(h, today)
        val line = h.line
        if (word == null && line != null && line.points.isNotEmpty()) {
            Sparkline(
                LineData(
                    times = LongArray(line.points.size) { line.points[it].first },
                    values = DoubleArray(line.points.size) { dec(line.points[it].second).toDouble() },
                    base = decOrNull(line.base)?.toDouble(),
                ),
                stroke = JoinrColors.markTone(tone),
                modifier = Modifier.testTag("spark-${h.key}"),
            )
        } else {
            Box(Modifier.fillMaxWidth().heightIn(min = 40.dp), contentAlignment = Alignment.CenterStart) {
                Text(word ?: "", style = JoinrType.label(size = 10.sp, tracking = 0.12f, color = JoinrColors.TextSecondary), modifier = Modifier.testTag("word-${h.key}"))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("DAY", style = JoinrType.label(size = 10.sp, tracking = 0.12f, color = JoinrColors.TextMuted), modifier = Modifier.weight(1f))
            Text(
                Format.dayMoney(if (h.isOk) h.dayCents else null),
                style = JoinrType.figure(size = 12.sp, color = JoinrColors.textTone(if (h.isOk && h.dayCents != null) toneOf(Format.daySign(h.dayCents)) else tone), weight = androidx.compose.ui.text.font.FontWeight.W700),
            )
        }
    }
}

/** The code with the weight at the right; when both do not fit (a long code at a large font scale), the weight goes under. */
@Composable
private fun CodeAndWeight(code: String, weight: String) {
    val codeStyle = JoinrType.figure(size = 14.sp, color = JoinrColors.TextBright, weight = androidx.compose.ui.text.font.FontWeight.W700)
    val weightStyle = JoinrType.figure(size = 11.sp, color = JoinrColors.TextMuted)
    // A plain Layout (no SubcomposeLayout): the card row asks for intrinsic heights.
    androidx.compose.ui.layout.Layout(
        content = {
            Text(code, style = codeStyle)
            Text(weight, style = weightStyle, maxLines = 1)
        },
        modifier = Modifier.fillMaxWidth(),
    ) { measurables, constraints ->
        val gap = 4.dp.roundToPx()
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val w = measurables[1].measure(loose)
        val codeFits = measurables[0].maxIntrinsicWidth(constraints.maxHeight) + gap + w.width <= constraints.maxWidth
        if (codeFits) {
            val c = measurables[0].measure(loose.copy(maxWidth = constraints.maxWidth - w.width - gap))
            val h = maxOf(c.height, w.height)
            layout(constraints.maxWidth, h) {
                c.placeRelative(0, h - c.height)
                w.placeRelative(constraints.maxWidth - w.width, h - w.height)
            }
        } else {
            val c = measurables[0].measure(loose)
            layout(constraints.maxWidth, c.height + w.height) {
                c.placeRelative(0, 0)
                w.placeRelative(0, c.height)
            }
        }
    }
}

@Composable
private fun FirstLoadSkeleton() {
    Column(Modifier.padding(16.dp).testTag("skeleton"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SkeletonBlock(64.dp)
        SkeletonBlock(64.dp)
        SkeletonBlock(40.dp)
        repeat(2) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SkeletonBlock(150.dp, Modifier.weight(1f))
                SkeletonBlock(150.dp, Modifier.weight(1f))
            }
        }
    }
}

/** For tests and the detail: the epoch-second time of an ISO instant. */
internal fun epochSecond(iso: String?): Long? = iso?.let { runCatching { Instant.parse(it).epochSecond }.getOrNull() }
