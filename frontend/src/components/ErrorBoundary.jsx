import { Component } from 'react'
import { RotateCcw, ServerCrash } from 'lucide-react'

/**
 * Route-level error boundary.
 *
 * Without this, a single unexpected shape in an API response — a renamed field,
 * a null where an object was expected — unmounts the whole tree and leaves a
 * blank page with no way forward. React only surfaces render-time errors to a
 * class component, so this cannot be a hook.
 *
 * This deliberately does not try to recover the broken subtree: it offers a
 * reload, which is the only honest option once render state is unknown.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Kept to the console rather than sent anywhere: there is no telemetry
    // backend, and inventing one would be worse than being explicit.
    console.error('Unhandled render error:', error, info?.componentStack)
  }

  render() {
    const { error } = this.state

    if (!error) return this.props.children

    return (
      <section
        className="card-rose mx-auto max-w-xl p-7"
        role="alert"
        aria-live="assertive"
      >
        <div className="flex gap-4">
          <span
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-rose-600 shadow-[0_1px_3px_rgba(185,58,102,0.15)] ring-1 ring-rose-200"
            aria-hidden="true"
          >
            <ServerCrash className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold">This screen hit an error</h1>
            <p className="mt-1.5 text-sm text-muted">
              Something in the page failed to render. Your saved plans are not
              affected — reloading usually clears it.
            </p>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-primary mt-5"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Reload the page
            </button>

            {import.meta.env.DEV && (
              <pre className="mt-4 overflow-x-auto rounded-xl border border-rose-200 bg-white/70 p-3 text-left font-mono text-[11px] leading-relaxed text-muted">
                {String(error?.stack ?? error?.message ?? error)}
              </pre>
            )}
          </div>
        </div>
      </section>
    )
  }
}
