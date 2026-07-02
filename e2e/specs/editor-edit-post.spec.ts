import { test, expect } from '@playwright/test'
import { ContentListPage } from '../pages/ContentListPage'
import { uniqueTitle } from '../lib/unique-title'

test('create a post, edit it, save, and verify persistence through the UI', async ({ page }) => {
  const title = uniqueTitle('edit-post')
  const body = `Body text for ${title}.`

  const list = new ContentListPage(page)
  await list.gotoPosts()

  const editor = await list.createPost()
  await editor.setTitle(title)
  await editor.typeInBody(body)
  await editor.save()

  // Persistence through the UI: back to the list, the new title is there.
  const listAfterSave = await editor.backToList()
  await listAfterSave.expectListed(title)

  // Reopen and confirm title + body survived the round-trip.
  const reopened = await listAfterSave.openPost(title)
  await expect(reopened.titleInput).toHaveValue(title)
  await expect(reopened.body).toContainText(body)
})
