import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

/** The sandbox content repo's HEAD commit author, exactly as git recorded it
 *  (`git log -1 --format='%an <%ae>'`) — the proof that a commit made through the api
 *  carries the real session user's identity (#382 Task 2's commit-author-stamping),
 *  not a hardcoded service account like `OWNER_AUTHOR` (EditorScreen.tsx's local-dev
 *  fallback). */
export function sandboxHeadAuthor(): string {
  return execSync("git log -1 --format='%an <%ae>'", {
    cwd: sandboxDir,
    encoding: 'utf8'
  }).trim()
}

/** Read a committed content file straight off the sandbox repo's working tree —
 *  `content/<collection>/<locale>/<slug>.mdoc`, the same layout `contentPath()`
 *  (packages/core/src/publish/content-path.ts) derives. Safe to read directly (not via
 *  `git show`) once `sandboxStatusPorcelain()` is empty: the working tree then equals
 *  HEAD for `content/`. */
export function sandboxContentFile(
  collection: string,
  locale: string,
  slug: string
): string {
  return readFileSync(
    path.join(sandboxDir, 'content', collection, locale, `${slug}.mdoc`),
    'utf8'
  )
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
