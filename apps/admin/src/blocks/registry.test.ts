import { describe, it, expect } from 'vitest'
import { registry } from './registry'

describe('admin block registry', () => {
  it('includes the button standard block under the layout group', () => {
    expect(registry.knownBlockTags.has('button')).toBe(true)
    expect(registry.blocksByTag.get('button')?.editor?.group).toBe('layout')
  })
  it('keeps site-local folder blocks (callout, notice)', () => {
    expect(registry.knownBlockTags.has('callout')).toBe(true)
    expect(registry.knownBlockTags.has('notice')).toBe(true)
  })
  it('keeps the manually-registered image tag', () => {
    expect(registry.knownBlockTags.has('image')).toBe(true)
  })
})
