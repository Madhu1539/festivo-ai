/**
 * Validation for the sign-in / sign-up form.
 *
 * Separate from the component for the same reason as eventFormModel: the
 * rules are worth reading and testing without the markup around them.
 *
 * These bounds mirror the server's (`Password` and the email pattern in
 * schemas.py). They are a courtesy to the user, not a security control - the
 * server validates independently and does not trust anything checked here.
 */

/** Matches the backend's `Password` lower bound. */
export const MIN_PASSWORD_LENGTH = 10

/** Matches the backend's `Password` upper bound. */
export const MAX_PASSWORD_LENGTH = 128

// Deliberately permissive: one @ with text either side. Anything stricter
// rejects addresses that are actually valid, and no pattern can tell whether
// an address exists.
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/

export function validateCredentials(values, { isRegister = false } = {}) {
  const errors = {}

  const email = (values.email ?? '').trim()
  if (!email) {
    errors.email = 'Please enter your email address.'
  } else if (!EMAIL_SHAPE.test(email)) {
    errors.email = 'Please enter a valid email address.'
  }

  const password = values.password ?? ''
  if (!password) {
    errors.password = 'Please enter your password.'
  } else if (isRegister && password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Please use at least ${MIN_PASSWORD_LENGTH} characters.`
  } else if (password.length > MAX_PASSWORD_LENGTH) {
    errors.password = `Please use ${MAX_PASSWORD_LENGTH} characters or fewer.`
  }

  return errors
}
