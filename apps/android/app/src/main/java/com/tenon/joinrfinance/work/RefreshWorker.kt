package com.tenon.joinrfinance.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.tenon.joinrfinance.Services
import java.util.concurrent.TimeUnit

/**
 * Fetch → cache → re-render the three widgets (plan section 9.9). A failed fetch still re-renders them (the age
 * tint and the 24-hour rule apply); a revoked key clears the pairing and re-renders "Open Joinr Finance to pair.".
 */
class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val outcome = Services.get(applicationContext).repository.refresh()
        return Result.success(workDataOf(KEY_OUTCOME to outcome.name))
    }

    companion object {
        const val KEY_OUTCOME = "outcome"
    }
}

object RefreshScheduler {
    const val PERIODIC = "joinr-refresh-periodic"
    const val ONCE = "joinr-refresh-once"
    const val INTERVAL_MINUTES = 30L

    /** Unique periodic work every 30 minutes on any network; UPDATE so a later interval change applies on update. */
    fun ensurePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<RefreshWorker>(INTERVAL_MINUTES, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    /** A one-time run: on app open, on a manual refresh and when a widget is added. */
    fun runOnce(context: Context) {
        val request = OneTimeWorkRequestBuilder<RefreshWorker>().build()
        WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.KEEP, request)
    }

    fun cancelPeriodic(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
    }
}
