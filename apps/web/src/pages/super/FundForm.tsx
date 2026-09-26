// The fund form (stage-4.md §6.4 item 4, §3.4, §6.7): name, receives employer SG (one fund at a
// time), archived (edit only, after a closing balance of $0); create adds the opening balance, its
// date and "Moved from a fund on this page (a rollover)"; an opening balance that is not a rollover
// is dated after the last recorded month (the server's 400, §4.5 step 5). The SG switch alone keeps
// re-import available (a note instead of the workbook callout). Delete sits in the edit form, disabled while
// the fund has contributions (409 FUND_IN_USE otherwise).
import type { SuperFundDto } from '@joinr/schema';
import {
  Button,
  Callout,
  DateField,
  Grid,
  GridItem,
  MoneyField,
  Switch,
  TextField,
  formatDate,
  toIsoDate,
} from '@joinr/ui';
import { Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useCreateSuperFund, useDeleteSuperFund, useUpdateSuperFund } from '../../api/hooks';
import { plural } from '../../formatting';
import { tomorrowOf } from '../cashflow/display';
import { DeleteConfirm, InlineForm, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { actionErrorText, formErrorsOf } from '../cashflow/formState';
import { ARCHIVE_HINT, ROLLOVER_HINT, SG_FUND_KEPT, SG_SWITCH_HINT } from './superText';

type Field = 'name' | 'receivesSg' | 'archived' | 'openingBalanceCents' | 'asOf';
const FIELDS: readonly Field[] = ['name', 'receivesSg', 'archived', 'openingBalanceCents', 'asOf'];

export interface FundFormProps {
  fund?: SuperFundDto;
  /** The last recorded month's run date (SuperPageResponse.lastRun): a new fund's opening balance
   * that is not a rollover is dated after it. */
  lastRun?: string | null;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function FundForm({ fund, lastRun = null, onDone, onCancel }: FundFormProps): JSX.Element {
  const [today] = useState(() => toIsoDate(new Date()));
  const [name, setName] = useState(fund?.name ?? '');
  const [receivesSg, setReceivesSg] = useState(fund?.receivesSg ?? false);
  const [archived, setArchived] = useState(fund?.archived ?? false);
  const [opening, setOpening] = useState<number | null>(null);
  const [asOf, setAsOf] = useState<string | null>(today);
  const [rollover, setRollover] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const create = useCreateSuperFund();
  const update = useUpdateSuperFund();
  const remove = useDeleteSuperFund();
  const pending = create.isPending || update.isPending || remove.isPending;

  const nameChanged = fund ? name.trim() !== fund.name : false;
  const sgChanged = fund ? receivesSg !== fund.receivesSg : false;
  const archivedChanged = fund ? archived !== fund.archived : false;
  const pristine = fund
    ? !nameChanged && !sgChanged && !archivedChanged
    : name.trim() === '' && opening === null;
  const sgOnly = fund !== undefined && sgChanged && !nameChanged && !archivedChanged;
  const canArchive = fund ? fund.archived || fund.balanceCents === 0 : false;
  const inUse = (fund?.contributionCount ?? 0) > 0;

  const onError = (error: Error): void => {
    const split = formErrorsOf<Field>(error, FIELDS);
    setErrors(split.fields);
    setFormError(split.form);
  };

  const submit = (): boolean => {
    const found: Partial<Record<Field, string>> = {};
    if (!name.trim()) found.name = 'Enter a name.';
    else if (name.trim().length > 80) found.name = 'Use at most 80 characters.';
    if (!fund) {
      if (opening === null) found.openingBalanceCents = 'Enter the opening balance.';
      if (!asOf) found.asOf = 'Enter the date of the balance.';
      else if (asOf > tomorrowOf(today)) found.asOf = 'Enter a date no later than tomorrow.';
      else if (lastRun !== null && !rollover && (opening ?? 0) > 0 && asOf <= lastRun) {
        found.asOf = `Date the opening balance after ${formatDate(lastRun)} (the last recorded month), or mark it a rollover.`;
      }
    }
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return false;
    if (fund) {
      update.mutate(
        { id: fund.id, body: { name: name.trim(), receivesSg, archived } },
        { onSuccess: () => onDone(sgOnly ? 'SG fund saved' : 'Fund saved'), onError },
      );
    } else {
      create.mutate(
        {
          name: name.trim(),
          receivesSg,
          openingBalanceCents: opening ?? 0,
          asOf: asOf ?? today,
          openingIsRollover: rollover,
        },
        { onSuccess: () => onDone('Fund saved'), onError },
      );
    }
    return true;
  };

  const confirmDelete = (): void => {
    if (!fund) return;
    setFormError(null);
    remove.mutate(fund.id, {
      onSuccess: () => onDone('Fund deleted'),
      onError: (error) => {
        setConfirming(false);
        setFormError(actionErrorText(error));
      },
    });
  };

  let notes: JSX.Element | null;
  if (!fund) notes = <NewAppDataNote />;
  else if (sgOnly) {
    notes = (
      <Callout kind="note" title="Import-safe">
        <p>{SG_FUND_KEPT}.</p>
      </Callout>
    );
  } else if (fund.origin === 'import') notes = <WorkbookCallout />;
  else notes = <NewAppDataNote />;

  const deleteButton = fund ? (
    confirming ? (
      <DeleteConfirm
        question={`Delete ${fund.name} and its balance history?`}
        label={`fund ${fund.name}`}
        busy={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(false)}
      />
    ) : (
      <Button
        variant="ghost"
        icon={Trash2}
        onClick={() => setConfirming(true)}
        disabled={pending || inUse}
        aria-describedby={inUse ? 'super-fund-in-use' : undefined}
      >
        Delete fund
      </Button>
    )
  ) : null;

  return (
    <InlineForm
      title={fund ? `Edit fund · ${fund.name}` : 'Add fund'}
      subtitle="Super"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      extraActions={deleteButton}
      notes={
        <>
          {notes}
          {inUse && fund ? (
            <p id="super-fund-in-use" className="jf-app-meta">
              This fund has {plural(fund.contributionCount, 'contribution')}; move or delete them
              first.
            </p>
          ) : null}
        </>
      }
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
          <div className="jf-app-switch-field">
            <Switch
              label="Receives employer SG"
              checked={receivesSg}
              onChange={setReceivesSg}
              hint={SG_SWITCH_HINT}
              disabled={pending}
            />
          </div>
        </GridItem>
        {fund ? (
          <GridItem span={6}>
            <Switch
              label="Archived"
              checked={archived}
              onChange={setArchived}
              hint={canArchive ? 'Archived funds are kept out of the total' : ARCHIVE_HINT}
              disabled={pending || !canArchive}
            />
          </GridItem>
        ) : (
          <>
            <GridItem span={6}>
              <MoneyField
                label="Opening balance"
                value={opening}
                onChange={setOpening}
                required
                error={errors.openingBalanceCents}
                disabled={pending}
              />
            </GridItem>
            <GridItem span={6}>
              <DateField
                label="As of"
                value={asOf}
                onChange={setAsOf}
                max={tomorrowOf(today)}
                required
                error={errors.asOf}
                disabled={pending}
              />
            </GridItem>
            <GridItem span={6}>
              <Switch
                label="Moved from a fund on this page (a rollover)"
                checked={rollover}
                onChange={setRollover}
                hint={ROLLOVER_HINT}
                disabled={pending}
              />
            </GridItem>
          </>
        )}
      </Grid>
    </InlineForm>
  );
}
