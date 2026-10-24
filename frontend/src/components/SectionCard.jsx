/** Shared section shell for the plan dashboard (§7.5). */

const TONES = {
  lavender: {
    card: 'card-lav',
    header: 'border-lav-200/70 bg-linear-to-r from-lav-100/50 to-transparent',
    icon: 'bg-white text-lav-600 ring-1 ring-lav-200',
  },
  mint: {
    card: 'card-mint',
    header: 'border-mint-200/70 bg-linear-to-r from-mint-100/50 to-transparent',
    icon: 'bg-white text-mint-600 ring-1 ring-mint-200',
  },
  peach: {
    card: 'card-peach',
    header: 'border-peach-200/70 bg-linear-to-r from-peach-100/50 to-transparent',
    icon: 'bg-white text-peach-600 ring-1 ring-peach-200',
  },
  sky: {
    card: 'card-sky',
    header: 'border-sky-200/70 bg-linear-to-r from-sky-100/50 to-transparent',
    icon: 'bg-white text-sky-600 ring-1 ring-sky-200',
  },
  butter: {
    card: 'card-butter',
    header: 'border-butter-200/70 bg-linear-to-r from-butter-100/50 to-transparent',
    icon: 'bg-white text-butter-600 ring-1 ring-butter-200',
  },
  rose: {
    card: 'card-rose',
    header: 'border-rose-200/70 bg-linear-to-r from-rose-100/50 to-transparent',
    icon: 'bg-white text-rose-600 ring-1 ring-rose-200',
  },
  teal: {
    card: 'card-teal',
    header: 'border-teal-200/70 bg-linear-to-r from-teal-100/50 to-transparent',
    icon: 'bg-white text-teal-600 ring-1 ring-teal-200',
  },
  plain: {
    card: 'card',
    header: 'border-hairline',
    icon: 'bg-lav-100 text-lav-600',
  },
}

export default function SectionCard({
  id,
  title,
  description,
  icon: Icon,
  badge,
  actions,
  tone = 'plain',
  children,
  className = '',
  bodyClassName = '',
}) {
  const palette = TONES[tone] ?? TONES.plain

  return (
    <section
      id={id}
      className={`${palette.card} section-anchor overflow-hidden ${className}`}
      aria-labelledby={id ? `${id}-heading` : undefined}
    >
      <header
        className={`flex flex-wrap items-start gap-3 border-b px-5 py-4 sm:px-6 ${palette.header}`}
      >
        {Icon && (
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-xl shadow-[0_1px_3px_rgba(37,33,58,0.06)] ${palette.icon}`}
            aria-hidden="true"
          >
            <Icon className="size-5" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id={id ? `${id}-heading` : undefined}
              className="text-base font-bold"
            >
              {title}
            </h2>
            {badge}
          </div>
          {description && (
            <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
          )}
        </div>

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>

      <div className={`px-5 py-5 sm:px-6 ${bodyClassName}`}>{children}</div>
    </section>
  )
}
