package com.tenon.joinrfinance.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tenon.joinrfinance.R
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.ui.theme.JoinrType

/** The 4 dp spectrum rule across the top of every screen. */
@Composable
fun SpectrumRule(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(4.dp).background(JoinrColors.Spectrum).testTag("spectrum"))
}

/** The real wordmark (a VectorDrawable from the SVG master), 24 dp tall (≈ 58.6 dp wide). */
@Composable
fun Wordmark(modifier: Modifier = Modifier, height: Dp = 24.dp) {
    Image(
        painter = painterResource(R.drawable.joinr_wordmark),
        contentDescription = "Joinr",
        modifier = modifier.height(height).width(height * (213.55f / 87.46f)),
    )
}

/** The brand block: the wordmark with FINANCE in teal, 11 sp bold uppercase at 0.16 em. */
@Composable
fun BrandBlock(modifier: Modifier = Modifier) {
    Row(
        modifier.semantics(mergeDescendants = true) { contentDescription = "Joinr Finance" },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Wordmark()
        Text("FINANCE", style = JoinrType.label(size = 11.sp, tracking = 0.16f, color = JoinrColors.Teal))
    }
}

/**
 * A Compose recreation of the Joinr banner (STYLE_GUIDE section 7): the ground gradient, the dot grid, the node
 * line with four flat nodes (soft glows), the bottom glow. Text never sits on the glow: callers use a surface card.
 */
@Composable
fun BannerBackdrop(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(modifier.fillMaxSize()) {
        Canvas(Modifier.fillMaxSize().testTag("banner")) {
            drawRect(
                Brush.verticalGradient(
                    0f to Color(0xFF13141D),
                    0.5f to Color(0xFF10111A),
                    1f to Color(0xFF0C0D16),
                ),
            )
            val step = 16.dp.toPx()
            val dot = Color(0xFF1E1F28).copy(alpha = 0.6f)
            var y = step
            while (y < size.height * 0.75f) {
                var x = step
                while (x < size.width) {
                    val edge = minOf(x, size.width - x) / (size.width / 2f)
                    drawCircle(dot.copy(alpha = 0.6f * edge.coerceIn(0f, 1f)), radius = 1.dp.toPx(), center = Offset(x, y))
                    x += step
                }
                y += step
            }
            val lineY = size.height * 0.39f
            drawLine(Color(0xFF1E1F28), Offset(0f, lineY), Offset(size.width, lineY), strokeWidth = 1.dp.toPx())
            val nodes = listOf(0.25f to JoinrColors.Teal, 0.5f to JoinrColors.Violet, 0.69f to JoinrColors.Fuchsia, 0.875f to JoinrColors.Orange)
            for ((fx, colour) in nodes) {
                val c = Offset(size.width * fx, lineY)
                drawLine(Color(0xFF1E1F28), Offset(c.x, lineY - 40.dp.toPx()), Offset(c.x, lineY + 40.dp.toPx()), strokeWidth = 1.dp.toPx())
                drawCircle(Brush.radialGradient(listOf(colour.copy(alpha = 0.35f), Color.Transparent), center = c, radius = 14.dp.toPx()), radius = 14.dp.toPx(), center = c)
                drawCircle(colour, radius = 3.dp.toPx(), center = c)
            }
            val glowCentre = Offset(size.width * 0.6f, size.height * 1.05f)
            drawCircle(
                Brush.radialGradient(
                    0f to JoinrColors.Violet.copy(alpha = 0.32f),
                    0.6f to JoinrColors.Fuchsia.copy(alpha = 0.14f),
                    1f to Color.Transparent,
                    center = glowCentre,
                    radius = size.width * 0.9f,
                ),
                radius = size.width * 0.9f,
                center = glowCentre,
            )
        }
        content()
    }
}
