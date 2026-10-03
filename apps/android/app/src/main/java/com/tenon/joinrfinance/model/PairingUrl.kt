package com.tenon.joinrfinance.model

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.Locale

/**
 * The Kotlin mirror of the pairing-URL rules (plan section 4.4; `packages/schema/src/mobile.ts`).
 * Tested against the shared table `pairing-url-cases.json`. Every function NEVER THROWS.
 */
object PairingUrl {
    const val SCHEME = "joinrfinance"
    const val MAX_LENGTH = 512
    const val CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    const val CODE_LENGTH = 10
    private const val SERVER_URL_MAX_LENGTH = 300

    data class Parsed(val serverUrl: String, val code: String)

    private val URL_RE = Regex("^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]*)\\?([^#]*)$")
    private const val LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    private val SERVER_RE = Regex(
        "^(https?)://(\\[[0-9A-Fa-f:.]+\\]|$LABEL(?:\\.$LABEL)*)(?::(\\d{1,5}))?/?$",
        RegexOption.IGNORE_CASE,
    )
    // JavaScript's \s (Unicode spaces) and the hyphen.
    private val CODE_DROP = Regex("[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF-]")
    private val IPV4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")

    /** `joinrfinance://pair?v=1&u=<encoded origin>&c=<code>` → the origin and code, or null. */
    fun parse(text: String?): Parsed? = try {
        parseInner(text)
    } catch (_: Exception) {
        null
    }

    private fun parseInner(text: String?): Parsed? {
        if (text == null || text.length > MAX_LENGTH) return null
        val m = URL_RE.matchEntire(jsTrim(text)) ?: return null
        val scheme = m.groupValues[1]
        val host = m.groupValues[2]
        val query = m.groupValues[3]
        if (scheme.lowercase(Locale.ROOT) != SCHEME || host != "pair") return null
        val params = HashMap<String, String>()
        for (part in query.split('&')) {
            if (part.isEmpty()) continue
            val eq = part.indexOf('=')
            val name = decodeComponent(if (eq < 0) part else part.substring(0, eq)) ?: return null
            val value = decodeComponent(if (eq < 0) "" else part.substring(eq + 1)) ?: return null
            if (name != "v" && name != "u" && name != "c") continue
            if (params.containsKey(name)) return null
            params[name] = value
        }
        if (params["v"] != "1") return null
        val server = normaliseServerUrl(params["u"] ?: "") ?: return null
        val code = normalisePairingCode(params["c"] ?: "") ?: return null
        return Parsed(server, code)
    }

    /** `http(s)://host[:port]` only, lower-cased, a trailing `/` dropped; null for anything else. */
    fun normaliseServerUrl(raw: String?): String? = try {
        if (raw == null) {
            null
        } else {
            val text = jsTrim(raw)
            if (text.isEmpty() || text.length > SERVER_URL_MAX_LENGTH) {
                null
            } else {
                val m = SERVER_RE.matchEntire(text)
                if (m == null) {
                    null
                } else {
                    val scheme = m.groupValues[1].lowercase(Locale.ROOT)
                    val host = m.groupValues[2].lowercase(Locale.ROOT)
                    val portText = m.groups[3]?.value
                    if (portText == null) {
                        "$scheme://$host"
                    } else {
                        val port = portText.toInt()
                        if (port < 1 || port > 65_535) null else "$scheme://$host:$port"
                    }
                }
            }
        }
    } catch (_: Exception) {
        null
    }

    /** Upper-case, drop `-` and spaces, O→0, I/L→1; then the alphabet and length, or null. */
    fun normalisePairingCode(raw: String?): String? = try {
        if (raw == null) {
            null
        } else {
            val code = raw.uppercase(Locale.ROOT).replace(CODE_DROP, "")
                .replace('O', '0').replace('I', '1').replace('L', '1')
            if (code.length == CODE_LENGTH && code.all { CODE_ALPHABET.indexOf(it) >= 0 }) code else null
        }
    } catch (_: Exception) {
        null
    }

    enum class AddressKind { TAILSCALE, SHORT_NAME, LAN, LOOPBACK, OTHER }

    /** As `serverAddressKind` (plan section 3.4): only [AddressKind.TAILSCALE] keeps the key inside Tailscale. */
    fun addressKind(url: String?): AddressKind = try {
        val n = normaliseServerUrl(url)
        if (n == null) {
            AddressKind.OTHER
        } else {
            val host = Regex("^https?://(\\[[^\\]]*\\]|[^:/]+)").find(n)?.groupValues?.get(1).orEmpty()
            val ip = IPV4.matchEntire(host)?.groupValues?.drop(1)?.map { it.toInt() }?.takeIf { o -> o.all { it <= 255 } }
            when {
                ip != null -> {
                    val a = ip[0]
                    val b = ip[1]
                    when {
                        a == 100 && b in 64..127 -> AddressKind.TAILSCALE
                        a == 127 -> AddressKind.LOOPBACK
                        a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168) -> AddressKind.LAN
                        else -> AddressKind.OTHER
                    }
                }
                host == "[::1]" -> AddressKind.LOOPBACK
                host.startsWith("[") -> AddressKind.OTHER
                host == "localhost" || host.endsWith(".localhost") -> AddressKind.LOOPBACK
                host.endsWith(".ts.net") -> AddressKind.TAILSCALE
                !host.contains('.') -> AddressKind.SHORT_NAME
                host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa") -> AddressKind.LAN
                else -> AddressKind.OTHER
            }
        }
    } catch (_: Exception) {
        AddressKind.OTHER
    }

    /** The by-hand address field: `http://` is prepended when the typed value has no scheme (plan section 9.5). */
    fun withDefaultScheme(typed: String): String {
        val t = typed.trim()
        return if (Regex("^[A-Za-z][A-Za-z0-9+.-]*://").containsMatchIn(t)) t else "http://$t"
    }

    /** The host (and port) shown in the confirmation ("Pair with http://umbrel:4932?"). */
    fun display(origin: String): String = origin

    /** JavaScript's String.prototype.trim (Unicode white space and line terminators). */
    private fun jsTrim(s: String): String = s.trim { it.isWhitespace() || it == '\uFEFF' || it == '\u00A0' }

    /** JavaScript's decodeURIComponent: `%XX` UTF-8 sequences, `+` kept; null where JS throws. */
    private fun decodeComponent(text: String): String? {
        if (!text.contains('%')) return text
        val out = StringBuilder()
        var i = 0
        while (i < text.length) {
            val ch = text[i]
            if (ch != '%') {
                out.append(ch)
                i++
                continue
            }
            val bytes = ArrayList<Byte>()
            while (i < text.length && text[i] == '%') {
                if (i + 3 > text.length) return null
                val hi = hexValue(text[i + 1])
                val lo = hexValue(text[i + 2])
                if (hi < 0 || lo < 0) return null
                bytes.add(((hi shl 4) or lo).toByte())
                i += 3
            }
            val decoder = Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            try {
                out.append(decoder.decode(ByteBuffer.wrap(bytes.toByteArray())))
            } catch (_: CharacterCodingException) {
                return null
            }
        }
        return out.toString()
    }
}

private fun hexValue(c: Char): Int = when (c) {
    in '0'..'9' -> c - '0'
    in 'a'..'f' -> c - 'a' + 10
    in 'A'..'F' -> c - 'A' + 10
    else -> -1
}
