// @joinr/ui core: tokens, formatters, layout, content and form components (stage-0 plan §7.1–7.4).
// brand and charts import from here only through this barrel.

export * from './tokens';
export * from './format';
export { cx, type ClassValue } from './cx';
export { useMediaQuery } from './hooks';

export {
  AppShell,
  type AppLinkProps,
  type AppShellProps,
  type NavGroup,
  type NavItem,
} from './layout/AppShell';
export { PageHeader, type PageHeaderProps } from './layout/PageHeader';
export {
  Grid,
  GridItem,
  type GridItemProps,
  type GridProps,
  type Span,
  type TabletSpan,
} from './layout/Grid';
export { Icon, type IconProps } from './layout/Icon';
export { Cluster, Stack, type ClusterProps, type Gap, type StackProps } from './layout/Stack';

export { SectionBar, type SectionBarProps, type SectionRole } from './content/SectionBar';
export { Card, type CardProps } from './content/Card';
export { Callout, type CalloutKind, type CalloutProps } from './content/Callout';
export { KeyValueTable, type KeyValueItem, type KeyValueTableProps } from './content/KeyValueTable';
export {
  StatTile,
  type DeltaDirection,
  type DeltaTone,
  type StatDelta,
  type StatTileProps,
} from './content/StatTile';
export {
  StatusBadge,
  statusTone,
  type StatusBadgeProps,
  type StatusKind,
  type StatusTone,
} from './content/StatusBadge';
export { Pill, type PillProps, type PillTone } from './content/Pill';
export { StepCard, type StepCardProps } from './content/StepCard';
export { ImageFrame, type ImageFrameProps } from './content/ImageFrame';
export { Amount, type AmountProps } from './content/Amount';
export {
  METER_TONE_WORDS,
  Meter,
  meterFill,
  meterStatus,
  meterStatusText,
  type MeterKind,
  type MeterProps,
  type MeterStatus,
} from './content/Meter';

export {
  ColumnTable,
  type ColumnTableColumn,
  type ColumnTableProps,
  type ColumnTableTotal,
} from './table/ColumnTable';

export { Button, type ButtonProps } from './forms/Button';
export type { FieldBaseProps } from './forms/Field';
export { TextField, type TextFieldProps } from './forms/TextField';
export {
  MoneyField,
  MONEY_INVALID_MESSAGE,
  MONEY_NEGATIVE_MESSAGE,
  type MoneyFieldProps,
} from './forms/MoneyField';
export {
  NumberField,
  NUMBER_NEGATIVE_MESSAGE,
  numberInvalidMessage,
  type NumberFieldProps,
} from './forms/NumberField';
export { DateField, DATE_INVALID_MESSAGE, type DateFieldProps } from './forms/DateField';
export { Select, type SelectOption, type SelectProps } from './forms/Select';
export { Checkbox, Switch, type CheckboxProps, type SwitchProps } from './forms/Checkbox';
