import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarCheck, Sparkles } from 'lucide-react'

import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import EventTypeCard from '../components/EventTypeCard'
import PlanningOverview from '../components/PlanningOverview'
import ProgressBar from '../components/ProgressBar'
import WelcomeSection from '../components/WelcomeSection'
import { EVENT_TYPES, eventTypeMeta, tintClasses } from '../constants/eventTypes'
import { eventApi } from '../services/eventApi'
import { formatDate, formatRelativeDays } from '../utils/dateValidation'
import { formatMoney } from '../utils/format'

/** Screen 1 — Home Dashboard, Option A (§7.3). */
export default function Dashboard() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState(null)
  const [recent, setRecent] = useState([])
  const [storageUnavailable, setStorageUnavailable] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const controller = new AbortController()
    setLoadError(null)

    // allSettled, not all: a failure in one request must not discard the other
    // one's result. The overview and the recent list are independently useful.
    const [stats, events] = await Promise.allSettled([
      eventApi.planningOverview({ signal: controller.signal }),
      eventApi.listEvents({ signal: controller.signal }),
    ])

    const failure =
      stats.status === 'rejected'
        ? stats.reason
        : events.status === 'rejected'
          ? events.reason
          : null

    if (failure?.name === 'AbortError') return

    setOverview(stats.status === 'fulfilled' ? stats.value : null)
    setRecent(
      events.status === 'fulfilled' && Array.isArray(events.value)
        ? events.value.slice(0, 3)
        : [],
    )

    // A missing database is an expected, explainable condition. Anything else
    // is a real error and must be surfaced — otherwise a user with saved plans
    // is silently told they have none.
    const isStorageIssue = Boolean(
      failure?.isStorageIssue || failure?.code === 'NETWORK_ERROR',
    )
    setStorageUnavailable(isStorageIssue)
    setLoadError(failure && !isStorageIssue ? failure : null)
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const startWithType = (eventType) =>
    navigate('/create', { state: { eventType } })

  const hasSaved = recent.length > 0

  return (
    <div className="space-y-10">
      <WelcomeSection />

      <PlanningOverview overview={overview} />

      {/* Event category cards (§7.3) */}
      <section aria-labelledby="categories-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="categories-heading"
              className="text-sm font-bold uppercase tracking-wide text-muted"
            >
              What are you planning?
            </h2>
            <p className="mt-1 text-sm text-muted">
              Pick a category to start — the plan adapts to the type you choose.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {EVENT_TYPES.map((type) => (
            <EventTypeCard
              key={type.value}
              type={type}
              variant="link"
              onSelect={startWithType}
            />
          ))}
        </div>
      </section>

      {/* Recently created events, when available (§7.3) */}
      <section aria-labelledby="recent-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2
            id="recent-heading"
            className="text-sm font-bold uppercase tracking-wide text-muted"
          >
            Recent plans
          </h2>
          {hasSaved && (
            <button
              type="button"
              onClick={() => navigate('/events')}
              className="btn-ghost -mr-2 text-sm"
            >
              View all
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {!loaded ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {[0, 1, 2].map((key) => (
              <div key={key} className="card-lav h-40 animate-pulse" />
            ))}
          </div>
        ) : loadError ? (
          <ErrorState
            error={loadError}
            onRetry={load}
            title="We could not load your saved plans"
          />
        ) : hasSaved ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((event) => {
              const meta = eventTypeMeta(event.event_type)
              const Icon = meta.icon
              const tint = tintClasses(event.event_type)
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/events/${event.id}`)}
                    className={`${tint.card} group h-full w-full p-5 text-left transition-all ${tint.hover}`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`grid size-10 shrink-0 place-items-center rounded-xl shadow-[0_1px_3px_rgba(37,33,58,0.06)] ${tint.icon}`}
                        aria-hidden="true"
                      >
                        <Icon className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-bold">{event.event_name}</h3>
                        <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted">
                          {event.event_type_label}
                        </p>
                      </div>
                    </div>

                    <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                      <div className="flex items-center gap-1.5">
                        <dt className="sr-only">Date</dt>
                        <CalendarCheck
                          className="size-4 text-muted"
                          aria-hidden="true"
                        />
                        <dd>{formatDate(event.event_date)}</dd>
                      </div>
                      <div>
                        <dt className="sr-only">Budget</dt>
                        <dd className="font-semibold">
                          {formatMoney(event.budget, event.currency)}
                        </dd>
                      </div>
                    </dl>

                    <p className="mt-1 text-xs text-muted">
                      {event.is_past
                        ? `Took place ${formatRelativeDays(event.event_date)}`
                        : `Happening ${formatRelativeDays(event.event_date)}`}
                    </p>

                    <div className="mt-4">
                      <ProgressBar
                        label="Checklist"
                        size="sm"
                        completed={event.checklist_progress.completed}
                        total={event.checklist_progress.total}
                        percent={event.checklist_progress.percent}
                      />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : storageUnavailable ? (
          <EmptyState
            icon={Sparkles}
            title="Saved events are not available right now"
            message="You can still create and view a full event plan — it just won't be stored. Check DATABASE_URL in backend/.env to enable saving."
            actionLabel="Create New Event"
          />
        ) : (
          <EmptyState />
        )}
      </section>
    </div>
  )
}
