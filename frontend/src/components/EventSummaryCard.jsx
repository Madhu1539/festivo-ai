import {
  CalendarDays,
  MapPin,
  Palette,
  PiggyBank,
  Sparkles,
  Users,
} from 'lucide-react'

import { eventTypeMeta } from '../constants/eventTypes'
import { formatLongDate, formatRelativeDays } from '../utils/dateValidation'
import { formatMoney } from '../utils/format'

function Detail({ icon: Icon, label, value, hint }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-semibold text-ink" title={value}>
        {value}
      </dd>
      {hint && <dd className="mt-0.5 text-xs text-muted">{hint}</dd>}
    </div>
  )
}

/** §7.5 A — Event Summary. */
export default function EventSummaryCard({ summary }) {
  const meta = eventTypeMeta(summary.event_type)
  const Icon = meta.icon

  return (
    <section
      className="card-lav overflow-hidden"
      aria-labelledby="summary-heading"
    >
      <div className="flex flex-wrap items-start gap-4 border-b border-lav-200/70 bg-linear-to-r from-lav-50 to-white px-5 py-5 sm:px-6">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white shadow-[0_2px_6px_rgba(37,33,58,0.08)]"
          style={{ color: meta.accent }}
          aria-hidden="true"
        >
          <Icon className="size-6" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {summary.event_type_label}
          </p>
          <h1
            id="summary-heading"
            className="mt-0.5 truncate text-2xl font-extrabold tracking-tight"
            title={summary.event_name}
          >
            {summary.event_name}
          </h1>
        </div>

        <div className="shrink-0 rounded-xl bg-white/80 px-3.5 py-2 text-right shadow-[0_1px_3px_rgba(37,33,58,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Budget
          </p>
          <p className="text-2xl font-extrabold tracking-tight text-brand-deep">
            {formatMoney(summary.budget, summary.currency)}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-5 px-5 py-5 sm:grid-cols-3 sm:px-6 lg:grid-cols-5">
        <Detail
          icon={CalendarDays}
          label="Date"
          value={formatLongDate(summary.event_date)}
          hint={formatRelativeDays(summary.event_date)}
        />
        <Detail icon={MapPin} label="Location" value={summary.location} />
        <Detail
          icon={Users}
          label="Guests"
          value={String(summary.guest_count)}
          hint={`${formatMoney(summary.budget_per_guest, summary.currency)} per guest`}
        />
        <Detail
          icon={Palette}
          label="Theme"
          value={summary.theme || 'AI suggested'}
        />
        <Detail
          icon={PiggyBank}
          label="Currency"
          value={summary.currency}
          hint="All figures are estimates"
        />
      </dl>

      {summary.preferences?.length > 0 && (
        <div className="border-t border-lav-200/60 bg-white/50 px-5 py-4 sm:px-6">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Your preferences
          </p>
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {summary.preferences.map((preference) => (
              <li
                key={preference}
                className="chip border border-lav-200 bg-white text-lav-600"
              >
                {preference}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.is_accelerated && (
        <p className="border-t border-butter-200 bg-butter-50 px-5 py-3 text-sm font-medium text-warning sm:px-6">
          Your event is {formatRelativeDays(summary.event_date)} — this is an
          accelerated plan with compressed deadlines.
        </p>
      )}
    </section>
  )
}
