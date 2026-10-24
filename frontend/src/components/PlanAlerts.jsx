import { AlertOctagon, Pencil, RotateCw, Scale } from 'lucide-react'

import { formatMoney } from '../utils/format'

/**
 * Over-budget state (§18.5) and the rescale notice (§9.5).
 *
 * The user's own budget is never altered — only the generated allocation is,
 * and that is stated explicitly.
 */
export default function OverBudgetBanner({ budget, onRegenerate, onEdit, busy }) {
  const currency = budget.currency ?? 'INR'

  if (budget.is_over_budget) {
    return (
      <section
        className="card-rose p-5"
        role="alert"
      >
        <div className="flex flex-wrap items-start gap-4">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-rose-600 shadow-[0_1px_3px_rgba(194,63,108,0.15)] ring-1 ring-rose-200"
            aria-hidden="true"
          >
            <AlertOctagon className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-danger">
              This plan is over your budget
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink/90">
              The generated allocation comes to{' '}
              <strong>{formatMoney(budget.total_allocated, currency)}</strong>, which
              is <strong>{formatMoney(budget.overage, currency)}</strong> more than
              your budget of{' '}
              <strong>{formatMoney(budget.total_budget, currency)}</strong>. Your
              budget has not been changed.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {onRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={busy}
                  className="btn-primary"
                >
                  <RotateCw className="size-4" aria-hidden="true" />
                  Regenerate within budget
                </button>
              )}
              {onEdit && (
                <button type="button" onClick={onEdit} className="btn-secondary">
                  <Pencil className="size-4" aria-hidden="true" />
                  Raise the budget
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    )
  }

  if (budget.was_rescaled) {
    return (
      <section className="card-butter p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-butter-600 shadow-[0_1px_3px_rgba(160,106,6,0.15)] ring-1 ring-butter-200"
            aria-hidden="true"
          >
            <Scale className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-warning">
              Category amounts were fitted to your budget
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink/90">
              The first allocation did not add up to{' '}
              {formatMoney(budget.total_budget, currency)}, so each category was
              scaled proportionally until it did. Your budget was not changed.
              Regenerate if you would prefer a fresh allocation.
            </p>

            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={busy}
                className="btn-secondary mt-4"
              >
                <RotateCw className="size-4" aria-hidden="true" />
                Regenerate plan
              </button>
            )}
          </div>
        </div>
      </section>
    )
  }

  return null
}
