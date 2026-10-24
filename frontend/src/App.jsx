import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'

import ErrorBoundary from './components/ErrorBoundary'
import Navbar from './components/Navbar'
import EmptyState from './components/EmptyState'
import { PlanProvider } from './context/PlanContext'
import CreateEvent from './pages/CreateEvent'
import Dashboard from './pages/Dashboard'
import EventPlanPage from './pages/EventPlanPage'
import SavedEvents from './pages/SavedEvents'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [pathname])
  return null
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-10">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        title="That page does not exist"
        message="The link may be out of date. Head back to your dashboard to start planning."
        actionLabel="Go to dashboard"
        actionTo="/"
      />
    </div>
  )
}

export default function App() {
  return (
    <PlanProvider>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <ScrollToTop />
      <Navbar />

      {/* tabIndex=-1 so the skip link reliably moves focus, not just scroll. */}
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10"
      >
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/create" element={<CreateEvent />} />
            <Route path="/plan" element={<EventPlanPage />} />
            <Route path="/events" element={<SavedEvents />} />
            <Route path="/events/:eventId" element={<EventPlanPage />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
      </main>

      <footer className="border-t border-lav-200/70 bg-linear-to-r from-lav-50/80 via-white/70 to-teal-50/70 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
          <p className="text-sm font-bold">
            Festivo<span className="text-brand"> AI</span>
          </p>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted">
            Festivo AI generates planning suggestions and cost estimates. It does not
            contact, book, verify, or price-check vendors, and the amounts shown are
            not quotations. Always confirm details directly with your suppliers.
          </p>
        </div>
      </footer>
    </PlanProvider>
  )
}
