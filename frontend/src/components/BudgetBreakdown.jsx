import { ShieldCheck } from 'lucide-react'

import { chartColor, formatMoney, formatPercent } from '../utils/format'

/** §7.5 B — Category-wise breakdown. */
export default function BudgetBreakdown({ budget, guestCount }) {
  const currency = budget.currency ?? 'INR'

  if (!budget.categories?.length) {
    return (
      <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-6 text-center text-sm text-muted">
        No budget categories were generated. Try regenerating the plan.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-sky-200 bg-white/70 p-4">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">
          Estimated budget allocation by category
        </caption>
        <thead>
          <tr className="border-b border-sky-200 text-left">
            <th scope="col" className="pb-2.5 pr-3 font-semibold text-muted">
              Category
            </th>
            <th scope="col" className="pb-2.5 pr-3 text-right font-semibold text-muted">
              Estimate
            </th>
            <th scope="col" className="pb-2.5 pr-3 text-right font-semibold text-muted">
              Share
            </th>
            {guestCount > 0 && (
              <th
                scope="col"
                className="pb-2.5 text-right font-semibold text-muted"
              >
                Per guest
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {budget.categories.map((category, index) => (
            <tr
              key={category.id}
              className={`border-b border-sky-200/50 last:border-0 ${
                category.is_reserve ? 'bg-mint-50/80' : ''
              }`}
            >
              <th scope="row" className="py-3 pr-3 text-left font-medium">
                <span className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: category.is_reserve
                        ? 'var(--color-mint-600)'
                        : chartColor(index),
                    }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{category.category}</span>
                      {category.is_reserve && (
                        <span className="chip border border-mint-200 bg-mint-50 text-mint-600">
                          <ShieldCheck className="size-3" aria-hidden="true" />
                          Reserve, not spending
                        </span>
                      )}
                    </span>
                    {category.description && (
                      <span className="mt-0.5 block text-xs font-normal leading-relaxed text-muted">
                        {category.description}
                      </span>
                    )}
                  </span>
                </span>
              </th>

              <td className="py-3 pr-3 text-right font-semibold tabular-nums">
                {formatMoney(category.estimated_amount, currency)}
              </td>

              <td className="py-3 pr-3 text-right tabular-nums text-muted">
                {formatPercent(category.percent_of_budget, 1)}
              </td>

              {guestCount > 0 && (
                <td className="py-3 text-right tabular-nums text-muted">
                  {formatMoney(
                    Number(category.estimated_amount) / guestCount,
                    currency,
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-sky-200 font-bold">
            <th scope="row" className="pt-3 pr-3 text-left">
              Total allocated
            </th>
            <td className="pt-3 pr-3 text-right tabular-nums">
              {formatMoney(budget.total_allocated, currency)}
            </td>
            <td className="pt-3 pr-3 text-right tabular-nums">
              {formatPercent(
                budget.total_budget > 0
                  ? (budget.total_allocated / budget.total_budget) * 100
                  : 0,
                1,
              )}
            </td>
            {guestCount > 0 && (
              <td className="pt-3 text-right tabular-nums">
                {formatMoney(budget.total_allocated / guestCount, currency)}
              </td>
            )}
          </tr>
        </tfoot>
      </table>

      <p className="mt-4 text-xs leading-relaxed text-muted">
        Amounts are AI-generated estimates for planning only. They are not quotations
        and no vendor has been contacted or price-checked.
      </p>
    </div>
  )
}
