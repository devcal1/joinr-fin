package com.tenon.joinrfinance.debug

import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.tenon.joinrfinance.Services
import com.tenon.joinrfinance.model.SortOrder
import com.tenon.joinrfinance.model.sortHoldings
import com.tenon.joinrfinance.widget.BestWorstWidgetReceiver
import com.tenon.joinrfinance.widget.HoldingWidgetReceiver
import com.tenon.joinrfinance.widget.TodayWidgetReceiver
import com.tenon.joinrfinance.widget.Widgets
import kotlinx.coroutines.launch

/**
 * DEBUG ONLY (src/debug; never in a release build). Hosts the three widgets through [AppWidgetHost] so the emulator
 * smoke can screencap them (plan section 9.14). Binding needs
 * `adb shell appwidget grantbind --package <the debug applicationId>` first (API 35 has no `cmd appwidget`).
 *
 * Optional extras: `holding` (the holding widget's key; default: the largest cached holding).
 */
class WidgetHostActivity : ComponentActivity() {
    private lateinit var host: AppWidgetHost
    private val ids = mutableListOf<Int>()

    /** The smoke's sizes in dp: Today at 4 × 2 and 4 × 3, the two small widgets at 2 × 2. */
    private val placements = listOf(
        Triple("Today 4 x 2", TodayWidgetReceiver::class.java, 320 to 160),
        Triple("Today 4 x 3", TodayWidgetReceiver::class.java, 320 to 280),
        Triple("Holding 2 x 2", HoldingWidgetReceiver::class.java, 160 to 160),
        Triple("Best / worst 2 x 2", BestWorstWidgetReceiver::class.java, 160 to 160),
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        host = AppWidgetHost(this, HOST_ID)
        val manager = AppWidgetManager.getInstance(this)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(32), dp(16), dp(32))
        }
        lifecycleScope.launch {
            val graph = Services.get(this@WidgetHostActivity)
            val repo = graph.repository
            repo.load()
            val chosen = intent.getStringExtra("holding")
                ?: repo.data.value.today?.let { sortHoldings(it.holdings, SortOrder.VALUE).firstOrNull()?.key }
            for ((label, cls, size) in placements) {
                val provider = ComponentName(this@WidgetHostActivity, cls)
                val id = host.allocateAppWidgetId()
                val options = sizeOptions(size.first, size.second)
                if (!manager.bindAppWidgetIdIfAllowed(id, provider, options)) {
                    column.addView(caption("$label: binding refused (run grantbind first)"))
                    host.deleteAppWidgetId(id)
                    continue
                }
                ids += id
                if (cls == HoldingWidgetReceiver::class.java && chosen != null) graph.prefs.setWidgetHolding(id, chosen)
                manager.updateAppWidgetOptions(id, options)
                val info = manager.getAppWidgetInfo(id)
                val view = host.createView(this@WidgetHostActivity, id, info)
                // AppWidgetHostView adds 8 dp of default padding; launchers on API 31+ give the widget its whole
                // cell, so the frame below is the size the widget gets.
                view.setPadding(0, 0, 0, 0)
                column.addView(caption(label))
                column.addView(view, LinearLayout.LayoutParams(dp(size.first), dp(size.second)).apply { bottomMargin = dp(16) })
            }
            Widgets.updateAll(this@WidgetHostActivity)
        }
        setContentView(ScrollView(this).apply { addView(column, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) })
    }

    override fun onStart() {
        super.onStart()
        host.startListening()
    }

    override fun onStop() {
        super.onStop()
        host.stopListening()
    }

    override fun onDestroy() {
        if (isFinishing) ids.forEach { host.deleteAppWidgetId(it) }
        super.onDestroy()
    }

    private fun sizeOptions(w: Int, h: Int) = Bundle().apply {
        putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, w)
        putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, w)
        putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, h)
        putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, h)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            putParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES, arrayListOf(SizeF(w.toFloat(), h.toFloat())))
        }
    }

    private fun caption(text: String) = TextView(this).apply {
        this.text = text
        setTextColor(0xFF9A9BA8.toInt())
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        setPadding(0, 0, 0, dp(6))
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private companion object {
        const val HOST_ID = 4242
    }
}
