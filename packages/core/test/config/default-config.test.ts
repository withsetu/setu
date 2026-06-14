import { describe, it, expect } from 'vitest'
import { defaultConfig, defaultKnownBlockTags, resolveConfig } from '../../src/index'

describe('defaultConfig', () => {
  it('defines exactly the callout block', () => {
    expect(defaultConfig.blocks.map((b) => b.tag)).toEqual(['callout'])
  })

  it('resolves and exposes callout in defaultKnownBlockTags', () => {
    const resolved = resolveConfig(defaultConfig)
    expect([...resolved.knownBlockTags]).toEqual(['callout'])
    expect([...defaultKnownBlockTags]).toEqual(['callout'])
  })

  it('validates the callout props schema (permissive: any string type, no default)', () => {
    const callout = defaultConfig.blocks.find((b) => b.tag === 'callout')!
    // Permissive schema — no default applied, empty object is valid
    expect(callout.props.parse({})).toEqual({})
    // Any string type is accepted (not enum-restricted)
    expect(callout.props.parse({ type: 'nope' })).toEqual({ type: 'nope' })
    expect(callout.props.parse({ type: 'info' })).toEqual({ type: 'info' })
  })
})
