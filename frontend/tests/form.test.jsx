/**
 * Form validation and the form <-> API mapping.
 *
 * The mapping matters as much as the validation: anything dropped here is
 * silently lost from the plan the user receives.
 */

import { describe, expect, it } from 'vitest'

import {
  EMPTY_FORM,
  OPTIONAL_INPUT_FIELDS,
  fromEventInput,
  toEventInput,
  validateForm,
} from '../src/components/EventForm'
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
