// Dev/UAT content sandbox manager.
//
// The Local Bridge's Publish writes a real git commit into the content repo, so UAT must
// not run against the tracked `content/` (it would pollute history). Instead we route dev
// content to a gitignored `.content-sandbox/<name>/`, seeded from the canonical `content/`,
// which is its own throwaway git repo (the bridge's git-local needs a .git to commit into).
//
// Kept dependency-free and path-portable (everything resolves under a passed `root`) so this
// same script templates verbatim into a `create-setu`-scaffolded user site.
//
// Usage:  node scripts/content-sandbox.mjs seed  [name=dev]   # create+seed if missing (no-op if exists)
//         node scripts/content-sandbox.mjs reset [name=dev]   # wipe + re-seed

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const SANDBOX_ROOT = '.content-sandbox'
const DEFAULT_NAME = 'dev'

/** A sandbox name is a single path SEGMENT, never a path. `path.join` collapses traversal, so an
 *  unvalidated name turns `<root>/.content-sandbox/<name>` into an arbitrary directory that
 *  `resetSandbox` then force-deletes (#814: `reset ..` wiped the working tree; `reset ""` wiped
 *  every session's sandbox). Anchored at both ends, first char alphanumeric so a name can never
 *  read as a flag (`-rf`) or a dotfile (`..`, `.git`). */
const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i

/** Refuse anything that is not a plain sandbox slug. Enforced by the table-driven refusal cases in
 *  content-sandbox.test.mjs ('..', '../..', '', 'a/b', '/etc', '-rf', '.', 'a/../..', '..\\x'),
 *  which assert both the throw AND that a sentinel outside the sandbox root survives. */
export function assertValidName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.includes('..'))
    throw new Error(
      `content-sandbox: invalid sandbox name ${JSON.stringify(name)} — must be a single ` +
        'path segment matching /^[a-z0-9][a-z0-9._-]*$/ (no separators, no "..", no leading dot or dash).'
    )
  return name
}

/** Belt-and-braces containment check, asserted immediately before every destructive call: a future
 *  caller that reaches these paths without going through assertValidName still cannot delete
 *  anything outside `<root>/.content-sandbox/`. Enforced by the "containment assertion fires even
 *  if the name validator is bypassed" test. */
export function assertContained(root, dir) {
  const base = path.resolve(root, SANDBOX_ROOT) + path.sep
  const resolved = path.resolve(dir)
  if (!resolved.startsWith(base))
    throw new Error(
      `content-sandbox: refusing to touch ${resolved} — outside ${base}`
    )
  return resolved
}

function git(cwd, args) {
  // Inline identity so a fresh `git init` repo can commit even without a global git config, and
  // gpgsign off so a global `commit.gpgsign=true` with no agent cannot fail the seed (#814).
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Setu UAT',
      '-c',
      'user.email=uat@setu.local',
      '-c',
      'commit.gpgsign=false',
      ...args
    ],
    { cwd, stdio: 'pipe' }
  )
}

export function sandboxPath(root, name = DEFAULT_NAME) {
  assertValidName(name)
  return path.join(root, SANDBOX_ROOT, name)
}

/** True when `dir` is a FULLY seeded sandbox — it exists AND its git repo resolves a HEAD. Plain
 *  `existsSync` was the #814 sticky state: a seed that died after mkdir but before the commit left
 *  a directory that every later `seed` reported as "already exists — left as is", while git-local
 *  failed on every publish. Enforced by the "half-built sandbox self-heals" test. */
function isSeeded(dir) {
  if (!existsSync(dir)) return false
  try {
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** Create `.content-sandbox/<name>/` seeded from `<root>/content/` as its own git repo.
 *  No-op if a fully seeded sandbox already exists (don't clobber a sandbox in use). Returns true
 *  if seeded. Built into a sibling temp directory and renamed into place, so a failed or
 *  interrupted seed leaves nothing behind — enforced by the "failed seed leaves no directory
 *  behind" test. */
export function seedSandbox(root, name = DEFAULT_NAME) {
  const dir = sandboxPath(root, name)
  if (isSeeded(dir)) return false

  assertContained(root, dir)
  // A leftover half-built directory (exists, no HEAD) is discarded so the sandbox self-heals.
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })

  const tmp = `${dir}.tmp-${process.pid}`
  assertContained(root, tmp)
  rmSync(tmp, { recursive: true, force: true })
  try {
    const contentSrc = path.join(root, 'content')
    const contentDst = path.join(tmp, 'content')
    mkdirSync(tmp, { recursive: true })
    if (existsSync(contentSrc))
      cpSync(contentSrc, contentDst, { recursive: true })
    else mkdirSync(contentDst, { recursive: true })

    git(tmp, ['init', '-q'])
    git(tmp, ['add', '-A'])
    git(tmp, ['commit', '-q', '-m', 'seed sandbox from canonical content/'])
    renameSync(tmp, dir)
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true })
    throw err
  }
  return true
}

/** Wipe `.content-sandbox/<name>/` and re-seed it fresh from canonical content/. */
export function resetSandbox(root, name = DEFAULT_NAME) {
  const dir = sandboxPath(root, name)
  assertContained(root, dir)
  rmSync(dir, { recursive: true, force: true })
  seedSandbox(root, name)
}

function main(argv) {
  const [cmd, name = DEFAULT_NAME] = argv
  const root = process.cwd()
  if (cmd === 'seed') {
    const seeded = seedSandbox(root, name)
    console.log(
      seeded
        ? `seeded ${SANDBOX_ROOT}/${name} from content/`
        : `${SANDBOX_ROOT}/${name} already exists — left as is`
    )
  } else if (cmd === 'reset') {
    resetSandbox(root, name)
    console.log(
      `reset ${SANDBOX_ROOT}/${name} (wiped + re-seeded from content/)`
    )
  } else {
    console.error('usage: content-sandbox.mjs <seed|reset> [name=dev]')
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
