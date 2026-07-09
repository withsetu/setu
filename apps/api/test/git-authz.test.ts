import { describe, it, expect } from 'vitest'
import { createGitApi } from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'
import type { Role } from '@setu/core'
import type { ResolveActor } from '../src/auth/resolve-actor'

// #362 — /git/* is the repository write API and had NO authz gate (OWASP A01): an anonymous POST
// /git/commit could rewrite any file in the content repo. WRITES now require `content.edit`. With
// the read-only viewer role removed (#379) every staff role holds content.edit, so the only deny
// path left is the unauthenticated one (no actor → 401). READS (head/file/list) stay ungated on
// purpose: the admin bootstrap reads git.headSha() before a session exists, so gating reads would hang the app on
// "Loading…" (caught in live UAT) — read-gating is deferred to #110 (bootstrap must defer its read).
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
const READ_ROUTES = ['/git/head', '/git/file?path=p.mdoc', '/git/list']

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

  it('leaves READS ungated — even an unauthenticated caller gets 200 (bootstrap reads pre-session; see #110)', async () => {
    const a = app(unauthenticated)
    for (const path of READ_ROUTES)
      expect((await read(a, path)).status, `GET ${path}`).toBe(200)
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

  it('normalizes ./settings.json so the gate cannot be bypassed → 403 for maintainer', async () => {
    expect(
      (await write(app(asRole('maintainer')), '/git/commit', dotSlashSettings))
        .status
    ).toBe(403)
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
