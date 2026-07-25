import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The ratchet for `packages/core/tsconfig.edge.json` (#892).
 *
 *  That file is the ONLY enforcement of edge-safety in the repo — there is no Workers
 *  entrypoint to fail on a bad import at build time — and `eslint.config.mjs` derives its
 *  Node-builtin-import ban from the same `include` list. It had fallen 11 directories
 *  behind `src/` before anyone noticed, because nothing failed when a new module was added
 *  and never listed. These tests are that missing failure: a new `packages/core/src/<dir>`
 *  breaks the build until it is either listed as edge-reachable or listed as a known gap. */

const here = fileURLToPath(new URL('.', import.meta.url))
const srcDir = `${here}../src`
const edgeTsconfigPath = `${here}../tsconfig.edge.json`

/** Directories under `src/` that tsc cannot check today, each for the SAME reason: the
 *  edge program runs with `types: []` and `lib: ["ES2022"]`, which declares no Web/Workers
 *  globals at all, so `fetch` / `URL` / `Headers` / `console` / `globalThis.crypto` — all
 *  present on Cloudflare Workers — resolve to nothing. None of these is a topology
 *  violation: all four dirs are free of Node builtin imports, which is why they stay in
 *  `include` (so the eslint edge rule still lints them) and are named in `exclude` (so tsc
 *  skips them). Tracked for a real fix in #903. */
const KNOWN_TYPECHECK_GAPS = [
  'src/content-id',
  'src/health',
  'src/net',
  'src/oembed'
]

function readEdgeTsconfig(): { include: string[]; exclude: string[] } {
  // Plain JSON.parse, not a JSONC reader, on purpose: eslint.config.mjs parses this same
  // file the same way at config-load time, so a comment would break lint startup. This
  // parse is what fails if someone adds one.
  const raw = JSON.parse(readFileSync(edgeTsconfigPath, 'utf8')) as {
    include?: string[]
    exclude?: string[]
  }
  return { include: raw.include ?? [], exclude: raw.exclude ?? [] }
}

function srcDirectories(): string[] {
  return readdirSync(srcDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `src/${e.name}`)
    .sort()
}

describe('edge guard allowlist (packages/core/tsconfig.edge.json)', () => {
  it('lists every packages/core/src directory', () => {
    const { include } = readEdgeTsconfig()
    const missing = srcDirectories().filter((d) => !include.includes(d))
    expect(
      missing,
      `New core module(s) not covered by the edge guard. Add each to "include" in ` +
        `packages/core/tsconfig.edge.json (that also puts it under the eslint ` +
        `no-Node-builtins rule). If it cannot typecheck yet, additionally add it to ` +
        `"exclude" and to KNOWN_TYPECHECK_GAPS in this file with the reason.`
    ).toEqual([])
  })

  it('has no stale entries pointing at directories that no longer exist', () => {
    const dirs = new Set(srcDirectories())
    const { include, exclude } = readEdgeTsconfig()
    expect(include.filter((d) => !dirs.has(d))).toEqual([])
    expect(exclude.filter((d) => !dirs.has(d))).toEqual([])
  })

  it('excludes exactly the documented typecheck gaps', () => {
    const { exclude } = readEdgeTsconfig()
    expect([...exclude].sort()).toEqual([...KNOWN_TYPECHECK_GAPS].sort())
  })

  it('keeps every excluded directory in include, so eslint still lints it', () => {
    const { include, exclude } = readEdgeTsconfig()
    expect(exclude.filter((d) => !include.includes(d))).toEqual([])
  })
})
