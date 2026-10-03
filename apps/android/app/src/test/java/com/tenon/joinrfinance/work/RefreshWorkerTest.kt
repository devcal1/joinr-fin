package com.tenon.joinrfinance.work

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import com.tenon.joinrfinance.FakeBox
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.Graph
import com.tenon.joinrfinance.MemoryDataStore
import com.tenon.joinrfinance.Services
import com.tenon.joinrfinance.net.ApiError
import com.tenon.joinrfinance.net.ApiResult
import com.tenon.joinrfinance.store.FakeApi
import com.tenon.joinrfinance.store.RefreshOutcome
import com.tenon.joinrfinance.ui.TEST_PAIRING
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class RefreshWorkerTest {
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val api = FakeApi()
    private var widgetRenders = 0
    private lateinit var graph: Graph

    @Before
    fun setUp() {
        graph = Graph(ctx, box = FakeBox(), api = api, widgetUpdater = { widgetRenders++ }, pairingDataStore = MemoryDataStore(), prefsDataStore = MemoryDataStore())
        Services.install(graph)
        runBlocking { graph.pairingStore.save(TEST_PAIRING) }
    }

    @After
    fun tearDown() {
        Services.install(null)
    }

    private fun run(): ListenableWorker.Result = runBlocking { TestListenableWorkerBuilder<RefreshWorker>(ctx).build().doWork() }

    private fun outcome(r: ListenableWorker.Result) = (r as ListenableWorker.Result.Success).outputData.getString(RefreshWorker.KEY_OUTCOME)

    @Test
    fun successCachesAndRendersTheWidgets() {
        assertEquals(RefreshOutcome.OK.name, outcome(run()))
        assertEquals(Fixtures.open, runBlocking { graph.cache.read() }!!.today)
        assertEquals(1, widgetRenders)
        assertTrue(runBlocking { graph.prefs.widgetsUpdatedAt() } != null)
    }

    @Test
    fun unreachableStillRendersTheWidgets() {
        api.todayResult = ApiResult.Err(ApiError.Unreachable)
        assertEquals(RefreshOutcome.FAILED.name, outcome(run()))
        assertEquals(1, widgetRenders)
    }

    @Test
    fun revokedClearsAndRenders() {
        runBlocking { graph.cache.write(Fixtures.open, 1L) }
        api.todayResult = ApiResult.Err(ApiError.Revoked)
        assertEquals(RefreshOutcome.REVOKED.name, outcome(run()))
        assertNull(runBlocking { graph.pairingStore.load() })
        assertNull(runBlocking { graph.cache.read() })
        assertTrue(widgetRenders >= 1)
    }
}
