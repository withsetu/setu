import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The ratchet for `packages/core/tsconfig.edge.json` (#892, widened in #913).
 *
 *  That file is the ONLY enforcement of edge-safety in the repo — there is no Workers
 *  entrypoint to fail on a bad import at build time — and `eslint.config.mjs` derives its
 *  Node-builtin-import ban from the same `include` list. It had fallen 11 directories
 *  behind `src/` before anyone noticed, because nothing failed when a new module was added
 *  and never listed. These tests are that missing failure: a new `packages/core/src/<dir>`
 *  OR a new top-level `packages/core/src/<file>.ts` breaks the build until it is either
 *  listed as edge-reachable or declared Node-only in `NODE_ONLY_ENTRYPOINTS` below. */

const here = fileURLToPath(new URL('.', import.meta.url))
const srcDir = `${here}../src`
const edgeTsconfigPath = `${here}../tsconfig.edge.json`

/** Directories under `src/` that tsc cannot check today.
 *
 *  Empty, and that is the point: `exclude` in the edge tsconfig must stay empty too, so
 *  adding an entry is a deliberate act that fails this test until it is documented here
 *  with a reason. #892 shipped four entries whose stated reason (no Web/Workers globals
 *  under `types: []` + `lib: ["ES2022"]`) did not hold — removing all four left the edge
 *  typecheck at zero errors, so they were removed in #913.
 *
 *  Why it held anyway is NOT settled: the edge program picks up `@types/node` through the
 *  44 colocated `*.test.ts` files inside the included dirs (confirmed with `tsc --listFiles`),
 *  which is what supplies `fetch`/`URL`/`Headers`/`console`/`globalThis.crypto` there.
 *  That leak is #903 (open, owner decision). If it is closed by giving the edge program a
 *  real Workers lib, this list should stay empty; if it is closed by dropping the test files
 *  from the program without adding a lib, some dirs may need entries again — with the
 *  measured error output as the reason, not an assumed one. */
const KNOWN_TYPECHECK_GAPS: string[] = []

/** Top-level `src/*.ts` files that are deliberately NOT edge-reachable, so they are absent
 *  from `include` on purpose rather than by oversight.
 *
 *  `src/node.ts` is the documented Node-only entrypoint (`@setu/core/node`): it exists
 *  precisely to keep the jiti-based config loader out of the browser/edge barrel, so putting
 *  it under the edge lint rule would ban the thing it is for. Enforced below by
 *  `it('keeps declared Node-only entrypoints out of include')`. */
const NODE_ONLY_ENTRYPOINTS = ['src/node.ts']

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

/** Every directory AND every top-level `.ts` file directly under `src/`.
 *
 *  Files matter as much as directories: `src/version.ts` is imported by
 *  `src/seo/resolve-seo.ts`, so it is edge-reachable, yet a directory-only scan could never
 *  fire on it — which is how #892's ratchet left all three top-level modules unguarded by
 *  BOTH halves (tsc and the eslint Node-builtin ban) until #913. */
function srcEntries(): string[] {
  return readdirSync(srcDir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() ||
        (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts'))
    )
    .map((e) => `src/${e.name}`)
    .sort()
}

describe('edge guard allowlist (packages/core/tsconfig.edge.json)', () => {
  it('lists every packages/core/src directory and top-level module', () => {
    const { include } = readEdgeTsconfig()
    const covered = new Set([...include, ...NODE_ONLY_ENTRYPOINTS])
    const missing = srcEntries().filter((d) => !covered.has(d))
    expect(
      missing,
      `New core module(s) not covered by the edge guard. Add each to "include" in ` +
        `packages/core/tsconfig.edge.json (that also puts it under the eslint ` +
        `no-Node-builtins rule). If it is deliberately Node-only, add it to ` +
        `NODE_ONLY_ENTRYPOINTS in this file with the reason. If it is edge-reachable but ` +
        `cannot typecheck yet, additionally add it to "exclude" and to ` +
        `KNOWN_TYPECHECK_GAPS in this file with the measured reason.`
    ).toEqual([])
  })

  it('has no stale entries pointing at paths that no longer exist', () => {
    const entries = new Set(srcEntries())
    const { include, exclude } = readEdgeTsconfig()
    expect(include.filter((d) => !entries.has(d))).toEqual([])
    expect(exclude.filter((d) => !entries.has(d))).toEqual([])
    expect(NODE_ONLY_ENTRYPOINTS.filter((d) => !entries.has(d))).toEqual([])
  })

  it('keeps declared Node-only entrypoints out of include', () => {
    const { include } = readEdgeTsconfig()
    expect(
      NODE_ONLY_ENTRYPOINTS.filter((d) => include.includes(d)),
      `A module declared Node-only in NODE_ONLY_ENTRYPOINTS is also in "include". Pick ` +
        `one: it is either edge-reachable (drop it from NODE_ONLY_ENTRYPOINTS) or it is ` +
        `not (drop it from "include").`
    ).toEqual([])
    for (const entry of NODE_ONLY_ENTRYPOINTS) {
      expect(existsSync(`${srcDir}/${entry.slice('src/'.length)}`)).toBe(true)
    }
  })

  it('excludes exactly the documented typecheck gaps', () => {
    const { exclude } = readEdgeTsconfig()
    expect(
      [...exclude].sort(),
      `"exclude" in packages/core/tsconfig.edge.json disagrees with ` +
        `KNOWN_TYPECHECK_GAPS. Both are empty today; a new exclusion must be documented ` +
        `here with the measured tsc errors that force it.`
    ).toEqual([...KNOWN_TYPECHECK_GAPS].sort())
  })

  it('keeps every excluded directory in include, so eslint still lints it', () => {
    const { include, exclude } = readEdgeTsconfig()
    expect(exclude.filter((d) => !include.includes(d))).toEqual([])
  })
})
