package com.tenon.joinrfinance.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.net.MobileTodayResponse
import com.tenon.joinrfinance.store.Pairing
import com.tenon.joinrfinance.ui.nav.JoinrApp
import com.tenon.joinrfinance.ui.theme.JoinrTheme

val TEST_PAIRING = Pairing(
    origin = "http://umbrel.example-tailnet.ts.net:4932",
    key = Fixtures.FAKE_KEY,
    deviceId = "d_0000000000000001",
    label = "Android phone",
    pairedAt = "2030-09-12T05:10:00.000Z",
    serverVersion = "1.2.0",
    timeZone = "Australia/Melbourne",
)

/** A paired, unlocked state showing a fixture. */
fun pairedState(today: MobileTodayResponse? = Fixtures.open): AppUiState = AppUiState(
    loaded = true,
    lock = LockUi.Unlocked,
    pairing = TEST_PAIRING,
    today = today,
    fetchedAtMs = today?.let { Fixtures.generatedMs(it) },
    nowMs = today?.let { Fixtures.generatedMs(it) } ?: 0L,
)

/** A stateful host: the actions change the state as the view model would (tab, sort, pairing steps). */
class TestHost(initial: AppUiState) : AppActions {
    var state by mutableStateOf(initial)
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

    override fun unlock() {
        calls += "unlock"
    }

    override fun startScan() {
        calls += "scan"
    }

    override fun startByHand() {
        state = state.copy(pairStep = PairStep.ByHand())
    }

    override fun updateByHand(address: String, code: String) {
        state = state.copy(pairStep = PairStep.ByHand(address, code))
    }

    override fun submitByHand() {
        val step = state.pairStep as? PairStep.ByHand ?: return
        state = state.copy(pairStep = byHandNext(step, state.pairing != null))
    }

    override fun confirmPair() {
        calls += "confirm"
    }

    override fun cancelPair() {
        state = state.copy(pairStep = null)
    }

    override fun pairAgain() {
        state = state.copy(revoked = false)
    }

    override fun unpair() {
        calls += "unpair"
    }

    @Composable
    fun Content(fontScale: Float? = null) {
        val base = LocalDensity.current
        val density = if (fontScale == null) base else Density(base.density, fontScale)
        CompositionLocalProvider(LocalDensity provides density) {
            JoinrTheme { JoinrApp(state, this) }
        }
    }
}
