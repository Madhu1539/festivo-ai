/** Client-side budget checks (§7.4 form behavior, §9.2). */

export const MAX_BUDGET = 1_000_000_000
export const MAX_GUESTS = 100_000

/**
 * @returns {string|null} an error message, or null when valid.
 */
export function validateBudget(raw) {
  if (raw === '' || raw === null || raw === undefined) {
    return 'Please enter your total budget.'
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) return 'Budget must be a number.'
  if (value <= 0) return 'Budget must be greater than zero.'
  if (value > MAX_BUDGET) return 'That budget is larger than this planner supports.'
  return null
}

export function validateGuestCount(raw) {
  if (raw === '' || raw === null || raw === undefined) {
    return 'Please enter how many guests you expect.'
  }
  const value = Number(raw)
  if (!Number.isInteger(value)) return 'Guest count must be a whole number.'
  if (value < 1) return 'You need at least one guest.'
  if (value > MAX_GUESTS) return 'That guest count is larger than this planner supports.'
  return null
}

/**
 * Advisory only — a very low per-guest budget is still allowed, but the user is
 * told before spending an AI call on it (§19.5).
 */
export function budgetAdvisory(budget, guestCount, currencySymbol = '₹') {
  const b = Number(budget)
  const g = Number(guestCount)
  if (!Number.isFinite(b) || !Number.isFinite(g) || b <= 0 || g <= 0) return null

  const perGuest = b / g
  if (perGuest < 50) {
    return `That works out to about ${currencySymbol}${Math.floor(perGuest)} per guest, which is very tight. The plan will focus on low-cost options.`
  }
  if (perGuest < 150) {
    return `About ${currencySymbol}${Math.floor(perGuest)} per guest — the plan will lean towards budget-friendly choices.`
  }
  return null
}

/** Recheck the server's arithmetic before trusting the display (§13.2). */
export function verifyBudgetTotals(budget, tolerance = 0.5) {
  if (!budget) return { ok: true, categorySum: 0, drift: 0 }

  const categorySum = (budget.categories ?? []).reduce(
    (sum, category) => sum + Number(category.estimated_amount ?? 0),
    0,
  )
  const expected =
    Number(budget.planned_expenditure ?? 0) + Number(budget.emergency_reserve ?? 0)
  const drift = Math.abs(categorySum - expected)

  return { ok: drift <= tolerance, categorySum, drift }
}
