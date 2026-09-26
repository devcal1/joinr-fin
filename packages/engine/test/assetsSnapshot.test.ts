// The Stage 5 seam (stage-4.md §2.8; §7.3 step 4): assetsSnapshotColumns merges the three Stage 4
// results' live History figures into the `snapshots` column names. Generic, round figures only.
import { describe, expect, it } from 'vitest';
import {
  assetsSnapshotColumns,
  computeOtherAssets,
  computeProperty,
  computeSuper,
} from '../src/index';
import { D, ratio } from './helpers';

const AS_OF = '2026-07-20';

const otherAssets = computeOtherAssets({
  asOf: AS_OF,
  assets: [
    {
      id: 1,
      purchaseDate: '2025-07-20',
      units: '1',
      legacySoldUnits: '0',
      unitCost: '100',
      currency: 'AUD',
      purchaseFxRate: null,
      pricing: { source: 'manual', unitPrice: '120', priceAsOf: '2026-07-01' },
      sales: [],
    },
  ],
  fxRates: {},
  assumedDate: null,
  stalePriceDays: 90,
  snapshots: [],
  chart: { unit: 'monthly', count: null },
});

const superResult = computeSuper({
  asOf: AS_OF,
  snapshots: [{ periodMonth: '2026-06', runDate: '2026-06-30', superValueCents: 1_000_000 }],
  funds: [
    {
      id: 1,
      receivesSg: true,
      archived: false,
      balances: [
        { id: 1, asOf: '2026-06-30', balanceCents: 1_000_000, transferInCents: null },
        { id: 2, asOf: '2026-07-15', balanceCents: 1_050_000, transferInCents: null },
      ],
    },
  ],
  contributions: [{ id: 1, fundId: 1, date: '2026-07-10', kind: 'after_tax', amountCents: 10_000 }],
  sgOverrides: [],
  grossAnnualSalaryCents: null,
  jobStartDate: null,
  sgRatio: null,
  contributionsTaxRatio: '0.15',
  marginalTaxRatio: '0.3',
  importedContributionType: 'salary_sacrifice',
  concessionalCapOverride: null,
  chart: { unit: 'monthly', count: null },
});

const property = computeProperty({
  asOf: AS_OF,
  properties: [
    {
      id: 1,
      purchaseDate: '2020-07-01',
      isPrimaryResidence: false,
      purchaseValueCents: 40_000_000,
      netRentToDateCents: 0,
      valuations: [{ id: 1, asOf: '2026-06-30', valueCents: 50_000_000 }],
    },
  ],
  loans: [
    {
      id: 1,
      propertyId: 1,
      startDate: null,
      startBalanceCents: 32_000_000,
      annualRate: '0.06',
      compoundingPerYear: 12,
      paymentCents: 250_000,
      paymentFrequency: 'monthly',
      entries: [{ id: 1, asOf: '2026-06-30', balanceCents: 30_000_000, repaymentsCents: null }],
      offsets: [{ accountId: 7, balanceCents: 500_000 }],
    },
  ],
  snapshots: [],
  chart: { unit: 'monthly', count: null },
});

describe('assetsSnapshotColumns (§2.8)', () => {
  it('names each live figure as its History column (Q … AK) plus the linked offsets', () => {
    expect(assetsSnapshotColumns({ otherAssets, super: superResult, property })).toEqual({
      // Q–T: Σ latest balances, the provisional contributions' take-home cost and derived gain.
      superValueCents: 1_050_000,
      superContribCents: 10_000,
      superGainCents: 40_000, // a change of 500 less the 100 paid in
      superGainRatio: ratio(D(40_000).div(1_050_000 - 40_000)),
      // X–AE: the property and its mortgage (equity net of the offset, D67).
      propertyValueCents: 50_000_000,
      propertyPurchaseCents: 40_000_000,
      propertyEquityCents: 50_000_000 - 30_000_000 + 500_000,
      propertyGainCents: 10_000_000,
      mortgageBalanceCents: -30_000_000,
      mortgageInterestFeesCents: 0,
      mortgagePrincipalPaidCents: 2_000_000,
      propertyGainRatio: '0.25',
      // AJ, AK.
      otherValueCents: 12_000,
      otherGainCents: 2_000,
      // No History column yet (Stage 5 decides how to store it).
      mortgageOffsetCents: 500_000,
    });
  });

  it('copies the results’ own snapshot objects', () => {
    const cols = assetsSnapshotColumns({ otherAssets, super: superResult, property });
    expect(cols).toMatchObject(superResult.snapshot);
    expect(cols).toMatchObject(otherAssets.snapshot);
    expect(cols).toMatchObject(property.snapshot);
  });
});
