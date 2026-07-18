import { describe, it, expect } from 'vitest'
import { createGitApi, writeActionForChanges } from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'
import type { Role } from '@setu/core'
import type { ResolveActor } from '../src/auth/resolve-actor'

// #644 — residual of #623/#362: the `PATH_WRITE_ACTION` gate case-folds the request path with
// `String.prototype.toLowerCase()`, which is Unicode SIMPLE CASE MAPPING. A case-insensitive
// filesystem (APFS on macOS, NTFS on Windows) resolves filenames with Unicode CASE FOLDING, a
// strictly LARGER relation. Every character in the gap is a gate bypass.
//
// Empirically confirmed on this machine (macOS/APFS), not assumed:
//   'ſ'.toLowerCase() === 's'                                  -> false   (U+017F LONG S)
//   fs.writeFileSync('ſettings.json', 'PAYLOAD')
//   fs.readFileSync('settings.json', 'utf8')                   -> 'PAYLOAD'
//   fs.readdirSync('.')                                        -> ['ſettings.json']   (ONE file)
// i.e. the two spellings are the SAME INODE, but `foldRepoPath` leaves U+017F intact, so
// `PATH_WRITE_ACTION['ſettings.json']` misses, `actionForChange` returns `content.edit`, and an
// author (who holds content.edit but NOT settings.manage) drives the adapter into writing the
// real `settings.json` inode.
//
// HONEST SCOPE: git stages a literally different index entry (`ſettings.json`), so this is a
// WORKING-TREE clobber plus a repo-state inconsistency — the site build reads the working tree —
// not a clean committed-settings takeover. It is still a privilege boundary an author crosses.
//
// THE FIX IS A REJECTION, NOT AN ENUMERATION (the #623 lesson). Enumerating fold-equivalent
// spellings only ever closes the ones we thought of; U+017F is one of an open-ended set of
// non-ASCII characters that fold into ASCII. Restricting repo-ROOT paths to ASCII makes
// `toLowerCase` a FAITHFUL fold on exactly the paths the `PATH_WRITE_ACTION` lookup keys on:
// for ASCII strings, Unicode case folding and `toLowerCase` coincide, so no two distinct accepted
// root paths can resolve to the same file without the gate treating them identically.
//
// The rejection is deliberately scoped to repo-ROOT paths (no `/`). Content paths legitimately
// carry non-ASCII slugs — `entrySlugify` (packages/core/src/rename/slug.ts) keeps `\p{L}`, so a
// post titled "Café" yields `content/blog/en/café.mdoc` — and a repo-wide ASCII rule would be a
// real product regression. Every `PATH_WRITE_ACTION` key is a root file, so root-only ASCII is
// exactly enough to close this gate.

const asRole =
  (role: Role): ResolveActor =>
  () => ({ id: 'u', role })
const author = { name: 'T', email: 't@x.com' }

/** Every fold-equivalent spelling of a PATH_WRITE_ACTION key that `toLowerCase` does NOT fold.
 *  U+017F folds to 's'; U+212A (KELVIN SIGN) folds to 'k' and is included as a second,
 *  independent witness that the fix closes a CLASS and not a single character. */
const FOLD_VARIANTS = [
  'ſettings.json', // ſettings.json  -> settings.json
  'theme-optionſ.json', // theme-optionſ.json -> theme-options.json
  'Kettings.json' // Kettings.json (KELVIN SIGN) — same shape, different char
]

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

describe('git write gate — Unicode case-fold bypass of PATH_WRITE_ACTION (#644)', () => {
  it('refuses an AUTHOR writing a fold-variant of settings.json, and nothing lands', async () => {
    for (const path of FOLD_VARIANTS) {
      const git = createMemoryGitPort()
      const app = createGitApi(git, asRole('author'))
      const res = await write(
        app,
        '/git/commit',
        JSON.stringify({
          path,
          content: '{"pwned":true}',
          message: 'm',
          author
        })
      )
      // Observable behaviour, not configuration shape: the request must not succeed...
      expect(res.status, `POST /git/commit ${JSON.stringify(path)}`).not.toBe(
        200
      )
      expect(res.status, `POST /git/commit ${JSON.stringify(path)}`).toBe(400)
      // ...and the adapter must never have been driven. `git.list()` sees the staged tree; the
      // #623 kill-shot lesson is that `git.readFile` at HEAD can hide a write that already
      // touched the tree, so assert on the listing, not on a HEAD read.
      const listed = await git.list()
      expect(listed, `tree after ${JSON.stringify(path)}`).toEqual([])
    }
  })

  it('refuses the same fold-variants through the bulk commit-files route', async () => {
    for (const path of FOLD_VARIANTS) {
      const git = createMemoryGitPort()
      const app = createGitApi(git, asRole('author'))
      const res = await write(
        app,
        '/git/commit-files',
        JSON.stringify({
          changes: [{ path, content: '{"pwned":true}' }],
          message: 'm',
          author
        })
      )
      expect(res.status, `POST /git/commit-files ${JSON.stringify(path)}`).toBe(
        400
      )
      expect(await git.list(), `tree after ${JSON.stringify(path)}`).toEqual([])
    }
  })

  // `writeActionForChanges` is exported as THE shared write-permission seam — history-api.ts's
  // restore route derives its gate through it, OUTSIDE `requireWrite`'s 400. A direct caller must
  // therefore also fail closed on these paths rather than get `content.edit` back.
  it('fails CLOSED for a direct writeActionForChanges caller (the restore-route seam)', async () => {
    const git = createMemoryGitPort()
    for (const path of FOLD_VARIANTS) {
      await expect(
        writeActionForChanges([{ path, content: 'x' }], git),
        `writeActionForChanges ${JSON.stringify(path)}`
      ).resolves.toBe('settings.manage')
    }
  })

  it('still admits an ADMIN writing the real settings.json (no false rejection)', async () => {
    const git = createMemoryGitPort()
    const app = createGitApi(git, asRole('admin'))
    const res = await write(
      app,
      '/git/commit',
      JSON.stringify({
        path: 'settings.json',
        content: '{"ok":true}',
        message: 'm',
        author
      })
    )
    expect(res.status).toBe(200)
  })

  // The scoping call: non-ASCII is rejected only at the repo ROOT, where PATH_WRITE_ACTION keys
  // live. A real post with an accented slug must keep working for an ordinary author.
  it('still admits an AUTHOR writing a content path with a non-ASCII slug', async () => {
    const git = createMemoryGitPort()
    const app = createGitApi(git, asRole('author'))
    const res = await write(
      app,
      '/git/commit',
      JSON.stringify({
        path: 'content/blog/en/café.mdoc',
        content: '---\npublished: false\n---\nhi',
        message: 'm',
        author
      })
    )
    expect(res.status).toBe(200)
  })
})
