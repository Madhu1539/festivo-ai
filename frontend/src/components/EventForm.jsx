import { useId, useMemo, useState } from 'react'
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  Info,
  IndianRupee,
  Loader2,
  MapPin,
  Palette,
  Sparkles,
  Tag,
  Users,
  Wand2,
} from 'lucide-react'

import EventTypeCard from './EventTypeCard'
import {
  EVENT_TYPES,
  VENUE_OPTIONS,
  preferenceOptions,
  themeOptions,
} from '../constants/eventTypes'
import { CUSTOM_THEME } from '../forms/eventFormModel'
import { budgetAdvisory } from '../utils/budgetValidation'
import {
  formatLongDate,
  formatRelativeDays,
  isAccelerated,
  maxEventDateIso,
  todayIso,
} from '../utils/dateValidation'
import { currencySymbol } from '../utils/format'

function FieldError({ id, message }) {
  if (!message) return null
  return (
    <p id={id} className="field-error">
      <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  )
}

/** Screen 2 — Create Event form (§7.4). */
export default function EventForm({
  values,
  errors,
  onChange,
  onSubmit,
  submitting = false,
}) {
  const uid = useId()
  const [showOptional, setShowOptional] = useState(false)
  const fieldId = (name) => `${uid}-${name}`
  const errorId = (name) => `${uid}-${name}-error`

  const themes = useMemo(() => themeOptions(values.event_type), [values.event_type])
  const chips = useMemo(
    () => preferenceOptions(values.event_type),
    [values.event_type],
  )

  const symbol = currencySymbol(values.currency)
  const advisory = budgetAdvisory(values.budget, values.guest_count, symbol)
  const perGuest =
    Number(values.budget) > 0 && Number(values.guest_count) > 0
      ? Number(values.budget) / Number(values.guest_count)
      : null

  const set = (name) => (event) => onChange(name, event.target.value)

  // Functional update: successive toggles must not read a stale chip list.
  const toggleChip = (chip) =>
    onChange('preferenceChips', (current) =>
      current.includes(chip)
        ? current.filter((item) => item !== chip)
        : [...current, chip],
    )

  const errorCount = Object.keys(errors).length

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-6"
      aria-busy={submitting}
    >
      {/* --- Event type (required) ---------------------------------------- */}
      <fieldset className="card-lav p-5 sm:p-6">
        <legend className="sr-only">Event type</legend>
        <div className="mb-4">
          <h2 className="text-base font-bold">
            What are you planning?{' '}
            <span className="text-danger" aria-hidden="true">
              *
            </span>
          </h2>
          <p className="mt-1 text-sm text-muted">
            The budget, timeline, and checklist all adapt to this choice.
          </p>
        </div>

        <div
          className="grid gap-3 md:grid-cols-3"
          role="radiogroup"
          aria-label="Event type"
          aria-required="true"
          aria-invalid={Boolean(errors.event_type)}
          aria-describedby={errors.event_type ? errorId('event_type') : undefined}
        >
          {EVENT_TYPES.map((type) => (
            <EventTypeCard
              key={type.value}
              type={type}
              name={`${uid}-event-type`}
              selected={values.event_type === type.value}
              onSelect={(value) => onChange('event_type', value)}
            />
          ))}
        </div>
        <FieldError id={errorId('event_type')} message={errors.event_type} />
      </fieldset>

      {/* --- Core details ------------------------------------------------- */}
      <fieldset className="card-peach p-5 sm:p-6">
        <legend className="sr-only">Event details</legend>
        <h2 className="text-base font-bold">Event details</h2>
        <p className="mt-1 text-sm text-muted">
          Fields marked <span className="text-danger">*</span> are required.
        </p>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor={fieldId('event_name')} className="field-label">
              <Tag className="mr-1.5 inline size-3.5 text-muted" aria-hidden="true" />
              Event name <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id={fieldId('event_name')}
              type="text"
              value={values.event_name}
              onChange={set('event_name')}
              maxLength={160}
              placeholder="Aarav's 5th Birthday"
              className={`field-input ${errors.event_name ? 'field-input-error' : ''}`}
              aria-invalid={Boolean(errors.event_name)}
              aria-describedby={
                errors.event_name ? errorId('event_name') : fieldId('event_name-hint')
              }
            />
            <FieldError id={errorId('event_name')} message={errors.event_name} />
            {!errors.event_name && (
              <p id={fieldId('event_name-hint')} className="field-hint">
                We&apos;ll generate a name from the event type if you leave this blank.
              </p>
            )}
          </div>

          <div>
            <label htmlFor={fieldId('event_date')} className="field-label">
              <CalendarDays
                className="mr-1.5 inline size-3.5 text-muted"
                aria-hidden="true"
              />
              Event date <span className="text-danger">*</span>
            </label>
            <input
              id={fieldId('event_date')}
              type="date"
              required
              value={values.event_date}
              onChange={set('event_date')}
              min={todayIso()}
              max={maxEventDateIso()}
              className={`field-input ${errors.event_date ? 'field-input-error' : ''}`}
              aria-invalid={Boolean(errors.event_date)}
              aria-describedby={
                errors.event_date ? errorId('event_date') : fieldId('event_date-hint')
              }
            />
            <FieldError id={errorId('event_date')} message={errors.event_date} />
            {!errors.event_date && values.event_date && (
              <p id={fieldId('event_date-hint')} className="field-hint">
                {formatLongDate(values.event_date)} —{' '}
                {formatRelativeDays(values.event_date)}
                {isAccelerated(values.event_date) && (
                  <span className="font-semibold text-warning">
                    {' '}
                    · tight timeline, we&apos;ll compress the schedule
                  </span>
                )}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={fieldId('location')} className="field-label">
              <MapPin className="mr-1.5 inline size-3.5 text-muted" aria-hidden="true" />
              Location <span className="text-danger">*</span>
            </label>
            <input
              id={fieldId('location')}
              type="text"
              required
              value={values.location}
              onChange={set('location')}
              maxLength={240}
              placeholder="Bhopal, Madhya Pradesh"
              className={`field-input ${errors.location ? 'field-input-error' : ''}`}
              aria-invalid={Boolean(errors.location)}
              aria-describedby={
                errors.location ? errorId('location') : fieldId('location-hint')
              }
            />
            <FieldError id={errorId('location')} message={errors.location} />
            {!errors.location && (
              <p id={fieldId('location-hint')} className="field-hint">
                City or area — used to keep suggestions regionally sensible.
              </p>
            )}
          </div>

          <div>
            <label htmlFor={fieldId('budget')} className="field-label">
              <IndianRupee
                className="mr-1.5 inline size-3.5 text-muted"
                aria-hidden="true"
              />
              Total budget <span className="text-danger">*</span>
            </label>
            <div className="relative">
              <span
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted"
                aria-hidden="true"
              >
                {symbol}
              </span>
              <input
                id={fieldId('budget')}
                type="number"
                required
                inputMode="numeric"
                min="1"
                step="1"
                value={values.budget}
                onChange={set('budget')}
                placeholder="15000"
                className={`field-input pl-9 ${errors.budget ? 'field-input-error' : ''}`}
                aria-invalid={Boolean(errors.budget)}
                aria-describedby={
                  errors.budget ? errorId('budget') : fieldId('budget-hint')
                }
              />
            </div>
            <FieldError id={errorId('budget')} message={errors.budget} />
            {!errors.budget && (
              <p id={fieldId('budget-hint')} className="field-hint">
                Your hard ceiling. The plan is fitted to this amount.
              </p>
            )}
          </div>

          <div>
            <label htmlFor={fieldId('guest_count')} className="field-label">
              <Users className="mr-1.5 inline size-3.5 text-muted" aria-hidden="true" />
              Guest count <span className="text-danger">*</span>
            </label>
            <input
              id={fieldId('guest_count')}
              type="number"
              required
              inputMode="numeric"
              min="1"
              step="1"
              value={values.guest_count}
              onChange={set('guest_count')}
              placeholder="30"
              className={`field-input ${errors.guest_count ? 'field-input-error' : ''}`}
              aria-invalid={Boolean(errors.guest_count)}
              aria-describedby={
                errors.guest_count ? errorId('guest_count') : fieldId('guest-hint')
              }
            />
            <FieldError id={errorId('guest_count')} message={errors.guest_count} />
            {!errors.guest_count && (
              <p id={fieldId('guest-hint')} className="field-hint">
                {perGuest
                  ? `About ${symbol}${Math.floor(perGuest).toLocaleString('en-IN')} per guest.`
                  : 'Roughly how many people will attend.'}
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label htmlFor={fieldId('theme')} className="field-label">
              <Palette className="mr-1.5 inline size-3.5 text-muted" aria-hidden="true" />
              Theme <span className="font-normal text-muted">(optional)</span>
            </label>
            <select
              id={fieldId('theme')}
              value={values.theme}
              onChange={set('theme')}
              className={`field-input ${errors.theme ? 'field-input-error' : ''}`}
              aria-invalid={Boolean(errors.theme)}
              aria-describedby={errors.theme ? errorId('theme') : undefined}
            >
              <option value="">No preference</option>
              {themes.map((theme) => (
                <option key={theme} value={theme}>
                  {theme}
                </option>
              ))}
              <option value={CUSTOM_THEME}>Something else…</option>
            </select>

            {values.theme === CUSTOM_THEME && (
              <input
                type="text"
                value={values.customTheme}
                onChange={set('customTheme')}
                maxLength={120}
                placeholder="Describe your theme"
                aria-label="Describe your theme"
                className={`field-input mt-2 ${errors.theme ? 'field-input-error' : ''}`}
              />
            )}
            <FieldError id={errorId('theme')} message={errors.theme} />
          </div>
        </div>

        {advisory && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-butter-200 bg-butter-50 px-3.5 py-3 text-sm text-warning">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {advisory}
          </p>
        )}
      </fieldset>

      {/* --- Preferences -------------------------------------------------- */}
      <fieldset className="card-butter p-5 sm:p-6">
        <legend className="sr-only">Preferences</legend>
        <h2 className="text-base font-bold">
          Preferences <span className="text-sm font-normal text-muted">(optional)</span>
        </h2>
        <p className="mt-1 text-sm text-muted">
          Anything you pick here is treated as a requirement the plan must respect.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((chip) => {
            const active = values.preferenceChips.includes(chip)
            return (
              <button
                key={chip}
                type="button"
                onClick={() => toggleChip(chip)}
                aria-pressed={active}
                className={[
                  'chip border transition-colors',
                  active
                    ? 'border-brand bg-brand text-white'
                    : 'border-lav-200 bg-white/85 text-muted hover:border-brand-mid hover:bg-lav-50 hover:text-brand',
                ].join(' ')}
              >
                {chip}
              </button>
            )
          })}
        </div>

        <div className="mt-5">
          <label htmlFor={fieldId('preferencesText')} className="field-label">
            Anything else we should know?
          </label>
          <textarea
            id={fieldId('preferencesText')}
            rows={3}
            value={values.preferencesText}
            onChange={set('preferencesText')}
            maxLength={1000}
            placeholder="Pastel balloon arch, no loud music after 10pm, grandparents attending"
            className="field-input resize-y"
            aria-describedby={fieldId('preferences-hint')}
          />
          <p id={fieldId('preferences-hint')} className="field-hint">
            Separate ideas with commas or new lines.
          </p>
        </div>
      </fieldset>

      {/* --- Optional detail (collapsed to keep the form simple) ---------- */}
      <div className="card-sky overflow-hidden">
        <button
          type="button"
          onClick={() => setShowOptional((open) => !open)}
          aria-expanded={showOptional}
          aria-controls={fieldId('optional-panel')}
          className="flex w-full items-center gap-3 px-5 py-4 text-left sm:px-6"
        >
          <span
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-sky-600 shadow-[0_1px_3px_rgba(43,95,201,0.12)] ring-1 ring-sky-200"
            aria-hidden="true"
          >
            <Sparkles className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold">
              Fine-tune the plan
              <span className="ml-2 text-sm font-normal text-muted">optional</span>
            </span>
            <span className="mt-0.5 block text-sm text-muted">
              Venue style, food, accessibility, culture, must-haves, constraints.
            </span>
          </span>
          <ChevronDown
            className={`size-5 shrink-0 text-muted transition-transform ${
              showOptional ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        </button>

        {showOptional && (
          <div
            id={fieldId('optional-panel')}
            className="grid gap-5 border-t border-sky-200/70 bg-white/50 px-5 py-5 sm:grid-cols-2 sm:px-6"
          >
            <div>
              <label htmlFor={fieldId('venue_preference')} className="field-label">
                Indoor or outdoor
              </label>
              <select
                id={fieldId('venue_preference')}
                value={values.venue_preference}
                onChange={set('venue_preference')}
                className="field-input"
              >
                <option value="">Not sure yet</option>
                {VENUE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={fieldId('food_preference')} className="field-label">
                Food preferences
              </label>
              <input
                id={fieldId('food_preference')}
                type="text"
                value={values.food_preference}
                onChange={set('food_preference')}
                maxLength={300}
                placeholder="Pure vegetarian, Jain options for 4 guests"
                className="field-input"
              />
            </div>

            <div>
              <label htmlFor={fieldId('accessibility_needs')} className="field-label">
                Accessibility requirements
              </label>
              <input
                id={fieldId('accessibility_needs')}
                type="text"
                value={values.accessibility_needs}
                onChange={set('accessibility_needs')}
                maxLength={300}
                placeholder="Step-free access, seating for elderly guests"
                className="field-input"
              />
            </div>

            <div>
              <label htmlFor={fieldId('cultural_preferences')} className="field-label">
                Cultural preferences
              </label>
              <input
                id={fieldId('cultural_preferences')}
                type="text"
                value={values.cultural_preferences}
                onChange={set('cultural_preferences')}
                maxLength={300}
                placeholder="Traditional Marathi rituals"
                className="field-input"
              />
            </div>

            <div>
              <label htmlFor={fieldId('must_have_activities')} className="field-label">
                Must-have activities
              </label>
              <input
                id={fieldId('must_have_activities')}
                type="text"
                value={values.must_have_activities}
                onChange={set('must_have_activities')}
                maxLength={400}
                placeholder="Cake cutting at 7pm, treasure hunt"
                className="field-input"
              />
            </div>

            <div>
              <label htmlFor={fieldId('constraints')} className="field-label">
                Special constraints
              </label>
              <input
                id={fieldId('constraints')}
                type="text"
                value={values.constraints}
                onChange={set('constraints')}
                maxLength={400}
                placeholder="Venue available only until 10pm"
                className="field-input"
              />
            </div>
          </div>
        )}
      </div>

      {/* --- Submit ------------------------------------------------------- */}
      <div className="card-mint flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Ready when you are</p>
          <p
            className="mt-0.5 text-sm text-muted"
            role={errorCount > 0 ? 'alert' : undefined}
          >
            {errorCount > 0
              ? `Please fix ${errorCount} ${errorCount === 1 ? 'field' : 'fields'} above.`
              : 'All amounts in your plan will be estimates, not quotations.'}
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary shrink-0 px-5 py-3 text-base"
        >
          {submitting ? (
            <>
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              Generating…
            </>
          ) : (
            <>
              <Wand2 className="size-5" aria-hidden="true" />
              Generate My Event Plan
            </>
          )}
        </button>
      </div>
    </form>
  )
}
