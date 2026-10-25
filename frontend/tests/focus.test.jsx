/**
 * Focus handling when a form fails validation.
 *
 * This runs against the real EventForm markup rather than a stub, because the
 * bug it guards against came from the markup: the event-type radio group
 * carries `aria-invalid` on a non-focusable container, so the obvious
 * `querySelector('[aria-invalid="true"]').focus()` silently did nothing and
 * the user was left at the bottom of the form with no idea what was wrong.
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import EventForm from '../src/components/EventForm'
import { EMPTY_FORM } from '../src/forms/eventFormModel'
import { focusFirstInvalid } from '../src/utils/focus'

const renderForm = (errors) => {
  const { container } = render(
    <EventForm values={{ ...EMPTY_FORM }} errors={errors} onChange={() => {}} />,
  )
  return container
}

describe('focusFirstInvalid', () => {
  it('steps into the radio group when the group itself is the invalid element', () => {
    const container = renderForm({ event_type: 'Please choose an event type.' })

    const group = container.querySelector('[role="radiogroup"]')
    expect(group).toHaveAttribute('aria-invalid', 'true')

    const focused = focusFirstInvalid(container)

    // Not the group — a group cannot take focus.
    expect(focused).not.toBe(group)
    expect(focused.tagName).toBe('INPUT')
    expect(focused).toHaveAttribute('type', 'radio')
    expect(document.activeElement).toBe(focused)
  })

  it('focuses a text input directly', () => {
    const container = renderForm({ location: 'Please enter the city or venue area.' })

    const focused = focusFirstInvalid(container)

    expect(focused).toBe(screen.getByLabelText(/location/i))
    expect(document.activeElement).toBe(focused)
  })

  it('picks the first invalid field in document order, not the last', () => {
    const container = renderForm({
      event_date: 'Please choose your event date.',
      budget: 'Please enter your total budget.',
      guest_count: 'Please enter how many guests you expect.',
    })

    const focused = focusFirstInvalid(container)
    expect(focused).toBe(screen.getByLabelText(/event date/i))
  })

  it('falls back when nothing is invalid', () => {
    const container = renderForm({})
    const fallback = document.createElement('button')
    document.body.appendChild(fallback)

    expect(focusFirstInvalid(container, fallback)).toBe(fallback)
    expect(focusFirstInvalid(container, null)).toBeNull()

    fallback.remove()
  })

  it('does not throw when there is no container yet', () => {
    expect(focusFirstInvalid(null)).toBeNull()
    expect(focusFirstInvalid(undefined, null)).toBeNull()
  })
})

describe('error presentation', () => {
  it('ties each message to its field for assistive technology', () => {
    renderForm({ budget: 'Please enter your total budget.' })

    const budget = screen.getByLabelText(/total budget/i)
    expect(budget).toHaveAttribute('aria-invalid', 'true')

    const describedBy = budget.getAttribute('aria-describedby') ?? ''
    const ids = describedBy.split(/\s+/).filter(Boolean)
    const messages = ids
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')

    expect(messages).toContain('Please enter your total budget.')
  })

  it('marks only the fields that actually failed', () => {
    const container = renderForm({ budget: 'Please enter your total budget.' })

    expect(container.querySelectorAll('[aria-invalid="true"]')).toHaveLength(1)
    expect(screen.getByLabelText(/location/i)).not.toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })
})
