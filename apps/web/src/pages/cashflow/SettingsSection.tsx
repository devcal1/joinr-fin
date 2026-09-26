// The settings a page edits in context (stage-3.md §3.3, §6.3 item 6, §6.5 item 3): a
// KeyValueTable with an Edit form that PATCHes the changed keys only. Workbook settings show the
// workbook callout (§6.8); an app-only key (the year basis) shows the import-safe note instead.
// Stage 5 (stage-5.md §6.5 items 10–11, D86): every field is named by its registry label (one
// label per key, the same words as the Settings page), and the section links to the Settings
// groups of the keys it shows ("In Settings: Pay and tax · Budget").
import {
  isWorkbookSetting,
  settingDef,
  type EditableSettingKey,
  type SettingsSliceDto,
} from '@joinr/schema';
import {
  Button,
  DateField,
  Grid,
  GridItem,
  KeyValueTable,
  MoneyField,
  NumberField,
  SectionBar,
  Select,
  type KeyValueItem,
  type SectionRole,
  type SelectOption,
} from '@joinr/ui';
import { Pencil } from 'lucide-react';
import { useState, type JSX, type ReactNode } from 'react';
import { usePatchSettings } from '../../api/hooks';
import { splitFormErrors } from '../investments/apiErrors';
import { InSettingsLine } from '../settings/SettingsLinks';
import { InlineForm, KeptCallout, WorkbookCallout } from './forms';
import {
  ENUM_LABELS,
  dateDraft,
  diffSettings,
  draftOf,
  settingText,
  sliceValue,
  type SettingDraft,
  type SettingDrafts,
} from './settingsDraft';

export interface SettingsSectionProps {
  /** The section heading's id. */
  headingId: string;
  title: string;
  role: SectionRole;
  keys: readonly EditableSettingKey[];
  /** Extra text after a value in the table (e.g. the 365-day side-income figure). */
  extras?: Partial<Record<EditableSettingKey, ReactNode>>;
  hints?: Partial<Record<EditableSettingKey, string>>;
  /** A field's placeholder in the form (Stage 4: "Legal minimum 12"). */
  placeholders?: Partial<Record<EditableSettingKey, string>>;
  /** What the app uses while a key is not set (e.g. "counted as Yes"). */
  unset?: Partial<Record<EditableSettingKey, string>>;
  slice: SettingsSliceDto;
  editing: boolean;
  /** The Edit button's `data-cf-action` key (focus returns to it). */
  actionKey: string;
  onEdit: () => void;
  onCancel: () => void;
  onDone: (message: string) => void;
  /** Shown under the table (e.g. the missing-inputs callout). */
  children?: ReactNode;
}

/** One label per key (D86): the registry's, on every page and on the Settings page. */
function labelOf(key: EditableSettingKey): string {
  return settingDef(key).label;
}

/** A stored value, its default when unset, or "Not set" (with what the app then uses). */
function ValueText({
  keyName,
  slice,
  unset,
}: {
  keyName: EditableSettingKey;
  slice: SettingsSliceDto;
  unset?: string;
}) {
  const value = sliceValue(slice, keyName);
  const text = settingText(keyName, value);
  if (text !== null) return <span className="jf-app-text-value">{text}</span>;
  const fallback = settingDef(keyName).defaultValue;
  if (fallback !== null) {
    return (
      <span className="jf-app-text-value">
        {settingText(keyName, fallback)} <span className="jf-app-muted">(default)</span>
      </span>
    );
  }
  return <span className="jf-app-muted">{unset ? `Not set: ${unset}` : 'Not set'}</span>;
}

export function SettingsSection({
  headingId,
  title,
  role,
  keys,
  extras,
  hints,
  placeholders,
  unset,
  slice,
  editing,
  actionKey,
  onEdit,
  onCancel,
  onDone,
  children,
}: SettingsSectionProps): JSX.Element {
  const items: KeyValueItem[] = keys.map((key) => ({
    label: labelOf(key),
    value: (
      <span className="jf-app-kv-stack">
        <ValueText keyName={key} slice={slice} unset={unset?.[key]} />
        {extras?.[key] ? <span className="jf-app-meta">{extras[key]}</span> : null}
      </span>
    ),
  }));
  return (
    <section className="jf-app-block" aria-labelledby={headingId}>
      <SectionBar
        id={headingId}
        title={title}
        role={role}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={Pencil}
            data-cf-action={actionKey}
            onClick={onEdit}
            disabled={editing}
            aria-label={`Edit ${title.toLowerCase()}`}
          >
            Edit
          </Button>
        }
      />
      {editing ? (
        <SettingsForm
          title={title}
          keys={keys}
          hints={hints}
          placeholders={placeholders}
          slice={slice}
          onCancel={onCancel}
          onDone={onDone}
        />
      ) : (
        <KeyValueTable caption={title} items={items} />
      )}
      <InSettingsLine keys={keys} />
      {children}
    </section>
  );
}

interface SettingsFormProps {
  title: string;
  keys: readonly EditableSettingKey[];
  hints?: Partial<Record<EditableSettingKey, string>>;
  placeholders?: Partial<Record<EditableSettingKey, string>>;
  slice: SettingsSliceDto;
  onCancel: () => void;
  onDone: (message: string) => void;
}

function SettingsForm({
  title,
  keys,
  hints,
  placeholders,
  slice,
  onCancel,
  onDone,
}: SettingsFormProps): JSX.Element {
  const [drafts, setDrafts] = useState<SettingDrafts>(() =>
    Object.fromEntries(keys.map((key) => [key, draftOf(key, sliceValue(slice, key))])),
  );
  const [errors, setErrors] = useState<Partial<Record<EditableSettingKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const patch = usePatchSettings();
  const diff = diffSettings(keys, slice, drafts);
  const changed = Object.keys(diff.values) as EditableSettingKey[];
  const pristine = changed.length === 0 && Object.keys(diff.errors).length === 0;
  const workbookKeys = keys.filter((key) => isWorkbookSetting(key));
  // Pristine: warn when the form holds any workbook setting. Once edited: warn only when a
  // changed key is a workbook setting; an app-only change (the year basis) is import-safe.
  const showWorkbook = pristine
    ? workbookKeys.length > 0
    : changed.some((key) => isWorkbookSetting(key));
  const showKept = !showWorkbook && keys.some((key) => !isWorkbookSetting(key));

  const set = (key: EditableSettingKey, draft: SettingDraft): void => {
    setDrafts((current) => ({ ...current, [key]: draft }));
  };

  const submit = (): boolean => {
    setFormError(null);
    setErrors(diff.errors);
    if (Object.keys(diff.errors).length > 0 || changed.length === 0) return false;
    patch.mutate(
      { values: diff.values },
      {
        onSuccess: () => onDone('Settings saved'),
        onError: (error) => {
          const split = splitFormErrors<EditableSettingKey>(error, (path) =>
            keys.find((key) => path === `values.${key}` || path.startsWith(`values.${key}.`)),
          );
          setErrors(split.fields);
          setFormError(split.form);
        },
      },
    );
    return true;
  };

  return (
    <InlineForm
      title={`Edit ${title.toLowerCase()}`}
      onSubmit={submit}
      onCancel={onCancel}
      pending={patch.isPending}
      pristine={pristine}
      formError={formError}
      notes={showWorkbook ? <WorkbookCallout /> : showKept ? <KeptCallout /> : null}
    >
      <Grid>
        {keys.map((key) => (
          <GridItem key={key} span={4}>
            <SettingField
              keyName={key}
              label={labelOf(key)}
              hint={hints?.[key]}
              placeholder={placeholders?.[key]}
              draft={drafts[key] ?? null}
              error={errors[key]}
              disabled={patch.isPending}
              onChange={(draft) => set(key, draft)}
            />
          </GridItem>
        ))}
      </Grid>
    </InlineForm>
  );
}

interface SettingFieldProps {
  keyName: EditableSettingKey;
  label: string;
  hint?: string;
  placeholder?: string;
  draft: SettingDraft;
  error?: string;
  disabled: boolean;
  onChange: (draft: SettingDraft) => void;
}

function SettingField({
  keyName,
  label,
  hint,
  placeholder,
  draft,
  error,
  disabled,
  onChange,
}: SettingFieldProps): JSX.Element {
  const def = settingDef(keyName);
  switch (def.type) {
    case 'money':
      return (
        <MoneyField
          label={label}
          value={typeof draft === 'number' ? draft : null}
          onChange={onChange}
          hint={hint ?? 'Leave empty to clear'}
          placeholder={placeholder}
          error={error}
          disabled={disabled}
        />
      );
    case 'ratio':
      return (
        <NumberField
          label={label}
          value={typeof draft === 'string' ? draft : ''}
          onChange={onChange}
          maxDp={4}
          suffix="%"
          hint={hint}
          placeholder={placeholder}
          error={error}
          disabled={disabled}
        />
      );
    case 'integer':
      return (
        <NumberField
          label={label}
          value={typeof draft === 'string' ? draft : ''}
          onChange={onChange}
          maxDp={0}
          hint={hint}
          placeholder={placeholder}
          error={error}
          disabled={disabled}
        />
      );
    case 'date':
      return (
        <DateField
          label={label}
          value={dateDraft(draft)}
          onChange={onChange}
          hint={hint}
          error={error}
          disabled={disabled}
        />
      );
    case 'boolean':
    case 'enum': {
      const options: SelectOption[] =
        def.type === 'boolean'
          ? [
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]
          : (def.enumValues ?? []).map((value) => ({
              value,
              label: ENUM_LABELS[keyName]?.[value] ?? value,
            }));
      return (
        <Select
          label={label}
          value={typeof draft === 'string' ? draft : ''}
          onChange={onChange}
          options={options}
          // An unstored key shows its registry default, as the settings table does; the draft
          // stays '' (unset), so saving an untouched form sends nothing.
          placeholder={
            def.defaultValue !== null
              ? `${settingText(keyName, def.defaultValue) ?? 'Not set'} (default)`
              : 'Not set'
          }
          hint={hint}
          error={error}
          disabled={disabled}
        />
      );
    }
  }
}
