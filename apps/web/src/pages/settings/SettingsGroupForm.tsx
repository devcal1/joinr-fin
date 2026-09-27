// One Settings group's form (stage-5.md §6.5 items 2–9, D86, D91, D95): a field per key by type
// (money, a percentage for ratios, whole numbers, a switch for booleans, a select with the values
// in words for enums, dates), labelled with the registry label (the pages' words); each field's
// hint gives its default and where its value came from; the pages that read it are links ("Not
// used by the app" for the unused keys). The group's Save sends only the changed keys; errors map by
// path. Callouts follow the one-or-the-other rule. The Pay group carries the tax suggestion, the
// allocation group its live sum, the history group the auto-record switch.
import type { EditableSettingKey, SettingDto, SettingsPageResponse } from '@joinr/schema';
import {
  Button,
  Callout,
  Card,
  Cluster,
  DateField,
  Grid,
  GridItem,
  MoneyField,
  NumberField,
  Select,
  Switch,
  TextField,
  type SelectOption,
} from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { Save } from 'lucide-react';
import { Fragment, useState, type FormEvent, type JSX } from 'react';
import { usePatchSettings } from '../../api/hooks';
import { splitFormErrors } from '../investments/apiErrors';
import { FormError } from '../cashflow/forms';
import { ENUM_LABELS, dateDraft, settingText } from '../cashflow/settingsDraft';
import { recordHourText } from '../history/historyText';
import { TaxSuggestion } from './TaxSuggestion';
import {
  AUTO_RECORD_APP_DATA_NOTE,
  ENV_LOCKED_TEXT,
  FEATURES_NOTE,
  FIRE_NOTE,
  NOT_USED_TEXT,
  SETTINGS_KEPT_NOTE,
  SETTINGS_WORKBOOK_NOTE,
  UNUSED_NOTE,
  allocationSum,
  diffGroup,
  draftsOf,
  fieldHint,
  groupCallout,
  usedOnPages,
  writeBound,
  type SettingDraft,
  type SettingDrafts,
} from './settingsForm';

export interface SettingsGroup {
  id: SettingsPageResponse['groups'][number]['id'];
  label: string;
  settings: SettingDto[];
}

/** The group's own note (§6.5 items 6–8). */
function groupNote(id: SettingsGroup['id']): string | null {
  if (id === 'features') return FEATURES_NOTE;
  if (id === 'fire') return FIRE_NOTE;
  if (id === 'unused') return UNUSED_NOTE;
  return null;
}

export function SettingsGroupForm({
  group,
  page,
  onSaved,
}: {
  group: SettingsGroup;
  page: SettingsPageResponse;
  onSaved: (message: string) => void;
}): JSX.Element {
  const { settings } = group;
  const [drafts, setDrafts] = useState<SettingDrafts>(() => draftsOf(settings));
  const [errors, setErrors] = useState<Partial<Record<EditableSettingKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const patch = usePatchSettings();
  const diff = diffGroup(settings, drafts);
  const changed = Object.keys(diff.values) as EditableSettingKey[];
  const pristine = changed.length === 0 && Object.keys(diff.errors).length === 0;
  const callout = groupCallout(settings, changed);
  const note = groupNote(group.id);
  const sum = group.id === 'allocation' ? allocationSum(settings, drafts) : null;

  const set = (key: EditableSettingKey, draft: SettingDraft): void => {
    setDrafts((current) => ({ ...current, [key]: draft }));
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (pristine || patch.isPending) return;
    setFormError(null);
    setErrors(diff.errors);
    if (Object.keys(diff.errors).length > 0 || changed.length === 0) return;
    patch.mutate(
      { values: diff.values },
      {
        onSuccess: () => onSaved('Settings saved'),
        onError: (error) => {
          const split = splitFormErrors<EditableSettingKey>(error, (path) =>
            changed.find((key) => path === `values.${key}` || path.startsWith(`values.${key}.`)),
          );
          setErrors(split.fields);
          setFormError(split.form);
        },
      },
    );
  };

  return (
    <Card as="div">
      <form
        className="jf-app-form"
        onSubmit={submit}
        noValidate
        aria-label={`${group.label} settings`}
        aria-busy={patch.isPending || undefined}
      >
        {note ? <p className="jf-app-meta">{note}</p> : null}
        {group.id === 'history' && !page.hasAppData ? (
          <Callout kind="note" title="Before the cutover">
            <p>{AUTO_RECORD_APP_DATA_NOTE}</p>
          </Callout>
        ) : null}
        <Grid>
          {settings.map((dto) => (
            <Fragment key={dto.key}>
              <GridItem
                span={dto.key === 'history.autoRecord' ? 12 : 4}
                spanTablet={dto.key === 'history.autoRecord' ? 6 : 3}
              >
                <div className="jf-app-setting">
                  <SettingField
                    dto={dto}
                    draft={drafts[dto.key as EditableSettingKey] ?? null}
                    error={errors[dto.key as EditableSettingKey]}
                    disabled={patch.isPending}
                    recordHour={page.recorder.recordHour}
                    onChange={(draft) => set(dto.key as EditableSettingKey, draft)}
                  />
                  <SettingNotice dto={dto} />
                  <UsedOn dto={dto} />
                </div>
              </GridItem>
              {dto.key === 'tax.marginalRate' ? (
                <GridItem span={12}>
                  <TaxSuggestion
                    suggestion={page.taxSuggestion}
                    draft={drafts['tax.marginalRate'] ?? null}
                    disabled={patch.isPending}
                    onUse={(percent) => set('tax.marginalRate', percent)}
                  />
                </GridItem>
              ) : null}
            </Fragment>
          ))}
        </Grid>
        {sum ? (
          <p
            className={sum.ok ? 'jf-app-sum jf-app-sum--go' : 'jf-app-sum jf-app-sum--check'}
            data-testid="allocation-sum"
          >
            {sum.text}
          </p>
        ) : null}
        {callout === 'workbook' ? (
          <Callout kind="important" title="From the workbook">
            <p>{SETTINGS_WORKBOOK_NOTE}</p>
          </Callout>
        ) : callout === 'kept' ? (
          <Callout kind="note" title="Import-safe">
            <p>{SETTINGS_KEPT_NOTE}.</p>
          </Callout>
        ) : null}
        <FormError message={formError} />
        <Cluster gap={3} className="jf-app-form-actions">
          <Button
            type="submit"
            variant="primary"
            icon={Save}
            disabled={pristine || patch.isPending}
            aria-busy={patch.isPending || undefined}
            aria-label={`Save ${group.label.toLowerCase()}`}
          >
            Save
          </Button>
          {!pristine ? (
            <Button
              variant="ghost"
              onClick={() => {
                setDrafts(draftsOf(settings));
                setErrors({});
                setFormError(null);
              }}
              disabled={patch.isPending}
            >
              Undo changes
            </Button>
          ) : null}
        </Cluster>
      </form>
    </Card>
  );
}

/** The server's notice under a field (stage-6.md §6.7: the access-age and super contribution notes). */
function SettingNotice({ dto }: { dto: SettingDto }): JSX.Element | null {
  if (!dto.notice) return null;
  return (
    <p className="jf-app-meta" data-testid={`notice-${dto.key}`}>
      {dto.notice}
    </p>
  );
}

/** "Used on Budget, Cash" as links; "Not used by the app" for the unused keys (§6.5 item 9). */
function UsedOn({ dto }: { dto: SettingDto }): JSX.Element | null {
  const pages = usedOnPages(dto);
  if (dto.group === 'unused') return <p className="jf-app-meta">{NOT_USED_TEXT}</p>;
  if (pages.length === 0) return null;
  return (
    <p className="jf-app-meta" data-testid={`used-on-${dto.key}`}>
      Used on{' '}
      {pages.map((page, i) => (
        <Fragment key={page.id}>
          {i > 0 ? ', ' : null}
          <Link to={page.path as '/'}>{page.title}</Link>
        </Fragment>
      ))}
    </p>
  );
}

interface SettingFieldProps {
  dto: SettingDto;
  draft: SettingDraft;
  error?: string;
  disabled: boolean;
  recordHour: number;
  onChange: (draft: SettingDraft) => void;
}

function SettingField({
  dto,
  draft,
  error,
  disabled,
  recordHour,
  onChange,
}: SettingFieldProps): JSX.Element {
  const hint = fieldHint(dto);
  const key = dto.key;
  // Read-only: the server-written cap FY, or anything not editable.
  if (!dto.editable || dto.lockedBy === 'server') {
    const text =
      dto.value === null
        ? 'Not set'
        : key === 'super.concessionalCapFy'
          ? `FY${String(dto.value)}–${String((Number(dto.value) + 1) % 100).padStart(2, '0')}`
          : String(dto.value);
    return (
      <div className="jf-field" data-testid={`readonly-${key}`}>
        <p className="jf-field__label">{dto.label}</p>
        <p className="jf-app-text-value">{text}</p>
        <p className="jf-field__hint">Set by the server with the cap override</p>
      </div>
    );
  }
  switch (dto.type) {
    case 'money':
      return (
        <MoneyField
          label={dto.label}
          value={typeof draft === 'number' ? draft : null}
          onChange={onChange}
          hint={hint ?? 'Leave empty to clear'}
          error={error}
          disabled={disabled}
        />
      );
    case 'ratio': {
      const bound = writeBound(key as EditableSettingKey);
      return (
        <NumberField
          label={dto.label}
          value={typeof draft === 'string' ? draft : ''}
          onChange={onChange}
          maxDp={4}
          suffix="%"
          allowNegative={bound !== null && bound.min < 0}
          hint={hint}
          error={error}
          disabled={disabled}
        />
      );
    }
    case 'integer':
      // A year (the birth year) is a plain four-digit number, never grouped ("1990", not "1,990").
      if ((dto.min ?? 0) >= 1900) {
        return (
          <TextField
            label={dto.label}
            value={typeof draft === 'string' ? draft : ''}
            onChange={onChange}
            maxLength={4}
            hint={hint}
            error={error}
            disabled={disabled}
          />
        );
      }
      return (
        <NumberField
          label={dto.label}
          value={typeof draft === 'string' ? draft : ''}
          onChange={onChange}
          maxDp={0}
          hint={hint}
          error={error}
          disabled={disabled}
        />
      );
    case 'date':
      return (
        <DateField
          label={dto.label}
          value={dateDraft(draft)}
          onChange={onChange}
          hint={hint ?? (dto.value ? undefined : 'Not set')}
          error={error}
          disabled={disabled}
        />
      );
    case 'boolean': {
      const locked = dto.lockedBy === 'env';
      const unset = draft === '' || draft === null;
      const checked = unset ? dto.defaultValue === true : draft === 'yes';
      const label = key === 'history.autoRecord' ? recordHourText(recordHour) : dto.label;
      return (
        <div className="jf-app-switch-setting">
          <Switch
            label={label}
            checked={checked}
            onChange={(on) => onChange(on ? 'yes' : 'no')}
            hint={locked ? ENV_LOCKED_TEXT : hint}
            disabled={disabled || locked}
          />
        </div>
      );
    }
    case 'enum': {
      const options: SelectOption[] = (dto.enumValues ?? []).map((value) => ({
        value,
        label: ENUM_LABELS[key]?.[value] ?? value,
      }));
      return (
        <Select
          label={dto.label}
          value={typeof draft === 'string' ? draft : ''}
          onChange={onChange}
          options={options}
          placeholder={
            dto.defaultValue !== null && key !== 'super.concessionalCapFy'
              ? `${settingText(key, dto.defaultValue) ?? 'Not set'} (default)`
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
