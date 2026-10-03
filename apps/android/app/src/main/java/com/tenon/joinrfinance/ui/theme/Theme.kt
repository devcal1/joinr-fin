package com.tenon.joinrfinance.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.tenon.joinrfinance.R
import com.tenon.joinrfinance.model.Tone

/** Every STYLE_GUIDE section 1 token by its hex, plus the chart teal (charts only). Dark only. */
object JoinrColors {
    val Ink = Color(0xFF101019)
    val Surface = Color(0xFF191A24)
    val Raised = Color(0xFF262735)
    val Hairline = Color(0xFF24252F)
    val TextBright = Color(0xFFFFFFFF)
    val Text = Color(0xFFD3D4DC)
    val TextSecondary = Color(0xFF9A9BA8)
    val TextMuted = Color(0xFF838494)
    val Teal = Color(0xFF17C8A0)
    val Violet = Color(0xFF8B5CF6)
    val Fuchsia = Color(0xFFD946EF)
    val Orange = Color(0xFFF97316)
    val Go = Color(0xFF22C55E)
    val Stop = Color(0xFFEF4444)
    val PillNa = Color(0xFF2E2F3C)
    val TealTint = Color(0xFF6EE7C9)
    val VioletTint = Color(0xFFA855F7)
    val OrangeTint = Color(0xFFFB923C)
    val GoTint = Color(0xFF4ADE80)
    val StopTint = Color(0xFFF87171)
    val ChartTeal = Color(0xFF07AE8B)

    /** The mock's dashed base line: text-muted at 45 % alpha. */
    val DashedBase = TextMuted.copy(alpha = 0.45f)

    /** The spectrum rule (4 dp, under the status bar). */
    val Spectrum = Brush.horizontalGradient(
        0f to Teal,
        0.30f to Violet,
        0.55f to Fuchsia,
        1f to Orange,
    )

    /** Text tint of a figure (tints for text, full strength for marks). */
    fun textTone(tone: Tone): Color = when (tone) {
        Tone.GAIN -> GoTint
        Tone.LOSS -> StopTint
        Tone.FLAT, Tone.NONE -> TextSecondary
    }

    /** Mark colour of a figure (lines, bars). */
    fun markTone(tone: Tone): Color = when (tone) {
        Tone.GAIN -> Go
        Tone.LOSS -> Stop
        Tone.FLAT, Tone.NONE -> TextMuted
    }
}

/** Arimo (D149), one variable font declared at 400 and 700 with explicit variation settings. */
@OptIn(ExperimentalTextApi::class)
val Arimo: FontFamily = FontFamily(
    Font(R.font.arimo_variable, FontWeight.W400, variationSettings = FontVariation.Settings(FontVariation.weight(400))),
    Font(R.font.arimo_variable, FontWeight.W700, variationSettings = FontVariation.Settings(FontVariation.weight(700))),
)

/** Figures, codes and times: monospaced with tabular figures (as the mock). */
val Mono: FontFamily = FontFamily.Monospace

object JoinrType {
    /** An uppercase, letter-spaced Arimo label. */
    fun label(size: TextUnit = 11.sp, tracking: Float = 0.14f, color: Color = JoinrColors.TextSecondary, weight: FontWeight = FontWeight.W700) =
        TextStyle(fontFamily = Arimo, fontSize = size, fontWeight = weight, letterSpacing = tracking.em, color = color)

    /** Body text in Arimo. */
    fun body(size: TextUnit = 14.sp, color: Color = JoinrColors.Text, weight: FontWeight = FontWeight.W400) =
        TextStyle(fontFamily = Arimo, fontSize = size, fontWeight = weight, color = color, lineHeight = (size.value * 1.4f).sp)

    /** A monospaced, tabular figure. */
    fun figure(size: TextUnit = 12.5.sp, color: Color = JoinrColors.Text, weight: FontWeight = FontWeight.W400) =
        TextStyle(fontFamily = Mono, fontSize = size, fontWeight = weight, color = color, fontFeatureSettings = "tnum")
}

@Composable
fun JoinrTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = JoinrColors.Teal,
            onPrimary = JoinrColors.Ink,
            background = JoinrColors.Ink,
            onBackground = JoinrColors.Text,
            surface = JoinrColors.Surface,
            onSurface = JoinrColors.Text,
            surfaceVariant = JoinrColors.Raised,
            onSurfaceVariant = JoinrColors.TextSecondary,
            outline = JoinrColors.Hairline,
            error = JoinrColors.StopTint,
        ),
        content = content,
    )
}
