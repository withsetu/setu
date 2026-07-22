// Guard for #809 gap 1: `@setu/api#typecheck` / `@setu/api#test` in turbo.json enumerate
// their upstream edges BY HAND (the `^` shorthand would re-enter the #310 dependency cycle),
// so the list silently drifts from apps/api/package.json every time a workspace dep is added.
// It had already drifted twice (@setu/auth, @setu/demo-data) before this test existed —
// a missing edge means turbo never folds that package's hash into api's, so editing it
// replays a stale cached pass. This test is the thing that keeps the two in sync.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

/**
 * turbo.json is JSONC (turbo supports `//` comments and the file leans on them heavily).
 * Strip line comments without touching `//` that appears inside a string literal — e.g. the
 * `$schema` URL `https://turborepo.com/schema.json`. Walks the text tracking string state and
 * backslash escapes; turbo.json has no block comments, so `/* *\/` is not handled.
 * Enforced by the 'strips // comments but not // inside strings' test below.
 */
export function stripJsonComments(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
      continue
    }
    out += ch
  }
  return out
}

test('stripJsonComments strips // comments but not // inside strings', () => {
  const src =
    '{\n  "url": "https://x.test/a", // trailing\n  // whole line\n  "n": 1\n}'
  assert.deepEqual(JSON.parse(stripJsonComments(src)), {
    url: 'https://x.test/a',
    n: 1
  })
  assert.deepEqual(JSON.parse(stripJsonComments('{"q": "a\\"// b"}')), {
    q: 'a"// b'
  })
})

test('@setu/api#typecheck, #test and #lint depend on every workspace dep in apps/api/package.json', () => {
  const turbo = JSON.parse(
    stripJsonComments(readFileSync(path.join(repoRoot, 'turbo.json'), 'utf8'))
  )
  const pkg = JSON.parse(
    readFileSync(path.join(repoRoot, 'apps/api/package.json'), 'utf8')
  )

  const workspaceDeps = Object.entries({
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {})
  })
    .filter(([, range]) => String(range).startsWith('workspace:'))
    .map(([name]) => name)

  assert.ok(
    workspaceDeps.length > 0,
    'expected apps/api to declare workspace deps'
  )

  // `lint` joined the list in #819: @setu/api#lint enumerates the same edges by hand for the
  // same #310-cycle reason, so it drifts the same way and needs the same guard.
  for (const task of ['typecheck', 'test', 'lint']) {
    const key = `@setu/api#${task}`
    const dependsOn = turbo.tasks?.[key]?.dependsOn
    assert.ok(
      Array.isArray(dependsOn),
      `${key} must declare an explicit dependsOn list`
    )
    const missing = workspaceDeps.filter(
      (dep) => !dependsOn.includes(`${dep}#${task}`)
    )
    assert.deepEqual(
      missing,
      [],
      `${key} is missing edges for: ${missing.join(', ')} — add \`<dep>#${task}\` to turbo.json`
    )
  }
})
