/** Date helpers and form-level date validation (§7.4, §10.3). */

export const ACCELERATED_THRESHOLD_DAYS = 14

/** Local (not UTC) ISO date, so "today" matches the user's calendar. */
export function toIsoDate(date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10)
}

export function todayIso() {
  return toIsoDate(new Date())
}

export function maxEventDateIso() {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 10)
  return toIsoDate(date)
}

function parseIsoDate(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(m) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return null
  }
  return date
}

/**
 * @returns {string|null} an error message, or null when valid.
 */
export function validateEventDate(value) {
  if (!value) return 'Please choose your event date.'
  const date = parseIsoDate(value)
  if (!date) return 'Please enter a valid date.'
  if (value < todayIso()) return 'The event date cannot be in the past.'
  if (value > maxEventDateIso()) return 'Please choose a date within the next 10 years.'
  return null
}

export function daysUntil(isoDate) {
  const target = parseIsoDate(isoDate)
  if (!target) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86_400_000)
}

export function isAccelerated(isoDate) {
  const days = daysUntil(isoDate)
  return days !== null && days <= ACCELERATED_THRESHOLD_DAYS
}

/** "15 Nov 2026" */
export function formatDate(isoDate, options) {
  const date = parseIsoDate(isoDate)
  if (!date) return '—'
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  })
}

/** "Saturday, 15 November 2026" */
export function formatLongDate(isoDate) {
  return formatDate(isoDate, { weekday: 'long', month: 'long' })
}

/** "in 24 days" / "today" / "4 days ago" */
export function formatRelativeDays(isoDate) {
  const days = daysUntil(isoDate)
  if (days === null) return ''
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days > 0) return `in ${days} days`
  return `${Math.abs(days)} days ago`
}

/** Groups timeline items under readable month headings. */
export function groupByMonth(items) {
  const groups = []
  for (const item of items) {
    const date = parseIsoDate(item.due_date)
    const label = date
      ? date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      : 'Scheduled'
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}
