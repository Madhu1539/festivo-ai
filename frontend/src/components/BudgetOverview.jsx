import { lazy, Suspense, useMemo } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  PiggyBank,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react'

import { formatMoney, formatPercent, sliceColor } from '../utils/format'
import { verifyBudgetTotals } from '../utils/budgetValidation'

// Recharts is ~200 kB gzipped and is only used by this one chart, so it is
// fetched on demand rather than on first paint of every route.
const BudgetDonut = lazy(() => import('./BudgetDonut'))

function Figure({ icon: Icon, label, value, hint, tone = 'default' }) {
  const tones = {
    default: {
      card: 'border-sky-200 bg-linear-to-b from-sky-50 to-white',
      icon: 'bg-white text-sky-600 ring-1 ring-sky-200',
    },
    brand: {
      card: 'border-lav-200 bg-linear-to-b from-lav-100 to-white',
      icon: 'bg-white text-lav-600 ring-1 ring-lav-200',
    },
    success: {
      card: 'border-mint-200 bg-linear-to-b from-mint-50 to-white',
      icon: 'bg-white text-mint-600 ring-1 ring-mint-200',
    },
    warning: {
      card: 'border-butter-200 bg-linear-to-b from-butter-50 to-white',
      icon: 'bg-white text-butter-600 ring-1 ring-butter-200',
    },
    danger: {
      card: 'border-rose-200 bg-linear-to-b from-rose-50 to-white',
      icon: 'bg-white text-rose-600 ring-1 ring-rose-200',
    },
  }
  const palette = tones[tone] ?? tones.default

  return (
    <div
      className={`rounded-2xl border p-4 shadow-[0_1px_3px_rgba(37,33,58,0.04)] ${palette.card}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-lg ${palette.icon}`}
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </p>
      </div>
      <p className="mt-2.5 text-xl font-extrabold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  )
}

/**
 * §7.5 B — Budget Overview.
 *
 * Planned expenditure and the emergency reserve are shown as separate figures so
 * they are never conflated (§9.3). Every number comes from the backend's
 * recalculation, and the category sum is re-checked here as a second guard.
 */
export default function BudgetOverview({ budget }) {
  const currency = budget.currency ?? 'INR'

  const slices = useMemo(
    () =>
      budget.categories
        .filter((category) => Number(category.estimated_amount) > 0)
        .map((category) => ({
          name: category.category,
          value: Number(category.estimated_amount),
          percent: Number(category.percent_of_budget),
          isReserve: category.is_reserve,
        })),
    [budget.categories],
  )

  const unallocated = Number(budget.unallocated ?? 0)
  const chartData = useMemo(() => {
    if (unallocated <= 0) return slices
    return [
      ...slices,
      {
        name: 'Unallocated',
        value: unallocated,
        percent:
          budget.total_budget > 0 ? (unallocated / budget.total_budget) * 100 : 0,
        isUnallocated: true,
      },
    ]
  }, [slices, unallocated, budget.total_budget])

  const check = verifyBudgetTotals(budget)
  const total = Number(budget.total_budget ?? 0)
  const plannedShare = total > 0 ? (Number(budget.planned_expenditure) / total) * 100 : 0
  const reserveShare = total > 0 ? (Number(budget.emergency_reserve) / total) * 100 : 0
  const unallocatedShare = Math.max(0, 100 - plannedShare - reserveShare)

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          icon={Wallet}
          label="Total budget"
          value={formatMoney(budget.total_budget, currency)}
          hint="The amount you entered"
          tone="brand"
        />
        <Figure
          icon={TrendingUp}
          label="Planned expenditure"
          value={formatMoney(budget.planned_expenditure, currency)}
          hint={`${formatPercent(plannedShare, 1)} of budget, excluding reserve`}
        />
        <Figure
          icon={ShieldCheck}
          label="Emergency reserve"
          value={formatMoney(budget.emergency_reserve, currency)}
          hint={
            Number(budget.emergency_reserve) > 0
              ? `${formatPercent(reserveShare, 1)} held back for surprises`
              : 'No reserve was allocated'
          }
          tone={Number(budget.emergency_reserve) > 0 ? 'success' : 'default'}
        />
        <Figure
          icon={PiggyBank}
          label={budget.is_over_budget ? 'Over budget by' : 'Unallocated'}
          value={formatMoney(
            budget.is_over_budget ? budget.overage : unallocated,
            currency,
          )}
          hint={
            budget.is_over_budget
              ? 'Allocation exceeds your budget'
              : unallocated > 0
                ? 'Still free to spend or save'
                : 'Your budget is fully allocated'
          }
          tone={
            budget.is_over_budget ? 'danger' : unallocated > 0 ? 'warning' : 'success'
          }
        />
      </div>

      {/* Allocation bar: planned vs reserve vs unallocated */}
      <div className="panel p-4">
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-lav-100 ring-1 ring-lav-200/60"
          role="img"
          aria-label={`Allocation: ${formatPercent(plannedShare, 1)} planned expenditure, ${formatPercent(reserveShare, 1)} emergency reserve, ${formatPercent(unallocatedShare, 1)} unallocated.`}
        >
          <div
            className="bg-linear-to-r from-brand to-chart-5"
            style={{ width: `${plannedShare}%` }}
          />
          <div
            className="bg-linear-to-r from-mint-600 to-chart-7"
            style={{ width: `${reserveShare}%` }}
          />
          <div className="bg-lav-200" style={{ width: `${unallocatedShare}%` }} />
        </div>
        <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs font-medium">
          <li className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full bg-linear-to-r from-brand to-chart-5"
              aria-hidden="true"
            />
            Planned {formatPercent(plannedShare, 1)}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-mint-600" aria-hidden="true" />
            Reserve {formatPercent(reserveShare, 1)}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-lav-200" aria-hidden="true" />
            Unallocated {formatPercent(unallocatedShare, 1)}
          </li>
        </ul>
      </div>

      {/* Expense distribution chart */}
      {chartData.length > 0 && (
        <div className="grid items-center gap-5 rounded-2xl border border-lav-200 bg-linear-to-br from-white via-lav-50 to-sky-50 p-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
          {/* min-w-0 lets the chart shrink instead of forcing the page to scroll. */}
          <Suspense
            fallback={
              <div
                className="h-56 min-w-0 animate-pulse rounded-full bg-lav-100/70"
                aria-hidden="true"
              />
            }
          >
            <BudgetDonut chartData={chartData} currency={currency} />
          </Suspense>

          <div className="min-w-0">
            <p className="mb-3 text-sm font-bold">Where the money goes</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {chartData.map((slice, index) => (
                <li key={slice.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: sliceColor(slice, index) }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate" title={slice.name}>
                    {slice.name}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatPercent(slice.percent, 1)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Arithmetic verification notice */}
      {budget.is_valid && check.ok ? (
        <p className="flex items-start gap-2 rounded-xl border border-mint-200 bg-mint-50 px-3.5 py-2.5 text-xs text-ink/80">
          <CheckCircle2
            className="mt-px size-4 shrink-0 text-mint-600"
            aria-hidden="true"
          />
          Totals verified: planned expenditure plus reserve is{' '}
          {formatMoney(budget.total_allocated, currency)} against a budget of{' '}
          {formatMoney(budget.total_budget, currency)}.
        </p>
      ) : (
        !check.ok && (
          <p className="flex items-start gap-2 rounded-xl border border-butter-200 bg-butter-50 px-3.5 py-2.5 text-xs text-warning">
            <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden="true" />
            Category amounts sum to {formatMoney(check.categorySum, currency)}, which
            does not match the reported allocation. Please regenerate the plan.
          </p>
        )
      )}
    </div>
  )
}
