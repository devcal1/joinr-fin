package com.tenon.joinrfinance.model

/**
 * Sparkline and chart geometry (pure; shared by the Compose charts and the widget bitmaps).
 * The base (previous close, or 0 for the portfolio line) is always inside the vertical range.
 */
data class SparkGeometry(
    /** x in 0…width. */
    val xs: FloatArray,
    /** y in pad…height − pad (0 at the top). */
    val ys: FloatArray,
    /** y of the dashed base line, or null when there is no base. */
    val baseY: Float?,
    val width: Float,
    val height: Float,
) {
    val size: Int get() = xs.size

    override fun equals(other: Any?): Boolean = other is SparkGeometry && xs.contentEquals(other.xs) &&
        ys.contentEquals(other.ys) && baseY == other.baseY && width == other.width && height == other.height

    override fun hashCode(): Int = xs.contentHashCode() * 31 + ys.contentHashCode()
}

object Spark {
    /**
     * @param times point times (ascending; any unit)
     * @param values point values
     * @param base the dashed line's value, kept inside the range; null for none
     * @param from the window's start (default: the first time); to its end (default: the last time)
     */
    fun geometry(
        times: LongArray,
        values: DoubleArray,
        base: Double?,
        width: Float,
        height: Float,
        pad: Float,
        from: Long? = null,
        to: Long? = null,
    ): SparkGeometry {
        require(times.size == values.size) { "times and values differ in length" }
        if (times.isEmpty()) return SparkGeometry(FloatArray(0), FloatArray(0), null, width, height)
        var min = values.min()
        var max = values.max()
        if (base != null) {
            min = minOf(min, base)
            max = maxOf(max, base)
        }
        val range = max - min
        val usable = (height - 2 * pad).coerceAtLeast(0f)
        fun y(v: Double): Float = if (range == 0.0) height / 2f else (pad + ((max - v) / range) * usable).toFloat()

        if (times.size == 1) {
            // One point: a flat line across the whole width.
            val yy = y(values[0])
            return SparkGeometry(floatArrayOf(0f, width), floatArrayOf(yy, yy), base?.let(::y), width, height)
        }
        val start = from ?: times.first()
        val end = (to ?: times.last()).let { if (it <= start) start + 1 else it }
        val span = (end - start).toDouble()
        val xs = FloatArray(times.size) { i -> (((times[i] - start) / span) * width).toFloat().coerceIn(0f, width) }
        val ys = FloatArray(times.size) { i -> y(values[i]) }
        return SparkGeometry(xs, ys, base?.let(::y), width, height)
    }

    /** The index of the point nearest to x (for "drag to read"). */
    fun nearestIndex(geometry: SparkGeometry, x: Float): Int {
        if (geometry.size == 0) return -1
        var best = 0
        var bestDist = Float.MAX_VALUE
        for (i in 0 until geometry.size) {
            val d = kotlin.math.abs(geometry.xs[i] - x)
            if (d < bestDist) {
                bestDist = d
                best = i
            }
        }
        return best
    }
}
