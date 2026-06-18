import { describe, it, expect } from 'vitest'
import { resolveConfig } from '../../src/config/resolve'

describe('config theme field', () => {
  it('passes the theme field through to the resolved config', () => {
    const r = resolveConfig({ blocks: [], theme: '@saytu/theme-default' })
    expect(r.theme).toBe('@saytu/theme-default')
  })
  it('leaves theme undefined when omitted (back-compat with blocks-only configs)', () => {
    const r = resolveConfig({ blocks: [] })
    expect(r.theme).toBeUndefined()
  })
})
