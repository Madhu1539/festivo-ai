/**
 * Validation and money/date helpers.
 *
 * These are the checks that stand between a user's typing and an AI call that
 * costs money, so the edge cases matter more than the happy path.
 */

import { describe, expect, it } from 'vitest'

import {
  MAX_BUDGET,
  MAX_GUESTS,
  budgetAdvisory,
  validateBudget,
  validateGuestCount,
  verifyBudgetTotals,
} from '../src/utils/budgetValidation'
import {
  ACCELERATED_THRESHOLD_DAYS,
  daysUntil,
  formatDate,
  formatRelativeDays,
  groupByMonth,
  isAccelerated,
  maxEventDateIso,
  toIsoDate,
  todayIso,
  validateEventDate,
} from '../src/utils/dateValidation'
import {
  chartColor,
  currencySymbol,
  formatCompactMoney,
  formatMoney,
  formatPercent,
  pluralize,
  sliceColor,
} from '../src/utils/format'

const isoOffset = (days) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

// --- Budget ---------------------------------------------------------------

describe('validateBudget', () => {
  it('requires a value', () => {
    for (const empty of ['', null, undefined]) {
      expect(validateBudget(empty)).toMatch(/enter your total budget/i)
    }
  })

  it('rejects non-numeric and non-finite input', () => {
    expect(validateBudget('abc')).toMatch(/must be a number/i)
    expect(validateBudget('Infinity')).toMatch(/must be a number/i)
    expect(validateBudget(NaN)).toMatch(/must be a number/i)
  })

  it('rejects zero and negatives', () => {
    expect(validateBudget(0)).toMatch(/greater than zero/i)
    expect(validateBudget(-500)).toMatch(/greater than zero/i)
  })

  it('accepts the boundary and rejects just past it', () => {
    expect(validateBudget(MAX_BUDGET)).toBeNull()
    expect(validateBudget(MAX_BUDGET + 1)).toMatch(/larger than this planner/i)
  })

  it('accepts a realistic budget', () => {
    expect(validateBudget('150000')).toBeNull()
  })
})

describe('validateGuestCount', () => {
  it('requires a whole number of at least one', () => {
    expect(validateGuestCount('')).toMatch(/how many guests/i)
    expect(validateGuestCount(2.5)).toMatch(/whole number/i)
    expect(validateGuestCount(0)).toMatch(/at least one guest/i)
    expect(validateGuestCount(-3)).toMatch(/at least one guest/i)
  })

  it('accepts the boundary and rejects just past it', () => {
    expect(validateGuestCount(MAX_GUESTS)).toBeNull()
    expect(validateGuestCount(MAX_GUESTS + 1)).toMatch(/larger than this planner/i)
  })
})

describe('budgetAdvisory', () => {
  it('warns when the per-guest amount is very tight', () => {
    // 1000 / 100 = 10 per guest.
    expect(budgetAdvisory(1000, 100)).toMatch(/very tight/i)
  })

  it('nudges at the budget-friendly band', () => {
    // 10000 / 100 = 100 per guest.
    expect(budgetAdvisory(10_000, 100)).toMatch(/budget-friendly/i)
  })

  it('says nothing when the budget is comfortable', () => {
    expect(budgetAdvisory(100_000, 100)).toBeNull()
  })

  it('says nothing rather than dividing by zero', () => {
    expect(budgetAdvisory(10_000, 0)).toBeNull()
    expect(budgetAdvisory(0, 50)).toBeNull()
    expect(budgetAdvisory('', '')).toBeNull()
  })

  it('uses the supplied currency symbol', () => {
    expect(budgetAdvisory(1000, 100, '$')).toContain('$10')
  })
})

describe('verifyBudgetTotals', () => {
  it('treats a missing budget as nothing to check', () => {
    expect(verifyBudgetTotals(null).ok).toBe(true)
  })

  it('accepts categories that sum to planned + reserve', () => {
    const result = verifyBudgetTotals({
      categories: [{ estimated_amount: 8000 }, { estimated_amount: 2000 }],
      planned_expenditure: 8000,
      emergency_reserve: 2000,
    })
    expect(result.ok).toBe(true)
    expect(result.categorySum).toBe(10_000)
  })

  it('tolerates sub-rupee float drift but not real discrepancies', () => {
    const rounding = verifyBudgetTotals({
      categories: [{ estimated_amount: 10_000.3 }],
      planned_expenditure: 10_000,
      emergency_reserve: 0,
    })
    expect(rounding.ok).toBe(true)

    const wrong = verifyBudgetTotals({
      categories: [{ estimated_amount: 9000 }],
      planned_expenditure: 10_000,
      emergency_reserve: 0,
    })
    expect(wrong.ok).toBe(false)
    expect(wrong.drift).toBe(1000)
  })

  it('does not throw on a malformed budget object', () => {
    expect(verifyBudgetTotals({}).ok).toBe(true)
    expect(verifyBudgetTotals({ categories: [{}] }).categorySum).toBe(0)
  })
})

// --- Dates ----------------------------------------------------------------

describe('toIsoDate', () => {
  it('uses the local calendar day, not UTC', () => {
    // 00:30 local on the 15th must not be reported as the 14th.
    const justAfterMidnight = new Date(2026, 10, 15, 0, 30)
    expect(toIsoDate(justAfterMidnight)).toBe('2026-11-15')

    // And late evening must not roll forward.
    const lateEvening = new Date(2026, 10, 15, 23, 30)
    expect(toIsoDate(lateEvening)).toBe('2026-11-15')
  })
})

describe('validateEventDate', () => {
  it('requires a date', () => {
    expect(validateEventDate('')).toMatch(/choose your event date/i)
  })

  it('rejects malformed and impossible dates', () => {
    expect(validateEventDate('not-a-date')).toMatch(/valid date/i)
    expect(validateEventDate('2026-02-30')).toMatch(/valid date/i)
    expect(validateEventDate('2026-13-01')).toMatch(/valid date/i)
  })

  it('rejects the past but accepts today', () => {
    expect(validateEventDate(isoOffset(-1))).toMatch(/cannot be in the past/i)
    expect(validateEventDate(todayIso())).toBeNull()
  })

  it('accepts the ten-year boundary and rejects beyond it', () => {
    expect(validateEventDate(maxEventDateIso())).toBeNull()
    expect(validateEventDate('2099-01-01')).toMatch(/within the next 10 years/i)
  })
})

describe('daysUntil', () => {
  it('counts from today', () => {
    expect(daysUntil(todayIso())).toBe(0)
    expect(daysUntil(isoOffset(30))).toBe(30)
    expect(daysUntil(isoOffset(-5))).toBe(-5)
  })

  it('returns null for unparseable input rather than NaN', () => {
    expect(daysUntil('nonsense')).toBeNull()
    expect(daysUntil(undefined)).toBeNull()
  })
})

describe('isAccelerated', () => {
  it('is true at the threshold and false past it', () => {
    expect(isAccelerated(isoOffset(ACCELERATED_THRESHOLD_DAYS))).toBe(true)
    expect(isAccelerated(isoOffset(ACCELERATED_THRESHOLD_DAYS + 1))).toBe(false)
  })

  it('is false, not throwing, for bad input', () => {
    expect(isAccelerated('nope')).toBe(false)
  })
})

describe('date formatting', () => {
  it('renders an em dash instead of "Invalid Date"', () => {
    expect(formatDate('nonsense')).toBe('—')
    expect(formatDate(undefined)).toBe('—')
  })

  it('formats a real date', () => {
    expect(formatDate('2026-11-15')).toMatch(/15/)
    expect(formatDate('2026-11-15')).toMatch(/2026/)
  })

  it('describes today, tomorrow and the past in words', () => {
    expect(formatRelativeDays(todayIso())).toMatch(/today/i)
    expect(formatRelativeDays(isoOffset(1))).toMatch(/tomorrow/i)
    expect(formatRelativeDays(isoOffset(-3))).toMatch(/ago|past/i)
  })
})

describe('groupByMonth', () => {
  it('keeps items in chronological order within one group per month', () => {
    const groups = groupByMonth([
      { due_date: '2026-11-20' },
      { due_date: '2026-11-02' },
      { due_date: '2026-12-01' },
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0].items.map((i) => i.due_date)).toEqual([
      '2026-11-20',
      '2026-11-02',
    ])
    expect(groups[1].items).toHaveLength(1)
  })

  it('handles an empty list', () => {
    expect(groupByMonth([])).toEqual([])
  })
})

// --- Formatting -----------------------------------------------------------

describe('money formatting', () => {
  it('uses the rupee symbol for INR', () => {
    expect(currencySymbol('INR')).toBe('₹')
    expect(formatMoney(150_000, 'INR')).toContain('1,50,000')
  })

  it('never renders NaN to the user', () => {
    for (const bad of [undefined, null, NaN, 'abc']) {
      expect(formatMoney(bad)).not.toMatch(/NaN/)
      expect(formatCompactMoney(bad)).not.toMatch(/NaN/)
      expect(formatPercent(bad)).not.toMatch(/NaN/)
    }
  })

  it('formats percentages to the requested precision', () => {
    expect(formatPercent(12.345, 1)).toBe('12.3%')
    expect(formatPercent(50)).toBe('50%')
  })

  it('pluralises', () => {
    expect(pluralize(1, 'task')).toBe('task')
    expect(pluralize(2, 'task')).toBe('tasks')
    expect(pluralize(0, 'task')).toBe('tasks')
    expect(pluralize(2, 'category', 'categories')).toBe('categories')
  })
})

describe('chart colours', () => {
  it('cycles the palette instead of running off the end', () => {
    expect(chartColor(0)).toBe(chartColor(9))
    expect(chartColor(100)).toBeTruthy()
  })

  it('gives the reserve and unallocated slices their own fixed colours', () => {
    const reserve = sliceColor({ isReserve: true }, 3)
    const unallocated = sliceColor({ isUnallocated: true }, 3)
    const normal = sliceColor({}, 3)

    expect(reserve).not.toBe(normal)
    expect(unallocated).not.toBe(normal)
    expect(reserve).not.toBe(unallocated)

    // Fixed, so the donut and its text legend cannot disagree.
    expect(sliceColor({ isReserve: true }, 7)).toBe(reserve)
  })
})
