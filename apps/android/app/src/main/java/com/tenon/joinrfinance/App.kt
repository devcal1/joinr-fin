package com.tenon.joinrfinance

import android.annotation.SuppressLint
import android.app.Application
import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStoreFile
import com.tenon.joinrfinance.net.ApiClient
import com.tenon.joinrfinance.net.MobileApi
import com.tenon.joinrfinance.store.Box
import com.tenon.joinrfinance.store.KeystoreBox
import com.tenon.joinrfinance.store.PairingStore
import com.tenon.joinrfinance.store.Prefs
import com.tenon.joinrfinance.store.Repository
import com.tenon.joinrfinance.store.TodayCache
import com.tenon.joinrfinance.store.WidgetUpdater
import com.tenon.joinrfinance.widget.Widgets
import java.io.File

/** The process-wide services. Tests build one with fakes and [Services.install] it. */
class Graph(
    context: Context,
    box: Box? = null,
    api: MobileApi? = null,
    widgetUpdater: WidgetUpdater? = null,
    clock: () -> Long = System::currentTimeMillis,
    storeDir: File? = null,
    pairingDataStore: DataStore<Preferences>? = null,
    prefsDataStore: DataStore<Preferences>? = null,
) {
    private val app = context.applicationContext
    val box: Box = box ?: KeystoreBox()
    val api: MobileApi = api ?: ApiClient(BuildConfig.VERSION_NAME)

    private val pairingData: DataStore<Preferences> = pairingDataStore ?: PreferenceDataStoreFactory.create(
        produceFile = { storeDir?.let { File(it, "pairing.preferences_pb") } ?: app.preferencesDataStoreFile("pairing") },
    )
    private val prefsData: DataStore<Preferences> = prefsDataStore ?: PreferenceDataStoreFactory.create(
        produceFile = { storeDir?.let { File(it, "prefs.preferences_pb") } ?: app.preferencesDataStoreFile("prefs") },
    )

    val pairingStore = PairingStore(pairingData, this.box)
    val prefs = Prefs(prefsData)
    val cache = TodayCache(File(storeDir ?: app.filesDir, "today.cache"), this.box)
    val repository = Repository(
        pairingStore = pairingStore,
        cache = cache,
        prefs = prefs,
        api = this.api,
        widgets = widgetUpdater ?: WidgetUpdater { Widgets.updateAll(app) },
        clock = clock,
    )
}

object Services {
    // The graph holds the application context only (never an activity), so the static reference cannot leak one.
    @SuppressLint("StaticFieldLeak")
    @Volatile
    private var graph: Graph? = null

    fun get(context: Context): Graph = graph ?: synchronized(this) {
        graph ?: Graph(context).also { graph = it }
    }

    /** Tests only: replace the graph (or null to reset). */
    fun install(g: Graph?) {
        synchronized(this) { graph = g }
    }
}

class App : Application()
