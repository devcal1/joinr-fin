package com.tenon.joinrfinance.ui.nav

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tenon.joinrfinance.model.Period
import com.tenon.joinrfinance.ui.AppActions
import com.tenon.joinrfinance.ui.AppUiState
import com.tenon.joinrfinance.ui.LockUi
import com.tenon.joinrfinance.ui.PairStep
import com.tenon.joinrfinance.ui.components.JoinrIcons
import com.tenon.joinrfinance.ui.detail.DetailScreen
import com.tenon.joinrfinance.ui.lock.LockScreen
import com.tenon.joinrfinance.ui.pair.ByHandScreen
import com.tenon.joinrfinance.ui.pair.ConfirmScreen
import com.tenon.joinrfinance.ui.pair.ExchangingScreen
import com.tenon.joinrfinance.ui.pair.NotPairedScreen
import com.tenon.joinrfinance.ui.pair.PairFailedScreen
import com.tenon.joinrfinance.ui.pair.RevokedScreen
import com.tenon.joinrfinance.ui.settings.LicencesScreen
import com.tenon.joinrfinance.ui.settings.SettingsScreen
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.ui.theme.JoinrType
import com.tenon.joinrfinance.ui.today.TodayScreen
import kotlinx.coroutines.launch

/** The two top-level destinations (D146). */
enum class Destination(val label: String) { TODAY("TODAY"), SETTINGS("SETTINGS") }

const val BOTTOM_BAR_HEIGHT_DP = 58

/**
 * The app's root: the lock, the full-screen states (not paired, pairing, revoked) without the bottom bar, then
 * Today and Settings with the bar, and the pushed screens (a holding's detail, the licences) without it.
 *
 * @param openHolding a holding to open (a widget tap); [onHoldingOpened] clears the request.
 */
@Composable
fun JoinrApp(
    state: AppUiState,
    actions: AppActions,
    openHolding: String? = null,
    onHoldingOpened: () -> Unit = {},
) {
    Box(Modifier.fillMaxSize().background(JoinrColors.Ink)) {
        val lock = state.lock
        val step = state.pairStep
        when {
            lock is LockUi.Locked -> LockScreen(lock.message, actions::unlock)
            !state.loaded -> Box(Modifier.fillMaxSize().testTag("loading"))
            step is PairStep.ByHand -> {
                BackHandler { actions.cancelPair() }
                ByHandScreen(step, actions)
            }
            step is PairStep.Confirm -> {
                BackHandler { actions.cancelPair() }
                ConfirmScreen(step, actions)
            }
            step is PairStep.Exchanging -> ExchangingScreen(step)
            step is PairStep.Failed -> {
                BackHandler { actions.cancelPair() }
                PairFailedScreen(step, actions)
            }
            state.revoked -> RevokedScreen(actions)
            state.pairing == null -> NotPairedScreen(state.scanner, state.scanMessage, actions)
            else -> Shell(state, actions, openHolding, onHoldingOpened)
        }
    }
}

@Composable
private fun Shell(state: AppUiState, actions: AppActions, openHolding: String?, onHoldingOpened: () -> Unit) {
    var destination by rememberSaveable { mutableStateOf(Destination.TODAY) }
    var detailKey by rememberSaveable { mutableStateOf<String?>(null) }
    // D169: a detail opened from a widget shows the day (1D) without changing the held period.
    var detailFromWidget by rememberSaveable { mutableStateOf(false) }
    var licences by rememberSaveable { mutableStateOf(false) }
    val todayList = rememberLazyListState()
    val scope = rememberCoroutineScope()

    LaunchedEffect(openHolding) {
        if (openHolding != null) {
            destination = Destination.TODAY
            licences = false
            detailKey = openHolding
            detailFromWidget = true
            onHoldingOpened()
        }
    }

    val today = state.today
    when {
        detailKey != null && today != null -> {
            BackHandler { detailKey = null }
            Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                DetailScreen(
                    today,
                    today.holdings.firstOrNull { it.key == detailKey },
                    onBack = { detailKey = null },
                    period = if (detailFromWidget) Period.ONE_DAY else state.period,
                    periods = state.periods,
                )
            }
        }
        licences -> {
            BackHandler { licences = false }
            Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                LicencesScreen { licences = false }
            }
        }
        else -> {
            if (destination == Destination.SETTINGS) BackHandler { destination = Destination.TODAY }
            Scaffold(
                containerColor = JoinrColors.Ink,
                contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal),
                bottomBar = {
                    BottomBar(destination) { d ->
                        if (d == destination) {
                            if (d == Destination.TODAY) scope.launch { todayList.animateScrollToItem(0) }
                        } else {
                            destination = d
                        }
                    }
                },
            ) { padding ->
                Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))) {
                    when (destination) {
                        Destination.TODAY -> TodayScreen(
                            state,
                            actions,
                            onOpen = {
                                detailFromWidget = false
                                detailKey = it
                            },
                            listState = todayList,
                            contentPadding = padding,
                        )
                        Destination.SETTINGS -> SettingsScreen(state, actions, onLicences = { licences = true }, contentPadding = padding)
                    }
                }
            }
        }
    }
}

/**
 * The bottom bar (D146): two items, 58 dp plus the navigation-bar inset, a hairline top border, 20 dp line icons over
 * 11 sp bold uppercase labels; selected teal. A `selectableGroup` of `Role.Tab` items (TalkBack: "Today, tab,
 * selected, 1 of 2"); the icons are decorative.
 */
@Composable
fun BottomBar(selected: Destination, onSelect: (Destination) -> Unit) {
    Column(Modifier.fillMaxWidth().background(JoinrColors.Ink).testTag("bottom-bar")) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(JoinrColors.Hairline))
        Row(
            Modifier
                .fillMaxWidth()
                .height(BOTTOM_BAR_HEIGHT_DP.dp)
                .selectableGroup(),
        ) {
            Destination.entries.forEach { d ->
                val on = d == selected
                val tint = if (on) JoinrColors.Teal else JoinrColors.TextSecondary
                Column(
                    Modifier
                        .weight(1f)
                        .fillMaxSize()
                        .selectable(selected = on, role = Role.Tab, onClick = { onSelect(d) })
                        .testTag("nav-${d.name}"),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
                ) {
                    Icon(iconOf(d), contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
                    Text(d.label, style = JoinrType.label(size = 11.sp, tracking = 0.1f, color = tint))
                }
            }
        }
        Box(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars))
    }
}

private fun iconOf(d: Destination): ImageVector = when (d) {
    Destination.TODAY -> JoinrIcons.Today
    Destination.SETTINGS -> JoinrIcons.Settings
}
