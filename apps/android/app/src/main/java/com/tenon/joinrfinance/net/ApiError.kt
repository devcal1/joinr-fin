package com.tenon.joinrfinance.net

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/** Why a call to the phone API failed (plan section 9.3). Every value carries a fixed sentence, never a value. */
sealed class ApiError {
    /** No connection, a timeout or an unknown host. */
    data object Unreachable : ApiError()

    /** A redirect, or a 200 that is not JSON: the Umbrel's login answered instead of the app. */
    data object ProxyLogin : ApiError()

    /** 404 on `/today`: the server predates the phone API. */
    data object ServerTooOld : ApiError()

    /** The server speaks a newer `apiVersion` than this app. */
    data object AppTooOld : ApiError()

    /** 401 `DEVICE_KEY_REVOKED`: the phone was removed in Settings → Phone. */
    data object Revoked : ApiError()

    /** 401 `DEVICE_KEY_INVALID` or `DEVICE_KEY_MISSING`. */
    data object KeyUnknown : ApiError()

    /** 429 on a keyed call. */
    data object RateLimited : ApiError()

    /** 5xx, or any answer this app does not expect. */
    data object ServerError : ApiError()

    /** A pairing answer with one of the section 4.5 codes. */
    data class Pairing(val code: String) : ApiError()

    val sentence: String
        get() = when (this) {
            Unreachable -> Sentences.UNREACHABLE
            ProxyLogin -> Sentences.PROXY_LOGIN
            ServerTooOld -> Sentences.SERVER_TOO_OLD
            AppTooOld -> Sentences.APP_TOO_OLD
            Revoked -> Sentences.messageFor(CODE_REVOKED)
            KeyUnknown -> Sentences.messageFor(CODE_INVALID)
            RateLimited -> Sentences.messageFor(CODE_RATE_LIMITED)
            ServerError -> Sentences.SERVER_ERROR
            is Pairing -> Sentences.messageFor(code)
        }

    companion object {
        const val CODE_MISSING = "DEVICE_KEY_MISSING"
        const val CODE_INVALID = "DEVICE_KEY_INVALID"
        const val CODE_REVOKED = "DEVICE_KEY_REVOKED"
        const val CODE_RATE_LIMITED = "MOBILE_RATE_LIMITED"
        const val CODE_PAIRING_INVALID = "PAIRING_CODE_INVALID"
        const val CODE_PAIRING_RATE = "PAIRING_RATE_LIMITED"
        const val CODE_PHONE_LIMIT = "PHONE_LIMIT_REACHED"
        const val CODE_STORE_FAILED = "PHONE_STORE_FAILED"
    }
}

/** The fixed sentences (plan section 4.5 for the server's codes, section 9.8 for the app's own states). */
object Sentences {
    val SERVER_MESSAGES: Map<String, String> = mapOf(
        "DEVICE_KEY_MISSING" to "This request needs the phone's key. Pair the phone in Settings → Phone.",
        "DEVICE_KEY_INVALID" to "This server does not know this phone's key. Pair the phone again in Settings → Phone.",
        "DEVICE_KEY_REVOKED" to "This phone was removed in Settings → Phone. Pair it again to use it.",
        "MOBILE_RATE_LIMITED" to "Too many requests with an unknown key. Try again in 10 minutes.",
        "MOBILE_READ_ONLY" to "The phone app can only read. Nothing was changed.",
        "PAIRING_CODE_INVALID" to "The pairing code is wrong or has expired. Show a new code in Settings → Phone.",
        "PAIRING_RATE_LIMITED" to "Too many pairing attempts. Wait 10 minutes, then show a new code.",
        "PHONE_LIMIT_REACHED" to "Ten phones are paired already. Remove one in Settings → Phone first.",
        "PHONE_STORE_FAILED" to "The list of phones could not be saved on the server. Nothing was changed.",
    )

    const val UNREACHABLE = "Can't reach the Umbrel — is Tailscale on?"
    const val PROXY_LOGIN =
        "The Umbrel asked for its login: the phone path is not open. Update Joinr Finance on the Umbrel to 1.2.0 or later."
    const val SERVER_TOO_OLD = "The server is older than this app. Update Joinr Finance on the Umbrel to 1.2.0 or later."
    const val APP_TOO_OLD = "This app is older than the server. Install the latest Joinr Finance app."
    const val SERVER_ERROR = "The Umbrel could not answer just now. Try again in a minute."
    const val REVOKED_SCREEN = "This phone was removed in Settings → Phone."

    fun messageFor(code: String): String = SERVER_MESSAGES[code] ?: SERVER_ERROR
}

/** The pure error mapping of plan section 9.3. Returns null when the answer is a usable success. */
object ErrorMapping {
    /**
     * @param path the API path called (`/api/mobile/today`, `/api/mobile/device`, `/api/mobile/pair`, `/api/mobile/periods`)
     * @param status the HTTP status
     * @param contentType the response's Content-Type, if any
     * @param body the response body, if any
     */
    fun map(path: String, status: Int, contentType: String?, body: String?): ApiError? {
        if (status in 300..399) return ApiError.ProxyLogin
        val json = isJson(contentType, body)
        if (status in 200..299) {
            if (!json) return ApiError.ProxyLogin
            val version = apiVersionOf(body)
            if (version != null && version > MOBILE_API_VERSION) return ApiError.AppTooOld
            return null
        }
        if (status >= 500) {
            val code = if (json) errorCodeOf(body) else null
            return if (code == ApiError.CODE_STORE_FAILED) ApiError.Pairing(code) else ApiError.ServerError
        }
        if (!json) {
            // An HTML 401/403 is the Umbrel's login page, not the app.
            return if (status == 401 || status == 403) ApiError.ProxyLogin else if (status == 404 && tooOldOn404(path)) ApiError.ServerTooOld else ApiError.ServerError
        }
        val code = errorCodeOf(body)
        return when {
            status == 404 && path.endsWith("/today") -> ApiError.ServerTooOld
            status == 404 && path.endsWith("/device") -> ApiError.ServerTooOld
            status == 404 && path.endsWith("/pair") -> ApiError.ServerTooOld
            status == 404 && path.endsWith("/periods") -> ApiError.ServerTooOld
            code == ApiError.CODE_REVOKED -> ApiError.Revoked
            code == ApiError.CODE_INVALID || code == ApiError.CODE_MISSING -> ApiError.KeyUnknown
            code == ApiError.CODE_PAIRING_INVALID || code == ApiError.CODE_PAIRING_RATE ||
                code == ApiError.CODE_PHONE_LIMIT || code == ApiError.CODE_STORE_FAILED -> ApiError.Pairing(code!!)
            status == 429 -> ApiError.RateLimited
            else -> ApiError.ServerError
        }
    }

    /** An HTML 404 means "no such path on this server" for `/today` and (Stage 10) `/periods`. */
    private fun tooOldOn404(path: String): Boolean = path.endsWith("/today") || path.endsWith("/periods")

    fun isJson(contentType: String?, body: String?): Boolean {
        val type = contentType?.lowercase().orEmpty()
        if (!type.contains("json")) return false
        val text = body?.trimStart().orEmpty()
        if (!(text.startsWith("{") || text.startsWith("["))) return false
        return runCatching { ApiJson.parseToJsonElement(text) }.isSuccess
    }

    fun errorCodeOf(body: String?): String? = runCatching {
        ApiJson.decodeFromString(ApiErrorBody.serializer(), body.orEmpty()).error.code
    }.getOrNull()

    fun apiVersionOf(body: String?): Int? = runCatching {
        val obj = ApiJson.parseToJsonElement(body.orEmpty()) as? JsonObject ?: return null
        obj["apiVersion"]?.jsonPrimitive?.intOrNull
    }.getOrNull()
}
