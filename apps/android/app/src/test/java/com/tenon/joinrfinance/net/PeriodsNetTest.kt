package com.tenon.joinrfinance.net

import com.tenon.joinrfinance.Fixtures
import com.tenon.joinrfinance.PeriodFixtures
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.math.BigDecimal

/** `/api/mobile/periods` on the wire (Stage 10 plan sections 4.2 and 9.3). */
class PeriodsNetTest {
    private lateinit var server: MockWebServer
    private val client = ApiClient("1.1.0")
    private val origin get() = server.url("/").toString().trimEnd('/')
    private val json = "application/json; charset=utf-8"

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun stop() {
        server.shutdown()
    }

    private fun answer(code: Int, body: String, type: String = json) = MockResponse().setResponseCode(code).setHeader("Content-Type", type).setBody(body)

    @Test
    fun everyPeriodsFixtureParsesThroughTheClient() = runBlocking {
        for (name in PeriodFixtures.FILES) {
            server.enqueue(answer(200, Fixtures.text(name)))
            val res = client.periods(origin, Fixtures.FAKE_KEY)
            val p = (res as ApiResult.Ok).value
            assertEquals(name, 1, p.apiVersion)
            assertEquals(name, listOf("1W", "2W", "1M", "3M", "6M", "12M", "ALL"), p.periods.map { it.period })
            for (d in p.periods) {
                // One figure per held holding in /today's order, then the Sold figure under ALL only.
                val held = d.figures.filter { !it.isSold }
                assertEquals("$name ${d.period}", p.holdings.map { it.key }, held.map { it.key })
                if (d.period != "ALL") assertTrue(d.figures.none { it.isSold })
                d.line?.points?.forEach { (date, cents) -> assertEquals(10, date.length); assertTrue(cents is Long) }
                d.figures.forEach { f -> f.line?.points?.forEach { (_, price) -> BigDecimal(price) } }
            }
            val req = server.takeRequest()
            assertEquals("GET", req.method)
            assertEquals("/api/mobile/periods", req.path)
            assertEquals("Bearer ${Fixtures.FAKE_KEY}", req.getHeader("Authorization"))
            assertEquals(Fixtures.FAKE_KEY, req.getHeader("X-Joinr-Key"))
            assertEquals("1.1.0", req.getHeader("X-Joinr-App-Version"))
        }
    }

    @Test
    fun theOpenAnswerMirrorsTodayOpen() {
        val p = PeriodFixtures.open
        val t = Fixtures.open
        assertEquals(t.holdings.map { it.key }, p.holdings.map { it.key })
        assertEquals(t.totals.valueCents, p.valueCents)
        assertEquals("2030-09-10", p.closesThrough)
        val sold = p.periods.last().figures.last()
        assertEquals("sold", sold.key)
        assertEquals(2, sold.soldCount)
        assertNull(p.periods.first().totals.unrealisedCents)
    }

    @Test
    fun a404OnPeriodsIsServerTooOld() = runBlocking {
        server.enqueue(answer(404, """{"error":{"code":"NOT_FOUND","message":"Not found"}}"""))
        assertEquals(ApiResult.Err(ApiError.ServerTooOld), client.periods(origin, Fixtures.FAKE_KEY))
        server.enqueue(answer(404, "<html>not found</html>", "text/html"))
        assertEquals(ApiResult.Err(ApiError.ServerTooOld), client.periods(origin, Fixtures.FAKE_KEY))
    }

    @Test
    fun theErrorMappingForPeriods() {
        val path = ApiClient.PATH_PERIODS
        assertEquals("/api/mobile/periods", path)
        assertNull(ErrorMapping.map(path, 200, json, """{"apiVersion":1}"""))
        assertEquals(ApiError.ServerTooOld, ErrorMapping.map(path, 404, json, """{"error":{"code":"NOT_FOUND","message":"x"}}"""))
        assertEquals(ApiError.ServerTooOld, ErrorMapping.map(path, 404, "text/html", "<html>"))
        assertEquals(ApiError.AppTooOld, ErrorMapping.map(path, 200, json, """{"apiVersion":2}"""))
        assertEquals(ApiError.Revoked, ErrorMapping.map(path, 401, json, """{"error":{"code":"DEVICE_KEY_REVOKED","message":"x"}}"""))
        assertEquals(ApiError.ProxyLogin, ErrorMapping.map(path, 302, "text/html", ""))
        assertEquals(ApiError.ServerError, ErrorMapping.map(path, 500, json, """{"error":{"code":"INTERNAL","message":"x"}}"""))
        // The Stage 9 paths are unchanged: an HTML 404 on /device is still a server error.
        assertEquals(ApiError.ServerError, ErrorMapping.map(ApiClient.PATH_DEVICE, 404, "text/html", "<html>"))
    }

    @Test
    fun revokedAndUnreachable() = runBlocking {
        server.enqueue(answer(401, """{"error":{"code":"DEVICE_KEY_REVOKED","message":"x"}}"""))
        assertEquals(ApiResult.Err(ApiError.Revoked), client.periods(origin, Fixtures.FAKE_KEY))
        val dead = origin
        server.shutdown()
        assertEquals(ApiResult.Err(ApiError.Unreachable), client.periods(dead, Fixtures.FAKE_KEY))
        server = MockWebServer().also { it.start() }
    }

    @Test
    fun aMalformedPointIsAServerError() = runBlocking {
        val bad = Fixtures.text("periods-open.json").replaceFirst("[\"2030-09-05\", 15500]", "[\"2030-09-05\", \"15500\"]")
        server.enqueue(answer(200, bad))
        val res = client.periods(origin, Fixtures.FAKE_KEY)
        assertTrue(res is ApiResult.Err)
    }

    @Test
    fun pointsRoundTrip() {
        val p = PeriodFixtures.open
        val again = ApiJson.decodeFromString(MobilePeriodsResponse.serializer(), ApiJson.encodeToString(MobilePeriodsResponse.serializer(), p))
        assertEquals(p, again)
    }
}
