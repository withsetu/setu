import { describe, it, expect } from 'vitest'
import { createGitApi, writeActionForChanges } from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'
import type { Role } from '@setu/core'
import type { ResolveActor } from '../src/auth/resolve-actor'

// #648 — the residual #647 left open and asserted as a KNOWN GAP rather than assumed closed.
//
// #644 and #647 both rest on `foldRepoPath` = `String.prototype.toLowerCase()`, Unicode SIMPLE CASE
// MAPPING. A case-insensitive filesystem (APFS/NTFS) resolves names by Unicode CASE FOLDING, a
// strictly LARGER relation. Each of those fixes closed its half by REJECTING inputs where the two
// could disagree — #644 requires repo-ROOT paths to be ASCII, #647 requires a path whose folded
// form parses as content to already BE its folded form.
//
// Neither reaches the SLUG, and deliberately so: slugs legitimately carry non-ASCII (`entrySlugify`
// keeps `\p{L}`, so `content/blog/en/café.mdoc` is a real post). A slug carrying a character that
// case-FOLDS into another character without `toLowerCase` touching it is therefore its own folded
// form — it passes both rules while still resolving to the neighbouring post's inode:
//
//   content/blog/en/sive.mdoc  -> content.publish   (control: the live post)
//   content/blog/en/ſive.mdoc  -> content.edit      U+017F LONG S folds to `s`  (the bypass)
//
// THE FIX: JavaScript DOES expose Unicode simple case folding — `RegExp` with the `iu` flags
// canonicalizes both sides by ECMA-262 Canonicalize, which IS simple case folding. So the gate's
// committed-state read (#382) no longer asks only "is the LITERAL path live?" (git's index is
// case-SENSITIVE, so that read misses) but "is the literal path, OR any committed path that
// case-folds onto it, live?". Verified in node 22 (v22.18.0), not assumed:
//
//   /^ſive$/iu.test('sive')   -> true    U+017F LATIN SMALL LETTER LONG S folds to `s`
//   /^ςigma$/iu.test('σigma') -> true    final vs medial sigma fold together — and NEITHER is
//                                        ASCII, so this is the fold RELATION, not an ASCII rule
//   /^café$/iu.test('cafe')   -> false   accents are NOT folded — `café` stays a distinct post
//   /^日本語$/iu.test('日本語')  -> true    non-Latin scripts are unaffected
//   /^ß$/iu.test('ss')        -> false   FULL folding only; simple folding is the correct relation
//                                        here, since APFS/HFS+ and NTFS case tables do not fold
//                                        ß->ss either
//
// Simple (not full) folding is therefore the relation that MATCHES the filesystems this defends
// against — using full folding would over-reject without closing anything real.
//
// Why classify-together rather than reject (the shape #644/#647 used): the acceptance for this
// issue is that the fold-variant derives the SAME action as the post it collides with. Rejecting
// would also be fail-closed, but a blanket rejection here cannot be scoped to "collides with
// something real" without this same lookup — and once you have the lookup, deriving the correct
// action is strictly more useful and no less safe.
//
// HONEST SCOPE, unchanged from #644/#647: git stages a literally different index entry, so this is
// a working-tree clobber plus repo-state inconsistency (the site build reads the working tree), not
// a clean committed-state takeover. It is still the #382 privilege boundary an author crosses.

const asRole =
  (role: Role): ResolveActor =>
  () => ({ id: 'u', role })
const author = { name: 'T', email: 't@x.com' }

/** Frontmatter that asks for the WEAKEST action: a `published: false` draft needs only
 *  `content.edit`. Any path that still derives `content.edit` while resolving onto a LIVE committed
 *  post is a bypass of the #382 upgrade. */
const DRAFT_CONTENT = '---\ntitle: L\npublished: false\n---\nPWNED'

const LIVE_CONTENT = '---\ntitle: L\n---\nbody'

/** Seeds LIVE posts (no `published: false`) at the canonical spellings. */
async function gitWithLivePosts(...paths: string[]) {
  const git = createMemoryGitPort()
  for (const path of paths)
    await git.commitFile({
      path,
      content: LIVE_CONTENT,
      message: 'seed',
      author
    })
  return git
}

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

describe('git write gate — slug case-FOLD bypass of the publish gate (#648)', () => {
  it('derives content.publish for the canonical spelling (the control this is measured against)', async () => {
    const git = await gitWithLivePosts('content/blog/en/sive.mdoc')
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/sive.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.publish')
  })

  // THE ACCEPTANCE CASE. U+017F is its own `toLowerCase` form, so #647's rule does not fire and the
  // path is accepted as canonical — correctly, since it is a legal slug. What must NOT happen is
  // the gate deriving a WEAKER action than the post it collides with on disk.
  it('derives the SAME action for a U+017F fold-variant as for the live post it collides with', async () => {
    const git = await gitWithLivePosts('content/blog/en/sive.mdoc')
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/ſive.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.publish')
  })

  // The second, independent witness — and the one that proves this is the fold RELATION rather than
  // a smuggled-in ASCII rule. Neither sigma is ASCII, both are their own `toLowerCase` form (so
  // #644 and #647 are both blind to them), and they fold together.
  it('derives content.publish for a fold-variant where NEITHER spelling is ASCII (final vs medial sigma)', async () => {
    const git = await gitWithLivePosts('content/blog/en/σigma.mdoc')
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/ςigma.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.publish')
  })

  // U+212A KELVIN SIGN, the other classic fold-into-ASCII character. At the SLUG position it is
  // caught one rule earlier: unlike U+017F, `'K'.toLowerCase() === 'k'`, so the path is not
  // its own folded form and #647 rejects it outright. Pinned here anyway so the fold class is
  // covered by TWO characters end to end, and so a future refactor that loosens #647 cannot quietly
  // reopen this one — the assertion that matters is "never `content.edit`".
  it('does not downgrade a U+212A fold-variant of a live post to content.edit', async () => {
    const git = await gitWithLivePosts('content/blog/en/kelvin.mdoc')
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/Kelvin.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('settings.manage')
  })

  it('refuses an AUTHOR writing a fold-variant of a live post, and nothing lands', async () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['content/blog/en/sive.mdoc', 'content/blog/en/ſive.mdoc'],
      ['content/blog/en/σigma.mdoc', 'content/blog/en/ςigma.mdoc']
    ]
    for (const [live, variant] of pairs) {
      const git = await gitWithLivePosts(live)
      const before = await git.list()
      const app = createGitApi(git, asRole('author'))
      const res = await write(
        app,
        '/git/commit',
        JSON.stringify({
          path: variant,
          content: DRAFT_CONTENT,
          message: 'm',
          author
        })
      )
      expect(res.status, `POST /git/commit ${JSON.stringify(variant)}`).toBe(
        403
      )
      // Assert on the staged tree, not a HEAD read: the #623 kill-shot lesson is that
      // `git.readFile` resolves at HEAD and can hide a write that already touched the tree.
      expect(await git.list(), `tree after ${JSON.stringify(variant)}`).toEqual(
        before
      )
    }
  })

  it('refuses the same fold-variants through the bulk commit-files route', async () => {
    const git = await gitWithLivePosts('content/blog/en/sive.mdoc')
    const before = await git.list()
    const app = createGitApi(git, asRole('author'))
    const res = await write(
      app,
      '/git/commit-files',
      JSON.stringify({
        changes: [
          { path: 'content/blog/en/ſive.mdoc', content: DRAFT_CONTENT }
        ],
        message: 'm',
        author
      })
    )
    expect(res.status).toBe(403)
    expect(await git.list()).toEqual(before)
  })

  it('admits an EDITOR (who holds content.publish) writing the same fold-variant', async () => {
    const git = await gitWithLivePosts('content/blog/en/sive.mdoc')
    const app = createGitApi(git, asRole('editor'))
    const res = await write(
      app,
      '/git/commit',
      JSON.stringify({
        path: 'content/blog/en/ſive.mdoc',
        content: DRAFT_CONTENT,
        message: 'm',
        author
      })
    )
    expect(res.status).toBe(200)
  })

  // THE SCOPING CALL — the fix must not become a blanket ASCII rule for slugs. These are real posts
  // an ordinary author must keep being able to create.
  it('still admits an AUTHOR writing non-ASCII slugs that collide with nothing', async () => {
    const git = createMemoryGitPort()
    const app = createGitApi(git, asRole('author'))
    for (const path of [
      'content/blog/en/café.mdoc',
      'content/blog/ja/日本語.mdoc',
      'content/blog/en/σigma.mdoc',
      'content/blog/en/ſive.mdoc'
    ]) {
      const res = await write(
        app,
        '/git/commit',
        JSON.stringify({
          path,
          content: DRAFT_CONTENT,
          message: 'm',
          author
        })
      )
      expect(res.status, `POST /git/commit ${JSON.stringify(path)}`).toBe(200)
    }
  })

  // Accents are NOT a case fold. `café` and `cafe` are genuinely different files on APFS, so a live
  // `cafe.mdoc` must NOT drag `café.mdoc` up to content.publish — that would be the over-rejection
  // an NFKC-based approximation (option 1 on the issue) would have introduced.
  it('does NOT treat an accented slug as folding onto its unaccented neighbour', async () => {
    const git = await gitWithLivePosts('content/blog/en/cafe.mdoc')
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/café.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.edit')
  })

  it('does not let a fold-variant of a DRAFT post inflate to content.publish', async () => {
    const git = createMemoryGitPort()
    await git.commitFile({
      path: 'content/blog/en/sive.mdoc',
      content: DRAFT_CONTENT,
      message: 'seed',
      author
    })
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/ſive.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.edit')
  })

  // Deleting a live post through a fold-variant is the same #382 boundary as writing over it: a
  // delete carries no content, so ONLY the committed-state read can catch it.
  it('requires content.publish to DELETE a live post through a fold-variant', async () => {
    const git = await gitWithLivePosts('content/blog/en/sive.mdoc')
    await expect(
      writeActionForChanges([{ path: 'content/blog/en/ſive.mdoc' }], git)
    ).resolves.toBe('content.publish')
  })

  // ReDoS / RegExp-injection guard: the candidate path is attacker-controlled and is compiled into
  // a RegExp. It must be escaped (so metacharacters match literally, not as a pattern) and bounded.
  it('treats regex metacharacters in a slug literally, not as a pattern', async () => {
    const git = await gitWithLivePosts('content/blog/en/aaaa.mdoc')
    // `.` and `+` would match `aaaa.mdoc` if the path were interpolated unescaped.
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/a.+.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.edit')
  })

  it('rejects an absurdly long path rather than compiling it into a RegExp', async () => {
    const git = createMemoryGitPort()
    const app = createGitApi(git, asRole('admin'))
    const path = `content/blog/en/${'a'.repeat(5000)}.mdoc`
    const res = await write(
      app,
      '/git/commit',
      JSON.stringify({ path, content: DRAFT_CONTENT, message: 'm', author })
    )
    expect(res.status).toBe(400)
    expect(await git.list()).toEqual([])
  })
})
