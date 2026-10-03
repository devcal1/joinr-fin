package com.tenon.joinrfinance.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.layout.ContentScale
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.semantics.testTag
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.tenon.joinrfinance.MainActivity
import com.tenon.joinrfinance.R
import com.tenon.joinrfinance.Services
import com.tenon.joinrfinance.model.Format
import com.tenon.joinrfinance.model.Tone
import com.tenon.joinrfinance.model.WIDGET_PAIR_TEXT
import com.tenon.joinrfinance.model.WIDGET_UPDATE_TEXT
import com.tenon.joinrfinance.model.bestAndWorst
import com.tenon.joinrfinance.model.biggestMoves
import com.tenon.joinrfinance.model.dayTone
import com.tenon.joinrfinance.model.spokenHolding
import com.tenon.joinrfinance.model.statusWord
import com.tenon.joinrfinance.model.toneOf
import com.tenon.joinrfinance.model.widgetAgeLine
import com.tenon.joinrfinance.net.MobileHoldingDto
import com.tenon.joinrfinance.net.MobileTodayResponse
import com.tenon.joinrfinance.net.decOrNull
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.work.RefreshScheduler

/** Re-renders the three widgets. */
object Widgets {
    suspend fun updateAll(context: Context) {
        TodayWidget().updateAll(context)
        HoldingWidget().updateAll(context)
        BestWorstWidget().updateAll(context)
    }
}

// ─── Colours and type (plan section 9.10: system fonts in widgets, labels uppercase without tracking) ──────────────

private fun cp(c: Color) = ColorProvider(c)
private val Bright = cp(JoinrColors.TextBright)
private val Body = cp(JoinrColors.Text)
private val Secondary = cp(JoinrColors.TextSecondary)
private val Muted = cp(JoinrColors.TextMuted)

private fun toneText(t: Tone) = cp(JoinrColors.textTone(t))

private fun label(size: Int = 11, color: ColorProvider = Secondary) =
    TextStyle(color = color, fontSize = size.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.SansSerif)

private fun figure(size: Int = 12, color: ColorProvider = Body, bold: Boolean = false) =
    TextStyle(color = color, fontSize = size.sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal, fontFamily = FontFamily.Monospace)

/** The outer background: `appWidgetBackground` with the system radius on API 31+; a rounded drawable on API 30. */
private fun GlanceModifier.widgetBackground(): GlanceModifier =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        this.appWidgetBackground().background(JoinrColors.Surface).cornerRadius(android.R.dimen.system_app_widget_background_radius)
    } else {
        this.background(ImageProvider(R.drawable.widget_background))
    }

/** A mini card: ink with 14 dp corners (API 31+), or the rounded drawable on API 30. */
private fun GlanceModifier.miniBackground(): GlanceModifier =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        this.background(JoinrColors.Ink).cornerRadius(14.dp)
    } else {
        this.background(ImageProvider(R.drawable.widget_mini_background))
    }

private fun openApp(context: Context, holdingKey: String? = null): Action {
    val intent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        if (holdingKey != null) putExtra(MainActivity.EXTRA_HOLDING_KEY, holdingKey)
    }
    return actionStartActivity(intent)
}

@Composable
private fun AgeText(today: MobileTodayResponse, fetchedAtMs: Long, nowMs: Long, compact: Boolean = false) {
    val age = widgetAgeLine(today, fetchedAtMs, nowMs)
    // compact (the 2 × 2 widgets): 10 sp and room for a second line, so a narrow cell never cuts the update time.
    Text(
        age.text,
        style = TextStyle(color = if (age.old) cp(JoinrColors.OrangeTint) else Muted, fontSize = if (compact) 10.sp else 11.sp, fontFamily = FontFamily.SansSerif),
        maxLines = if (compact) 2 else 1,
        modifier = GlanceModifier.semantics { testTag = "age" },
    )
}

/** The message face (not paired, revoked, figures too old). */
@Composable
private fun MessageFace(text: String) {
    val context = LocalContext.current
    Box(
        GlanceModifier.fillMaxSize().widgetBackground().padding(14.dp).clickable(openApp(context)),
        contentAlignment = Alignment.CenterStart,
    ) {
        Column {
            Text("JOINR FINANCE", style = label(11, cp(JoinrColors.Teal)))
            Spacer(GlanceModifier.height(6.dp))
            Text(text, style = TextStyle(color = Body, fontSize = 13.sp, fontFamily = FontFamily.SansSerif), modifier = GlanceModifier.semantics { testTag = "message" })
        }
    }
}

/** True when the face is a message; renders it. */
@Composable
private fun messageIfAny(snapshot: WidgetSnapshot, nowMs: Long): Boolean = when (widgetMode(snapshot, nowMs)) {
    WidgetMode.PAIR -> {
        MessageFace(WIDGET_PAIR_TEXT)
        true
    }
    WidgetMode.UPDATE -> {
        MessageFace(WIDGET_UPDATE_TEXT)
        true
    }
    WidgetMode.FIGURES -> false
}

// ─── Today ────────────────────────────────────────────────────────────────────────────────────────────────────────

class TodayWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(WidgetSizes.TODAY)

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val snapshot = WidgetSnapshot.load(context)
        provideContent { TodayWidgetContent(snapshot, System.currentTimeMillis()) }
    }
}

@Composable
fun TodayWidgetContent(snapshot: WidgetSnapshot, nowMs: Long) {
    if (messageIfAny(snapshot, nowMs)) return
    val today = snapshot.today!!
    val context = LocalContext.current
    val size = LocalSize.current
    val bucket = WidgetSizes.todayBucket(size)
    val rows = WidgetSizes.todayRows(size)
    val sparks = WidgetSizes.todaySparklines(size)
    val cents = today.totals.dayCents
    val tone = if (cents == null) Tone.NONE else toneOf(Format.daySign(cents))
    val ratio = decOrNull(today.totals.dayRatio)
    // D155: value, (day $), day %, fitted to the width so it never clips; the up/down counts move to the label row.
    val line = TotalLineFit.fit(today.totals, TotalLineFit.maxValueSp(bucket), TotalLineFit.availableDp(size), TotalLineFit.paintMeasure(context))
    Column(GlanceModifier.fillMaxSize().widgetBackground().padding(12.dp).clickable(openApp(context))) {
        if (bucket != WidgetSizes.TODAY_SMALL) {
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("TODAY · EXCL. CASH", style = label(11), maxLines = 1, modifier = GlanceModifier.defaultWeight().semantics { testTag = "label" })
                Counts(today)
            }
        }
        Row(
            GlanceModifier.fillMaxWidth().semantics { contentDescription = TotalLineFit.spoken(today.totals); testTag = "total-line" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(line.value, style = figure(line.valueSp, Bright, bold = true), maxLines = 1, modifier = GlanceModifier.semantics { testTag = "figure" })
            Spacer(GlanceModifier.width(TotalLineFit.GAP_DP.dp))
            Text(line.day, style = figure(line.restSp, toneText(tone), bold = true), maxLines = 1, modifier = GlanceModifier.semantics { testTag = "day" })
            Spacer(GlanceModifier.width(TotalLineFit.GAP_DP.dp))
            Text(line.percent, style = figure(line.restSp, toneText(toneOf(Format.percentSign(ratio))), bold = true), maxLines = 1, modifier = GlanceModifier.semantics { testTag = "percent" })
        }
        Spacer(GlanceModifier.height(6.dp))
        if (today.holdings.isEmpty()) {
            Text("No holdings yet.", style = TextStyle(color = Body, fontSize = 13.sp, fontFamily = FontFamily.SansSerif), modifier = GlanceModifier.semantics { testTag = "message" })
        }
        val top = biggestMoves(today, rows * 3)
        // One Column of up to 2 Rows of 3 (Glance refuses more than 10 children in a Row or Column).
        Column(GlanceModifier.fillMaxWidth()) {
            top.chunked(3).take(rows).forEachIndexed { r, chunk ->
                if (r > 0) Spacer(GlanceModifier.height(6.dp))
                Row(GlanceModifier.fillMaxWidth()) {
                    chunk.forEachIndexed { i, h ->
                        if (i > 0) Spacer(GlanceModifier.width(6.dp))
                        MiniCard(h, today, sparks, GlanceModifier.defaultWeight())
                    }
                }
            }
        }
        if (bucket != WidgetSizes.TODAY_SMALL && today.holdings.isNotEmpty()) {
            Spacer(GlanceModifier.height(6.dp))
            val n = today.holdings.size
            val shown = minOf(n, rows * 3)
            val footer = if (n > shown) "Biggest moves today · tap for all $n" else "Tap for all $n"
            Text(footer, style = TextStyle(color = Muted, fontSize = 11.sp, fontFamily = FontFamily.SansSerif), maxLines = 1)
        }
        Spacer(GlanceModifier.defaultWeight())
        if (bucket == WidgetSizes.TODAY_SMALL) {
            // No label row at the small size: the counts sit at the right of the age line.
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(GlanceModifier.defaultWeight()) { AgeText(today, snapshot.fetchedAtMs!!, nowMs) }
                Counts(today)
            }
        } else {
            AgeText(today, snapshot.fetchedAtMs!!, nowMs)
        }
    }
}

/** `6▲ 4▼`, the up and down counts. */
@Composable
private fun Counts(today: MobileTodayResponse) {
    Row(GlanceModifier.semantics { contentDescription = "${today.totals.up} up, ${today.totals.down} down"; testTag = "counts" }) {
        Text("${today.totals.up}${Format.UP}", style = figure(12, cp(JoinrColors.GoTint)), maxLines = 1)
        Text(" ${today.totals.down}${Format.DOWN}", style = figure(12, cp(JoinrColors.StopTint)), maxLines = 1)
    }
}

@Composable
private fun MiniCard(h: MobileHoldingDto, today: MobileTodayResponse, spark: Boolean, modifier: GlanceModifier) {
    val word = statusWord(h, today)
    val tone = dayTone(h)
    Column(modifier.miniBackground().padding(start = 8.dp, end = 8.dp, top = 6.dp, bottom = 6.dp).semantics { contentDescription = spokenHolding(h); testTag = "mini-${h.key}" }) {
        Text(h.code, style = figure(12, Bright, bold = true), maxLines = 1)
        if (h.isOk) {
            Text(Format.arrowPercent(decOrNull(h.dayRatio), space = false), style = figure(12, toneText(toneOf(Format.percentSign(decOrNull(h.dayRatio)))), bold = true), maxLines = 1)
        } else {
            Text(word ?: "", style = label(9, Secondary), maxLines = 1)
        }
        val line = h.line
        if (spark && word == null && line != null && line.points.isNotEmpty()) {
            val context = LocalContext.current
            val density = minOf(context.resources.displayMetrics.density, WidgetSizes.DENSITY_CAP)
            val w = kotlin.math.ceil(WidgetSizes.MINI_SPARK_W * density).toInt()
            val hh = kotlin.math.ceil(WidgetSizes.MINI_SPARK_H * density).toInt()
            val bmp = SparkBitmap.render(line, w, hh, density, JoinrColors.markTone(tone).toArgb(), JoinrColors.Ink.toArgb(), JoinrColors.DashedBase.compositeOn(JoinrColors.Ink).toArgb())
            Image(ImageProvider(bmp), contentDescription = null, modifier = GlanceModifier.size(WidgetSizes.MINI_SPARK_W.dp, WidgetSizes.MINI_SPARK_H.dp))
        } else if (spark) {
            // No line (a daily price, a status word): keep the row of mini cards level.
            Spacer(GlanceModifier.height(WidgetSizes.MINI_SPARK_H.dp))
        }
    }
}

/** Alpha-composites a translucent colour onto an opaque one (RGB_565 has no alpha). */
private fun Color.compositeOn(bg: Color): Color = Color(
    red = red * alpha + bg.red * (1 - alpha),
    green = green * alpha + bg.green * (1 - alpha),
    blue = blue * alpha + bg.blue * (1 - alpha),
    alpha = 1f,
)

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayWidget()

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        runCatching { RefreshScheduler.runOnce(context) }
    }
}

// ─── Holding ──────────────────────────────────────────────────────────────────────────────────────────────────────

class HoldingWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(WidgetSizes.HOLDING)

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val snapshot = WidgetSnapshot.load(context)
        val appWidgetId = runCatching { GlanceAppWidgetManager(context).getAppWidgetId(id) }.getOrNull()
        val key = appWidgetId?.let { Services.get(context).prefs.widgetHolding(it) }
        provideContent { HoldingWidgetContent(snapshot, key, appWidgetId, System.currentTimeMillis()) }
    }
}

@Composable
fun HoldingWidgetContent(snapshot: WidgetSnapshot, holdingKey: String?, appWidgetId: Int?, nowMs: Long) {
    if (messageIfAny(snapshot, nowMs)) return
    val today = snapshot.today!!
    val context = LocalContext.current
    val size = LocalSize.current
    if (holdingKey == null) {
        val configure = Intent(context, WidgetConfigActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
            appWidgetId?.let { putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, it) }
        }
        Box(GlanceModifier.fillMaxSize().widgetBackground().padding(14.dp).clickable(actionStartActivity(configure)), contentAlignment = Alignment.CenterStart) {
            Text("Tap to choose a holding", style = TextStyle(color = Body, fontSize = 13.sp, fontFamily = FontFamily.SansSerif), modifier = GlanceModifier.semantics { testTag = "message" })
        }
        return
    }
    val h = today.holdings.firstOrNull { it.key == holdingKey }
    if (h == null) {
        Box(GlanceModifier.fillMaxSize().widgetBackground().padding(14.dp).clickable(openApp(context)), contentAlignment = Alignment.CenterStart) {
            Text("No longer held", style = TextStyle(color = Body, fontSize = 13.sp, fontFamily = FontFamily.SansSerif), modifier = GlanceModifier.semantics { testTag = "message" })
        }
        return
    }
    val tone = dayTone(h)
    val word = statusWord(h, today)
    Column(
        GlanceModifier.fillMaxSize().widgetBackground().padding(horizontal = WidgetSizes.HOLDING_PADDING.dp, vertical = 12.dp)
            .clickable(openApp(context, h.key))
            .semantics { contentDescription = spokenHolding(h) },
    ) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            // The code takes the room left by the weight, so a long code never pushes the weight out of a 2 × 2 cell.
            Text(h.code, style = figure(15, Bright, bold = true), maxLines = 1, modifier = GlanceModifier.defaultWeight().semantics { testTag = "code" })
            Text(Format.weight(decOrNull(h.weightRatio)), style = figure(11, Muted), maxLines = 1)
        }
        if (h.isOk) {
            // The % at the left and day $ at the right (no " · " between): fits a 2 × 2 cell.
            Row(GlanceModifier.fillMaxWidth().semantics { testTag = "change" }, verticalAlignment = Alignment.CenterVertically) {
                Text(Format.arrowPercent(decOrNull(h.dayRatio)), style = figure(13, toneText(tone)), maxLines = 1)
                Spacer(GlanceModifier.defaultWeight())
                Text(Format.dayMoney(h.dayCents), style = figure(13, toneText(tone)), maxLines = 1)
            }
        } else {
            Text(word ?: "", style = label(10, Secondary), maxLines = 1, modifier = GlanceModifier.semantics { testTag = "change" })
        }
        val line = h.line
        if (word == null && line != null && line.points.isNotEmpty()) {
            val density = minOf(context.resources.displayMetrics.density, WidgetSizes.DENSITY_CAP)
            val wDp = WidgetSizes.holdingSparkWidthDp(size)
            val w = kotlin.math.ceil(wDp * density).toInt()
            val hh = kotlin.math.ceil(WidgetSizes.HOLDING_SPARK_H * density).toInt()
            val bmp = SparkBitmap.render(line, w, hh, density, JoinrColors.markTone(tone).toArgb(), JoinrColors.Surface.toArgb(), JoinrColors.DashedBase.compositeOn(JoinrColors.Surface).toArgb())
            Spacer(GlanceModifier.height(4.dp))
            // Drawn at the widest bucket and scaled to the cell: a 2 × 2 cell is often wider than its 110 dp bucket.
            Image(ImageProvider(bmp), contentDescription = null, contentScale = ContentScale.FillBounds, modifier = GlanceModifier.fillMaxWidth().height(WidgetSizes.HOLDING_SPARK_H.dp))
        }
        Spacer(GlanceModifier.defaultWeight())
        AgeText(today, snapshot.fetchedAtMs!!, nowMs, compact = true)
    }
}

class HoldingWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = HoldingWidget()

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        runCatching { RefreshScheduler.runOnce(context) }
    }
}

// ─── Best / worst ─────────────────────────────────────────────────────────────────────────────────────────────────

class BestWorstWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(WidgetSizes.BEST_WORST)

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val snapshot = WidgetSnapshot.load(context)
        provideContent { BestWorstWidgetContent(snapshot, System.currentTimeMillis()) }
    }
}

@Composable
fun BestWorstWidgetContent(snapshot: WidgetSnapshot, nowMs: Long) {
    if (messageIfAny(snapshot, nowMs)) return
    val today = snapshot.today!!
    val context = LocalContext.current
    Column(GlanceModifier.fillMaxSize().widgetBackground().padding(horizontal = WidgetSizes.HOLDING_PADDING.dp, vertical = 12.dp).clickable(openApp(context))) {
        Text("BEST / WORST", style = label(11))
        Spacer(GlanceModifier.height(6.dp))
        val pair = bestAndWorst(today)
        if (pair == null) {
            Text("Not enough changes yet", style = TextStyle(color = Body, fontSize = 13.sp, fontFamily = FontFamily.SansSerif), modifier = GlanceModifier.semantics { testTag = "message" })
        } else {
            listOf(pair.first, pair.second).forEachIndexed { i, h ->
                if (i > 0) Spacer(GlanceModifier.height(4.dp))
                val r = decOrNull(h.dayRatio)
                Row(GlanceModifier.semantics { contentDescription = spokenHolding(h); testTag = if (i == 0) "best" else "worst" }) {
                    Text(h.code, style = figure(14, Bright, bold = true), maxLines = 1)
                    Text(" " + Format.arrowPercent(r, space = false), style = figure(14, toneText(toneOf(Format.percentSign(r)))), maxLines = 1)
                }
            }
        }
        Spacer(GlanceModifier.defaultWeight())
        AgeText(today, snapshot.fetchedAtMs!!, nowMs, compact = true)
    }
}

class BestWorstWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = BestWorstWidget()

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        runCatching { RefreshScheduler.runOnce(context) }
    }
}
