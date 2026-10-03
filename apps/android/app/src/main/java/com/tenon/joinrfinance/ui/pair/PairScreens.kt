package com.tenon.joinrfinance.ui.pair

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tenon.joinrfinance.model.NOT_PAIRED_TEXT
import com.tenon.joinrfinance.model.Notice
import com.tenon.joinrfinance.model.PairingUrl
import com.tenon.joinrfinance.model.REVOKED_TEXT
import com.tenon.joinrfinance.ui.AppActions
import com.tenon.joinrfinance.ui.PairStep
import com.tenon.joinrfinance.ui.ScannerState
import com.tenon.joinrfinance.ui.components.BannerBackdrop
import com.tenon.joinrfinance.ui.components.BrandBlock
import com.tenon.joinrfinance.ui.components.JoinrButton
import com.tenon.joinrfinance.ui.components.NoticeBar
import com.tenon.joinrfinance.ui.components.SpectrumRule
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.ui.theme.JoinrType

/** The non-Tailscale warning (plan section 9.5), shown before pairing and in Settings → Server. */
const val CLEARTEXT_WARNING =
    "This address may be answered by the home network when Tailscale is off, sending this phone's key unencrypted. " +
        "Prefer the Umbrel's full Tailscale name."
const val PREPARING_SCANNER = "Preparing the scanner…"
const val SCANNER_UNAVAILABLE =
    "The scanner is still being installed by Google Play services. Try again in a minute, or enter the code by hand."
const val SCANNER_FAILED = "The scanner could not start. Enter the code by hand."
const val REPLACE_WARNING = "This phone is paired already: pairing again replaces the current pairing."

/** A full screen on the banner backdrop with the text on a surface card (no bottom bar). */
@Composable
fun BrandCardScreen(tag: String, content: @Composable ColumnScope.() -> Unit) {
    BannerBackdrop(Modifier.testTag(tag)) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
            SpectrumRule()
            Box(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp)) { BrandBlock() }
            Column(
                Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(JoinrColors.Surface)
                        .border(1.dp, JoinrColors.Hairline, RoundedCornerShape(6.dp))
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    content = content,
                )
            }
        }
    }
}

/** State 0: not paired (first run). */
@Composable
fun NotPairedScreen(scanner: ScannerState, scanMessage: String?, actions: AppActions) {
    BrandCardScreen("not-paired") {
        Text("PAIR THIS PHONE", style = JoinrType.label(size = 13.5.sp, tracking = 0.1f, color = JoinrColors.Teal))
        Text(NOT_PAIRED_TEXT, style = JoinrType.body(), modifier = Modifier.testTag("not-paired-text"))
        scanMessage?.let { NoticeBar(Notice(Notice.Kind.IMPORTANT, it), modifier = Modifier.testTag("scan-message")) }
        JoinrButton(
            if (scanner == ScannerState.READY) "Scan" else PREPARING_SCANNER,
            onClick = actions::startScan,
            enabled = scanner == ScannerState.READY,
            modifier = Modifier.fillMaxWidth().testTag("scan"),
        )
        JoinrButton("Enter by hand", onClick = actions::startByHand, primary = false, modifier = Modifier.fillMaxWidth().testTag("by-hand"))
    }
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit, tag: String, keyboard: KeyboardOptions) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = JoinrType.label(size = 11.sp, tracking = 0.12f))
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = JoinrType.figure(size = 15.sp, color = JoinrColors.TextBright),
            cursorBrush = SolidColor(JoinrColors.Teal),
            keyboardOptions = keyboard,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clip(RoundedCornerShape(5.dp))
                .background(JoinrColors.Ink)
                .border(1.dp, JoinrColors.Hairline, RoundedCornerShape(5.dp))
                .padding(horizontal = 12.dp, vertical = 14.dp)
                .semantics { contentDescription = label }
                .testTag(tag),
        )
    }
}

/** Pairing by hand: the address (prefilled `http://`) and the code. */
@Composable
fun ByHandScreen(step: PairStep.ByHand, actions: AppActions) {
    BrandCardScreen("by-hand-screen") {
        Text("ENTER BY HAND", style = JoinrType.label(size = 13.5.sp, tracking = 0.1f, color = JoinrColors.Teal))
        Text("The address and code are shown in Settings → Phone on the web.", style = JoinrType.body(size = 13.sp))
        Field(
            "SERVER ADDRESS",
            step.address,
            { actions.updateByHand(it, step.code) },
            "address",
            KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, autoCorrectEnabled = false),
        )
        Field(
            "PAIRING CODE",
            step.code,
            { actions.updateByHand(step.address, it) },
            "code",
            KeyboardOptions(capitalization = KeyboardCapitalization.Characters, keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done, autoCorrectEnabled = false),
        )
        step.error?.let { NoticeBar(Notice(Notice.Kind.IMPORTANT, it), modifier = Modifier.testTag("by-hand-error")) }
        JoinrButton("Continue", onClick = actions::submitByHand, modifier = Modifier.fillMaxWidth().testTag("continue"))
        JoinrButton("Cancel", onClick = actions::cancelPair, primary = false, modifier = Modifier.fillMaxWidth().testTag("cancel"))
    }
}

/** The confirmation before exchanging the code (plan section 9.5). */
@Composable
fun ConfirmScreen(step: PairStep.Confirm, actions: AppActions) {
    val tailscale = PairingUrl.addressKind(step.serverUrl) == PairingUrl.AddressKind.TAILSCALE
    BrandCardScreen("confirm") {
        Text("PAIR THIS PHONE", style = JoinrType.label(size = 13.5.sp, tracking = 0.1f, color = JoinrColors.Teal))
        Text("Pair with ${step.serverUrl}?", style = JoinrType.body(size = 15.sp, color = JoinrColors.TextBright), modifier = Modifier.testTag("confirm-text"))
        if (!tailscale) NoticeBar(Notice(Notice.Kind.IMPORTANT, CLEARTEXT_WARNING), modifier = Modifier.testTag("cleartext-warning"))
        if (step.replacing) NoticeBar(Notice(Notice.Kind.IMPORTANT, REPLACE_WARNING), modifier = Modifier.testTag("replace-warning"))
        JoinrButton(if (tailscale) "Pair" else "Pair anyway", onClick = actions::confirmPair, modifier = Modifier.fillMaxWidth().testTag("pair"))
        JoinrButton("Cancel", onClick = actions::cancelPair, primary = false, modifier = Modifier.fillMaxWidth().testTag("cancel"))
    }
}

@Composable
fun ExchangingScreen(step: PairStep.Exchanging) {
    BrandCardScreen("exchanging") {
        Text("PAIRING", style = JoinrType.label(size = 13.5.sp, tracking = 0.1f, color = JoinrColors.Teal))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
            CircularProgressIndicator(color = JoinrColors.Teal, strokeWidth = 2.dp)
        }
        Text("Pairing with ${step.serverUrl}…", style = JoinrType.body())
    }
}

@Composable
fun PairFailedScreen(step: PairStep.Failed, actions: AppActions) {
    BrandCardScreen("pair-failed") {
        Text("PAIRING FAILED", style = JoinrType.label(size = 13.5.sp, tracking = 0.1f, color = JoinrColors.OrangeTint))
        Text(step.message, style = JoinrType.body(), modifier = Modifier.testTag("pair-error"))
        JoinrButton("Enter by hand", onClick = actions::startByHand, modifier = Modifier.fillMaxWidth())
        JoinrButton("Cancel", onClick = actions::cancelPair, primary = false, modifier = Modifier.fillMaxWidth().testTag("cancel"))
    }
}

/** State 3: revoked (the cache and key are already cleared). */
@Composable
fun RevokedScreen(actions: AppActions) {
    BrandCardScreen("revoked") {
        Text("PHONE REMOVED", style = JoinrType.label(size = 13.5.sp, tracking = 0.1f, color = JoinrColors.OrangeTint))
        Text(REVOKED_TEXT, style = JoinrType.body(), modifier = Modifier.testTag("revoked-text"))
        JoinrButton("Pair again", onClick = actions::pairAgain, modifier = Modifier.fillMaxWidth().testTag("pair-again"))
    }
}
