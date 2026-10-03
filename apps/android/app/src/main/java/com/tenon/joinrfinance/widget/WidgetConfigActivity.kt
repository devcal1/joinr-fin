package com.tenon.joinrfinance.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.appwidget.GlanceAppWidgetManager
import com.tenon.joinrfinance.MainActivity
import com.tenon.joinrfinance.MainActivity.Companion.enableDarkEdgeToEdge
import com.tenon.joinrfinance.Services
import com.tenon.joinrfinance.model.SortOrder
import com.tenon.joinrfinance.model.sortHoldings
import com.tenon.joinrfinance.ui.components.SpectrumRule
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.ui.theme.JoinrTheme
import com.tenon.joinrfinance.ui.theme.JoinrType
import com.tenon.joinrfinance.work.RefreshScheduler
import kotlinx.coroutines.launch

/**
 * The holding widget's configuration (plan section 9.6): exported so the launcher can start it, it shows codes only
 * (no figures), uses FLAG_SECURE on release, and answers RESULT_CANCELED unless started with a valid appWidgetId
 * that belongs to this app's holding provider. The choice is stored by the holding's `key`.
 */
class WidgetConfigActivity : ComponentActivity() {
    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        enableDarkEdgeToEdge()
        super.onCreate(savedInstanceState)
        setResult(Activity.RESULT_CANCELED)
        if (MainActivity.secureWindow) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        appWidgetId = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (!isOurHoldingWidget(appWidgetId)) {
            finish()
            return
        }
        setContent { JoinrTheme { ConfigScreen(::choose) } }
    }

    private fun isOurHoldingWidget(id: Int): Boolean {
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return false
        val info = AppWidgetManager.getInstance(this).getAppWidgetInfo(id) ?: return false
        return info.provider == ComponentName(this, HoldingWidgetReceiver::class.java)
    }

    private suspend fun choose(key: String) {
        val graph = Services.get(this)
        graph.prefs.setWidgetHolding(appWidgetId, key)
        runCatching {
            val glanceId = GlanceAppWidgetManager(this).getGlanceIdBy(appWidgetId)
            HoldingWidget().update(this, glanceId)
        }
        runCatching { RefreshScheduler.runOnce(this) }
        setResult(Activity.RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
        finish()
    }
}

@Composable
private fun ConfigScreen(onChoose: suspend (String) -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var items by remember { mutableStateOf<List<Pair<String, String>>?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        val repo = Services.get(context).repository
        repo.load()
        val today = repo.data.value.today
        items = today?.let { t -> sortHoldings(t.holdings, SortOrder.VALUE).map { it.key to it.code } } ?: emptyList()
    }
    Column(Modifier.fillMaxSize().background(JoinrColors.Ink).windowInsetsPadding(WindowInsets.safeDrawing).testTag("config")) {
        SpectrumRule()
        Text(
            "CHOOSE A HOLDING",
            style = JoinrType.label(size = 13.sp, tracking = 0.12f, color = JoinrColors.TextBright),
            modifier = Modifier.padding(16.dp),
        )
        val list = items
        if (list != null && list.isEmpty()) {
            Text(
                "Open Joinr Finance first: the list comes from its last update.",
                style = JoinrType.body(size = 13.sp),
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            list.orEmpty().forEach { (key, code) ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(JoinrColors.Surface)
                        .clickable(onClickLabel = "Show $code", role = Role.Button) { scope.launch { onChoose(key) } }
                        .padding(horizontal = 12.dp)
                        .testTag("choose-$key"),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text(code, style = JoinrType.figure(size = 14.sp, color = JoinrColors.TextBright, weight = FontWeight.W700))
                }
            }
        }
    }
}
