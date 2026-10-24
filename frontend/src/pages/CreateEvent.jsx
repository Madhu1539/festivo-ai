import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import ErrorState from '../components/ErrorState'
import EventForm, {
  EMPTY_FORM,
  fromEventInput,
  toEventInput,
  validateForm,
} from '../components/EventForm'
import LoadingState from '../components/LoadingState'
import { usePlan } from '../context/PlanContext'
import { eventApi } from '../services/eventApi'
import { focusFirstInvalidAsync } from '../utils/focus'

/** Screen 2 — Create Event (§7.4). */
export default function CreateEvent() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setDraft, rememberInput, lastInput } = usePlan()

  // Entry points: a dashboard category card, or "Edit Event Details" from a plan.
  const presetType = location.state?.eventType
  const editInput = location.state?.editInput

  const [values, setValues] = useState(() => {
    if (editInput) return fromEventInput(editInput)
    if (presetType) return { ...EMPTY_FORM, event_type: presetType }
    return { ...EMPTY_FORM }
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const headingRef = useRef(null)
  const abortRef = useRef(null)
  const formRef = useRef(null)

  useEffect(() => {
    headingRef.current?.focus()
    return () => abortRef.current?.abort()
  }, [])

  /**
   * Move the user to the first field that failed validation.
   *
   * Deferred past the pending commit: `setErrors` is asynchronous, so the
   * `aria-invalid` attributes this depends on are not in the DOM yet at the
   * moment it is called.
   */
  const focusFirstInvalidField = useCallback(() => {
    focusFirstInvalidAsync(
      () => formRef.current,
      () => headingRef.current,
    )
  }, [])

  const handleChange = useCallback((name, value) => {
    // `value` may be an updater so callers can safely toggle list fields.
    setValues((current) => ({
      ...current,
      [name]: typeof value === 'function' ? value(current[name]) : value,
    }))
    // Clear a field error as soon as the user edits that field.
    setErrors((current) => {
      if (!current[name]) return current
      const next = { ...current }
      delete next[name]
      return next
    })
  }, [])

  const submit = useCallback(
    async (formValues) => {
      const validationErrors = validateForm(formValues)
      setErrors(validationErrors)

      if (Object.keys(validationErrors).length > 0) {
        focusFirstInvalidField()
        return
      }

      const input = toEventInput(formValues)
      // Keep the submitted values so a failure never loses them (§18.4).
      rememberInput(input)
      setError(null)
      setSubmitting(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const plan = await eventApi.generatePlan(input, { signal: controller.signal })
        setDraft(input, plan)
        navigate('/plan', { replace: true })
      } catch (caught) {
        if (caught.name === 'AbortError') return
        setError(caught)
        // Surface server-side field errors inline where we can (§15.7 details).
        if (Array.isArray(caught.details) && caught.details.length > 0) {
          const serverErrors = {}
          for (const detail of caught.details) {
            if (detail?.field && detail?.message) {
              serverErrors[detail.field] = detail.message
            }
          }
          if (Object.keys(serverErrors).length > 0) {
            setErrors(serverErrors)
            focusFirstInvalidField()
          }
        }
      } finally {
        setSubmitting(false)
        abortRef.current = null
      }
    },
    [focusFirstInvalidField, navigate, rememberInput, setDraft],
  )

  const handleSubmit = (event) => {
    event.preventDefault()
    if (submitting) return // Disable duplicate submissions (§7.4, §18.2).
    submit(values)
  }

  if (submitting) {
    return (
      <div className="py-6">
        <LoadingState />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <button
        type="button"
        onClick={() => navigate('/')}
        className="btn-ghost -ml-2 mb-4 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to dashboard
      </button>

      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        {editInput ? 'Edit your event details' : 'Tell us about your celebration'}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
        {editInput
          ? 'Change anything below and generate an updated plan.'
          : "A few details are all we need. We'll turn them into a budget, timeline, checklist, and ideas."}
      </p>

      {error && (
        <div className="mt-6">
          <ErrorState
            error={error}
            title="We could not generate your plan"
            onRetry={() => submit(values)}
            retryLabel="Generate again"
            secondaryAction={
              <button
                type="button"
                onClick={() => setError(null)}
                className="btn-secondary"
              >
                Edit details
              </button>
            }
          />
          <p className="mt-3 text-center text-sm text-muted">
            Your event details are still filled in below.
          </p>
        </div>
      )}

      <div className="mt-7" ref={formRef}>
        <EventForm
          values={values}
          errors={errors}
          onChange={handleChange}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      </div>

      {lastInput && !error && (
        <p className="sr-only" aria-live="polite">
          Form ready for submission.
        </p>
      )}
    </div>
  )
}
