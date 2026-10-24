/**
 * Component behaviour that users actually feel.
 *
 * The focus test here guards a real regression: the plan screen moves focus to
 * its heading when a plan appears, and because every checklist tick produces a
 * new plan object, keying that effect on the plan itself threw focus out of the
 * checkbox on every single tick — unusable with a keyboard.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useEffect, useRef, useState } from 'react'

import VendorChecklist from '../src/components/VendorChecklist'
import TimelineSection from '../src/components/TimelineSection'
import ErrorBoundary from '../src/components/ErrorBoundary'
import ErrorState from '../src/components/ErrorState'
import ProgressBar from '../src/components/ProgressBar'
import { ApiError } from '../src/services/eventApi'

const items = [
  {
    id: 'c1',
    category: 'Catering',
    title: 'Shortlist caterers',
    description: 'Compare three quotes.',
    priority: 'high',
    is_completed: false,
  },
  {
    id: 'c2',
    category: 'Catering',
    title: 'Confirm the menu',
    priority: 'medium',
    is_completed: false,
  },
  {
    id: 'c3',
    category: 'Decor',
    title: 'Book a florist',
    priority: 'low',
    is_completed: true,
  },
]

const progress = { total: 3, completed: 1, percent: 33.3 }

// --- Vendor checklist ------------------------------------------------------

describe('VendorChecklist', () => {
  it('groups items by category with a per-group count', () => {
    render(<VendorChecklist items={items} progress={progress} />)

    const catering = screen.getByRole('region', { name: 'Catering' })
    expect(within(catering).getAllByRole('checkbox')).toHaveLength(2)
    expect(within(catering).getByText('0/2')).toBeInTheDocument()

    const decor = screen.getByRole('region', { name: 'Decor' })
    expect(within(decor).getByText('1/1')).toBeInTheDocument()
  })

  it('reflects completion state on the checkboxes', () => {
    render(<VendorChecklist items={items} progress={progress} />)

    expect(screen.getByRole('checkbox', { name: /shortlist caterers/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /book a florist/i })).toBeChecked()
  })

  it('reports the id and the new state when toggled', async () => {
    const onToggle = vi.fn()
    render(<VendorChecklist items={items} progress={progress} onToggle={onToggle} />)

    await userEvent.click(screen.getByRole('checkbox', { name: /confirm the menu/i }))
    expect(onToggle).toHaveBeenCalledWith('c2', true)

    await userEvent.click(screen.getByRole('checkbox', { name: /book a florist/i }))
    expect(onToggle).toHaveBeenLastCalledWith('c3', false)
  })

  it('is operable by keyboard alone', async () => {
    const onToggle = vi.fn()
    render(<VendorChecklist items={items} progress={progress} onToggle={onToggle} />)

    const first = screen.getByRole('checkbox', { name: /shortlist caterers/i })
    first.focus()
    await userEvent.keyboard(' ')

    expect(onToggle).toHaveBeenCalledWith('c1', true)
  })

  it('marks an item busy while its save is in flight, without disabling it', () => {
    // Never `disabled`: a disabled control cannot hold focus, so the browser
    // blurs it and a keyboard user is dumped back to the top of the document
    // on every tick. aria-busy conveys the same thing and stays focusable.
    render(
      <VendorChecklist
        items={items}
        progress={progress}
        busyIds={new Set(['c1'])}
      />,
    )

    const busy = screen.getByRole('checkbox', { name: /shortlist caterers/i })
    expect(busy).toBeEnabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')

    const idle = screen.getByRole('checkbox', { name: /confirm the menu/i })
    expect(idle).toBeEnabled()
    expect(idle).not.toHaveAttribute('aria-busy')
  })

  it('can still be focused while a save is in flight', () => {
    render(
      <VendorChecklist
        items={items}
        progress={progress}
        busyIds={new Set(['c1'])}
      />,
    )

    const busy = screen.getByRole('checkbox', { name: /shortlist caterers/i })
    busy.focus()
    expect(document.activeElement).toBe(busy)
  })

  it('announces progress to a screen reader', () => {
    render(<VendorChecklist items={items} progress={progress} />)
    expect(screen.getByText('1 of 3 checklist items complete.')).toBeInTheDocument()
  })

  it('shows an empty state instead of a divide-by-zero progress bar', () => {
    render(<VendorChecklist items={[]} progress={{ total: 0, completed: 0 }} />)

    expect(screen.getByText(/no checklist items were generated/i)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('never implies a vendor has been booked (§5.3)', () => {
    render(<VendorChecklist items={items} progress={progress} />)
    expect(
      screen.getByText(/nothing here has been booked, quoted, or reserved/i),
    ).toBeInTheDocument()
  })
})

// --- Focus retention (the regression) -------------------------------------

/**
 * A minimal stand-in for the plan screen: it holds plan state, replaces the
 * plan object on every toggle, and focuses its heading when a plan appears.
 */
function PlanHarness({ focusKeyedOnPlanObject }) {
  const [plan, setPlan] = useState({ items })
  const headingRef = useRef(null)

  const planKey = plan ? 'draft' : null
  const dependency = focusKeyedOnPlanObject ? plan : planKey

  useEffect(() => {
    if (plan) headingRef.current?.focus()
    // The harness deliberately switches this dependency to demonstrate the
    // difference; the real page keys on identity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependency])

  const onToggle = useCallback((id, isCompleted) => {
    setPlan((current) => ({
      items: current.items.map((item) =>
        item.id === id ? { ...item, is_completed: isCompleted } : item,
      ),
    }))
  }, [])

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1}>
        Your plan
      </h1>
      <VendorChecklist items={plan.items} onToggle={onToggle} />
    </div>
  )
}

describe('focus retention while ticking the checklist', () => {
  it('keeps focus on the checkbox the user is working in', async () => {
    render(<PlanHarness focusKeyedOnPlanObject={false} />)

    const checkbox = screen.getByRole('checkbox', { name: /shortlist caterers/i })
    checkbox.focus()
    await userEvent.keyboard(' ')

    expect(checkbox).toBeChecked()
    expect(document.activeElement).toBe(checkbox)
  })

  it('demonstrates the bug this guards against', async () => {
    // Keying the focus effect on the plan object re-fires it on every tick.
    render(<PlanHarness focusKeyedOnPlanObject />)

    const checkbox = screen.getByRole('checkbox', { name: /shortlist caterers/i })
    checkbox.focus()
    await userEvent.keyboard(' ')

    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Your plan' }),
    )
  })

  it('lets the user tick several items in a row without re-finding focus', async () => {
    render(<PlanHarness focusKeyedOnPlanObject={false} />)

    const first = screen.getByRole('checkbox', { name: /shortlist caterers/i })
    first.focus()
    await userEvent.keyboard(' ')
    // Tab to the next item and tick it, as a keyboard user would.
    await userEvent.tab()
    await userEvent.keyboard(' ')

    expect(screen.getByRole('checkbox', { name: /confirm the menu/i })).toBeChecked()
    expect(document.activeElement).toBe(
      screen.getByRole('checkbox', { name: /confirm the menu/i }),
    )
  })
})

// --- Timeline -------------------------------------------------------------

describe('TimelineSection', () => {
  const timeline = [
    {
      id: 't1',
      title: 'Book the venue',
      due_date: '2026-11-01',
      priority: 'high',
      is_completed: false,
    },
    {
      id: 't2',
      title: 'Send invitations',
      due_date: '2026-11-20',
      priority: 'medium',
      is_completed: true,
    },
  ]

  it('exposes completion as a toggle button, with its state', () => {
    render(<TimelineSection items={timeline} />)

    const done = screen.getByRole('button', { name: /mark "send invitations"/i })
    expect(done).toHaveAttribute('aria-pressed', 'true')

    const notDone = screen.getByRole('button', { name: /mark "book the venue"/i })
    expect(notDone).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles to the opposite of the current state', async () => {
    const onToggle = vi.fn()
    render(<TimelineSection items={timeline} onToggle={onToggle} />)

    await userEvent.click(
      screen.getByRole('button', { name: /mark "book the venue"/i }),
    )
    expect(onToggle).toHaveBeenCalledWith('t1', true)

    await userEvent.click(
      screen.getByRole('button', { name: /mark "send invitations"/i }),
    )
    expect(onToggle).toHaveBeenLastCalledWith('t2', false)
  })
})

// --- Progress bar ---------------------------------------------------------

describe('ProgressBar', () => {
  it('exposes its value to assistive technology', () => {
    render(<ProgressBar label="Checklist progress" completed={1} total={4} />)

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '25')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('shows 0%, not NaN, when there is nothing to do', () => {
    render(<ProgressBar label="Checklist progress" completed={0} total={0} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })
})

// --- Error surfaces -------------------------------------------------------

describe('ErrorState', () => {
  it('explains a missing API key and offers no pointless retry', () => {
    render(
      <ErrorState
        error={new ApiError({ code: 'AI_NOT_CONFIGURED', message: 'Not configured.' })}
      />,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/add gemini_api_key/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
  })

  it('offers a retry when one is given', async () => {
    const onRetry = vi.fn()
    render(
      <ErrorState
        error={new ApiError({ code: 'AI_TIMEOUT', message: 'Took too long.' })}
        onRetry={onRetry}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('lists per-field details from the backend', () => {
    render(
      <ErrorState
        error={
          new ApiError({
            code: 'INVALID_EVENT_INPUT',
            message: 'Check the details.',
            details: [{ field: 'budget', message: 'Must be greater than zero.' }],
          })
        }
      />,
    )

    expect(screen.getByText('budget')).toBeInTheDocument()
    expect(screen.getByText(/must be greater than zero/i)).toBeInTheDocument()
  })
})

describe('ErrorBoundary', () => {
  it('shows a recoverable message instead of a blank page', () => {
    const Boom = () => {
      throw new Error('Cannot read properties of undefined')
    }
    // React logs the caught error; that is expected noise here.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/this screen hit an error/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload the page/i })).toBeInTheDocument()

    spy.mockRestore()
  })

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('All good')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
