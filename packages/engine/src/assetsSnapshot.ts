// The Stage 5 seam (stage-4.md §2.8): the live History columns of the three Stage 4 results, named as
// the `snapshots` table's columns (Q superValueCents … AK otherGainCents), plus the linked offsets
// (no History column yet: Stage 5 decides how a recorded month stores them).
import type {
  AssetsSnapshotColumns,
  OtherAssetsResult,
  PropertiesResult,
  SuperResult,
} from './types';

export function assetsSnapshotColumns(i: {
  otherAssets: OtherAssetsResult;
  super: SuperResult;
  property: PropertiesResult;
}): AssetsSnapshotColumns {
  const s = i.super.snapshot;
  const p = i.property.snapshot;
  const o = i.otherAssets.snapshot;
  return {
    superValueCents: s.superValueCents,
    superContribCents: s.superContribCents,
    superGainCents: s.superGainCents,
    superGainRatio: s.superGainRatio,
    propertyValueCents: p.propertyValueCents,
    propertyPurchaseCents: p.propertyPurchaseCents,
    propertyEquityCents: p.propertyEquityCents,
    propertyGainCents: p.propertyGainCents,
    mortgageBalanceCents: p.mortgageBalanceCents,
    mortgageInterestFeesCents: p.mortgageInterestFeesCents,
    mortgagePrincipalPaidCents: p.mortgagePrincipalPaidCents,
    propertyGainRatio: p.propertyGainRatio,
    otherValueCents: o.otherValueCents,
    otherGainCents: o.otherGainCents,
    mortgageOffsetCents: p.mortgageOffsetCents,
  };
}
