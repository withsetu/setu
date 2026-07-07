import { describe, it, expect } from 'vitest'
import {
  defaultConfig,
  defaultKnownBlockTags,
  resolveConfig
} from '../../src/index'

describe('defaultConfig', () => {
  it('ships no blocks — blocks come from auto-discovered folders, not the central config', () => {
    expect(defaultConfig.blocks ?? []).toEqual([])
    expect([...defaultKnownBlockTags]).toEqual([])
  })
  it('resolves a config with no blocks (blocks is optional)', () => {
    const resolved = resolveConfig({ theme: '@setu/theme-default' })
    expect(resolved.blocks).toEqual([])
    expect(resolved.theme).toBe('@setu/theme-default')
  })
})
