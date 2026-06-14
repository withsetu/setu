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

  it('validates the callout props schema (type enum with info default)', () => {
    const callout = defaultConfig.blocks.find((b) => b.tag === 'callout')!
    expect(callout.props.parse({})).toEqual({ type: 'info' })
    expect(() => callout.props.parse({ type: 'nope' })).toThrow()
  })
})
