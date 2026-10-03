package com.tenon.joinrfinance.ui

import com.tenon.joinrfinance.Fixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.math.abs

/**
 * The wordmark and the launcher icon come from the SVG master `reference/brand/joinr_wordmark.svg` (read from the repo
 * at test time; plan sections 9.1, 9.7 and 9.13): the five `d` strings exactly, the dot's centre and radius, the
 * gradient resolved to absolute coordinates and its colours.
 */
class BrandAssetsTest {
    private val root = Fixtures.repoRoot()
    private val res = File(root, "apps/android/app/src/main/res")

    private fun parse(f: File) = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(f)

    private fun elements(doc: org.w3c.dom.Document, tag: String): List<Element> {
        val nodes = doc.getElementsByTagName(tag)
        return (0 until nodes.length).map { nodes.item(it) as Element }
    }

    private val androidNs = "http://schemas.android.com/apk/res/android"
    private val svg = parse(File(root, "reference/brand/joinr_wordmark.svg"))
    private val svgPaths = elements(svg, "path").map { it.getAttribute("d") }
    private val circle = elements(svg, "circle").single()
    private val cx = circle.getAttribute("cx").toDouble()
    private val cy = circle.getAttribute("cy").toDouble()
    private val r = circle.getAttribute("r").toDouble()
    private val gradient = elements(svg, "linearGradient").single()
    private val stops = elements(svg, "stop").map { it.getAttribute("stop-color").uppercase() }

    /** The dot as an arc path: `M x0,y a r,r 0 1,0 2r,0 a r,r 0 1,0 -2r,0` → centre and radius. */
    private fun dotOf(d: String): Triple<Double, Double, Double> {
        val m = Regex("^M([0-9.]+),([0-9.]+) a([0-9.]+),([0-9.]+) 0 1,0 ([0-9.]+),0 a([0-9.]+),([0-9.]+) 0 1,0 -([0-9.]+),0$").matchEntire(d)
            ?: error("not the dot's arc path: $d")
        val x0 = m.groupValues[1].toDouble()
        val rr = m.groupValues[3].toDouble()
        assertEquals(2 * rr, m.groupValues[5].toDouble(), 1e-9)
        return Triple(x0 + rr, m.groupValues[2].toDouble(), rr)
    }

    private fun checkGradient(g: Element) {
        // objectBoundingBox fractions resolved against the circle's box.
        val box = cx - r
        val boxY = cy - r
        fun abs(frac: String, origin: Double) = origin + frac.toDouble() * 2 * r
        assertEquals(abs(gradient.getAttribute("x1"), box), g.getAttributeNS(androidNs, "startX").toDouble(), 0.006)
        assertEquals(abs(gradient.getAttribute("y1"), boxY), g.getAttributeNS(androidNs, "startY").toDouble(), 0.006)
        assertEquals(abs(gradient.getAttribute("x2"), box), g.getAttributeNS(androidNs, "endX").toDouble(), 0.006)
        assertEquals(abs(gradient.getAttribute("y2"), boxY), g.getAttributeNS(androidNs, "endY").toDouble(), 0.006)
        assertEquals("#FF" + stops[0].removePrefix("#"), g.getAttributeNS(androidNs, "startColor").uppercase())
        assertEquals("#FF" + stops[1].removePrefix("#"), g.getAttributeNS(androidNs, "endColor").uppercase())
    }

    @Test
    fun wordmarkDrawableCopiesTheSvgGeometry() {
        val doc = parse(File(res, "drawable/joinr_wordmark.xml"))
        val vector = doc.documentElement
        assertEquals("213.55", vector.getAttributeNS(androidNs, "viewportWidth"))
        assertEquals("87.46", vector.getAttributeNS(androidNs, "viewportHeight"))
        assertEquals("24dp", vector.getAttributeNS(androidNs, "height"))
        val paths = elements(doc, "path").map { it.getAttributeNS(androidNs, "pathData") }
        assertEquals(6, paths.size)
        assertEquals(5, svgPaths.size)
        assertEquals("the five letters, exactly", svgPaths, paths.take(5))
        val (x, y, rr) = dotOf(paths[5])
        assertTrue(abs(x - cx) < 1e-9 && abs(y - cy) < 1e-9 && abs(rr - r) < 1e-9)
        checkGradient(elements(doc, "gradient").single())
        elements(doc, "path").take(5).forEach { assertEquals("#FFFFFFFF", it.getAttributeNS(androidNs, "fillColor")) }
    }

    @Test
    fun launcherIconUsesTheSvgGeometry() {
        for (name in listOf("ic_launcher_foreground", "ic_launcher_monochrome")) {
            val doc = parse(File(res, "drawable/$name.xml"))
            val paths = elements(doc, "path").map { it.getAttributeNS(androidNs, "pathData") }
            assertEquals(name, svgPaths[0], paths[0]) // the j, letter and tittle
            val (x, y, rr) = dotOf(paths[1])
            assertTrue(name, abs(x - cx) < 1e-9 && abs(y - cy) < 1e-9 && abs(rr - r) < 1e-9)
            if (name.endsWith("foreground")) checkGradient(elements(doc, "gradient").single())
        }
        val adaptive = parse(File(res, "mipmap-anydpi/ic_launcher.xml"))
        assertEquals(1, elements(adaptive, "monochrome").size)
        assertEquals("@color/ink", elements(adaptive, "background").single().getAttributeNS(androidNs, "drawable"))
    }

    /** The scaled icon (j plus the moved dot) fits the 66 dp safe zone of the 108 dp canvas. */
    @Test
    fun launcherIconFitsTheSafeZone() {
        val doc = parse(File(res, "drawable/ic_launcher_foreground.xml"))
        val g = elements(doc, "group").first()
        val s = g.getAttributeNS(androidNs, "scaleX").toDouble()
        val tx = g.getAttributeNS(androidNs, "translateX").toDouble()
        val ty = g.getAttributeNS(androidNs, "translateY").toDouble()
        // Bounds: the j (x 0…36.11, y 0…87.45) and the dot moved beside it (to x ≤ 60.51).
        val corners = listOf(0.0 to 0.0, 60.51 to 0.0, 0.0 to 87.45, 60.51 to 87.45).map { (x, y) -> (tx + s * x) to (ty + s * y) }
        corners.forEach { (x, y) -> assertTrue("corner $x,$y", kotlin.math.hypot(x - 54, y - 54) <= 33.0) }
    }
}
