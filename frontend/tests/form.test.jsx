/**
 * Form validation and the form <-> API mapping.
 *
 * The mapping matters as much as the validation: anything dropped here is
 * silently lost from the plan the user receives.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  EMPTY_FORM,
  OPTIONAL_INPUT_FIELDS,
  fromEventInput,
  inputFromSavedPlan,
  toEventInput,
  validateForm,
} from '../src/forms/eventFormModel'
import { todayIso } from '../src/utils/dateValidation'
import { AI_THEME_OPTION } from '../src/constants/eventTypes'

const valid = (overrides = {}) => ({
  ...EMPTY_FORM,
  event_type: 'birthday',
  event_name: 'Pastel Birthday',
  event_date: todayIso(),
  budget: '15000',
  guest_count: '30',
  location: 'Bhopal, Madhya Pradesh',
  ...overrides,
})

describe('validateForm', () => {
  it('passes a complete form', () => {
    expect(validateForm(valid())).toEqual({})
  })

  it('reports every missing required field at once, not one at a time', () => {
    const errors = validateForm({ ...EMPTY_FORM })

    // A user filling in nothing should see all four problems in one pass.
    expect(Object.keys(errors).sort()).toEqual(
      ['budget', 'event_date', 'event_type', 'guest_count', 'location'].sort(),
    )
  })

  it('requires a description when the custom theme option is chosen', () => {
    const errors = validateForm(
      valid({ theme: '__custom__', customTheme: '   ' }),
    )
    expect(errors.theme).toMatch(/describe your theme/i)

    expect(
      validateForm(valid({ theme: '__custom__', customTheme: 'Retro' })).theme,
    ).toBeUndefined()
  })

  it('rejects a whitespace-only location rather than sending it', () => {
    expect(validateForm(valid({ location: '    ' })).location).toMatch(
      /enter the city or venue/i,
    )
  })

  it('rejects a one-character location', () => {
    expect(validateForm(valid({ location: 'B' })).location).toMatch(/longer/i)
  })

  it('enforces the same event-name limit the backend does', () => {
    expect(validateForm(valid({ event_name: 'N'.repeat(160) })).event_name).toBeUndefined()
    expect(validateForm(valid({ event_name: 'N'.repeat(161) })).event_name).toMatch(
      /too long/i,
    )
  })
})

describe('toEventInput', () => {
  it('merges chip and free-text preferences without duplicates', () => {
    const input = toEventInput(
      valid({
        preferenceChips: ['Photo corner', 'Budget-friendly'],
        preferencesText: 'Photo corner, Live music\nOutdoor seating',
      }),
    )

    expect(input.preferences).toEqual([
      'Photo corner',
      'Budget-friendly',
      'Live music',
      'Outdoor seating',
    ])
  })

  it('caps preferences at the limit the backend accepts', () => {
    const many = Array.from({ length: 40 }, (_, i) => `pref-${i}`)
    const input = toEventInput(valid({ preferenceChips: many }))
    expect(input.preferences).toHaveLength(25)
  })

  it('sends the typed theme when a custom one is chosen', () => {
    const input = toEventInput(
      valid({ theme: '__custom__', customTheme: '  Retro Bollywood  ' }),
    )
    expect(input.theme).toBe('Retro Bollywood')
  })

  it('sends no theme when the user asks the AI to pick one', () => {
    const input = toEventInput(valid({ theme: AI_THEME_OPTION }))
    expect(input.theme).toBeNull()
  })

  it('converts budget and guest count to numbers', () => {
    const input = toEventInput(valid({ budget: '15000', guest_count: '30' }))
    expect(input.budget).toBe(15_000)
    expect(input.guest_count).toBe(30)
  })

  it('sends null, not an empty string, for untouched optional fields', () => {
    const input = toEventInput(valid())
    for (const field of OPTIONAL_INPUT_FIELDS) {
      expect(input[field], field).toBeNull()
    }
  })

  it('trims optional free text', () => {
    const input = toEventInput(valid({ accessibility_needs: '  Step-free  ' }))
    expect(input.accessibility_needs).toBe('Step-free')
  })

  it('defaults the currency', () => {
    expect(toEventInput(valid({ currency: '' })).currency).toBe('INR')
  })
})

describe('fromEventInput', () => {
  it('round-trips every field, including the optional requirements', () => {
    const original = toEventInput(
      valid({
        theme: '__custom__',
        customTheme: 'Retro',
        preferenceChips: ['Photo corner'],
        accessibility_needs: 'Step-free access',
        food_preference: 'Pure vegetarian',
        cultural_preferences: 'Marwari traditions',
        must_have_activities: 'Mehndi',
        constraints: 'No loud music after 10pm',
        venue_preference: 'outdoor',
      }),
    )

    const restored = toEventInput(fromEventInput(original))

    for (const field of OPTIONAL_INPUT_FIELDS) {
      expect(restored[field], field).toBe(original[field])
    }
    expect(restored.preferences).toEqual(original.preferences)
    expect(restored.theme).toBe(original.theme)
    expect(restored.budget).toBe(original.budget)
    expect(restored.guest_count).toBe(original.guest_count)
    expect(restored.location).toBe(original.location)
  })

  it('returns a blank form for nothing', () => {
    expect(fromEventInput(null)).toEqual(EMPTY_FORM)
  })

  it('does not crash on a partial input', () => {
    const form = fromEventInput({ event_type: 'wedding' })
    expect(form.event_type).toBe('wedding')
    expect(form.location).toBe('')
  })
})

describe('inputFromSavedPlan', () => {
  const planWith = (summary) => ({
    event_summary: {
      event_type: 'wedding',
      event_name: 'Anniversary',
      event_date: '2027-03-15',
      budget: 400000,
      currency: 'INR',
      guest_count: 150,
      location: 'Bhopal',
      theme: 'Marigold',
      preferences: ['Live music'],
      ...summary,
    },
  })

  it('returns null for a missing plan', () => {
    expect(inputFromSavedPlan(null)).toBeNull()
    expect(inputFromSavedPlan(undefined)).toBeNull()
  })

  it('carries a future event date through unchanged', () => {
    const input = inputFromSavedPlan(planWith({ event_date: '2027-03-15' }))
    expect(input.event_date).toBe('2027-03-15')
    expect(input.location).toBe('Bhopal')
    expect(input.preferences).toEqual(['Live music'])
  })

  it('defaults a past event date to today', () => {
    const input = inputFromSavedPlan(planWith({ event_date: '2020-01-01' }))
    expect(input.event_date).toBe(todayIso())
  })

  /**
   * Regression: "today" was computed with `new Date().toISOString()`, which is
   * the UTC date. For any timezone ahead of UTC, during the user's early
   * morning, that is still *yesterday* — so an event dated yesterday was not
   * recognised as past, was sent to the API unchanged, and the save was
   * rejected for having a past date. IST (UTC+5:30) is this app's primary
   * timezone, so the broken window was 00:00-05:30 every day.
   */
  it('treats yesterday as past even in a timezone ahead of UTC', () => {
    // 01:00 on 1 Nov in IST is still 19:30 on 31 Oct in UTC.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-31T19:30:00Z'))
      const offsetSpy = vi
        .spyOn(Date.prototype, 'getTimezoneOffset')
        .mockReturnValue(-330) // IST = UTC+5:30

      // The user's local date is 2026-11-01, so 2026-10-31 is in the past.
      expect(todayIso()).toBe('2026-11-01')

      const input = inputFromSavedPlan(planWith({ event_date: '2026-10-31' }))
      expect(input.event_date).toBe('2026-11-01')

      offsetSpy.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves the optional requirements', () => {
    const input = inputFromSavedPlan(
      planWith({
        accessibility_needs: 'Step-free access',
        food_preference: 'Jain',
      }),
    )
    expect(input.accessibility_needs).toBe('Step-free access')
    expect(input.food_preference).toBe('Jain')
  })

  it('omits optional requirements that are absent', () => {
    const input = inputFromSavedPlan(planWith({}))
    for (const field of OPTIONAL_INPUT_FIELDS) {
      expect(input[field]).toBeUndefined()
    }
  })
})
