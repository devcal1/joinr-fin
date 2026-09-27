// /records: every record table by group, with row counts (stage-1.md §6.3).
import { RECORD_GROUPS, type RecordEntitySummary } from '@joinr/schema';
import { Callout, Card, Grid, GridItem, KeyValueTable, PageHeader, SectionBar } from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';
import { useRecordsIndex } from '../../api/hooks';
import { QueryStates } from '../../components/QueryStates';
import { plural } from '../../formatting';

export const RECORDS_SUBTITLE = 'Imported data, read-only';

function EntityLink({ entity }: { entity: RecordEntitySummary }): JSX.Element {
  const rows = plural(entity.count, 'row');
  return (
    <Link
      to="/records/$entity"
      params={{ entity: entity.id }}
      className="jf-app-entity-count"
      aria-label={`${entity.label}: ${rows}`}
    >
      {rows}
    </Link>
  );
}

export function RecordsIndexPage(): JSX.Element {
  const query = useRecordsIndex();
  const entities = query.data?.entities ?? [];
  const empty = query.data !== undefined && entities.every((entity) => entity.count === 0);

  return (
    <>
      <PageHeader title="Records" subtitle={RECORDS_SUBTITLE} />
      <QueryStates
        query={query}
        loading="Loading the record tables…"
        layout="table"
        errorTitle="Could not load the records"
      />
      {empty ? (
        <Callout kind="note">
          <p>
            Nothing imported yet. <Link to="/import">Run an import.</Link>
          </p>
        </Callout>
      ) : null}
      {query.data ? (
        <Grid>
          {RECORD_GROUPS.map((group) => {
            const members = entities.filter((entity) => entity.group === group.id);
            if (members.length === 0) return null;
            const headingId = `records-group-${group.id}`;
            return (
              <GridItem key={group.id} span={6}>
                <section className="jf-app-records-group" aria-labelledby={headingId}>
                  {/* Violet: reference / raw data (STYLE_GUIDE §5, D33). */}
                  <SectionBar id={headingId} title={group.label} role="reference" />
                  <Card padding="none">
                    <KeyValueTable
                      caption={`${group.label} tables`}
                      items={members.map((entity) => ({
                        label: entity.label,
                        value: <EntityLink entity={entity} />,
                        numeric: true,
                      }))}
                    />
                  </Card>
                </section>
              </GridItem>
            );
          })}
        </Grid>
      ) : null}
    </>
  );
}
