/** Sign-in screen. */

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { PartyPopper } from 'lucide-react'

import AuthForm from '../components/AuthForm'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const headingRef = useRef(null)

  // Where the user was heading before being asked to sign in.
  const next = location.state?.from ?? '/'

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (isAuthenticated) navigate(next, { replace: true })
  }, [isAuthenticated, navigate, next])

  const handleSubmit = async (email, password) => {
    setIsSubmitting(true)
    setError(null)
    try {
      await login(email, password)
      navigate(next, { replace: true })
    } catch (caught) {
      setError(
        caught?.message ?? 'Could not sign you in. Please try again in a moment.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-md py-6">
      <div className="card p-6 sm:p-8">
        <div className="mb-6 grid gap-2 text-center">
          <span
            className="mx-auto grid size-11 place-items-center rounded-2xl bg-linear-to-br from-brand to-chart-5 text-white"
            aria-hidden="true"
          >
            <PartyPopper className="size-5" />
          </span>
          {/* tabIndex=-1 so focus can land here on arrival, which tells a
              screen-reader user what screen they are on. */}
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold">
            Welcome back
          </h1>
          <p className="text-sm text-muted">
            Sign in to see the event plans you have saved.
          </p>
        </div>

        <AuthForm
          mode="login"
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          submitError={error}
          onClearError={() => setError(null)}
        />
      </div>

      <p className="mt-4 text-center text-xs text-muted">
        You can{' '}
        <Link to="/create" className="font-semibold text-brand hover:underline">
          generate a plan without an account
        </Link>
        . Signing in is only needed to save one.
      </p>
    </div>
  )
}
