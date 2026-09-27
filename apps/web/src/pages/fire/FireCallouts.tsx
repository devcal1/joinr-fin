// The FIRE page's callouts (stage-6.md §6.3 item 2): status callouts first, then notes, at most two
// under the header (a note that does not fit moves into "How it's worked out"); the standing
// projection note at the page foot.
import type { FireMissingInput, FirePageResponse, FireWhatIfField } from '@joinr/schema';
import { Callout } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { Fragment, type JSX, type MouseEvent } from 'react';
import { SWITCHED_OFF_NOTE } from '../../layout/RootLayout';
import {
  MISSING_WORDS,
  accessAgeReplacedText,
  dollars,
  longDate,
  type FireCalloutId,
} from './fireText';
import { whatIfFieldId } from './whatIf';

/** The what-if field a missing input can be set in (focused by its link). */
const MISSING_FIELD: Partial<Record<FireMissingInput, FireWhatIfField>> = {
  accessAge: 'accessAge',
  inflationRate: 'inflationRate',
  withdrawalRate: 'withdrawalRate',
};

function focusField(event: MouseEvent<HTMLAnchorElement>, field: FireWhatIfField): void {
  const input = document.getElementById(whatIfFieldId(field));
  if (!input) return;
  event.preventDefault();
  input.focus();
  input.scrollIntoView?.({ block: 'center' });
}

function MissingLink({ input }: { input: FireMissingInput }): JSX.Element {
  const field = MISSING_FIELD[input];
  const words = MISSING_WORDS[input];
  if (field) {
    return (
      <a href={`#${whatIfFieldId(field)}`} onClick={(event) => focusField(event, field)}>
        {words}
      </a>
    );
  }
  const investing = input === 'marketReturn' || input === 'cashInterestRate' || input === 'rates';
  return (
    <Link to="/settings" hash={investing ? 'investing' : 'fire'}>
      {words}
    </Link>
  );
}

function NeedsInput({ missing }: { missing: readonly FireMissingInput[] }): JSX.Element {
  return (
    <Callout kind="important" title="Inputs needed">
      <p>
        Set these to see your FIRE date:{' '}
        {missing.map((input, index) => (
          <Fragment key={input}>
            {index > 0 ? ', ' : null}
            <MissingLink input={input} />
          </Fragment>
        ))}
        .
      </p>
    </Callout>
  );
}

export function FireCallout({
  id,
  page,
}: {
  id: FireCalloutId;
  page: FirePageResponse;
}): JSX.Element | null {
  switch (id) {
    case 'featureOff':
      return (
        <Callout kind="note" title="Page switched off">
          <p>
            {SWITCHED_OFF_NOTE}{' '}
            <Link to="/settings" hash="features">
              Change it in Settings
            </Link>
          </p>
        </Callout>
      );
    case 'needsInput':
      return <NeedsInput missing={page.projection.missing} />;
    case 'spendNeeded':
      return (
        <Callout kind="important" title="Yearly spend needed">
          <p>
            Yearly spend needed. Your recorded months show no spending to base it on; set a yearly
            spend in the what-if panel and save it.
          </p>
        </Callout>
      );
    case 'accessAgeReplaced': {
      const replaced = page.inputs.accessAge.replaced;
      return replaced ? (
        <Callout kind="note" title="Access age">
          <p>{accessAgeReplacedText(replaced)}</p>
        </Callout>
      ) : null;
    }
    case 'staleWindow': {
      const through = page.derived.window?.through;
      return through ? (
        <Callout kind="note" title="Savings figures">
          <p>
            Your savings figures run to {longDate(through)};{' '}
            <Link to="/history">record the months since then</Link> to bring them up to date.
          </p>
        </Callout>
      ) : null;
    }
    case 'workbookContribution': {
      const { workbookCents, cents } = page.inputs.superContribution;
      return workbookCents !== null ? (
        <Callout kind="note" title="Super contribution">
          <p>
            The workbook’s super contribution a year was {dollars(workbookCents)}. This page uses{' '}
            {dollars(cents ?? 0)} from your super contributions in the last 12 months.
          </p>
        </Callout>
      ) : null;
    }
  }
}

/** The standing note at the page foot (fix 15: no disclaimer gate). */
export function ProjectionNote(): JSX.Element {
  return (
    <Callout kind="note" title="About these figures">
      <p>
        A projection in today’s dollars from your settings and recent months, not financial advice.
      </p>
    </Callout>
  );
}
