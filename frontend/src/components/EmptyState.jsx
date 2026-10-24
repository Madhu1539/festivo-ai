import { Link } from 'react-router-dom'
import { CalendarPlus, Sparkles } from 'lucide-react'

/** Empty state (§18.1) — never fabricated statistics (§7.3). */
export default function EmptyState({
  title = 'Your celebrations start here.',
  message = 'Create your first event plan and Festivo AI will build the budget, timeline, checklist, and ideas for you.',
  actionLabel = 'Create New Event',
  actionTo = '/create',
  icon: Icon = Sparkles,
  children,
}) {
  return (
    <section className="card-lav p-8 text-center sm:p-10">
      <span
        className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-lav-600 shadow-[0_2px_8px_rgba(109,74,255,0.12)] ring-1 ring-lav-200"
        aria-hidden="true"
      >
        <Icon className="size-7" />
      </span>
      <h2 className="mt-5 text-lg font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
        {message}
      </p>

      {actionTo && (
        <Link to={actionTo} className="btn-primary mt-6">
          <CalendarPlus className="size-4" aria-hidden="true" />
          {actionLabel}
        </Link>
      )}
      {children}
    </section>
  )
}
