import { Link } from 'react-router-dom'
import { CalendarPlus, Sparkles } from 'lucide-react'

/**
 * Welcome section with the primary CTA (§7.3).
 *
 * Deliberately restrained: a near-white surface with a crisp border, so it
 * settles into the page wash instead of competing with it. The only saturated
 * elements are the gradient heading and the primary button.
 */
export default function WelcomeSection() {
  return (
    <section className="rounded-3xl border border-lav-200 bg-linear-to-br from-lav-50 via-white to-white px-6 py-10 shadow-[0_1px_3px_rgba(37,33,58,0.05)] sm:px-10 sm:py-12">
      <div className="max-w-2xl">
        <span className="chip border border-lav-200 bg-white text-lav-600">
          <Sparkles className="size-3.5" aria-hidden="true" />
          AI-powered event planning
        </span>

        <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
          Let&apos;s plan something{' '}
          <span className="text-gradient">unforgettable.</span>
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted sm:text-lg">
          Tell us about your celebration. We&apos;ll help you plan every detail —
          a budget that adds up, a timeline that fits your date, a vendor
          checklist, and ideas matched to your taste.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link to="/create" className="btn-primary px-5 py-3 text-base">
            <CalendarPlus className="size-5" aria-hidden="true" />
            Create New Event
          </Link>
          <Link to="/events" className="btn-secondary px-5 py-3 text-base">
            View my events
          </Link>
        </div>

        <p className="mt-5 text-xs leading-relaxed text-muted">
          Festivo AI generates planning estimates. No vendor is contacted, booked,
          or price-checked for you.
        </p>
      </div>
    </section>
  )
}
