// Unit tests for scripts/cross-package-reads.mjs — the scan shared by turbo-inputs.test.mjs and
// ci.yml's affected-scope guard (#1206).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  externalRefs,
  guardedChanges,
  pathWithin,
  scanReads,
  unselectedReads
} from './cross-package-reads.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

test('externalRefs keeps existing out-of-package literals and follows repo-root bindings', () => {
  const exists = (p) =>
    ['apps/site/src/p.astro', 'blocks', 'content'].includes(p)
  const src = [
    "readFileSync('../../site/src/p.astro')",
    "const x = '../../site/src/missing.astro'",
    "const own = '../src/a.ts'",
    "const repoRoot = path.resolve(__dirname, '../../..')",
    "join(repoRoot, 'blocks')",
    '`${repoRoot}/content`'
  ].join('\n')
  assert.deepEqual(externalRefs('apps/admin', 'test/a.test.ts', src, exists), [
    'apps/site/src/p.astro',
    'blocks',
    'content'
  ])
})

test('externalRefs drops a bare repo-root literal with no binding (a permission, not a read)', () => {
  assert.deepEqual(
    externalRefs(
      'apps/admin',
      'vite.config.ts',
      "allow: ['../..']",
      () => true
    ),
    []
  )
})

test('pathWithin matches files, directories and glob prefixes', () => {
  assert.ok(pathWithin('apps/site/a.astro', 'apps/site/a.astro'))
  assert.ok(pathWithin('blocks/hero/block.ts', 'blocks'))
  assert.ok(pathWithin('blocks/hero/block.ts', 'blocks/*/block.ts'))
  assert.ok(!pathWithin('apps/site/a.astro.bak', 'apps/site/a.astro'))
  assert.ok(!pathWithin('blocksx/a.ts', 'blocks'))
})

const fixture = () => {
  const pkg = (name, deps = {}) => ({ name, dependencies: deps })
  const packages = new Map([
    ['apps/admin', pkg('@x/admin')],
    ['apps/api', pkg('@x/api', { '@x/mid': 'workspace:*' })],
    ['packages/mid', pkg('@x/mid', { '@x/auth': 'workspace:*' })],
    ['packages/auth', pkg('@x/auth')],
    ['apps/site', pkg('@x/site')]
  ])
  const row = (pkgDir, file, target) => ({
    pkgDir,
    pkgName: packages.get(pkgDir).name,
    file,
    target,
    task: 'test'
  })
  return {
    packageDirs: [...packages.keys()].sort(),
    packages,
    findings: [
      row('apps/admin', 'apps/admin/test/r.test.ts', 'apps/site/src/p.astro'),
      // same read seen by a second task — reported once
      {
        ...row(
          'apps/admin',
          'apps/admin/test/r.test.ts',
          'apps/site/src/p.astro'
        ),
        task: 'lint'
      },
      // transitive dependent (api -> mid -> auth): the package-graph filter already selects it
      row('apps/api', 'apps/api/test/a.test.ts', 'packages/auth'),
      // outside every package: the root-impact guard owns it
      row('apps/admin', 'apps/admin/vite.config.ts', 'scripts/dev-port.mjs'),
      // a package reading its own files is not cross-package
      row('apps/site', 'apps/site/test/s.test.ts', 'apps/site/src/p.astro')
    ]
  }
}

test('unselectedReads keeps only reads of another package the reader does not depend on', () => {
  assert.deepEqual(unselectedReads(fixture()), [
    {
      target: 'apps/site/src/p.astro',
      file: 'apps/admin/test/r.test.ts',
      reader: '@x/admin'
    }
  ])
})

test('guardedChanges reports only changed files an unselected reader depends on', () => {
  const reads = unselectedReads(fixture())
  assert.deepEqual(
    guardedChanges(
      ['apps/site/src/p.astro', 'apps/site/src/other.astro'],
      reads
    ),
    ['apps/site/src/p.astro (read by apps/admin/test/r.test.ts)']
  )
  assert.deepEqual(guardedChanges(['apps/site/src/other.astro'], reads), [])
})

test('the real repo guards the two reads #1206 names (the scan is not vacuous)', () => {
  const targets = unselectedReads(scanReads(repoRoot)).map((r) => r.target)
  assert.ok(targets.includes('apps/site/src/preview/preview.astro'))
  assert.ok(targets.includes('apps/site/integrations/require-site-url.mjs'))
})

test('CLI: stdin of changed files -> guarded lines; unrelated files print nothing', () => {
  const run = (input) =>
    execFileSync(
      'node',
      [path.join(repoRoot, 'scripts/cross-package-reads.mjs')],
      {
        input,
        encoding: 'utf8'
      }
    )
  assert.match(
    run('apps/site/src/preview/preview.astro\n'),
    /^apps\/site\/src\/preview\/preview\.astro \(read by apps\/admin\/test\/block-registry\.test\.ts\)\n$/
  )
  assert.equal(run('apps/site/src/pages/index.astro\n'), '')
})
