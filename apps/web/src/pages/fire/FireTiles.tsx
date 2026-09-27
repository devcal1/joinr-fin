// The FIRE KPI tiles (stage-6.md §6.3 item 3): Years to FIRE (the page's one teal figure), the
// pre-super needed at FIRE start, the super needed at access and the yearly spend. Each tile has
// one line under its figure plus, where listed, a meter in StatTile's footer; while a what-if is
// active a muted "Saved: …" line comes from the saved plan's summary.
import type { FirePageResponse } from '@joinr/schema';
import { Meter, StatTile, StatusBadge } from '@joinr/ui';
import type { JSX, ReactNode } from 'react';
import {
  DASH,
  dollars,
  savedFireText,
  spendSourceLine,
  yearsToFireLine,
  yearsToFireValue,
} from './fireText';

function Line({ children }: { children: ReactNode }): JSX.Element {
  return <p className="jf-app-fire-tile-line">{children}</p>;
}

function Saved({ children }: { children: ReactNode }): JSX.Element {
  return <p className="jf-app-fire-saved">{children}</p>;
}

/** `You have $X`, the figure in the stop tint when negative. */
function YouHave({ cents }: { cents: number }): JSX.Element {
  return (
    <Line>
      You have <span className={cents < 0 ? 'jf-app-negative' : undefined}>{dollars(cents)}</span>
    </Line>
  );
}

function savedMoney(cents: number | null): string {
  return cents === null ? DASH : dollars(cents);
}

export function FireTiles({ page }: { page: FirePageResponse }): JSX.Element {
  const { projection, inputs } = page;
  const baseline = page.whatIfActive ? page.baseline : null;
  const accessAge = inputs.accessAge.value;
  const fireValue: ReactNode =
    projection.status === 'fire' ? (
      <span className="jf-app-fire-now">
        <span>{yearsToFireValue(projection)}</span> <StatusBadge status="go" label="FIRE" />
      </span>
    ) : (
      yearsToFireValue(projection)
    );

  const preSuper = projection.preSuper;
  const preSuperRatio = preSuper.progressRatio;
  const superKpi = projection.super;
  const spend = inputs.yearlySpend.cents;

  return (
    <div className="jf-app-fire-tiles">
      <StatTile
        label="Years to FIRE"
        keyFigure
        value={fireValue}
        hint={yearsToFireLine(projection, accessAge)}
        footer={baseline ? <Saved>{savedFireText(baseline)}</Saved> : undefined}
      />
      <StatTile
        label="Pre-super needed at FIRE start"
        value={
          projection.fire && preSuper.neededAtFireCents !== null
            ? dollars(preSuper.neededAtFireCents)
            : DASH
        }
        footer={
          <>
            {projection.fire && preSuper.neededAtFireCents !== null ? (
              <YouHave cents={preSuper.currentCents} />
            ) : (
              <Line>No FIRE year at these settings</Line>
            )}
            {projection.fire &&
            preSuperRatio !== null &&
            preSuper.neededAtFireCents !== null &&
            preSuper.neededAtFireCents > 0 ? (
              <Meter
                label="Pre-super progress"
                valueCents={preSuper.currentCents}
                targetCents={preSuper.neededAtFireCents}
                wholeDollars
              />
            ) : null}
            {baseline ? <Saved>Saved: {savedMoney(baseline.neededAtFireCents)}</Saved> : null}
          </>
        }
      />
      <StatTile
        label="Super needed at access"
        value={superKpi.neededAtAccessCents !== null ? dollars(superKpi.neededAtAccessCents) : DASH}
        footer={
          <>
            <YouHave cents={superKpi.currentCents} />
            {superKpi.neededAtAccessCents !== null && superKpi.neededAtAccessCents > 0 ? (
              <Meter
                label="Super progress"
                valueCents={superKpi.currentCents}
                targetCents={superKpi.neededAtAccessCents}
                markerCents={superKpi.projectedAtAccessCents ?? undefined}
                markerLabel={accessAge !== null ? `Projected at ${accessAge}` : 'Projected'}
                wholeDollars
              />
            ) : null}
            {baseline ? (
              <Saved>
                Saved: {savedMoney(baseline.superNeededAtAccessCents)} · projected{' '}
                {savedMoney(baseline.superProjectedAtAccessCents)}
              </Saved>
            ) : null}
          </>
        }
      />
      <StatTile
        label="Yearly spend"
        value={spend !== null ? dollars(spend) : DASH}
        hint={spendSourceLine(page)}
        footer={
          baseline ? <Saved>Saved: {savedMoney(baseline.yearlySpendCents)}</Saved> : undefined
        }
      />
    </div>
  );
}
