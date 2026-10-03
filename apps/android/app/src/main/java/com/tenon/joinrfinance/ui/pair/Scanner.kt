package com.tenon.joinrfinance.ui.pair

import android.content.Context
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/** The QR scanner behind an interface, so the screens and tests never need Play services. */
interface QrScanner {
    /** Makes sure the scanner's UI module is installed (a sideloaded APK does not get it at install). */
    fun prepare(onReady: () -> Unit)

    /**
     * Opens the scanner. Exactly one callback runs: the scanned text, a cancel (nothing said), or a failure
     * (`unavailable` when Play services is still installing the module).
     */
    fun scan(onText: (String) -> Unit, onCancel: () -> Unit, onFailure: (unavailable: Boolean) -> Unit)
}

/** Google's code scanner (QR only; no CAMERA permission: Google draws the scanner). */
class GmsQrScanner(private val context: Context) : QrScanner {
    private val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    private val scanner by lazy { GmsBarcodeScanning.getClient(context, options) }

    override fun prepare(onReady: () -> Unit) {
        val installer = ModuleInstall.getClient(context)
        installer.areModulesAvailable(scanner)
            .addOnSuccessListener { res ->
                if (res.areModulesAvailable()) {
                    onReady()
                } else {
                    installer.installModules(ModuleInstallRequest.newBuilder().addApi(scanner).build())
                        .addOnSuccessListener { onReady() }
                        // Scan then reports UNAVAILABLE with its sentence; by hand always works.
                        .addOnFailureListener { onReady() }
                }
            }
            .addOnFailureListener { onReady() }
    }

    override fun scan(onText: (String) -> Unit, onCancel: () -> Unit, onFailure: (unavailable: Boolean) -> Unit) {
        scanner.startScan()
            .addOnSuccessListener { code -> code.rawValue?.let(onText) ?: onFailure(false) }
            .addOnCanceledListener { onCancel() }
            .addOnFailureListener { e -> onFailure(e is MlKitException && e.errorCode == MlKitException.UNAVAILABLE) }
    }
}
