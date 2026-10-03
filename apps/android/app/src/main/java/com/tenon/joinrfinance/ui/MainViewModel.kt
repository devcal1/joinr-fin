package com.tenon.joinrfinance.ui

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.tenon.joinrfinance.BuildConfig
import com.tenon.joinrfinance.Graph
import com.tenon.joinrfinance.Services
import com.tenon.joinrfinance.model.PairingUrl
import com.tenon.joinrfinance.model.Period
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.model.periodsStale
import com.tenon.joinrfinance.model.periodsWarmNeeded
import com.tenon.joinrfinance.net.ApiError
import com.tenon.joinrfinance.net.Sentences
import com.tenon.joinrfinance.store.Repository
import com.tenon.joinrfinance.ui.pair.SCANNER_FAILED
import com.tenon.joinrfinance.ui.pair.SCANNER_UNAVAILABLE
import com.tenon.joinrfinance.work.RefreshScheduler
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

const val NOT_A_PAIRING_CODE = "That QR code is not a Joinr Finance pairing code. Show the code in Settings → Phone."
const val ADDRESS_HINT = "Enter the server address as http://name:port, for example http://umbrel.example-tailnet.ts.net:4932."
const val CODE_HINT = "The pairing code is 10 letters and digits."

/** The app's state holder: mirrors the repository, keeps the UI choices, runs the pairing flow. */
class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val graph: Graph = Services.get(app)
    private val repository: Repository = graph.repository
    private val state = MutableStateFlow(AppUiState(appVersion = BuildConfig.VERSION_NAME))
    val ui: StateFlow<AppUiState> = state.asStateFlow()

    /** Set by the activity's onStart/onStop: the periods trigger runs only while the app is on screen. */
    @Volatile private var visible = false

    /** The Today fetch time last seen, so the trigger fires only when it moves forward (any source). */
    private var lastTodayFetchMs: Long? = null
    private var seenToday = false

    init {
        viewModelScope.launch {
            graph.period.collect { p -> state.update { it.copy(period = p) } }
        }
        viewModelScope.launch {
            repository.periodsData.collect { p ->
                state.update {
                    it.copy(periods = p.periods, periodsFetchedAtMs = p.fetchedAtMs, periodsLoading = p.loading, periodsError = p.error)
                }
            }
        }
        viewModelScope.launch {
            repository.load()
            val tab = graph.prefs.tab()
            val sort = graph.prefs.sort()
            state.update { it.copy(tab = tab, sort = sort) }
            repository.data.collect { d ->
                onTodayData(d.fetchedAtMs, d.error == null)
                val widgetsAt = graph.prefs.widgetsUpdatedAt()
                state.update {
                    it.copy(
                        loaded = d.loaded,
                        pairing = d.pairing,
                        revoked = d.revoked,
                        today = d.today,
                        fetchedAtMs = d.fetchedAtMs,
                        refreshing = d.refreshing,
                        error = d.error,
                        widgetsUpdatedAtMs = widgetsAt,
                    )
                }
            }
        }
        viewModelScope.launch {
            while (isActive) {
                state.update { it.copy(nowMs = System.currentTimeMillis()) }
                delay(30_000)
            }
        }
    }

    fun setLock(lock: LockUi) = state.update { it.copy(lock = lock) }

    /** The activity's onStart (true) and onStop (false). */
    fun setVisible(on: Boolean) {
        visible = on
    }

    /**
     * Stage 10 plan section 9.2: whenever the Today fetch time moves forward without an error (the app's refreshes and the
     * worker's alike) while the app is visible and a non-1D chip is selected, the periods are fetched (single-flight).
     */
    private fun onTodayData(fetchedAtMs: Long?, ok: Boolean) {
        val before = lastTodayFetchMs
        val first = !seenToday
        seenToday = true
        if (fetchedAtMs == null || (before != null && fetchedAtMs <= before)) return
        lastTodayFetchMs = fetchedAtMs
        if (first || !ok || !visible || graph.period.value.isDay) return
        viewModelScope.launch { repository.periods(force = true) }
    }

    /** A chip: held in the process-wide graph (D163); a non-1D chip with no fresh answer fetches one (plan section 9.3 (b)). */
    fun selectPeriod(p: Period) {
        graph.period.value = p
        if (p.isDay) return
        val s = state.value
        val d = repository.periodsData.value
        if (s.pairing != null && periodsStale(d.fetchedAtMs, repository.data.value.fetchedAtMs, System.currentTimeMillis())) {
            viewModelScope.launch { repository.periods(force = true) }
        }
    }

    /** After a successful unlock (or with no screen lock): refresh once and keep the periodic work. */
    fun onOpened() {
        val ctx = getApplication<Application>()
        runCatching {
            RefreshScheduler.ensurePeriodic(ctx)
            RefreshScheduler.runOnce(ctx)
        }
        warmPeriods()
    }

    /**
     * On open (plan section 9.3 (c)): under 1D a missing or 30-minute-old answer is fetched (a warm cache for the first chip
     * tap); under another chip only a missing one (the Today refresh just started triggers the rest).
     */
    private fun warmPeriods() {
        viewModelScope.launch {
            repository.load()
            if (repository.data.value.pairing == null) return@launch
            val d = repository.periodsData.value
            val need = if (graph.period.value.isDay) periodsWarmNeeded(d.fetchedAtMs, System.currentTimeMillis()) else d.periods == null
            if (need) repository.periods(force = true)
        }
    }

    fun refresh() {
        runCatching { RefreshScheduler.runOnce(getApplication()) }
            .onFailure { viewModelScope.launch { repository.refresh() } }
    }

    fun selectTab(tab: TodayTab) {
        state.update { it.copy(tab = tab) }
        viewModelScope.launch { graph.prefs.setTab(tab) }
    }

    fun cycleSort() {
        val next = state.value.sort.next()
        state.update { it.copy(sort = next) }
        viewModelScope.launch { graph.prefs.setSort(next) }
    }

    fun setScannerReady() = state.update { it.copy(scanner = ScannerState.READY) }

    fun onScanned(text: String) {
        val parsed = PairingUrl.parse(text)
        if (parsed == null) {
            state.update { it.copy(scanMessage = NOT_A_PAIRING_CODE) }
        } else {
            state.update { it.copy(scanMessage = null, pairStep = PairStep.Confirm(parsed.serverUrl, parsed.code, replacing = it.pairing != null)) }
        }
    }

    fun onScanFailed(unavailable: Boolean) =
        state.update { it.copy(scanMessage = if (unavailable) SCANNER_UNAVAILABLE else SCANNER_FAILED) }

    /** A `joinrfinance://pair` link: always the confirmation (after the lock), never a silent pairing. */
    fun onDeepLink(uri: String) {
        val parsed = PairingUrl.parse(uri) ?: return
        state.update { it.copy(pairStep = PairStep.Confirm(parsed.serverUrl, parsed.code, replacing = it.pairing != null)) }
    }

    fun startByHand() = state.update { it.copy(pairStep = PairStep.ByHand(), scanMessage = null) }

    fun updateByHand(address: String, code: String) = state.update {
        val step = it.pairStep as? PairStep.ByHand ?: PairStep.ByHand()
        it.copy(pairStep = step.copy(address = address, code = code, error = null))
    }

    fun submitByHand() {
        val step = state.value.pairStep as? PairStep.ByHand ?: return
        state.update { it.copy(pairStep = byHandNext(step, paired = it.pairing != null)) }
    }

    fun confirmPair() {
        val step = state.value.pairStep as? PairStep.Confirm ?: return
        state.update { it.copy(pairStep = PairStep.Exchanging(step.serverUrl)) }
        viewModelScope.launch {
            val deviceName = (Build.MANUFACTURER.orEmpty() + " " + Build.MODEL.orEmpty()).trim().ifEmpty { "Android phone" }
            when (val res = repository.pair(step.serverUrl, step.code, deviceName, BuildConfig.VERSION_NAME)) {
                Repository.PairOutcome.Ok -> {
                    state.update { it.copy(pairStep = null, scanMessage = null) }
                    onOpened()
                }
                is Repository.PairOutcome.Failed -> {
                    val message = if (res.error == ApiError.Unreachable) Sentences.UNREACHABLE else res.error.sentence
                    state.update { it.copy(pairStep = PairStep.Failed(message, step.serverUrl, step.code)) }
                }
            }
        }
    }

    fun cancelPair() = state.update { it.copy(pairStep = null) }

    fun pairAgain() {
        viewModelScope.launch { repository.acknowledgeRevoked() }
    }

    fun unpair() {
        viewModelScope.launch { repository.unpair() }
    }
}

/** By hand (plan section 9.5): `http://` is prepended when the typed address has no scheme; then the confirmation. */
fun byHandNext(step: PairStep.ByHand, paired: Boolean): PairStep {
    val origin = PairingUrl.normaliseServerUrl(PairingUrl.withDefaultScheme(step.address))
    val code = PairingUrl.normalisePairingCode(step.code)
    return when {
        origin == null -> step.copy(error = ADDRESS_HINT)
        code == null -> step.copy(error = CODE_HINT)
        else -> PairStep.Confirm(origin, code, replacing = paired)
    }
}
