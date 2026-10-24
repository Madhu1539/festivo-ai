import { CalendarClock, ListChecks, PiggyBank, Sparkles } from 'lucide-react'
import { formatCompactMoney, formatPercent } from '../utils/format'

const TILE_TONES = {
  lavender: {
    card: 'card-lav',
    icon: 'bg-white text-lav-600 ring-1 ring-lav-200',
    value: 'text-brand-deep',
  },
  sky: {
    card: 'card-sky',
    icon: 'bg-white text-sky-600 ring-1 ring-sky-200',
    value: 'text-sky-600',
  },
  mint: {
    card: 'card-mint',
    icon: 'bg-white text-mint-600 ring-1 ring-mint-200',
    value: 'text-mint-600',
  },
  peach: {
    card: 'card-peach',
    icon: 'bg-white text-peach-600 ring-1 ring-peach-200',
    value: 'text-peach-600',
  },
}

function StatTile({ icon: Icon, label, value, hint, tone }) {
  const palette = TILE_TONES[tone] ?? TILE_TONES.lavender

  return (
    <div className={`${palette.card} p-5`}>
      <span
        className={`grid size-10 place-items-center rounded-xl shadow-[0_1px_3px_rgba(37,33,58,0.06)] ${palette.icon}`}
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <p className={`mt-3.5 text-2xl font-extrabold tracking-tight ${palette.value}`}>
        {value}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-ink">{label}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

/**
 * Planning overview (§7.3). Only renders real saved data — when nothing is
 * saved the dashboard shows an empty state instead of sample numbers.
 */
export default function PlanningOverview({ overview }) {
  if (!overview?.persistence_enabled || !overview.total_events) return null

  const currency = overview.currency ?? 'INR'

  return (
    <section aria-label="Planning overview">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">
        Your planning overview
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Sparkles}
          tone="lavender"
          label="Events planned"
          value={overview.total_events}
          hint="Saved plans in your database"
        />
        <StatTile
          icon={CalendarClock}
          tone="sky"
          label="Still upcoming"
          value={overview.upcoming_events}
          hint={
            overview.upcoming_events === overview.total_events
              ? 'All your events are ahead of you'
              : `${overview.total_events - overview.upcoming_events} already past`
          }
        />
        <StatTile
          icon={PiggyBank}
          tone="mint"
          label="Total planned budget"
          value={formatCompactMoney(overview.total_planned_budget, currency)}
          hint="Across all saved plans"
        />
        <StatTile
          icon={ListChecks}
          tone="peach"
          label="Checklist progress"
          value={formatPercent(overview.average_progress)}
          hint="Tasks ticked off across all plans"
        />
      </div>
    </section>
  )
}
