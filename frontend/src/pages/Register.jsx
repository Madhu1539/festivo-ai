/** Sign-up screen. */

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { PartyPopper } from 'lucide-react'

import AuthForm from '../components/AuthForm'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const { register, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const headingRef = useRef(null)

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
      await register(email, password)
      navigate(next, { replace: true })
    } catch (caught) {
      setError(
        caught?.message ??
          'Could not create your account. Please try again in a moment.',
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
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold">
            Create your account
          </h1>
          <p className="text-sm text-muted">
            So your event plans are saved to you, and only you.
          </p>
        </div>

        <AuthForm
          mode="register"
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          submitError={error}
          onClearError={() => setError(null)}
        />
      </div>

      <p className="mt-4 text-center text-xs text-muted">
        Prefer to look around first? You can{' '}
        <Link to="/create" className="font-semibold text-brand hover:underline">
          generate a plan without an account
        </Link>
        .
      </p>
    </div>
  )
}
