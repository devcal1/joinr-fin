package com.tenon.joinrfinance.store

import com.tenon.joinrfinance.model.PairingUrl
import com.tenon.joinrfinance.net.ApiError
import com.tenon.joinrfinance.net.ApiResult
import com.tenon.joinrfinance.net.MobileApi
import com.tenon.joinrfinance.net.MobilePairRequest
import com.tenon.joinrfinance.net.MobileTodayResponse
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant

/** Everything the app and the widgets show, in one immutable value. */
data class AppData(
    val loaded: Boolean = false,
    val pairing: Pairing? = null,
    val revoked: Boolean = false,
    val today: MobileTodayResponse? = null,
    val fetchedAtMs: Long? = null,
    val refreshing: Boolean = false,
    val error: ApiError? = null,
)

/** Re-renders the three widgets (the Glance `updateAll`); a no-op in tests. */
fun interface WidgetUpdater {
    suspend fun updateAll()
}

enum class RefreshOutcome { OK, FAILED, REVOKED, NOT_PAIRED }

/**
 * The one place that talks to the server and the stores. A process singleton (the app, the worker and the
 * widgets share it), so a refresh run by the worker shows in the app at once.
 */
class Repository(
    private val pairingStore: PairingStore,
    private val cache: TodayCache,
    private val prefs: Prefs,
    private val api: MobileApi,
    private val widgets: WidgetUpdater,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val state = MutableStateFlow(AppData())
    val data: StateFlow<AppData> = state.asStateFlow()
    private val lock = Mutex()

    /** Reads the stores once (idempotent). */
    suspend fun load(): AppData {
        if (state.value.loaded) return state.value
        val pairing = pairingStore.load()
        val revoked = pairingStore.isRevoked()
        val entry = if (pairing != null) cache.read() else null
        state.update {
            it.copy(loaded = true, pairing = pairing, revoked = revoked && pairing == null, today = entry?.today, fetchedAtMs = entry?.fetchedAtMs)
        }
        return state.value
    }

    /** Fetch → cache → widgets (plan section 9.9). A failed fetch keeps the cache and still re-renders the widgets. */
    suspend fun refresh(): RefreshOutcome = lock.withLock {
        load()
        val pairing = state.value.pairing ?: return@withLock RefreshOutcome.NOT_PAIRED
        state.update { it.copy(refreshing = true) }
        val outcome = when (val res = api.today(pairing.origin, pairing.key)) {
            is ApiResult.Ok -> {
                val now = clock()
                cache.write(res.value, now)
                if (res.value.serverVersion != pairing.serverVersion) pairingStore.updateServerVersion(res.value.serverVersion)
                state.update {
                    it.copy(
                        today = res.value,
                        fetchedAtMs = now,
                        error = null,
                        pairing = it.pairing?.copy(serverVersion = res.value.serverVersion),
                    )
                }
                RefreshOutcome.OK
            }
            is ApiResult.Err -> if (res.error == ApiError.Revoked) {
                clearAll(revoked = true)
                RefreshOutcome.REVOKED
            } else {
                state.update { it.copy(error = res.error) }
                RefreshOutcome.FAILED
            }
        }
        state.update { it.copy(refreshing = false) }
        runCatching { widgets.updateAll() }
        if (outcome != RefreshOutcome.REVOKED) prefs.setWidgetsUpdatedAt(clock())
        outcome
    }

    sealed class PairOutcome {
        data object Ok : PairOutcome()
        data class Failed(val error: ApiError) : PairOutcome()
    }

    /** POST /pair, then GET /device, then the first Today (plan section 9.5). Replaces any current pairing. */
    suspend fun pair(serverUrl: String, code: String, deviceName: String, appVersion: String): PairOutcome {
        val origin = PairingUrl.normaliseServerUrl(serverUrl) ?: return PairOutcome.Failed(ApiError.Unreachable)
        val normalised = PairingUrl.normalisePairingCode(code) ?: return PairOutcome.Failed(ApiError.Pairing(ApiError.CODE_PAIRING_INVALID))
        val res = api.pair(origin, MobilePairRequest(code = normalised, deviceName = deviceName.take(DEVICE_NAME_MAX), appVersion = appVersion))
        val paired = when (res) {
            is ApiResult.Ok -> res.value
            is ApiResult.Err -> return PairOutcome.Failed(res.error)
        }
        val device = (api.device(origin, paired.key) as? ApiResult.Ok)?.value
        val pairing = Pairing(
            origin = origin,
            key = paired.key,
            deviceId = paired.deviceId,
            label = device?.label ?: paired.label,
            pairedAt = device?.pairedAt ?: Instant.ofEpochMilli(clock()).toString(),
            serverVersion = paired.serverVersion,
            timeZone = device?.timeZone ?: "Australia/Melbourne",
        )
        lock.withLock {
            cache.clear()
            prefs.clearWidgets()
            pairingStore.save(pairing)
            state.update { AppData(loaded = true, pairing = pairing) }
        }
        refresh()
        return PairOutcome.Ok
    }

    /** Settings → Unpair: clears the key, the cache and the widgets' state (the server keeps the phone listed). */
    suspend fun unpair() = lock.withLock { clearAll(revoked = false) }

    /** The revoked screen's "Pair again". */
    suspend fun acknowledgeRevoked() {
        pairingStore.acknowledgeRevoked()
        state.update { it.copy(revoked = false) }
    }

    private suspend fun clearAll(revoked: Boolean) {
        pairingStore.clear(revoked)
        cache.clear()
        prefs.clearWidgets()
        state.update { AppData(loaded = true, revoked = revoked) }
        runCatching { widgets.updateAll() }
    }

    private companion object {
        const val DEVICE_NAME_MAX = 40
    }
}
