import { test, expect, type APIRequestContext } from '@playwright/test'
import { storageStateFor } from '../lib/auth-state'
import { uniqueTitle } from '../lib/unique-title'
import { sandboxRepoFile, sandboxSubjectsForPath } from '../lib/sandbox-git'

// #1201 wrong-actor gate (CLAUDE.md card #5) for the two repo-root admin files, written by their
// CANONICAL names. `writeActionForChanges` (apps/api/src/app.ts) derives `settings.manage` (admin
// only) for `settings.json` and `theme.manage` (maintainer+) for `theme-options.json`; the unit
// half lives in apps/api/test/git-authz.test.ts. This spec proves the same thing against the real
// running api with real Better Auth sessions: the wrong actor gets an exact 403 and nothing lands
// — neither in the working tree nor in history — and the right actor is admitted, so the 403s
// cannot be explained by the route refusing everyone.
//
// The non-canonical spellings of these paths are git-path-canonical-gate.spec.ts's job (400);
// this spec is the permission rung behind it. Same cross-origin surface + ports as that spec.
// No `editor-` prefix: chromium-only, this is an HTTP-level gate.
const apiUrl = 'http://localhost:4446'
const adminOrigin = 'http://localhost:5175'

const ROUTES = ['/git/commit', '/git/commit-files'] as const
type Who = { name: string; email: string }

async function attempt(
  request: APIRequestContext,
  route: (typeof ROUTES)[number],
  path: string,
  content: string,
  message: string,
  who: Who
) {
  // Explicit `origin`: better-auth's originCheckMiddleware rejects a cookie-bearing POST without
  // a trusted Origin, which would prove the wrong thing (see users-rank.spec.ts).
  return request.post(`${apiUrl}${route}`, {
    headers: { origin: adminOrigin },
    data:
      route === '/git/commit'
        ? { path, content, message, author: who }
        : { changes: [{ path, content }], message, author: who }
  })
}

/** POST a marker-bearing write to `path` on both write routes, expect an exact 403 `forbidden`,
 *  then prove nothing landed. The marker is unique to this call, so the proof is immune to other
 *  specs/projects legitimately writing these same files in the shared sandbox (#551). */
async function expectForbiddenAndUnwritten(
  request: APIRequestContext,
  path: string,
  who: Who
) {
  const marker = uniqueTitle(`#1201 refused ${path}`)
  const content = `${JSON.stringify({ setuE2eRefusedMarker: marker }, null, 2)}\n`
  for (const route of ROUTES) {
    const res = await attempt(request, route, path, content, marker, who)
    // 403, not 400 (the path is canonical and allowlisted, so the request reached permission
    // derivation) and not 401 (a 401 would mean the storage state went stale and would say
    // nothing about the role).
    expect(res.status(), `${who.name} ${route} ${path}`).toBe(403)
    expect((await res.json()) as unknown, `${route} ${path}`).toEqual({
      error: 'forbidden'
    })
  }
  // The WORKING TREE, not `GET /git/file` (which resolves at HEAD): the adapter writes to disk
  // before staging, so a HEAD-only read could call a landed write a pass (the #623 lesson,
  // e2e/lib/sandbox-git.ts `sandboxRepoFile`).
  expect(sandboxRepoFile(path) ?? '', `${path} on disk`).not.toContain(marker)
  // And HISTORY: no commit for this path carries this call's marker as its message.
  expect(sandboxSubjectsForPath(path), `${path} history`).not.toContain(marker)
}

/** The admitted write. `{}` is a semantic no-op for every spec sharing this sandbox — the e2e
 *  sandbox seeds `content/` only, `parseSettings` fills every settings group from defaults for
 *  `{}`, and the Appearance screen spreads stored theme values over the declared defaults — and
 *  it is idempotent across projects and re-runs (git-path-canonical-gate.spec.ts makes the same
 *  settings write). */
async function expectAdmitted(
  request: APIRequestContext,
  path: string,
  who: Who
) {
  const content = '{}\n'
  const res = await attempt(
    request,
    '/git/commit',
    path,
    content,
    `#1201 e2e admitted ${path}`,
    who
  )
  expect(res.status(), `${who.name} ${path}`).toBe(200)
  expect((await res.json()) as { sha: string }).toHaveProperty('sha')
  expect(sandboxRepoFile(path), `${path} on disk`).toBe(content)
}

const AUTHOR: Who = { name: 'E2E Author', email: 'author-e2e@setu.test' }
const MAINTAINER: Who = {
  name: 'E2E Maintainer',
  email: 'maintainer-e2e@setu.test'
}
const ADMIN: Who = { name: 'E2E Admin', email: 'admin-e2e@setu.test' }

test.describe('#1201 canonical writes to the repo-root admin files are role-gated', () => {
  test.describe('wrong actor: an author', () => {
    test.use({ storageState: storageStateFor('author') })

    test('author: settings.json is refused 403 and nothing lands', async ({
      page
    }) => {
      await expectForbiddenAndUnwritten(page.request, 'settings.json', AUTHOR)
    })

    test('author: theme-options.json is refused 403 and nothing lands', async ({
      page
    }) => {
      await expectForbiddenAndUnwritten(
        page.request,
        'theme-options.json',
        AUTHOR
      )
    })
  })

  test.describe('middle rung: a maintainer', () => {
    test.use({ storageState: storageStateFor('maintainer') })

    // The rung that separates the two files: `theme.manage` is maintainer+, `settings.manage` is
    // admin only. One session proving both directions pins that split.
    test('maintainer: settings.json is refused 403 and nothing lands', async ({
      page
    }) => {
      await expectForbiddenAndUnwritten(
        page.request,
        'settings.json',
        MAINTAINER
      )
    })

    test('maintainer: theme-options.json is admitted (positive control)', async ({
      page
    }) => {
      await expectAdmitted(page.request, 'theme-options.json', MAINTAINER)
    })
  })

  test.describe('right actor: an admin', () => {
    test.use({ storageState: storageStateFor('admin') })

    test('admin: settings.json is admitted (positive control)', async ({
      page
    }) => {
      await expectAdmitted(page.request, 'settings.json', ADMIN)
    })
  })
})
