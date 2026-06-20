import { describe, it, expect, beforeEach } from 'vitest'
import { contentTypeFor } from '@setu/core'
import type { ImagePort, VariantSpec } from '@setu/core'
import { makeTestPng, detectFormat } from './png'

export { makeTestPng, detectFormat } from './png'

/** Run the ImagePort behavioural contract against an adapter. `makeAdapter` returns a
 *  ready adapter on each call. */
export function runImagePortContract(makeAdapter: () => Promise<ImagePort> | ImagePort): void {
  describe('ImagePort contract', () => {
    const source = makeTestPng(200, 120)
    let port: ImagePort
    beforeEach(async () => {
      port = await makeAdapter()
    })

    it('reads intrinsic metadata of the source', async () => {
      const m = await port.metadata(source)
      expect(m.width).toBe(200)
      expect(m.height).toBe(120)
      expect(m.format).toBe('png')
    })

    it('returns one variant per spec, in order, with names echoed', async () => {
      const specs: VariantSpec[] = [
        { name: 'a', width: 100, format: 'webp' },
        { name: 'b', width: 50, format: 'jpeg' },
      ]
      const out = await port.generate(source, specs)
      expect(out.map((v) => v.name)).toEqual(['a', 'b'])
    })

    it('resizes to the requested width, preserving aspect ratio', async () => {
      const [v] = await port.generate(source, [{ name: 'a', width: 100, format: 'webp' }])
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const variant = v!
      expect(variant.width).toBe(100)
      expect(variant.height).toBe(60) // 120 * 100 / 200
      const m = await port.metadata(variant.body)
      expect(m.width).toBe(100)
      expect(m.height).toBe(60)
    })

    it('never upscales — a width beyond the source clamps to the source width', async () => {
      const [v] = await port.generate(source, [{ name: 'big', width: 400, format: 'webp' }])
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const variant = v!
      expect(variant.width).toBe(200)
      expect(variant.height).toBe(120)
    })

    it('encodes to the requested format with the matching content-type', async () => {
      const out = await port.generate(source, [
        { name: 'w', width: 80, format: 'webp' },
        { name: 'j', width: 80, format: 'jpeg' },
        { name: 'p', width: 80, format: 'png' },
      ])
      for (const v of out) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(v.contentType).toBe(contentTypeFor(v.format))
        expect(detectFormat(v.body)).toBe(v.format)
      }
    })

    it('returns [] for an empty spec list', async () => {
      expect(await port.generate(source, [])).toEqual([])
    })
  })
}
