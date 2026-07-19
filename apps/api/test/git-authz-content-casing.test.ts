import { describe, it, expect } from 'vitest'
import { createGitApi, writeActionForChanges } from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'
import type { Role } from '@setu/core'
import type { ResolveActor } from '../src/auth/resolve-actor'

// #647 — the sibling of #644, in the same gate. #644 closed the repo-ROOT half (`PATH_WRITE_ACTION`
// could be dodged with a Unicode fold-variant of `settings.json`). This is the `content/` half.
//
// `parseContentPath` (packages/core/src/publish/content-path.ts:13) matches
// `/^content\/([^/]+)\/([^/]+)\/([^/]+)\.mdoc$/` — CASE-SENSITIVE. `writeActionForChanges` uses
// that match as the trigger for BOTH the publish check and the #382 committed-state upgrade. A
// case-insensitive filesystem (APFS/NTFS) resolves the variant to the SAME INODE as the canonical
// spelling, so every spelling the parser misses is a live post an author can rewrite.
//
// Measured against a seeded LIVE post at `content/blog/en/live.mdoc`, sending `published: false`
// content (i.e. asking for the WEAKEST action), all four variants derive `content.edit` where the
// canonical spelling derives `content.publish`:
//
//   content/blog/en/live.mdoc  -> content.publish   (control)
//   Content/blog/en/live.mdoc  -> content.edit      class A: prefix casing  -> parser MISSES
//   content/blog/en/live.MDOC  -> content.edit      class A: extension casing -> parser MISSES
//   content/blog/en/Live.mdoc  -> content.edit      class B: slug casing
//   content/blog/en/ſive.mdoc  -> content.edit      class C: slug case-FOLDING — closed from BOTH
//                                                   ends by #654 (reject a fold-unstable incoming
//                                                   path) and #648 (match fold-variants already
//                                                   committed); see the note at the end of the file
//
// Class A and class B are DIFFERENT mechanisms reaching the same boundary:
//   A. the parser returns null, so the path is classified as an ordinary non-content write and
//      skips the publish check and the committed-state read entirely.
//   B. the parser MATCHES (the slug segment is `[^/]+`, so `Live` is a legal slug), the publish
//      check runs on the attacker's own `published: false` frontmatter and passes, and then the
//      committed-state read — `git.readFile('content/blog/en/Live.mdoc')` — misses, because git's
//      index is case-SENSITIVE even where the filesystem is not. So the #382 upgrade never fires
//      while the adapter's write lands on the real live post.
// Fixing only A would leave B open, which is exactly the "hardened one half, left its neighbour
// open" shape this whole slice exists to clean up. One rule closes both.
//
// THE RULE: a path whose CASE-FOLDED form parses as a content path must already BE its own folded
// form. Not "make classification case-insensitive" — that would silently start accepting
// `CONTENT/...` as a valid content path in `parseContentPath`'s other callers (the content index,
// demo planning, the admin editor), a far larger blast radius than this gate. Rejecting keeps the
// change local to the API gate and fail-closed, and it is a rejection of the CLASS rather than an
// enumeration of spellings (the #623/#644 lesson).
//
// Honest scope, same as #644: git stages a literally different index entry, so this is a
// working-tree clobber plus repo-state inconsistency (the site build reads the working tree), not
// a clean committed-state takeover. It is still the #382 privilege boundary an author crosses.

const asRole =
  (role: Role): ResolveActor =>
  () => ({ id: 'u', role })
const author = { name: 'T', email: 't@x.com' }

/** Frontmatter that asks for the WEAKEST action: a `published: false` draft needs only
 *  `content.edit`. Any variant that still derives `content.edit` against a LIVE committed post is
 *  a bypass of the #382 upgrade. */
const DRAFT_CONTENT = '---\ntitle: L\npublished: false\n---\nPWNED'

/** Every spelling that resolves to `content/blog/en/live.mdoc` on a case-folding filesystem while
 *  the gate classified it as something weaker. */
const CASE_VARIANTS = [
  'Content/blog/en/live.mdoc', // A: prefix
  'CONTENT/blog/en/live.mdoc', // A: prefix, fully upper
  'content/blog/en/live.MDOC', // A: extension
  'content/blog/en/Live.mdoc', // B: slug
  'content/Blog/EN/live.mdoc' // B: collection + locale
]

/** Seeds a LIVE post (no `published: false`) at the canonical spelling. */
async function gitWithLivePost() {
  const git = createMemoryGitPort()
  await git.commitFile({
    path: 'content/blog/en/live.mdoc',
    content: '---\ntitle: L\n---\nbody',
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

describe('git write gate — content-path casing bypass of the publish gate (#647)', () => {
  it('derives content.publish for the canonical spelling (the control this is measured against)', async () => {
    const git = await gitWithLivePost()
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/live.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.publish')
  })

  it('fails CLOSED for every case-variant of a live post, instead of downgrading to content.edit', async () => {
    const git = await gitWithLivePost()
    for (const path of CASE_VARIANTS) {
      await expect(
        writeActionForChanges([{ path, content: DRAFT_CONTENT }], git),
        `writeActionForChanges ${JSON.stringify(path)}`
      ).resolves.toBe('settings.manage')
    }
  })

  it('refuses an AUTHOR writing any case-variant, and nothing lands', async () => {
    for (const path of CASE_VARIANTS) {
      const git = await gitWithLivePost()
      const before = await git.list()
      const app = createGitApi(git, asRole('author'))
      const res = await write(
        app,
        '/git/commit',
        JSON.stringify({ path, content: DRAFT_CONTENT, message: 'm', author })
      )
      expect(res.status, `POST /git/commit ${JSON.stringify(path)}`).toBe(400)
      // Assert on the staged tree, not a HEAD read: the #623 kill-shot lesson is that
      // `git.readFile` resolves at HEAD and can hide a write that already touched the tree.
      expect(await git.list(), `tree after ${JSON.stringify(path)}`).toEqual(
        before
      )
    }
  })

  it('refuses the same case-variants through the bulk commit-files route', async () => {
    for (const path of CASE_VARIANTS) {
      const git = await gitWithLivePost()
      const before = await git.list()
      const app = createGitApi(git, asRole('author'))
      const res = await write(
        app,
        '/git/commit-files',
        JSON.stringify({
          changes: [{ path, content: DRAFT_CONTENT }],
          message: 'm',
          author
        })
      )
      expect(res.status, `POST /git/commit-files ${JSON.stringify(path)}`).toBe(
        400
      )
      expect(await git.list(), `tree after ${JSON.stringify(path)}`).toEqual(
        before
      )
    }
  })

  // The rejection must stay NARROW. It keys on "the folded form parses as a content path", so it
  // must not touch ordinary repo files that legitimately carry uppercase.
  it('still admits legitimately-uppercase NON-content paths', async () => {
    const git = createMemoryGitPort()
    const app = createGitApi(git, asRole('maintainer'))
    for (const path of ['README.md', 'docs/GUIDE.md', 'LICENSE']) {
      const res = await write(
        app,
        '/git/commit',
        JSON.stringify({ path, content: 'hi', message: 'm', author })
      )
      expect(res.status, `POST /git/commit ${JSON.stringify(path)}`).toBe(200)
    }
  })

  it('still admits an AUTHOR writing a canonical draft, including a non-ASCII slug', async () => {
    const git = createMemoryGitPort()
    const app = createGitApi(git, asRole('author'))
    for (const path of [
      'content/blog/en/new-post.mdoc',
      'content/blog/en/café.mdoc',
      'content/blog/ja/日本語.mdoc'
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

  // Class C — the KNOWN GAP this file used to PIN as accepted. #654 and #648 landed concurrently
  // and BOTH close a piece of it, from opposite ends; the assertions below keep both visible.
  //
  // #654 (this block): U+017F case-FOLDS into ASCII while `toLowerCase()` leaves it alone, so
  // `content/blog/en/ſive.mdoc` was its own `toLowerCase` form, passed the class-A/B rule, and
  // still resolved to `live.mdoc`'s neighbourhood on APFS. The old note claimed JS exposes no
  // Unicode case-fold — it exposes enough: `s.toUpperCase().toLowerCase()` collapses exactly the
  // characters whose FOLD differs from their simple lowercase mapping (`ſ`→`s`, `ﬁ`→`fi`,
  // `ß`→`ss`, `ı`→`i`), and `normalize('NFC')` closes the composed/decomposed half. `foldRepoPath`
  // now does both, so the same one rule that rejects `Content/…` rejects these too.
  //
  // Still a rejection of the CLASS, not an enumeration: any character whose fold or normalization
  // moves it is caught, including ones no one here thought of.
  const FOLD_VARIANTS = [
    'content/blog/en/ſive.mdoc', // U+017F long s
    'content/blog/en/ﬁle.mdoc', // U+FB01 ligature fi
    'content/blog/en/straße.mdoc', // ß folds to ss
    'content/blog/en/ırmak.mdoc', // dotless ı folds to i
    'content/blog/en/cafe\u0301.mdoc' // NFD (e + U+0301) — same inode as the NFC café.mdoc
  ]

  it('fails CLOSED for a non-ASCII slug that case-folds or re-normalizes (#654, closes #648)', async () => {
    const git = await gitWithLivePost()
    for (const path of FOLD_VARIANTS) {
      await expect(
        writeActionForChanges([{ path, content: DRAFT_CONTENT }], git),
        `writeActionForChanges ${JSON.stringify(path)}`
      ).resolves.toBe('settings.manage')
    }
  })

  it('refuses an AUTHOR writing any fold-variant, and nothing lands (#654)', async () => {
    for (const path of FOLD_VARIANTS) {
      const git = await gitWithLivePost()
      const before = await git.list()
      const app = createGitApi(git, asRole('author'))
      const res = await write(
        app,
        '/git/commit',
        JSON.stringify({ path, content: DRAFT_CONTENT, message: 'm', author })
      )
      expect(res.status, `POST /git/commit ${JSON.stringify(path)}`).toBe(400)
      expect(await git.list(), `tree after ${JSON.stringify(path)}`).toEqual(
        before
      )
    }
  })

  // The stronger fold must not start rejecting the fold-STABLE non-ASCII slugs the product
  // supports — that is the line between "reject the collision class" and "ban i18n".
  it('still admits fold-stable non-ASCII slugs after the stronger fold (#654)', async () => {
    const git = createMemoryGitPort()
    const app = createGitApi(git, asRole('author'))
    for (const path of [
      'content/blog/de/über-uns.mdoc',
      'content/blog/fr/café.mdoc',
      'content/blog/ja/日本語.mdoc',
      'content/blog/el/ελλάσ.mdoc'
    ]) {
      const res = await write(
        app,
        '/git/commit',
        JSON.stringify({ path, content: DRAFT_CONTENT, message: 'm', author })
      )
      expect(res.status, `POST /git/commit ${JSON.stringify(path)}`).toBe(200)
    }
  })

  // ---------------------------------------------------------------------------------------------
  // #648's half of class C, preserved. #648 closed the SAME gap from the COMMITTED side, in the
  // #382 committed-state read, by matching committed paths under Unicode simple case folding
  // (`RegExp` with `iu`) instead of literal equality. #654's rejection above does NOT make that
  // redundant, and these two assertions are what prove it: the first shows #654 now intercepts
  // #648's original witness EARLIER and more strongly, the second shows the direction only #648
  // can reach. Full #648 coverage lives in git-authz-slug-case-fold.test.ts.

  // #648 originally asserted `content.publish` here. With #654's stronger `foldRepoPath`, the
  // incoming path is no longer canonical at all, so the gate fails closed one rule earlier at
  // `settings.manage` — STRICTLY stronger than `content.publish` on the write-action ladder, and
  // it also 400s before any permission question. The security property #648 asserted (this must
  // never derive the weaker `content.edit`) is preserved and tightened, not dropped.
  it('fails CLOSED, above content.publish, for a fold-variant of a live post (#648 via #654)', async () => {
    const git = await gitWithLivePost()
    await git.commitFile({
      path: 'content/blog/en/sive.mdoc',
      content: '---\ntitle: S\n---\nbody',
      message: 'seed',
      author
    })
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/ſive.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('settings.manage')
  })

  // THE DIRECTION #654's REJECTION CANNOT REACH — this is why `foldCollidingPaths` stays.
  // Here the INCOMING path is fold-STABLE (`sive.mdoc` is its own `unicodeCaseFold`), so
  // `isCanonicalRepoPath` admits it, correctly — it is an ordinary legal slug. The LIVE post it
  // collides with is the fold-unstable one already committed, which #654 can no longer prevent
  // but also cannot undo: repos predating these rules, direct `git push`, and other topologies all
  // produce it. git's index is case-SENSITIVE, so the literal `readFile('sive.mdoc')` misses the
  // committed `ſive.mdoc` entirely, and without #648's committed-path fold-match this derives the
  // WEAKER `content.edit` while the write lands on the live post's inode on APFS.
  it('derives content.publish when the COMMITTED live post is the fold-variant (#648)', async () => {
    const git = createMemoryGitPort()
    await git.commitFile({
      path: 'content/blog/en/ſive.mdoc',
      content: '---\ntitle: S\n---\nbody',
      message: 'seed',
      author
    })
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/sive.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.publish')
  })

  // The same direction with NEITHER side ASCII — #648's sigma witness, which proves this is the
  // fold RELATION rather than a smuggled-in ASCII rule. `σigma.mdoc` is fold-stable and admitted;
  // the committed live post is the final-sigma spelling.
  it('derives content.publish for a committed fold-variant where neither side is ASCII (#648)', async () => {
    const git = createMemoryGitPort()
    await git.commitFile({
      path: 'content/blog/en/ςigma.mdoc',
      content: '---\ntitle: S\n---\nbody',
      message: 'seed',
      author
    })
    await expect(
      writeActionForChanges(
        [{ path: 'content/blog/en/σigma.mdoc', content: DRAFT_CONTENT }],
        git
      )
    ).resolves.toBe('content.publish')
  })
})
