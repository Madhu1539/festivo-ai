import { useMemo } from 'react'
import { Lightbulb } from 'lucide-react'

import { formatMoney } from '../utils/format'

/** §7.5 E — Personalized Ideas, grouped by theme. */
export default function PersonalizedIdeas({ ideas, currency = 'INR' }) {
  const grouped = useMemo(() => {
    const groups = new Map()
    for (const idea of ideas ?? []) {
      const key = idea.category || 'Ideas'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(idea)
    }
    return [...groups.entries()]
  }, [ideas])

  if (!ideas?.length) {
    return (
      <p className="rounded-xl border border-butter-200 bg-butter-50 px-4 py-6 text-center text-sm text-muted">
        No ideas were generated. Try regenerating the plan.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {grouped.map(([category, categoryIdeas]) => (
        <section key={category} aria-label={category}>
          <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wide text-muted">
            {category}
          </h3>

          <ul className="grid gap-3 sm:grid-cols-2">
            {categoryIdeas.map((idea) => (
              <li
                key={idea.id}
                className="rounded-2xl border border-butter-200/70 bg-white/85 p-4 transition-all hover:border-butter-200 hover:shadow-[0_2px_12px_rgba(160,106,6,0.12)]"
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-butter-50 text-butter-600 ring-1 ring-butter-200"
                    aria-hidden="true"
                  >
                    <Lightbulb className="size-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold">{idea.title}</h4>
                    {idea.description && (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted">
                        {idea.description}
                      </p>
                    )}
                    {idea.estimated_cost != null && (
                      <p className="mt-2.5">
                        <span className="chip border border-butter-200 bg-butter-50 text-muted">
                          Rough estimate:{' '}
                          <span className="font-bold text-butter-600">
                            {formatMoney(idea.estimated_cost, currency)}
                          </span>
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="text-xs leading-relaxed text-muted">
        Ideas are suggestions generated from your event details. Any figures shown are
        rough estimates, not verified local pricing.
      </p>
    </div>
  )
}
