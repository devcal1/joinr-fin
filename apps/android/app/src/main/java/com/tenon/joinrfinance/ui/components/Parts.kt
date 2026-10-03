package com.tenon.joinrfinance.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tenon.joinrfinance.model.Notice
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.ui.theme.JoinrType

/** A callout (STYLE_GUIDE section 5): surface, a 4 dp left border (orange: important, teal: note), an optional Retry. */
@Composable
fun NoticeBar(notice: Notice, modifier: Modifier = Modifier, onRetry: (() -> Unit)? = null) {
    val accent = if (notice.kind == Notice.Kind.IMPORTANT) JoinrColors.Orange else JoinrColors.Teal
    Row(
        modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clip(RoundedCornerShape(5.dp))
            .background(JoinrColors.Surface)
            .testTag("notice"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(accent))
        Text(
            notice.text,
            style = JoinrType.body(size = 13.sp, color = JoinrColors.Text),
            modifier = Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 8.dp),
        )
        if (notice.retry && onRetry != null) {
            TextAction("Retry", onRetry, Modifier.padding(end = 4.dp))
        }
    }
}

/** A text button in teal, at least 48 dp tall. */
@Composable
fun TextAction(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .widthIn(min = 48.dp)
            .clip(RoundedCornerShape(5.dp))
            .clickable(onClickLabel = label, role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label.uppercase(), style = JoinrType.label(size = 12.sp, tracking = 0.12f, color = JoinrColors.Teal))
    }
}

/** The primary action: a teal button with ink text (≥ 48 dp), or the secondary outline. */
@Composable
fun JoinrButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, primary: Boolean = true, enabled: Boolean = true) {
    val shape = RoundedCornerShape(6.dp)
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(shape)
            .then(if (primary) Modifier.background(JoinrColors.Teal) else Modifier.border(1.dp, JoinrColors.Hairline, shape).background(JoinrColors.Surface))
            .alpha(if (enabled) 1f else 0.5f)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label.uppercase(),
            style = JoinrType.label(size = 13.sp, tracking = 0.1f, color = if (primary) JoinrColors.Ink else JoinrColors.TextBright),
            textAlign = TextAlign.Center,
        )
    }
}

/** A skeleton block (STYLE_GUIDE section 6.2): surface with a gentle opacity pulse. */
@Composable
fun SkeletonBlock(height: Dp, modifier: Modifier = Modifier) {
    val t = rememberInfiniteTransition(label = "skeleton")
    val a by t.animateFloat(0.55f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "pulse")
    Box(modifier.fillMaxWidth().height(height).alpha(a).clip(RoundedCornerShape(6.dp)).background(JoinrColors.Surface))
}

/** A key–value table (STYLE_GUIDE section 5): label column raised, value column surface, hairlines between rows. */
@Composable
fun KeyValueTable(rows: List<Pair<String, String>>, modifier: Modifier = Modifier, valueColor: (String) -> Color = { JoinrColors.Text }) {
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).testTag("kv")) {
        rows.forEachIndexed { i, (label, value) ->
            if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(JoinrColors.Hairline))
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).semantics(mergeDescendants = true) {}) {
                Box(
                    Modifier.weight(0.42f).fillMaxHeight().background(JoinrColors.Raised).padding(horizontal = 8.dp, vertical = 6.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text(label.uppercase(), style = JoinrType.label(size = 11.sp, tracking = 0.12f))
                }
                Box(
                    Modifier.weight(0.58f).fillMaxHeight().background(JoinrColors.Surface).padding(horizontal = 8.dp, vertical = 6.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    // Figures are monospaced; a phrase value ("2 on the Other Assets page") is body text.
                    val phrase = value.count { it.isLetter() } > 8
                    Text(value, style = if (phrase) JoinrType.body(size = 13.sp, color = valueColor(label)) else JoinrType.figure(size = 13.sp, color = valueColor(label)))
                }
            }
        }
    }
}

/** A section label: 11 sp bold uppercase, letter-spaced, text-secondary. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier, color: Color = JoinrColors.TextSecondary) {
    Text(text.uppercase(), style = JoinrType.label(size = 11.sp, tracking = 0.14f, color = color), modifier = modifier)
}

/** Vertical spacing helper used by the full-screen cards. */
val CardSpacing = Arrangement.spacedBy(12.dp)
