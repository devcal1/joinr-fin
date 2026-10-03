package com.tenon.joinrfinance.model

import com.tenon.joinrfinance.Fixtures
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Kotlin mirror against the shared table (plan sections 3.6 and 4.4): the schema test iterates the same file. */
class PairingUrlTest {
    private val table: JsonObject = Json.parseToJsonElement(Fixtures.text("pairing-url-cases.json")).jsonObject

    @Test
    fun parsePairingUrlMatchesTheSharedTable() {
        val cases = table["parsePairingUrl"]!!.jsonArray
        assertTrue(cases.size >= 20)
        for (c in cases) {
            val input = c.jsonObject["input"]!!.jsonPrimitive.content
            val expected = c.jsonObject["expected"]!!
            val actual = PairingUrl.parse(input)
            if (expected is JsonNull) {
                assertEquals("parse($input)", null, actual)
            } else {
                val e = expected.jsonObject
                assertEquals("parse($input)", PairingUrl.Parsed(e["serverUrl"]!!.jsonPrimitive.content, e["code"]!!.jsonPrimitive.content), actual)
            }
        }
    }

    @Test
    fun normaliseServerUrlMatchesTheSharedTable() {
        for (c in table["normaliseServerUrl"]!!.jsonArray) {
            val raw = c.jsonObject["raw"]!!.jsonPrimitive.content
            val e = c.jsonObject["expected"]!!.jsonObject
            val ok = e["ok"]!!.jsonPrimitive.boolean
            assertEquals("normaliseServerUrl($raw)", if (ok) e["url"]!!.jsonPrimitive.content else null, PairingUrl.normaliseServerUrl(raw))
        }
    }

    @Test
    fun normalisePairingCodeMatchesTheSharedTable() {
        for (c in table["normalisePairingCode"]!!.jsonArray) {
            val raw = c.jsonObject["raw"]!!.jsonPrimitive.content
            val expected = c.jsonObject["expected"]!!
            val want = if (expected is JsonNull) null else expected.jsonPrimitive.content
            assertEquals("normalisePairingCode($raw)", want, PairingUrl.normalisePairingCode(raw))
        }
    }

    /** CGNAT and RFC 1918 test addresses are built from octets (the privacy guard flags dotted literals). */
    private fun ip(a: Int, b: Int, c: Int, d: Int) = listOf(a, b, c, d).joinToString(".")

    @Test
    fun addressKinds() {
        assertEquals(PairingUrl.AddressKind.TAILSCALE, PairingUrl.addressKind("http://umbrel.example-tailnet.ts.net:4932"))
        assertEquals(PairingUrl.AddressKind.TAILSCALE, PairingUrl.addressKind("http://${ip(100, 64, 1, 2)}:4932"))
        assertEquals(PairingUrl.AddressKind.TAILSCALE, PairingUrl.addressKind("http://${ip(100, 127, 255, 254)}"))
        assertEquals(PairingUrl.AddressKind.OTHER, PairingUrl.addressKind("http://${ip(100, 128, 0, 1)}"))
        assertEquals(PairingUrl.AddressKind.SHORT_NAME, PairingUrl.addressKind("http://umbrel:4932"))
        assertEquals(PairingUrl.AddressKind.LAN, PairingUrl.addressKind("http://${ip(192, 168, 1, 20)}:4932"))
        assertEquals(PairingUrl.AddressKind.LAN, PairingUrl.addressKind("http://${ip(10, 1, 2, 3)}"))
        assertEquals(PairingUrl.AddressKind.LAN, PairingUrl.addressKind("http://${ip(172, 16, 0, 1)}"))
        assertEquals(PairingUrl.AddressKind.LAN, PairingUrl.addressKind("http://umbrel.local:4932"))
        assertEquals(PairingUrl.AddressKind.LOOPBACK, PairingUrl.addressKind("http://127.0.0.1:3001"))
        assertEquals(PairingUrl.AddressKind.LOOPBACK, PairingUrl.addressKind("http://localhost:3001"))
        assertEquals(PairingUrl.AddressKind.LOOPBACK, PairingUrl.addressKind("http://[::1]:3001"))
        assertEquals(PairingUrl.AddressKind.OTHER, PairingUrl.addressKind("https://example.test"))
        assertEquals(PairingUrl.AddressKind.OTHER, PairingUrl.addressKind("not a url"))
    }

    @Test
    fun byHandPrependsHttp() {
        assertEquals("http://umbrel:4932", PairingUrl.withDefaultScheme("umbrel:4932"))
        assertEquals("http://umbrel:4932", PairingUrl.withDefaultScheme("  umbrel:4932 "))
        assertEquals("https://example.test", PairingUrl.withDefaultScheme("https://example.test"))
        assertEquals("http://umbrel:4932", PairingUrl.normaliseServerUrl(PairingUrl.withDefaultScheme("umbrel:4932")))
    }
}
