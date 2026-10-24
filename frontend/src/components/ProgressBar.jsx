/**
 * Progress bar that never relies on colour alone — the percentage and counts are
 * always in text (§18.6).
 */
export default function ProgressBar({
  completed = 0,
  total = 0,
  percent,
  label = 'Progress',
  showCounts = true,
  size = 'md',
}) {
  const value =
    typeof percent === 'number'
      ? percent
      : total > 0
        ? (completed / total) * 100
        : 0
  const clamped = Math.max(0, Math.min(100, value))
  const isComplete = total > 0 && completed >= total
  const height = size === 'sm' ? 'h-1.5' : 'h-2.5'

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs font-semibold">
        <span className="text-muted">{label}</span>
        <span className={isComplete ? 'text-success' : 'text-ink'}>
          {clamped.toFixed(0)}%
          {showCounts && total > 0 && (
            <span className="ml-1.5 font-medium text-muted">
              ({completed} of {total})
            </span>
          )}
        </span>
      </div>

      <div
        className={`${height} overflow-hidden rounded-full bg-white/80 ring-1 ring-lav-200/70`}
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${clamped.toFixed(0)} percent complete`}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isComplete
              ? 'bg-linear-to-r from-mint-600 to-chart-7'
              : 'bg-linear-to-r from-brand to-chart-5'
          }`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}
