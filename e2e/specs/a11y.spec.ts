import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { DashboardPage } from '../pages/DashboardPage'
import { ContentListPage } from '../pages/ContentListPage'
import { SettingsPage } from '../pages/SettingsPage'
import { uniqueTitle } from '../lib/unique-title'
import {
  classifyViolations,
  formatUnexpectedViolations,
  formatKnownViolations
} from '../lib/a11y-allowlist'

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
async function scanAndAssert(
  page: import('@playwright/test').Page,
  surface: string
) {
  // (The old `.dev-reset` floating button exclusion is gone: #513's Demo Data
  // panel absorbed the control and the overlay no longer exists, #492.)
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const { known, unexpected } = classifyViolations(results)
  console.log(formatKnownViolations(surface, known))
  expect(unexpected, formatUnexpectedViolations(surface, unexpected)).toEqual(
    []
  )
}

test.describe('admin a11y (axe, WCAG 2.1 AA)', () => {
  // Audit the SETTLED DOM, not a transient one. motion/react entrance animations
  // (ResumeEditing rows, ContentTable rows) fade in via opacity 0→1; scanning
  // mid-fade makes axe read the opacity-BLENDED color (e.g. --foreground on white
  // rendered as a light gray), which fails color-contrast only because it isn't
  // fully painted yet. The components already branch on `useReducedMotion()` to skip
  // the animation, so reducing motion renders them at their true, final colors —
  // exactly the state a contrast audit should measure. This was the #601 flake:
  // the count of rows caught mid-fade varied run to run. (Same mechanism the visual
  // project reduces motion for — see e2e/playwright.config.ts.)
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('dashboard', async ({ page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    await expect(dashboard.heading).toBeVisible()
    // The dashboard paints skeleton placeholders (StatTiles / SiteDeployCard /
    // ResumeEditing) while the content index loads (#572). Wait for the real content
    // to replace them so the scan audits the loaded dashboard — the state that
    // actually renders the deploy/status text — not the decorative loading shell.
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)

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

  test('editor with content (title + body + callout block)', async ({
    page
  }) => {
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
    await expect(
      page.getByRole('menu', { name: 'Block actions' })
    ).toBeVisible()

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
