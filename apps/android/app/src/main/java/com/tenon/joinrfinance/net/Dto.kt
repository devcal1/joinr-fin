package com.tenon.joinrfinance.net

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.listSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.math.BigDecimal

/**
 * The phone API's DTOs (plan section 4.3), mirrored from `packages/schema/src/dto/mobile.ts`.
 * Decimals stay strings on the wire and become [BigDecimal] through [dec]; never Double.
 */
val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}

/** The only API version this app reads. */
const val MOBILE_API_VERSION: Int = 1

fun dec(value: String): BigDecimal = BigDecimal(value)
fun decOrNull(value: String?): BigDecimal? = value?.let { BigDecimal(it) }

/** One `[unixSeconds, "price"]` pair of a holding's line. */
typealias PricePoint = Pair<Long, String>

/** One `[unixSeconds, cents]` pair of the portfolio line. */
typealias CentsPoint = Pair<Long, Long>

@Serializable
data class MobileLineDto(
    val sessionDate: String,
    val timeZone: String,
    val base: String? = null,
    @Serializable(with = PricePointsSerializer::class) val points: List<PricePoint> = emptyList(),
)

@Serializable
data class NativeDto(
    val currency: String,
    val price: String,
    val previousClose: String? = null,
    val dayRatio: String? = null,
)

@Serializable
data class SessionDto(val date: String, val timeZone: String, val daily: Boolean)

@Serializable
data class PositionDto(
    val costCents: Long? = null,
    val unrealisedCents: Long? = null,
    val unrealisedRatio: String? = null,
    val averagePrice: String? = null,
)

@Serializable
data class MobileHoldingDto(
    val key: String,
    val instrumentId: Long? = null,
    val kind: String,
    val code: String,
    val symbol: String,
    val name: String? = null,
    val items: Int? = null,
    val units: String,
    val priceStatus: String,
    val price: String? = null,
    val priceAsOf: String? = null,
    val valueCents: Long? = null,
    val weightRatio: String? = null,
    val dayStatus: String,
    val previousClose: String? = null,
    val changePerUnit: String? = null,
    val dayRatio: String? = null,
    val dayCents: Long? = null,
    val newUnits: String = "0",
    val native: NativeDto? = null,
    val session: SessionDto? = null,
    val line: MobileLineDto? = null,
    val position: PositionDto = PositionDto(),
) {
    val isBullion: Boolean get() = kind == KIND_BULLION
    val isOk: Boolean get() = dayStatus == DAY_OK

    companion object {
        const val KIND_BULLION = "bullion"
        const val KIND_FUND = "managed_fund"
        const val KIND_CRYPTO = "crypto"
        const val DAY_OK = "ok"
        const val DAY_NO_BASE = "no_base"
        const val DAY_MANUAL = "manual"
        const val DAY_STALE = "stale"
        const val DAY_UNPRICED = "unpriced"
    }
}

@Serializable
data class MobilePortfolioLineDto(
    val from: String,
    val to: String,
    val sessionDate: String,
    @Serializable(with = CentsPointsSerializer::class) val points: List<CentsPoint> = emptyList(),
)

@Serializable
data class MarketDto(val asx: String, val asxSessionDate: String? = null)

@Serializable
data class FreshnessDto(
    val latestPriceAt: String? = null,
    val oldestPriceAt: String? = null,
    val lastFetchAt: String? = null,
    val stale: Int = 0,
    val failed: Int = 0,
    val manual: Int = 0,
    val unpriced: Int = 0,
)

@Serializable
data class TotalsDto(
    val valueCents: Long,
    val dayCents: Long? = null,
    val dayRatio: String? = null,
    val up: Int = 0,
    val down: Int = 0,
    val flat: Int = 0,
    val noChange: Int = 0,
    val holdings: Int = 0,
)

@Serializable
data class MobileTodayResponse(
    val apiVersion: Int,
    val serverVersion: String,
    val generatedAt: String,
    val timeZone: String,
    val localDate: String,
    val market: MarketDto,
    val freshness: FreshnessDto,
    val totals: TotalsDto,
    val portfolioLine: MobilePortfolioLineDto? = null,
    val holdings: List<MobileHoldingDto> = emptyList(),
)

@Serializable
data class MobileDeviceResponse(
    val apiVersion: Int,
    val serverVersion: String,
    val deviceId: String,
    val label: String,
    val pairedAt: String,
    val timeZone: String,
)

@Serializable
data class MobilePairRequest(
    val code: String,
    val deviceName: String? = null,
    val appVersion: String? = null,
)

@Serializable
data class MobilePairResponse(
    val apiVersion: Int,
    val serverVersion: String,
    val deviceId: String,
    val label: String,
    val key: String,
) {
    // The key never reaches a log through toString().
    override fun toString(): String = "MobilePairResponse(deviceId=$deviceId, label=$label)"
}

@Serializable
data class ApiErrorBody(val error: ApiErrorDetail)

@Serializable
data class ApiErrorDetail(val code: String, val message: String? = null)

/** `[[unixSeconds, "decimal"], …]` ↔ `List<Pair<Long, String>>`. */
@OptIn(ExperimentalSerializationApi::class)
object PricePointsSerializer : KSerializer<List<PricePoint>> {
    override val descriptor: SerialDescriptor = listSerialDescriptor(JsonElement.serializer().descriptor)

    override fun deserialize(decoder: Decoder): List<PricePoint> {
        val input = decoder as? JsonDecoder ?: throw SerializationException("JSON only")
        return input.decodeJsonElement().jsonArray.map { item ->
            val pair = item.jsonArray
            if (pair.size != 2) throw SerializationException("A point has two parts")
            val t = pair[0].jsonPrimitive.longOrNull ?: throw SerializationException("A point's time is an integer")
            val p = pair[1].jsonPrimitive.contentOrNull ?: throw SerializationException("A point's price is a string")
            t to p
        }
    }

    override fun serialize(encoder: Encoder, value: List<PricePoint>) {
        val output = encoder as? JsonEncoder ?: throw SerializationException("JSON only")
        output.encodeJsonElement(JsonArray(value.map { (t, p) -> JsonArray(listOf(JsonPrimitive(t), JsonPrimitive(p))) }))
    }
}

/** `[[unixSeconds, cents], …]` ↔ `List<Pair<Long, Long>>`. */
@OptIn(ExperimentalSerializationApi::class)
object CentsPointsSerializer : KSerializer<List<CentsPoint>> {
    override val descriptor: SerialDescriptor = listSerialDescriptor(JsonElement.serializer().descriptor)

    override fun deserialize(decoder: Decoder): List<CentsPoint> {
        val input = decoder as? JsonDecoder ?: throw SerializationException("JSON only")
        return input.decodeJsonElement().jsonArray.map { item ->
            val pair = item.jsonArray
            if (pair.size != 2) throw SerializationException("A point has two parts")
            val t = pair[0].jsonPrimitive.longOrNull ?: throw SerializationException("A point's time is an integer")
            val c = pair[1].jsonPrimitive.longOrNull ?: throw SerializationException("A point's cents are an integer")
            t to c
        }
    }

    override fun serialize(encoder: Encoder, value: List<CentsPoint>) {
        val output = encoder as? JsonEncoder ?: throw SerializationException("JSON only")
        output.encodeJsonElement(JsonArray(value.map { (t, c) -> JsonArray(listOf(JsonPrimitive(t), JsonPrimitive(c))) }))
    }
}
