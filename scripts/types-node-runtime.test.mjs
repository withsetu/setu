// Guard for #1228: `@types/node` describes the Node runtime's API, so its major must match the
// runtime we ship on — `.nvmrc`, which every CI job reads via `node-version-file`. A higher
// types major lets typecheck accept APIs that throw on the real runtime. Dependabot is told to
// skip `@types/node` majors (.github/dependabot.yml); this test is what catches a hand bump, or
// a Node upgrade that forgets to move the types with it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

/** Major of a semver range like `^22.10.2`, `~22`, `22.x` or `22.19.21`; null if none. */
export function rangeMajor(range) {
  const m = /^\s*[\^~>=v]*\s*(\d+)/.exec(String(range))
  return m ? Number(m[1]) : null
}

/** Root manifest plus every workspace manifest under the pnpm-workspace globs (packages/*, apps/*). */
function manifests() {
  const out = [path.join(repoRoot, 'package.json')]
  for (const dir of ['packages', 'apps']) {
    for (const name of readdirSync(path.join(repoRoot, dir))) {
      const file = path.join(repoRoot, dir, name, 'package.json')
      if (existsSync(file)) out.push(file)
    }
  }
  return out
}

test('rangeMajor reads the major from common range shapes', () => {
  assert.equal(rangeMajor('^22.10.2'), 22)
  assert.equal(rangeMajor('~22.1'), 22)
  assert.equal(rangeMajor('22.x'), 22)
  assert.equal(rangeMajor('>=26.0.0'), 26)
  assert.equal(rangeMajor('workspace:*'), null)
})

test('every @types/node range is on the .nvmrc runtime major', () => {
  const runtime = rangeMajor(
    readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8')
  )
  assert.ok(runtime, '.nvmrc has no readable major')
  const seen = []
  for (const file of manifests()) {
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    for (const field of ['dependencies', 'devDependencies']) {
      const range = pkg[field]?.['@types/node']
      if (range === undefined) continue
      seen.push(file)
      assert.equal(
        rangeMajor(range),
        runtime,
        `${path.relative(repoRoot, file)} ${field} has @types/node "${range}"; .nvmrc runs Node ${runtime}`
      )
    }
  }
  // Fails if the manifest walk stops finding anything, instead of passing vacuously.
  assert.ok(seen.length > 0, 'no @types/node ranges found')
})
