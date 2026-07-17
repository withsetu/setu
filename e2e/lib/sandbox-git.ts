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

/** `content/<collection>/<locale>/<slug>.mdoc` — the same layout `contentPath()`
 *  (packages/core/src/publish/content-path.ts) derives. */
function entryPath(collection: string, locale: string, slug: string): string {
  return `content/${collection}/${locale}/${slug}.mdoc`
}

/** Subject + author of the LAST commit that touched one entry's content file
 *  (`git log -1 -- <path>`), the author exactly as git recorded it — the proof that
 *  a commit made through the api carries the real session user's identity (#382
 *  Task 2's commit-author-stamping), not a hardcoded service account like
 *  `OWNER_AUTHOR` (EditorScreen.tsx's local-dev fallback).
 *
 *  Path-scoped on purpose (#551): `fullyParallel` workers all commit to the ONE
 *  shared sandbox repo, so by the time a spec reads HEAD another spec's commit can
 *  already sit there — the old `sandboxHeadSubject()` raced exactly that way in CI
 *  (history-restore read slug-rename's `Publish …` subject). A uniqueTitle-minted
 *  slug's path is only ever touched by its own spec, so that path's history is
 *  immune to the interleaving. */
export function sandboxLastCommitFor(
  collection: string,
  locale: string,
  slug: string
): { subject: string; author: string } {
  const out = execSync(
    `git log -1 --format='%s%n%an <%ae>' -- '${entryPath(collection, locale, slug)}'`,
    { cwd: sandboxDir, encoding: 'utf8' }
  ).trim()
  const [subject = '', author = ''] = out.split('\n')
  return { subject, author }
}

/** ALL commit subjects that ever touched one entry's content file, newest first
 *  (`git log --format=%s -- <path>`). Same #551 path-scoping rationale as
 *  `sandboxLastCommitFor`; the full list lets a spec assert history was EXTENDED
 *  (restore = a new commit on top of the publishes it restores between), which a
 *  HEAD-only read never could. */
export function sandboxSubjectsFor(
  collection: string,
  locale: string,
  slug: string
): string[] {
  const out = execSync(
    `git log --format=%s -- '${entryPath(collection, locale, slug)}'`,
    { cwd: sandboxDir, encoding: 'utf8' }
  ).trim()
  return out === '' ? [] : out.split('\n')
}

/** Read a committed content file straight off the sandbox repo's working tree —
 *  `content/<collection>/<locale>/<slug>.mdoc`, the same layout `contentPath()`
 *  (packages/core/src/publish/content-path.ts) derives. Safe to read directly (not via
 *  `git show`) once `sandboxStatusPorcelain()` for that entry is empty: the working
 *  tree then equals HEAD for that path. */
export function sandboxContentFile(
  collection: string,
  locale: string,
  slug: string
): string {
  return readFileSync(
    path.join(sandboxDir, entryPath(collection, locale, slug)),
    'utf8'
  )
}

/** The sandbox content repo's working-tree status for ONE entry's content file
 *  (`git status --porcelain -- <path>`) — empty string means this entry's change is
 *  fully committed. Scoped to the entry, not the whole tree, for two reasons: the api
 *  always creates an untracked `.setu/` (submissions.db, reprocess.db — see
 *  apps/api/src/server.ts) inside `SETU_REPO_DIR`, which is sandbox scaffolding noise;
 *  and a concurrent worker's mid-commit write to ITS entry (#551) is not something
 *  this spec's publish-correctness check should fail on. */
export function sandboxStatusPorcelain(
  collection: string,
  locale: string,
  slug: string
): string {
  return execSync(
    `git status --porcelain -- '${entryPath(collection, locale, slug)}'`,
    { cwd: sandboxDir, encoding: 'utf8' }
  ).trim()
}
