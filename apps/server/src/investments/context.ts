// One request's view of the investments data (stage-2.md §4.5 steps 1–3). From Stage 3 the
// investment pages use the finance context (cashflow/context.ts): the same rows, prices and
// memoised engine results, plus the live cash, budget and savings the timing chain reads
// (stage-3.md §4.5). These names are kept for the Stage 2 modules and tests.
export {
  createFinanceContext as createInvestmentsContext,
  enginePrices,
  type FinanceContext as InvestmentsContext,
  type FinanceDeps as InvestmentsDeps,
} from '../cashflow/context';
