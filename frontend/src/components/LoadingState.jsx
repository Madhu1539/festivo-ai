import { Loader2 } from 'lucide-react'

const DEFAULT_STEPS = [
  'Reading your event details',
  'Allocating your budget',
  'Building your timeline',
  'Choosing vendors and ideas',
]

/**
 * Loading state (§18.2). Nothing here implies the request has finished, and the
 * status is announced to screen readers.
 */
export default function LoadingState({
  title = 'Creating your personalized event plan…',
  message = 'This usually takes 10 to 30 seconds. Please keep this page open.',
  steps = DEFAULT_STEPS,
}) {
  return (
    <section
      className="card-lav mx-auto max-w-xl p-8 text-center"
      role="status"
      aria-live="polite"
    >
      <span
        className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-lav-600 shadow-[0_2px_8px_rgba(109,74,255,0.12)] ring-1 ring-lav-200"
        aria-hidden="true"
      >
        <Loader2 className="size-7 animate-spin" />
      </span>

      <h2 className="mt-5 text-lg font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{message}</p>

      <ul className="mt-6 space-y-2.5 text-left">
        {steps.map((step, index) => (
          <li key={step} className="flex items-center gap-3 text-sm text-muted">
            <span
              className="size-2 shrink-0 animate-pulse rounded-full bg-brand-mid"
              style={{ animationDelay: `${index * 250}ms` }}
              aria-hidden="true"
            />
            {step}
          </li>
        ))}
      </ul>

      <div
        className="mt-6 h-1.5 overflow-hidden rounded-full bg-lav-100 ring-1 ring-lav-200/60"
        aria-hidden="true"
      >
        <div className="h-full w-1/3 animate-[loading_1.6s_ease-in-out_infinite] rounded-full bg-linear-to-r from-brand to-chart-5" />
      </div>

      <style>{`
        @keyframes loading {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(320%); }
        }
      `}</style>
    </section>
  )
}
