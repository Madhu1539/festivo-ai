import { NavLink, Link } from 'react-router-dom'
import { CalendarHeart, LayoutDashboard, PartyPopper, Plus } from 'lucide-react'

/** Branded navigation header (§7.3). */
export default function Navbar() {
  const linkClass = ({ isActive }) =>
    [
      'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
      isActive
        ? 'border border-lav-200 bg-white/90 text-brand-deep shadow-[0_1px_3px_rgba(109,74,255,0.12)]'
        : 'border border-transparent text-muted hover:bg-white/70 hover:text-brand',
    ].join(' ')

  return (
    <header className="sticky top-0 z-40 border-b border-lav-200/70 bg-linear-to-r from-lav-50/90 via-white/85 to-rose-50/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2.5"
          aria-label="Festivo AI — go to dashboard"
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-brand to-chart-5 text-white shadow-[0_2px_8px_rgba(109,74,255,0.35)]"
            aria-hidden="true"
          >
            <PartyPopper className="size-5" />
          </span>
          {/* The wordmark is dropped on very narrow phones so the nav still fits.
              Solid brand, not .text-gradient: at 18px the gradient's pink end
              only clears the large-text threshold. */}
          <span className="hidden text-lg font-extrabold tracking-tight xs:inline">
            Festivo<span className="text-brand"> AI</span>
          </span>
        </Link>

        <nav aria-label="Main" className="ml-auto flex shrink-0 items-center gap-1">
          <NavLink to="/" end className={linkClass}>
            <LayoutDashboard className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Dashboard</span>
          </NavLink>
          <NavLink to="/events" className={linkClass}>
            <CalendarHeart className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">My Events</span>
          </NavLink>
          <Link to="/create" className="btn-primary ml-1 px-3 sm:px-4">
            <Plus className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Create New Event</span>
            <span className="sm:hidden">New</span>
          </Link>
        </nav>
      </div>
    </header>
  )
}
