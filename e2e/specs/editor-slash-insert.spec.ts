import { test, expect } from '@playwright/test'
import { ContentListPage } from '../pages/ContentListPage'
import { uniqueTitle } from '../lib/unique-title'

// editor-* prefix: runs on chromium AND webkit-editor (see e2e/playwright.config.ts
// testMatch) — slash-menu + contenteditable is exactly where WebKit diverges.
test('open the slash menu, insert a block, and verify it renders and persists', async ({ page }) => {
  const title = uniqueTitle('slash-insert')
  const calloutText = `Callout body for ${title}.`

  const list = new ContentListPage(page)
  await list.gotoPosts()

  const editor = await list.createPost()
  await editor.setTitle(title)

  // a. Click into the body canvas, open the slash menu.
  await editor.openSlashMenu()

  // c. Filter to a real registry block ("Callout" — blocks/callout/block.ts, a
  // folder block with a dedicated editor node view) and select it via keyboard
  // (arrows + Enter) — see EditorPage.insertBlock.
  await editor.insertBlock('Callout')

  // d. The block appears in the canvas — Callout.tsx's shared core renders
  // `<aside aria-label="Callout block">`, used by both editor and site.
  await expect(editor.calloutBlock).toBeVisible()

  // Type into the callout's body so there's real persisted content to assert on.
  await editor.calloutBlock.locator('.callout-body').click()
  await page.keyboard.type(calloutText)

  // e. Save; reload the post; assert the block persisted.
  await editor.save()
  const listAfterSave = await editor.backToList()
  const reopened = await listAfterSave.openPost(title)

  await expect(reopened.calloutBlock).toBeVisible()
  await expect(reopened.calloutBlock).toContainText(calloutText)
})
