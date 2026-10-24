/** Focus management helpers for form error handling. */

const FOCUSABLE = 'input, select, textarea, button, a[href]'

/**
 * Move focus to the first field in `container` marked `aria-invalid="true"`.
 *
 * Two things make this less trivial than it looks:
 *
 * 1. React commits state asynchronously, so this must be called after the
 *    render that adds the `aria-invalid` attributes — otherwise it matches
 *    nothing. `focusFirstInvalidAsync` handles the deferral.
 * 2. A group container (the event-type radio group) carries `aria-invalid`
 *    itself but is not focusable. Calling `focus()` on it silently does
 *    nothing, so we step into its first control instead.
 *
 * @returns {Element|null} the element that received focus, or null.
 */
export function focusFirstInvalid(container, fallback = null) {
  const invalid = container?.querySelector('[aria-invalid="true"]')

  const target =
    (invalid?.matches(FOCUSABLE) ? invalid : invalid?.querySelector(FOCUSABLE)) ??
    fallback

  if (!target) return null

  // preventScroll then scrollIntoView, so the field lands centred rather than
  // jammed against the top of the viewport.
  target.focus({ preventScroll: true })
  target.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  return target
}

/** `focusFirstInvalid`, deferred past the pending React commit. */
export function focusFirstInvalidAsync(getContainer, getFallback) {
  requestAnimationFrame(() => {
    focusFirstInvalid(getContainer(), getFallback?.() ?? null)
  })
}
