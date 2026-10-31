/**
 * The event form's data model: empty state, validation, and the mapping to
 * and from the API input contract.
 *
 * Separate from EventForm.jsx so this logic can be read and tested without
 * the 450 lines of markup around it, and so the plan screen can round-trip a
 * saved input without importing a component module for a constant.
 */

import { AI_THEME_OPTION, preferenceOptions, themeOptions } from '../constants/eventTypes'
import { validateBudget, validateGuestCount } from '../utils/budgetValidation'
import { validateEventDate, todayIso } from '../utils/dateValidation'

/** Sentinel for "my theme isn't in the list", distinct from an empty theme. */
export const CUSTOM_THEME = '__custom__'

/** At most this many preferences are sent; the rest are dropped. */
const MAX_PREFERENCES = 25

/** Longest accepted event name, matching the backend's own bound. */
const MAX_EVENT_NAME_LENGTH = 160

export const EMPTY_FORM = {
  event_type: '',
  event_name: '',
  event_date: '',
  budget: '',
  currency: 'INR',
  guest_count: '',
  location: '',
  theme: '',
  customTheme: '',
  preferenceChips: [],
  preferencesText: '',
  venue_preference: '',
  food_preference: '',
  accessibility_needs: '',
  cultural_preferences: '',
  must_have_activities: '',
  constraints: '',
}

/**
 * The optional free-text requirement fields, in form order.
 *
 * Exported so every place that has to round-trip an input — the form, and the
 * saved-plan rebuild on the plan screen — works from one list instead of
 * repeating it and drifting.
 */
export const OPTIONAL_INPUT_FIELDS = [
  'venue_preference',
  'food_preference',
  'accessibility_needs',
  'cultural_preferences',
  'must_have_activities',
  'constraints',
]

/** Trimmed text, or null when the field is effectively empty. */
function optionalText(value) {
  const text = (value ?? '').trim()
  return text ? text : null
}

/** Validates the whole form (§7.4 form behavior). */
export function validateForm(values) {
  const errors = {}

  if (!values.event_type) errors.event_type = 'Please choose an event type.'

  const dateError = validateEventDate(values.event_date)
  if (dateError) errors.event_date = dateError

  const budgetError = validateBudget(values.budget)
  if (budgetError) errors.budget = budgetError

  const guestError = validateGuestCount(values.guest_count)
  if (guestError) errors.guest_count = guestError

  const location = values.location.trim()
  if (!location) errors.location = 'Please enter the city or venue area.'
  else if (location.length < 2) errors.location = 'Please enter a longer location.'

  if (values.theme === CUSTOM_THEME && !values.customTheme.trim()) {
    errors.theme = 'Please describe your theme, or pick one from the list.'
  }
  if (values.event_name.length > MAX_EVENT_NAME_LENGTH) {
    errors.event_name = `Event name is too long (${MAX_EVENT_NAME_LENGTH} characters maximum).`
  }

  return errors
}

/** Maps form state onto the API input contract (§8.1). */
export function toEventInput(values) {
  const chosenTheme =
    values.theme === CUSTOM_THEME
      ? values.customTheme.trim()
      : values.theme === AI_THEME_OPTION
        ? ''
        : values.theme

  const freeformPreferences = values.preferencesText
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)

  // Chips first, so a preference picked from the list survives if the free
  // text also mentions it and the cap trims the tail.
  const preferences = [
    ...new Set([...values.preferenceChips, ...freeformPreferences]),
  ].slice(0, MAX_PREFERENCES)

  return {
    event_type: values.event_type,
    event_name: optionalText(values.event_name),
    event_date: values.event_date,
    budget: Number(values.budget),
    currency: values.currency || 'INR',
    guest_count: Number(values.guest_count),
    location: values.location.trim(),
    theme: optionalText(chosenTheme),
    preferences,
    venue_preference: values.venue_preference || null,
    food_preference: optionalText(values.food_preference),
    accessibility_needs: optionalText(values.accessibility_needs),
    cultural_preferences: optionalText(values.cultural_preferences),
    must_have_activities: optionalText(values.must_have_activities),
    constraints: optionalText(values.constraints),
  }
}

/** Rebuilds form state from a previously submitted input (for Edit / retry). */
export function fromEventInput(input) {
  if (!input) return { ...EMPTY_FORM }
  const themes = themeOptions(input.event_type)
  const theme = input.theme ?? ''
  const knownPreferences = preferenceOptions(input.event_type)
  const preferences = input.preferences ?? []

  return {
    ...EMPTY_FORM,
    event_type: input.event_type ?? '',
    event_name: input.event_name ?? '',
    event_date: input.event_date ?? '',
    budget: String(input.budget ?? ''),
    currency: input.currency ?? 'INR',
    guest_count: String(input.guest_count ?? ''),
    location: input.location ?? '',
    // A theme that is not one of this event type's options came from the
    // custom field, so it has to go back there rather than being dropped by
    // a <select> that has no matching <option>.
    theme: !theme ? '' : themes.includes(theme) ? theme : CUSTOM_THEME,
    customTheme: !theme || themes.includes(theme) ? '' : theme,
    preferenceChips: preferences.filter((p) => knownPreferences.includes(p)),
    preferencesText: preferences
      .filter((p) => !knownPreferences.includes(p))
      .join(', '),
    venue_preference: input.venue_preference ?? '',
    food_preference: input.food_preference ?? '',
    accessibility_needs: input.accessibility_needs ?? '',
    cultural_preferences: input.cultural_preferences ?? '',
    must_have_activities: input.must_have_activities ?? '',
    constraints: input.constraints ?? '',
  }
}

/**
 * Rebuilds the API input shape from a saved plan, for edit and regenerate.
 *
 * The third mapping in this family, alongside `toEventInput` (form -> API) and
 * `fromEventInput` (API -> form): this one is saved plan -> API.
 */
export function inputFromSavedPlan(plan) {
  if (!plan) return null
  const summary = plan.event_summary
  // Must be the user's local date, not UTC: `toISOString()` would report
  // yesterday for any timezone ahead of UTC during their early morning, and
  // the past-date guard below would then silently fail to fire.
  const today = todayIso()

  const input = {
    event_type: summary.event_type,
    event_name: summary.event_name,
    // A past event cannot be resubmitted as-is; default to today.
    event_date: summary.event_date < today ? today : summary.event_date,
    budget: summary.budget,
    currency: summary.currency,
    guest_count: summary.guest_count,
    location: summary.location,
    theme: summary.theme,
    preferences: summary.preferences ?? [],
  }

  // Carry the optional requirements through. Losing an accessibility or
  // dietary need on regenerate would produce a plan that contradicts what
  // the user told us, so these must survive the round trip.
  for (const field of OPTIONAL_INPUT_FIELDS) {
    if (summary[field]) input[field] = summary[field]
  }

  return input
}
