import { describe, it, expect } from 'vitest'
import { redactSecretsInUrls, trailingJunk } from '../src/redact'

/**
 * #1071: `URL_TRAILING_JUNK_RE` was `/[^A-Za-z0-9/_~%=+&#$@-]+$/`, an unanchored greedy character
 * class followed by `$`. On a match containing a long junk run that does NOT reach the end, the
 * engine retries that class from every start position and backtracks it against `$` — quadratic.
 * CodeQL flags it as js/polynomial-redos.
 *
 * The replacement is a backwards scan, which is linear and returns the identical value. Both
 * halves of that claim are asserted here: equivalence against the ORIGINAL regex, kept below as
 * the oracle, and a bound on the adversarial input the original is quadratic on.
 */
const OLD_TRAILING_JUNK_RE = /[^A-Za-z0-9/_~%=+&#$@-]+$/
const oldTrailingJunk = (s: string) => OLD_TRAILING_JUNK_RE.exec(s)?.[0] ?? ''

const CORPUS = [
  '',
  'a',
  '.',
  '...',
  'http://example.com',
  'http://example.com/',
  'http://example.com.',
  'http://example.com/path/to/thing',
  'http://example.com/reset?token=abc123)',
  'http://example.com/reset?token=abc123).',
  'http://example.com/wiki/Foo_(bar)',
  '_http://example.com/x_',
  '[Reset](http://example.com/r/tok)',
  'http://example.com/a.b.c',
  'http://example.com/#frag',
  'http://example.com/x***',
  'http://example.com/x)]}»…',
  '....http://example.com....',
  'http://a/' + '.'.repeat(64),
  'http://a/' + '.'.repeat(64) + 'z'
]

describe('trailingJunk matches the regex it replaced', () => {
  it('agrees with the original on every shape the redactor cares about', () => {
    for (const s of CORPUS) {
      expect(trailingJunk(s), JSON.stringify(s)).toBe(oldTrailingJunk(s))
    }
  })

  it('agrees on generated strings mixing allowed and junk characters', () => {
    // Deterministic pseudo-random (no Math.random — a failing case must be reproducible).
    let seed = 12345
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648)
    const alphabet = 'aZ9/_~%=+&#$@-.,;:!?)]}*\'"<> '
    for (let i = 0; i < 500; i++) {
      let s = ''
      const len = next() % 40
      for (let j = 0; j < len; j++)
        s += alphabet[next() % alphabet.length] as string
      expect(trailingJunk(s), JSON.stringify(s)).toBe(oldTrailingJunk(s))
    }
  })
})

describe('the scan is linear, not quadratic', () => {
  // A long junk run that stops one character short of the end is the worst case for the old
  // regex: every start position inside the run re-matches greedily and backtracks against `$`.
  // The old implementation takes seconds here; the backwards scan is immediate. The generous
  // bound keeps this a REDOS guard rather than a benchmark — quadratic on this input is orders of
  // magnitude over it, so the test cannot fail for ordinary machine noise.
  const adversarial = 'http://' + '.'.repeat(60_000) + 'a'

  it('trims the adversarial run promptly', () => {
    const started = performance.now()
    expect(trailingJunk(adversarial)).toBe('')
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('redacts a body containing it promptly', () => {
    const started = performance.now()
    redactSecretsInUrls(`see ${adversarial} for details`)
    // Same bound as the unit case, deliberately: a 2000ms bound here PASSED against the
    // quadratic regex (measured 1568ms), which made this case decorative. Both bounds are
    // kill-shot-verified to fail against the old implementation.
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
