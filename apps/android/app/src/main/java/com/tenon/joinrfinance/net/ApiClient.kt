package com.tenon.joinrfinance.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** A call's outcome: a value, or a mapped [ApiError]. */
sealed class ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>()
    data class Err(val error: ApiError) : ApiResult<Nothing>()
}

/** The phone API calls (Stage 9 plan section 4.1, Stage 10 section 4.1); nothing else is ever called. */
interface MobileApi {
    suspend fun today(origin: String, key: String): ApiResult<MobileTodayResponse>
    suspend fun device(origin: String, key: String): ApiResult<MobileDeviceResponse>
    suspend fun pair(origin: String, request: MobilePairRequest): ApiResult<MobilePairResponse>

    /**
     * `GET /api/mobile/periods` (Stage 10). The default body answers as a server without the path would, so the Stage 9
     * fakes compile unchanged.
     */
    suspend fun periods(origin: String, key: String): ApiResult<MobilePeriodsResponse> = ApiResult.Err(ApiError.ServerTooOld)
}

/**
 * OkHttp client for the phone API (plan section 9.3): connect 10 s, read 20 s, redirects never followed,
 * both key headers sent (section 4.2). The key is never logged: no interceptor prints headers.
 */
class ApiClient(
    private val appVersion: String,
    private val http: OkHttpClient = defaultHttp(),
) : MobileApi {

    override suspend fun today(origin: String, key: String): ApiResult<MobileTodayResponse> =
        get(origin, PATH_TODAY, key, MobileTodayResponse.serializer())

    override suspend fun device(origin: String, key: String): ApiResult<MobileDeviceResponse> =
        get(origin, PATH_DEVICE, key, MobileDeviceResponse.serializer())

    override suspend fun periods(origin: String, key: String): ApiResult<MobilePeriodsResponse> =
        get(origin, PATH_PERIODS, key, MobilePeriodsResponse.serializer())

    override suspend fun pair(origin: String, request: MobilePairRequest): ApiResult<MobilePairResponse> {
        val body = ApiJson.encodeToString(MobilePairRequest.serializer(), request)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val req = baseRequest(origin, PATH_PAIR).post(body).build()
        return execute(req, PATH_PAIR, MobilePairResponse.serializer())
    }

    private suspend fun <T> get(origin: String, path: String, key: String, strategy: DeserializationStrategy<T>): ApiResult<T> {
        val req = baseRequest(origin, path)
            .header("Authorization", "Bearer $key")
            .header("X-Joinr-Key", key)
            .get()
            .build()
        return execute(req, path, strategy)
    }

    private fun baseRequest(origin: String, path: String): Request.Builder = Request.Builder()
        .url(origin.trimEnd('/') + path)
        .header("Accept", "application/json")
        .header("X-Joinr-App-Version", appVersion)
        .header("User-Agent", "JoinrFinance-Android/$appVersion")

    private suspend fun <T> execute(req: Request, path: String, strategy: DeserializationStrategy<T>): ApiResult<T> =
        withContext(Dispatchers.IO) {
            try {
                http.newCall(req).execute().use { res ->
                    val text = res.body?.string()
                    val error = ErrorMapping.map(path, res.code, res.header("Content-Type"), text)
                    if (error != null) return@use ApiResult.Err(error)
                    val value = runCatching { ApiJson.decodeFromString(strategy, text.orEmpty()) }.getOrNull()
                    if (value == null) ApiResult.Err(ApiError.ServerError) else ApiResult.Ok(value)
                }
            } catch (_: IOException) {
                ApiResult.Err(ApiError.Unreachable)
            } catch (_: IllegalArgumentException) {
                // A malformed origin never reaches here (it is normalised at pairing); treat it as unreachable.
                ApiResult.Err(ApiError.Unreachable)
            }
        }

    companion object {
        const val PATH_TODAY = "/api/mobile/today"
        const val PATH_DEVICE = "/api/mobile/device"
        const val PATH_PAIR = "/api/mobile/pair"
        const val PATH_PERIODS = "/api/mobile/periods"

        fun defaultHttp(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .retryOnConnectionFailure(true)
            .build()
    }
}
