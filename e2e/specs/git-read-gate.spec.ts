import { test, expect } from '@playwright/test'
import { storageStateFor } from '../lib/auth-state'

// #621 wrong-actor gate (CLAUDE.md card #5), proven against the REAL running api rather than the
// unit harness — the hole lived in a seam no unit test crossed: `createGitApi`'s read routes had no
// `authMiddleware`, AND `originGuard` (apps/api/src/auth/origin-guard.ts) short-circuits on
// SAFE_METHODS, so nothing else in the request pipeline stopped an anonymous GET. Any caller who
// could reach the api could enumerate the whole content repo — unpublished drafts, `settings.json`
// — with no session at all.
//
// This spec pins all three halves of the fix:
//   1. UNAUTHENTICATED is blocked (401) on `/git/file` and `/git/list`, and reads NOTHING.
//   2. An authenticated AUTHOR — the LOWEST role — is still admitted (`content.view` is in the
//      shared VIEW set, so gating cost no role anything).
//   3. `/git/head` still answers unauthenticated: `seedIfEmpty` (apps/admin/src/data/store.tsx)
//      calls it before a session exists, and playwright.config.ts's own api health check polls it.
//
// The api's real cross-origin surface (admin :5175 -> api :4446) — the ports playwright.config.ts
// hardcodes for the whole run, matching git-path-canonical-gate.spec.ts.
const apiUrl = 'http://localhost:4446'

// No `editor-` prefix: chromium-only per playwright.config.ts's testMatch. This is an HTTP-level
// gate, not a contenteditable surface, so the webkit-editor lane would add nothing.

/** A path that certainly exists in the seeded sandbox repo, so a 200 here is a REAL read of real
 *  repo bytes — not a "file not found" that could be mistaken for a blocked request. Deliberately
 *  the UNPUBLISHED fixture: it is exactly the class of content the old hole exposed to the public
 *  internet, and it is read-only for every spec (never edited — CLAUDE.md §5 e2e rules). */
const KNOWN_PATH = 'content/post/en/unpublished-demo.mdoc'

test.describe('#621 git read routes require a session', () => {
  test.describe('wrong actor: an UNAUTHENTICATED caller reads nothing', () => {
    // Explicitly no session: the default project storageState is the admin's, so this must be
    // cleared or the "unauthenticated" caller would silently be an admin — the exact way a spec in
    // this area can pass against vulnerable code.
    test.use({ storageState: { cookies: [], origins: [] } })

    test('unauthenticated: /git/file is 401 and returns no repo content', async ({
      request
    }) => {
      const res = await request.get(
        `${apiUrl}/git/file?path=${encodeURIComponent(KNOWN_PATH)}`
      )
      expect(res.status(), 'GET /git/file without a session').toBe(401)
      const body = (await res.json()) as Record<string, unknown>
      // Not merely a status: the response must carry no file bytes at all.
      expect(body).toEqual({ error: 'unauthenticated' })
      expect(body).not.toHaveProperty('content')
    })

    test('unauthenticated: /git/list is 401 and enumerates nothing', async ({
      request
    }) => {
      const res = await request.get(`${apiUrl}/git/list?prefix=content/`)
      expect(res.status(), 'GET /git/list without a session').toBe(401)
      const body = (await res.json()) as Record<string, unknown>
      // The enumeration itself is the leak — assert no `paths` key survives, not just the status.
      expect(body).toEqual({ error: 'unauthenticated' })
      expect(body).not.toHaveProperty('paths')
    })

    test('unauthenticated: /git/head still answers 200 (the bootstrap carve-out)', async ({
      request
    }) => {
      // Deliberately NOT gated — `seedIfEmpty` reads it pre-session, and gating it hung the whole
      // admin on "Loading…" in live UAT under #362. The response must stay content-free: a sha (or
      // null) and nothing else, which is what makes leaving it open acceptable.
      const res = await request.get(`${apiUrl}/git/head`)
      expect(res.status()).toBe(200)
      expect(Object.keys((await res.json()) as object)).toEqual(['sha'])
    })
  })

  test.describe('right actor: the LOWEST role is still admitted', () => {
    test.use({ storageState: storageStateFor('author') })

    test('author: /git/file and /git/list are ADMITTED and really read the repo', async ({
      page
    }) => {
      // `page.request` carries the author's real Better Auth session cookie. If gating had cost a
      // role its reads, the admin would break for that role on every draft load — this is the
      // over-blocking half of card #5.
      const fileRes = await page.request.get(
        `${apiUrl}/git/file?path=${encodeURIComponent(KNOWN_PATH)}`
      )
      expect(fileRes.status(), `author GET /git/file ${KNOWN_PATH}`).toBe(200)
      const { content } = (await fileRes.json()) as { content: string | null }
      // Proof of a genuine read, not just a 200 envelope over a null.
      expect(
        content,
        `${KNOWN_PATH} should exist in the seeded sandbox`
      ).not.toBe(null)

      const listRes = await page.request.get(
        `${apiUrl}/git/list?prefix=content/`
      )
      expect(listRes.status(), 'author GET /git/list').toBe(200)
      const { paths } = (await listRes.json()) as { paths: string[] }
      expect(paths).toContain(KNOWN_PATH)
    })
  })
})
