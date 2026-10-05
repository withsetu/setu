import { describe, expect, it } from 'vitest'
import { resolveMediaDir } from '@setu/storage-local'
// Plain JS outside the workspace graph, with no type declarations: imported through a
// non-literal specifier (so tsc does not try to resolve it) and given the one shape used here.
const devLanes = new URL('../../../scripts/dev-lanes.mjs', import.meta.url).href
const { laneEnv } = (await import(devLanes)) as {
  laneEnv: (args: {
    lane: string
    domain: string | undefined
    slot: number
    repoDir: string
    checkoutDir: string
    mediaDir?: string
  }) => Record<string, string | undefined>
}

// #1161: `pnpm dev`'s lane env restates the media-dir rule because a .mjs script cannot import
// the TS helper. If the two drift, the dev site reads manifests from a different dir than the
// api writes them to, and every image silently loses srcset/<picture>.
describe('media dir parity — pnpm dev lane env vs the api (#1161)', () => {
  const base = {
    lane: 'dev',
    domain: undefined,
    slot: 0,
    checkoutDir: '/s'
  }
  it('with no operator override, the lane gets exactly the api default', () => {
    for (const repoDir of ['/s/.content-sandbox/dev', '/tmp/other sandbox']) {
      const env = laneEnv({ ...base, repoDir })
      expect(env.SETU_MEDIA_DIR).toBe(resolveMediaDir({}, repoDir))
    }
  })
  it('an operator SETU_MEDIA_DIR (from .env) is honoured by both', () => {
    const env = laneEnv({ ...base, repoDir: '/s/dev', mediaDir: '/var/media' })
    expect(env.SETU_MEDIA_DIR).toBe(
      resolveMediaDir({ SETU_MEDIA_DIR: '/var/media' }, '/s/dev')
    )
  })
  it('a blank operator value falls back the same way in both', () => {
    const env = laneEnv({ ...base, repoDir: '/s/dev', mediaDir: '  ' })
    expect(env.SETU_MEDIA_DIR).toBe(
      resolveMediaDir({ SETU_MEDIA_DIR: '  ' }, '/s/dev')
    )
  })
})
