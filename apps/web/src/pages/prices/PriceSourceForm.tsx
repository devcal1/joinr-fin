// "Source": which provider prices an instrument, and under which symbol (stage-1.md §6.5).
import type { PriceItem, PriceProvider } from '@joinr/schema';
import { Button, Callout, Card, Cluster, Grid, GridItem, Select, TextField } from '@joinr/ui';
import { Save } from 'lucide-react';
import { useState, type FormEvent, type JSX } from 'react';
import { useSetPriceSource } from '../../api/hooks';
import { SYMBOL_MAX, splitApiErrors, validatePriceSource } from './validation';
import { escapeCancels } from '../../components/keyboard';

const PROVIDER_OPTIONS: { value: PriceProvider; label: string }[] = [
  { value: 'yahoo', label: 'Yahoo Finance' },
  { value: 'coingecko', label: 'CoinGecko' },
  { value: 'none', label: 'None (manual price only)' },
];

function symbolHint(provider: PriceProvider): string {
  if (provider === 'coingecko') return 'The CoinGecko id, e.g. bitcoin';
  if (provider === 'yahoo') return 'The Yahoo symbol, e.g. ABC.AX';
  return 'No symbol: set a manual price instead.';
}

export interface PriceSourceFormProps {
  item: PriceItem;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function PriceSourceForm({ item, onDone, onCancel }: PriceSourceFormProps): JSX.Element {
  const [provider, setProvider] = useState<PriceProvider>(item.provider);
  const [symbol, setSymbol] = useState(item.providerSymbol ?? '');
  const [symbolError, setSymbolError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const save = useSetPriceSource();

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(null);
    const problem = validatePriceSource(provider, symbol);
    setSymbolError(problem ?? undefined);
    if (problem) return;
    save.mutate(
      {
        instrumentId: item.instrumentId,
        input: { provider, providerSymbol: provider === 'none' ? null : symbol.trim() },
      },
      {
        onSuccess: () => onDone(`Price source saved for ${item.symbol}.`),
        onError: (error) => {
          const split = splitApiErrors(error, ['providerSymbol', 'provider'] as const);
          setSymbolError(split.fields.providerSymbol);
          setFormError(
            [split.fields.provider, split.form]
              .filter((text): text is string => Boolean(text))
              .join(' ') || null,
          );
        },
      },
    );
  };

  return (
    <Card
      as="section"
      title={`Price source · ${item.symbol}`}
      subtitle={item.kind === 'crypto' ? 'Crypto is priced by CoinGecko id.' : undefined}
    >
      <form
        className="jf-app-form"
        onSubmit={onSubmit}
        onKeyDown={escapeCancels(onCancel, save.isPending)}
        noValidate
        aria-label={`Price source for ${item.symbol}`}
      >
        <Grid>
          <GridItem span={4}>
            <Select
              label="Provider"
              value={provider}
              options={PROVIDER_OPTIONS}
              onChange={(value) => {
                setProvider(value as PriceProvider);
                setSymbolError(undefined);
              }}
              disabled={save.isPending}
            />
          </GridItem>
          <GridItem span={4}>
            <TextField
              label={provider === 'coingecko' ? 'CoinGecko id' : 'Symbol'}
              value={provider === 'none' ? '' : symbol}
              onChange={setSymbol}
              maxLength={SYMBOL_MAX}
              hint={symbolHint(provider)}
              error={symbolError}
              required={provider !== 'none'}
              disabled={save.isPending || provider === 'none'}
            />
          </GridItem>
        </Grid>
        {formError ? (
          <Callout kind="do-not" title="Not saved">
            <p>{formError}</p>
          </Callout>
        ) : null}
        <Cluster gap={3}>
          <Button
            type="submit"
            variant="primary"
            icon={Save}
            disabled={save.isPending}
            aria-busy={save.isPending || undefined}
          >
            Save
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={save.isPending}>
            Cancel
          </Button>
        </Cluster>
      </form>
    </Card>
  );
}
