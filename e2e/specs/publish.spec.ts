import { test, expect } from '@playwright/test'
import { ContentListPage } from '../pages/ContentListPage'
import { DashboardPage } from '../pages/DashboardPage'
import { uniqueTitle } from '../lib/unique-title'
import { sandboxHeadSubject, sandboxStatusPorcelain } from '../lib/sandbox-git'

// No `editor-` prefix: chromium-only per e2e/playwright.config.ts testMatch — publishing
// is a button/toast/badge flow, not a contenteditable surface, so it doesn't need the
// webkit-editor lane reserved for editor input quirks.
test('create a post, publish it, and verify the commit + the saved-not-live surface', async ({ page }) => {
  const title = uniqueTitle('publish')
  const body = `Body text for ${title}.`

  const list = new ContentListPage(page)
  await list.gotoPosts()

  // a. Create a post with title + body, autosave to mint a real slug (existing
  // page-object methods, same as editor-edit-post.spec.ts).
  const editor = await list.createPost()
  await editor.setTitle(title)
  await editor.typeInBody(body)
  await editor.save()

  // Autosave mints a slug from the title (new-entry.ts slugify) and replaces the URL
  // from `/edit/post/en/new` to `/edit/post/en/<slug>` — read it back rather than
  // re-deriving the slugify transform here, so this test can't drift from that logic.
  const slugMatch = /\/edit\/post\/en\/([^/?#]+)/.exec(page.url())
  if (!slugMatch) throw new Error(`expected a minted slug in the URL, got: ${page.url()}`)
  const slug = slugMatch[1]

  // b. Invoke the real publish affordance — PublishMenu's primary "Publish" button
  // (EditorScreen.tsx), which saves-then-commits (publish.publish) and shows a toast.
  await editor.publish()

  // c. Post-publish UI state: the editor header's lifecycle badge (StripStatus) flips
  // from "Draft" to "Staged" — deriveLifecycle's state for "committed to Git, never
  // deployed" (packages/core/src/lifecycle/derive.ts).
  await expect(editor.stagedStatus).toBeVisible()

  // d. Saved≠live honesty surface. FINDING (see task-4-report.md): the editor header's
  // own "view on live site" external-link button is NOT a trustworthy signal here — its
  // enabled/disabled toggle is keyed on `lifecycle.state === 'staged' || 'live'`, so it
  // flips to the enabled "View this page on the live site" label on this very publish,
  // even though nothing has been deployed (the e2e harness never boots the site on
  // :4321). The dashboard's SiteDeployCard is the surface that stays honest: `deploySha`
  // only advances when something calls `useDeploy().deploy()`, which nothing in the app
  // currently wires up to a button — so it reads "Not deployed yet" before AND after this
  // publish. Assert that gap explicitly.
  const dashboard = new DashboardPage(page)
  await dashboard.goto()
  await expect(dashboard.notDeployedYetText).toBeVisible()

  // e. Verify the commit really happened, through the UI first: back on the content
  // list, the row's status badge is "Staged", not "Draft" — i.e. it no longer shows as
  // an unpublished draft.
  await list.gotoPosts()
  await expect(list.rowStatus(title)).toHaveText('Staged')

  // Sanctioned exception (see e2e/lib/sandbox-git.ts): this journey is *about* the
  // commit landing in the content repo, so assert the sandbox's real git state directly.
  // publish-service.ts defaults the commit message to `Publish <collection>/<locale>/<slug>`.
  expect(sandboxHeadSubject()).toBe(`Publish post/en/${slug}`)
  expect(sandboxStatusPorcelain()).toBe('')
})
