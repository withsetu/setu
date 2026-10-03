import { test, expect, type APIRequestContext } from '@playwright/test'
import { storageStateFor } from '../lib/auth-state'
import { uniqueTitle } from '../lib/unique-title'
import { sandboxRepoFile } from '../lib/sandbox-git'

// #1154 wrong-actor gate (CLAUDE.md card #5), against the REAL running api + git-local adapter.
// The git write routes accept only the repo paths the CMS itself writes (`WRITABLE_REPO_PATHS` in
// apps/api/src/app.ts); anything else — VCS internals, executed config, unknown paths — is a 400
// for EVERY role. This spec pins both halves: the author is refused and nothing lands on disk, and
// the admin is still admitted for a legitimate settings write. It also proves the refusal is not
// role-based by sending the admin the same refused paths.
//
// Same cross-origin surface + ports as git-path-canonical-gate.spec.ts. No `editor-` prefix:
// chromium-only, this is an HTTP-level gate.
const apiUrl = 'http://localhost:4446'
const adminOrigin = 'http://localhost:5175'

/** Paths off the allowlist, each with the guard expected to refuse it. A VCS-directory segment is
 *  non-canonical (refused by `isCanonicalRepoPath`); the rest are canonical but not writable. The
 *  VCS probe is a deliberately inert, unique file name so a regression could never plant anything
 *  git would execute in the shared sandbox. */
const CANONICAL = 'path must be canonical and repo-relative'
const NOT_WRITABLE = 'path is not writable through the CMS'
const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ['.git/setu-e2e-1154-probe', CANONICAL],
  ['.GIT/setu-e2e-1154-probe-upper', CANONICAL],
  ['setu.config.ts', NOT_WRITABLE],
  ['package.json', NOT_WRITABLE],
  ['setu-e2e-1154-unknown.txt', NOT_WRITABLE]
]

async function attempt(
  request: APIRequestContext,
  route: '/git/commit' | '/git/commit-files',
  path: string,
  content: string,
  who: { name: string; email: string }
) {
  // Explicit `origin`: better-auth's originCheckMiddleware rejects a cookie-bearing POST without
  // a trusted Origin, which would prove the wrong thing (see users-rank.spec.ts).
  return request.post(`${apiUrl}${route}`, {
    headers: { origin: adminOrigin },
    data:
      route === '/git/commit'
        ? { path, content, message: `#1154 e2e: ${path}`, author: who }
        : {
            changes: [{ path, content }],
            message: `#1154 e2e: ${path}`,
            author: who
          }
  })
}

async function expectRefusedAndAbsent(
  request: APIRequestContext,
  who: { name: string; email: string }
) {
  // A marker unique to THIS run, so the no-write proof is immune to other projects sharing the
  // sandbox under E2E_FULL_MATRIX (#551).
  const marker = uniqueTitle('#1154 refused write')
  for (const route of ['/git/commit', '/git/commit-files'] as const)
    for (const [path, error] of REFUSED) {
      const res = await attempt(request, route, path, marker, who)
      expect(res.status(), `${route} ${path}`).toBe(400)
      expect((await res.json()) as unknown, `${route} ${path}`).toEqual({
        error
      })
    }
  // The WORKING TREE, not `GET /git/file` (HEAD): the adapter writes to disk before staging, so a
  // HEAD read could call a landed write a pass (the #623 lesson). Both case spellings of the VCS
  // probe are checked, since a case-folding checkout resolves `.GIT/` onto `.git/`.
  for (const [path] of REFUSED)
    expect(sandboxRepoFile(path) ?? '', path).not.toContain(marker)
  expect(
    sandboxRepoFile('.git/setu-e2e-1154-probe-upper') ?? '',
    '.git/ probe (case-folded)'
  ).not.toContain(marker)
}

test.describe('#1154 git write routes accept only CMS-writable paths', () => {
  test.describe('wrong actor: an author', () => {
    test.use({ storageState: storageStateFor('author') })

    test('author: every non-allowlisted path is refused 400 and nothing lands', async ({
      page
    }) => {
      await expectRefusedAndAbsent(page.request, {
        name: 'E2E Author',
        email: 'author-e2e@setu.test'
      })
    })
  })

  test.describe('right actor: an admin', () => {
    test.use({ storageState: storageStateFor('admin') })

    test('admin: the same paths are refused too (the allowlist is not role-based)', async ({
      page
    }) => {
      await expectRefusedAndAbsent(page.request, {
        name: 'E2E Admin',
        email: 'admin-e2e@setu.test'
      })
    })

    test('admin: a legitimate settings.json write is still admitted', async ({
      page
    }) => {
      // `{}` is a semantic no-op for every spec sharing this sandbox (parseSettings fills
      // defaults) and idempotent across re-runs — see git-path-canonical-gate.spec.ts.
      const content = '{}\n'
      const res = await attempt(
        page.request,
        '/git/commit',
        'settings.json',
        content,
        {
          name: 'E2E Admin',
          email: 'admin-e2e@setu.test'
        }
      )
      expect(res.status()).toBe(200)
      expect((await res.json()) as { sha: string }).toHaveProperty('sha')
      expect(sandboxRepoFile('settings.json')).toBe(content)
    })
  })
})
