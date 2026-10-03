package com.tenon.joinrfinance.ui

import com.tenon.joinrfinance.model.SortOrder
import com.tenon.joinrfinance.model.TodayTab
import com.tenon.joinrfinance.net.ApiError
import com.tenon.joinrfinance.net.MobileTodayResponse
import com.tenon.joinrfinance.store.Pairing

/** The lock (plan section 9.6): locked (with an optional system sentence), unlocked, or no screen lock (a banner). */
sealed class LockUi {
    data class Locked(val message: String? = null) : LockUi()
    data object Unlocked : LockUi()
    data object NoScreenLock : LockUi()

    val open: Boolean get() = this !is Locked
}

/** The scanner's readiness (plan section 9.5). */
enum class ScannerState { PREPARING, READY }

/** Where the pairing flow is. */
sealed class PairStep {
    /** The not-paired screen (Scan / Enter by hand). */
    data object Choose : PairStep()

    data class ByHand(val address: String = "http://", val code: String = "", val error: String? = null) : PairStep()

    data class Confirm(val serverUrl: String, val code: String, val replacing: Boolean) : PairStep()

    data class Exchanging(val serverUrl: String) : PairStep()

    data class Failed(val message: String, val serverUrl: String? = null, val code: String? = null) : PairStep()
}

/** Everything the screens draw. */
data class AppUiState(
    val loaded: Boolean = false,
    val lock: LockUi = LockUi.Locked(),
    val pairing: Pairing? = null,
    val revoked: Boolean = false,
    val today: MobileTodayResponse? = null,
    val fetchedAtMs: Long? = null,
    val refreshing: Boolean = false,
    val error: ApiError? = null,
    val nowMs: Long = System.currentTimeMillis(),
    val tab: TodayTab = TodayTab.CARDS,
    val sort: SortOrder = SortOrder.DAY_CENTS,
    /** Non-null while a pairing flow is on screen (a deep link, Scan, by hand, the confirmation). */
    val pairStep: PairStep? = null,
    val scanner: ScannerState = ScannerState.PREPARING,
    val scanMessage: String? = null,
    val widgetsUpdatedAtMs: Long? = null,
    val appVersion: String = com.tenon.joinrfinance.BuildConfig.VERSION_NAME,
)

/** What the screens can ask for. */
interface AppActions {
    fun refresh()
    fun selectTab(tab: TodayTab)
    fun cycleSort()
    fun unlock()
    fun startScan()
    fun startByHand()
    fun updateByHand(address: String, code: String)
    fun submitByHand()
    fun confirmPair()
    fun cancelPair()
    fun pairAgain()
    fun unpair()

    object None : AppActions {
        override fun refresh() = Unit
        override fun selectTab(tab: TodayTab) = Unit
        override fun cycleSort() = Unit
        override fun unlock() = Unit
        override fun startScan() = Unit
        override fun startByHand() = Unit
        override fun updateByHand(address: String, code: String) = Unit
        override fun submitByHand() = Unit
        override fun confirmPair() = Unit
        override fun cancelPair() = Unit
        override fun pairAgain() = Unit
        override fun unpair() = Unit
    }
}
