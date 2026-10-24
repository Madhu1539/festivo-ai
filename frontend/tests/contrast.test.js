import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * WCAG 2.1 contrast guard for the design tokens (§18.6).
 *
 * This reads the real `index.css` rather than a copy of the palette, so the
 * assertions cannot drift away from what the app actually renders. If someone
 * lightens a token, this test fails with the computed ratio.
 */

// Resolved from the Vitest root (the `frontend` directory) because the jsdom
// environment does not expose a file:// import.meta.url.
const CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

/** Pull `--color-x: #hex;` declarations out of the @theme block. */
function readTokens(css) {
  const tokens = {}
  const pattern = /--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g
  let match
  while ((match = pattern.exec(css)) !== null) {
    tokens[match[1]] = match[2].toLowerCase()
  }
  return tokens
}

const TOKENS = readTokens(CSS)

function toRgb(hex) {
  const value = hex.replace('#', '')
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ]
}

/** WCAG 2.x relative luminance. */
function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/** Composite a colour at a given alpha over an opaque backdrop. */
function over(hex, alpha, backdrop) {
  const fg = toRgb(hex)
  const bg = toRgb(backdrop)
  const mixed = fg.map((channel, i) =>
    Math.round(channel * alpha + bg[i] * (1 - alpha)),
  )
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

const WHITE = '#ffffff'
const AA_NORMAL = 4.5
const AA_LARGE = 3
const NON_TEXT = 3

const TINTS = ['lav', 'mint', 'peach', 'sky', 'butter', 'rose', 'teal']

describe('design tokens are present', () => {
  it('parses every tint family out of index.css', () => {
    for (const tint of TINTS) {
      for (const step of [50, 100, 200, 600]) {
        expect(
          TOKENS[`${tint}-${step}`],
          `--color-${tint}-${step} missing from index.css`,
        ).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })
})

describe('body text contrast (WCAG AA, 4.5:1)', () => {
  // text-muted is the single largest text surface in the app: it is used for
  // every description, hint and secondary label, on all seven card washes.
  const surfaces = [
    ['white', WHITE],
    ['canvas', () => TOKENS.canvas],
    ...TINTS.map((tint) => [`${tint}-50`, () => TOKENS[`${tint}-50`]]),
  ]

  for (const [name, bg] of surfaces) {
    it(`text-muted on ${name}`, () => {
      const background = typeof bg === 'function' ? bg() : bg
      const ratio = contrast(TOKENS.muted, background)
      expect(
        ratio,
        `text-muted on ${name} is ${ratio.toFixed(2)}:1, need ${AA_NORMAL}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL)
    })

    it(`text-ink on ${name}`, () => {
      const background = typeof bg === 'function' ? bg() : bg
      const ratio = contrast(TOKENS.ink, background)
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL)
    })
  }
})

describe('tint label contrast (WCAG AA, 4.5:1)', () => {
  // Each *-600 is used as `text-<tint>-600` on chips and headers whose
  // background is the matching *-50 wash. Both pairings must clear AA.
  for (const tint of TINTS) {
    it(`${tint}-600 on ${tint}-50`, () => {
      const ratio = contrast(TOKENS[`${tint}-600`], TOKENS[`${tint}-50`])
      expect(
        ratio,
        `${tint}-600 on ${tint}-50 is ${ratio.toFixed(2)}:1, need ${AA_NORMAL}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL)
    })

    it(`${tint}-600 on white`, () => {
      const ratio = contrast(TOKENS[`${tint}-600`], WHITE)
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL)
    })
  }
})

describe('semantic state colours', () => {
  // These are read out on tinted cards as well as on white, so check the
  // worst-case wash for each rather than only the white baseline.
  const worstCase = (fg) =>
    Math.min(
      ...[WHITE, TOKENS.canvas, ...TINTS.map((t) => TOKENS[`${t}-50`])].map(
        (bg) => contrast(fg, bg),
      ),
    )

  it('text-success clears AA on every wash', () => {
    const ratio = worstCase(TOKENS.success)
    expect(ratio, `worst case ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
  })

  it('text-warning clears AA on every wash', () => {
    const ratio = worstCase(TOKENS.warning)
    expect(ratio, `worst case ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
  })

  it('text-danger clears AA on every wash', () => {
    const ratio = worstCase(TOKENS.danger)
    expect(ratio, `worst case ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
  })
})

describe('button and control contrast', () => {
  it('white text on bg-brand', () => {
    expect(contrast(WHITE, TOKENS.brand)).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('white text on bg-brand-deep', () => {
    expect(contrast(WHITE, TOKENS['brand-deep'])).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
  })

  it('control border clears 3:1 on white (WCAG 1.4.11)', () => {
    // .field-input and the checklist checkbox rely on their border alone to
    // mark the control boundary and the unchecked state.
    const ratio = contrast(TOKENS.control, WHITE)
    expect(
      ratio,
      `--color-control on white is ${ratio.toFixed(2)}:1, need ${NON_TEXT}:1`,
    ).toBeGreaterThanOrEqual(NON_TEXT)
  })

  it('focus ring clears 3:1 on white and on every wash', () => {
    for (const bg of [WHITE, TOKENS.canvas, ...TINTS.map((t) => TOKENS[`${t}-50`])]) {
      expect(contrast(TOKENS.brand, bg)).toBeGreaterThanOrEqual(NON_TEXT)
    }
  })
})

describe('placeholder text', () => {
  it('is rendered at full opacity so it clears AA', () => {
    // A `/70` opacity modifier here composites to ~2.9:1 and fails.
    expect(CSS).toMatch(/placeholder:text-muted(?![/\d])/)
    expect(CSS).not.toMatch(/placeholder:text-muted\/\d+/)
  })
})

describe('gradient heading text', () => {
  it('its lightest stop clears AA-large, and is only used on large text', () => {
    // .text-gradient ends on chart-5. That stop only clears the 3:1 large-text
    // threshold, which is why the small wordmarks use solid text-brand.
    const ratio = contrast(TOKENS['chart-5'], WHITE)
    expect(ratio).toBeGreaterThanOrEqual(AA_LARGE)
  })
})

describe('composited header washes', () => {
  // SectionCard layers `<tint>-100/50` over the card's `<tint>-50`. Keep this
  // alpha in step with TONES in src/components/SectionCard.jsx.
  const HEADER_ALPHA = 0.5

  it('matches the alpha SectionCard actually uses', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/SectionCard.jsx'),
      'utf8',
    )
    const alphas = [...source.matchAll(/-100\/(\d+)\s+to-transparent/g)].map(
      (match) => Number(match[1]) / 100,
    )
    expect(alphas.length).toBeGreaterThan(0)
    for (const alpha of alphas) {
      expect(alpha).toBeLessThanOrEqual(HEADER_ALPHA)
    }
  })

  it('text-muted stays legible on the SectionCard tinted headers', () => {
    for (const tint of TINTS) {
      const wash = over(TOKENS[`${tint}-100`], HEADER_ALPHA, TOKENS[`${tint}-50`])
      const ratio = contrast(TOKENS.muted, wash)
      expect(
        ratio,
        `text-muted on ${tint} header wash ${wash} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })
})
