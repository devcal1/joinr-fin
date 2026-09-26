// The Cash page's Goals section (stage-3.md §6.3 item 5, D55, D59): the cash target and the
// end-of-year cash goal as meters on available cash, and the savings goals in waterfall order
// (meters, ETA, on-track badges, required per month; edit, delete, reorder). Goals are overlays:
// a re-import keeps them.
import type { CashPageResponse, IsoDate, SavingsGoalDto } from '@joinr/schema';
import {
  Button,
  Card,
  Cluster,
  DateField,
  Grid,
  GridItem,
  KeyValueTable,
  Meter,
  MoneyField,
  StatusBadge,
  TextField,
  formatDate,
  formatDateLong,
  formatMoney,
  type KeyValueItem,
} from '@joinr/ui';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';
import {
  useCreateSavingsGoal,
  useDeleteSavingsGoal,
  useReorderSavingsGoals,
  useUpdateSavingsGoal,
} from '../../api/hooks';
import {
  aboutMonth,
  gapPerMonthText,
  monthsText,
  periodLabel,
  rateText,
  yearLabel,
  yearLastDay,
} from '../cashflow/display';
import { DeleteConfirm, FormError, InlineForm, KeptCallout } from '../cashflow/forms';
import { actionErrorText, formErrorsOf, type EditorState } from '../cashflow/formState';
import { isFormOpen, type CashEditor } from './cashEditor';
import { endedAnchorMonth, goalActionKey, savedLine } from './cashText';

export const AVAILABLE_CASH_NOTE =
  "Available cash is total cash minus loans you've made. The projections add your average monthly cash saved.";
export const NO_GOALS = 'No goals yet. Add one to track saving toward it.';
export const GOALS_KEPT = 'Goals are kept when you re-import the workbook.';
const MIN_DATE = '1900-01-01';
const MAX_DATE = '2200-12-31';

function CashTargetCard({ page }: { page: CashPageResponse }): JSX.Element {
  const target = page.kpis.cashTarget;
  if (!target) {
    return (
      <Card as="section" title="Cash target">
        <p className="jf-app-meta">No cash savings target set. Set one in the settings below.</p>
      </Card>
    );
  }
  // Not on track: either no recorded months yet (no average), or the average cash gain is zero or
  // negative (possible beside a positive "Saved per month", which also counts added investments).
  const avgGain = page.kpis.avgCashGainAdjustedCents;
  const notGrowing =
    avgGain === null
      ? 'Needs recorded months'
      : `Cash isn't growing at the moment (average cash gain ${formatMoney(avgGain, { wholeDollars: true })} a month)`;
  const status =
    target.status === 'reached'
      ? 'Reached'
      : target.status === 'on_track' && target.monthsToTarget !== null
        ? `${monthsText(target.monthsToTarget)} to go${target.arrival ? ` · ${periodLabel(target.arrival.slice(0, 7))}` : ''}`
        : notGrowing;
  const items: KeyValueItem[] = [
    { label: 'Target', value: formatMoney(target.targetCents), numeric: true },
    { label: 'Progress', value: rateText(target.progressRatio) ?? '—', numeric: true },
    { label: 'When', value: <span data-testid="cash-target-status">{status}</span> },
  ];
  return (
    <Card as="section" title="Cash target">
      <div className="jf-app-block">
        <Meter
          label="Available cash"
          valueCents={page.totals.availableCashCents}
          targetCents={target.targetCents}
          wholeDollars
        />
        <KeyValueTable caption="Cash target" items={items} />
      </div>
    </Card>
  );
}

function EoyGoalCard({ page }: { page: CashPageResponse }): JSX.Element {
  const { kpis } = page;
  const stored = page.settings.values['goals.eoyCashGoalCents'];
  const goal = typeof stored === 'number' ? stored : null;
  const yearEnd = formatDateLong(yearLastDay(kpis.year));
  if (goal === null) {
    return (
      <Card as="section" title="End-of-year cash goal" subtitle={yearLabel(kpis.year)}>
        <p className="jf-app-meta">No end-of-year cash goal set. Set one in the settings below.</p>
      </Card>
    );
  }
  const months = kpis.monthsToYearEnd;
  // The projection runs from the last recorded month (§2.6 anchor); once that month's year is over
  // the card says so, since the year end shown is then in the past.
  const anchorMonth = endedAnchorMonth(page);
  const items: KeyValueItem[] = [
    { label: 'Goal', value: formatMoney(goal), numeric: true },
    {
      label: `Projected at ${yearEnd}`,
      value: kpis.eoyProjectedCashCents === null ? '—' : formatMoney(kpis.eoyProjectedCashCents),
      numeric: true,
    },
    {
      label:
        months === null
          ? 'Per month'
          : `Per month over the ${monthsText(Math.max(1, months))} left${anchorMonth ? ' after the last recorded month' : ''}`,
      value:
        kpis.eoyGapPerMonthCents === null ? (
          <span className="jf-app-muted">Needs recorded months</span>
        ) : (
          gapPerMonthText(kpis.eoyGapPerMonthCents)
        ),
    },
    {
      label: 'On target',
      value:
        kpis.eoyOnTarget === null ? (
          <span className="jf-app-muted">Not known yet</span>
        ) : kpis.eoyOnTarget ? (
          <StatusBadge status="go" label="On target" />
        ) : (
          <StatusBadge status="check" label="Behind" />
        ),
    },
  ];
  return (
    <Card as="section" title="End-of-year cash goal" subtitle={yearLabel(kpis.year)}>
      <div className="jf-app-block">
        <Meter
          label="Available cash"
          valueCents={page.totals.availableCashCents}
          targetCents={goal}
          wholeDollars
        />
        <KeyValueTable caption="End-of-year cash goal" items={items} />
        {anchorMonth ? (
          <p className="jf-app-meta" data-testid="eoy-anchor-note">
            Projected from the last recorded month ({anchorMonth}).
          </p>
        ) : null}
      </div>
    </Card>
  );
}

// ─── Savings goals ──────────────────────────────────────────────────────────────────────────────

interface GoalCardProps {
  goal: SavingsGoalDto;
  index: number;
  count: number;
  monthlyProgressCents: number | null;
  /** The page's as-of date: a target date before it has passed. */
  asOf: IsoDate;
  locked: boolean;
  busy: boolean;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
  onDeleted: (message: string) => void;
}

function etaText(goal: SavingsGoalDto, monthlyProgressCents: number | null): string | null {
  if (goal.reached) return null;
  // No average yet (no recorded months) is not the same as nothing going toward goals.
  if (monthlyProgressCents === null) return 'No ETA yet: needs recorded months';
  if (goal.eta === null || goal.monthsToGo === null) {
    return 'No ETA: nothing is going toward goals at the moment';
  }
  return `${aboutMonth(goal.eta)} at ${formatMoney(monthlyProgressCents, { wholeDollars: true })} a month toward goals`;
}

function GoalCard({
  goal,
  index,
  count,
  monthlyProgressCents,
  asOf,
  locked,
  busy,
  onEdit,
  onMove,
  onDeleted,
}: GoalCardProps): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useDeleteSavingsGoal();
  const eta = etaText(goal, monthlyProgressCents);
  const passed = !goal.reached && goal.targetDate !== null && goal.targetDate < asOf;
  const required =
    passed && goal.targetDate !== null
      ? `The target date (${formatDate(goal.targetDate)}) has passed; ${formatMoney(goal.remainingCents, { wholeDollars: true })} still to go`
      : !goal.reached && goal.requiredPerMonthCents !== null && goal.targetDate !== null
        ? `Needs ${formatMoney(goal.requiredPerMonthCents, { wholeDollars: true })} a month to reach it by ${formatDate(goal.targetDate)}`
        : null;
  // Without recorded months progress is unknown: no On track / Behind (as the end-of-year card's
  // "Not known yet").
  const unknown = !goal.reached && monthlyProgressCents === null;
  const badge =
    goal.onTrack === null || unknown ? null : goal.onTrack ? (
      <StatusBadge status="go" label="On track" />
    ) : (
      <StatusBadge status="check" label="Behind" />
    );
  const actions = confirming ? (
    <DeleteConfirm
      question={`Delete the goal ${goal.name}?`}
      label={`goal ${goal.name}`}
      busy={remove.isPending}
      onConfirm={() => {
        // The card unmounts once the refetch drops the goal, and TanStack Query skips the mutate()
        // callbacks of an unmounted observer; the mutateAsync promise still settles, so the page
        // (which stays mounted) announces the delete.
        void remove.mutateAsync(goal.id).then(
          () => onDeleted('Goal deleted'),
          (e: unknown) => {
            setConfirming(false);
            setError(actionErrorText(e));
          },
        );
      }}
      onCancel={() => setConfirming(false)}
    />
  ) : (
    <span className="jf-app-row-actions jf-app-row-actions--wrap">
      <Button
        variant="ghost"
        size="sm"
        icon={Pencil}
        aria-label={`Edit the goal ${goal.name}`}
        data-cf-action={goalActionKey('edit', goal.id)}
        onClick={onEdit}
        disabled={locked || busy}
      >
        Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon={Trash2}
        aria-label={`Delete the goal ${goal.name}`}
        data-cf-action={goalActionKey('delete', goal.id)}
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        disabled={locked || busy}
      >
        Delete
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon={ArrowUp}
        aria-label={`Move the goal ${goal.name} up`}
        data-cf-action={goalActionKey('up', goal.id)}
        onClick={() => onMove(-1)}
        disabled={locked || busy || index === 0}
      >
        Move up
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon={ArrowDown}
        aria-label={`Move the goal ${goal.name} down`}
        data-cf-action={goalActionKey('down', goal.id)}
        onClick={() => onMove(1)}
        disabled={locked || busy || index === count - 1}
      >
        Move down
      </Button>
    </span>
  );
  return (
    <li className="jf-app-goal">
      <Card
        as="section"
        title={goal.name}
        subtitle={goal.targetDate ? `By ${formatDate(goal.targetDate)}` : 'No target date'}
      >
        <div className="jf-app-block">
          <Meter
            label={`Goal ${index + 1} of ${count}`}
            valueCents={goal.allocatedCents}
            targetCents={goal.targetCents}
            wholeDollars
            hint={eta}
          />
          {badge || required ? (
            <Cluster gap={3} className="jf-app-goal__status">
              {badge}
              {required ? <span className="jf-app-meta">{required}</span> : null}
            </Cluster>
          ) : null}
          {goal.note ? <p className="jf-app-meta">{goal.note}</p> : null}
          {actions}
          <FormError message={error} title="Not deleted" />
        </div>
      </Card>
    </li>
  );
}

type GoalField = 'name' | 'targetCents' | 'targetDate' | 'note';

function GoalForm({
  goal,
  onDone,
  onCancel,
}: {
  goal?: SavingsGoalDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState<number | null>(goal?.targetCents ?? null);
  const [date, setDate] = useState<string | null>(goal?.targetDate ?? null);
  const [note, setNote] = useState(goal?.note ?? '');
  const [errors, setErrors] = useState<Partial<Record<GoalField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateSavingsGoal();
  const update = useUpdateSavingsGoal();
  const pending = create.isPending || update.isPending;
  const pristine = goal
    ? name.trim() === goal.name &&
      target === goal.targetCents &&
      date === goal.targetDate &&
      (note.trim() || null) === goal.note
    : name.trim() === '' && target === null && date === null && note.trim() === '';

  const submit = (): boolean => {
    const found: Partial<Record<GoalField, string>> = {};
    if (!name.trim()) found.name = 'Enter a name.';
    else if (name.trim().length > 80) found.name = 'Use at most 80 characters.';
    if (target === null || target <= 0) found.targetCents = 'Enter a target above zero.';
    if (note.trim().length > 200) found.note = 'Use at most 200 characters.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || target === null) return false;
    const body = {
      name: name.trim(),
      targetCents: target,
      targetDate: date,
      note: note.trim() || null,
    };
    const handlers = {
      onSuccess: () => onDone('Goal saved'),
      onError: (error: Error) => {
        const split = formErrorsOf<GoalField>(error, ['name', 'targetCents', 'targetDate', 'note']);
        setErrors(split.fields);
        setFormError(split.form);
      },
    };
    if (goal) update.mutate({ id: goal.id, body }, handlers);
    else create.mutate(body, handlers);
    return true;
  };

  return (
    <InlineForm
      title={goal ? `Edit goal · ${goal.name}` : 'Add goal'}
      subtitle="Savings goal"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      notes={<KeptCallout>{GOALS_KEPT}</KeptCallout>}
    >
      <Grid>
        <GridItem span={6}>
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            maxLength={80}
            required
            error={errors.name}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <MoneyField
            label="Target"
            value={target}
            onChange={setTarget}
            required
            error={errors.targetCents}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <DateField
            label="Target date"
            value={date}
            onChange={setDate}
            min={MIN_DATE}
            max={MAX_DATE}
            hint="Optional"
            error={errors.targetDate}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <TextField
            label="Note"
            value={note}
            onChange={setNote}
            maxLength={200}
            hint="Optional"
            error={errors.note}
            disabled={pending}
          />
        </GridItem>
      </Grid>
    </InlineForm>
  );
}

export interface GoalsSectionProps {
  page: CashPageResponse;
  editor: EditorState<CashEditor>;
}

export function GoalsSection({ page, editor }: GoalsSectionProps): JSX.Element {
  const reorder = useReorderSavingsGoals();
  const [reorderError, setReorderError] = useState<string | null>(null);
  const items = page.goals.items;
  const open = editor.editor;
  // The read-only Details card is not a form: it locks nothing (§6.8 is about inline forms).
  const locked = isFormOpen(open);

  const move = (index: number, direction: -1 | 1): void => {
    const ids = items.map((goal) => goal.id);
    const other = index + direction;
    const a = ids[index];
    const b = ids[other];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[other] = a;
    setReorderError(null);
    reorder.mutate(ids, {
      onSuccess: () => editor.announce('Goal moved'),
      onError: (error) => setReorderError(actionErrorText(error)),
    });
  };

  return (
    <>
      <Grid>
        <GridItem span={6}>
          <CashTargetCard page={page} />
        </GridItem>
        <GridItem span={6}>
          <EoyGoalCard page={page} />
        </GridItem>
      </Grid>
      <p className="jf-app-meta">{AVAILABLE_CASH_NOTE}</p>
      {open?.form === 'goal' ? (
        <GoalForm
          key={open.goal ? `goal-${open.goal.id}` : 'new-goal'}
          goal={open.goal}
          onDone={editor.done}
          onCancel={editor.close}
        />
      ) : null}
      {items.length === 0 ? (
        <p className="jf-app-meta" data-testid="goals-empty">
          {NO_GOALS}
        </p>
      ) : (
        <ol className="jf-app-goals" aria-label="Savings goals, in the order they are filled">
          {items.map((goal, index) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              index={index}
              count={items.length}
              monthlyProgressCents={page.goals.monthlyProgressCents}
              asOf={page.asOf}
              locked={locked}
              busy={reorder.isPending}
              onEdit={() =>
                editor.open({
                  form: 'goal',
                  goal,
                  opener: `[data-cf-action="${goalActionKey('edit', goal.id)}"]`,
                })
              }
              onMove={(direction) => move(index, direction)}
              onDeleted={editor.announce}
            />
          ))}
        </ol>
      )}
      <FormError message={reorderError} title="Not moved" />
      <p className="jf-app-meta" data-testid="goals-saved-line">
        {savedLine(page)}
      </p>
    </>
  );
}
