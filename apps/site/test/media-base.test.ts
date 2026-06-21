import { describe, it, expect } from 'vitest'
import { resolveMediaBase } from '../src/lib/media-base'

describe('resolveMediaBase', () => {
  it('uses the configured origin, trimming a trailing slash', () => {
    expect(resolveMediaBase('https://cdn.example.com/', true)).toBe('https://cdn.example.com')
    expect(resolveMediaBase('https://cdn.example.com', false)).toBe('https://cdn.example.com')
  })

  it('falls back to the dev media API only in dev', () => {
    expect(resolveMediaBase(undefined, true)).toBe('http://localhost:4444')
  })

  it('falls back to RELATIVE (empty) in a production build — never localhost', () => {
    expect(resolveMediaBase(undefined, false)).toBe('')
  })
})
