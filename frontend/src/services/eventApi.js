/**
 * Backend client. Every failure is normalized into the §15.7 error shape so the
 * UI can always show a friendly message plus a retry action (§18.4).
 */

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

export class ApiError extends Error {
  constructor({ code, message, details = [], status }) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
    this.status = status
  }

  /** True when the user can reasonably retry the same request. */
  get isRetryable() {
    return [
      'AI_UNAVAILABLE',
      'AI_TIMEOUT',
      'AI_RATE_LIMITED',
      'AI_INVALID_OUTPUT',
      'BUDGET_VALIDATION_FAILED',
      'NETWORK_ERROR',
      'INTERNAL_ERROR',
    ].includes(this.code)
  }

  get isConfigIssue() {
    return this.code === 'AI_NOT_CONFIGURED'
  }

  get isStorageIssue() {
    return this.code === 'STORAGE_UNAVAILABLE'
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message:
        'Could not reach the Festivo AI server. Check that the backend is running and try again.',
      status: 0,
    })
  }

  if (response.status === 204) return null

  let payload = null
  let parseFailed = false
  try {
    payload = await response.json()
  } catch {
    parseFailed = true
  }

  if (!response.ok) {
    const envelope = payload?.error ?? {}
    throw new ApiError({
      code: envelope.code ?? 'INTERNAL_ERROR',
      message:
        envelope.message ?? 'Something went wrong. Please try again in a moment.',
      details: envelope.details ?? [],
      status: response.status,
    })
  }

  // A 2xx whose body is not JSON is a broken response, not an empty one.
  // Returning null here would push the failure downstream into a render.
  if (parseFailed) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: 'The server sent a response we could not read. Please try again.',
      status: response.status,
    })
  }

  return payload
}

// Every method accepts `{ signal }` so callers can cancel in flight on unmount
// or on rapid navigation; without it, a resolved fetch sets state on a
// component that is already gone.
export const eventApi = {
  health: ({ signal } = {}) => request('/health', { signal }),

  generatePlan: (event, { signal } = {}) =>
    request('/events/generate-plan', { method: 'POST', body: event, signal }),

  regeneratePlan: (event, { signal } = {}) =>
    request('/events/regenerate-plan', { method: 'POST', body: event, signal }),

  planningOverview: ({ signal } = {}) => request('/events/overview', { signal }),

  saveEvent: (event, plan, { signal } = {}) =>
    request('/events', { method: 'POST', body: { event, plan }, signal }),

  listEvents: ({ signal } = {}) => request('/events', { signal }),

  getEvent: (id, { signal } = {}) => request(`/events/${id}`, { signal }),

  deleteEvent: (id, { signal } = {}) =>
    request(`/events/${id}`, { method: 'DELETE', signal }),

  updateChecklistItem: (eventId, itemId, isCompleted, { signal } = {}) =>
    request(`/events/${eventId}/checklist/${itemId}`, {
      method: 'PATCH',
      body: { is_completed: isCompleted },
      signal,
    }),

  updateTimelineItem: (eventId, itemId, isCompleted, { signal } = {}) =>
    request(`/events/${eventId}/timeline/${itemId}`, {
      method: 'PATCH',
      body: { is_completed: isCompleted },
      signal,
    }),
}
