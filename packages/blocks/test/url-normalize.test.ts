import { describe, it, expect } from 'vitest'
import { normalizeUrlInput } from '../src/url-normalize'

// #968 — the shape checks in sanitize.ts / safe-media-href.ts inspect fixed offsets, but
// the WHATWG URL parser strips ASCII tab/LF/CR from its input BEFORE parsing. These cases
// pin the normalization that closes the gap between the two views of the same string.

describe('normalizeUrlInput (#968 — parser-equivalent pre-parse normalization)', () => {
  it('removes ASCII tab/LF/CR from anywhere in the string', () => {
    expect(normalizeUrlInput('/\t/evil.example')).toBe('//evil.example')
    expect(normalizeUrlInput('/\n/evil.example')).toBe('//evil.example')
    expect(normalizeUrlInput('/\r/evil.example')).toBe('//evil.example')
    expect(normalizeUrlInput('/\t\\evil.example')).toBe('/\\evil.example')
    expect(normalizeUrlInput('/\t\n\r/evil.example')).toBe('//evil.example')
  })

  it('matches what the WHATWG URL parser does with the same input', () => {
    // The reason this function exists: both spellings resolve to the SAME origin, so a
    // guard must see the same string the parser sees. If this ever diverges, the guards
    // are inspecting a string the browser will not parse.
    const base = 'https://site.test/some/page/'
    for (const raw of [
      '/\t/evil.example',
      '/\n/evil.example',
      '/\t\\evil.example'
    ])
      expect(new URL(raw, base).href).toBe(
        new URL(normalizeUrlInput(raw), base).href
      )
  })

  it('trims leading/trailing whitespace', () => {
    expect(normalizeUrlInput('  https://ok.example/  ')).toBe(
      'https://ok.example/'
    )
    expect(normalizeUrlInput('   ')).toBe('')
  })

  it('leaves an ordinary URL untouched (percent-encoded control chars stay encoded)', () => {
    expect(normalizeUrlInput('https://ok.example/a?b=c#d')).toBe(
      'https://ok.example/a?b=c#d'
    )
    // %09 is NOT a tab to the parser — it stays part of the path, so it must survive.
    expect(normalizeUrlInput('/%09/not-an-authority')).toBe(
      '/%09/not-an-authority'
    )
  })
})
