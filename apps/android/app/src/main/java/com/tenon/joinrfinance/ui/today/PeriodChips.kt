package com.tenon.joinrfinance.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.CollectionItemInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.collectionItemInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tenon.joinrfinance.model.Period
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.ui.theme.JoinrType
import kotlinx.coroutines.flow.first

const val CHIP_ROW_HEIGHT_DP = 44

/** The selected chip's 12 % teal wash. */
private val SelectedWash = JoinrColors.Teal.copy(alpha = 0.12f)

/**
 * The period chips (Stage 10 plan section 9.4, D163): eight static chips in a scrolling row (never a `LazyRow`, so every
 * chip is composed and the group reports "2 of 8"), fixed under the header. Each chip is 30 dp tall with 8 dp side
 * padding (at least 40 dp wide), 4 dp apart, 16 dp from the edges. The touch target is the chip's own bounds expanded to
 * 48 dp by Compose's hit testing (`ViewConfiguration.minimumTouchTargetSize`); `minimumInteractiveComponentSize` would
 * widen each chip's layout to 48 dp and push ALL off a 411 dp screen. The selected chip is scrolled into view, with its
 * 16 dp edge: at once on the first composition (a period already held, D163: back out and reopen, rotation, back from
 * Settings), animated after a tap. It waits for the row's first layout (a `BringIntoViewRequester` asked before or at
 * the first layout did nothing, leaving a held ALL cut off at the right edge at 360 dp × 1.3).
 */
@Composable
fun PeriodChips(selected: Period, onSelect: (Period) -> Unit, modifier: Modifier = Modifier) {
    val scroll = rememberScrollState()
    val layout = remember { ChipRowLayout() }
    val edgePx = with(LocalDensity.current) { 16.dp.roundToPx() }
    LaunchedEffect(selected) {
        // Wait for the row's first measure (the scroll range is unbounded until then) and the first placement of the
        // content and every chip (a request made earlier finds nothing placed and does nothing).
        snapshotFlow { layout.allPlaced && scroll.maxValue != Int.MAX_VALUE }.first { it }
        val first = layout.firstScroll
        layout.firstScroll = false
        val left = layout.chipLeft(selected) ?: return@LaunchedEffect
        val right = left + (layout.chips[selected]?.size?.width ?: 0)
        val target = chipScrollTarget(left, right, scroll.value, layout.viewportPx, edgePx, scroll.maxValue)
        if (target == scroll.value) return@LaunchedEffect
        if (first) scroll.scrollTo(target) else scroll.animateScrollTo(target)
    }
    Row(
        modifier
            .fillMaxWidth()
            .height(CHIP_ROW_HEIGHT_DP.dp)
            .onSizeChanged { layout.viewportPx = it.width }
            .horizontalScroll(scroll)
            .onPlaced { layout.placeContent(it) }
            .selectableGroup()
            .semantics { collectionInfo = CollectionInfo(rowCount = 1, columnCount = Period.entries.size) }
            .padding(PaddingValues(horizontal = 16.dp))
            .testTag("period-chips"),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Period.entries.forEachIndexed { i, p ->
            val on = p == selected
            val shape = RoundedCornerShape(15.dp)
            Box(
                Modifier
                    .onPlaced { layout.placeChip(p, it) }
                    .height(30.dp)
                    .widthIn(min = 40.dp)
                    .clip(shape)
                    .background(if (on) SelectedWash else JoinrColors.Surface)
                    .border(1.dp, if (on) JoinrColors.Teal else JoinrColors.Hairline, shape)
                    .selectable(selected = on, role = Role.Tab, onClick = { onSelect(p) })
                    .semantics {
                        contentDescription = p.spoken
                        role = Role.Tab
                        this.selected = on
                        collectionItemInfo = CollectionItemInfo(rowIndex = 0, rowSpan = 1, columnIndex = i, columnSpan = 1)
                    }
                    .padding(horizontal = 8.dp)
                    .testTag("chip-${p.chip}"),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    p.chip,
                    style = JoinrType.label(size = 12.sp, tracking = 0.08f, color = if (on) JoinrColors.Teal else JoinrColors.TextSecondary)
                        .copy(fontFeatureSettings = "tnum"),
                    maxLines = 1,
                    softWrap = false,
                    modifier = Modifier.clearAndSetSemantics {},
                )
            }
        }
    }
}

/**
 * Where the chip row's content and chips were last placed. The coordinates are plain fields (read after layout, never in
 * composition); only the count of first placements is state, so the scroll can wait for it.
 */
private class ChipRowLayout {
    var content: LayoutCoordinates? = null
        private set
    val chips = HashMap<Period, LayoutCoordinates>()
    var viewportPx = 0
    var firstScroll = true
    private var placed by mutableIntStateOf(0)

    /** Whether the content and every chip have been placed at least once. */
    val allPlaced: Boolean get() = placed >= Period.entries.size + 1

    fun placeContent(c: LayoutCoordinates) {
        if (content == null) placed += 1
        content = c
    }

    fun placeChip(p: Period, c: LayoutCoordinates) {
        if (chips.put(p, c) == null) placed += 1
    }

    /** A chip's left edge in the scrolled content's pixels (independent of the scroll), or null before layout. */
    fun chipLeft(p: Period): Int? {
        val row = content ?: return null
        val chip = chips[p] ?: return null
        if (!row.isAttached || !chip.isAttached) return null
        return row.localPositionOf(chip, Offset.Zero).x.toInt()
    }
}

/**
 * The scroll value that shows the content span [left, right) with [edge] pixels either side inside a [viewport]-wide
 * window now at [value]: unchanged when it already fits, else the least move; within 0..[max].
 */
internal fun chipScrollTarget(left: Int, right: Int, value: Int, viewport: Int, edge: Int, max: Int): Int {
    if (viewport <= 0) return value
    val target = when {
        left - edge < value -> left - edge
        right + edge > value + viewport -> right + edge - viewport
        else -> value
    }
    return target.coerceIn(0, max.coerceAtLeast(0))
}
