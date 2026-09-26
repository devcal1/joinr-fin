// Suggestions from Yahoo (stage-3.md §6.6 item 3, §2.11, D50, D62): due and upcoming rows (Due:
// Confirm and Dismiss; Upcoming: the expected date and Dismiss), the confirm form inline under
// its row, the dismissed ones in a closed disclosure with Restore, "none found" and the note.
// Nothing is added automatically; dismissing is import-safe.
import type { DividendSuggestionDto, DividendsPageResponse } from '@joinr/schema';
import {
  Button,
  Callout,
  ColumnTable,
  MEDIA,
  Pill,
  StatusBadge,
  formatDate,
  formatPrice,
  useMediaQuery,
  type ColumnTableColumn,
} from '@joinr/ui';
import { Check, EyeOff, RotateCcw } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useDismissSuggestion, useRestoreSuggestion } from '../../api/hooks';
import { formatDateTime, plural } from '../../formatting';
import { formatUnits } from '../investments/display';
import { FlowCell } from '../cashflow/cells';
import { SUGGESTION_STATUS_WORDS } from '../cashflow/display';
import { FormError } from '../cashflow/forms';
import {
  actionErrorText,
  actionSelector,
  orderColumns,
  type EditorState,
} from '../cashflow/formState';
import { DividendForm } from './DividendForm';
import {
  SUGGESTIONS_NOTE,
  suggestionActionKey,
  suggestionKey,
  type DividendsEditor,
} from './dividendsModel';

const DESKTOP_ORDER = [
  'holding',
  'exDate',
  'units',
  'perUnit',
  'estimate',
  'expected',
  'status',
  'actions',
] as const;
const PHONE_ORDER = [
  'holding',
  'status',
  'estimate',
  'expected',
  'exDate',
  'actions',
  'units',
  'perUnit',
] as const;

function perUnit(s: DividendSuggestionDto): string {
  try {
    return formatPrice(s.amountPerUnit, { maxDp: 6 });
  } catch {
    return s.amountPerUnit;
  }
}

export interface SuggestionsSectionProps {
  page: DividendsPageResponse;
  editor: EditorState<DividendsEditor>;
  /** The last check failed or stopped early, so "none found" would overstate what it checked. */
  checkIncomplete?: boolean;
}

export const SUGGESTIONS_INCOMPLETE =
  'No suggestions yet: the last check stopped early, so some holdings were not checked. Try again later.';

export function SuggestionsSection({
  page,
  editor,
  checkIncomplete = false,
}: SuggestionsSectionProps): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const dismiss = useDismissSuggestion();
  const restore = useRestoreSuggestion();
  const [error, setError] = useState<string | null>(null);
  const open = editor.editor;
  const active = page.suggestions.filter((s) => s.status !== 'dismissed');
  const dismissed = page.suggestions.filter((s) => s.status === 'dismissed');
  const confirming = open?.form === 'confirm' ? open.suggestion : null;
  const busy = dismiss.isPending || restore.isPending;

  const onDismiss = (s: DividendSuggestionDto): void => {
    setError(null);
    dismiss.mutate(
      { instrumentId: s.instrumentId, exDate: s.exDate },
      {
        onSuccess: () => editor.announce('Suggestion dismissed'),
        onError: (e) => setError(actionErrorText(e)),
      },
    );
  };
  const onRestore = (s: DividendSuggestionDto): void => {
    setError(null);
    restore.mutate(
      { instrumentId: s.instrumentId, exDate: s.exDate },
      {
        onSuccess: () => editor.announce('Suggestion restored'),
        onError: (e) => setError(actionErrorText(e)),
      },
    );
  };

  const all: Record<string, ColumnTableColumn<DividendSuggestionDto>> = {
    holding: {
      id: 'holding',
      header: 'Holding',
      value: (s) => s.symbol,
      cell: (s) => <span className="jf-app-instrument__symbol">{s.symbol}</span>,
      minWidth: phone ? 104 : 120,
    },
    exDate: {
      id: 'exDate',
      header: 'Ex-date',
      value: (s) => s.exDate,
      cell: (s) => formatDate(s.exDate),
      numeric: true,
    },
    units: {
      id: 'units',
      header: 'Units then',
      value: (s) => Number(s.unitsAtEx),
      cell: (s) => formatUnits(s.unitsAtEx, s.kind),
      numeric: true,
    },
    perUnit: {
      id: 'perUnit',
      header: 'Per unit',
      value: (s) => Number(s.amountPerUnit),
      cell: (s) => perUnit(s),
      numeric: true,
    },
    estimate: {
      id: 'estimate',
      header: 'Estimated amount',
      value: (s) => s.estimatedNetCents,
      cell: (s) => <FlowCell cents={s.estimatedNetCents} />,
      numeric: true,
    },
    expected: {
      id: 'expected',
      header: 'Expected paid',
      value: (s) => s.expectedPaymentDate,
      cell: (s) =>
        s.status === 'upcoming' ? (
          <span className="jf-app-nowrap">
            <span className="jf-app-text-value jf-app-text-value--whole">Expected about</span>{' '}
            {formatDate(s.expectedPaymentDate)}
          </span>
        ) : (
          formatDate(s.expectedPaymentDate)
        ),
      numeric: true,
    },
    status: {
      id: 'status',
      header: 'Status',
      value: (s) => s.status,
      cell: (s) =>
        s.status === 'due' ? (
          <StatusBadge status="check" label={SUGGESTION_STATUS_WORDS.due} />
        ) : (
          <Pill tone="na">{SUGGESTION_STATUS_WORDS[s.status]}</Pill>
        ),
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (s) => {
        const key = suggestionKey(s);
        const label = `${s.symbol} ex-date ${formatDate(s.exDate)}`;
        if (s.status === 'dismissed') {
          return (
            <Button
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              aria-label={`Restore the suggestion ${label}`}
              data-cf-action={suggestionActionKey('restore', key)}
              onClick={() => onRestore(s)}
              disabled={busy}
            >
              Restore
            </Button>
          );
        }
        return (
          <span className="jf-app-row-actions">
            {s.status === 'due' ? (
              <Button
                variant="ghost"
                size="sm"
                icon={Check}
                aria-label={`Confirm the suggestion ${label}`}
                data-cf-action={suggestionActionKey('confirm', key)}
                onClick={() =>
                  editor.open({
                    form: 'confirm',
                    suggestion: s,
                    opener: actionSelector(suggestionActionKey('confirm', key)),
                  })
                }
                disabled={open !== null || busy}
              >
                Confirm
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              icon={EyeOff}
              aria-label={`Dismiss the suggestion ${label}`}
              data-cf-action={suggestionActionKey('dismiss', key)}
              onClick={() => onDismiss(s)}
              disabled={open !== null || busy}
            >
              Dismiss
            </Button>
          </span>
        );
      },
    },
  };
  const columns = orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER);

  // The confirm form sits inline under its row: the table splits around it.
  const index = confirming
    ? active.findIndex((s) => suggestionKey(s) === suggestionKey(confirming))
    : -1;
  const before = index === -1 ? active : active.slice(0, index + 1);
  const after = index === -1 ? [] : active.slice(index + 1);
  const checked = formatDateTime(page.events.lastRefreshAt);

  // The confirm form keeps one fixed place in the tree: saving the last due suggestion empties the
  // list (the refetch lands before the save settles), and the form must stay mounted, showing its
  // pending state, until the save closes it.
  return (
    <>
      <FormError message={error} title="Not saved" />
      {active.length === 0 ? (
        <p className="jf-app-meta" data-testid="suggestions-none">
          {checkIncomplete
            ? SUGGESTIONS_INCOMPLETE
            : `No missing dividends found (checked ${checked}).`}
        </p>
      ) : (
        <ColumnTable
          columns={columns}
          rows={before}
          getRowId={suggestionKey}
          caption={`Suggestions from Yahoo: ${plural(active.length, 'suggestion')}`}
          showCaption
        />
      )}
      {confirming ? (
        <DividendForm
          key={suggestionKey(confirming)}
          page={page}
          suggestion={confirming}
          onDone={editor.done}
          onCancel={editor.close}
        />
      ) : null}
      {after.length > 0 ? (
        <ColumnTable
          columns={columns}
          rows={after}
          getRowId={suggestionKey}
          caption="Suggestions from Yahoo (continued)"
        />
      ) : null}
      {dismissed.length > 0 ? (
        <details className="jf-app-details">
          <summary className="jf-app-details__summary">Dismissed ({dismissed.length})</summary>
          <ColumnTable
            columns={columns}
            rows={dismissed}
            getRowId={suggestionKey}
            caption="Dismissed suggestions"
          />
        </details>
      ) : null}
      <Callout kind="note" title="About suggestions">
        <p>{SUGGESTIONS_NOTE}</p>
      </Callout>
    </>
  );
}
