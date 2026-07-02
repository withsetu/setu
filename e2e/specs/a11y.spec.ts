import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { DashboardPage } from '../pages/DashboardPage'
import { ContentListPage } from '../pages/ContentListPage'
import { SettingsPage } from '../pages/SettingsPage'
import { uniqueTitle } from '../lib/unique-title'
import { classifyViolations, formatUnexpectedViolations, formatKnownViolations } from '../lib/a11y-allowlist'

// No `editor-` prefix: chromium-only per e2e/playwright.config.ts testMatch — axe results
// are DOM-semantic (the accessibility tree axe-core builds from computed ARIA/role/name),
// not rendering-engine-specific, so a second WebKit pass would re-check the same DOM
// semantics for no signal. Verified with `--list` that these run in chromium only (see
// task-1-report.md).
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** Run an axe scan of the current page, classify violations against the allowlist, log
 *  the known ones to the console (product-gap visibility even when they don't fail), and
 *  fail with a readable dump if anything new/unallowlisted was found. Scope: full page,
 *  nothing globally disabled, per the brief. */
async function scanAndAssert(page: import('@playwright/test').Page, surface: string) {
  const results = await new AxeBuilder({ page })
    .withTags(TAGS)
    // `.dev-reset` (main.tsx's "Reset to sample content" button) only exists because
    // this harness runs against `vite dev` — it's compiled out of production by Vite
    // (`import.meta.env.DEV` guard) and never ships, so it is test-environment
    // scaffolding, not a product surface. Excluding it is the "trivially fix in
    // test-setup" case the brief calls out, not a violation to allowlist.
    .exclude('.dev-reset')
    .analyze()
  const { known, unexpected } = classifyViolations(results)
  console.log(formatKnownViolations(surface, known))
  expect(unexpected, formatUnexpectedViolations(surface, unexpected)).toEqual([])
}

test.describe('admin a11y (axe, WCAG 2.1 AA)', () => {
  test('dashboard', async ({ page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    await expect(dashboard.heading).toBeVisible()

    await scanAndAssert(page, 'dashboard')
  })

  test('content list (with rows)', async ({ page }) => {
    // Seed a post so the list has at least one real row, not just the empty state.
    const title = uniqueTitle('a11y-list')
    const list = new ContentListPage(page)
    await list.gotoPosts()
    const editor = await list.createPost()
    await editor.setTitle(title)
    await editor.save()

    const listAfterSave = await editor.backToList()
    await listAfterSave.expectListed(title)

    await scanAndAssert(page, 'content list')
  })

  test('editor with content (title + body + callout block)', async ({ page }) => {
    const title = uniqueTitle('a11y-editor')
    const body = `Body text for ${title}.`
    const calloutText = `Callout body for ${title}.`

    const list = new ContentListPage(page)
    await list.gotoPosts()
    const editor = await list.createPost()
    await editor.setTitle(title)
    await editor.typeInBody(body)
    await page.keyboard.press('Enter')

    await editor.openSlashMenu()
    await editor.insertBlock('Callout')
    await expect(editor.calloutBlock).toBeVisible()
    await editor.calloutBody.click()
    await page.keyboard.type(calloutText)
    await editor.save()

    await scanAndAssert(page, 'editor with content')
  })

  test('editor with the slash menu open', async ({ page }) => {
    const title = uniqueTitle('a11y-slash')

    const list = new ContentListPage(page)
    await list.gotoPosts()
    const editor = await list.createPost()
    await editor.setTitle(title)
    await editor.openSlashMenu()
    await expect(editor.slashMenu).toBeVisible()

    await scanAndAssert(page, 'editor with slash menu open')
  })

  test('editor with the block-actions menu open', async ({ page }) => {
    const title = uniqueTitle('a11y-block-menu')
    const body = `Body text for ${title}.`

    const list = new ContentListPage(page)
    await list.gotoPosts()
    const editor = await list.createPost()
    await editor.setTitle(title)
    await editor.typeInBody(body)

    // Hover the block to make the drag handle represent it, then open its menu — the
    // grip is a single `<button aria-label="Block actions">` (EditorPage.dragHandle);
    // clicking it opens BlockMenu.tsx's `role="menu" aria-label="Block actions"` popup.
    await editor.blocks.filter({ hasText: body }).first().hover()
    await expect(editor.dragHandle).toBeVisible()
    await editor.dragHandle.click()
    await expect(page.getByRole('menu', { name: 'Block actions' })).toBeVisible()

    await scanAndAssert(page, 'editor with block-actions menu open')
  })

  test('settings — media', async ({ page }) => {
    const settings = new SettingsPage(page)
    await settings.goto()
    await expect(settings.heading).toBeVisible()
    await settings.openMedia()

    await scanAndAssert(page, 'settings — media')
  })
})
