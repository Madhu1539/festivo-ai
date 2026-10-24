import { AlertTriangle, CheckCircle2, Circle, Flag } from 'lucide-react'

import { priorityStyle } from '../constants/eventTypes'
import { formatDate, formatRelativeDays, groupByMonth } from '../utils/dateValidation'

/** §7.5 C — Timeline, chronological with completion status. */
export default function TimelineSection({ items, onToggle }) {
  if (!items?.length) {
    return (
      <p className="rounded-xl border border-peach-200 bg-peach-50 px-4 py-6 text-center text-sm text-muted">
        No timeline tasks were generated. Try regenerating the plan.
      </p>
    )
  }

  const groups = groupByMonth(items)
  const completed = items.filter((item) => item.is_completed).length

  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {completed} of {items.length} timeline tasks complete.
      </p>

      <div className="space-y-7">
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
              {group.label}
            </h3>

            <ol className="relative space-y-3 border-l-2 border-peach-200 pl-6">
              {group.items.map((item) => {
                const priority = priorityStyle(item.priority)
                const Icon = item.is_completed ? CheckCircle2 : Circle

                return (
                  <li key={item.id} className="relative">
                    {/* Timeline node */}
                    <span
                      className={[
                        'absolute -left-[1.84rem] top-4 size-3 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(37,33,58,0.08)]',
                        item.is_completed
                          ? 'bg-mint-600'
                          : item.is_overdue
                            ? 'bg-rose-600'
                            : 'bg-peach-600',
                      ].join(' ')}
                      aria-hidden="true"
                    />

                    <div
                      className={[
                        'rounded-2xl border p-4 transition-colors',
                        item.is_completed
                          ? 'border-mint-200 bg-mint-50/70'
                          : item.is_overdue
                            ? 'border-rose-200 bg-rose-50'
                            : 'border-peach-200/70 bg-white/80',
                      ].join(' ')}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => onToggle?.(item.id, !item.is_completed)}
                          aria-pressed={item.is_completed}
                          aria-label={`Mark "${item.title}" as ${
                            item.is_completed ? 'not complete' : 'complete'
                          }`}
                          className={`mt-0.5 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                            item.is_completed
                              ? 'text-mint-600'
                              : 'text-muted hover:text-peach-600'
                          }`}
                        >
                          <Icon className="size-5" aria-hidden="true" />
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4
                              className={`font-semibold ${
                                item.is_completed
                                  ? 'text-muted line-through decoration-muted/50'
                                  : ''
                              }`}
                            >
                              {item.title}
                            </h4>

                            <span className={`chip ${priority.className}`}>
                              <Flag className="size-3" aria-hidden="true" />
                              {priority.short}
                            </span>

                            {item.is_follow_up && (
                              <span className="chip border border-lav-200 bg-lav-50 text-lav-600">
                                After the event
                              </span>
                            )}

                            {item.is_overdue && !item.is_completed && (
                              <span className="chip border border-rose-200 bg-white text-rose-600">
                                <AlertTriangle className="size-3" aria-hidden="true" />
                                Overdue
                              </span>
                            )}
                          </div>

                          {item.description && (
                            <p className="mt-1.5 text-sm leading-relaxed text-muted">
                              {item.description}
                            </p>
                          )}

                          <p className="mt-2 text-xs font-semibold text-muted">
                            <time dateTime={item.due_date}>
                              {formatDate(item.due_date)}
                            </time>
                            <span className="font-normal">
                              {' '}
                              · {formatRelativeDays(item.due_date)}
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}
