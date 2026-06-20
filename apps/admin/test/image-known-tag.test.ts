import { describe, it, expect } from 'vitest'
import { markdocToTiptap } from '@setu/core'
import { registry } from '../src/blocks/registry'

describe('image is a known editor tag', () => {
  it('registry.knownBlockTags includes "image"', () => {
    expect(registry.knownBlockTags.has('image')).toBe(true)
  })

  it('loading {% image %} via the registry tags yields an imageBlock node', () => {
    const doc = markdocToTiptap(`{% image src="/uploads/media/x/original.jpg" align="wide" /%}\n`, {
      knownBlockTags: registry.knownBlockTags,
    })
    expect(doc.content?.[0]?.type).toBe('imageBlock')
  })
})
