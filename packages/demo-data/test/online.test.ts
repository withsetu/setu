import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { collectPosts } from '../src/contract'
import { createAicPack, fetchAicSample } from '../src/index'

/** Opt-in integration lane (documented in the package README): hits the real AIC
 *  public API. Excluded by default — every other test in this package is
 *  fixture-only. Run with:
 *
 *      DEMO_DATA_ONLINE=1 pnpm --filter @setu/demo-data test
 */
describe.runIf(process.env.DEMO_DATA_ONLINE === '1')(
  'online: real AIC API through the pack',
  () => {
    it(
      'samples live records and loads them as normalized posts',
      { timeout: 120_000 },
      async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'demo-data-online-'))
        const file = path.join(dir, 'sample.jsonl')
        const { written } = await fetchAicSample(file, { count: 25 })
        expect(written).toBeGreaterThan(0)

        const dataset = createAicPack({ source: file }).load()
        const posts = await collectPosts(dataset)
        const stats = dataset.stats()
        expect(stats.scanned).toBe(written)
        expect(posts.length).toBeGreaterThan(0)
        for (const post of posts) {
          expect(post.image!.urlForWidth(843)).toMatch(
            /^https:\/\/www\.artic\.edu\/iiif\/2\/.+\/full\/843,\/0\/default\.jpg$/
          )
        }
      }
    )
  }
)
