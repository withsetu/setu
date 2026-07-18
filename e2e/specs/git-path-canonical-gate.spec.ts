import { test, expect, type APIRequestContext } from '@playwright/test'
import { storageStateFor } from '../lib/auth-state'
import { uniqueTitle } from '../lib/unique-title'
import { sandboxRepoFile } from '../lib/sandbox-git'

// #623 wrong-actor gate (CLAUDE.md card #5), proven against the REAL running api rather than a
// unit-level harness — the bug lived precisely in the seam between two layers that no single
// unit test crosses: the write gate in apps/api/src/app.ts derived a permission from the request
// path, while the git adapter's `safePath` (packages/git-local/src/adapter.ts) resolved that same
// string with `path.resolve`. The old gate normalized only ONE leading `./` or `/`, so every
// spelling the two layers disagreed about was an authz bypass: an AUTHOR (holds `content.edit`,
// NOT `content.publish` / `settings.manage` / `theme.manage`) could POST /git/commit with
// `content/../settings.json` — gated as ordinary content editing — and the adapter would write
// the admin-only `settings.json`.
//
// The fix REJECTS non-canonical paths (400) instead of normalizing them, so the gate's view and
// the adapter's write are the same path by construction. This spec pins all three halves of that
// contract: the wrong actor is BLOCKED and no write lands, and neither legitimate caller is
// over-blocked.
//
// The api's real cross-origin surface (admin :5175 -> api :4446) — same ports
// playwright.config.ts hardcodes for the whole run, matching users-rank.spec.ts.
const apiUrl = 'http://localhost:4446'
const adminOrigin = 'http://localhost:5175'

// No `editor-` prefix: chromium-only per playwright.config.ts's testMatch. This is an HTTP-level
// gate, not a contenteditable surface, so the webkit-editor lane would add nothing.

/** The exact bypass spellings #623 closed. The first five resolve to a repo-root admin-only file
 *  (`settings.json` / `theme-options.json`) that an author must never be able to write; the last
 *  two are the publish-gate half — a non-canonical CONTENT path made `parseContentPath` fail, so
 *  BOTH the `content.publish` check and the #382 committed-state upgrade were skipped while the
 *  adapter still wrote the real post. */
const BYPASS_PATHS = [
  'content/../settings.json',
  '././settings.json',
  'settings.json/',
  'content//../settings.json',
  './content/../theme-options.json',
  'content/blog/en/./post.mdoc',
  'content/./blog/en/post.mdoc'
] as const

/** Read a repo file through the api's own ungated `GET /git/file` (returns `{ content }`, null
 *  when absent) — the same view of the repo the gate is supposed to be protecting, so a write
 *  that slipped through would be visible here. */
async function readRepoFile(
  request: APIRequestContext,
  path: string
): Promise<string | null> {
  const res = await request.get(
    `${apiUrl}/git/file?path=${encodeURIComponent(path)}`
  )
  const { content } = (await res.json()) as { content: string | null }
  return content
}

test.describe('#623 non-canonical repo paths in the git write gate', () => {
  test.describe('wrong actor: an author cannot smuggle an admin-only write', () => {
    test.use({ storageState: storageStateFor('author') })

    test('author: every non-canonical path is rejected 400 and NO write lands', async ({
      page
    }) => {
      // A payload carrying a marker unique to THIS project's run — the proof-of-no-write below
      // keys off the marker rather than a before/after snapshot, which under `E2E_FULL_MATRIX`
      // (chromium + firefox-full + webkit-full against the ONE shared sandbox) would race with
      // another project's own legitimate admin write further down this file. Only a genuine
      // bypass by THIS test can ever put THIS marker into these files, so the marker assertion
      // is both stricter and immune to that interleaving (#551's rationale, applied to a
      // repo-root path).
      const marker = uniqueTitle('#623 bypass attempt')
      const payload = JSON.stringify({ setuE2eBypassMarker: marker }, null, 2)

      for (const path of BYPASS_PATHS) {
        // Explicit `origin`: better-auth's originCheckMiddleware requires a trusted Origin
        // whenever a cookie is present, and without it a cookie-bearing POST fails on
        // MISSING_OR_NULL_ORIGIN — which would prove the wrong thing (see users-rank.spec.ts).
        const res = await page.request.post(`${apiUrl}/git/commit`, {
          headers: { origin: adminOrigin },
          data: {
            path,
            content: payload,
            message: `#623 e2e bypass attempt: ${path}`,
            author: { name: 'E2E Author', email: 'author-e2e@setu.test' }
          }
        })

        // 400, not 403: a path the gate and the adapter would resolve differently is a malformed
        // request, not a permission question. Asserting the exact status (and the error text)
        // pins WHICH guard rejected it — a 403 here would mean the request reached permission
        // derivation, and a 500 would mean it reached the adapter.
        expect(
          res.status(),
          `expected 400 for non-canonical path: ${path}`
        ).toBe(400)
        expect((await res.json()) as unknown).toEqual({
          error: 'path must be canonical and repo-relative'
        })
      }

      // The point of the test: not merely that a status code came back, but that NO write landed.
      //
      // These read the WORKING TREE (`sandboxRepoFile`), NOT the api's `GET /git/file` — and that
      // distinction is the whole assertion. `commitFiles` writes the file to disk BEFORE
      // `git.add`, so a bypass whose commit later fails still leaves unauthorized bytes at the
      // resolved path. Measured against the pre-fix gate (guard disabled, this exact spec):
      // isomorphic-git's own `add` rejected all seven spellings with a 500, `/git/file` reported
      // `null` for every one of them — and `settings.json` + `theme-options.json` were sitting in
      // the sandbox working tree containing the author's payload. A HEAD-only assertion would
      // have called that a pass. This one does not.
      expect(sandboxRepoFile('settings.json') ?? '').not.toContain(marker)
      expect(sandboxRepoFile('theme-options.json') ?? '').not.toContain(marker)
      // Same for the two CONTENT bypasses (the publish-gate half): `content/blog/en/./post.mdoc`
      // and `content/./blog/en/post.mdoc` both resolve to this one real path.
      expect(sandboxRepoFile('content/blog/en/post.mdoc') ?? '').not.toContain(
        marker
      )
    })

    test('author: a canonical draft write is still ADMITTED (no over-blocking)', async ({
      page
    }) => {
      // The other half of card #5. Rejecting non-canonical paths must not cost the author the
      // writes they legitimately hold `content.edit` for — a regression here would break the
      // Save-draft journey for every author.
      const title = uniqueTitle('Canonical Draft')
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      // uniqueTitle-derived, so this path is only ever touched by this spec (#551) — never a
      // seeded post.
      const path = `content/post/en/${slug}.mdoc`
      // `published: false` keeps this at `content.edit`; a live post would derive
      // `content.publish`, which an author correctly does NOT hold.
      const content = `---\ntitle: ${title}\npublished: false\n---\n\nBody for ${title}.\n`

      const res = await page.request.post(`${apiUrl}/git/commit`, {
        headers: { origin: adminOrigin },
        data: {
          path,
          content,
          message: `#623 e2e canonical draft: ${slug}`,
          author: { name: 'E2E Author', email: 'author-e2e@setu.test' }
        }
      })

      expect(res.status()).toBe(200)
      expect((await res.json()) as { sha: string }).toHaveProperty('sha')
      // Proof the write actually landed in the repo, not just that a 200 came back.
      expect(await readRepoFile(page.request, path)).toBe(content)
    })
  })

  test.describe('right actor: an admin still writes admin-only files', () => {
    test.use({ storageState: storageStateFor('admin') })

    test('admin: a canonical settings.json write is still ADMITTED', async ({
      page
    }) => {
      // `settings.json` is the highest rung of the write ladder (`settings.manage`, admin only),
      // so a canonical write to it is the sharpest proof the #623 rejection did not over-block
      // the legitimate admin path.
      //
      // The content is deliberately `{}`. The e2e sandbox seeds `content/` ONLY — there is no
      // committed settings.json — and `parseSettings` (packages/core/src/settings/schema.ts)
      // fills every group from DEFAULT_SETTINGS for `{}` exactly as it does for `undefined`. So
      // this is a REAL settings.manage-gated write through the full gate + adapter, yet a
      // semantic no-op for the specs that share this sandbox and render the Settings screen
      // (a11y.spec.ts, and screens.visual.spec.ts's pixel baseline, whose MediaSettings reads
      // settings.json). Repeating it — another project in the full matrix, or a re-run — is
      // idempotent: commitFiles skips staging content already matching HEAD.
      const content = '{}\n'

      const res = await page.request.post(`${apiUrl}/git/commit`, {
        headers: { origin: adminOrigin },
        data: {
          path: 'settings.json',
          content,
          message: '#623 e2e canonical settings write',
          author: { name: 'E2E Admin', email: 'admin-e2e@setu.test' }
        }
      })

      // Not 400 (the path is canonical) and not 403 (an admin holds `settings.manage`).
      expect(res.status()).toBe(200)
      expect((await res.json()) as { sha: string }).toHaveProperty('sha')
      // The write really landed — an admin's canonical settings write is genuinely admitted,
      // not merely acknowledged.
      expect(await readRepoFile(page.request, 'settings.json')).toBe(content)
    })
  })
})
