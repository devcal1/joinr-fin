// /records/$entity: one record table, read-only, built from the registry columns (stage-1.md §6.3).
import {
  RECORD_ENTITIES,
  RECORD_ENTITY_IDS,
  RECORD_GROUPS,
  RECORDS_PAGE_CAP,
  type RecordEntityId,
  type RecordRow,
} from '@joinr/schema';
import {
  Callout,
  ColumnTable,
  Icon,
  MEDIA,
  PageHeader,
  Select,
  useMediaQuery,
  type SelectOption,
} from '@joinr/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useMemo, type JSX } from 'react';
import { useRecordsPage } from '../../api/hooks';
import { QueryStates } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { recordTableColumns } from './cells';

export const EMPTY_TABLE_MESSAGE = 'No rows in this table.';

const SWITCHER_OPTIONS: SelectOption[] = RECORD_GROUPS.flatMap((group) =>
  RECORD_ENTITY_IDS.filter((id) => RECORD_ENTITIES[id].group === group.id).map((id) => ({
    value: id,
    label: `${group.label} · ${RECORD_ENTITIES[id].label}`,
  })),
);

/** Phone: a select. Wider screens: every table as a link, grouped. */
function EntitySwitcher({ current }: { current: RecordEntityId }): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const navigate = useNavigate();
  if (phone) {
    return (
      <Select
        label="Table"
        value={current}
        options={SWITCHER_OPTIONS}
        onChange={(value) => void navigate({ to: '/records/$entity', params: { entity: value } })}
      />
    );
  }
  return (
    <nav className="jf-app-switcher" aria-label="Record tables">
      {RECORD_GROUPS.map((group) => (
        <div key={group.id} className="jf-app-switcher__group">
          <p className="jf-app-switcher__label">{group.label}</p>
          <ul className="jf-app-switcher__list">
            {RECORD_ENTITY_IDS.filter((id) => RECORD_ENTITIES[id].group === group.id).map((id) => (
              <li key={id}>
                <Link
                  to="/records/$entity"
                  params={{ entity: id }}
                  className="jf-app-switcher__link"
                  aria-current={id === current ? 'page' : undefined}
                >
                  {RECORD_ENTITIES[id].label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function RecordsEntityPage({ entity }: { entity: RecordEntityId }): JSX.Element {
  const meta = RECORD_ENTITIES[entity];
  const query = useRecordsPage(entity);
  const columns = useMemo(
    () => recordTableColumns(query.data?.columns ?? meta.columns, entity),
    [query.data?.columns, meta.columns, entity],
  );
  const rows: readonly RecordRow[] = query.data?.rows ?? [];
  const count = query.data?.entity.count ?? rows.length;

  return (
    <>
      <PageHeader
        title="Records"
        subtitle={meta.label}
        actions={
          <Link to="/records" className="jf-app-back-link">
            <Icon icon={ArrowLeft} />
            All tables
          </Link>
        }
      />
      <EntitySwitcher current={entity} />
      <QueryStates
        query={query}
        loading={`Loading ${meta.label.toLowerCase()}…`}
        layout="table"
        errorTitle={`Could not load ${meta.label.toLowerCase()}`}
      />
      {query.data ? (
        <section className="jf-app-records-table" aria-label={meta.label}>
          <p className="jf-app-meta">{plural(count, 'row')}</p>
          {rows.length >= RECORDS_PAGE_CAP ? (
            <Callout kind="note">
              <p>
                Showing the first {RECORDS_PAGE_CAP.toLocaleString('en-AU')} rows of{' '}
                {count.toLocaleString('en-AU')}.
              </p>
            </Callout>
          ) : null}
          <ColumnTable
            // A new entity starts with its own default sort.
            key={entity}
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            caption={meta.label}
            initialSort={meta.defaultSort}
            emptyMessage={EMPTY_TABLE_MESSAGE}
          />
        </section>
      ) : null}
    </>
  );
}
