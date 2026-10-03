package com.tenon.joinrfinance

import com.tenon.joinrfinance.net.ApiJson
import com.tenon.joinrfinance.net.MobileTodayResponse
import com.tenon.joinrfinance.store.Box
import java.io.File
import java.time.Instant

/** The JSON copies of the schema fixtures (`packages/schema/src/fixtures/{mobile,phone}.ts`, plan section 3.6). */
object Fixtures {
    val TODAY_FILES = listOf(
        "today-open.json",
        "today-saturday.json",
        "today-holiday.json",
        "today-pre-open-no-crypto.json",
        "today-all-stale.json",
        "today-empty.json",
    )

    fun text(name: String): String =
        requireNotNull(Fixtures::class.java.classLoader!!.getResource("fixtures/$name")) { "missing fixture $name" }.readText()

    fun today(name: String): MobileTodayResponse = ApiJson.decodeFromString(MobileTodayResponse.serializer(), text("today-$name.json"))

    val open: MobileTodayResponse get() = today("open")
    val saturday: MobileTodayResponse get() = today("saturday")
    val allStale: MobileTodayResponse get() = today("all-stale")
    val empty: MobileTodayResponse get() = today("empty")
    val preOpen: MobileTodayResponse get() = today("pre-open-no-crypto")
    val holiday: MobileTodayResponse get() = today("holiday")

    /**
     * The `open` fixture with wide made-up figures (a five-digit day loss, a two-digit day %, a seven-digit value): the
     * widths that clipped in LIST at a fractional density. Only the first `ok` holding and the totals change.
     */
    fun wideFigures(): MobileTodayResponse {
        val t = open
        val i = t.holdings.indexOfFirst { it.dayStatus == "ok" }
        val holdings = t.holdings.toMutableList()
        holdings[i] = holdings[i].copy(dayCents = -5_839_827L, dayRatio = "-0.968891685153", valueCents = 103_613_523L)
        return t.copy(
            holdings = holdings,
            totals = t.totals.copy(dayCents = -5_802_605L, dayRatio = "-0.0531052495976", valueCents = 103_613_523L),
        )
    }

    /** The `open` fixture without its unpriced holding (EXB): every value and cost known, so the gain shows (D155). */
    fun priced(): MobileTodayResponse = open.let { t -> t.copy(holdings = t.holdings.filter { it.valueCents != null }) }

    /** The fixture key (plan section 3.6): never a real key. */
    const val FAKE_KEY = "jfk_0000000000000000000000000000000000000000000"

    fun generatedMs(t: MobileTodayResponse): Long = Instant.parse(t.generatedAt).toEpochMilli()

    /** The repo root (the wordmark and icon tests read the SVG master from it). */
    fun repoRoot(): File {
        System.getProperty("joinr.repoRoot")?.let { return File(it) }
        var dir: File? = File("").absoluteFile
        while (dir != null && !File(dir, "reference/brand/joinr_wordmark.svg").isFile) dir = dir.parentFile
        return requireNotNull(dir) { "repo root not found" }
    }
}

/** A reversible fake for the Keystore box (Robolectric has no AndroidKeyStore). */
class FakeBox : Box {
    override fun seal(plain: String): String = "sealed:" + plain.reversed()
    override fun open(sealed: String): String? = if (sealed.startsWith("sealed:")) sealed.removePrefix("sealed:").reversed() else null
}

/**
 * An in-memory DataStore: on Windows, DataStore's file rename fails once the target exists (a JVM-on-Windows limit;
 * phones are unaffected), so the JVM tests keep preferences in memory.
 */
class MemoryDataStore : androidx.datastore.core.DataStore<androidx.datastore.preferences.core.Preferences> {
    private val state = kotlinx.coroutines.flow.MutableStateFlow(androidx.datastore.preferences.core.emptyPreferences())
    private val lock = kotlinx.coroutines.sync.Mutex()
    override val data: kotlinx.coroutines.flow.Flow<androidx.datastore.preferences.core.Preferences> = state

    override suspend fun updateData(
        transform: suspend (t: androidx.datastore.preferences.core.Preferences) -> androidx.datastore.preferences.core.Preferences,
    ): androidx.datastore.preferences.core.Preferences = lock.withLock {
        val next = transform(state.value)
        state.value = next
        next
    }
}

private suspend fun <T> kotlinx.coroutines.sync.Mutex.withLock(block: suspend () -> T): T {
    lock()
    try {
        return block()
    } finally {
        unlock()
    }
}
