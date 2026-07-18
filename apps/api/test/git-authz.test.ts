import { describe, it, expect } from 'vitest'
import { createGitApi } from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'
import type { Role } from '@setu/core'
import type { ResolveActor } from '../src/auth/resolve-actor'

// #362 — /git/* is the repository write API and had NO authz gate (OWASP A01): an anonymous POST
// /git/commit could rewrite any file in the content repo. WRITES now require `content.edit`. With
// the read-only viewer role removed (#379) every staff role holds content.edit, so the only deny
// path left is the unauthenticated one (no actor → 401).
//
// #621 — the READS were left ungated by #362 on a deferral to #110, which CLOSED without the
// follow-up: any unauthenticated caller could enumerate and read the whole content repo (drafts,
// settings.json). `/git/file`, `/git/list` and `/git/diff` now require authMiddleware +
// `content.view`; only `/git/head` (a bare sha, the pre-session bootstrap read) stays open.
//
// The server is the enforcement boundary; the admin's HttpGitPort carries the session cookie
// (credentials: 'include' via apiFetch — see apps/admin/src/data/Bootstrap.tsx).

const asRole =
  (role: Role): ResolveActor =>
  () => ({ id: 'u', role })
const unauthenticated: ResolveActor = () => null
const author = { name: 'T', email: 't@x.com' }

const commitBody = JSON.stringify({
  path: 'p.mdoc',
  content: 'X',
  message: 'm',
  author
})
const commitFilesBody = JSON.stringify({
  changes: [{ path: 'p.mdoc', content: 'X' }],
  message: 'm',
  author
})

const WRITE_ROUTES: Array<[string, string]> = [
  ['/git/commit', commitBody],
  ['/git/commit-files', commitFilesBody]
]
// #621 — the reads that return repo CONTENT. Gated: authMiddleware + content.view.
const GATED_READ_ROUTES = [
  '/git/file?path=p.mdoc',
  '/git/list',
  `/git/diff?from=${'a'.repeat(40)}&to=${'b'.repeat(40)}`
]

function app(resolveActor: ResolveActor) {
  return createGitApi(createMemoryGitPort(), resolveActor)
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
const read = (a: ReturnType<typeof createGitApi>, path: string) =>
  a.fetch(new Request(`http://x${path}`))

describe('createGitApi — authz enforcement (#362, the Git-write hole)', () => {
  it('rejects an UNAUTHENTICATED caller on WRITES with 401', async () => {
    const a = app(unauthenticated)
    for (const [path, body] of WRITE_ROUTES)
      expect((await write(a, path, body)).status, `POST ${path}`).toBe(401)
  })

  // #621 — this test used to assert the OPPOSITE ("leaves READS ungated — even an unauthenticated
  // caller gets 200 (bootstrap reads pre-session; see #110)"). That assertion ENCODED the bug: it
  // pinned an unauthenticated caller's ability to read every file in the content repo, on a
  // deferral to #110, which closed without the follow-up. It is inverted here. The bootstrap need
  // it was protecting is real but far narrower — `git.headSha()` only — and now has its own
  // dedicated test below so it cannot regress.
  it('rejects an UNAUTHENTICATED caller on content READS with 401 (#621)', async () => {
    const a = app(unauthenticated)
    for (const path of GATED_READ_ROUTES)
      expect((await read(a, path)).status, `GET ${path}`).toBe(401)
  })

  it('admits EVERY role on content READS — content.view is in the shared VIEW set (no role regression)', async () => {
    // The other half of card #5: gating must not cost any role a read it legitimately had. Real
    // history so `/git/diff` gets resolvable shas and a genuine 200 is meaningful.
    for (const role of ['admin', 'maintainer', 'editor', 'author'] as Role[]) {
      const git = createMemoryGitPort()
      const { sha } = await git.commitFile({
        path: 'p.mdoc',
        content: 'X',
        message: 'seed',
        author
      })
      const a = createGitApi(git, asRole(role))
      for (const path of [
        '/git/file?path=p.mdoc',
        '/git/list',
        `/git/diff?from=${sha}&to=${sha}`
      ])
        expect((await read(a, path)).status, `${role} GET ${path}`).toBe(200)
    }
  })

  // The bootstrap carve-out, pinned on its own so a future "gate everything" sweep cannot silently
  // hang the admin on "Loading…" (the live-UAT failure that motivated the original blanket
  // deferral). `seedIfEmpty` in apps/admin/src/data/store.tsx calls this BEFORE any session exists.
  it('keeps /git/head UNGATED for the pre-session bootstrap read (#621 carve-out)', async () => {
    const res = await read(app(unauthenticated), '/git/head')
    expect(res.status).toBe(200)
    // And it must stay content-free: a sha (or null), nothing else.
    expect(Object.keys((await res.json()) as object)).toEqual(['sha'])
  })

  it('allows an AUTHOR to write (content.edit) — commit succeeds', async () => {
    const a = app(asRole('author'))
    const res = await write(a, '/git/commit', commitBody)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { sha: string }).sha).toBeTypeOf('string')
  })

  it('allows a MAINTAINER to write — commit-files succeeds', async () => {
    const a = app(asRole('maintainer'))
    expect((await write(a, '/git/commit-files', commitFilesBody)).status).toBe(
      200
    )
  })
})

// UAT 2026-07-05 — settings persist as `settings.json` through this same git primitive (no dedicated
// settings route), so a `content.edit` holder (maintainer/editor/author) could rewrite settings.json,
// bypassing the admin-only `settings.manage`. The write gate is now path-aware.
describe('createGitApi — settings-path write gate (settings.json → settings.manage)', () => {
  const settingsCommit = JSON.stringify({
    path: 'settings.json',
    content: '{}',
    message: 'm',
    author
  })
  const settingsFiles = JSON.stringify({
    changes: [{ path: 'settings.json', content: '{}' }],
    message: 'm',
    author
  })
  const mixedFiles = JSON.stringify({
    changes: [
      { path: 'p.mdoc', content: 'X' },
      { path: 'settings.json', content: '{}' }
    ],
    message: 'm',
    author
  })
  const dotSlashSettings = JSON.stringify({
    path: './settings.json',
    content: '{}',
    message: 'm',
    author
  })

  it('rejects MAINTAINER/EDITOR/AUTHOR writing settings.json with 403 (settings.manage is admin-only)', async () => {
    for (const role of ['maintainer', 'editor', 'author'] as Role[]) {
      expect(
        (await write(app(asRole(role)), '/git/commit', settingsCommit)).status,
        `${role} commit`
      ).toBe(403)
      expect(
        (await write(app(asRole(role)), '/git/commit-files', settingsFiles))
          .status,
        `${role} commit-files`
      ).toBe(403)
    }
  })

  it('allows an ADMIN to write settings.json (settings.manage)', async () => {
    const a = app(asRole('admin'))
    expect((await write(a, '/git/commit', settingsCommit)).status).toBe(200)
    expect((await write(a, '/git/commit-files', settingsFiles)).status).toBe(
      200
    )
  })

  it('fails closed on a MIXED commit touching settings.json → 403 for maintainer (no smuggling)', async () => {
    expect(
      (await write(app(asRole('maintainer')), '/git/commit-files', mixedFiles))
        .status
    ).toBe(403)
  })

  // #623: this used to assert 403 — the gate NORMALIZED `./settings.json` back to `settings.json`
  // and denied on permission. Normalizing was itself the bug (it only ever covered the spellings
  // we thought of; `content/../settings.json` sailed through). The path is now REJECTED as
  // malformed before any permission derivation, so the status is 400 for every role. The security
  // property the original test protected — a maintainer cannot write settings.json via `./` — is
  // strictly stronger now.
  it('rejects ./settings.json outright (400) so the gate cannot be bypassed', async () => {
    expect(
      (await write(app(asRole('maintainer')), '/git/commit', dotSlashSettings))
        .status
    ).toBe(400)
  })

  it('still allows a MAINTAINER to write ordinary content (content.edit)', async () => {
    expect(
      (await write(app(asRole('maintainer')), '/git/commit', commitBody)).status
    ).toBe(200)
  })
})

// UAT 2026-07-05 — content.publish was enforced only in the admin UI (PublishMenu); the server gate
// checked content.edit, so an author could publish by POSTing live content to the raw git API. The
// gate now inspects the committed frontmatter: a content post going live requires content.publish, a
// `published: false` draft only content.edit.
describe('createGitApi — content publish gate (live → content.publish, draft → content.edit)', () => {
  const CPATH = 'content/post/en/hello.mdoc'
  const liveBody = JSON.stringify({
    path: CPATH,
    content: '---\ntitle: Hello\n---\n\nHi',
    message: 'm',
    author
  })
  const draftBody = JSON.stringify({
    path: CPATH,
    content: '---\ntitle: Hello\npublished: false\n---\n\nHi',
    message: 'm',
    author
  })
  const liveFiles = JSON.stringify({
    changes: [{ path: CPATH, content: '---\ntitle: H\n---\n\nHi' }],
    message: 'm',
    author
  })
  const draftFiles = JSON.stringify({
    changes: [
      { path: CPATH, content: '---\ntitle: H\npublished: false\n---\n\nHi' }
    ],
    message: 'm',
    author
  })

  it('rejects an AUTHOR publishing live content with 403 (needs content.publish)', async () => {
    expect(
      (await write(app(asRole('author')), '/git/commit', liveBody)).status
    ).toBe(403)
    expect(
      (await write(app(asRole('author')), '/git/commit-files', liveFiles))
        .status
    ).toBe(403)
  })

  it('allows an AUTHOR to commit a draft (published:false) → 200 (content.edit)', async () => {
    expect(
      (await write(app(asRole('author')), '/git/commit', draftBody)).status
    ).toBe(200)
    expect(
      (await write(app(asRole('author')), '/git/commit-files', draftFiles))
        .status
    ).toBe(200)
  })

  it('allows an EDITOR (has content.publish) to publish live content → 200', async () => {
    expect(
      (await write(app(asRole('editor')), '/git/commit', liveBody)).status
    ).toBe(200)
  })

  it('leaves non-content paths (taxonomy) at content.edit — an author can still write them', async () => {
    const taxBody = JSON.stringify({
      path: 'categories.yaml',
      content: 'cats: []',
      message: 'm',
      author
    })
    expect(
      (await write(app(asRole('author')), '/git/commit', taxBody)).status
    ).toBe(200)
  })
})

// #382 — the gate above only inspected the NEW content being written, so an author (content.edit
// only) could write `published: false` over an already-LIVE post — a silent unpublish — or delete
// a live post outright, with no content.publish check at all. The gate must also read the
// COMMITTED state of each touched path: touching a file whose committed content is live now needs
// content.publish, covering live-edit, unpublish, and delete of live posts. Drafts (committed
// published:false) stay at content.edit for authors. These tests seed real git history (via the
// git port directly) rather than the `app()` helper, which mints a fresh empty memory port per
// call — we need the gate's `git.readFile` to see a real committed live/draft post.
describe('transition-aware live-post gate (#382)', () => {
  const LIVE = 'content/post/en/live-one.mdoc'
  const DRAFT = 'content/post/en/draft-one.mdoc'
  const liveContent = '---\ntitle: Live\n---\n\nHi'
  const draftContent = '---\ntitle: Draft\npublished: false\n---\n\nHi'

  async function seededGit() {
    const git = createMemoryGitPort()
    await git.commitFile({
      path: LIVE,
      content: liveContent,
      message: 'seed live',
      author
    })
    await git.commitFile({
      path: DRAFT,
      content: draftContent,
      message: 'seed draft',
      author
    })
    return git
  }

  it('author 403s writing published:false over a live post (silent unpublish)', async () => {
    const a = createGitApi(await seededGit(), asRole('author'))
    const body = JSON.stringify({
      path: LIVE,
      content: '---\ntitle: Live\npublished: false\n---\n\nHi',
      message: 'unpublish',
      author
    })
    expect((await write(a, '/git/commit', body)).status).toBe(403)
  })

  it('author 403s deleting a live post', async () => {
    const a = createGitApi(await seededGit(), asRole('author'))
    const body = JSON.stringify({
      changes: [{ path: LIVE, delete: true }],
      message: 'delete',
      author
    })
    expect((await write(a, '/git/commit-files', body)).status).toBe(403)
  })

  it('author saves a NEW draft (published:false, fresh path) → 200', async () => {
    const a = createGitApi(await seededGit(), asRole('author'))
    const body = JSON.stringify({
      path: 'content/post/en/new-draft.mdoc',
      content: draftContent,
      message: 'new draft',
      author
    })
    expect((await write(a, '/git/commit', body)).status).toBe(200)
  })

  it('author edits a committed draft (published:false over published:false) → 200', async () => {
    const a = createGitApi(await seededGit(), asRole('author'))
    const body = JSON.stringify({
      path: DRAFT,
      content: '---\ntitle: Draft edited\npublished: false\n---\n\nHi',
      message: 'edit draft',
      author
    })
    expect((await write(a, '/git/commit', body)).status).toBe(200)
  })

  it('author deletes a committed draft → 200', async () => {
    const a = createGitApi(await seededGit(), asRole('author'))
    const body = JSON.stringify({
      changes: [{ path: DRAFT, delete: true }],
      message: 'delete draft',
      author
    })
    expect((await write(a, '/git/commit-files', body)).status).toBe(200)
  })

  it('editor unpublishes a live post → 200', async () => {
    const a = createGitApi(await seededGit(), asRole('editor'))
    const body = JSON.stringify({
      path: LIVE,
      content: '---\ntitle: Live\npublished: false\n---\n\nHi',
      message: 'unpublish',
      author
    })
    expect((await write(a, '/git/commit', body)).status).toBe(200)
  })

  it('editor deletes a live post → 200', async () => {
    const a = createGitApi(await seededGit(), asRole('editor'))
    const body = JSON.stringify({
      changes: [{ path: LIVE, delete: true }],
      message: 'delete',
      author
    })
    expect((await write(a, '/git/commit-files', body)).status).toBe(200)
  })
})

// #419 — theme-options.json persists through this same git primitive (no dedicated theme route),
// so without a path rule any content.edit holder (author/editor) could rewrite the theme, bypassing
// the theme.manage gate the admin's Appearance screen enforces (UI-only gate, failure mode #13).
// theme.manage is held by maintainer + admin (epic #359), NOT editor/author.
describe('createGitApi — theme-options write gate (theme-options.json → theme.manage)', () => {
  const themeCommit = JSON.stringify({
    path: 'theme-options.json',
    content: '{}',
    message: 'm',
    author
  })
  const themeFiles = JSON.stringify({
    changes: [{ path: 'theme-options.json', content: '{}' }],
    message: 'm',
    author
  })

  it('rejects EDITOR/AUTHOR writing theme-options.json with 403 (they lack theme.manage)', async () => {
    for (const role of ['editor', 'author'] as Role[]) {
      expect(
        (await write(app(asRole(role)), '/git/commit', themeCommit)).status,
        `${role} commit`
      ).toBe(403)
      expect(
        (await write(app(asRole(role)), '/git/commit-files', themeFiles))
          .status,
        `${role} commit-files`
      ).toBe(403)
    }
  })

  it('allows MAINTAINER and ADMIN (hold theme.manage) to write theme-options.json → 200', async () => {
    for (const role of ['maintainer', 'admin'] as Role[])
      expect(
        (await write(app(asRole(role)), '/git/commit', themeCommit)).status,
        role
      ).toBe(200)
  })
})

// #419 — the settings/theme path gate matched case-sensitively; on a case-insensitive filesystem
// (macOS/Windows) `Settings.json` is the SAME inode as settings.json, so a content.edit holder could
// smuggle a settings write past the exact-match gate. The gate now case-folds the path.
describe('createGitApi — path gate is case-insensitive (no case-fold bypass)', () => {
  const cased = (p: string) =>
    JSON.stringify({ path: p, content: '{}', message: 'm', author })

  it('rejects MAINTAINER writing Settings.json / SETTINGS.JSON with 403 (settings.manage)', async () => {
    for (const p of ['Settings.json', 'SETTINGS.JSON'])
      expect(
        (await write(app(asRole('maintainer')), '/git/commit', cased(p)))
          .status,
        p
      ).toBe(403)
  })

  it('rejects EDITOR writing Theme-Options.json with 403 (theme.manage)', async () => {
    expect(
      (
        await write(
          app(asRole('editor')),
          '/git/commit',
          cased('Theme-Options.json')
        )
      ).status
    ).toBe(403)
  })
})

// #419 — no write route was body-size-capped; unbounded c.req.json() is a DoS surface (and amplifies
// the unauthenticated ReDoS on /forms/submit, #340). Writes are now capped; oversize → 413.
describe('createGitApi — request body size cap (413)', () => {
  const oversized =
    '{"path":"p.mdoc","content":"' +
    'a'.repeat(10 * 1024 * 1024 + 1024) +
    '","message":"m"}'

  it('rejects an oversized commit body with 413', async () => {
    expect(
      (await write(app(asRole('admin')), '/git/commit', oversized)).status
    ).toBe(413)
  })
})

// #623 — the gate's own `normalizeRepoPath` stripped only ONE leading `./` or `/` and did no path
// normalization, while the git adapter's `safePath` uses `path.resolve` (full normalization). The
// two disagreed, so a non-canonical spelling made the gate see a harmless path while the adapter
// wrote the privileged one: `content/../settings.json` gated as `content.edit` but written as
// settings.json. The same disagreement broke the publish gate — `parseContentPath` failed on
// `content/blog/en/./post.mdoc`, so BOTH the publish check and the committed-state upgrade were
// skipped while the adapter wrote the real post. Fixed by REJECTING non-canonical paths outright
// (400) rather than trying to normalize every spelling: the admin client has no legitimate reason
// to send one, so rejection closes the whole class instead of the spellings we thought of.
describe('createGitApi — non-canonical paths are rejected (#623)', () => {
  const commitOf = (path: string, content = '{}') =>
    JSON.stringify({ path, content, message: 'm', author })
  const filesOf = (path: string, content = '{}') =>
    JSON.stringify({ changes: [{ path, content }], message: 'm', author })

  // Each of these was a VERIFIED bypass: the gate derived `content.edit`, the adapter wrote the
  // privileged/real file.
  const PRIVILEGE_BYPASSES = [
    'content/../settings.json',
    '././settings.json',
    'settings.json/',
    'content//../settings.json',
    './content/../theme-options.json'
  ]
  const PUBLISH_GATE_BYPASSES = [
    'content/blog/en/./post.mdoc',
    'content/./blog/en/post.mdoc'
  ]

  it('rejects every verified privilege bypass for an AUTHOR with 400 (before any write)', async () => {
    for (const p of PRIVILEGE_BYPASSES) {
      const a = app(asRole('author'))
      expect((await write(a, '/git/commit', commitOf(p))).status, p).toBe(400)
      expect(
        (await write(a, '/git/commit-files', filesOf(p))).status,
        `${p} (commit-files)`
      ).toBe(400)
    }
  })

  it('rejects every verified publish-gate bypass for an AUTHOR with 400', async () => {
    const live = '---\ntitle: X\n---\n\nHi'
    for (const p of PUBLISH_GATE_BYPASSES) {
      const a = app(asRole('author'))
      expect((await write(a, '/git/commit', commitOf(p, live))).status, p).toBe(
        400
      )
    }
  })

  it('rejects a non-canonical path even for an ADMIN (it is a malformed request, not a permission)', async () => {
    const a = app(asRole('admin'))
    expect(
      (await write(a, '/git/commit', commitOf('content/../settings.json')))
        .status
    ).toBe(400)
  })

  it('fails a MIXED commit closed when only ONE change is non-canonical', async () => {
    const body = JSON.stringify({
      changes: [
        { path: 'content/post/en/ok.mdoc', content: 'X' },
        { path: 'content/../settings.json', content: '{}' }
      ],
      message: 'm',
      author
    })
    expect(
      (await write(app(asRole('admin')), '/git/commit-files', body)).status
    ).toBe(400)
  })

  it('rejects other non-canonical spellings (leading slash, empty, whitespace, backslash)', async () => {
    for (const p of [
      '/settings.json',
      './settings.json',
      ' settings.json',
      'settings.json ',
      'content/blog//en/post.mdoc',
      'content\\..\\settings.json'
    ]) {
      const a = app(asRole('author'))
      expect((await write(a, '/git/commit', commitOf(p))).status, p).toBe(400)
    }
  })

  it('leaves the CANONICAL behaviour exactly as before', async () => {
    // admin can write settings.json
    expect(
      (
        await write(
          app(asRole('admin')),
          '/git/commit',
          commitOf('settings.json')
        )
      ).status
    ).toBe(200)
    // author is 403'd on settings.json (permission, not shape)
    expect(
      (
        await write(
          app(asRole('author')),
          '/git/commit',
          commitOf('settings.json')
        )
      ).status
    ).toBe(403)
    // author can write a draft
    expect(
      (
        await write(
          app(asRole('author')),
          '/git/commit',
          commitOf(
            'content/post/en/d.mdoc',
            '---\ntitle: D\npublished: false\n---\n\nHi'
          )
        )
      ).status
    ).toBe(200)
    // author is 403'd publishing a live post
    expect(
      (
        await write(
          app(asRole('author')),
          '/git/commit',
          commitOf('content/post/en/l.mdoc', '---\ntitle: L\n---\n\nHi')
        )
      ).status
    ).toBe(403)
  })
})
