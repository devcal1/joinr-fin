package com.tenon.joinrfinance.ui

import android.app.Application
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import com.tenon.joinrfinance.FakeBox
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.Graph
import com.tenon.joinrfinance.MemoryDataStore
import com.tenon.joinrfinance.PeriodFixtures
import com.tenon.joinrfinance.Services
import com.tenon.joinrfinance.model.Period
import com.tenon.joinrfinance.store.Pairing
import com.tenon.joinrfinance.store.PeriodsFakeApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The selected period (D163) and the view model's periods trigger (Stage 10 plan section 9.2) on a real [MainViewModel]
 * with a test [Graph].
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PeriodStateTest {
    @get:Rule val tmp = TemporaryFolder()
    private val app: Application get() = ApplicationProvider.getApplicationContext()
    private lateinit var api: PeriodsFakeApi
    private lateinit var graph: Graph
    private val pairing = Pairing("http://umbrel.example-tailnet.ts.net:4932", Fixtures.FAKE_KEY, "d_0000000000000001", "Android phone", "2030-09-12T05:10:00.000Z", "1.3.0", "Australia/Melbourne")

    private fun newGraph(): Graph = Graph(
        app,
        box = FakeBox(),
        api = api,
        widgetUpdater = {},
        storeDir = tmp.newFolder(),
        pairingDataStore = MemoryDataStore(),
        prefsDataStore = MemoryDataStore(),
    ).also { Services.install(it) }

    @Before
    fun setUp() {
        api = PeriodsFakeApi()
        graph = newGraph()
    }

    @After
    fun tearDown() {
        Services.install(null)
    }

    /** Runs the main looper until [cond] holds (the repository hops to the IO dispatcher for its files). */
    private fun await(what: String, cond: () -> Boolean) {
        val until = System.currentTimeMillis() + 5_000
        while (!cond()) {
            shadowOf(Looper.getMainLooper()).idle()
            if (System.currentTimeMillis() > until) throw AssertionError("timed out waiting for $what")
            Thread.sleep(5)
        }
    }

    /** Lets any pending work run for a moment (to show that nothing more happens). */
    private fun settle() {
        repeat(30) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }
    }

    /** Paired, with a Today and a fresh periods answer cached (so selecting a chip fetches nothing by itself). */
    private fun pairedWithCaches(): MainViewModel = runBlocking {
        val now = System.currentTimeMillis()
        graph.pairingStore.save(pairing)
        graph.cache.write(Fixtures.open, now - 10_000)
        graph.periodsCache.write(PeriodFixtures.open, now, pairing.origin, pairing.deviceId)
        MainViewModel(app).also { vm -> await("loaded") { vm.ui.value.loaded && vm.ui.value.periods != null } }
    }

    @Test
    fun thePeriodSurvivesANewViewModelWhileTheGraphLives() {
        val first = MainViewModel(app)
        await("first loaded") { first.ui.value.loaded }
        assertEquals(Period.ONE_DAY, first.ui.value.period)
        first.selectPeriod(Period.ONE_WEEK)
        await("1W") { first.ui.value.period == Period.ONE_WEEK }
        // Backing out and reopening (a new activity, a new view model) keeps the period while the process lives.
        val second = MainViewModel(app)
        await("second") { second.ui.value.loaded }
        assertEquals(Period.ONE_WEEK, second.ui.value.period)
        // A cold start (a new process: a new graph) is always 1D.
        newGraph()
        val third = MainViewModel(app)
        await("third") { third.ui.value.loaded }
        assertEquals(Period.ONE_DAY, third.ui.value.period)
    }

    @Test
    fun aWorkerStyleTodayUpdateUnder1WWhileVisibleFetchesOnce() {
        val vm = pairedWithCaches()
        vm.setVisible(true)
        vm.selectPeriod(Period.ONE_WEEK)
        settle()
        assertEquals("a fresh cached answer: no fetch on the chip", 0, api.periodsCalls)
        // The worker refreshes Today through the shared repository.
        runBlocking { graph.repository.refresh() }
        await("one periods call") { api.periodsCalls == 1 }
        settle()
        assertEquals(1, api.periodsCalls)
    }

    @Test
    fun under1DATodayUpdateFetchesNothing() {
        val vm = pairedWithCaches()
        vm.setVisible(true)
        runBlocking { graph.repository.refresh() }
        settle()
        assertEquals(0, api.periodsCalls)
        assertEquals(Period.ONE_DAY, vm.ui.value.period)
    }

    @Test
    fun inTheBackgroundATodayUpdateFetchesNothing() {
        val vm = pairedWithCaches()
        vm.selectPeriod(Period.ONE_WEEK)
        vm.setVisible(false)
        runBlocking { graph.repository.refresh() }
        settle()
        assertEquals(0, api.periodsCalls)
    }

    @Test
    fun twoOverlappingTriggersMakeOneRequest() {
        val vm = pairedWithCaches()
        vm.setVisible(true)
        vm.selectPeriod(Period.ONE_WEEK)
        settle()
        val gate = CompletableDeferred<Unit>()
        api.periodsGate = gate
        runBlocking { graph.repository.refresh() }
        await("first periods call") { api.periodsCalls == 1 }
        await("loading") { vm.ui.value.periodsLoading }
        Thread.sleep(5)
        runBlocking { graph.repository.refresh() }
        settle()
        gate.complete(Unit)
        await("done") { !vm.ui.value.periodsLoading }
        settle()
        assertEquals(1, api.periodsCalls)
    }

    @Test
    fun aNon1DChipWithoutAnAnswerFetchesOne() {
        runBlocking {
            graph.pairingStore.save(pairing)
            graph.cache.write(Fixtures.open, System.currentTimeMillis())
        }
        val vm = MainViewModel(app)
        await("loaded") { vm.ui.value.loaded && vm.ui.value.pairing != null }
        vm.selectPeriod(Period.ALL)
        await("fetched") { vm.ui.value.periods != null }
        assertEquals(1, api.periodsCalls)
        // Back to 1D and on to 1M: the answer is fresh, so no new request.
        vm.selectPeriod(Period.ONE_DAY)
        vm.selectPeriod(Period.ONE_MONTH)
        settle()
        assertEquals(1, api.periodsCalls)
    }

    @Test
    fun openingUnder1DWarmsAMissingAnswer() {
        runBlocking { graph.pairingStore.save(pairing) }
        val vm = MainViewModel(app)
        await("loaded") { vm.ui.value.loaded }
        vm.onOpened()
        await("warmed") { api.periodsCalls == 1 && vm.ui.value.periods != null }
        // The periods error never reaches Today's state.
        api.periodsResult = com.tenon.joinrfinance.net.ApiResult.Err(com.tenon.joinrfinance.net.ApiError.ServerTooOld)
        vm.selectPeriod(Period.ONE_WEEK)
        runBlocking { graph.repository.periods(force = true) }
        await("too old") { vm.ui.value.periodsError != null }
        assertEquals(null, vm.ui.value.error)
        assertTrue(vm.ui.value.periods == null)
    }
}
