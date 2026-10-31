/**
 * Backend client. Every failure is normalized into the §15.7 error shape so the
 * UI can always show a friendly message plus a retry action (§18.4).
 */

/**
 * Normalise the configured API base URL.
 *
 * `VITE_API_BASE_URL` is inlined at build time and set by hand in a hosting
 * dashboard, which makes two slips very easy — and both fail opaquely, because
 * the request reaches a real server that simply has no such route and answers
 * 404 "The requested item could not be found":
 *
 *   - a trailing slash, producing `/api//events/...`
 *   - omitting `/api` entirely, producing `/events/...`
 *
 * The backend always mounts its routers under `/api` (see `main.py`), so there
 * is exactly one correct suffix and appending it when absent is deterministic
 * rather than a guess.
 */
export function normalizeBaseUrl(raw) {
  const value = (raw ?? '').trim().replace(/\/+$/, '')
  if (!value) return '/api'
  return value.endsWith('/api') ? value : `${value}/api`
}

const BASE = normalizeBaseUrl(import.meta.env?.VITE_API_BASE_URL)

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
      // The current backend never emits this one; kept so an older or
      // future deployment that does is still handled as retryable.
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

  /** True when signing in would fix it. */
  get isAuthIssue() {
    return this.code === 'AUTH_REQUIRED'
  }
}

const TOKEN_KEY = 'festivo_auth_token'

/**
 * The session token, kept in localStorage.
 *
 * Not an httpOnly cookie, because the frontend and backend are on different
 * registrable domains: an auth cookie would be a third-party cookie, which
 * Safari blocks outright and Chrome is phasing out. It would work in
 * development and fail for real users.
 *
 * The cost is that script running on this origin can read it, so the app must
 * not introduce an XSS hole. The token is opaque and server-side revocable,
 * so signing out invalidates it immediately rather than leaving it valid
 * until it expires.
 */
export const authToken = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      // Private-browsing modes can throw on access rather than return null.
      return null
    }
  },
  set(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      // Non-fatal: the session simply will not survive a reload.
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      // Nothing useful to do; the caller is signing out regardless.
    }
  },
}

/** Called when the server rejects our token, so the app can send us to login. */
let onUnauthorized = null
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler
}

async function request(path, { method = 'GET', body, signal, auth = true } = {}) {
  const token = auth ? authToken.get() : null
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
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

  if (response.status === 401 && auth) {
    // The token is gone, expired, or revoked. Drop it so the UI stops
    // pretending we are signed in, then let the app redirect.
    authToken.clear()
    onUnauthorized?.()
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
  health: ({ signal } = {}) => request('/health', { signal, auth: false }),

  // --- Authentication ---
  register: (email, password, { signal } = {}) =>
    request('/auth/register', {
      method: 'POST',
      body: { email, password },
      signal,
      auth: false,
    }),

  login: (email, password, { signal } = {}) =>
    request('/auth/login', {
      method: 'POST',
      body: { email, password },
      signal,
      auth: false,
    }),

  logout: ({ signal } = {}) =>
    request('/auth/logout', { method: 'POST', signal }),

  me: ({ signal } = {}) => request('/auth/me', { signal }),

  // --- Plans ---
  // Generation needs no account, so the app can be tried before signing up.
  generatePlan: (event, { signal } = {}) =>
    request('/events/generate-plan', {
      method: 'POST',
      body: event,
      signal,
      auth: false,
    }),

  regeneratePlan: (event, { signal } = {}) =>
    request('/events/regenerate-plan', {
      method: 'POST',
      body: event,
      signal,
      auth: false,
    }),

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
