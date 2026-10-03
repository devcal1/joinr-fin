package com.tenon.joinrfinance.store

import com.tenon.joinrfinance.FakeBox
import com.tenon.joinrfinance.MemoryDataStore
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.model.SortOrder
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.net.ApiError
import com.tenon.joinrfinance.net.ApiJson
import com.tenon.joinrfinance.net.ApiResult
import com.tenon.joinrfinance.net.MobileApi
import com.tenon.joinrfinance.net.MobileDeviceResponse
import com.tenon.joinrfinance.net.MobilePairRequest
import com.tenon.joinrfinance.net.MobilePairResponse
import com.tenon.joinrfinance.net.MobileTodayResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** A scripted phone API. */
class FakeApi : MobileApi {
    var todayResult: ApiResult<MobileTodayResponse> = ApiResult.Ok(Fixtures.open)
    var pairResult: ApiResult<MobilePairResponse> =
        ApiResult.Ok(ApiJson.decodeFromString(MobilePairResponse.serializer(), Fixtures.text("pair-ok.json")))
    var deviceResult: ApiResult<MobileDeviceResponse> =
        ApiResult.Ok(ApiJson.decodeFromString(MobileDeviceResponse.serializer(), Fixtures.text("device-ok.json")))
    val calls = mutableListOf<String>()
    var lastPair: MobilePairRequest? = null

    override suspend fun today(origin: String, key: String): ApiResult<MobileTodayResponse> {
        calls += "today $origin"
        return todayResult
    }

    override suspend fun device(origin: String, key: String): ApiResult<MobileDeviceResponse> {
        calls += "device $origin"
        return deviceResult
    }

    override suspend fun pair(origin: String, request: MobilePairRequest): ApiResult<MobilePairResponse> {
        calls += "pair $origin"
        lastPair = request
        return pairResult
    }
}

class StoreTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var scope: CoroutineScope
    private lateinit var dir: File
    private val box = FakeBox()
    private val api = FakeApi()
    private var widgetUpdates = 0
    private var now = 1_915_401_600_000L

    private lateinit var pairingStore: PairingStore
    private lateinit var prefs: Prefs
    private lateinit var cache: TodayCache
    private lateinit var repo: Repository

    @Before
    fun setUp() {
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        dir = tmp.newFolder()
        pairingStore = PairingStore(MemoryDataStore(), box)
        prefs = Prefs(MemoryDataStore())
        cache = TodayCache(File(dir, "today.cache"), box)
        repo = Repository(pairingStore, cache, prefs, api, { widgetUpdates++ }, { now })
    }

    @After
    fun tearDown() {
        scope.cancel()
    }

    private val pairing = Pairing("http://umbrel.example-tailnet.ts.net:4932", Fixtures.FAKE_KEY, "d_0000000000000001", "Android phone", "2030-09-12T05:10:00.000Z", "1.2.0", "Australia/Melbourne")

    @Test
    fun pairingIsSealedAtRestAndRoundTrips() = runBlocking {
        pairingStore.save(pairing)
        assertEquals(pairing, pairingStore.load())
        val raw = pairingStore.rawValues()
        assertTrue(raw.values.none { it.toString().contains("jfk_") })
        assertTrue(raw.values.none { it.toString().contains("umbrel.example") })
        assertFalse(pairing.toString().contains("jfk_"))
    }

    @Test
    fun cacheIsSealedAndRoundTrips() = runBlocking {
        cache.write(Fixtures.open, now)
        val text = File(dir, "today.cache").readText()
        assertFalse(text.contains("\"holdings\""))
        val entry = cache.read()!!
        assertEquals(Fixtures.open, entry.today)
        assertEquals(now, entry.fetchedAtMs)
        cache.clear()
        assertNull(cache.read())
    }

    @Test
    fun anUnreadableBoxMeansNotPaired() = runBlocking {
        pairingStore.save(pairing)
        val other = PairingStore(MemoryDataStore(), box)
        assertNull(other.load())
        val broken = object : Box {
            override fun seal(plain: String) = "x"
            override fun open(sealed: String): String? = null
        }
        assertNull(TodayCache(File(dir, "today.cache"), broken).read())
    }

    @Test
    fun prefsKeepTheSortTabAndWidgetChoices() = runBlocking {
        assertEquals(SortOrder.DAY_CENTS, prefs.sort())
        prefs.setSort(SortOrder.VALUE)
        prefs.setTab(TodayTab.MOVERS)
        prefs.setWidgetHolding(7, "bullion-silver")
        assertEquals(SortOrder.VALUE, prefs.sort())
        assertEquals(TodayTab.MOVERS, prefs.tab())
        assertEquals("bullion-silver", prefs.widgetHolding(7))
        prefs.clearWidgets()
        assertNull(prefs.widgetHolding(7))
        assertEquals(SortOrder.VALUE, prefs.sort())
    }

    @Test
    fun pairThenRefresh() = runBlocking {
        val res = repo.pair("http://Umbrel.example-tailnet.ts.net:4932/", "abcde-12345", "Android phone", "1.0.0")
        assertEquals(Repository.PairOutcome.Ok, res)
        assertEquals("ABCDE12345", api.lastPair!!.code)
        assertEquals(listOf("pair http://umbrel.example-tailnet.ts.net:4932", "device http://umbrel.example-tailnet.ts.net:4932", "today http://umbrel.example-tailnet.ts.net:4932"), api.calls)
        val d = repo.data.value
        assertEquals("d_0000000000000001", d.pairing!!.deviceId)
        assertEquals(Fixtures.FAKE_KEY, d.pairing!!.key)
        assertEquals(Fixtures.open, d.today)
        assertEquals(now, d.fetchedAtMs)
        assertTrue(widgetUpdates >= 1)
        assertNotNull(pairingStore.load())
    }

    @Test
    fun aFailedPairStoresNothing() = runBlocking {
        api.pairResult = ApiResult.Err(ApiError.Pairing("PAIRING_CODE_INVALID"))
        val res = repo.pair("http://umbrel:4932", "ABCDE12345", "x", "1.0.0")
        assertEquals(Repository.PairOutcome.Failed(ApiError.Pairing("PAIRING_CODE_INVALID")), res)
        assertNull(pairingStore.load())
    }

    @Test
    fun unreachableKeepsTheCacheAndStillRendersTheWidgets() = runBlocking {
        pairingStore.save(pairing)
        cache.write(Fixtures.saturday, now - 3_600_000L)
        api.todayResult = ApiResult.Err(ApiError.Unreachable)
        assertEquals(RefreshOutcome.FAILED, repo.refresh())
        val d = repo.data.value
        assertEquals(Fixtures.saturday, d.today)
        assertEquals(ApiError.Unreachable, d.error)
        assertEquals(1, widgetUpdates)
    }

    @Test
    fun revokedClearsKeyCacheAndWidgets() = runBlocking {
        pairingStore.save(pairing)
        cache.write(Fixtures.open, now)
        prefs.setWidgetHolding(3, "i1")
        api.todayResult = ApiResult.Err(ApiError.Revoked)
        assertEquals(RefreshOutcome.REVOKED, repo.refresh())
        assertNull(pairingStore.load())
        assertTrue(pairingStore.isRevoked())
        assertNull(cache.read())
        assertNull(prefs.widgetHolding(3))
        val d = repo.data.value
        assertTrue(d.revoked)
        assertNull(d.today)
        assertTrue(widgetUpdates >= 1)
        repo.acknowledgeRevoked()
        assertFalse(repo.data.value.revoked)
        assertFalse(pairingStore.isRevoked())
    }

    @Test
    fun unpairClearsEverything() = runBlocking {
        pairingStore.save(pairing)
        cache.write(Fixtures.open, now)
        repo.load()
        repo.unpair()
        assertNull(pairingStore.load())
        assertFalse(pairingStore.isRevoked())
        assertNull(cache.read())
        assertNull(repo.data.value.pairing)
    }

    @Test
    fun refreshWithoutPairing() = runBlocking {
        assertEquals(RefreshOutcome.NOT_PAIRED, repo.refresh())
        assertTrue(api.calls.isEmpty())
    }
}
