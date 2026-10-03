package com.tenon.joinrfinance.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import androidx.core.graphics.createBitmap
import com.tenon.joinrfinance.model.Spark
import com.tenon.joinrfinance.net.MobileLineDto
import com.tenon.joinrfinance.net.decOrNull

/**
 * Sparkline bitmaps for the widgets (plan section 9.9): drawn onto the card colour so RGB_565 works (half the bytes of
 * ARGB_8888), at a density capped at 2× (the caller passes pixel sizes from [WidgetSizes.sparkBitmaps]).
 */
object SparkBitmap {
    fun render(line: MobileLineDto, widthPx: Int, heightPx: Int, scale: Float, stroke: Int, background: Int, dashed: Int): Bitmap {
        val bmp = createBitmap(widthPx, heightPx, Bitmap.Config.RGB_565)
        val canvas = Canvas(bmp)
        canvas.drawColor(background)
        val pts = line.points
        if (pts.isEmpty()) return bmp
        val times = LongArray(pts.size) { pts[it].first }
        val values = DoubleArray(pts.size) { pts[it].second.toDouble() }
        val g = Spark.geometry(times, values, decOrNull(line.base)?.toDouble(), widthPx.toFloat(), heightPx.toFloat(), 2f * scale)
        g.baseY?.let { y ->
            val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = dashed
                strokeWidth = 1f * scale
                style = Paint.Style.STROKE
                pathEffect = DashPathEffect(floatArrayOf(2f * scale, 3f * scale), 0f)
            }
            canvas.drawLine(0f, y, widthPx.toFloat(), y, p)
        }
        val path = Path().apply {
            moveTo(g.xs[0], g.ys[0])
            for (i in 1 until g.size) lineTo(g.xs[i], g.ys[i])
        }
        val floor = g.baseY ?: heightPx.toFloat()
        val area = Path(path).apply {
            lineTo(g.xs[g.size - 1], floor)
            lineTo(g.xs[0], floor)
            close()
        }
        canvas.drawPath(area, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = (stroke and 0x00FFFFFF) or (0x29 shl 24) })
        canvas.drawPath(
            path,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = stroke
                strokeWidth = 1.5f * scale
                style = Paint.Style.STROKE
                strokeCap = Paint.Cap.ROUND
                strokeJoin = Paint.Join.ROUND
            },
        )
        return bmp
    }
}
