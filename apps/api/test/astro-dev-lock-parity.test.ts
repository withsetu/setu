import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { devServerHolding } from '../src/deploy-wiring'

// Plain JS outside the workspace graph, with no type declarations: imported through a
// non-literal specifier (so tsc does not try to resolve it) — the media-dir-parity pattern.
const lockUrl = new URL('../../../scripts/astro-dev-lock.mjs', import.meta.url)
  .href
const { astroDevPid } = (await import(lockUrl)) as {
  astroDevPid: (siteDir: string | null) => number | null
}

// #1200: `pnpm staging` restates the api's #1087 dev-lockfile probe because a .mjs script cannot
// import the TS helper. If the two drift, staging builds under a live `astro dev` (or refuses a
// build the api would allow) — so every lockfile shape must get the same answer from both.
describe('astro dev lockfile probe parity — pnpm staging vs the api Rebuild guard (#1200)', () => {
  let siteDir: string
  beforeEach(() => {
    siteDir = mkdtempSync(join(tmpdir(), 'setu-lock-parity-'))
  })
  afterEach(() => {
    rmSync(siteDir, { recursive: true, force: true })
  })
  const write = (body: string) => {
    mkdirSync(join(siteDir, '.astro'), { recursive: true })
    writeFileSync(join(siteDir, '.astro', 'dev.json'), body)
  }

  const cases: [string, string | null][] = [
    ['no lockfile', null],
    ['not JSON', '{nope'],
    ['JSON null', 'null'],
    ['no pid', JSON.stringify({ port: 4321 })],
    ['string pid', JSON.stringify({ pid: '1' })],
    ['pid 0', JSON.stringify({ pid: 0 })],
    ['negative pid', JSON.stringify({ pid: -1 })],
    ['fractional pid', JSON.stringify({ pid: 1.5 })],
    ['dead pid', JSON.stringify({ pid: 2 ** 22 + 12345 })],
    ['live pid', JSON.stringify({ pid: process.pid })]
  ]
  for (const [label, body] of cases) {
    it(`agrees on: ${label}`, () => {
      if (body !== null) write(body)
      const blocked = devServerHolding(siteDir) !== null
      expect(astroDevPid(siteDir) !== null).toBe(blocked)
    })
  }
  it('agrees on a null site dir', () => {
    expect(astroDevPid(null)).toBeNull()
    expect(devServerHolding(null)).toBeNull()
  })
})
