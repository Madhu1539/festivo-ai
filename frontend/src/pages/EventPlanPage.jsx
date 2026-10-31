import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Lightbulb,
  Wallet,
} from 'lucide-react'

import BudgetBreakdown from '../components/BudgetBreakdown'
import BudgetOverview from '../components/BudgetOverview'
import ErrorState from '../components/ErrorState'
import EventSummaryCard from '../components/EventSummaryCard'
import LoadingState from '../components/LoadingState'
import NoticeList from '../components/NoticeList'
import PersonalizedIdeas from '../components/PersonalizedIdeas'
import PlanActions from '../components/PlanActions'
import PlanAlerts from '../components/PlanAlerts'
import SectionCard from '../components/SectionCard'
import TimelineSection from '../components/TimelineSection'
import VendorChecklist from '../components/VendorChecklist'
import {
  usePlan,
  withChecklistItem,
  withTimelineItem,
} from '../context/PlanContext'
import { inputFromSavedPlan } from '../forms/eventFormModel'
import { eventApi } from '../services/eventApi'
import { printPlan } from '../utils/exportPlan'

const SECTIONS = [
  { id: 'budget', label: 'Budget', icon: Wallet },
  { id: 'timeline', label: 'Timeline', icon: CalendarClock },
  { id: 'checklist', label: 'Checklist', icon: ClipboardList },
  { id: 'ideas', label: 'Ideas', icon: Lightbulb },
]

/**
 * Screen 3 — AI-Generated Plan Dashboard (§7.5).
 *
 * Serves both the freshly generated draft (/plan) and a saved event
 * (/events/:id). Checklist edits are local for a draft and persisted for a
 * saved plan (§15.6).
 */
export default function EventPlanPage() {
  const { eventId } = useParams()
  const navigate = useNavigate()
  const { draft, setDraft, updatePlan, markSaved } = usePlan()

  const isSaved = Boolean(eventId)

  const [savedPlan, setSavedPlan] = useState(null)
  const [loading, setLoading] = useState(isSaved)
  const [loadError, setLoadError] = useState(null)

  const [regenerating, setRegenerating] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState(null)
  const [busyIds, setBusyIds] = useState(() => new Set())
  const [status, setStatus] = useState('')

  /**
   * Write a message into the polite live region.
   *
   * A live region only announces when its text node actually changes, so
   * ticking two items in a row with the same message would be silent. The
   * alternating zero-width space forces a distinct value without altering
   * what is spoken.
   */
  const announce = useCallback((message) => {
    setStatus((current) =>
      current.endsWith('\u200b') ? message : `${message}\u200b`,
    )
  }, [])

  const headingRef = useRef(null)

  const plan = isSaved ? savedPlan : draft?.plan
  // Memoised: this builds a fresh object (including a new Date), and it would
  // otherwise be rebuilt on every render, including every checklist toggle.
  const input = useMemo(
    () => (isSaved ? inputFromSavedPlan(savedPlan) : draft?.input),
    [isSaved, savedPlan, draft],
  )

  // --- Load a saved plan --------------------------------------------------
  useEffect(() => {
    if (!isSaved) return
    const controller = new AbortController()

    setLoading(true)
    setLoadError(null)
    eventApi
      .getEvent(eventId, { signal: controller.signal })
      .then((result) => setSavedPlan(result.plan))
      .catch((error) => {
        if (error?.name !== 'AbortError') setLoadError(error)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [eventId, isSaved])

  // --- No draft to show: send the user somewhere useful -------------------
  useEffect(() => {
    if (!isSaved && !draft && !regenerating) {
      navigate('/create', { replace: true })
    }
  }, [draft, isSaved, navigate, regenerating])

  // Move focus to the heading when a plan first appears, so screen-reader users
  // land on the result rather than at the top of the document.
  //
  // Keyed on the plan's IDENTITY, not the plan object: every checklist and
  // timeline toggle produces a new plan object, and depending on `plan` here
  // would re-fire this effect on each tick and yank focus out of the checkbox
  // the user is working in.
  const planKey = plan ? (isSaved ? eventId : 'draft') : null
  useEffect(() => {
    if (planKey) headingRef.current?.focus()
  }, [planKey])

  // --- Checklist / timeline completion (§11.3, §7.5 F) -------------------
  const withBusy = useCallback(async (itemId, work) => {
    setBusyIds((current) => new Set(current).add(itemId))
    try {
      await work()
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(itemId)
        return next
      })
    }
  }, [])

  const toggleChecklistItem = useCallback(
    (itemId, isCompleted) => {
      // Optimistic update so progress moves immediately (§11.3).
      if (isSaved) setSavedPlan((current) => withChecklistItem(current, itemId, isCompleted))
      else updatePlan((current) => withChecklistItem(current, itemId, isCompleted))

      announce(isCompleted ? 'Task marked complete.' : 'Task marked incomplete.')

      if (!isSaved) return

      withBusy(itemId, async () => {
        try {
          await eventApi.updateChecklistItem(eventId, itemId, isCompleted)
        } catch (error) {
          // Roll back on failure and tell the user.
          setSavedPlan((current) => withChecklistItem(current, itemId, !isCompleted))
          setActionError(error)
        }
      })
    },
    [announce, eventId, isSaved, updatePlan, withBusy],
  )

  const toggleTimelineItem = useCallback(
    (itemId, isCompleted) => {
      if (isSaved) setSavedPlan((current) => withTimelineItem(current, itemId, isCompleted))
      else updatePlan((current) => withTimelineItem(current, itemId, isCompleted))

      announce(
        isCompleted ? 'Timeline task marked complete.' : 'Timeline task marked incomplete.',
      )

      if (!isSaved) return

      withBusy(itemId, async () => {
        try {
          await eventApi.updateTimelineItem(eventId, itemId, isCompleted)
        } catch (error) {
          setSavedPlan((current) => withTimelineItem(current, itemId, !isCompleted))
          setActionError(error)
        }
      })
    },
    [announce, eventId, isSaved, updatePlan, withBusy],
  )

  // --- Plan actions -------------------------------------------------------
  const handleEdit = () => {
    navigate('/create', { state: { editInput: input } })
  }

  const handleRegenerate = async () => {
    if (!input || regenerating) return
    setActionError(null)
    setRegenerating(true)
    try {
      const fresh = await eventApi.regeneratePlan(input)
      setDraft(input, fresh)
      setSavedId(null)
      setStatus('Plan regenerated.')
      if (isSaved) navigate('/plan')
      else window.scrollTo({ top: 0 })
    } catch (error) {
      setActionError(error)
    } finally {
      setRegenerating(false)
    }
  }

  const handleSave = async () => {
    if (!input || !plan || saving) return
    setActionError(null)
    setSaving(true)
    try {
      const result = await eventApi.saveEvent(input, plan)
      setSavedId(result.id)
      markSaved(result.id)
      setStatus('Plan saved to your events.')
    } catch (error) {
      setActionError(error)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!eventId) return
    setActionError(null)
    try {
      await eventApi.deleteEvent(eventId)
      navigate('/events', { replace: true })
    } catch (error) {
      setActionError(error)
    }
  }

  const completedTimeline = useMemo(
    () => plan?.timeline?.filter((item) => item.is_completed).length ?? 0,
    [plan],
  )

  // --- Render -------------------------------------------------------------
  if (regenerating) {
    return (
      <div className="py-6">
        <LoadingState
          title="Regenerating your event plan…"
          message="We're building a fresh plan from your current details."
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="py-6">
        <LoadingState
          title="Loading your saved plan…"
          message="Fetching the plan and your checklist progress."
          steps={['Reading your event', 'Re-checking the budget totals']}
        />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="py-6">
        <ErrorState
          error={loadError}
          title="We could not open that plan"
          onRetry={() => navigate(0)}
          secondaryAction={
            <button
              type="button"
              onClick={() => navigate('/events')}
              className="btn-secondary"
            >
              Back to my events
            </button>
          }
        />
      </div>
    )
  }

  if (!plan) return null

  const currency = plan.budget.currency ?? 'INR'

  return (
    <div className="space-y-6">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {status}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(isSaved ? '/events' : '/')}
          className="btn-ghost -ml-2 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {isSaved ? 'My events' : 'Dashboard'}
        </button>

        {!isSaved && savedId && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Saved to My Events
          </p>
        )}
      </div>

      <div ref={headingRef} tabIndex={-1}>
        <EventSummaryCard summary={plan.event_summary} />
      </div>

      {/* Plan actions (§7.5 F) */}
      <div className="card-lav flex flex-wrap items-center justify-between gap-4 p-4 sm:px-5">
        <nav aria-label="Jump to section" className="flex flex-wrap gap-1.5">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="btn-ghost px-3 py-2 text-xs"
            >
              <section.icon className="size-3.5" aria-hidden="true" />
              {section.label}
            </a>
          ))}
        </nav>

        <PlanActions
          onEdit={handleEdit}
          onRegenerate={handleRegenerate}
          onSave={isSaved ? undefined : handleSave}
          onDownload={() => printPlan(plan)}
          onDelete={isSaved ? handleDelete : undefined}
          regenerating={regenerating}
          saving={saving}
          saved={Boolean(savedId)}
        />
      </div>

      {actionError && (
        <ErrorState
          error={actionError}
          title="That action did not complete"
          onRetry={() => setActionError(null)}
          retryLabel="Dismiss"
        />
      )}

      <PlanAlerts
        budget={plan.budget}
        onRegenerate={handleRegenerate}
        onEdit={handleEdit}
        busy={regenerating}
      />

      <SectionCard
        id="budget"
        title="Budget overview"
        description="Every figure below is recalculated by Festivo AI, not taken from the model's own arithmetic."
        icon={Wallet}
        tone="lavender"
        badge={
          plan.budget.is_valid ? (
            <span className="chip border border-mint-200 bg-mint-50 text-mint-600">
              <CheckCircle2 className="size-3" aria-hidden="true" />
              Totals verified
            </span>
          ) : (
            <span className="chip border border-rose-200 bg-rose-50 text-rose-600">
              Over budget
            </span>
          )
        }
      >
        <BudgetOverview budget={plan.budget} />
      </SectionCard>

      <SectionCard
        title="Category-wise breakdown"
        description="Estimated amounts per category, including the emergency reserve."
        icon={Wallet}
        tone="sky"
      >
        <BudgetBreakdown
          budget={plan.budget}
          guestCount={plan.event_summary.guest_count}
        />
      </SectionCard>

      <SectionCard
        id="timeline"
        title="Preparation timeline"
        description="Tasks in chronological order, counted back from your event date."
        icon={CalendarClock}
        tone="peach"
        badge={
          plan.timeline.length > 0 && (
            <span className="chip border border-peach-200 bg-white/80 text-peach-600">
              {completedTimeline} of {plan.timeline.length} done
            </span>
          )
        }
      >
        <TimelineSection items={plan.timeline} onToggle={toggleTimelineItem} />
      </SectionCard>

      <SectionCard
        id="checklist"
        title="Vendor checklist"
        description="The services and arrangements this event needs. Tick items off as you confirm them."
        icon={ClipboardList}
        tone="mint"
      >
        <VendorChecklist
          items={plan.vendor_checklist}
          progress={plan.checklist_progress}
          onToggle={toggleChecklistItem}
          busyIds={busyIds}
        />
      </SectionCard>

      <SectionCard
        id="ideas"
        title="Personalized ideas"
        description="Suggestions matched to your theme, budget, guest count, and preferences."
        icon={Lightbulb}
        tone="butter"
      >
        <PersonalizedIdeas ideas={plan.personalized_ideas} currency={currency} />
      </SectionCard>

      <NoticeList
        assumptions={plan.assumptions}
        warnings={plan.warnings}
        disclaimer={plan.estimate_disclaimer}
      />
    </div>
  )
}

