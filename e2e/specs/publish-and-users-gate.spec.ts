import { test, expect } from '@playwright/test'
import { storageStateFor } from '../lib/auth-state'
import { uniqueTitle } from '../lib/unique-title'
import { sandboxRepoFile } from '../lib/sandbox-git'

// #810 server-side wrong-actor coverage (CLAUDE.md card #5) for the two gates that were enforced
// correctly but proven only by CLIENT-side assertions:
//
//   1. `content.publish` — apps/api/src/app.ts derives the required write action from the change
//      set (`writeActionForChanges` -> `actionForChange` -> `publishesLiveContent`), so a commit
//      whose frontmatter is NOT `published: false` needs `content.publish`, which an author does
//      not hold. Before this spec, the only proof was `author-draft.spec.ts`'s
//      `expect(editor.publishButton).toBeHidden()` — a React render assertion that says nothing
//      about the API — and `git-path-canonical-gate.spec.ts`, which deliberately stays at
//      `published: false`.
//
//   2. `users.view` — apps/api/src/users.ts gates `GET /api/users`. Before this spec that route
//      was requested exactly once in the whole suite (users-rank.spec.ts), by a maintainer who
//      HOLDS the capability. `auth-role-gate.spec.ts` covers the author case only through
//      `useCan`/`RequireCan`, which are UX (§1, §4 #13) — a caller who never loads the SPA is
//      unaffected by either.
//
// Both halves of card #5 are here: the wrong actor is BLOCKED (and nothing lands / nothing leaks),
// and the right actor is ADMITTED (and the write really lands), so a gate that over-blocks fails
// too.
//
// ## Kill-shot (CLAUDE.md §3.3 #4) — recorded 2026-07-21, chromium
//
// A security test only ever fires on the attack path, so a broken one is silent forever and reads
// as coverage. Both gates below were disabled in product code, the spec proven RED, and the
// product code then restored and the spec re-run green.
//
//   (a) Publish gate — apps/api/src/app.ts's `publishesLiveContent` forced to `return false`, so
//       every commit reads as a draft and nothing ever derives `content.publish`:
//         ✘ author: publishing live content is REJECTED 403 and NO write lands
//           Error: expected 403 for an author POSTing published content
//           Expected: 403 / Received: 200
//         1 failed, 7 passed
//       "admin: … is ADMITTED" stayed green throughout — correct, and the point of keeping it:
//       it is the over-blocking control, unaffected by a gate that under-blocks.
//
//   (b) Same sabotage, with the status assertion temporarily softened so execution reached the
//       working-tree read — this is the assertion that actually matters, and it fired:
//         ✘ Error: content/post/en/chromium-810-author-publish-attempt-t4juxx.mdoc must not
//           exist — the author's publish was refused
//           Expected: null
//           Received: "---\ntitle: …\npublished: true\n---\n\nBody for ….\n"
//       So the unauthorized bytes really do land on disk when the gate is off, and this spec sees
//       them. A `GET /git/file` check would have reported the file as absent (it resolves at HEAD)
//       and called that a pass — the #623 failure mode, reproduced and avoided.
//
//   (c) users.view gate — apps/api/src/users.ts's
//       `if (!authz.can(c.get('actor'), 'users.view')) return c.json({ error: 'forbidden' }, 403)`
//       removed from `GET /api/users`:
//         ✘ author: GET /api/users is REJECTED and leaks no roster
//           Error: author GET /api/users
//           Expected: 403 / Received: 200
//         (auth-editor-rung.spec.ts's editor twin went red in the same run.)
//
// Full verbatim output is in the PR body.
//
// The api's real cross-origin surface (admin :5175 -> api :4446) — the ports playwright.config.ts
// hardcodes for the whole run, matching git-path-canonical-gate.spec.ts and users-rank.spec.ts.
const apiUrl = 'http://localhost:4446'
const adminOrigin = 'http://localhost:5175'

// No `editor-` prefix: chromium-only per playwright.config.ts's testMatch. These are HTTP-level
// gates, not contenteditable surfaces, so the webkit-editor lane would add nothing.

/** Frontmatter with NO `published: false` — which is exactly what makes it LIVE under Setu's
 *  publish semantics ("committed + `published !== false`", CLAUDE.md §1; there is no
 *  `status: draft` concept). `actionForChange` therefore derives `content.publish` for it. */
function livePost(title: string): string {
  return `---\ntitle: ${title}\npublished: true\n---\n\nBody for ${title}.\n`
}

/** `content/<collection>/<locale>/<slug>.mdoc`, the layout `contentPath()` derives — built from a
 *  `uniqueTitle`-minted slug, so this path is only ever touched by this spec's own run (#551) and
 *  never a seeded post. */
function entryPathFor(title: string): { slug: string; path: string } {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return { slug, path: `content/post/en/${slug}.mdoc` }
}

test.describe('#810 the content.publish write gate is enforced server-side', () => {
  test.describe('wrong actor: an author cannot publish through the raw API', () => {
    test.use({ storageState: storageStateFor('author') })

    test('author: publishing live content is REJECTED 403 and NO write lands', async ({
      page
    }) => {
      const title = uniqueTitle('#810 author publish attempt')
      const { path } = entryPathFor(title)
      const content = livePost(title)

      // Explicit `origin`: better-auth's originCheckMiddleware requires a trusted Origin whenever
      // a cookie is present, and without it a cookie-bearing POST 403s on MISSING_OR_NULL_ORIGIN
      // regardless of role — a 403 that would prove the wrong thing entirely (users-rank.spec.ts
      // verified this against the installed better-auth 1.6.23 source).
      const res = await page.request.post(`${apiUrl}/git/commit`, {
        headers: { origin: adminOrigin },
        data: {
          path,
          content,
          message: `#810 e2e author publish attempt: ${title}`,
          author: { name: 'E2E Author', email: 'author-e2e@setu.test' }
        }
      })

      // 403, not 400: the path is canonical, so the request reaches permission derivation and is
      // rejected there. Pinning the exact status + body distinguishes "the publish gate said no"
      // from a 400 (#623's canonical-path guard fired first, before any permission was derived)
      // or a 401 (the author's session expired and this proves nothing about roles).
      expect(
        res.status(),
        'expected 403 for an author POSTing published content'
      ).toBe(403)
      expect((await res.json()) as unknown).toEqual({ error: 'forbidden' })

      // THE POINT OF THE TEST: not that a status came back, but that no write landed.
      //
      // This reads the WORKING TREE (`sandboxRepoFile`), NOT the api's `GET /git/file`. That
      // distinction is the whole assertion: `commitFiles` writes the file to disk BEFORE
      // `git.add`, so a bypass whose commit later fails still leaves the unauthorized bytes on
      // disk — invisible to a HEAD-resolving read, visible here. #623 shipped green precisely
      // because it checked HEAD; git-path-canonical-gate.spec.ts:114-118 documents the measured
      // case. Asserting `null` (absent, not merely empty) is available here because the slug is
      // uniqueTitle-minted: nothing else in any project or re-run can create this path.
      expect(
        sandboxRepoFile(path),
        `${path} must not exist — the author's publish was refused`
      ).toBe(null)
    })
  })

  test.describe('right actor: an admin publishing the same shape is admitted', () => {
    test.use({ storageState: storageStateFor('admin') })

    test('admin: publishing live content is ADMITTED 200 and the write DOES land', async ({
      page
    }) => {
      // The over-blocking twin (card #5's second half). Without it, a gate that rejected EVERY
      // publish — from every role, breaking the product's core journey — would still leave the
      // wrong-actor test above green. The payload is the identical live-post shape; only the
      // session differs, so the two tests isolate the role as the single variable.
      const title = uniqueTitle('#810 admin publish')
      const { path } = entryPathFor(title)
      const content = livePost(title)

      const res = await page.request.post(`${apiUrl}/git/commit`, {
        headers: { origin: adminOrigin },
        data: {
          path,
          content,
          message: `#810 e2e admin publish: ${title}`,
          author: { name: 'E2E Admin', email: 'admin-e2e@setu.test' }
        }
      })

      expect(res.status(), 'expected 200 for an admin publishing').toBe(200)
      expect((await res.json()) as { sha: string }).toHaveProperty('sha')
      // Read through the SAME working-tree seam as the blocked case, so "landed" and "did not
      // land" are the same measurement in both directions rather than two different questions.
      expect(sandboxRepoFile(path)).toBe(content)
    })
  })
})

test.describe('#810 the users.view read gate is enforced server-side', () => {
  test.describe('wrong actor: an author cannot read the roster', () => {
    test.use({ storageState: storageStateFor('author') })

    test('author: GET /api/users is REJECTED and leaks no roster', async ({
      page
    }) => {
      // `page.request` carries the author's real Better Auth session cookie — this is an
      // AUTHENTICATED caller who simply lacks `users.view`, which is the case `RequireCan` can
      // never speak to. `origin` for the same MISSING_OR_NULL_ORIGIN reason as above (harmless on
      // a GET, but kept identical across this file so no call site depends on the distinction).
      const res = await page.request.get(`${apiUrl}/api/users`, {
        headers: { origin: adminOrigin }
      })

      // 403 (authenticated, unauthorized), not 401 (no session) — pinning which of the two fired
      // is the difference between "the role matrix denied them" and "the storage state went
      // stale", and only the first is what this test claims.
      expect(res.status(), 'author GET /api/users').toBe(403)

      const body = (await res.json()) as Record<string, unknown>
      // The ENUMERATION is the leak, so assert the roster itself is absent — not just the status
      // (git-read-gate.spec.ts's pattern). A body carrying `users` alongside a 403 would still be
      // a full disclosure of every account's email, role and ban state.
      expect(body).toEqual({ error: 'forbidden' })
      expect(body).not.toHaveProperty('users')
    })
  })
})
