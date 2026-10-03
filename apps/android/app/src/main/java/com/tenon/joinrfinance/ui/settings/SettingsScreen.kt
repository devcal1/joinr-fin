package com.tenon.joinrfinance.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tenon.joinrfinance.model.Notice
import com.tenon.joinrfinance.model.PairingUrl
import com.tenon.joinrfinance.model.Times
import com.tenon.joinrfinance.net.MOBILE_API_VERSION
import com.tenon.joinrfinance.ui.AppActions
import com.tenon.joinrfinance.ui.AppUiState
import com.tenon.joinrfinance.ui.components.BrandBlock
import com.tenon.joinrfinance.ui.components.JoinrButton
import com.tenon.joinrfinance.ui.components.JoinrIcons
import com.tenon.joinrfinance.ui.components.KeyValueTable
import com.tenon.joinrfinance.ui.components.NoticeBar
import com.tenon.joinrfinance.ui.components.SectionLabel
import com.tenon.joinrfinance.ui.components.SpectrumRule
import com.tenon.joinrfinance.ui.pair.CLEARTEXT_WARNING
import com.tenon.joinrfinance.ui.theme.JoinrColors
import com.tenon.joinrfinance.ui.theme.JoinrType
import java.time.Instant

const val UNPAIR_NOTE = "The Umbrel still lists this phone until you remove it in Settings → Phone on the web: the phone cannot do that itself."

/** The SETTINGS destination (D146): the app's own settings, about and unpair. */
@Composable
fun SettingsScreen(state: AppUiState, actions: AppActions, onLicences: () -> Unit, contentPadding: PaddingValues = PaddingValues(0.dp)) {
    val pairing = state.pairing
    val zone = Times.zone(pairing?.timeZone ?: state.today?.timeZone)
    var confirm by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(JoinrColors.Ink).testTag("settings")) {
        SpectrumRule()
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            BrandBlock()
            Box(Modifier.weight(1f))
            Text("SETTINGS", style = JoinrType.label(size = 13.sp, tracking = 0.16f, color = JoinrColors.Text))
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(JoinrColors.Hairline))
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .testTag("settings-scroll")
                .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = contentPadding.calculateBottomPadding() + 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SectionLabel("Server")
            KeyValueTable(listOf("Address" to (pairing?.origin ?: "—")))
            if (pairing != null && PairingUrl.addressKind(pairing.origin) != PairingUrl.AddressKind.TAILSCALE) {
                NoticeBar(Notice(Notice.Kind.IMPORTANT, CLEARTEXT_WARNING), modifier = Modifier.testTag("settings-warning"))
            }
            SectionLabel("This phone")
            KeyValueTable(
                listOf(
                    "Label" to (pairing?.label ?: "—"),
                    "Paired" to (Times.instant(pairing?.pairedAt)?.let { Times.dmy(it, zone) } ?: "—"),
                ),
            )
            SectionLabel("App lock")
            Text(
                "Always on: the app asks for your fingerprint or screen lock when it opens, and locks after 5 minutes in the background.",
                style = JoinrType.body(size = 13.sp),
            )
            SectionLabel("Widgets")
            val updated = state.widgetsUpdatedAtMs?.let { "; last update " + Times.hm(Instant.ofEpochMilli(it), zone) } ?: ""
            Text("Widgets update about every 30 minutes$updated.", style = JoinrType.body(size = 13.sp), modifier = Modifier.testTag("widgets-line"))
            SectionLabel("About")
            KeyValueTable(
                listOf(
                    "App version" to state.appVersion,
                    "Server version" to (state.today?.serverVersion ?: pairing?.serverVersion ?: "—"),
                    "API version" to MOBILE_API_VERSION.toString(),
                ),
            )
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(JoinrColors.Surface)
                    .clickable(onClickLabel = "Open the licences", role = Role.Button, onClick = onLicences)
                    .padding(horizontal = 12.dp)
                    .testTag("licences-link"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Open-source licences", style = JoinrType.body(size = 14.sp, color = JoinrColors.TextBright), modifier = Modifier.weight(1f))
                Text("›", style = JoinrType.body(size = 18.sp, color = JoinrColors.TextSecondary))
            }
            SectionLabel("Unpair")
            Text(UNPAIR_NOTE, style = JoinrType.body(size = 13.sp, color = JoinrColors.TextSecondary))
            JoinrButton("Unpair this phone", onClick = { confirm = true }, primary = false, modifier = Modifier.fillMaxWidth().testTag("unpair"))
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            containerColor = JoinrColors.Surface,
            title = { Text("UNPAIR THIS PHONE?", style = JoinrType.label(size = 13.sp, tracking = 0.1f, color = JoinrColors.TextBright)) },
            text = {
                Text(
                    "This clears the key, the figures and the widgets on this phone. $UNPAIR_NOTE",
                    style = JoinrType.body(size = 13.sp),
                )
            },
            confirmButton = {
                Box(
                    Modifier
                        .heightIn(min = 48.dp)
                        .clickable(role = Role.Button) {
                            confirm = false
                            actions.unpair()
                        }
                        .padding(horizontal = 12.dp)
                        .testTag("unpair-confirm"),
                    contentAlignment = Alignment.Center,
                ) { Text("UNPAIR", style = JoinrType.label(size = 12.sp, tracking = 0.12f, color = JoinrColors.StopTint)) }
            },
            dismissButton = {
                Box(
                    Modifier.heightIn(min = 48.dp).clickable(role = Role.Button) { confirm = false }.padding(horizontal = 12.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("CANCEL", style = JoinrType.label(size = 12.sp, tracking = 0.12f, color = JoinrColors.Teal)) }
            },
        )
    }
}

/** One library and its licence. */
data class Licence(val name: String, val licence: String)

val LICENCES = listOf(
    Licence("AndroidX (Compose, Activity, Core, Lifecycle, Glance, Biometric, WorkManager, DataStore)", "Apache License 2.0"),
    Licence("Kotlin standard library, kotlinx.coroutines, kotlinx.serialization", "Apache License 2.0"),
    Licence("OkHttp, Okio", "Apache License 2.0"),
    Licence("Google Play services code scanner (ML Kit)", "Android Software Development Kit License; ML Kit Terms of Service"),
    Licence("Line icons (lucide geometry)", "ISC License"),
    Licence("Arimo font", "SIL Open Font License 1.1 (full text below)"),
)

/** The open-source licences: a pushed static screen; the Arimo OFL text comes from the bundled asset. */
@Composable
fun LicencesScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val ofl = androidx.compose.runtime.remember {
        runCatching { context.assets.open("licences/OFL-Arimo.txt").bufferedReader().use { it.readText() } }.getOrDefault("")
    }
    Column(Modifier.fillMaxSize().background(JoinrColors.Ink).testTag("licences")) {
        SpectrumRule()
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .clickable(onClickLabel = "Back", role = Role.Button, onClick = onBack)
                    .semantics { contentDescription = "Back" }
                    .testTag("back"),
                contentAlignment = Alignment.Center,
            ) { Icon(JoinrIcons.Back, contentDescription = null, tint = JoinrColors.TextSecondary, modifier = Modifier.size(20.dp)) }
            Text("OPEN-SOURCE LICENCES", style = JoinrType.label(size = 13.sp, tracking = 0.12f, color = JoinrColors.TextBright))
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(JoinrColors.Hairline))
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            LICENCES.forEach { l ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(JoinrColors.Surface).padding(12.dp)) {
                    Text(l.name, style = JoinrType.body(size = 13.sp, color = JoinrColors.TextBright, weight = FontWeight.W700))
                    Text(l.licence, style = JoinrType.body(size = 12.sp, color = JoinrColors.TextSecondary))
                }
            }
            SectionLabel("Arimo — SIL Open Font License 1.1")
            Text(ofl, style = JoinrType.figure(size = 11.sp, color = JoinrColors.Text), modifier = Modifier.testTag("ofl"))
        }
    }
}
