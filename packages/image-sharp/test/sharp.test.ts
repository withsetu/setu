import { describe, it, expect } from 'vitest'
import { makeTestPng, detectFormat } from '@setu/image-testing'
import { createSharpImageAdapter } from '../src/index'

const source = makeTestPng(200, 120)

describe('createSharpImageAdapter', () => {
  it('encodes AVIF (the slow path) with the right content-type and dims', async () => {
    const port = createSharpImageAdapter()
    const v = (await port.generate(source, [{ name: 'a', width: 80, format: 'avif' }]))[0]!
    expect(v.contentType).toBe('image/avif')
    expect(detectFormat(v.body)).toBe('avif')
    expect(v.width).toBe(80)
    expect(v.height).toBe(48) // 120 * 80 / 200
  })

  it('honours a quality override — lower quality yields a smaller body', async () => {
    const port = createSharpImageAdapter()
    const lo = (await port.generate(source, [{ name: 'lo', width: 200, format: 'webp', quality: 30 }]))[0]!
    const hi = (await port.generate(source, [{ name: 'hi', width: 200, format: 'webp', quality: 90 }]))[0]!
    expect(lo.body.length).toBeLessThan(hi.body.length)
  })

  it('throws on bytes that are not a decodable image', async () => {
    const port = createSharpImageAdapter()
    await expect(port.metadata(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow()
  })
})
