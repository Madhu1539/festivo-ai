import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarCheck,
  CalendarX,
  Database,
  MapPin,
  Trash2,
  Users,
} from 'lucide-react'

import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import ProgressBar from '../components/ProgressBar'
import { eventTypeMeta, tintClasses } from '../constants/eventTypes'
import { eventApi } from '../services/eventApi'
import { formatDate, formatRelativeDays } from '../utils/dateValidation'
import { formatMoney } from '../utils/format'

/** Screen 4 — Saved Events (§7.6). */
export default function SavedEvents() {
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async (signal) => {
    setLoading(true)
    setError(null)
    try {
      const result = await eventApi.listEvents({ signal })
      setEvents(Array.isArray(result) ? result : [])
    } catch (caught) {
      // An abort is a deliberate cancellation, not a failure to report.
      if (caught?.name === 'AbortError') return
      setError(caught)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const remove = async (id, name) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    setDeletingId(id)
    try {
      await eventApi.deleteEvent(id)
      setEvents((current) => current.filter((event) => event.id !== id))
    } catch (caught) {
      setError(caught)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          My events
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Plans you have saved, with your checklist progress.
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
          <Database className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          Saved to the database configured for this backend. There are no user
          accounts, so anyone with access to this backend can see these plans.
        </p>
      </header>

      {error && (
        <ErrorState
          error={error}
          title="We could not load your events"
          onRetry={() => load()}
        />
      )}

      {loading ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((key) => (
            <li key={key} className="card-lav h-48 animate-pulse" />
          ))}
        </ul>
      ) : events.length === 0 ? (
        !error && (
          <EmptyState
            title="No saved plans yet"
            message="Generate a plan and choose Save Plan to keep it here with your checklist progress."
          />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => {
            const meta = eventTypeMeta(event.event_type)
            const Icon = meta.icon
            const DateIcon = event.is_past ? CalendarX : CalendarCheck
            const tint = tintClasses(event.event_type)

            return (
              <li
                key={event.id}
                className={`${tint.card} flex flex-col p-5 transition-all ${tint.hover}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-xl shadow-[0_1px_3px_rgba(37,33,58,0.06)] ${tint.icon}`}
                    aria-hidden="true"
                  >
                    <Icon className="size-5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-bold" title={event.event_name}>
                      {event.event_name}
                    </h2>
                    <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-muted">
                      {event.event_type_label}
                    </p>
                  </div>

                  {event.is_past && (
                    <span className="chip shrink-0 border border-hairline bg-white/80 text-muted">
                      Past
                    </span>
                  )}
                </div>

                <dl className="mt-4 space-y-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    <dt className="sr-only">Date</dt>
                    <DateIcon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                    <dd>
                      {formatDate(event.event_date)}
                      <span className="ml-1.5 text-xs text-muted">
                        ({formatRelativeDays(event.event_date)})
                      </span>
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="sr-only">Location</dt>
                    <MapPin className="size-4 shrink-0 text-muted" aria-hidden="true" />
                    <dd className="truncate" title={event.location}>
                      {event.location}
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="sr-only">Guests</dt>
                    <Users className="size-4 shrink-0 text-muted" aria-hidden="true" />
                    <dd>
                      {event.guest_count} guests ·{' '}
                      <span className="font-semibold">
                        {formatMoney(event.budget, event.currency)}
                      </span>
                    </dd>
                  </div>
                </dl>

                <div className="mt-4">
                  <ProgressBar
                    label="Planning progress"
                    size="sm"
                    completed={event.checklist_progress.completed}
                    total={event.checklist_progress.total}
                    percent={event.checklist_progress.percent}
                  />
                </div>

                <div className="mt-5 flex items-center gap-2 border-t border-white/80 pt-4">
                  <button
                    type="button"
                    onClick={() => navigate(`/events/${event.id}`)}
                    className="btn-primary flex-1"
                  >
                    Open Plan
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(event.id, event.event_name)}
                    disabled={deletingId === event.id}
                    aria-label={`Delete ${event.event_name}`}
                    className="btn-ghost text-danger hover:bg-rose-100 hover:text-danger"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
