package com.tenon.joinrfinance.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** Line icons from the design D mock (lucide geometry, ISC licence), stroke 1.75 on a 24 grid; no icon library. */
object JoinrIcons {
    private fun lineIcon(name: String, vararg paths: String): ImageVector {
        val b = ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        for (d in paths) {
            b.addPath(
                pathData = addPathNodes(d),
                fill = null,
                stroke = SolidColor(Color.White),
                strokeLineWidth = 1.75f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        return b.build()
    }

    val Refresh: ImageVector by lazy { lineIcon("refresh", "M21 12a9 9 0 1 1-3-6.7L21 8", "M21 3v5h-5") }
    val Sort: ImageVector by lazy { lineIcon("sort", "M3 6h18M6 12h12M10 18h4") }
    val Today: ImageVector by lazy { lineIcon("today", "M3 17l6-6 4 4 8-8", "M15 7h6v6") }
    val Settings: ImageVector by lazy {
        lineIcon("settings", "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6")
    }
    val Back: ImageVector by lazy { lineIcon("back", "M19 12H5", "M12 19l-7-7 7-7") }
}
