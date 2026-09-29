# Joinr Finance — app style guide

The app's visual system combines **two brand sources**:

| Source | Governs | File (local) |
|---|---|---|
| **A. Document style guide** (TH Cabinets / Joinr, v1.0, Aug 2026, dark theme) | Everything functional: colour tokens and discipline, typography, spacing, components, numbers | `reference/joinr_style_guide.pdf` / `.txt` (git-ignored; contains the business record) |
| **B. Joinr brand banner** | Brand moments only: logo/wordmark, header brand block, hero bands, login/empty/loading screens | `reference/brand/joinr_banner.webp`, `reference/brand/joinr_wordmark.png` |

If A and B conflict, **A wins inside components and data displays**, and **B wins inside brand moments**.

**Owner overrides** of source A:
- Icons are allowed.
- Donut charts and a full categorical chart palette are allowed.
- The lockup is the Joinr wordmark, not "TH CABINETS".
- There is no ABN or company footer line.

---

## 1. Colour tokens (source A, p.5)

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#101019` | Page background (≈70% of the screen) |
| `--surface` | `#191A24` | Cards, callouts, KV value column |
| `--raised` | `#262735` | Section bars, table headers, KV label column |
| `--hairline` | `#24252F` | Row dividers, frames, header/footer rules |
| `--text-bright` | `#FFFFFF` | Headings, total rows |
| `--text` | `#D3D4DC` | Body, table cells |
| `--text-secondary` | `#9A9BA8` | Labels, table headers |
| `--text-muted` | `#838494` | Footer, placeholders. Lightened from `#6F7080` at the Stage 0 demo (D19) to meet 4.5:1: 5.1:1 on ink, 4.7:1 on surface |
| `--teal` | `#17C8A0` | **The working accent**: sub-headings, small-caps labels, left borders, links, key figures |
| `--violet` | `#8B5CF6` | Step discs, section-bar coding (reference), charts |
| `--fuchsia` | `#D946EF` | Step-disc gradient partner, charts |
| `--orange` | `#F97316` | Caution status, primary section bars, charts |
| `--go` | `#22C55E` | Gain / pass / start |
| `--stop` | `#EF4444` | Loss / fail / stop |
| `--pill-na` | `#2E2F3C` | "Not applicable" pill |
| Tints for small coloured text on ink | `#6EE7C9` teal · `#A855F7` violet · `#FB923C` orange · `#4ADE80` green · `#F87171` red (`--stop-tint`, added in the Stage 0 fixes: negatives, errors, stop/failed badge text) | Full-strength brand colours fail contrast as small text. Borders, bars and chart marks keep the full-strength colour. |

**Spectrum rule:** `linear-gradient(90deg, #17C8A0 0%, #8B5CF6 30%, #D946EF 55%, #F97316 100%)`, 4 px deep, full width, at the top of the viewport and at the bottom of the footer. It never appears on text, headings, buttons or table headers.

**One-accent rule:** on any page, teal is the only accent. Violet, fuchsia and orange appear only in the spectrum rule, the logo, status, section-bar coding, charts (override) and step discs. Don't give each section its own colour "for variety". Don't introduce colours that aren't in this table. **The one exception is charts:** the validated chart steps in §6.1 (e.g. chart teal `#07AE8B`) are allowed inside chart marks, legend keys and tooltip keys only, never on text, headings or UI chrome.

## 2. Typography (source A, p.7), converted to screen

- **Font:** `Arial, Helvetica, sans-serif` everywhere. Numbers, codes and tickers use `ui-monospace, Consolas, "Courier New", monospace` with `font-variant-numeric: tabular-nums`.
- **Weights:** 700 for headings, labels, table headers and emphasis; 400 for everything else. No italics, light or condensed weights.
- **Uppercase is always letter-spaced.**
- **Conversion:** screen px = print pt × 1.6, the same multiplier the guide uses for slides. Minimum 11 px.

| Role | px | Weight | Tracking | Colour |
|---|---|---|---|---|
| Page title (H1) | 31 | 700, uppercase | −0.005em | `--text-bright` |
| Title sub-line | 15 | 700, uppercase | 0.14em | `--teal` |
| Section bar (H2) | 16 | 700, uppercase | 0.05em | `--text-bright` |
| Card heading (H3) | 13.5 | 700, uppercase | 0.10em | `--teal` |
| Body | 14.5 / 1.5 | 400 | 0 | `--text` |
| Dense table body | 13 / 1.5 | 400 | 0 | `--text` |
| Small label / table header | 11 | 700, uppercase | 0.12–0.14em | `--text-secondary` |
| Running header | 13–14 | 700, uppercase | 0.06 / 0.16em | `--text` |
| Footer | 11 | 400 | 0 | `--text-muted` |

Body copy is at most about 70ch wide, ragged right, never justified.

## 3. Spacing, radius, grid

- **Spacing scale (4 px base ≈ 1.2 mm):** 4 inside a line · 8 between paragraphs · 12 grid gutter and card padding · 12 after a section bar · 16 between blocks · 24 after a page title.
- **Density (owner override D109):** the app is information-dense. Table cells are 3 × 8 px (headers 6 × 8 px) at 1.35 line height, about 24 px a row; key–value rows match. Cards and stat tiles pad 12 px, callouts 8 × 12 px, section bars 6 × 12 px. From 768 px, buttons inside a table are 22 px high and stacked figures in a cell sit without a gap. Charts default to a responsive height: a quarter of their width, 260–340 px (D136). Density never costs a sideways page scroll, and on a phone buttons keep 28 px or more.
- **Radius:** 6 px cards and tables · 5 px callouts and section bars · pills fully round.
- **Borders:** hairline 1 px `--hairline`; accent border 4 px.
- **Grid:**
  - Desktop: 12 columns (the guide's landscape rule), 12 px gutters. Blocks span 12, 6, 4, 3 or 2 columns; never off-grid widths.
  - Tablet: 6 columns.
  - Phone: 1 column, 16 px side gutters, **no horizontal page scroll**. Wide tables scroll inside their own container, with the first column sticky.
- **Depth** comes from surface steps (ink → surface → raised), never from shadows or glows. The one exception is brand moments (§7).

## 4. App shell (the source A "page furniture", adapted)

- **Spectrum rule** at the top edge of the viewport and the bottom edge of the footer.
- **Running header:** brand block on the left (§7.2); current page name on the right, uppercase at 0.16em; hairline beneath. It carries the data freshness indicator ("Prices 14:32 · Snapshot Aug 2026") in `--text-secondary`.
- **Sidebar nav:** on `--ink`, with active item text in `--text-bright` and a 4 px teal left border. Groups: Overview (Net Worth, History) · Investments (Stocks, ETFs, Managed Funds, Crypto) · Cash flow (Cash, Side Income, Dividends, Budget) · Assets (Other Assets, Super, Property) · Planning (FIRE) · Settings. On phone it collapses to a drawer.
- **Footer:** "Joinr Finance" plus the version on the left; last snapshot and price refresh time on the right; hairline above. **No ABN or company line.**

## 5. Components (source A, pp.9–10)

- **Section bar:** `--raised` fill, 4 px left accent border, radius 5, padding 8×16, H2 uppercase white. Colour coding is fixed per role, never alternated for effect: **orange** = primary page sections, **teal** = supporting sections, **violet** = reference/appendix (e.g. settings, raw data).
- **Callout:** `--surface`, 4 px left border, radius 5. The heading is uppercase in the accent tint. Types: **Note** (teal: context), **Important** (orange: money/deadline at stake, stale prices), **Do not** (red: destructive actions, data-loss warnings). Use them sparingly.
- **Key–value table:** label column `--raised` (11 px bold uppercase `--text-secondary`); value column `--surface`. Both columns size to their content, so the table is only as wide as its longest label and value (D136). Hairlines between rows only; no vertical rules and no outer border; outer corners rounded. **Values are left-aligned in every row, numbers included** (Stage 6, STYLE-7): numbers stay monospaced with tabular figures, so phrase rows and number rows share one edge. Below 480 px of its own width the table stacks each label above its value.
- **Column table:** header `--raised` with 11 px bold uppercase labels; cells `--surface`; hairline row dividers. Numeric columns are right-aligned and monospaced. **Tables fit their content** (D136): a table is as wide as its columns need, up to its box, never stretched to fill a card; a multi-word header wraps at its spaces only when the table would otherwise be wider than its box. **The total row is the only row with white bold text, and the total figure is the only teal cell.**
- **Stat tile / KPI** (app addition, built from the same parts): `--surface` card, uppercase label, monospaced figure in `--text-bright`. Use teal only for the page's single key figure. Deltas use `--go`/`--stop` tints **plus** a sign or arrow and a word.
- **Status badge:** 16% fill of the accent, 1 px border at full strength, light-tint text, 12 px bold uppercase at 0.08em. Only for real states: go / check / stop, fresh / stale / failed, recorded / pending.
- **Pill:** fully round, 1 px border, no fill, 11 px. Teal by default; violet/fuchsia only for real categories; `--pill-na` for not-applicable.
- **Numbered step card:** a 28 px disc filled with `linear-gradient(135deg,#8B5CF6,#D946EF)` and a white bold numeral. Uppercase white title, sub-line in `#A855F7`. This is the only use of the violet–fuchsia gradient inside the UI.
- **Image frame:** 1 px `--hairline` frame, radius 6, full or half width.
- **Forms** (app addition): inputs on `--surface` with a 1 px `--hairline` border and a teal focus ring; uppercase labels above fields; monospaced numeric inputs, right-aligned.

## 6. Charts (owner override D6)

- **Allowed:** donut (allocation current vs target), bar, stacked bar, line, area, gauge (savings rate). **Not allowed:** pies without a hole, 3-D, drop shadows.

### 6.1 Categorical palette (validated in Stage 0; `CHART_PALETTE` in `@joinr/ui`)

| Slot | Hex | Family (§1) | OKLCH L | Contrast on `--surface` / `--ink` |
|---|---|---|---|---|
| 1 | `#07AE8B` | teal | 0.67 | 6.1 / 6.7 |
| 2 | `#7744DD` | violet | 0.53 | 3.0 / 3.3 |
| 3 | `#EB6903` | orange | 0.67 | 5.4 / 5.9 |
| 4 | `#D946EF` | fuchsia (unchanged) | 0.67 | 5.0 / 5.5 |
| 5 | `#C56703` | orange tint (amber) | 0.61 | 4.4 / 4.8 |
| 6 | `#B268FF` | violet tint (purple) | 0.67 | 5.2 / 5.7 |
| 7 | `#07B25A` | green tint | 0.67 | 6.2 / 6.8 |
| 8 | `#007E68` | teal tint (deep teal) | 0.53 | 3.5 / 3.8 |
| Other | `#838494` | `--text-muted` | — | 4.7 / 5.1 |

- **Validator result** (`dataviz` `validate_palette.js`, dark mode, adjacent pairs, run against `--surface` and against `--ink`): **all checks pass.** Lightness band 0.48–0.67 ✓, chroma ≥ 0.10 ✓, worst adjacent CVD ΔE 16.0 (deuteranopia, slots 7↔8; target ≥ 8) ✓, worst adjacent normal-vision ΔE 16.8 (floor 15) ✓, every slot ≥ 3:1 ✓. The first three slots also pass **all pairs** (worst CVD ΔE 13.4), and the donut's wrap pair (slot *n* next to slot 1, *n* = 3–6) passes (worst CVD ΔE 12.7).
- **Why it changed.** The draft order (`#17C8A0` `#8B5CF6` `#D946EF` `#F97316` `#6EE7C9` `#A855F7` `#FB923C` `#4ADE80` `#9A9BA8` `#6F7080`) failed: teal, orange and all four tints are too light for a dark chart (OKLCH L > 0.67); the two greys read as grey (chroma < 0.10); and violet next to fuchsia collapses under protanopia (ΔE 1.3). Each slot was re-stepped **within its own family** (same hue, new lightness) and the order was chosen by search to maximise the worst neighbour pair. Fuchsia keeps its exact brand hex. Violet is the darkest step that still holds 3:1.
- **Known limit.** Violet (2) and fuchsia (4) are only ΔE 6.4 apart under protanopia. They are never neighbours, and every chart has a legend and a table view.
- **Rules.**
  - Slots are assigned in order and **never cycled**. A ninth series is drawn in "Other" grey, and a donut shows at most six slices (the rest fold into "Other"). **Exception (D93):** the Net Worth asset-distribution donut shows every positive asset class (up to eight slices, no fold), with the class colours of the stacked net-worth charts.
  - **Colour follows the entity**: a filter never repaints the survivors, and a donut's target ring uses the same colour as its current slice.
  - **Single-series charts use slot 1** (the chart teal `#07AE8B`, the in-band step of `--teal`). Gain/loss uses `--go`/`--stop` **plus a sign and a word**, and is never mixed with categorical colours in one chart.
  - Re-run the validator before changing any slot. `palette.test.ts` re-checks contrast, band, chroma and the neighbour and wrap pairs.

### 6.2 Marks and chrome
- **Bars** ≤ 24 px, with a 4 px rounded data end and a square baseline. Stacked segments are split by a 2 px `--surface` gap, and only the outermost segment is rounded.
- **Lines** are 2 px with round joins. Markers are 8 px with a 2 px `--surface` ring, shown on hover. Area fills are a 14 % wash of the line's hue.
- **Donut:** the outer ring is current and the thin inner ring is target, with a small pad gap between slices. The centre figure is monospaced in `--text-bright`, over an uppercase label.
- **Gauge:** a teal arc on a 16 % teal track, with the target as a white tick across the track. Out-of-range values clamp the arc, but the figure always shows the true value (e.g. `−2.1%`).
- **Axes and gridlines** are solid `--hairline`. Axis labels are 12 px `--text-secondary` (D136), monospaced on value axes.
- **Tooltips** sit on `--raised` with a hairline border and no shadow. The value leads (mono, white) and the name follows. Lines use a crosshair that lists every series; bars and slices use a per-mark tooltip.
- **Legend:** HTML above the plot, so it wraps on a phone. Text is in text tokens; the colour sits only in the key (a swatch for bars and slices, a stroke for lines). A legend is always shown for two or more series, and never for one.
- **States:** *empty* keeps the chart's footprint and shows a plain message. *Loading* shows a status line and spinner; a page's first load shows a `PageSkeleton` of `Skeleton` blocks (`--surface`, a gentle opacity pulse, none under reduced motion) in the page's layout. A *refresh* dims the previous render instead of flashing a skeleton. Animation is off under `prefers-reduced-motion`.
- A chart never replaces the numbers: every chart sits in a `ChartCard` with a Chart | Table toggle (or next to a column table).

## 7. Brand moments (source B — the Joinr banner)

### 7.1 Banner anatomy
Colours sampled from `joinr_banner.webp` (2000×563):

| Element | Description | Colour |
|---|---|---|
| Ground | Near-ink, darkening towards the bottom-left | `#13141D` top → `#10111A` middle → `#0C0D16` bottom-left |
| Dot grid | Very faint dot matrix across the centre band, fading out at the edges | ≈ `#1E1F28` at low opacity |
| Node line | A thin horizontal hairline at ~39% height, with faint vertical guides through each node | `#1E1F28` |
| Four nodes | Small dots with soft glows, left to right, at x ≈ 25% / 50% / 69% / 87.5%: teal, violet, fuchsia, orange | `#17C8A0` · `#8B5CF6` · `#D946EF` · `#F97316` (rendered ≈ `#35BFA5 #8E5DF0 #D548EA #E87C33`) |
| Bottom glow | A broad soft radial glow along the bottom edge, strongest centre-right; violet/magenta with a hint of orange at the far right | ≈ `#291636` at its peak |
| Wordmark | "joinr." in lowercase, a bold rounded geometric sans, white; the full stop is a gradient disc violet → fuchsia. Anchored bottom-right. | `#FFFFFF`; dot `#6E78E2 → #E44FB5`, blue-violet top-left to pink bottom-right (the banner reading, D16) |

### 7.2 Usage in the app
- **Brand block (header/sidebar top):** the wordmark, with **FINANCE** set beside it in `--teal`, 11 px bold uppercase at 0.16em. This replaces the typed "TH CABINETS" lockup (D4, confirmed D13).
  - Minimum wordmark height is 24 px. Keep clear space of 0.4 × the wordmark height on every side.
  - Only ever on dark ground. No recolouring, stretching or effects.
- **Hero band:** a CSS recreation of the banner (ground gradient, dot grid, node line with four glowing nodes, bottom glow), not the raster image. Used at the top of the **Net Worth dashboard** (140–200 px tall on desktop; below 1200 px it grows to fit its stacked KPI tiles, D18; KPI figures sit on `--surface` cards), and as the full background of **login, empty, loading and error** screens.
  - Text never sits directly on the glow; use a surface card.
- **Node-line motif:** may mark milestones on a timeline, e.g. FIRE progression (the `MilestoneLine` component and the progression chart's markers, D101), or snapshot months on the History page. The nodes keep the fixed spectrum order, **coloured by position, not meaning**: the 1st node is teal, the 2nd violet, the 3rd fuchsia, the 4th orange. Milestones in the same year share one node. Inside a chart the node dots are flat (no glow) and sit in a lane above the plot.
- **Glows** (soft `box-shadow`/`radial-gradient` blooms) are allowed **only** in these brand treatments. Never on cards, buttons, tables or charts.
- **Wordmark asset:** the SVG master `reference/brand/joinr_wordmark.svg`, hand-traced from the PNG in Stage 0 (D12; IoU 0.99 against it). The `Wordmark` component inlines the same geometry, and a test keeps the two in sync. `reference/brand/joinr_wordmark.png` (228×103, cut from the banner) remains as the reference. Dark backgrounds only. Never rebuild the wordmark in another font.

## 8. Numbers, dates, text

- **Currency:** `$12,480.00`. Tables and ledgers always show two decimals. KPI tiles may round to whole dollars (`$12,480`). Negatives show as `−$1,234.00` in the `--stop` tint.
- **Percentages:** one decimal (`7.4%`). Units and quantities: up to 4 dp (crypto 8), monospaced.
- **Dates:** `18/08/2026` in tables and forms, `18 August 2026` in prose, `Aug 2026` for snapshot months. Financial years are written `FY2026–27`.
- **Status is never colour-only:** always a word, sign or icon as well (greyscale and colour-blind survivability).
- **Tone:** plain, specific and committed, e.g. "Prices are 2 days old", not "Data may be outdated".

## 9. Icons (owner override D7)

`lucide-react`, 16 px inline or 20 px in the nav, stroke 1.75, `--text-secondary` (teal when active). An icon always sits beside a text label; never an icon alone for a primary action, except in a compact toolbar with a tooltip.

## 10. Checklist before a UI change ships

- Teal is the only accent on the page; the spectrum appears only in the rules, the logo and brand moments.
- All uppercase text is letter-spaced; numbers are monospaced and right-aligned (except key–value table values, which are left-aligned, §5).
- No shadows or glows outside brand moments; no colours outside §1 (except the §6.1 chart steps, inside charts only).
- It works at 375 px wide with no horizontal page scroll.
- Status is readable in greyscale.
