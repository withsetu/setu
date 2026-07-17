import { test, expect } from '@playwright/test'
import { ContentListPage } from '../pages/ContentListPage'
import { uniqueTitle } from '../lib/unique-title'
import { storageStateFor } from '../lib/auth-state'
import {
  sandboxContentFile,
  sandboxLastCommitFor,
  sandboxStatusPorcelain
} from '../lib/sandbox-git'

// #382 WordPress-Contributor journeys: an author can create content and Save draft
// (committed to Git as `published: false`, shared with the team, never live) but can
// only view — never alter — an already-live post. Both halves of the wrong-actor gate
// (CLAUDE.md card #5) are proven here: the right actor (author, on their own draft) is
// admitted, and the wrong actor (author, on someone else's live post) is blocked, with
// the server-enforced rule (`viewOnly` in EditorScreen.tsx) surfaced honestly in the UI.
//
// No `editor-` prefix: chromium-only per e2e/playwright.config.ts testMatch — same
// reasoning as publish.spec.ts (button/toast/banner flow, not a contenteditable-input
// surface that needs the webkit-editor lane).
test.describe('author saves drafts, cannot touch live posts', () => {
  test.use({ storageState: storageStateFor('author') })
  // Serial, not parallel: both tests hit the ONE shared sandbox git repo through the
  // ONE api process, and running them in fullyParallel's default 2-worker mode was
  // observed to make the content-index rebuilds below noticeably less predictable. Same
  // pattern already used for this reason in auth.setup.ts. The longer describe-level
  // timeout (see the cross-context wait below for why) still fails an actually-broken
  // flow — it just gives a genuinely-slow-but-correct one enough room.
  test.describe.configure({ mode: 'serial', timeout: 45_000 })

  test('author: create → Save draft → committed as published:false with real identity, visible to admin', async ({
    page,
    browser
  }) => {
    const title = uniqueTitle('Author Draft')
    const body = `Body text for ${title}.`

    const list = new ContentListPage(page)
    await list.gotoPosts()

    const editor = await list.createPost()
    await editor.setTitle(title)
    await editor.typeInBody(body)
    await editor.save()

    // Autosave mints the real slug and swaps the URL — read it back rather than
    // re-deriving the slugify transform (same approach as publish.spec.ts).
    const slugMatch = /\/edit\/post\/en\/([^/?#]+)/.exec(page.url())
    const slug = slugMatch?.[1]
    if (!slug)
      throw new Error(`expected a minted slug in the URL, got: ${page.url()}`)

    await editor.saveDraft()

    // Sanctioned exception (see e2e/lib/sandbox-git.ts): this journey is *about* the
    // commit landing in the content repo with the right shape and the right author —
    // asserted path-scoped to THIS entry, never HEAD, because parallel workers'
    // commits race past HEAD reads (#551). onSaveDraft's commit message default
    // (EditorScreen.tsx): `Save draft <collection>/<locale>/<slug>`.
    const commit = sandboxLastCommitFor('post', 'en', slug)
    expect(commit.subject).toBe(`Save draft post/en/${slug}`)
    // Task 2 proof: the commit author is the real SESSION user (seeded e2e author),
    // not the local-dev `OWNER_AUTHOR` fallback or a generic service identity.
    expect(commit.author).toBe('E2E Author <author-e2e@setu.test>')
    // Draft proof: the committed file itself carries `published: false`.
    expect(sandboxContentFile('post', 'en', slug)).toMatch(/published: false/)
    expect(sandboxStatusPorcelain('post', 'en', slug)).toBe('')

    // Cross-role visibility: drafts are Git-shared, not per-author-hidden. Verify via a
    // second browser context signed in as admin — no inter-test ordering dependency
    // (the structural choice from the task brief), same browser instance as this test.
    const adminContext = await browser.newContext({
      storageState: storageStateFor('admin')
    })
    try {
      const adminPage = await adminContext.newPage()
      const adminList = new ContentListPage(adminPage)
      await adminList.gotoPosts()
      // A brand-new browser context means brand-new (empty) IndexedDB (Bootstrap.tsx
      // opens 3 IDB databases — drafts, content index, media index — sequentially before
      // services are ready), plus a cold content-index `rebuild()`: a full
      // `git.list('content/')` walk with one `git/file` HTTP round trip per entry
      // (index-service.ts). The generous timeout covers that genuine rebuild latency —
      // this codebase's own multi-worktree dev-server load made it visibly variable, up
      // to several seconds — and an explicit timeout (not a fixed sleep) is the right
      // tool for this one genuinely-cold path; every other list-visibility check in this
      // file runs against an already-warmed default context and needs no such margin.
      // NOTE: the permanently-empty variant of this failure WAS a real logic bug — a
      // races-on-rebuild in createIndexService (a concurrent rebuild's clear() landing
      // between another build's upsertMany() and the first query), fixed in core for
      // #483 with concurrent-ensureBuilt coalescing + writer serialization.
      await expect(adminList.rowLink(title)).toBeVisible({ timeout: 20_000 })
    } finally {
      await adminContext.close()
    }
  })

  test('author: live post is view-only (wrong-actor gate)', async ({
    page
  }) => {
    // "Featured Demo" is a seeded post with no `published: false` — i.e. already live —
    // opened for viewing ONLY, never edited (never edit seeded posts: chromium and
    // webkit-editor share one sandbox).
    const list = new ContentListPage(page)
    await list.gotoPosts()
    // Same cold content-index rebuild cost as the cross-context wait above (every fresh
    // test context starts with empty IndexedDB) — wait for the row explicitly before
    // clicking rather than relying on `openPost`'s bare `.click()`'s default 5s action
    // timeout, which this repo's multi-worktree dev-server load has shown to be tight.
    await expect(list.rowLink('Featured Demo')).toBeVisible({ timeout: 20_000 })
    const editor = await list.openPost('Featured Demo')

    await expect(editor.viewOnlyBanner).toBeVisible()
    // PublishMenu renders nothing at all (not just disabled buttons) once
    // canSaveDraft/canPublish/canUnpublish are all false for this actor+entry pair.
    await expect(editor.publishButton).toBeHidden()
    await expect(editor.saveDraftButton).toBeHidden()
    await expect(editor.titleInput).toBeDisabled()
  })
})
