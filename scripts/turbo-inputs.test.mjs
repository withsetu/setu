// Guard for #1197: a turbo task hashes only files inside its own package dir ($TURBO_DEFAULT$)
// plus whatever its `inputs` override lists by hand. Every time a package's code reaches OUT of
// its own directory — a test that walks repo-root blocks/, a vite.config.ts that imports a repo
// script, a test that reads a sibling app's file — that path has to be listed, or turbo's remote
// cache replays a stale pass when it changes. Six such reads had been missed at once, each found
// only by a dry-run hash diff. This test finds them by scanning instead.
//
// Two properties:
//   1. Every relative path literal in a package's tracked code that resolves OUTSIDE the package
//      (and to something that exists in the repo) is covered by the `inputs` of each task that
//      loads that file — see `tasksLoading` for which tasks those are.
//   2. When a package's tsconfig `include` covers `test`, its #typecheck and #lint inputs carry
//      every sibling-SOURCE glob (`…/src/**`) its #test inputs do — tsc and type-aware eslint
//      compile those tests, so they read the same imported source (#809 gap 4, #1197 gap 2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripJsonComments } from './turbo-api-deps.test.mjs'
import { CODE, owningDir, scanReads } from './cross-package-reads.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const turbo = JSON.parse(
  stripJsonComments(readFileSync(path.join(repoRoot, 'turbo.json'), 'utf8'))
)

const tracked = execFileSync('git', ['ls-files'], {
  cwd: repoRoot,
  encoding: 'utf8'
})
  .split('\n')
  .filter(Boolean)

const PACKAGE_DIRS = [
  ...new Set(
    tracked
      .filter((f) => /^(apps|packages)\/[^/]+\/package\.json$/.test(f))
      .map((f) => path.dirname(f))
  )
].sort()

function readJson(rel) {
  return JSON.parse(
    stripJsonComments(readFileSync(path.join(repoRoot, rel), 'utf8'))
  )
}

/** The inputs turbo will use for `<pkg>#<task>`: the package override, else the generic task,
 *  else turbo's default — which is just the package dir. */
export function effectiveInputs(turboConfig, pkgName, task) {
  const t =
    turboConfig.tasks?.[`${pkgName}#${task}`] ?? turboConfig.tasks?.[task]
  return t?.inputs ?? ['$TURBO_DEFAULT$']
}

/** Does an `inputs` list (globs relative to `pkgDir`) cover repo-relative `target`? `target` may
 *  be a file, a directory, or a glob string like `blocks/*\/block.ts` (its static prefix is what
 *  must be covered). Only the two glob shapes turbo.json uses are understood: exact paths and
 *  `<dir>/**`. Enforced by the 'covers' unit test below. */
export function covers(inputs, pkgDir, target) {
  const star = target.indexOf('*')
  const isPrefix = star !== -1
  const t = isPrefix ? target.slice(0, star).replace(/\/$/, '') : target
  for (const input of inputs) {
    if (input === '$TURBO_DEFAULT$') {
      if (t === pkgDir || t.startsWith(pkgDir + '/')) return true
      continue
    }
    const glob = path.posix.normalize(path.posix.join(pkgDir, input))
    if (glob.endsWith('/**')) {
      const dir = glob.slice(0, -3)
      if (t === dir || t.startsWith(dir + '/')) return true
    } else if (!isPrefix && glob === t) {
      return true
    }
  }
  return false
}

test('covers', () => {
  const inputs = ['$TURBO_DEFAULT$', '../../blocks/**', '../../scripts/x.mjs']
  assert.ok(covers(inputs, 'apps/admin', 'blocks'))
  assert.ok(covers(inputs, 'apps/admin', 'blocks/hero/hero.astro'))
  assert.ok(covers(inputs, 'apps/admin', 'blocks/*/block.ts'))
  assert.ok(covers(inputs, 'apps/admin', 'scripts/x.mjs'))
  assert.ok(covers(inputs, 'apps/admin', 'apps/admin/src/a.ts'))
  assert.ok(!covers(inputs, 'apps/admin', 'scripts/y.mjs'))
  assert.ok(!covers(inputs, 'apps/admin', 'scripts/*.mjs'))
  assert.ok(!covers(inputs, 'apps/admin', 'apps/site/src/p.astro'))
  assert.ok(!covers(['$TURBO_DEFAULT$'], 'apps/admin', 'blocks'))
})

/** The workspace package (dir + name) a repo-relative path sits in, if any. */
function owningPackage(target) {
  const dir = owningDir(PACKAGE_DIRS, target)
  return dir ? { dir, name: readJson(`${dir}/package.json`).name } : undefined
}

/** A read of ANOTHER workspace package is also hashed when the task has a `dependsOn` edge to
 *  that package's same task — turbo folds the upstream hash in (see turbo.json's header). */
function coveredByEdge(pkg, task, target) {
  const owner = owningPackage(target)
  if (!owner) return false
  const t = turbo.tasks?.[`${pkg.name}#${task}`] ?? turbo.tasks?.[task]
  const dependsOn = t?.dependsOn ?? []
  if (dependsOn.includes(`${owner.name}#${task}`)) return true
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  return dependsOn.includes(`^${task}`) && owner.name in deps
}

// The scan itself lives in cross-package-reads.mjs, shared with ci.yml's affected-scope guard
// (#1206) so the two cannot disagree about which reads exist.
const { findings } = scanReads(repoRoot)

test('the scan finds the known out-of-package reads (it is not vacuous)', () => {
  // If a refactor makes the scanner miss these, the test below would pass on nothing.
  const has = (file, target) =>
    findings.some((x) => x.file === file && x.target === target)
  assert.ok(has('packages/blocks/test/token-contract.test.ts', 'blocks'))
  assert.ok(
    has('packages/core/test/single-line-tag-roundtrip.test.ts', 'blocks')
  )
  assert.ok(
    has('apps/api/test/media-dir-parity.test.ts', 'scripts/dev-lanes.mjs')
  )
  assert.ok(has('apps/admin/vite.config.ts', 'scripts/dev-port.mjs'))
  assert.ok(has('apps/admin/vite.config.ts', 'scripts/dev-allowed-hosts.mjs'))
  assert.ok(has('apps/site/astro.config.mjs', 'scripts/dev-port.mjs'))
  assert.ok(
    has(
      'apps/admin/test/block-registry.test.ts',
      'apps/site/src/preview/preview.astro'
    )
  )
  assert.ok(has('apps/site/test/content-watch-dev.test.ts', 'content'))
  assert.ok(has('apps/site/test/preview-blocks.test.ts', 'blocks'))
})

test('every out-of-package read is hashed by each task that loads it', () => {
  const missing = findings
    .filter(
      (x) =>
        !covers(
          effectiveInputs(turbo, x.pkgName, x.task),
          x.pkgDir,
          x.target
        ) && !coveredByEdge(x.pkg, x.task, x.target)
    )
    .map(
      (x) =>
        `${x.pkgName}#${x.task} does not hash ${x.target} (read by ${x.file})`
    )
  assert.deepEqual(
    [...new Set(missing)],
    [],
    'add the path to that task\'s `inputs` in turbo.json — keep "$TURBO_DEFAULT$" first'
  )
})

/** The two out-of-package reads #typecheck is responsible for (tsc follows a static import of a
 *  repo script from a file in its program; the scan above can't tell tsc-followed imports from
 *  runtime fs reads, so these are named). astro.config.mjs is in apps/site's program (`**\/*`
 *  include + astro's allowJs); apps/admin's vite.config.ts is NOT in admin's (src/test only). */
test('@setu/site#typecheck hashes the scripts astro.config.mjs imports', () => {
  const inputs = effectiveInputs(turbo, '@setu/site', 'typecheck')
  for (const s of ['scripts/dev-port.mjs', 'scripts/dev-allowed-hosts.mjs']) {
    assert.ok(
      covers(inputs, 'apps/site', s),
      `@setu/site#typecheck is missing ${s}`
    )
  }
})

for (const pkgDir of PACKAGE_DIRS) {
  const tsconfigPath = `${pkgDir}/tsconfig.json`
  if (!existsSync(path.join(repoRoot, tsconfigPath))) continue
  const include = readJson(tsconfigPath).include ?? []
  if (
    !include.some((i) => i === 'test' || i.startsWith('test/') || i === '**/*')
  )
    continue
  const pkgName = readJson(`${pkgDir}/package.json`).name
  test(`${pkgName}: #typecheck and #lint hash the sibling source its tests import`, () => {
    const srcGlobs = effectiveInputs(turbo, pkgName, 'test').filter((i) =>
      i.endsWith('/src/**')
    )
    for (const task of ['typecheck', 'lint']) {
      const inputs = effectiveInputs(turbo, pkgName, task)
      const missing = srcGlobs.filter((g) => !inputs.includes(g))
      assert.deepEqual(
        missing,
        [],
        `${pkgName}#${task} compiles test/ but does not hash ${missing.join(', ')}`
      )
    }
  })
}

test('@setu/site#lint runs after @setu/site#typecheck (both rewrite the generated files)', () => {
  assert.ok(
    turbo.tasks['@setu/site#lint'].dependsOn.includes('@setu/site#typecheck')
  )
})

/** Env vars the site build may read without a `env` declaration: PUBLIC_* are inferred by
 *  turbo's Astro framework detection (dry-run reports `framework: astro`), and these two are read
 *  only by astro.config.mjs's dev `server` block, which `astro build` never starts. */
const SITE_BUILD_ENV_EXEMPT = new Set([
  'SETU_SITE_PORT',
  'SETU_DEV_ALLOWED_HOSTS'
])

test('@setu/site#build declares every env var its build code reads', () => {
  // The site's own build-time code plus the src of every workspace package it renders through.
  const sitePkg = readJson('apps/site/package.json')
  const roots = [
    'apps/site/src/',
    'apps/site/integrations/',
    'apps/site/astro.config.mjs',
    ...Object.entries(sitePkg.dependencies ?? {})
      .filter(([, r]) => String(r).startsWith('workspace:'))
      .map(
        ([name]) =>
          `${PACKAGE_DIRS.find((d) => readJson(`${d}/package.json`).name === name)}/src/`
      )
  ]
  const read = new Set()
  for (const f of tracked) {
    if (
      !CODE.test(f) ||
      /\.test\./.test(f) ||
      !roots.some((r) => f.startsWith(r))
    )
      continue
    const src = readFileSync(path.join(repoRoot, f), 'utf8')
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g))
      read.add(m[1])
  }
  assert.ok(
    read.has('SETU_ARCHIVE_PER_PAGE'),
    'scan found nothing — it is vacuous'
  )
  const env = turbo.tasks['@setu/site#build'].env ?? []
  const missing = [...read]
    .filter((v) => !v.startsWith('PUBLIC_') && !SITE_BUILD_ENV_EXEMPT.has(v))
    .filter((v) => !env.includes(v))
  assert.deepEqual(missing, [], '@setu/site#build `env` is missing these')
})

test('every inputs override keeps $TURBO_DEFAULT$', () => {
  for (const [key, t] of Object.entries(turbo.tasks)) {
    if (t.inputs) assert.ok(t.inputs.includes('$TURBO_DEFAULT$'), key)
  }
})
