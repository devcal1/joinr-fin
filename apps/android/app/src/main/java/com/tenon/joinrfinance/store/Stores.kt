package com.tenon.joinrfinance.store

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.tenon.joinrfinance.model.SortOrder
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.net.ApiJson
import com.tenon.joinrfinance.net.MobilePeriodsResponse
import com.tenon.joinrfinance.net.MobileTodayResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.File

/** The paired server and this phone's identity. The key never appears in [toString]. */
data class Pairing(
    val origin: String,
    val key: String,
    val deviceId: String,
    val label: String,
    val pairedAt: String,
    val serverVersion: String,
    val timeZone: String,
) {
    override fun toString(): String = "Pairing(origin=$origin, deviceId=$deviceId, label=$label)"
}

/** The pairing (plan section 9.4): the key and origin sealed by the [Box], the rest plain, in DataStore. */
class PairingStore(private val store: DataStore<Preferences>, private val box: Box) {
    suspend fun load(): Pairing? {
        val p = store.data.first()
        val origin = p[ORIGIN]?.let(box::open) ?: return null
        val key = p[KEY]?.let(box::open) ?: return null
        return Pairing(
            origin = origin,
            key = key,
            deviceId = p[DEVICE_ID].orEmpty(),
            label = p[LABEL].orEmpty(),
            pairedAt = p[PAIRED_AT].orEmpty(),
            serverVersion = p[SERVER_VERSION].orEmpty(),
            timeZone = p[TIME_ZONE] ?: "Australia/Melbourne",
        )
    }

    suspend fun save(pairing: Pairing) {
        val origin = box.seal(pairing.origin)
        val key = box.seal(pairing.key)
        store.edit {
            it[ORIGIN] = origin
            it[KEY] = key
            it[DEVICE_ID] = pairing.deviceId
            it[LABEL] = pairing.label
            it[PAIRED_AT] = pairing.pairedAt
            it[SERVER_VERSION] = pairing.serverVersion
            it[TIME_ZONE] = pairing.timeZone
            it[REVOKED] = false
        }
    }

    suspend fun updateServerVersion(version: String) {
        store.edit { it[SERVER_VERSION] = version }
    }

    /** Clears the key and identity; [revoked] records why (the revoked screen and the widgets' text). */
    suspend fun clear(revoked: Boolean) {
        store.edit {
            it.clear()
            it[REVOKED] = revoked
        }
    }

    suspend fun isRevoked(): Boolean = store.data.first()[REVOKED] ?: false

    suspend fun acknowledgeRevoked() {
        store.edit { it[REVOKED] = false }
    }

    /** The raw stored values (for the test that the key is never stored in plain text). */
    suspend fun rawValues(): Map<String, Any> = store.data.first().asMap().mapKeys { it.key.name }

    private companion object {
        val ORIGIN = stringPreferencesKey("origin_sealed")
        val KEY = stringPreferencesKey("key_sealed")
        val DEVICE_ID = stringPreferencesKey("device_id")
        val LABEL = stringPreferencesKey("label")
        val PAIRED_AT = stringPreferencesKey("paired_at")
        val SERVER_VERSION = stringPreferencesKey("server_version")
        val TIME_ZONE = stringPreferencesKey("time_zone")
        val REVOKED = booleanPreferencesKey("revoked")
    }
}

/** The last Today answer and the phone's fetch time, sealed, in app-private storage (plan section 9.4). */
class TodayCache(private val file: File, private val box: Box) {
    data class Entry(val today: MobileTodayResponse, val fetchedAtMs: Long)

    @Serializable
    private data class Stored(val fetchedAtMs: Long, val today: MobileTodayResponse)

    suspend fun read(): Entry? = withContext(Dispatchers.IO) {
        if (!file.isFile) return@withContext null
        val plain = runCatching { file.readText(Charsets.UTF_8) }.getOrNull()?.let(box::open) ?: return@withContext null
        runCatching { ApiJson.decodeFromString(Stored.serializer(), plain) }.getOrNull()?.let { Entry(it.today, it.fetchedAtMs) }
    }

    suspend fun write(today: MobileTodayResponse, fetchedAtMs: Long) = withContext(Dispatchers.IO) {
        val plain = ApiJson.encodeToString(Stored.serializer(), Stored(fetchedAtMs, today))
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(box.seal(plain), Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        file.delete()
        File(file.parentFile, file.name + ".tmp").delete()
    }
}

/**
 * The last periods answer (Stage 10 plan section 9.3), sealed by the same [Box] beside [TodayCache]. Each entry records
 * the pairing it was fetched for (origin and device id): an entry for another pairing is ignored and deleted on read.
 */
class PeriodsCache(private val file: File, private val box: Box) {
    data class Entry(val periods: MobilePeriodsResponse, val fetchedAtMs: Long)

    @Serializable
    private data class Stored(val fetchedAtMs: Long, val origin: String, val deviceId: String, val periods: MobilePeriodsResponse)

    /** The entry for this pairing, or null (absent, unreadable, or another pairing's: then it is deleted). */
    suspend fun read(origin: String, deviceId: String): Entry? = withContext(Dispatchers.IO) {
        if (!file.isFile) return@withContext null
        val plain = runCatching { file.readText(Charsets.UTF_8) }.getOrNull()?.let(box::open)
        val stored = plain?.let { runCatching { ApiJson.decodeFromString(Stored.serializer(), it) }.getOrNull() }
        if (stored == null || stored.origin != origin || stored.deviceId != deviceId) {
            deleteFiles()
            return@withContext null
        }
        Entry(stored.periods, stored.fetchedAtMs)
    }

    suspend fun write(periods: MobilePeriodsResponse, fetchedAtMs: Long, origin: String, deviceId: String) = withContext(Dispatchers.IO) {
        val plain = ApiJson.encodeToString(Stored.serializer(), Stored(fetchedAtMs, origin, deviceId, periods))
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(box.seal(plain), Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    suspend fun clear() = withContext(Dispatchers.IO) { deleteFiles() }

    /** Whether a file is stored (for the tests). */
    fun exists(): Boolean = file.isFile

    private fun deleteFiles() {
        file.delete()
        File(file.parentFile, file.name + ".tmp").delete()
    }
}

/** UI preferences and the widgets' choices (plan section 9.4); a widget's holding is stored by its `key`. */
class Prefs(private val store: DataStore<Preferences>) {
    suspend fun sort(): SortOrder = store.data.first()[SORT]?.let { s -> SortOrder.entries.firstOrNull { it.name == s } } ?: SortOrder.DAY_CENTS
    suspend fun setSort(order: SortOrder) {
        store.edit { it[SORT] = order.name }
    }

    suspend fun tab(): TodayTab = store.data.first()[TAB]?.let { s -> TodayTab.entries.firstOrNull { it.name == s } } ?: TodayTab.CARDS
    suspend fun setTab(tab: TodayTab) {
        store.edit { it[TAB] = tab.name }
    }

    suspend fun widgetHolding(appWidgetId: Int): String? = store.data.first()[widgetKey(appWidgetId)]
    suspend fun setWidgetHolding(appWidgetId: Int, holdingKey: String) {
        store.edit { it[widgetKey(appWidgetId)] = holdingKey }
    }

    suspend fun widgetsUpdatedAt(): Long? = store.data.first()[WIDGETS_UPDATED]
    suspend fun setWidgetsUpdatedAt(ms: Long) {
        store.edit { it[WIDGETS_UPDATED] = ms }
    }

    /** Unpair and revoke clear the widgets' state with the pairing. */
    suspend fun clearWidgets() {
        store.edit { p ->
            p.asMap().keys.filter { it.name.startsWith("widget_") }.forEach { k -> p.remove(k) }
            p.remove(WIDGETS_UPDATED)
        }
    }

    private companion object {
        val SORT = stringPreferencesKey("sort")
        val TAB = stringPreferencesKey("tab")
        val WIDGETS_UPDATED = longPreferencesKey("widgets_updated_at")
        fun widgetKey(id: Int) = stringPreferencesKey("widget_$id")
    }
}
