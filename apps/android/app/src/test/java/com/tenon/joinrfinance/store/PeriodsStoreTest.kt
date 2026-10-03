package com.tenon.joinrfinance.store

import com.tenon.joinrfinance.FakeBox
import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.MemoryDataStore
import com.tenon.joinrfinance.PeriodFixtures
import com.tenon.joinrfinance.net.ApiError
import com.tenon.joinrfinance.net.ApiJson
import com.tenon.joinrfinance.net.ApiResult
import com.tenon.joinrfinance.net.MobileApi
import com.tenon.joinrfinance.net.MobileDeviceResponse
import com.tenon.joinrfinance.net.MobilePairRequest
import com.tenon.joinrfinance.net.MobilePairResponse
import com.tenon.joinrfinance.net.MobilePeriodsResponse
import com.tenon.joinrfinance.net.MobileTodayResponse
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.yield
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
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** A scripted phone API with `/periods` (the Stage 9 `FakeApi` is left untouched). */
class PeriodsFakeApi : MobileApi {
    var todayResult: ApiResult<MobileTodayResponse> = ApiResult.Ok(Fixtures.open)
    var periodsResult: ApiResult<MobilePeriodsResponse> = ApiResult.Ok(PeriodFixtures.open)
    var pairResult: ApiResult<MobilePairResponse> =
        ApiResult.Ok(ApiJson.decodeFromString(MobilePairResponse.serializer(), Fixtures.text("pair-ok.json")))

    /** When set, a periods call waits for it (to hold a request in flight). */
    @Volatile var periodsGate: CompletableDeferred<Unit>? = null
    val calls: MutableList<String> = Collections.synchronizedList(mutableListOf())
    val periodsCalls: Int get() = calls.count { it.startsWith("periods") }

    override suspend fun today(origin: String, key: String): ApiResult<MobileTodayResponse> {
        calls += "today $origin"
        return todayResult
    }

    override suspend fun device(origin: String, key: String): ApiResult<MobileDeviceResponse> {
        calls += "device $origin"
        return ApiResult.Ok(ApiJson.decodeFromString(MobileDeviceResponse.serializer(), Fixtures.text("device-ok.json")))
    }

    override suspend fun pair(origin: String, request: MobilePairRequest): ApiResult<MobilePairResponse> {
        calls += "pair $origin"
        return pairResult
    }

    override suspend fun periods(origin: String, key: String): ApiResult<MobilePeriodsResponse> {
        calls += "periods $origin"
        periodsGate?.await()
        return periodsResult
    }
}

/**
 * A [FakeBox] whose `seal` can be held (it runs inside `PeriodsCache.write`, on the IO dispatcher): it holds a periods
 * write between the fetch's pairing check and the file landing, to race an unpair or a re-pairing against it.
 */
class GatedBox : Box {
    private val inner = FakeBox()
    @Volatile var armed = false
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)

    override fun seal(plain: String): String {
        if (armed) {
            entered.countDown()
            release.await(10, TimeUnit.SECONDS)
        }
        return inner.seal(plain)
    }

    override fun open(sealed: String): String? = inner.open(sealed)
}

/** The periods cache and fetch (Stage 10 plan section 9.3); `StoreTest.kt` is untouched. */
class PeriodsStoreTest {
    @get:Rule val tmp = TemporaryFolder()
    private val box = FakeBox()
    private val api = PeriodsFakeApi()
    private var now = 1_915_401_600_000L
    private lateinit var dir: File
    private lateinit var pairingStore: PairingStore
    private lateinit var prefs: Prefs
    private lateinit var cache: TodayCache
    private lateinit var periodsCache: PeriodsCache
    private lateinit var repo: Repository

    private val origin = "http://umbrel.example-tailnet.ts.net:4932"
    private val pairing = Pairing(origin, Fixtures.FAKE_KEY, "d_0000000000000001", "Android phone", "2030-09-12T05:10:00.000Z", "1.3.0", "Australia/Melbourne")

    @Before
    fun setUp() {
        dir = tmp.newFolder()
        pairingStore = PairingStore(MemoryDataStore(), box)
        prefs = Prefs(MemoryDataStore())
        cache = TodayCache(File(dir, "today.cache"), box)
        periodsCache = PeriodsCache(File(dir, "periods.cache"), box)
        repo = Repository(pairingStore, cache, prefs, api, {}, { now }, periodsCache)
    }

    @Test
    fun theCacheIsSealedAndKeyedByThePairing() = runBlocking {
        periodsCache.write(PeriodFixtures.open, now, origin, "d1")
        assertFalse(File(dir, "periods.cache").readText().contains("\"periods\""))
        assertEquals(PeriodFixtures.open, periodsCache.read(origin, "d1")!!.periods)
        assertEquals(now, periodsCache.read(origin, "d1")!!.fetchedAtMs)
        // Another device id or origin: ignored and deleted.
        assertNull(periodsCache.read(origin, "d2"))
        assertFalse(periodsCache.exists())
        periodsCache.write(PeriodFixtures.open, now, origin, "d1")
        assertNull(periodsCache.read("http://umbrel:4932", "d1"))
        assertFalse(periodsCache.exists())
    }

    @Test
    fun fetchCachesAndLoadsAgain() = runBlocking {
        pairingStore.save(pairing)
        assertEquals(RefreshOutcome.OK, repo.periods(force = true))
        assertEquals(PeriodFixtures.open, repo.periodsData.value.periods)
        assertEquals(now, repo.periodsData.value.fetchedAtMs)
        assertFalse(repo.periodsData.value.loading)
        assertEquals(listOf("periods $origin"), api.calls)
        // A new process reads it back on load().
        val again = Repository(pairingStore, cache, prefs, api, {}, { now }, periodsCache)
        again.load()
        assertEquals(PeriodFixtures.open, again.periodsData.value.periods)
        // Not forced and fresh: no request.
        assertEquals(RefreshOutcome.OK, again.periods(force = false))
        assertEquals(1, api.periodsCalls)
        // Not forced but older than 30 minutes: fetched.
        now += 31 * 60_000L
        again.periods(force = false)
        assertEquals(2, api.periodsCalls)
    }

    @Test
    fun theWorkerAndRefreshNeverFetchPeriods() = runBlocking {
        pairingStore.save(pairing)
        assertEquals(RefreshOutcome.OK, repo.refresh())
        assertEquals(0, api.periodsCalls)
    }

    @Test
    fun clearAllAndUnpairClearThePeriods() = runBlocking {
        pairingStore.save(pairing)
        repo.periods(force = true)
        assertTrue(periodsCache.exists())
        repo.unpair()
        assertFalse(periodsCache.exists())
        assertNull(repo.periodsData.value.periods)
    }

    @Test
    fun aRevoked401ClearsBothCaches() = runBlocking {
        pairingStore.save(pairing)
        cache.write(Fixtures.open, now)
        periodsCache.write(PeriodFixtures.open, now, origin, pairing.deviceId)
        repo.load()
        api.periodsResult = ApiResult.Err(ApiError.Revoked)
        assertEquals(RefreshOutcome.REVOKED, repo.periods(force = true))
        assertNull(cache.read())
        assertFalse(periodsCache.exists())
        assertNull(pairingStore.load())
        assertTrue(pairingStore.isRevoked())
        assertTrue(repo.data.value.revoked)
        assertNull(repo.periodsData.value.periods)
    }

    @Test
    fun pairToAnotherOriginLeavesNoPeriods() = runBlocking {
        // Pair, cache periods, then pair to another origin: no periods after load().
        assertEquals(Repository.PairOutcome.Ok, repo.pair(origin, "ABCDE12345", "Android phone", "1.1.0"))
        repo.periods(force = true)
        assertTrue(periodsCache.exists())
        assertEquals(Repository.PairOutcome.Ok, repo.pair("http://umbrel:4932", "ABCDE12345", "Android phone", "1.1.0"))
        assertNull(repo.periodsData.value.periods)
        val fresh = Repository(pairingStore, cache, prefs, api, {}, { now }, periodsCache)
        fresh.load()
        assertNull(fresh.periodsData.value.periods)
        // Even a stale file written for the old pairing is ignored and deleted on load().
        periodsCache.write(PeriodFixtures.open, now, origin, pairing.deviceId)
        val other = Repository(pairingStore, cache, prefs, api, {}, { now }, periodsCache)
        other.load()
        assertNull(other.periodsData.value.periods)
        assertFalse(periodsCache.exists())
    }

    @Test
    fun serverTooOldDropsTheCachedAnswer() = runBlocking {
        pairingStore.save(pairing)
        repo.periods(force = true)
        api.periodsResult = ApiResult.Err(ApiError.ServerTooOld)
        assertEquals(RefreshOutcome.FAILED, repo.periods(force = true))
        assertNull(repo.periodsData.value.periods)
        assertEquals(ApiError.ServerTooOld, repo.periodsData.value.error)
        assertFalse(periodsCache.exists())
        // Its error never reaches Today's.
        assertNull(repo.data.value.error)
    }

    @Test
    fun anotherErrorKeepsTheCachedAnswer() = runBlocking {
        pairingStore.save(pairing)
        repo.periods(force = true)
        api.periodsResult = ApiResult.Err(ApiError.Unreachable)
        assertEquals(RefreshOutcome.FAILED, repo.periods(force = true))
        assertEquals(PeriodFixtures.open, repo.periodsData.value.periods)
        assertEquals(ApiError.Unreachable, repo.periodsData.value.error)
        assertTrue(periodsCache.exists())
        api.periodsResult = ApiResult.Ok(PeriodFixtures.noHistory)
        repo.periods(force = true)
        assertNull(repo.periodsData.value.error)
        assertEquals(PeriodFixtures.noHistory, repo.periodsData.value.periods)
    }

    @Test
    fun overlappingCallsMakeOneRequest() = runBlocking {
        pairingStore.save(pairing)
        repo.load()
        val gate = CompletableDeferred<Unit>()
        api.periodsGate = gate
        val a = async { repo.periods(force = true) }
        withTimeout(5_000) { while (api.periodsCalls == 0) yield() }
        assertTrue(repo.periodsData.value.loading)
        val b = async { repo.periods(force = true) }
        yield()
        gate.complete(Unit)
        assertEquals(RefreshOutcome.OK, a.await())
        assertEquals(RefreshOutcome.OK, b.await())
        assertEquals(1, api.periodsCalls)
        assertNotNull(repo.periodsData.value.periods)
    }

    /**
     * Starts a forced periods fetch whose cache write is held inside [gated], runs [other] (an unpair or a re-pairing)
     * while it is held, then lets the write finish. [other] must wait for the commit: it clears what the old pairing's
     * answer wrote, never the other way round.
     */
    private fun raceTheCommit(gated: GatedBox, gatedRepo: Repository, other: suspend () -> Unit) = runBlocking {
        gated.armed = true
        val fetch = async(kotlinx.coroutines.Dispatchers.Default) { gatedRepo.periods(force = true) }
        assertTrue("the write was reached", gated.entered.await(5, TimeUnit.SECONDS))
        val clearing = async(kotlinx.coroutines.Dispatchers.Default) { other() }
        // The commit holds the Today lock, so the clear cannot finish while the write is held.
        assertNull(withTimeoutOrNull(300) { clearing.await() })
        gated.armed = false
        gated.release.countDown()
        fetch.await()
        clearing.await()
    }

    @Test
    fun anUnpairDuringTheWriteLeavesNoPeriods() {
        val gated = GatedBox()
        val gatedCache = PeriodsCache(File(dir, "gated.cache"), gated)
        val gatedRepo = Repository(pairingStore, cache, prefs, api, {}, { now }, gatedCache)
        runBlocking { pairingStore.save(pairing) }
        raceTheCommit(gated, gatedRepo) { gatedRepo.unpair() }
        assertFalse(gatedCache.exists())
        assertNull(gatedRepo.periodsData.value.periods)
        assertNull(gatedRepo.periodsData.value.fetchedAtMs)
    }

    @Test
    fun aRePairingDuringTheWriteLeavesNoOldPeriods() {
        val gated = GatedBox()
        val gatedCache = PeriodsCache(File(dir, "gated.cache"), gated)
        val gatedRepo = Repository(pairingStore, cache, prefs, api, {}, { now }, gatedCache)
        runBlocking { assertEquals(Repository.PairOutcome.Ok, gatedRepo.pair(origin, "ABCDE12345", "Android phone", "1.1.0")) }
        raceTheCommit(gated, gatedRepo) {
            assertEquals(Repository.PairOutcome.Ok, gatedRepo.pair("http://umbrel:4932", "ABCDE12345", "Android phone", "1.1.0"))
        }
        assertEquals("http://umbrel:4932", gatedRepo.data.value.pairing?.origin)
        assertFalse(gatedCache.exists())
        assertNull(gatedRepo.periodsData.value.periods)
    }
}
