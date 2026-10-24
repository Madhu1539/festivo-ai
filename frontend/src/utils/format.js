/** Display formatting helpers. */

const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ' }

export function currencySymbol(currency = 'INR') {
  return SYMBOLS[currency] ?? `${currency} `
}

/** "₹15,000" — Indian digit grouping, no decimals for whole amounts. */
export function formatMoney(amount, currency = 'INR') {
  const value = Number(amount)
  if (!Number.isFinite(value)) return '—'

  const hasPaise = Math.abs(value % 1) > 0.004
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: hasPaise ? 2 : 0,
      maximumFractionDigits: hasPaise ? 2 : 0,
    }).format(value)
  } catch {
    return `${currencySymbol(currency)}${value.toLocaleString('en-IN')}`
  }
}

/** "₹1.2L" / "₹15.0k" — for stat tiles where space is tight. */
export function formatCompactMoney(amount, currency = 'INR') {
  const value = Number(amount)
  if (!Number.isFinite(value)) return '—'
  const symbol = currencySymbol(currency)

  if (currency === 'INR') {
    if (Math.abs(value) >= 1e7) return `${symbol}${(value / 1e7).toFixed(2)}Cr`
    if (Math.abs(value) >= 1e5) return `${symbol}${(value / 1e5).toFixed(2)}L`
    if (Math.abs(value) >= 1000) return `${symbol}${(value / 1000).toFixed(1)}k`
    return formatMoney(value, currency)
  }

  if (Math.abs(value) >= 1e6) return `${symbol}${(value / 1e6).toFixed(2)}M`
  if (Math.abs(value) >= 1000) return `${symbol}${(value / 1000).toFixed(1)}k`
  return formatMoney(value, currency)
}

export function formatPercent(value, digits = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0%'
  return `${number.toFixed(digits)}%`
}

export function pluralize(count, singular, plural) {
  return count === 1 ? singular : (plural ?? `${singular}s`)
}

/** Stable colour per chart slice, cycling the §7.2 palette. */
export const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
  'var(--color-chart-7)',
  'var(--color-chart-8)',
  'var(--color-chart-9)',
]

export function chartColor(index) {
  return CHART_COLORS[index % CHART_COLORS.length]
}

/**
 * Colour for one budget slice, shared by the donut and its text legend so the
 * two can never drift apart.
 *
 * This lives here rather than next to the chart because the legend must not
 * pull the (lazily loaded) chart module into the initial bundle.
 */
export function sliceColor(slice, index) {
  if (slice.isUnallocated) return 'var(--color-lav-200)'
  if (slice.isReserve) return 'var(--color-mint-600)'
  return chartColor(index)
}
