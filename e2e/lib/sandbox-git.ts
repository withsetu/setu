import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Sanctioned exception to the UI-only assertion rule: the publish journey is *about*
// the commit landing in the content git repo, so a direct read of that repo's state is
// a legitimate state-level check here — see e2e/specs/publish.spec.ts. Every other spec
// should assert through the UI only.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const sandboxDir = path.join(repoRoot, '.content-sandbox', 'e2e')

/** The sandbox content repo's HEAD commit subject line (`git log -1 --format=%s`). */
export function sandboxHeadSubject(): string {
  return execSync('git log -1 --format=%s', {
    cwd: sandboxDir,
    encoding: 'utf8'
  }).trim()
}

/** The sandbox content repo's working-tree status for `content/` only
 *  (`git status --porcelain -- content/`) — empty string means every content change is
 *  committed. Scoped to `content/` rather than the whole tree: the api always creates an
 *  untracked `.setu/` (submissions.db, reprocess.db — see apps/api/src/server.ts) inside
 *  `SETU_REPO_DIR`, which is sandbox scaffolding noise unrelated to publish, not something
 *  a publish-correctness check should fail on. */
export function sandboxStatusPorcelain(): string {
  return execSync('git status --porcelain -- content/', {
    cwd: sandboxDir,
    encoding: 'utf8'
  }).trim()
}
