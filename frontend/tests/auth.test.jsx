/**
 * Authentication on the client: credential validation, the sign-in form's
 * accessibility contract, and route protection.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AuthForm from '../src/components/AuthForm'
import ProtectedRoute from '../src/components/ProtectedRoute'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validateCredentials,
} from '../src/forms/authFormModel'
import { authToken } from '../src/services/eventApi'

describe('validateCredentials', () => {
  it('requires both fields', () => {
    const errors = validateCredentials({ email: '', password: '' })
    expect(errors.email).toBeTruthy()
    expect(errors.password).toBeTruthy()
  })

  it('rejects an address with no @', () => {
    expect(validateCredentials({ email: 'nope', password: 'x'.repeat(12) }).email)
      .toBeTruthy()
  })

  it('accepts a plausible address', () => {
    const errors = validateCredentials({
      email: 'madhu@example.com',
      password: 'x'.repeat(12),
    })
    expect(errors).toEqual({})
  })

  it('enforces the minimum length only when registering', () => {
    const short = { email: 'a@b.com', password: 'short' }
    // Signing in must not reject a short password locally: the account may
    // predate the rule, and only the server can say if it is correct.
    expect(validateCredentials(short, { isRegister: false }).password).toBeUndefined()
    expect(validateCredentials(short, { isRegister: true }).password).toBeTruthy()
  })

  it('rejects a password longer than the server accepts', () => {
    const errors = validateCredentials({
      email: 'a@b.com',
      password: 'x'.repeat(MAX_PASSWORD_LENGTH + 1),
    })
    expect(errors.password).toBeTruthy()
  })

  it('states the minimum length in the message, so it is actionable', () => {
    const errors = validateCredentials(
      { email: 'a@b.com', password: 'tiny' },
      { isRegister: true },
    )
    expect(errors.password).toContain(String(MIN_PASSWORD_LENGTH))
  })
})

describe('AuthForm accessibility', () => {
  const setup = (props = {}) =>
    render(
      <MemoryRouter>
        <AuthForm
          mode="login"
          onSubmit={vi.fn()}
          isSubmitting={false}
          submitError={null}
          {...props}
        />
      </MemoryRouter>,
    )

  it('labels both inputs', () => {
    setup()
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('marks invalid fields and links their messages', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: /sign in/i }))

    const email = screen.getByLabelText(/email address/i)
    expect(email).toHaveAttribute('aria-invalid', 'true')

    const describedBy = email.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    // The message must actually exist at that id, or the link is decorative.
    expect(document.getElementById(describedBy)).toHaveTextContent(/email/i)
  })

  it('moves focus to the first invalid field on a rejected submit', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() =>
      expect(screen.getByLabelText(/email address/i)).toHaveFocus(),
    )
  })

  it('does not submit when validation fails', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    setup({ onSubmit })

    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the trimmed credentials when valid', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    setup({ onSubmit })

    await user.type(screen.getByLabelText(/email address/i), 'madhu@example.com')
    await user.type(screen.getByLabelText(/password/i), 'a-long-enough-pass')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(onSubmit).toHaveBeenCalledWith('madhu@example.com', 'a-long-enough-pass')
  })

  it('announces a server error in a live region', () => {
    setup({ submitError: 'That email and password combination is not correct.' })
    const alert = screen.getByText(/not correct/i)
    expect(alert).toBeInTheDocument()
    expect(alert.closest('[aria-live]')).toBeTruthy()
  })

  it('clears a field error as soon as the field is edited', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: /sign in/i }))
    const email = screen.getByLabelText(/email address/i)
    expect(email).toHaveAttribute('aria-invalid', 'true')

    await user.type(email, 'm')
    expect(email).not.toHaveAttribute('aria-invalid')
  })

  it('marks the button busy rather than disabling it while submitting', () => {
    setup({ isSubmitting: true })
    const button = screen.getByRole('button', { name: /signing you in/i })
    // aria-busy, not disabled: a disabled control cannot hold focus, so
    // focus would drop to <body> mid-submit.
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('uses new-password autocomplete when registering', () => {
    render(
      <MemoryRouter>
        <AuthForm
          mode="register"
          onSubmit={vi.fn()}
          isSubmitting={false}
          submitError={null}
        />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText(/password/i)).toHaveAttribute(
      'autocomplete',
      'new-password',
    )
  })
})

describe('ProtectedRoute', () => {
  beforeEach(() => {
    authToken.clear()
  })

  function renderAt(path) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<p>Sign-in screen</p>} />
            <Route
              path="/events"
              element={
                <ProtectedRoute>
                  <p>Saved events</p>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
  }

  it('sends an anonymous visitor to sign in', async () => {
    renderAt('/events')
    expect(await screen.findByText('Sign-in screen')).toBeInTheDocument()
    expect(screen.queryByText('Saved events')).not.toBeInTheDocument()
  })
})

describe('authToken', () => {
  beforeEach(() => authToken.clear())

  it('round-trips a token', () => {
    expect(authToken.get()).toBeNull()
    authToken.set('abc123')
    expect(authToken.get()).toBe('abc123')
    authToken.clear()
    expect(authToken.get()).toBeNull()
  })
})

describe('useAuth', () => {
  it('refuses to be used outside a provider', () => {
    function Consumer() {
      useAuth()
      return null
    }
    // Silence the expected React error boundary noise for this one assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(/AuthProvider/)
    spy.mockRestore()
  })
})
