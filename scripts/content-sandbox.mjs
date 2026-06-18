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
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const SANDBOX_ROOT = '.content-sandbox'
const DEFAULT_NAME = 'dev'

function git(cwd, args) {
  // Inline identity so a fresh `git init` repo can commit even without a global git config.
  execFileSync(
    'git',
    ['-c', 'user.name=Setu UAT', '-c', 'user.email=uat@setu.local', ...args],
    { cwd, stdio: 'pipe' },
  )
}

export function sandboxPath(root, name = DEFAULT_NAME) {
  return path.join(root, SANDBOX_ROOT, name)
}

/** Create `.content-sandbox/<name>/` seeded from `<root>/content/` as its own git repo.
 *  No-op if the sandbox already exists (don't clobber a sandbox in use). Returns true if seeded. */
export function seedSandbox(root, name = DEFAULT_NAME) {
  const dir = sandboxPath(root, name)
  if (existsSync(dir)) return false

  const contentSrc = path.join(root, 'content')
  const contentDst = path.join(dir, 'content')
  mkdirSync(dir, { recursive: true })
  if (existsSync(contentSrc)) cpSync(contentSrc, contentDst, { recursive: true })
  else mkdirSync(contentDst, { recursive: true })

  git(dir, ['init', '-q'])
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'seed sandbox from canonical content/'])
  return true
}

/** Wipe `.content-sandbox/<name>/` and re-seed it fresh from canonical content/. */
export function resetSandbox(root, name = DEFAULT_NAME) {
  rmSync(sandboxPath(root, name), { recursive: true, force: true })
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
        : `${SANDBOX_ROOT}/${name} already exists — left as is`,
    )
  } else if (cmd === 'reset') {
    resetSandbox(root, name)
    console.log(`reset ${SANDBOX_ROOT}/${name} (wiped + re-seeded from content/)`)
  } else {
    console.error('usage: content-sandbox.mjs <seed|reset> [name=dev]')
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
