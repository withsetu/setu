import { describe, it, expect } from 'vitest'
import { resolveConfig } from '../../src/config/resolve'

describe('config themeOptions field', () => {
  it('passes themeOptions through to the resolved config', () => {
    const r = resolveConfig({
      blocks: [],
      themeOptions: { accent: '#0ea5e9', width: 'wide' }
    })
    expect(r.themeOptions).toEqual({ accent: '#0ea5e9', width: 'wide' })
  })
  it('leaves themeOptions undefined when omitted (back-compat)', () => {
    const r = resolveConfig({ blocks: [] })
    expect(r.themeOptions).toBeUndefined()
  })
  it('rejects a non-string option value', () => {
    expect(() =>
      resolveConfig({ blocks: [], themeOptions: { accent: 123 } })
    ).toThrow(/Invalid setu.config/)
  })
})
