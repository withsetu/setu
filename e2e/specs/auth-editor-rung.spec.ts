import { test, expect } from '@playwright/test'
import { DashboardPage } from '../pages/DashboardPage'
import { storageStateFor } from '../lib/auth-state'
import { uniqueTitle } from '../lib/unique-title'
import { sandboxRepoFile } from '../lib/sandbox-git'

// #811: `editor` was the one rung of the four-role ladder (admin > maintainer > editor > author)
// with no session anywhere in the harness — `seed-users.ts` seeded three roles and
// `storageStateFor('editor')` was never called. `users-rank.spec.ts` CREATES an editor through the
// UI but never signs in as one, so nothing proved an editor CAN publish (the capability that
// separates them from an author) or CANNOT reach `users.*`. A permission-matrix edit collapsing
// editor into author, or promoting it toward maintainer, was invisible to e2e in BOTH directions.
//
// The two assertions below are the rung, stated as the pair of facts that define it against its
// neighbours (`DEFAULT_ROLES`, packages/core/src/authz/default-roles.ts):
//   - editor HOLDS `content.publish` (author does not) — the admitted half.
//   - editor does NOT hold `users.view` (maintainer does) — the denied half.
// Collapse editor into author and the first goes red; promote it toward maintainer and the second
// does. Neither direction can rot silently.
//
// ## Kill-shot (CLAUDE.md §3.3 #4) — recorded 2026-07-21, chromium
//
// The denial half is security-relevant, so it was proven to fail against vulnerable code:
// apps/api/src/users.ts's `GET /api/users` gate
// (`if (!authz.can(c.get('actor'), 'users.view')) return c.json({ error: 'forbidden' }, 403)`)
// removed:
//     ✘ editor: is DENIED the Users roster (server-side, not just the route guard)
//       Error: editor GET /api/users
//       expect(received).toBe(expected)
//       Expected: 403 / Received: 200
//     2 failed, 9 passed  (publish-and-users-gate.spec.ts's author twin went red in the same run)
// Restored → green. Full verbatim output is in the PR body.
//
// The ADMITTED half is deliberately not kill-shotted: an over-block is not a security failure and
// fails loudly on the ordinary path anyway (an editor who cannot publish breaks the product's core
// journey), which is the case §3.3 #4 says a normal test already covers.
//
// The api's real cross-origin surface (admin :5175 -> api :4446) — the ports
// playwright.config.ts hardcodes for the whole run.
const apiUrl = 'http://localhost:4446'
const adminOrigin = 'http://localhost:5175'

// No `editor-` prefix on the FILENAME despite the subject: playwright.config.ts's webkit-editor
// project matches `**/editor-*.spec.ts`, and this is an HTTP/role spec, not a contenteditable
// surface — a second engine would add nothing. Hence `auth-editor-rung`, which stays chromium-only.

test.describe('#811 the editor rung, both ways', () => {
  test.use({ storageState: storageStateFor('editor') })

  test('editor: is ADMITTED to publish live content, and the write lands', async ({
    page
  }) => {
    // `content.publish` is what an editor has and an author does not. The payload is the same
    // live-post shape publish-and-users-gate.spec.ts sends as an author (no `published: false`,
    // so `publishesLiveContent` reads it as live and the gate derives `content.publish`) — same
    // request, one rung up the ladder, opposite outcome.
    const title = uniqueTitle('#811 editor publish')
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    // uniqueTitle-minted, so this path is only ever touched by this spec's own run (#551) —
    // never a seeded post.
    const path = `content/post/en/${slug}.mdoc`
    const content = `---\ntitle: ${title}\npublished: true\n---\n\nBody for ${title}.\n`

    // Explicit `origin`: better-auth's originCheckMiddleware 403s any cookie-bearing request with
    // MISSING_OR_NULL_ORIGIN regardless of role, which would make an "admitted" assertion fail for
    // a reason that has nothing to do with the matrix (users-rank.spec.ts verified this against
    // the installed better-auth source).
    const res = await page.request.post(`${apiUrl}/git/commit`, {
      headers: { origin: adminOrigin },
      data: {
        path,
        content,
        message: `#811 e2e editor publish: ${title}`,
        author: { name: 'E2E Editor', email: 'editor-e2e@setu.test' }
      }
    })

    expect(res.status(), 'editor POST /git/commit (live content)').toBe(200)
    expect((await res.json()) as { sha: string }).toHaveProperty('sha')
    // Proof the write really landed, read off the sandbox WORKING TREE — the same seam the
    // blocked cases assert `null` on, so admitted and denied are one measurement in two
    // directions rather than two different questions.
    expect(sandboxRepoFile(path)).toBe(content)
  })

  test('editor: is DENIED the Users roster (server-side, not just the route guard)', async ({
    page
  }) => {
    // The half that matters for the gate: an authenticated caller who simply lacks `users.view`.
    // `page.request` carries the editor's real Better Auth session cookie.
    const res = await page.request.get(`${apiUrl}/api/users`, {
      headers: { origin: adminOrigin }
    })

    // 403 (authenticated, unauthorized), not 401 (no session) — the distinction is the whole
    // claim: a 401 would mean the storage state went stale and would say nothing about the role.
    expect(res.status(), 'editor GET /api/users').toBe(403)
    const body = (await res.json()) as Record<string, unknown>
    // The enumeration IS the leak, so assert the roster is absent, not merely that a status came
    // back (git-read-gate.spec.ts's pattern).
    expect(body).toEqual({ error: 'forbidden' })
    expect(body).not.toHaveProperty('users')
  })

  test('editor: is denied the Users screen in the admin UI too', async ({
    page
  }) => {
    // The UX half, mirroring auth-role-gate.spec.ts's author case. Both assertions here are
    // client-side React (`useCan` / `RequireCan`) and are NOT the security boundary — that is the
    // server test above. They are still worth pinning: an editor who saw a Users link would get a
    // broken screen and a 403, which is a real product defect even though it is not a leak.
    const dashboard = new DashboardPage(page)

    await page.goto('/dashboard')
    await expect(dashboard.heading).toBeVisible()

    await expect(page.getByRole('link', { name: 'Users' })).toBeHidden()

    await page.goto('/users')
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(dashboard.heading).toBeVisible()
  })
})
