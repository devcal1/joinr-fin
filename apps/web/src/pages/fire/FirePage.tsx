// The FIRE page (stage-6.md §6.3–6.4, D100, D101): the callouts, the KPI tiles, "Your path" (the
// milestone line and the progression chart with its needed-vs-projected view), the what-if panel
// beside the results (sticky at ≥ 1200 px), how it is worked out and the year-by-year table.
// A what-if is a query that is never saved: changes are debounced, the previous figures stay on
// screen (dimmed, `aria-busy`) while it loads, and a failure keeps them under a callout. "Save as
// my settings" PATCHes the changed fields' keys; every FIRE key is a preference (D103).
import type { FirePageResponse, FireQuery, FireWhatIfField } from '@joinr/schema';
import { BrandScreen, Button, Callout, PageHeader, SectionBar, StatusBadge } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { RotateCcw, Settings } from 'lucide-react';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { errorMessage, isApiError } from '../../api/client';
import { useFire, usePatchSettings, useStatus } from '../../api/hooks';
import { LiveRegion } from '../../components/LiveRegion';
import { LoadError, PageSkeleton, RefreshError } from '../../components/QueryStates';
import { pageSwitchedOff } from '../../layout/nav';
import { LinkButton } from '../history/LinkButton';
import { FireCallout, ProjectionNote } from './FireCallouts';
import { FireMilestones, FirePathChart } from './FirePath';
import { FireTiles } from './FireTiles';
import { WhatIfPanel } from './WhatIfPanel';
import { WorkedOut } from './WorkedOut';
import { YearByYear } from './YearByYear';
import { fireCallouts, resultStripText, splitCallouts } from './fireText';
import {
  baseValues,
  fieldErrorsOf,
  queryKeyText,
  savePatch,
  whatIfQuery,
  WHAT_IF_DEBOUNCE_MS,
  type WhatIfTouched,
  type WhatIfValue,
} from './whatIf';
import './fire.css';

const WHAT_IF_HEADING_ID = 'fire-whatif-heading';

/** Moves focus to the "What if" heading (after Save and Reset). */
function focusWhatIfHeading(): void {
  const heading = document.getElementById(WHAT_IF_HEADING_ID);
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus();
}

export function FirePage(): JSX.Element {
  const [query, setQuery] = useState<FireQuery | null>(null);
  const result = useFire(query);
  // The last response that arrived: a failed what-if keeps the previous figures on screen.
  const [lastGood, setLastGood] = useState<FirePageResponse | undefined>(undefined);
  if (result.data !== undefined && result.data !== lastGood) setLastGood(result.data);
  const page = result.data ?? lastGood;
  return (
    <>
      <PageHeader
        title="FIRE"
        subtitle="Planning"
        actions={
          <LinkButton to="/settings" hash="fire" icon={Settings} variant="ghost">
            Settings
          </LinkButton>
        }
      />
      {!page && result.isPending ? <PageSkeleton label="Loading FIRE…" layout="dashboard" /> : null}
      {!page && result.isError ? (
        <LoadError
          title="Could not load FIRE"
          error={result.error}
          onRetry={() => void result.refetch()}
        />
      ) : null}
      {page ? (
        <FireContent
          page={page}
          query={query}
          onQuery={setQuery}
          updating={result.isPlaceholderData}
          failure={result.isError ? result.error : null}
          updatedAt={result.dataUpdatedAt}
          onRetry={() => void result.refetch()}
        />
      ) : null}
    </>
  );
}

interface FireContentProps {
  page: FirePageResponse;
  /** The what-if in effect (null: the saved settings). */
  query: FireQuery | null;
  onQuery: (query: FireQuery | null) => void;
  /** A what-if is loading: the previous figures stay on screen, dimmed. */
  updating: boolean;
  /** The last request failed (the figures shown are the previous ones). */
  failure: Error | null;
  updatedAt: number;
  onRetry: () => void;
}

function FailureCallout({
  failure,
  whatIf,
  updatedAt,
  onRetry,
}: {
  failure: Error;
  whatIf: boolean;
  updatedAt: number;
  onRetry: () => void;
}): JSX.Element {
  // A failed refetch of the saved plan uses the app's shared callout (stage-6.md §6.9 B); a failed
  // what-if keeps FIRE's own words (§6.2).
  if (!whatIf) return <RefreshError error={failure} updatedAt={updatedAt} onRetry={onRetry} />;
  const message = errorMessage(failure).replace(/\.$/, '');
  const text = `Couldn’t recompute: ${message}. The figures shown are for your previous inputs.`;
  return (
    <Callout kind="important" title="What-if not updated">
      <p>{text}</p>
      <p>
        <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onRetry}>
          Try again
        </Button>
      </p>
    </Callout>
  );
}

function FireContent({
  page,
  query,
  onQuery,
  updating,
  failure,
  updatedAt,
  onRetry,
}: FireContentProps): JSX.Element {
  const { data: status } = useStatus();
  const featureOffShown = pageSwitchedOff('fire', status?.features);
  const base = useMemo(() => baseValues(page.inputs), [page.inputs]);
  const [touched, setTouched] = useState<WhatIfTouched>({});
  const pending = useMemo(() => whatIfQuery(touched, base), [touched, base]);
  const pendingKey = queryKeyText(pending);
  const committedKey = queryKeyText(query);

  // Announcements: the result after each recompute (polite); a failed save (assertive).
  const [announceNext, setAnnounceNext] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [alertText, setAlertText] = useState('');
  const [seenPage, setSeenPage] = useState(page);
  if (page !== seenPage) {
    setSeenPage(page);
    if (announceNext && !updating) {
      setAnnounceNext(false);
      setAnnouncement(resultStripText(page));
    }
  }

  // Live recompute: one request per burst of changes.
  useEffect(() => {
    if (pendingKey === committedKey) return undefined;
    const timer = setTimeout(() => {
      setAnnounceNext(true);
      onQuery(pending);
    }, WHAT_IF_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pendingKey, committedKey, pending, onQuery]);

  const recomputeNow = (): void => {
    if (pendingKey === committedKey) return;
    setAnnounceNext(true);
    onQuery(pending);
  };

  const change = (field: FireWhatIfField, value: WhatIfValue): void => {
    setTouched((current) => ({ ...current, [field]: value }));
  };

  const patch = usePatchSettings();
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = (): void => {
    const body = savePatch(touched, base);
    if (!body) return;
    setSaveError(null);
    setAlertText('');
    patch.mutate(body, {
      onSuccess: () => {
        setTouched({});
        setAnnounceNext(false);
        onQuery(null);
        setAnnouncement('FIRE settings saved');
        focusWhatIfHeading();
      },
      onError: (error) => {
        const message = errorMessage(error);
        setSaveError(message);
        setAlertText(`Couldn’t save: ${message}`);
      },
    });
  };
  const reset = (): void => {
    setTouched({});
    setSaveError(null);
    setAnnounceNext(false);
    onQuery(null);
    setAnnouncement('What-if cleared');
    focusWhatIfHeading();
  };

  const whatIfFailed = failure !== null && query !== null;
  const fieldErrors =
    whatIfFailed && isApiError(failure) && failure.status === 400
      ? fieldErrorsOf(failure.message)
      : null;

  const { shown, moved } = splitCallouts(fireCallouts(page, featureOffShown));
  const busy = updating || undefined;

  if (page.isEmpty) {
    return (
      <>
        {shown.map((id) => (
          <FireCallout key={id} id={id} page={page} />
        ))}
        <BrandScreen
          variant="empty"
          fullViewport={false}
          title="No figures yet"
          message="Import the workbook or add accounts to plan FIRE"
          actions={
            <>
              <Link to="/import">Import the workbook</Link>
              <Link to="/cash">Add accounts</Link>
            </>
          }
        />
      </>
    );
  }

  return (
    <>
      {shown.map((id) => (
        <FireCallout key={id} id={id} page={page} />
      ))}
      {failure && !fieldErrors ? (
        <FailureCallout
          failure={failure}
          whatIf={whatIfFailed}
          updatedAt={updatedAt}
          onRetry={onRetry}
        />
      ) : null}
      <LiveRegion kind="status" label="What-if result" className="jf-visually-hidden">
        {announcement}
      </LiveRegion>
      <LiveRegion kind="alert" label="What-if errors" className="jf-visually-hidden">
        {alertText}
      </LiveRegion>

      <div className="jf-app-fire-layout">
        <div className="jf-app-fire-results" aria-busy={busy} data-updating={busy}>
          {page.whatIfActive ? (
            <p className="jf-app-fire-whatif-badge">
              <StatusBadge status="pending" label="What-if (not saved)" />
            </p>
          ) : null}
          <FireTiles page={page} />
          <section className="jf-app-block" aria-labelledby="fire-path-heading">
            <SectionBar id="fire-path-heading" title="Your path" role="primary" />
            <FireMilestones page={page} />
            <FirePathChart page={page} updating={updating} />
          </section>
        </div>
        <section className="jf-app-block jf-app-fire-side" aria-labelledby={WHAT_IF_HEADING_ID}>
          <SectionBar id={WHAT_IF_HEADING_ID} title="What if" role="supporting" />
          <WhatIfPanel
            touched={touched}
            base={base}
            onChange={change}
            onCommit={recomputeNow}
            onSave={save}
            onReset={reset}
            saving={patch.isPending}
            saveError={saveError}
            fieldErrors={fieldErrors ?? {}}
            strip={resultStripText(page)}
            updating={updating}
          />
        </section>
      </div>

      <section
        className="jf-app-block"
        aria-labelledby="fire-worked-heading"
        aria-busy={busy}
        data-updating={busy}
      >
        <SectionBar id="fire-worked-heading" title="How it’s worked out" role="reference" />
        <WorkedOut page={page} movedCallouts={moved} />
      </section>

      <section
        className="jf-app-block"
        aria-labelledby="fire-years-heading"
        aria-busy={busy}
        data-updating={busy}
      >
        <SectionBar id="fire-years-heading" title="Year by year" role="reference" />
        <YearByYear projection={page.projection} />
      </section>

      <ProjectionNote />
    </>
  );
}
