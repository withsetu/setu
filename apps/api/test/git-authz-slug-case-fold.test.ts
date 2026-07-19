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
//
// ---------------------------------------------------------------------------------------------
// RECONCILED WITH #654, which landed concurrently and attacks the same class from the other end.
// #654 made `foldRepoPath` a REAL fold (`unicodeCaseFold`), so `isCanonicalRepoPath` now REJECTS a
// fold-UNSTABLE incoming path outright, and `entrySlugify` (#669) can no longer mint one. That
// moves where several assertions below fire, and it is worth being precise about what changed:
//
//   - Where the fold-variant is the INCOMING path, #654 intercepts one rule EARLIER: the request
//     is 400 (not canonical) rather than 403 (not permitted), and `writeActionForChanges` returns
//     `settings.manage` rather than `content.publish`. Both are strictly STRONGER than what #648
//     asserted — the property #648 cares about ("never the weaker `content.edit`") holds harder.
//     Those assertions are updated to the stronger outcome, not deleted.
//   - Where the fold-variant is the COMMITTED path, #654 cannot help: it only ever sees the
//     incoming path, and it cannot retroactively rename what is already in the repo (pre-existing
//     repos, direct `git push`, other topologies). `foldCollidingPaths` is the ONLY defence in
//     that direction, so the witnesses below are expressed committed-side, where they stay
//     load-bearing and where disabling `foldCollidingPaths` still fails them.
//   - ONE deliberate product-behaviour reversal: #648 accepted `content/blog/en/ſive.mdoc` as a
//     legal new slug when it collided with nothing (200). #654 rejects it (400) for every role,
//     because a fold-unstable name is one a case-insensitive checkout can collapse later and is
//     one `entrySlugify` can no longer produce. Fold-STABLE non-ASCII slugs (`café`, `日本語`,
//     `σigma`, `über-uns`) are still accepted — #648's scoping call is upheld.

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

  // THE ACCEPTANCE CASE, incoming side. #648 asserted `content.publish` here, because U+017F is its
  // own `toLowerCase` form and #647's rule did not fire. #654's real fold DOES fire on it, so the
  // path never reaches the committed-state read: it is rejected as non-canonical and derives
  // `settings.manage`. What must NOT happen — the gate deriving a WEAKER action than the post it
  // collides with on disk — still does not happen, one rank further up the ladder.
  it('never derives a weaker action than the live post a U+017F fold-variant collides with', async () => {
    const git = await gitWithLivePosts('content/blog/en/sive.mdoc')
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/ſive.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('settings.manage')
  })

  // THE ACCEPTANCE CASE, committed side — the direction #654 cannot reach, and therefore the one
  // that keeps `foldCollidingPaths` load-bearing. The incoming `sive.mdoc` is fold-STABLE, so it is
  // admitted as canonical (correctly — an ordinary slug), and git's case-SENSITIVE index makes the
  // literal `readFile` miss the committed `ſive.mdoc` that APFS would resolve it onto. Only the
  // committed-path fold-match derives `content.publish` here.
  it('derives content.publish when the COMMITTED live post is the U+017F fold-variant', async () => {
    const git = await gitWithLivePosts('content/blog/en/ſive.mdoc')
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/sive.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.publish')
  })

  // The second, independent witness — and the one that proves this is the fold RELATION rather than
  // a smuggled-in ASCII rule. Neither sigma is ASCII, both are their own `toLowerCase` form (so
  // #644 and #647 are both blind to them), and they fold together. Expressed committed-side for the
  // same reason as above: `σigma.mdoc` is fold-stable and admitted, `ςigma.mdoc` is what is in the
  // repo, and nothing but `foldCollidingPaths` connects them.
  it('derives content.publish for a committed fold-variant where NEITHER spelling is ASCII (final vs medial sigma)', async () => {
    const git = await gitWithLivePosts('content/blog/en/ςigma.mdoc')
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/σigma.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.publish')
  })

  // The incoming-side sigma variant, pinned at its new stronger outcome so the pair is symmetric.
  it('never derives a weaker action for an incoming final-sigma fold-variant', async () => {
    const git = await gitWithLivePosts('content/blog/en/σigma.mdoc')
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/ςigma.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('settings.manage')
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

  // Route level, incoming side. #648 asserted 403 (author lacks the derived `content.publish`);
  // with #654 the request is rejected as non-canonical BEFORE any permission is derived, so it is
  // 400 for every role. Still refused, still nothing lands — the assertion that carries the
  // security property is the tree comparison, and it is unchanged.
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
        400
      )
      // Assert on the staged tree, not a HEAD read: the #623 kill-shot lesson is that
      // `git.readFile` resolves at HEAD and can hide a write that already touched the tree.
      expect(await git.list(), `tree after ${JSON.stringify(variant)}`).toEqual(
        before
      )
    }
  })

  // Committed side at the route level: here the incoming path IS canonical, so the request gets a
  // real permission derivation and the author is refused with 403 — #648's original status, on the
  // direction where #648 is the only thing standing between the author and the live post.
  it('refuses an AUTHOR writing over a COMMITTED fold-variant of a live post, and nothing lands', async () => {
    const git = await gitWithLivePosts('content/blog/en/ſive.mdoc')
    const before = await git.list()
    const app = createGitApi(git, asRole('author'))
    const res = await write(
      app,
      '/git/commit',
      JSON.stringify({
        path: 'content/blog/en/sive.mdoc',
        content: DRAFT_CONTENT,
        message: 'm',
        author
      })
    )
    expect(res.status).toBe(403)
    expect(await git.list()).toEqual(before)
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
    expect(res.status).toBe(400)
    expect(await git.list()).toEqual(before)
  })

  // #648 asserted an EDITOR could write the fold-variant (200), since holding `content.publish`
  // made it a permission question. #654 makes it a WELL-FORMEDNESS question instead, so the answer
  // is 400 for every role including admin — a fold-unstable name must not enter the repo at all.
  // Pinned together with the canonical spelling so this reads as "the name is refused", not "the
  // editor lost a permission".
  it('refuses even an EDITOR the fold-variant, while admitting the canonical spelling', async () => {
    const git = await gitWithLivePosts('content/blog/en/sive.mdoc')
    const app = createGitApi(git, asRole('editor'))
    const variant = await write(
      app,
      '/git/commit',
      JSON.stringify({
        path: 'content/blog/en/ſive.mdoc',
        content: DRAFT_CONTENT,
        message: 'm',
        author
      })
    )
    expect(variant.status).toBe(400)
    const canonical = await write(
      app,
      '/git/commit',
      JSON.stringify({
        path: 'content/blog/en/sive.mdoc',
        content: DRAFT_CONTENT,
        message: 'm',
        author
      })
    )
    expect(canonical.status).toBe(200)
  })

  // THE SCOPING CALL — the fix must not become a blanket ASCII rule for slugs. These are real posts
  // an ordinary author must keep being able to create. #654 narrows this list by exactly one entry:
  // `ſive.mdoc` is fold-UNSTABLE and is now refused (asserted directly below). Everything here is
  // fold-stable, including a non-ASCII Greek slug, so "non-ASCII is fine, fold-unstable is not"
  // remains the line — not "ASCII only".
  it('still admits an AUTHOR writing non-ASCII slugs that collide with nothing', async () => {
    const git = createMemoryGitPort()
    const app = createGitApi(git, asRole('author'))
    for (const path of [
      'content/blog/en/café.mdoc',
      'content/blog/ja/日本語.mdoc',
      'content/blog/en/σigma.mdoc',
      'content/blog/de/über-uns.mdoc'
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

  // The anti-OVER-rejection property: `foldCollidingPaths` must upgrade only when the path it
  // matches is actually LIVE. Expressed committed-side, where the fold-match genuinely runs — the
  // committed neighbour is the fold-variant and it is a DRAFT, so the write stays `content.edit`.
  // (Incoming-side this can no longer be observed at all: #654 rejects the variant before the
  // committed-state read, so the assertion would be about the rejection, not about inflation.)
  it('does not let a fold-variant of a DRAFT post inflate to content.publish', async () => {
    const git = createMemoryGitPort()
    await git.commitFile({
      path: 'content/blog/en/ſive.mdoc',
      content: DRAFT_CONTENT,
      message: 'seed',
      author
    })
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/sive.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.edit')
  })

  // Deleting a live post through a fold-variant is the same #382 boundary as writing over it: a
  // delete carries no content, so ONLY the committed-state read can catch it. Committed-side for
  // the same reason as above — and this is the case where that matters most, since a delete has no
  // frontmatter for any other rule to judge.
  it('requires content.publish to DELETE a live post through a fold-variant', async () => {
    const git = await gitWithLivePosts('content/blog/en/ſive.mdoc')
    await expect(
      writeActionForChanges([{ path: 'content/blog/en/sive.mdoc' }], git)
    ).resolves.toBe('content.publish')
  })

  // The incoming-side delete, pinned at its new stronger outcome.
  it('never derives a weaker action for a DELETE sent as an incoming fold-variant', async () => {
    const git = await gitWithLivePosts('content/blog/en/sive.mdoc')
    await expect(
      writeActionForChanges([{ path: 'content/blog/en/ſive.mdoc' }], git)
    ).resolves.toBe('settings.manage')
  })

  // #654's product-behaviour reversal, asserted explicitly rather than left implicit in the list
  // above: a fold-UNSTABLE slug colliding with NOTHING was a legal new post under #648 and is now
  // refused for every role, admin included. `entrySlugify` (#669) cannot mint one either, so no
  // legitimate flow reaches this.
  it('refuses a fold-unstable slug that collides with nothing, for every role (#654)', async () => {
    for (const role of ['author', 'editor', 'maintainer', 'admin'] as const) {
      const git = createMemoryGitPort()
      const app = createGitApi(git, asRole(role))
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
      expect(res.status, `POST /git/commit as ${role}`).toBe(400)
      expect(await git.list(), `tree after ${role}`).toEqual([])
    }
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
