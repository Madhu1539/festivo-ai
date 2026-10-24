import { AlertTriangle, Info, ShieldAlert } from 'lucide-react'

/**
 * Assumptions and warnings (§8.2, §12.4, §21). Estimates and assumptions must be
 * clearly identified rather than buried.
 */
export default function NoticeList({ assumptions = [], warnings = [], disclaimer }) {
  const hasContent = assumptions.length > 0 || warnings.length > 0 || disclaimer

  if (!hasContent) return null

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {warnings.length > 0 && (
        <section
          className="card-butter p-5"
          aria-labelledby="warnings-heading"
        >
          <h3
            id="warnings-heading"
            className="flex items-center gap-2 text-sm font-bold text-warning"
          >
            <AlertTriangle className="size-4" aria-hidden="true" />
            Things to watch ({warnings.length})
          </h3>
          <ul className="mt-3 space-y-2">
            {warnings.map((warning, index) => (
              <li
                key={`${index}-${warning.slice(0, 24)}`}
                className="flex gap-2.5 text-sm leading-relaxed text-ink/90"
              >
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-butter-600" aria-hidden="true" />
                {warning}
              </li>
            ))}
          </ul>
        </section>
      )}

      {assumptions.length > 0 && (
        <section
          className="card-sky p-5"
          aria-labelledby="assumptions-heading"
        >
          <h3
            id="assumptions-heading"
            className="flex items-center gap-2 text-sm font-bold"
          >
            <Info className="size-4 text-sky-600" aria-hidden="true" />
            What we assumed ({assumptions.length})
          </h3>
          <p className="mt-1.5 text-xs text-muted">
            You did not specify these, so the plan made a reasonable choice.
          </p>
          <ul className="mt-3 space-y-2">
            {assumptions.map((assumption, index) => (
              <li
                key={`${index}-${assumption.slice(0, 24)}`}
                className="flex gap-2.5 text-sm leading-relaxed text-muted"
              >
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sky-600" aria-hidden="true" />
                {assumption}
              </li>
            ))}
          </ul>
        </section>
      )}

      {disclaimer && (
        <section className="card-teal p-5 lg:col-span-2">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <ShieldAlert className="size-4 text-teal-600" aria-hidden="true" />
            Estimates, not quotations
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{disclaimer}</p>
        </section>
      )}
    </div>
  )
}
