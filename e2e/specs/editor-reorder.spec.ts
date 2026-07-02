import { test, expect } from '@playwright/test'
import { ContentListPage } from '../pages/ContentListPage'
import { uniqueTitle } from '../lib/unique-title'

// editor-* prefix: runs on chromium AND webkit-editor (see e2e/playwright.config.ts
// testMatch) — reorder is exactly where WebKit drag/selection quirks bite hardest.
// No webkit quarantine needed here: EditorPage.dragBlock drives DragHandle.tsx's own
// dragstart/dragover/drop listeners directly via a synthetic DataTransfer, rather than
// relying on the OS-level native drag Playwright's `locator.dragTo` needs — so it
// sidesteps WebKit's well-known native-drag-simulation flakiness entirely. Verified
// green on both chromium and webkit-editor, twice back-to-back (task-6-report.md).
test('reorder blocks via keyboard and drag, then verify order persists', async ({ page }) => {
  const title = uniqueTitle('reorder')
  const first = `First ${title}`
  const second = `Second ${title}`
  const third = `Third ${title}`

  const list = new ContentListPage(page)
  await list.gotoPosts()

  const editor = await list.createPost()
  await editor.setTitle(title)

  // Build 3 distinguishable top-level blocks. The editor starts with one empty
  // paragraph (Canvas.tsx's BLANK doc) — typing fills it, Enter starts the next.
  await editor.body.click()
  await editor.body.pressSequentially(first)
  await page.keyboard.press('Enter')
  await editor.body.pressSequentially(second)
  await page.keyboard.press('Enter')
  await editor.body.pressSequentially(third)

  await expect.poll(() => editor.blockTexts()).toEqual([first, second, third])

  // 1. KEYBOARD path: Alt-Shift-ArrowUp (BlockActions.ts's moveBlockUp) moves the
  // block containing the caret up one slot. Move "Third" up twice — First/Second/Third
  // -> First/Third/Second -> Third/First/Second — exercising a real multi-step
  // reorder, not just a single swap.
  await editor.moveBlockUpByKeyboard(third)
  await expect.poll(() => editor.blockTexts()).toEqual([first, third, second])

  await editor.moveBlockUpByKeyboard(third)
  await expect.poll(() => editor.blockTexts()).toEqual([third, first, second])

  // 2. DRAG path: drag "Third" (now at index 0) to drop AFTER "Second" via the real
  // grip handle, restoring First/Second/Third — round-tripping through both
  // affordances rather than only ever moving in one direction.
  await editor.dragBlock(third, second, 'after')
  await expect.poll(() => editor.blockTexts()).toEqual([first, second, third])

  // 3. Persistence: save, leave, reopen — order must survive the round-trip through
  // autosave + reload, not just live in memory.
  await editor.save()
  const listAfterSave = await editor.backToList()
  const reopened = await listAfterSave.openPost(title)

  await expect.poll(() => reopened.blockTexts()).toEqual([first, second, third])
})
