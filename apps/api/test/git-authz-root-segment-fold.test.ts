import { describe, it, expect } from 'vitest'
import { createGitApi, writeActionForChanges } from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'
import type { Role } from '@setu/core'
import type { ResolveActor } from '../src/auth/resolve-actor'

// #742 — the same fold-blindness family as #731, one layer UP. #731 fixed how candidate paths are
// COMPARED (`unicodeCaseFold` on both sides, not a weaker second opinion); this is how they are
// SELECTED.
//
// `writeActionForChanges` built its candidate set with `git.list('content/')`. Every adapter
// implements the `prefix` argument as a literal `String.prototype.startsWith`
// (packages/git-local/src/adapter.ts, packages/git-memory, packages/git-http). So
// `foldCollidingPaths` could only ever fold-compare paths whose FIRST SEGMENT is literally
// `content/` — a committed path whose ROOT segment differs by case or fold was never in the
// candidate set at all, so the comparison #731 fixed never ran on it.
//
// Measured against the real `writeActionForChanges` before the fix, incoming
// `content/blog/en/live.mdoc` with `published: false` (i.e. an unpublish-by-write that only needs
// `content.edit`):
//
//   committed Content/blog/en/live.mdoc   ->  content.edit      MISS
//   committed CONTENT/blog/en/live.mdoc   ->  content.edit      MISS
//   committed content/Blog/en/live.mdoc   ->  content.publish   caught
//   committed content/blog/EN/live.mdoc   ->  content.publish   caught
//   committed content/blog/en/Live.mdoc   ->  content.publish   caught
//
// Only the ROOT segment was blind, and it was blind completely — every non-root segment was
// already covered, because once a path clears the literal `content/` prefix filter the fold
// comparison sees the whole rest of it.
//
// THE EXPLOIT: with `content/blog/en/live.mdoc` ABSENT but `Content/blog/en/live.mdoc` committed
// and live, an actor holding only `content.edit` deletes or unpublishes it. On a case-folding
// checkout (APFS/NTFS) that write resolves onto the live post's inode. That is the #382 boundary
// reopened, exactly as in #648/#731.
//
// WHY THE OLD JUSTIFICATION DIDN'T COVER ITS OWN CASE: the comment at the `git.list('content/')`
// call cited #647 as the reason a literal prefix was sound. But #647 constrains the INCOMING path
// (a path whose folded form parses as content must already BE its folded form), whereas this whole
// mechanism exists because COMMITTED paths may be fold-unstable — pre-existing repos, direct
// `git push`, other topologies. #647 says nothing about them. The corrected comment now states
// what the prefix actually guarantees, and the filter asks the fold relation instead.
//
// THE FIX, the same move #731 made one level down: list UNFILTERED and select with
// `foldRepoPath(c).startsWith('content/')` rather than `c.startsWith('content/')`.

const asRole =
  (role: Role): ResolveActor =>
  () => ({ id: 'u', role })
const author = { name: 'T', email: 't@x.com' }

/** Frontmatter asking for the WEAKEST action: a `published: false` draft needs only
 *  `content.edit`. Any path that still derives `content.edit` while resolving onto a LIVE
 *  committed post is a bypass of the #382 upgrade. */
const DRAFT_CONTENT = '---\ntitle: L\npublished: false\n---\nPWNED'
const LIVE_CONTENT = '---\ntitle: L\n---\nbody'

async function gitWith(content: string, ...paths: string[]) {
  const git = createMemoryGitPort()
  for (const path of paths)
    await git.commitFile({ path, content, message: 'seed', author })
  return git
}
const gitWithLivePosts = (...paths: string[]) => gitWith(LIVE_CONTENT, ...paths)

const write = (
  a: ReturnType<typeof createGitApi>,
  path: string,
  body: string
) =>
  a.fetch(
    new Request(`http://x${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    })
  )

/** The incoming path for every case below. It is canonical and fold-stable, so
 *  `isCanonicalRepoPath` admits it and the committed-state read is genuinely reached — this is the
 *  committed-side direction, the only one `foldCollidingPaths` can defend (#654 handles the
 *  incoming side one rule earlier). */
const INCOMING = 'content/blog/en/live.mdoc'

/** Every segment position, so the ROOT-segment blindness is pinned as part of a set that already
 *  worked rather than in isolation — a future narrowing of the candidate filter has to fail the
 *  whole row set, not just the two new entries. */
const COMMITTED_VARIANTS = [
  'Content/blog/en/live.mdoc', // ROOT segment, capitalised — the #742 bypass
  'CONTENT/blog/en/live.mdoc', // ROOT segment, upper — the #742 bypass
  'Content/Blog/EN/Live.mdoc', // every segment at once
  'content/Blog/en/live.mdoc', // collection segment — already caught pre-#742
  'content/blog/EN/live.mdoc', // locale segment — already caught pre-#742
  'content/blog/en/Live.mdoc' // slug segment — already caught pre-#742
]

describe('git write gate — ROOT-segment fold blindness in the candidate set (#742)', () => {
  it('derives content.publish for the canonical spelling (the control this is measured against)', async () => {
    const git = await gitWithLivePosts(INCOMING)
    await expect(
      writeActionForChanges([{ path: INCOMING, content: DRAFT_CONTENT }], git)
    ).resolves.toBe('content.publish')
  })

  // THE ACCEPTANCE CASE. The first two rows are the bypass; the last three pin the behaviour that
  // already worked so the fix is proven to WIDEN the candidate set, not to move it.
  it('derives content.publish for a committed live post whose ROOT segment differs in case', async () => {
    for (const committed of COMMITTED_VARIANTS) {
      const git = await gitWithLivePosts(committed)
      await expect(
        writeActionForChanges(
          [{ path: INCOMING, content: DRAFT_CONTENT }],
          git
        ),
        `committed ${JSON.stringify(committed)}`
      ).resolves.toBe('content.publish')
    }
  })

  // A DELETE carries no content, so ONLY the committed-state read can catch it — this is the
  // sharpest form of the exploit: `content.edit` silently deleting a live post.
  it('requires content.publish to DELETE a live post committed under a fold-variant root segment', async () => {
    for (const committed of COMMITTED_VARIANTS) {
      const git = await gitWithLivePosts(committed)
      await expect(
        writeActionForChanges([{ path: INCOMING }], git),
        `delete against committed ${JSON.stringify(committed)}`
      ).resolves.toBe('content.publish')
    }
  })

  // HONEST SCOPE OF THE FOLD AT THE PREFIX POSITION — recorded rather than witnessed, following the
  // `Kettings.json` precedent in git-authz-case-fold.test.ts (state an entry's ACTUAL role instead
  // of letting a comment claim a property the assertion does not carry).
  //
  // The filter is `foldRepoPath(c).startsWith('content/')` rather than `c.toLowerCase()…`, and that
  // is the right call — one relation everywhere, and it can only ever be WIDER, so it fails closed.
  // But it is NOT independently witnessable at this position, and a first draft of this file
  // claimed it was with `ſontent/`. That witness was false: U+017F LONG S folds to `s`, so
  // `ſontent/` folds to `sontent/`, which is not `content/` at all. Enumerated the whole BMP+SMP
  // against `unicodeCaseFold`: NO non-ASCII character folds onto any of `c`, `o`, `n`, `t` or `e`.
  // `content/` is pure ASCII, and for ASCII strings case folding and `toLowerCase` coincide — so at
  // the ROOT-PREFIX position the two relations are provably the same function, and no
  // fold-not-case witness exists to be written.
  //
  // What IS witnessable, and what this test therefore asserts, is that the widened SELECTION and
  // the #731 fold COMPARISON compose: the root segment differs by case (so only the #742 fix puts
  // the path in the candidate set) AND the slug segment is fold-unstable (so only the #731 fold
  // matches it once it is there). Neither fix alone catches this; it fails if either regresses.
  it('composes the widened selection with the #731 fold comparison (case-variant root AND fold-variant slug)', async () => {
    const git = await gitWithLivePosts('Content/blog/en/ſive.mdoc')
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/sive.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.publish')
  })

  // ---------------------------------------------------------------------------------------------
  // THE DISCRIMINATION HALF. Widening the candidate set must not become a blanket upgrade: the
  // control has to keep falling back to `content.edit` whenever the fold-neighbour it finds is a
  // DRAFT. A fix that returned `content.publish` unconditionally would pass every assertion above
  // and be useless — these are what make the acceptance cases mean something.

  it('does NOT inflate to content.publish when the root-fold neighbour is a DRAFT', async () => {
    for (const committed of COMMITTED_VARIANTS) {
      const git = await gitWith(DRAFT_CONTENT, committed)
      await expect(
        writeActionForChanges(
          [{ path: INCOMING, content: DRAFT_CONTENT }],
          git
        ),
        `draft neighbour ${JSON.stringify(committed)}`
      ).resolves.toBe('content.edit')
    }
  })

  it('does NOT inflate a DELETE to content.publish when the root-fold neighbour is a DRAFT', async () => {
    for (const committed of COMMITTED_VARIANTS) {
      const git = await gitWith(DRAFT_CONTENT, committed)
      await expect(
        writeActionForChanges([{ path: INCOMING }], git),
        `delete against draft neighbour ${JSON.stringify(committed)}`
      ).resolves.toBe('content.edit')
    }
  })

  // The unfiltered listing must not drag NON-content paths into the fold comparison. A live-looking
  // file outside the content tree is not a content path and must never upgrade a content write.
  it('does not treat a non-content path as a fold-neighbour of a content write', async () => {
    const git = await gitWith(
      LIVE_CONTENT,
      'docs/blog/en/live.mdoc',
      'Docs/blog/en/live.mdoc',
      'contents/blog/en/live.mdoc'
    )
    await expect(
      writeActionForChanges([{ path: INCOMING, content: DRAFT_CONTENT }], git)
    ).resolves.toBe('content.edit')
  })

  it('still derives content.edit for a brand-new post that collides with nothing', async () => {
    const git = await gitWithLivePosts('content/blog/en/other.mdoc')
    await expect(
      writeActionForChanges([{ path: INCOMING, content: DRAFT_CONTENT }], git)
    ).resolves.toBe('content.edit')
  })

  // ---------------------------------------------------------------------------------------------
  // Route level — the actual privilege bypass, end to end.

  it('refuses an AUTHOR unpublishing a live post committed under a fold-variant root, and nothing lands', async () => {
    for (const committed of COMMITTED_VARIANTS) {
      const git = await gitWithLivePosts(committed)
      const before = await git.list()
      const app = createGitApi(git, asRole('author'))
      const res = await write(
        app,
        '/git/commit',
        JSON.stringify({
          path: INCOMING,
          content: DRAFT_CONTENT,
          message: 'm',
          author
        })
      )
      expect(res.status, `POST /git/commit vs ${committed}`).toBe(403)
      // Assert on the staged tree, not a HEAD read: the #623 kill-shot lesson is that
      // `git.readFile` resolves at HEAD and can hide a write that already touched the tree.
      expect(await git.list(), `tree after ${committed}`).toEqual(before)
    }
  })

  it('refuses the same through the bulk commit-files route', async () => {
    const git = await gitWithLivePosts('Content/blog/en/live.mdoc')
    const before = await git.list()
    const app = createGitApi(git, asRole('author'))
    const res = await write(
      app,
      '/git/commit-files',
      JSON.stringify({
        changes: [{ path: INCOMING, content: DRAFT_CONTENT }],
        message: 'm',
        author
      })
    )
    expect(res.status).toBe(403)
    expect(await git.list()).toEqual(before)
  })

  // The right actor is still ADMITTED — the gate-parity half. An editor holds `content.publish`,
  // so the derived action is one they have, and the write goes through.
  it('still admits an EDITOR the same write', async () => {
    const git = await gitWithLivePosts('Content/blog/en/live.mdoc')
    const app = createGitApi(git, asRole('editor'))
    const res = await write(
      app,
      '/git/commit',
      JSON.stringify({
        path: INCOMING,
        content: DRAFT_CONTENT,
        message: 'm',
        author
      })
    )
    expect(res.status).toBe(200)
  })

  // An author writing an ordinary new draft must keep working — the fix must not turn every content
  // write into a `content.publish` request.
  it('still admits an AUTHOR writing a draft that collides with nothing', async () => {
    const git = await gitWithLivePosts('content/blog/en/other.mdoc')
    const app = createGitApi(git, asRole('author'))
    const res = await write(
      app,
      '/git/commit',
      JSON.stringify({
        path: INCOMING,
        content: DRAFT_CONTENT,
        message: 'm',
        author
      })
    )
    expect(res.status).toBe(200)
  })
})
