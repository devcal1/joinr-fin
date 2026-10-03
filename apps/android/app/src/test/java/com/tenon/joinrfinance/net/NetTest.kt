package com.tenon.joinrfinance.net

import com.tenon.joinrfinance.Fixtures
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.math.BigDecimal

class ErrorMappingTest {
    private val json = "application/json; charset=utf-8"
    private fun err(code: String) = """{"error":{"code":"$code","message":"x"}}"""

    @Test
    fun theMappingOfPlanSection93() {
        val today = ApiClient.PATH_TODAY
        assertNull(ErrorMapping.map(today, 200, json, """{"apiVersion":1}"""))
        assertEquals(ApiError.ProxyLogin, ErrorMapping.map(today, 302, "text/html", ""))
        assertEquals(ApiError.ProxyLogin, ErrorMapping.map(today, 307, null, null))
        assertEquals(ApiError.ProxyLogin, ErrorMapping.map(today, 200, "text/html", "<html>login</html>"))
        assertEquals(ApiError.ProxyLogin, ErrorMapping.map(today, 200, json, "<html>"))
        assertEquals(ApiError.ProxyLogin, ErrorMapping.map(today, 401, "text/html", "<html>"))
        assertEquals(ApiError.ServerTooOld, ErrorMapping.map(today, 404, json, err("NOT_FOUND")))
        assertEquals(ApiError.ServerTooOld, ErrorMapping.map(today, 404, "text/html", "<html>"))
        assertEquals(ApiError.AppTooOld, ErrorMapping.map(today, 200, json, """{"apiVersion":2}"""))
        assertEquals(ApiError.Revoked, ErrorMapping.map(today, 401, json, err("DEVICE_KEY_REVOKED")))
        assertEquals(ApiError.KeyUnknown, ErrorMapping.map(today, 401, json, err("DEVICE_KEY_INVALID")))
        assertEquals(ApiError.KeyUnknown, ErrorMapping.map(today, 401, json, err("DEVICE_KEY_MISSING")))
        assertEquals(ApiError.RateLimited, ErrorMapping.map(today, 429, json, err("MOBILE_RATE_LIMITED")))
        assertEquals(ApiError.ServerError, ErrorMapping.map(today, 500, json, err("INTERNAL")))
        assertEquals(ApiError.ServerError, ErrorMapping.map(today, 502, "text/html", "bad gateway"))
        val pair = ApiClient.PATH_PAIR
        assertEquals(ApiError.Pairing("PAIRING_CODE_INVALID"), ErrorMapping.map(pair, 401, json, err("PAIRING_CODE_INVALID")))
        assertEquals(ApiError.Pairing("PAIRING_RATE_LIMITED"), ErrorMapping.map(pair, 429, json, err("PAIRING_RATE_LIMITED")))
        assertEquals(ApiError.Pairing("PHONE_LIMIT_REACHED"), ErrorMapping.map(pair, 409, json, err("PHONE_LIMIT_REACHED")))
        assertEquals(ApiError.Pairing("PHONE_STORE_FAILED"), ErrorMapping.map(pair, 503, json, err("PHONE_STORE_FAILED")))
    }

    /** The app's copies of the section 4.5 sentences equal the server's (the exported error fixtures). */
    @Test
    fun sentencesMatchTheServer() {
        val errors = Json.parseToJsonElement(Fixtures.text("api-errors.json")).jsonObject
        assertEquals(9, errors.size)
        for ((_, body) in errors) {
            val e = body.jsonObject["error"]!!.jsonObject
            val code = e["code"]!!.jsonPrimitive.content
            assertEquals(code, e["message"]!!.jsonPrimitive.content, Sentences.SERVER_MESSAGES[code])
        }
        assertEquals("Can't reach the Umbrel — is Tailscale on?", ApiError.Unreachable.sentence)
        assertEquals(Sentences.SERVER_MESSAGES["PAIRING_CODE_INVALID"], ApiError.Pairing("PAIRING_CODE_INVALID").sentence)
    }
}

class DtoParsingTest {
    @Test
    fun everyTodayFixtureParses() {
        for (name in Fixtures.TODAY_FILES) {
            val t = ApiJson.decodeFromString(MobileTodayResponse.serializer(), Fixtures.text(name))
            assertEquals(name, 1, t.apiVersion)
            assertEquals(name, t.totals.holdings, t.holdings.size)
            // Totals are exact sums of the holdings (plan section 2.3).
            assertEquals(name, t.holdings.sumOf { it.valueCents ?: 0L }, t.totals.valueCents)
            val ok = t.holdings.filter { it.isOk }
            assertEquals(name, if (ok.isEmpty()) null else ok.sumOf { it.dayCents!! }, t.totals.dayCents)
            t.portfolioLine?.let { line -> assertEquals(name, t.totals.dayCents, line.points.last().second) }
            // Decimals become BigDecimal, never Double.
            t.holdings.forEach { h ->
                h.price?.let { BigDecimal(it) }
                h.line?.points?.forEach { (_, p) -> BigDecimal(p) }
            }
        }
    }

    @Test
    fun theOpenFixtureCarriesEveryShape() {
        val t = Fixtures.open
        val silver = t.holdings.first { it.key == "bullion-silver" }
        assertTrue(silver.isBullion)
        assertNull(silver.instrumentId)
        assertEquals(2, silver.items)
        assertEquals("USD", silver.native!!.currency)
        val exus = t.holdings.first { it.code == "EXUS" }
        assertEquals("America/New_York", exus.session!!.timeZone)
        val fund = t.holdings.first { it.code == "0PEXAMPLE1" }
        assertTrue(fund.session!!.daily)
        assertNull(fund.line)
        assertEquals(listOf(1915365600L, -4033L), t.portfolioLine!!.points.first().toList())
    }

    @Test
    fun deviceAndPairFixturesParse() {
        val d = ApiJson.decodeFromString(MobileDeviceResponse.serializer(), Fixtures.text("device-ok.json"))
        assertEquals("d_0000000000000001", d.deviceId)
        val p = ApiJson.decodeFromString(MobilePairResponse.serializer(), Fixtures.text("pair-ok.json"))
        assertEquals(Fixtures.FAKE_KEY, p.key)
        assertFalse("the key never reaches toString", p.toString().contains("jfk_"))
        val reqs = Json.parseToJsonElement(Fixtures.text("pair-requests.json")).jsonObject
        for ((_, r) in reqs) {
            val body = ApiJson.decodeFromJsonElement(MobilePairRequest.serializer(), r.jsonObject["body"]!!)
            val want = r.jsonObject["normalisedCode"]!!.let { if (it is kotlinx.serialization.json.JsonNull) null else it.jsonPrimitive.content }
            assertEquals(want, com.tenon.joinrfinance.model.PairingUrl.normalisePairingCode(body.code))
        }
    }

    @Test
    fun unknownKeysAreIgnoredAndPointsRoundTrip() {
        val text = Fixtures.text("today-open.json").replaceFirst("{", """{"futureField":{"a":1},""")
        val t = ApiJson.decodeFromString(MobileTodayResponse.serializer(), text)
        val again = ApiJson.decodeFromString(MobileTodayResponse.serializer(), ApiJson.encodeToString(MobileTodayResponse.serializer(), t))
        assertEquals(t, again)
    }
}

class ApiClientTest {
    private lateinit var server: MockWebServer
    private val client = ApiClient("1.0.0")
    private val origin get() = server.url("/").toString().trimEnd('/')

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun stop() {
        server.shutdown()
    }

    private fun json(code: Int, body: String) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json; charset=utf-8").setBody(body)

    @Test
    fun todaySendsBothKeyHeadersAndParses() = runBlocking {
        server.enqueue(json(200, Fixtures.text("today-open.json")))
        val res = client.today(origin, Fixtures.FAKE_KEY)
        assertTrue(res is ApiResult.Ok)
        val req = server.takeRequest()
        assertEquals("GET", req.method)
        assertEquals("/api/mobile/today", req.path)
        assertEquals("Bearer ${Fixtures.FAKE_KEY}", req.getHeader("Authorization"))
        assertEquals(Fixtures.FAKE_KEY, req.getHeader("X-Joinr-Key"))
        assertEquals("1.0.0", req.getHeader("X-Joinr-App-Version"))
        assertEquals("application/json", req.getHeader("Accept"))
        assertEquals("JoinrFinance-Android/1.0.0", req.getHeader("User-Agent"))
    }

    @Test
    fun redirectsAreNeverFollowed() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/login"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("<html>login</html>"))
        assertEquals(ApiResult.Err(ApiError.ProxyLogin), client.today(origin, Fixtures.FAKE_KEY))
        assertEquals(1, server.requestCount)
    }

    @Test
    fun eachErrorCode() = runBlocking {
        val errors = Json.parseToJsonElement(Fixtures.text("api-errors.json")).jsonObject
        fun body(name: String) = errors[name].toString()
        server.enqueue(json(401, body("deviceKeyRevoked")))
        assertEquals(ApiResult.Err(ApiError.Revoked), client.today(origin, Fixtures.FAKE_KEY))
        server.enqueue(json(401, body("deviceKeyInvalid")))
        assertEquals(ApiResult.Err(ApiError.KeyUnknown), client.today(origin, Fixtures.FAKE_KEY))
        server.enqueue(json(401, body("deviceKeyMissing")))
        assertEquals(ApiResult.Err(ApiError.KeyUnknown), client.device(origin, Fixtures.FAKE_KEY))
        server.enqueue(json(429, body("mobileRateLimited")))
        assertEquals(ApiResult.Err(ApiError.RateLimited), client.today(origin, Fixtures.FAKE_KEY))
        server.enqueue(json(404, """{"error":{"code":"NOT_FOUND","message":"Not found"}}"""))
        assertEquals(ApiResult.Err(ApiError.ServerTooOld), client.today(origin, Fixtures.FAKE_KEY))
        server.enqueue(json(500, """{"error":{"code":"INTERNAL","message":"x"}}"""))
        assertEquals(ApiResult.Err(ApiError.ServerError), client.today(origin, Fixtures.FAKE_KEY))
        server.enqueue(json(200, """{"apiVersion":2,"serverVersion":"9.0.0"}"""))
        assertEquals(ApiResult.Err(ApiError.AppTooOld), client.today(origin, Fixtures.FAKE_KEY))
        server.enqueue(json(401, body("pairingCodeInvalid")))
        assertEquals(ApiResult.Err(ApiError.Pairing("PAIRING_CODE_INVALID")), client.pair(origin, MobilePairRequest("ABCDE12345")))
        server.enqueue(json(409, body("phoneLimitReached")))
        assertEquals(ApiResult.Err(ApiError.Pairing("PHONE_LIMIT_REACHED")), client.pair(origin, MobilePairRequest("ABCDE12345")))
        server.enqueue(json(429, body("pairingRateLimited")))
        assertEquals(ApiResult.Err(ApiError.Pairing("PAIRING_RATE_LIMITED")), client.pair(origin, MobilePairRequest("ABCDE12345")))
        server.enqueue(json(503, body("phoneStoreFailed")))
        assertEquals(ApiResult.Err(ApiError.Pairing("PHONE_STORE_FAILED")), client.pair(origin, MobilePairRequest("ABCDE12345")))
    }

    @Test
    fun pairPostsJsonWithoutAKey() = runBlocking {
        server.enqueue(json(201, Fixtures.text("pair-ok.json")))
        val res = client.pair(origin, MobilePairRequest("ABCDE12345", "Android phone", "1.0.0"))
        assertEquals(Fixtures.FAKE_KEY, (res as ApiResult.Ok).value.key)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/mobile/pair", req.path)
        assertNull(req.getHeader("Authorization"))
        assertNull(req.getHeader("X-Joinr-Key"))
        assertNull("no Origin header from the phone", req.getHeader("Origin"))
        val sent = Json.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals("ABCDE12345", sent["code"]!!.jsonPrimitive.content)
    }

    @Test
    fun unreachableServer() = runBlocking {
        val dead = origin
        server.shutdown()
        assertEquals(ApiResult.Err(ApiError.Unreachable), client.today(dead, Fixtures.FAKE_KEY))
        server = MockWebServer().also { it.start() }
    }
}
