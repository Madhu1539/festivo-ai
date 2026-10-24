/**
 * The API client's error normalisation.
 *
 * Everything the UI shows on a failure depends on this layer producing a
 * consistent shape, so each branch is pinned here rather than discovered at
 * runtime.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, eventApi } from '../src/services/eventApi'

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const brokenBody = (status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    throw new SyntaxError('Unexpected token < in JSON')
  },
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('successful requests', () => {
  it('returns the parsed body', async () => {
    fetch.mockResolvedValue(jsonResponse({ status: 'ok' }))
    await expect(eventApi.health()).resolves.toEqual({ status: 'ok' })
  })

  it('sends JSON with the right content type on a POST', async () => {
    fetch.mockResolvedValue(jsonResponse({ id: 'e1' }, 201))

    await eventApi.generatePlan({ event_type: 'birthday' })

    const [, init] = fetch.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ event_type: 'birthday' })
  })

  it('does not send a content-type header when there is no body', async () => {
    fetch.mockResolvedValue(jsonResponse([]))
    await eventApi.listEvents()
    expect(fetch.mock.calls[0][1].headers).toBeUndefined()
  })

  it('treats 204 as an empty result', async () => {
    fetch.mockResolvedValue({ ok: true, status: 204, json: async () => null })
    await expect(eventApi.deleteEvent('e1')).resolves.toBeNull()
  })
})

describe('error normalisation', () => {
  it('maps a backend error envelope onto ApiError', async () => {
    fetch.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'AI_TIMEOUT',
            message: 'Generating your plan took too long.',
            details: [{ field: 'budget', message: 'Too small.' }],
          },
        },
        504,
      ),
    )

    const error = await eventApi.generatePlan({}).catch((caught) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('AI_TIMEOUT')
    expect(error.status).toBe(504)
    expect(error.details).toHaveLength(1)
    expect(error.isRetryable).toBe(true)
  })

  it('still produces a usable error when the body has no envelope', async () => {
    fetch.mockResolvedValue(jsonResponse({ detail: 'Not Found' }, 404))

    const error = await eventApi.getEvent('missing').catch((caught) => caught)

    expect(error.code).toBe('INTERNAL_ERROR')
    expect(error.message).toMatch(/something went wrong/i)
    expect(error.status).toBe(404)
  })

  it('reports an unreachable backend as a network error, not a crash', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))

    const error = await eventApi.listEvents().catch((caught) => caught)

    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.status).toBe(0)
    expect(error.message).toMatch(/backend is running/i)
    expect(error.isRetryable).toBe(true)
  })

  it('throws on a 2xx whose body is not JSON, instead of returning null', async () => {
    // Returning null here would push the failure downstream into a render:
    // `setEvents(null)` then `events.length` throws, far from the cause.
    fetch.mockResolvedValue(brokenBody(200))

    const error = await eventApi.listEvents().catch((caught) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('INTERNAL_ERROR')
    expect(error.message).toMatch(/could not read/i)
  })

  it('re-throws an abort so callers can tell cancellation from failure', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    fetch.mockRejectedValue(abort)

    const error = await eventApi.listEvents().catch((caught) => caught)

    expect(error.name).toBe('AbortError')
    expect(error).not.toBeInstanceOf(ApiError)
  })
})

describe('ApiError classification', () => {
  const make = (code) => new ApiError({ code, message: 'x' })

  it('marks transient failures retryable', () => {
    for (const code of [
      'AI_UNAVAILABLE',
      'AI_TIMEOUT',
      'AI_RATE_LIMITED',
      'AI_INVALID_OUTPUT',
      'NETWORK_ERROR',
      'INTERNAL_ERROR',
    ]) {
      expect(make(code).isRetryable, code).toBe(true)
    }
  })

  it('does not offer a retry for a missing key or a bad request', () => {
    // Retrying these just fails again; the UI should explain instead.
    expect(make('AI_NOT_CONFIGURED').isRetryable).toBe(false)
    expect(make('INVALID_EVENT_INPUT').isRetryable).toBe(false)
    expect(make('NOT_FOUND').isRetryable).toBe(false)
  })

  it('separates a configuration problem from a storage problem', () => {
    expect(make('AI_NOT_CONFIGURED').isConfigIssue).toBe(true)
    expect(make('STORAGE_UNAVAILABLE').isStorageIssue).toBe(true)
    expect(make('STORAGE_UNAVAILABLE').isConfigIssue).toBe(false)
  })
})

describe('cancellation', () => {
  it('forwards an abort signal on every method that takes one', async () => {
    fetch.mockResolvedValue(jsonResponse({}))
    const { signal } = new AbortController()

    const calls = [
      () => eventApi.health({ signal }),
      () => eventApi.listEvents({ signal }),
      () => eventApi.planningOverview({ signal }),
      () => eventApi.getEvent('e1', { signal }),
      () => eventApi.deleteEvent('e1', { signal }),
      () => eventApi.generatePlan({}, { signal }),
      () => eventApi.regeneratePlan({}, { signal }),
      () => eventApi.saveEvent({}, {}, { signal }),
      () => eventApi.updateChecklistItem('e1', 'i1', true, { signal }),
      () => eventApi.updateTimelineItem('e1', 'i1', true, { signal }),
    ]

    for (const call of calls) await call()

    expect(fetch.mock.calls).toHaveLength(calls.length)
    for (const [, init] of fetch.mock.calls) {
      expect(init.signal).toBe(signal)
    }
  })
})
