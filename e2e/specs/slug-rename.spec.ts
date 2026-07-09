import { test, expect } from '@playwright/test'
import { ContentListPage } from '../pages/ContentListPage'
import { uniqueTitle } from '../lib/unique-title'

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

  // Rename in the meta panel: clear the slug, type the new one, apply with Enter.
  const slugInput = page.getByRole('textbox', { name: 'Slug' })
  await slugInput.fill(newSlug)
  await slugInput.press('Enter')

  // The success toast is explicit that the redirect waits for the next rebuild
  // (saved ≠ live). Assert it right away — notifications auto-dismiss after 4s.
  await expect(
    page
      .getByRole('region', { name: 'Notifications', exact: true })
      .getByText(/^Slug renamed — the old URL will 301/)
  ).toBeVisible()

  // The editor followed the entry to its new identity: URL and header breadcrumb.
  await expect(page).toHaveURL(new RegExp(`/edit/post/en/${newSlug}$`))
  await expect(page.getByText(`post / ${newSlug}`)).toBeVisible()

  // And the slug field itself re-synced to the applied value.
  await expect(slugInput).toHaveValue(newSlug)
})
