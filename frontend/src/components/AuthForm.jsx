/**
 * Shared sign-in / sign-up form.
 *
 * One component for both because the fields, validation, error handling and
 * focus behaviour are identical; only the labels and the submit action differ.
 * Two near-copies would drift, and the accessibility details are exactly the
 * kind that get fixed in one copy and forgotten in the other.
 */

import { useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Loader2, LogIn, UserPlus } from 'lucide-react'

import { MIN_PASSWORD_LENGTH, validateCredentials } from '../forms/authFormModel'

function FieldError({ id, message }) {
  if (!message) return null
  return (
    <p id={id} className="field-error">
      <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  )
}

export default function AuthForm({
  mode,
  onSubmit,
  isSubmitting,
  submitError,
  onClearError,
}) {
  const isRegister = mode === 'register'
  const [values, setValues] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const formRef = useRef(null)
  const errorRef = useRef(null)

  const uid = useId()
  const emailId = `${uid}-email`
  const passwordId = `${uid}-password`
  const emailErrorId = `${emailId}-error`
  const passwordErrorId = `${passwordId}-error`
  const passwordHintId = `${passwordId}-hint`
  const summaryId = `${uid}-summary`

  const update = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }))
    // Clear this field's error as soon as the user edits it, so the message
    // does not contradict what they are now typing.
    setErrors((current) =>
      current[field] ? { ...current, [field]: undefined } : current,
    )
    if (submitError) onClearError?.()
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (isSubmitting) return

    const found = validateCredentials(values, { isRegister })
    setErrors(found)

    if (Object.keys(found).length > 0) {
      // Defer past this render so aria-invalid exists to be matched.
      requestAnimationFrame(() => {
        const invalid = formRef.current?.querySelector('[aria-invalid="true"]')
        invalid?.focus({ preventScroll: true })
        invalid?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      })
      return
    }

    await onSubmit(values.email, values.password)
  }

  // A rejected submit moves focus to the message, so a screen-reader user is
  // told why nothing happened instead of being left on the button.
  const focusSummary = () => {
    requestAnimationFrame(() => errorRef.current?.focus({ preventScroll: true }))
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="grid gap-5">
      {/* Server-side failures: wrong password, email taken, network. */}
      <div aria-live="polite">
        {submitError ? (
          <p
            ref={errorRef}
            id={summaryId}
            tabIndex={-1}
            className="field-error rounded-xl border border-rose-200 bg-rose-50/80 p-3"
          >
            <AlertCircle className="mt-px size-4 shrink-0" aria-hidden="true" />
            {submitError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={emailId} className="label-text">
          Email address
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input-field"
          value={values.email}
          onChange={update('email')}
          aria-invalid={errors.email ? 'true' : undefined}
          aria-describedby={errors.email ? emailErrorId : undefined}
        />
        <FieldError id={emailErrorId} message={errors.email} />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={passwordId} className="label-text">
          Password
        </label>
        <input
          id={passwordId}
          name="password"
          type="password"
          // "new-password" tells a password manager to offer a generated one
          // on sign-up and not to autofill the saved one.
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          required
          className="input-field"
          value={values.password}
          onChange={update('password')}
          aria-invalid={errors.password ? 'true' : undefined}
          aria-describedby={
            [
              errors.password ? passwordErrorId : null,
              isRegister ? passwordHintId : null,
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
        />
        {isRegister ? (
          <p id={passwordHintId} className="text-xs text-muted">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        ) : null}
        <FieldError id={passwordErrorId} message={errors.password} />
      </div>

      <button
        type="submit"
        className="btn-primary justify-center"
        disabled={isSubmitting}
        aria-busy={isSubmitting ? 'true' : undefined}
        onClick={submitError ? focusSummary : undefined}
      >
        {isSubmitting ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : isRegister ? (
          <UserPlus className="size-4" aria-hidden="true" />
        ) : (
          <LogIn className="size-4" aria-hidden="true" />
        )}
        {isSubmitting
          ? isRegister
            ? 'Creating your account…'
            : 'Signing you in…'
          : isRegister
            ? 'Create account'
            : 'Sign in'}
      </button>

      <p className="text-center text-sm text-muted">
        {isRegister ? 'Already have an account? ' : 'New to Festivo AI? '}
        <Link
          to={isRegister ? '/login' : '/register'}
          className="font-semibold text-brand underline-offset-2 hover:underline"
        >
          {isRegister ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </form>
  )
}
