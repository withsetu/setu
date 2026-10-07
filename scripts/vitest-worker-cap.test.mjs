// Guard for #1202: every vitest config in the workspace runs under the repo-wide worker cap
// exported by vitest.shared.ts. A config that neither merges the shared file nor applies its
// `maxWorkers` export falls back to vitest's cores-minus-one default and reintroduces the
// oversubscription under `turbo run … test` that the cap exists to stop.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const configs = execFileSync('git', ['ls-files', 'apps', 'packages'], {
  cwd: repoRoot,
  encoding: 'utf8'
})
  .split('\n')
  .filter((f) =>
    /^(apps|packages)\/[^/]+\/vitest(\.[a-z]+)?\.config\.ts$/.test(f)
  )

test('there are vitest configs to check', () => {
  assert.ok(configs.length > 10, `found ${configs.length}`)
})

test('the shared config sets the worker cap', () => {
  const src = readFileSync(path.join(repoRoot, 'vitest.shared.ts'), 'utf8')
  assert.match(src, /export const maxWorkers\b[^=]*= process\.env\.TURBO_HASH/)
  assert.match(src, /test:\s*\{\s*maxWorkers,/)
})

for (const rel of configs) {
  test(`${rel} runs under the worker cap`, () => {
    const src = readFileSync(path.join(repoRoot, rel), 'utf8')
    const mergesShared =
      /export \{ default \} from '\.\.\/\.\.\/vitest\.shared'/.test(src) ||
      /mergeConfig\(\s*shared\b/.test(src)
    const appliesCap =
      /import \{ maxWorkers \} from '\.\.\/\.\.\/vitest\.shared'/.test(src) &&
      /^\s*maxWorkers,$/m.test(src)
    assert.ok(
      mergesShared || appliesCap,
      `${rel} must re-export/merge vitest.shared.ts or apply its maxWorkers`
    )
  })
}
