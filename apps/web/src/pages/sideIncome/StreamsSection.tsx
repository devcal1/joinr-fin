// The Side Income page's streams (stage-3.md §6.4 item 7): name, deposits and lifetime, with
// Rename, Archive (an archived stream is hidden from the deposit form) and Delete (only while the
// stream has no deposits: the server answers 409 STREAM_IN_USE otherwise).
import type { IncomeStreamDto } from '@joinr/schema';
import { Button, ColumnTable, Pill, Switch, TextField, type ColumnTableColumn } from '@joinr/ui';
import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useCreateStream, useDeleteStream, useUpdateStream } from '../../api/hooks';
import { formatCount } from '../../formatting';
import { FlowCell, SourceCell } from '../cashflow/cells';
import {
  DeleteConfirm,
  FormError,
  InlineForm,
  NewAppDataNote,
  WorkbookCallout,
} from '../cashflow/forms';
import { actionErrorText, actionSelector, formErrorsOf, useRowDelete } from '../cashflow/formState';
import { streamActionKey } from './sideIncomeEditor';

const deleteSelector = (id: number): string => actionSelector(streamActionKey('delete', id));

export interface StreamsSectionProps {
  streams: readonly IncomeStreamDto[];
  locked: boolean;
  onRename: (stream: IncomeStreamDto) => void;
  onChanged: (message: string) => void;
}

export function StreamsSection({ streams, locked, onRename, onChanged }: StreamsSectionProps) {
  const update = useUpdateStream();
  const remove = useDeleteStream();
  const rowDelete = useRowDelete<number>(deleteSelector);
  const [error, setError] = useState<string | null>(null);
  const confirming = streams.find((s) => s.id === rowDelete.confirming);

  const toggleArchive = (stream: IncomeStreamDto): void => {
    setError(null);
    update.mutate(
      { id: stream.id, body: { name: stream.name, archived: !stream.archived } },
      {
        onSuccess: () => onChanged(stream.archived ? 'Stream restored' : 'Stream archived'),
        onError: (e) => setError(actionErrorText(e)),
      },
    );
  };

  const columns: ColumnTableColumn<IncomeStreamDto>[] = [
    {
      id: 'name',
      header: 'Stream',
      value: (s) => s.name,
      cell: (s) => (
        <span className="jf-app-flags">
          <span>{s.name}</span>
          {s.archived ? <Pill tone="na">Archived</Pill> : null}
        </span>
      ),
      minWidth: 140,
    },
    {
      id: 'deposits',
      header: 'Deposits',
      value: (s) => s.depositCount,
      cell: (s) => formatCount(s.depositCount),
      numeric: true,
    },
    {
      id: 'lifetime',
      header: 'Lifetime',
      value: (s) => s.lifetimeCents,
      cell: (s) => <FlowCell cents={s.lifetimeCents} />,
      numeric: true,
    },
    {
      id: 'source',
      header: 'Source',
      value: (s) => s.origin,
      cell: (s) => <SourceCell origin={s.origin} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (s) => {
        const label = `stream ${s.name}`;
        if (rowDelete.confirming === s.id) {
          return (
            <DeleteConfirm
              question={`Delete the ${label}?`}
              label={label}
              busy={remove.isPending}
              onConfirm={() =>
                remove.mutate(s.id, {
                  onSuccess: () => {
                    rowDelete.finish();
                    onChanged('Stream deleted');
                  },
                  onError: rowDelete.fail,
                })
              }
              onCancel={rowDelete.cancel}
            />
          );
        }
        const busy = locked || rowDelete.confirming !== null || update.isPending;
        return (
          <span className="jf-app-row-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={Pencil}
              aria-label={`Rename the ${label}`}
              data-cf-action={streamActionKey('rename', s.id)}
              onClick={() => onRename(s)}
              disabled={busy}
            >
              Rename
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={s.archived ? ArchiveRestore : Archive}
              aria-label={`${s.archived ? 'Restore' : 'Archive'} the ${label}`}
              data-cf-action={streamActionKey('archive', s.id)}
              onClick={() => toggleArchive(s)}
              disabled={busy}
            >
              {s.archived ? 'Restore' : 'Archive'}
            </Button>
            {s.depositCount === 0 ? (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                aria-label={`Delete the ${label}`}
                data-cf-action={streamActionKey('delete', s.id)}
                onClick={() => rowDelete.ask(s.id)}
                disabled={busy}
              >
                Delete
              </Button>
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <>
      {confirming?.origin === 'import' ? <WorkbookCallout /> : null}
      <FormError message={rowDelete.error ?? error} title="Not saved" />
      <ColumnTable
        columns={columns}
        rows={streams}
        getRowId={(s) => String(s.id)}
        caption="Side-income streams"
        emptyMessage="Add a stream to start logging deposits."
      />
      <p className="jf-app-meta">
        Archived streams are hidden from the deposit form. A stream with deposits cannot be deleted.
      </p>
    </>
  );
}

export interface StreamFormProps {
  stream?: IncomeStreamDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function StreamForm({ stream, onDone, onCancel }: StreamFormProps): JSX.Element {
  const [name, setName] = useState(stream?.name ?? '');
  const [archived, setArchived] = useState(stream?.archived ?? false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateStream();
  const update = useUpdateStream();
  const pending = create.isPending || update.isPending;
  const pristine = stream
    ? name.trim() === stream.name && archived === stream.archived
    : name.trim() === '';

  const submit = (): boolean => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a name.');
      return false;
    }
    if (trimmed.length > 60) {
      setError('Use at most 60 characters.');
      return false;
    }
    setError(undefined);
    setFormError(null);
    const handlers = {
      onSuccess: () => onDone(stream ? 'Stream saved' : 'Stream added'),
      onError: (e: Error) => {
        const split = formErrorsOf<'name'>(e, ['name']);
        setError(split.fields.name);
        setFormError(split.form);
      },
    };
    if (stream) update.mutate({ id: stream.id, body: { name: trimmed, archived } }, handlers);
    else create.mutate({ name: trimmed, archived: false }, handlers);
    return true;
  };

  return (
    <InlineForm
      title={stream ? `Rename stream · ${stream.name}` : 'Add stream'}
      subtitle="Side income"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      notes={stream?.origin === 'import' ? <WorkbookCallout /> : stream ? null : <NewAppDataNote />}
    >
      <TextField
        label="Name"
        value={name}
        onChange={setName}
        maxLength={60}
        required
        error={error}
        disabled={pending}
      />
      {stream ? (
        <Switch
          label="Archived: hidden from the deposit form"
          checked={archived}
          onChange={setArchived}
          disabled={pending}
        />
      ) : null}
    </InlineForm>
  );
}
