import { useMemo } from 'react'
import { Check, Flag, Info } from 'lucide-react'

import ProgressBar from './ProgressBar'
import { priorityStyle } from '../constants/eventTypes'

/**
 * §7.5 D — Vendor Checklist.
 *
 * A checklist item is a task to arrange a service. It never implies a vendor has
 * been contacted or booked (§11.3, §5.3).
 */
export default function VendorChecklist({ items, progress, onToggle, busyIds }) {
  const grouped = useMemo(() => {
    const groups = new Map()
    for (const item of items ?? []) {
      const key = item.category || 'General'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    return [...groups.entries()]
  }, [items])

  // Empty state rather than a divide-by-zero progress bar (§11.4).
  if (!items?.length) {
    return (
      <p className="rounded-xl border border-mint-200 bg-mint-50 px-4 py-6 text-center text-sm text-muted">
        No checklist items were generated. Try regenerating the plan.
      </p>
    )
  }

  const total = progress?.total ?? items.length
  const completed = progress?.completed ?? items.filter((i) => i.is_completed).length

  return (
    <div>
      <ProgressBar
        label="Checklist progress"
        completed={completed}
        total={total}
        percent={progress?.percent}
      />

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {completed} of {total} checklist items complete.
      </p>

      <div className="mt-6 space-y-6">
        {grouped.map(([category, categoryItems]) => (
          <section key={category} aria-label={category}>
            <h3 className="mb-2.5 flex items-baseline gap-2 text-xs font-bold uppercase tracking-wide text-muted">
              {category}
              <span className="font-medium normal-case tracking-normal">
                {categoryItems.filter((i) => i.is_completed).length}/
                {categoryItems.length}
              </span>
            </h3>

            <ul className="space-y-2">
              {categoryItems.map((item) => {
                const priority = priorityStyle(item.priority)
                const busy = busyIds?.has(item.id)

                return (
                  <li key={item.id}>
                    <label
                      className={[
                        'flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-all',
                        item.is_completed
                          ? 'border-mint-200 bg-mint-50/80'
                          : 'border-mint-200/60 bg-white/85 hover:border-mint-200 hover:shadow-[0_2px_10px_rgba(21,131,90,0.1)]',
                        busy ? 'opacity-60' : '',
                      ].join(' ')}
                    >
                      <span className="relative mt-0.5 flex shrink-0 items-center">
                        <input
                          type="checkbox"
                          checked={item.is_completed}
                          // Deliberately not `disabled` while saving. A
                          // disabled control cannot hold focus, so the browser
                          // would blur it mid-interaction and drop a keyboard
                          // user back to the top of the document on every
                          // tick. The optimistic update already shows the new
                          // state, and a failed save rolls it back, so there is
                          // nothing to protect by locking the input.
                          aria-busy={busy || undefined}
                          onChange={(event) =>
                            onToggle?.(item.id, event.target.checked)
                          }
                          className="peer size-5 appearance-none rounded-md border border-mint-600/70 bg-white
                            transition-colors checked:border-mint-600 checked:bg-mint-600
                            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        />
                        <Check
                          className="pointer-events-none absolute left-0.5 size-4 text-white opacity-0 peer-checked:opacity-100"
                          strokeWidth={3}
                          aria-hidden="true"
                        />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span
                            className={`font-semibold ${
                              item.is_completed
                                ? 'text-muted line-through decoration-muted/50'
                                : ''
                            }`}
                          >
                            {item.title}
                          </span>
                          <span className={`chip ${priority.className}`}>
                            <Flag className="size-3" aria-hidden="true" />
                            {priority.short}
                          </span>
                        </span>

                        {item.description && (
                          <span className="mt-1.5 block text-sm leading-relaxed text-muted">
                            {item.description}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-5 flex items-start gap-2 rounded-xl border border-mint-200 bg-white/70 px-3.5 py-3 text-xs leading-relaxed text-muted">
        <Info className="mt-px size-4 shrink-0" aria-hidden="true" />
        These are the services to arrange. Nothing here has been booked, quoted, or
        reserved on your behalf — you still contact and confirm each vendor yourself.
      </p>
    </div>
  )
}
