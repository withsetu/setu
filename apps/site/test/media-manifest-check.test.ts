import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  countMediaImagePages,
  mediaManifestCheck,
  mediaManifestProblem
} from '../integrations/media-manifest-check.mjs'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})
const tmp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

describe('countMediaImagePages (#1161)', () => {
  it('counts pages whose <img> src is a root-relative /media/ path', () => {
    const n = countMediaImagePages(
      [
        '<p><img src="/media/2026/06/cat.jpg" alt=""></p>',
        '<img alt="x" src="/media/a.png" loading="lazy"><img src="/media/b.png">',
        '<p>no images</p>'
      ],
      undefined
    )
    expect(n).toBe(2)
  })
  it('counts srcs under the configured PUBLIC_SETU_MEDIA base, ignoring a trailing slash', () => {
    expect(
      countMediaImagePages(
        ['<img src="https://cdn.example.test/media/2026/06/cat.jpg">'],
        'https://cdn.example.test/'
      )
    ).toBe(1)
  })
  it('ignores external images that merely contain /media/ in their path', () => {
    expect(
      countMediaImagePages(
        ['<img src="https://other.example.com/media/x.jpg">'],
        'https://cdn.example.test'
      )
    ).toBe(0)
  })
})

describe('mediaManifestProblem (#1161)', () => {
  it('warns, naming the variable and the consequence, when no dir is set but pages use media', () => {
    const msg = mediaManifestProblem({
      mediaDir: undefined,
      dirExists: false,
      pages: 3
    })
    expect(msg).toMatch(/SETU_MEDIA_DIR is not set/)
    expect(msg).toMatch(/3 pages/)
    expect(msg).toMatch(/srcset/)
  })
  it('treats a blank value as unset', () => {
    expect(
      mediaManifestProblem({ mediaDir: '  ', dirExists: false, pages: 1 })
    ).toMatch(/SETU_MEDIA_DIR is not set/)
  })
  it('warns when the dir is set but does not exist', () => {
    expect(
      mediaManifestProblem({ mediaDir: '/nope', dirExists: false, pages: 1 })
    ).toMatch(/does not exist/)
  })
  it('is silent when no page references /media/ images', () => {
    expect(
      mediaManifestProblem({ mediaDir: undefined, dirExists: false, pages: 0 })
    ).toBeUndefined()
  })
  it('is silent when the dir is configured and present', () => {
    expect(
      mediaManifestProblem({ mediaDir: '/m', dirExists: true, pages: 5 })
    ).toBeUndefined()
  })
})

describe('the mediaManifestCheck integration (#1161)', () => {
  function distWith(html: string): URL {
    const dist = tmp('mmc-dist-')
    mkdirSync(join(dist, 'post', 'a'), { recursive: true })
    writeFileSync(join(dist, 'post', 'a', 'index.html'), html)
    return pathToFileURL(dist + '/')
  }
  async function run(env: Record<string, string | undefined>, dir: URL) {
    const warnings: string[] = []
    const hook = mediaManifestCheck({ env }).hooks['astro:build:done']
    await hook({
      dir,
      logger: { warn: (m: string) => warnings.push(m), info: () => {} }
    })
    return warnings
  }

  it('warns (and does not throw) for a build that references /media/ without a manifest dir', async () => {
    const w = await run({}, distWith('<img src="/media/2026/06/cat.jpg">'))
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/SETU_MEDIA_DIR is not set/)
  })
  it('says nothing when the manifest dir exists', async () => {
    const media = tmp('mmc-media-')
    const w = await run(
      { SETU_MEDIA_DIR: media },
      distWith('<img src="/media/2026/06/cat.jpg">')
    )
    expect(w).toEqual([])
  })
})
