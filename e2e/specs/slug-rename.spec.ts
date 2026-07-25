import { test, expect } from '@playwright/test'
import { ContentListPage } from '../pages/ContentListPage'
import { uniqueTitle } from '../lib/unique-title'
import { watchNotifications } from '../lib/notifications'

// No `editor-` prefix: chromium-only per e2e/playwright.config.ts testMatch — renaming a
// slug is an input/button/toast flow in the meta panel, not a contenteditable surface.
test('rename a published post’s slug from the editor meta panel', async ({
  page
}) => {
  const title = uniqueTitle('slug-rename')
  // Unique target slug (chromium + webkit share one sandbox): reuse the title's
  // random token so no other project/run can mint the same identity.
  const newSlug = `renamed-${title.split(' ').pop()}`

  const list = new ContentListPage(page)
  await list.gotoPosts()

  // Create + autosave to mint a real slug (the URL leaves /new), then publish so
  // the rename exercises the committed path (move commit + redirect messaging).
  const editor = await list.createPost()
  await editor.setTitle(title)
  await editor.typeInBody(`Body text for ${title}.`)
  await editor.save()
  await expect(page).not.toHaveURL(/\/edit\/post\/en\/new$/)
  await editor.publish()

  // Start recording notifications BEFORE the action that produces one (#636). The toast
  // below auto-dismisses after 4s and `followRename` awaits the move commit plus both
  // identities' reindex before pushing it, so a live-locator wait is a bet on looking while
  // it happens to be on screen — a bet CI lost repeatedly on runs where the rename itself
  // had plainly succeeded. The recorder turns "is it visible right now" into "did it happen".
  const notifications = await watchNotifications(page)

  // Rename in the meta panel: clear the slug, type the new one, apply with Enter.
  const slugInput = page.getByRole('textbox', { name: 'Slug' })
  await slugInput.fill(newSlug)
  await slugInput.press('Enter')

  // Durable outcomes first — the editor followed the entry to its new identity (URL, header
  // breadcrumb) and the field re-synced. These are states, not events: they can be waited on
  // for as long as a loaded runner needs without any chance of arriving-then-vanishing.
  await expect(page).toHaveURL(new RegExp(`/edit/post/en/${newSlug}$`), {
    timeout: 30_000
  })
  await expect(page.getByText(`post / ${newSlug}`)).toBeVisible()
  await expect(slugInput).toHaveValue(newSlug)

  // And the success toast really was shown, with the wording that keeps saved ≠ live honest:
  // the 301 only takes effect on the next rebuild.
  await notifications.expectMatching(/^Slug renamed — the old URL will 301/)
})
