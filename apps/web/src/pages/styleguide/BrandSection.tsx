// Style guide: brand (STYLE_GUIDE §7). Generic sample data only.
import {
  BRAND_SCREEN_VARIANTS,
  BrandBlock,
  Card,
  Grid,
  GridItem,
  HeroBand,
  Icon,
  KeyValueTable,
  MilestoneLine,
  SectionBar,
  StatTile,
  WORDMARK_ASPECT,
  Wordmark,
  formatMoney,
  formatMonth,
  formatPercent,
} from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { Maximize2 } from 'lucide-react';
import type { CSSProperties, JSX, ReactNode } from 'react';
import { BrandScreenSample } from '../ScreenPreviewPage';
import { GalleryItem } from './GalleryItem';

/** The source raster (apps/web/public, a copy of reference/brand/joinr_wordmark.png). */
const WORDMARK_PNG = '/brand/joinr-wordmark.png';
/** The PNG canvas (px) and where the SVG's tight viewBox starts inside it (from the trace). */
const PNG_SIZE = { width: 228, height: 103 } as const;
const PNG_INK_OFFSET = { x: 7.08, y: 7.86 } as const;
const INK_HEIGHT = 87.46;

/** The source PNG scaled and cropped so its letters line up with a `<Wordmark height={h}>`. */
function SourcePng({
  height,
  overlay = false,
}: {
  height: number;
  overlay?: boolean;
}): JSX.Element {
  const scale = height / INK_HEIGHT;
  const frame: CSSProperties = {
    display: 'block',
    width: `${(height * WORDMARK_ASPECT).toFixed(2)}px`,
    height: `${height}px`,
    overflow: 'hidden',
    ...(overlay ? { position: 'absolute', inset: 0 } : null),
  };
  const img: CSSProperties = {
    display: 'block',
    maxWidth: 'none',
    width: `${(PNG_SIZE.width * scale).toFixed(2)}px`,
    height: `${(PNG_SIZE.height * scale).toFixed(2)}px`,
    margin: `${(-PNG_INK_OFFSET.y * scale).toFixed(2)}px 0 0 ${(-PNG_INK_OFFSET.x * scale).toFixed(2)}px`,
  };
  return (
    <span style={frame}>
      <img src={WORDMARK_PNG} alt={overlay ? '' : 'joinr (source PNG)'} style={img} />
    </span>
  );
}

/** Holds an exhibit at a fixed height so the cards in a row line up; content sits on the bottom. */
function Specimen({ height, children }: { height: number; children: ReactNode }): JSX.Element {
  return (
    <span style={{ display: 'flex', alignItems: 'flex-end', minHeight: `${height}px` }}>
      {children}
    </span>
  );
}

function WordmarkComparison({ height, label }: { height: number; label: string }): JSX.Element {
  return (
    <Grid>
      <GridItem span={6}>
        <Card title={`SVG master · ${label}`}>
          <Wordmark height={height} />
        </Card>
      </GridItem>
      <GridItem span={6}>
        <Card title={`Source PNG · ${label}`}>
          <SourcePng height={height} />
        </Card>
      </GridItem>
    </Grid>
  );
}

const TRACE_FACTS = [
  { label: 'Master file', value: 'reference/brand/joinr_wordmark.svg' },
  { label: 'Fidelity vs PNG', value: 'IoU 0.994 · 48 of 23,484 px differ' },
  { label: 'Geometry', value: '5 letter paths + 1 circle, 213.55 × 87.46 viewBox' },
  { label: 'Full stop', value: 'True circle, #6E78E2 → #E44FB5 at 45°' },
];

/**
 * Sample milestones for the MilestoneLine demo (the generic hand-worked example of stage-6.md
 * §10.1): colours by position in the fixed spectrum order, never by kind.
 */
const MILESTONES = [
  { key: 'today', tone: 'teal', position: 0, label: 'Today', sublabel: '2030 · 55' },
  { key: 'fire', tone: 'violet', position: 0.2, label: 'FIRE', sublabel: '2031 · 56' },
  { key: 'topUpsEnd', tone: 'fuchsia', position: 0.8, label: 'Top-ups end', sublabel: '2034 · 59' },
  { key: 'access', tone: 'orange', position: 1, label: 'Access', sublabel: '2035 · 60' },
] as const;

const MILESTONE_SEGMENTS = [
  { from: 0, to: 0.2, label: 'Saving' },
  { from: 0.2, to: 0.8, label: 'Drawing down, topping up super' },
  { from: 0.8, to: 1, label: 'Drawing down' },
];

/** Sample KPI tiles for the hero demos (generic figures only). */
function SampleTiles(): JSX.Element {
  return (
    <Grid>
      <GridItem span={3} spanTablet={3}>
        <StatTile
          label="Net worth"
          value={formatMoney(1_248_000, { wholeDollars: true })}
          keyFigure
        />
      </GridItem>
      <GridItem span={3} spanTablet={3}>
        <StatTile
          label="Change"
          value={formatMoney(124_000, { wholeDollars: true, signDisplay: 'always' })}
          delta={{
            value: formatPercent(0.11, { signDisplay: 'always' }),
            direction: 'up',
            text: 'up since last month',
          }}
        />
      </GridItem>
      <GridItem span={3} spanTablet={3}>
        <StatTile label="Savings rate" value={formatPercent(0.074)} />
      </GridItem>
      <GridItem span={3} spanTablet={3}>
        <StatTile label="Last snapshot" value={formatMonth('2026-08')} />
      </GridItem>
    </Grid>
  );
}

export function BrandSection(): JSX.Element {
  return (
    <section id="brand" className="jf-app-styleguide__section" aria-labelledby="brand-title">
      <SectionBar id="brand-title" title="Brand" role="reference" />

      <GalleryItem name="Wordmark" note="SVG master (D12) at 24 / 32 / 48 px, then beside the PNG">
        <Grid>
          {[24, 32, 48].map((height) => (
            <GridItem key={height} span={4}>
              <Card title={`${height} px`}>
                <Specimen height={48}>
                  <Wordmark height={height} />
                </Specimen>
              </Card>
            </GridItem>
          ))}
          <GridItem span={12}>
            <WordmarkComparison height={120} label="120 px" />
          </GridItem>
          <GridItem span={12}>
            <WordmarkComparison height={32} label="32 px" />
          </GridItem>
          <GridItem span={6}>
            <Card title="Overlay · SVG at 50% over the PNG">
              <span
                style={{
                  position: 'relative',
                  display: 'block',
                  width: `${(120 * WORDMARK_ASPECT).toFixed(2)}px`,
                  height: '120px',
                }}
              >
                <SourcePng height={120} overlay />
                <span aria-hidden="true" style={{ position: 'absolute', inset: 0, opacity: 0.5 }}>
                  <Wordmark height={120} title="joinr (SVG overlay)" />
                </span>
              </span>
            </Card>
          </GridItem>
          <GridItem span={6}>
            <KeyValueTable caption="Wordmark trace" items={TRACE_FACTS} />
          </GridItem>
        </Grid>
      </GalleryItem>

      <GalleryItem
        name="BrandBlock"
        note="Lockup: sm 24 px, md 32 px (header), lg 48 px (brand screens)"
      >
        <Grid>
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <GridItem key={size} span={4}>
              <Card title={size === 'md' ? 'md (header)' : size}>
                <Specimen height={48}>
                  <BrandBlock size={size} />
                </Specimen>
              </Card>
            </GridItem>
          ))}
        </Grid>
      </GalleryItem>

      <GalleryItem
        name="HeroBand"
        note="CSS recreation of the banner; KPI cards sit below the node line"
      >
        <Grid>
          <GridItem span={12}>
            <HeroBand ariaLabel="Hero band demo (sample figures)">
              <SampleTiles />
            </HeroBand>
          </GridItem>
          <GridItem span={6}>
            <Card title="Regular · 180 px · with wordmark">
              <HeroBand showWordmark />
            </Card>
          </GridItem>
          <GridItem span={6}>
            <Card title="Compact · 140 px · with wordmark">
              <HeroBand height="compact" showWordmark />
            </Card>
          </GridItem>
        </Grid>
      </GalleryItem>

      <GalleryItem
        name="MilestoneLine"
        note="The node-line motif as data (FIRE): 10 px dots in spectrum order by position, no glow; vertical below 768 px of its container"
      >
        <Grid>
          <GridItem span={12}>
            <Card title="Horizontal">
              <MilestoneLine
                ariaLabel="Example milestones: today, FIRE, top-ups end, access"
                nodes={[...MILESTONES]}
                segments={MILESTONE_SEGMENTS}
                orientation="horizontal"
              />
            </Card>
          </GridItem>
          <GridItem span={4} spanTablet={6}>
            <Card title="Auto (a narrow container)">
              <MilestoneLine
                ariaLabel="Example milestones in a narrow container"
                nodes={[...MILESTONES]}
                segments={MILESTONE_SEGMENTS}
              />
            </Card>
          </GridItem>
        </Grid>
      </GalleryItem>

      {BRAND_SCREEN_VARIANTS.map((variant) => (
        <GalleryItem
          key={variant}
          name={`BrandScreen/${variant}`}
          note="Contained preview; open it to see the full viewport"
        >
          <BrandScreenSample variant={variant} fullViewport={false} headingLevel={3} />
          <Link to="/preview/screen/$variant" params={{ variant }} className="jf-brand-link">
            <Icon icon={Maximize2} />
            Open full screen
          </Link>
        </GalleryItem>
      ))}
    </section>
  );
}
