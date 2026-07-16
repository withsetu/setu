import { test, expect } from '@playwright/test'
import { ContentListPage } from '../pages/ContentListPage'
import { EditorPage } from '../pages/EditorPage'
import { uniqueTitle } from '../lib/unique-title'
import { storageStateFor } from '../lib/auth-state'
import { sandboxHeadSubject } from '../lib/sandbox-git'

// #466 revision history: the one load-bearing journey (list → diff → restore)
// plus the card-#5 wrong-actor half in the same test via a second browser
// context (the author-draft.spec.ts pattern — no inter-test ordering). The
// server gate (restore derives its permission through writeActionForChanges;
// author → 403 on a live post) is already unit-tested in apps/api — this spec
// proves the UI surfaces that denial honestly (disabled restore + visible
// reason), not that it hides the panel.
//
// No `editor-` prefix: chromium-only per e2e/playwright.config.ts testMatch —
// button/sheet/toast flow, same reasoning as publish.spec.ts.
test('publish twice, inspect the diff, restore the older revision; author sees an honest non-restorable panel', async ({
  page,
  browser
}) => {
  // Two publishes + a restore + a cold-IndexedDB author context: give the
  // whole journey the same generous ceiling author-draft.spec.ts uses.
  test.setTimeout(90_000)

  const title = uniqueTitle('History')
  const list = new ContentListPage(page)
  await list.gotoPosts()

  // Revision 1: create, autosave (mints the slug), publish.
  const editor = await list.createPost()
  await editor.setTitle(title)
  await editor.typeInBody('First version body.')
  await editor.save()
  const slugMatch = /\/edit\/post\/en\/([^/?#]+)/.exec(page.url())
  if (!slugMatch)
    throw new Error(`expected a minted slug in the URL, got: ${page.url()}`)
  const slug = slugMatch[1]
  await editor.publish()
  // The Published toast auto-dismisses in 4s; wait it out so the SECOND
  // publish's toast assertion can't latch onto this one.
  await expect(editor.publishedToast).toBeHidden()

  // Revision 2: change the title (a frontmatter diff) and extend the body
  // (a word-level prose diff), then publish again.
  await editor.setTitle(`${title} v2`)
  await editor.clickBlock('First version')
  await page.keyboard.press('End')
  await page.keyboard.type(' Second version extra words.')
  await editor.publish()

  // History: both revisions listed, newest first, HEAD labeled Current (the
  // buffer equals the just-published HEAD, so there is no unsaved row).
  await editor.openHistory()
  await expect(editor.revisionRows).toHaveCount(2)
  await expect(editor.revisionRows.first()).toContainText('Current')
  await expect(editor.revisionRows.first()).toContainText('E2E Admin')
  await expect(
    editor.historyPanel.getByText('Your unsaved changes')
  ).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(editor.historyPanel).toBeHidden()

  // Owner-UAT defect (#466): type WITHOUT committing, reopen History — the
  // live buffer must appear as a pinned synthetic row, HEAD demotes from
  // "Current" to "Last commit", and diffs baseline on what the user sees.
  await editor.clickBlock('First version')
  await page.keyboard.press('End')
  await page.keyboard.type(' Third uncommitted words.')
  await editor.openHistory()
  await expect(editor.revisionRows).toHaveCount(3)
  await expect(editor.revisionRows.first()).toContainText(
    'Your unsaved changes'
  )
  await expect(editor.revisionRows.nth(1)).toContainText('Last commit')

  // Select the older revision (the panel preselects it too — click to be
  // explicit) and read the diff: the title field row shows old → new, and the
  // body words the LIVE BUFFER gained render as additions — including the
  // uncommitted keystrokes a HEAD-based diff used to hide.
  await editor.revisionRows.last().click()
  await expect(editor.historyChanges).toContainText('title')
  await expect(editor.historyChanges).toContainText(`${title} v2`)
  await expect(editor.historyChanges).toContainText('Second version extra')
  await expect(editor.historyChanges).toContainText('Third uncommitted words.')

  // Restore behind the confirm dialog ("new commit, never rewritten") — which
  // now also warns that the unsaved buffer is about to be discarded.
  await expect(editor.restoreRevisionButton).toBeEnabled()
  await editor.restoreRevisionButton.click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText(/never rewritten/)
  await expect(confirm).toContainText('This discards your unsaved changes.')
  await confirm.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(editor.restoredToast).toBeVisible()

  // The editor reloads the restored content in place: title and body revert,
  // and the discard the user just consented to actually happened.
  await expect(editor.titleInput).toHaveValue(title, { timeout: 15_000 })
  await expect(editor.body).toContainText('First version body.')
  await expect(editor.body).not.toContainText('Second version')
  await expect(editor.body).not.toContainText('Third uncommitted')

  // Sanctioned exception (see e2e/lib/sandbox-git.ts): restore must be a NEW
  // commit — history-api.ts's `Restore <path> to <sha7>` subject at HEAD, no
  // rewrite.
  expect(sandboxHeadSubject()).toMatch(
    new RegExp(`^Restore content/post/en/${slug}\\.mdoc to [0-9a-f]{7}$`)
  )

  // Wrong-actor half (card #5): an author on this now-live post gets the
  // panel (history is content.view-grade) but no usable Restore — the button
  // renders disabled with the role reason, the honest UI for the server's 403.
  const authorContext = await browser.newContext({
    storageState: storageStateFor('author')
  })
  try {
    const authorPage = await authorContext.newPage()
    await authorPage.goto(`/edit/post/en/${slug}`)
    const authorEditor = new EditorPage(authorPage)
    // Fresh context = cold IndexedDB + content-index; the generous timeout is
    // the author-draft.spec.ts precedent.
    await expect(authorEditor.viewOnlyBanner).toBeVisible({ timeout: 20_000 })
    await authorEditor.openHistory()
    await expect(authorEditor.revisionRows.first()).toBeVisible()
    expect(await authorEditor.revisionRows.count()).toBeGreaterThanOrEqual(2)
    // An older revision is preselected; restore is disabled with the reason.
    await expect(authorEditor.restoreRevisionButton).toBeDisabled()
    await expect(
      authorEditor.historyPanel.getByText(
        "Your role can't change published posts"
      )
    ).toBeVisible()
  } finally {
    await authorContext.close()
  }
})
