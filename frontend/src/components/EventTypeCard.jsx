import { ArrowRight, Check } from 'lucide-react'

import { tintClasses } from '../constants/eventTypes'

/**
 * Selectable event category card (§7.3, §7.4).
 *
 * Renders as a radio when used inside the form (so keyboard and screen-reader
 * selection work properly), and as a link-style button on the dashboard.
 */
export default function EventTypeCard({
  type,
  selected = false,
  onSelect,
  variant = 'radio',
  name = 'event_type',
  describedBy,
}) {
  const Icon = type.icon
  const isRadio = variant === 'radio'
  const tint = tintClasses(type.value)

  const shell = [
    tint.card,
    'group relative flex h-full w-full flex-col p-5 text-left transition-all',
    selected ? tint.selected : tint.hover,
    // The radio input itself is visually hidden, so the focus ring has to be
    // drawn on this shell via the peer- variant or it would be invisible.
    isRadio
      ? 'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand'
      : '',
  ].join(' ')

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-xl shadow-[0_1px_3px_rgba(37,33,58,0.06)] ${tint.icon}`}
          aria-hidden="true"
        >
          <Icon className="size-5.5" />
        </span>

        {isRadio ? (
          <span
            aria-hidden="true"
            className={[
              'grid size-5 shrink-0 place-items-center rounded-full border transition-colors',
              selected ? `${tint.check} text-white` : 'border-control bg-white',
            ].join(' ')}
          >
            {selected && <Check className="size-3" strokeWidth={3} />}
          </span>
        ) : (
          <ArrowRight
            className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
            aria-hidden="true"
          />
        )}
      </div>

      <h3 className="mt-4 text-base font-bold">{type.label}</h3>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {type.tagline}
      </p>
      <p className="mt-2.5 flex-1 text-sm leading-relaxed text-muted">
        {type.description}
      </p>

      <ul className="mt-4 flex flex-wrap gap-1.5">
        {type.examples.map((example) => (
          <li key={example} className={`chip border ${tint.chip}`}>
            {example}
          </li>
        ))}
      </ul>
    </>
  )

  if (!isRadio) {
    return (
      <button
        type="button"
        onClick={() => onSelect?.(type.value)}
        className={shell}
        aria-label={`Plan a ${type.label}`}
      >
        {body}
      </button>
    )
  }

  return (
    <label className="relative flex h-full cursor-pointer">
      <input
        type="radio"
        name={name}
        value={type.value}
        checked={selected}
        onChange={() => onSelect?.(type.value)}
        aria-describedby={describedBy}
        className="peer absolute size-0 opacity-0"
      />
      <div className={shell}>{body}</div>
    </label>
  )
}
