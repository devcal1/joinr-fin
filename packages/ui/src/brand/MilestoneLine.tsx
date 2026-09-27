// The node-line motif as a data display (stage-6.md §6.5, STYLE_GUIDE §7.2): a 1 px hairline with
// 10 px dots in full-strength brand colours (no glow: this is data, not the hero), each node's
// label under the line and the segments' words above it. Horizontal, nodes are placed by
// `position` (0–1); labels of nodes closer than 64 px stack on a second row. Vertical (nodes top to
// bottom, the segments' words between them) when the orientation says so, or, with 'auto', when
// its container is narrower than 768 px (a container query in milestone.css). The visual is
// decorative (`aria-hidden`) and duplicated as a visually-hidden ordered list. A horizontal segment
// whose words do not fit its span is hidden whole (`data-fits="false"`), never clipped mid-word;
// the hidden list still carries them (triage STYLE-7).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { cx } from '../core';
import type { HeroNodeTone } from './HeroBackground';

export interface MilestoneLineNode {
  key: string;
  /** The caller passes the tones in the fixed spectrum order by position (D101). */
  tone: HeroNodeTone;
  /** 0–1 along the line. */
  position: number;
  label: string;
  sublabel?: string;
}

export interface MilestoneLineSegment {
  from: number;
  to: number;
  label: string;
}

export interface MilestoneLineProps {
  nodes: MilestoneLineNode[];
  segments?: MilestoneLineSegment[];
  /** auto: vertical when its container is narrower than 768 px (a container query). */
  orientation?: 'auto' | 'horizontal' | 'vertical';
  ariaLabel: string;
}

/** Labels of nodes closer than this (px) stack on a second row. */
export const MILESTONE_LABEL_GAP = 64;
/** The width assumed before the line has been measured (and where layout is unavailable). */
export const MILESTONE_ASSUMED_WIDTH = 640;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * The label row of each node (in the given order), 0 or 1: a node within `gap` px of the previous
 * node on the same row moves to the other row, so neighbouring labels never collide.
 */
export function milestoneLabelRows(
  positions: readonly number[],
  widthPx: number,
  gap: number = MILESTONE_LABEL_GAP,
): (0 | 1)[] {
  const lastOnRow: [number | null, number | null] = [null, null];
  return positions.map((raw) => {
    const x = clamp01(raw) * widthPx;
    const clear = (row: 0 | 1): boolean => {
      const last = lastOnRow[row];
      return last === null || x - last >= gap;
    };
    const row: 0 | 1 = clear(0) ? 0 : clear(1) ? 1 : 0;
    lastOnRow[row] = x;
    return row;
  });
}

/** Where a node's label hangs from its dot: the ends stay inside the line. */
function labelAnchor(index: number, count: number): 'start' | 'middle' | 'end' {
  if (index === 0) return 'start';
  if (index === count - 1 && count > 1) return 'end';
  return 'middle';
}

/** The words a screen reader hears for a node, with the phase that starts there. */
function nodeText(node: MilestoneLineNode, segment: MilestoneLineSegment | undefined): string {
  const head = node.sublabel ? `${node.label} · ${node.sublabel}` : node.label;
  return segment ? `${head}. Then: ${segment.label}` : head;
}

const segmentKey = (segment: MilestoneLineSegment): string =>
  `${segment.from}-${segment.to}-${segment.label}`;

/** Tracks the element's width (null until measured, or without ResizeObserver). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined && measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function MilestoneLine({
  nodes,
  segments = [],
  orientation = 'auto',
  ariaLabel,
}: MilestoneLineProps): JSX.Element {
  const { ref, width } = useWidth<HTMLDivElement>();
  const rows = milestoneLabelRows(
    nodes.map((n) => n.position),
    width ?? MILESTONE_ASSUMED_WIDTH,
  );
  const stacked = rows.some((row) => row === 1);
  // The vertical order interleaves each node with the segment that starts at it.
  const sortedSegments = [...segments].sort((a, b) => a.from - b.from);
  const segmentAt = (position: number): MilestoneLineSegment | undefined =>
    sortedSegments.find((s) => Math.abs(s.from - position) < 1e-9);
  const segmentOrder = (segment: MilestoneLineSegment): number => {
    const before = nodes.filter((n) => n.position <= segment.from + 1e-9).length;
    return Math.max(0, before) * 2 - 1;
  };

  // Horizontal segments whose words overflow their span: hidden whole, measured again on resize.
  const segmentRefs = useRef(new Map<string, HTMLSpanElement>());
  const [overflowing, setOverflowing] = useState<string>('');
  useLayoutEffect(() => {
    const keys =
      orientation === 'vertical'
        ? []
        : [...segmentRefs.current.entries()]
            .filter(([, span]) => span.scrollWidth > span.clientWidth + 0.5)
            .map(([key]) => key)
            .sort();
    const next = JSON.stringify(keys);
    setOverflowing((prev) => (prev === next ? prev : next));
  }, [width, segments, orientation]);
  const hiddenKeys = new Set<string>(
    overflowing === '' ? [] : (JSON.parse(overflowing) as string[]),
  );

  return (
    <div
      className={cx('jf-milestone-line', `jf-milestone-line--${orientation}`)}
      role="group"
      aria-label={ariaLabel}
    >
      <div
        ref={ref}
        className={cx('jf-milestone-line__body', stacked && 'jf-milestone-line__body--stacked')}
        aria-hidden="true"
      >
        <span className="jf-milestone-line__rule" />
        {sortedSegments.map((segment) => (
          <span
            key={segmentKey(segment)}
            ref={(span) => {
              if (span) segmentRefs.current.set(segmentKey(segment), span);
              else segmentRefs.current.delete(segmentKey(segment));
            }}
            className="jf-milestone-line__segment"
            data-fits={hiddenKeys.has(segmentKey(segment)) ? 'false' : undefined}
            style={
              {
                '--jf-ml-from': clamp01(segment.from),
                '--jf-ml-to': clamp01(segment.to),
                order: segmentOrder(segment),
              } as CSSProperties
            }
          >
            {segment.label}
          </span>
        ))}
        {nodes.map((node, index) => (
          <span
            key={node.key}
            className="jf-milestone-line__node"
            data-tone={node.tone}
            data-row={rows[index] ?? 0}
            data-anchor={labelAnchor(index, nodes.length)}
            style={{ '--jf-ml-pos': clamp01(node.position), order: index * 2 } as CSSProperties}
          >
            <span className={`jf-milestone-line__dot jf-milestone-line__dot--${node.tone}`} />
            <span className="jf-milestone-line__text">
              <span className="jf-milestone-line__label">{node.label}</span>
              {node.sublabel ? (
                <span className="jf-milestone-line__sublabel">{node.sublabel}</span>
              ) : null}
            </span>
          </span>
        ))}
      </div>
      <ol className="jf-visually-hidden">
        {nodes.map((node) => (
          <li key={node.key}>{nodeText(node, segmentAt(node.position))}</li>
        ))}
      </ol>
    </div>
  );
}
