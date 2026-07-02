import { test, expect } from '@playwright/test'
import { ContentListPage } from '../pages/ContentListPage'

// Concurrency-safety: chromium and webkit-editor run this spec in parallel
// against ONE shared sandbox, and the admin has pessimistic post-locking. A
// title embedding the project name + a random token means the two projects
// (and any re-run within the same sandbox) never mint the same slug.
function uniqueTitle() {
  const token = Math.random().toString(36).slice(2, 8)
  return `${test.info().project.name} edit-post ${token}`
}

test('create a post, edit it, save, and verify persistence through the UI', async ({ page }) => {
  const title = uniqueTitle()
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
