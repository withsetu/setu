import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { createSharpImageAdapter } from '../src/index'

async function pngBytes(w: number, h: number): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 60 } } }).png().toBuffer()
  return new Uint8Array(buf)
}

describe('sharp placeholder (LQIP)', () => {
  it('returns a tiny blurred webp data-URI', async () => {
    const adapter = createSharpImageAdapter()
    const uri = await adapter.placeholder(await pngBytes(1600, 900), 20)
    expect(uri).toMatch(/^data:image\/webp;base64,/)
    // decode the base64 payload and confirm it is a small webp (width ~20)
    const b64 = uri.split(',')[1]!
    const bytes = Buffer.from(b64, 'base64')
    const meta = await sharp(bytes).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(20)
    expect(bytes.length).toBeLessThan(2000) // tiny
  })
})
