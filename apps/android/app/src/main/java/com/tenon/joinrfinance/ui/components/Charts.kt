package com.tenon.joinrfinance.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.tenon.joinrfinance.model.Spark
import com.tenon.joinrfinance.model.SparkGeometry
import com.tenon.joinrfinance.ui.theme.JoinrColors

/** Values of a line: times (epoch seconds) and values, plus the dashed base. */
class LineData(val times: LongArray, val values: DoubleArray, val base: Double?, val from: Long? = null, val to: Long? = null) {
    val isEmpty: Boolean get() = times.isEmpty()
}

/** Draws a line with its wash down to the base and the dashed base line (STYLE_GUIDE section 6.2). */
fun DrawScope.drawSpark(
    g: SparkGeometry,
    stroke: Color,
    washAlpha: Float,
    strokeWidth: Float,
    dash: Float,
) {
    if (g.size == 0) return
    val baseY = g.baseY
    if (baseY != null) {
        drawLine(
            color = JoinrColors.DashedBase,
            start = Offset(0f, baseY),
            end = Offset(size.width, baseY),
            strokeWidth = 1.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash, dash)),
        )
    }
    val line = Path().apply {
        moveTo(g.xs[0], g.ys[0])
        for (i in 1 until g.size) lineTo(g.xs[i], g.ys[i])
    }
    val floor = baseY ?: size.height
    val area = Path().apply {
        addPath(line)
        lineTo(g.xs[g.size - 1], floor)
        lineTo(g.xs[0], floor)
        close()
    }
    drawPath(area, stroke.copy(alpha = washAlpha))
    drawPath(line, stroke, style = Stroke(width = strokeWidth, cap = StrokeCap.Round, join = StrokeJoin.Round))
}

/** A card's sparkline: go/stop line 1.75 dp, 16 % wash, the dashed previous close (plan section 9.7). */
@Composable
fun Sparkline(data: LineData, stroke: Color, modifier: Modifier = Modifier, height: Dp = 40.dp) {
    Canvas(modifier.fillMaxWidth().height(height)) {
        if (data.isEmpty) return@Canvas
        val g = Spark.geometry(data.times, data.values, data.base, size.width, size.height, 3.dp.toPx(), data.from, data.to)
        drawSpark(g, stroke, 0.16f, 1.75.dp.toPx(), 3.dp.toPx())
    }
}

/** The portfolio line: chart teal, 2 dp, a 14 % wash, the dashed zero line. */
@Composable
fun PortfolioLineChart(data: LineData, modifier: Modifier = Modifier, height: Dp = 64.dp) {
    Canvas(modifier.fillMaxWidth().height(height)) {
        if (data.isEmpty) return@Canvas
        val g = Spark.geometry(data.times, data.values, 0.0, size.width, size.height, 3.dp.toPx(), data.from, data.to)
        drawSpark(g, JoinrColors.ChartTeal, 0.14f, 2.dp.toPx(), 3.dp.toPx())
    }
}
