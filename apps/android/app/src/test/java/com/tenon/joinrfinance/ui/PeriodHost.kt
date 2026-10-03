package com.tenon.joinrfinance.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.PeriodFixtures
import com.tenon.joinrfinance.model.Period
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.net.MobilePeriodsResponse
import com.tenon.joinrfinance.net.MobileTodayResponse
import com.tenon.joinrfinance.ui.nav.JoinrApp
import com.tenon.joinrfinance.ui.theme.JoinrTheme

/** A paired, unlocked state under [period] with a periods answer (fetched when the Today fixture was generated). */
fun periodState(
    period: Period,
    answer: MobilePeriodsResponse? = PeriodFixtures.open,
    today: MobileTodayResponse? = Fixtures.open,
): AppUiState = pairedState(today).copy(
    period = period,
    periods = answer,
    periodsFetchedAtMs = answer?.let { PeriodFixtures.generatedMs(it) },
)

/** A stateful host with the Stage 10 action (the Stage 9 [TestHost] is untouched): chips, tabs, sort and a widget tap. */
class PeriodHost(initial: AppUiState) : AppActions {
    var state by mutableStateOf(initial)

    /** A widget tap's holding key (the activity's `openHolding`). */
    var openHolding by mutableStateOf<String?>(null)
    val calls = mutableListOf<String>()

    override fun refresh() {
        calls += "refresh"
    }

    override fun selectTab(tab: TodayTab) {
        state = state.copy(tab = tab)
    }

    override fun cycleSort() {
        state = state.copy(sort = state.sort.next())
    }

    override fun selectPeriod(p: Period) {
        calls += "period ${p.chip}"
        state = state.copy(period = p)
    }

    override fun unlock() = Unit
    override fun startScan() = Unit
    override fun startByHand() = Unit
    override fun updateByHand(address: String, code: String) = Unit
    override fun submitByHand() = Unit
    override fun confirmPair() = Unit
    override fun cancelPair() = Unit
    override fun pairAgain() = Unit
    override fun unpair() = Unit

    @Composable
    fun Content(fontScale: Float? = null) {
        val base = LocalDensity.current
        val density = if (fontScale == null) base else Density(base.density, fontScale)
        CompositionLocalProvider(LocalDensity provides density) {
            JoinrTheme { JoinrApp(state, this, openHolding = openHolding, onHoldingOpened = { openHolding = null }) }
        }
    }
}
