import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { makeTestPng, detectFormat } from '@setu/image-testing'
import { createSharpImageAdapter } from '../src/index'

const source = makeTestPng(200, 120)

/** A 4×2 landscape JPEG tagged EXIF orientation 6 — it *displays* as 2×4 portrait. */
async function orientedJpeg(): Promise<Uint8Array> {
  const buf = await sharp({
    create: {
      width: 4,
      height: 2,
      channels: 3,
      background: { r: 200, g: 100, b: 50 }
    }
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()
  return new Uint8Array(buf)
}

describe('createSharpImageAdapter', () => {
  it('encodes AVIF (the slow path) with the right content-type and dims', async () => {
    const port = createSharpImageAdapter()
    const v = (
      await port.generate(source, [{ name: 'a', width: 80, format: 'avif' }])
    )[0]!
    expect(v.contentType).toBe('image/avif')
    expect(detectFormat(v.body)).toBe('avif')
    expect(v.width).toBe(80)
    expect(v.height).toBe(48) // 120 * 80 / 200
  })

  it('honours a quality override — lower quality yields a smaller body', async () => {
    const port = createSharpImageAdapter()
    const lo = (
      await port.generate(source, [
        { name: 'lo', width: 200, format: 'webp', quality: 30 }
      ])
    )[0]!
    const hi = (
      await port.generate(source, [
        { name: 'hi', width: 200, format: 'webp', quality: 90 }
      ])
    )[0]!
    expect(lo.body.length).toBeLessThan(hi.body.length)
  })

  it('throws on bytes that are not a decodable image', async () => {
    const port = createSharpImageAdapter()
    await expect(port.metadata(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow()
  })

  it('auto-orients EXIF-rotated photos: variants are upright and metadata dims are swapped', async () => {
    const port = createSharpImageAdapter()
    const src = await orientedJpeg() // stored 4×2, displays 2×4
    // metadata reports the *display* (oriented) dimensions
    expect(await port.metadata(src)).toMatchObject({ width: 2, height: 4 })
    // the variant is baked upright (2×4 portrait), not the un-rotated 2×1
    const v = (
      await port.generate(src, [{ name: 'o', width: 2, format: 'jpeg' }])
    )[0]!
    expect(v.width).toBe(2)
    expect(v.height).toBe(4)
  })
})
