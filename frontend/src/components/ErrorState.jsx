import { AlertTriangle, KeyRound, RotateCw, ServerOff, WifiOff } from 'lucide-react'

/**
 * The icon that best explains a failure.
 *
 * Returns an element rather than a component type: selecting a component and
 * binding it to a capitalised local inside the render body reads as creating a
 * component per render, which is a real anti-pattern the linter rightly
 * objects to. Returning the element sidesteps that without a suppression.
 */
function iconFor(error) {
  const className = 'size-5'
  if (error?.isConfigIssue) return <KeyRound className={className} />
  if (error?.code === 'NETWORK_ERROR') return <WifiOff className={className} />
  if (error?.isStorageIssue) return <ServerOff className={className} />
  return <AlertTriangle className={className} />
}

function hintFor(error) {
  switch (error?.code) {
    case 'AI_NOT_CONFIGURED':
      return 'Add GEMINI_API_KEY to backend/.env and restart the backend. The key stays on the server and is never sent to your browser.'
    case 'NETWORK_ERROR':
      return 'Start the backend with `uvicorn app.main:app --reload` from the backend folder, then retry.'
    case 'AI_RATE_LIMITED':
      return 'The AI provider is throttling requests. Waiting about a minute usually clears it.'
    case 'AI_TIMEOUT':
      return 'The model took too long to respond. Retrying usually works.'
    case 'AI_INVALID_OUTPUT':
    case 'BUDGET_VALIDATION_FAILED':
      return 'The generated plan failed validation, so it was not shown. Your event details are unchanged — try again.'
    case 'STORAGE_UNAVAILABLE':
      return 'Check DATABASE_URL in backend/.env. Plan generation still works without it; only saving is affected.'
    default:
      return null
  }
}

/**
 * Error state (§18.4). Shows a friendly message, the cause when it is
 * actionable, and a retry action. Entered form values are kept by the caller.
 */
export default function ErrorState({
  error,
  onRetry,
  retryLabel = 'Try again',
  secondaryAction = null,
  title = 'We could not finish that',
  className = '',
}) {
  const icon = iconFor(error)
  const hint = hintFor(error)
  const details = Array.isArray(error?.details) ? error.details : []

  return (
    <section
      className={`card-rose mx-auto max-w-xl p-7 ${className}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex gap-4">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-rose-600 shadow-[0_1px_3px_rgba(194,63,108,0.15)] ring-1 ring-rose-200"
          aria-hidden="true"
        >
          {icon}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">{title}</h2>
          <p className="mt-1.5 text-sm text-muted">
            {error?.message ?? 'Something went wrong. Please try again.'}
          </p>

          {details.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-danger">
              {details.map((detail, index) => (
                <li key={`${detail.field ?? index}-${index}`}>
                  {detail.field ? (
                    <>
                      <span className="font-semibold">{detail.field}</span>:{' '}
                      {detail.message}
                    </>
                  ) : (
                    String(detail.message ?? detail)
                  )}
                </li>
              ))}
            </ul>
          )}

          {hint && (
            <p className="mt-3 rounded-xl border border-rose-200 bg-white/70 px-3.5 py-2.5 text-xs leading-relaxed text-muted">
              {hint}
            </p>
          )}

          {error?.code && (
            <p className="mt-3 font-mono text-[11px] uppercase tracking-wide text-muted">
              {error.code}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {onRetry && (
              <button type="button" onClick={onRetry} className="btn-primary">
                <RotateCw className="size-4" aria-hidden="true" />
                {retryLabel}
              </button>
            )}
            {secondaryAction}
          </div>
        </div>
      </div>
    </section>
  )
}
