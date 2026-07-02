import { test, expect } from '@playwright/test'
import { DashboardPage } from '../pages/DashboardPage'
import { ContentListPage } from '../pages/ContentListPage'

// Baseline visual coverage for the 4 key admin screens (issue #219 T7). This project
// (`visual`) is the ONLY project these specs run in — see playwright.config.ts's
// `testIgnore: '**/*.visual.spec.ts'` on the other projects, and the `--list` output in
// task-7-report.md proving each test appears exactly once.
//
// Baselines are Linux/CI-only: `ignoreSnapshots: !process.env.CI` (playwright.config.ts)
// means every `toHaveScreenshot()` call below still RUNS locally (darwin) but the pixel
// comparison itself is skipped — Playwright logs this per-assertion. Do not commit any
// `.png` from a local run; T8's CI job generates + uploads the first real baselines.
//
// Fixed titles (NOT uniqueTitle — see e2e/lib/unique-title.ts's doc-comment for why this
// is safe): screenshot diffing needs the exact same fixture text every run, and this is
// the only spec file that touches these two titles.
//
// Persistence model (why each test below mints ITS OWN post, in its OWN page/test —
// see apps/admin/src/data/Bootstrap.tsx): drafts live in IndexedDB, scoped to one
// browser context — NOT visible from a different test's fresh context, even against the
// same server. Only PUBLISHED content (a real git commit) is server-shared and visible
// everywhere. So a post created as a draft in the "dashboard" test is invisible to the
// "content list" test's fresh context; each test that needs a specific post in view must
// create it itself, in the same page, and never rely on another test's draft.
const FIXED_POST_TITLE = 'Visual Baseline Post'
const FIXED_POST_BODY = 'Fixed body content for the visual regression baseline. Do not change this text.'

test.describe('visual baselines', () => {
  // Determinism precondition, self-checking: the visual project must deliver
  // prefers-reduced-motion to the page (motion/react entrance animations branch on it).
  // This once regressed SILENTLY — `use.reducedMotion` isn't a real Playwright option and
  // was ignored at runtime (it must ride `contextOptions`); local runs stayed green because
  // snapshot comparison is CI-only. Assert the media query so a config change that drops it
  // fails loudly everywhere, not just as CI baseline flake.
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  })

  test('dashboard', async ({ page }) => {
    // Seed one real post first so ResumeEditing/StatTiles render their populated state
    // (not the "No edits yet" empty state) — the empty state is trivial and not worth a
    // baseline, and an empty dashboard would drift from what real usage looks like.
    const list = new ContentListPage(page)
    await list.gotoPosts()
    const editor = await list.createPost()
    await editor.setTitle(FIXED_POST_TITLE)
    await editor.typeInBody(FIXED_POST_BODY)
    await editor.save()

    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    await expect(dashboard.heading).toBeVisible()
    // Settle: StatTiles/ResumeEditing/SiteHealthCard all load async on mount — wait for
    // the row this test just created to actually appear before screenshotting, otherwise
    // we could snapshot mid-fetch on a slower CI runner.
    await expect(page.getByRole('link', { name: FIXED_POST_TITLE })).toBeVisible()

    // shadcn's CardTitle is a plain `<div data-slot="card-title">` (components/ui/card.tsx)
    // — NOT a heading role — so anchor on that data-slot + its text, then walk up to the
    // nearest `[data-slot="card"]` ancestor to get the whole card.
    const cardByTitle = (title: string) =>
      page.locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="card-title"]', { hasText: title }) })

    await expect(page).toHaveScreenshot('dashboard.png', {
      fullPage: true,
      mask: [
        // StatTiles ("At a glance"): posts/pages/published/drafts counts. Drafts are
        // browser-context-scoped (see file header), so within THIS test they're stable —
        // but `publish.spec.ts` (chromium project, running concurrently against the same
        // shared sandbox) commits a real post to Git, which IS server-shared and can land
        // in this count mid-run. Mask the whole card, not just the digits, since a
        // changing digit count can reflow the layout too.
        cardByTitle('At a glance'),
        // ResumeEditing ("Resume editing"): shows the 5 most-recently-updated entries
        // SITE-WIDE, and its "edited {relativeTime}" text is clock-derived regardless
        // (apps/admin/src/dashboard/widgets/ResumeEditing.tsx:24,36-38). Same
        // concurrent-publish exposure as StatTiles above — mask the whole card body, not
        // just the timestamp spans, so row identity/order churn can't cause a diff.
        cardByTitle('Resume editing'),
        // SiteHealthCard ("Site Health"): score/band/must-have counts come from
        // runAudit() over the SAME server-shared, git-backed entry set as the cards
        // above (packages/core/src/health/checks.ts aggregates over ctx.entries —
        // missing-title/H1/homepage checks), so a concurrent publish.spec.ts commit
        // can shift the score/band mid-run. Same whole-card masking rationale.
        cardByTitle('Site Health'),
        // WhosEditing: no active lock in this harness (no second session holds one), so
        // it renders null (apps/admin/src/dashboard/widgets/WhosEditing.tsx:10) — nothing
        // to mask there today, but if a lock ever appears the "editing "<slug>"" line and
        // avatar initials are content-derived, not clock-derived, so they're stable.
      ],
    })
  })

  test('editor with content', async ({ page }) => {
    const list = new ContentListPage(page)
    await list.gotoPosts()
    const editor = await list.createPost()
    await editor.setTitle(FIXED_POST_TITLE + ' Editor')
    await editor.typeInBody(FIXED_POST_BODY)
    // Settled state only: wait for the real "Saved" indicator (autosave debounce fully
    // resolved) before screenshotting, per the brief — never shoot mid-"Saving…". The
    // editor screen shows only the ONE entry being edited (a fresh draft, unpublished),
    // so it's immune to any other spec's concurrent activity.
    await editor.save()

    await expect(page).toHaveScreenshot('editor.png', {
      fullPage: false, // the canvas can grow with content; the fixed viewport frame is stable, full-page scroll height is not guaranteed to be
    })
  })

  test('content list', async ({ page }) => {
    // Mint this test's own fixed-title post FIRST (see file header: drafts are
    // browser-context-scoped, so a post created in another test's context is never
    // visible here) — then filter down to it via the real search box.
    const list = new ContentListPage(page)
    await list.gotoPosts()
    const editor = await list.createPost()
    await editor.setTitle(FIXED_POST_TITLE)
    await editor.typeInBody(FIXED_POST_BODY)
    await editor.save()

    await list.gotoPosts()
    await expect(page.getByRole('heading', { level: 1, name: 'Posts' })).toBeVisible()

    // Scope to just this post via the real search box rather than screenshotting the
    // unfiltered list — the unfiltered list's total row count and "N Posts" header count
    // both include the 6 seeded sandbox fixtures PLUS whatever `publish.spec.ts`
    // (chromium, running concurrently against the same shared sandbox) may have
    // committed by now. Search is a real, user-reachable path (not a test-only
    // shortcut) that also exercises ListToolbar's search filter.
    await page.getByRole('textbox', { name: 'Search' }).fill(FIXED_POST_TITLE)
    // Settle the debounced search -> URL `q` -> re-query round-trip (ContentList.tsx: 200ms
    // debounce, then `index.query({ q })`) before asserting on the filtered result.
    await expect(page.getByRole('link', { name: FIXED_POST_TITLE, exact: true })).toBeVisible()
    // Exactly this 1 row now — deterministic regardless of what else is in the sandbox.
    await expect(page.locator('table tbody tr')).toHaveCount(1)

    await expect(page).toHaveScreenshot('content-list.png', {
      fullPage: true,
      mask: [
        // ContentTable's "Updated" column renders relativeTime(r.updatedAt) for every row
        // (apps/admin/src/screens/content-list/ContentTable.tsx:87) — clock-derived even
        // though the row set itself is now pinned to just the 1 fixed-title post above.
        page.locator('table tbody tr td:last-child'),
      ],
    })
  })

  test('settings — media', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await page.getByRole('button', { name: 'Media' }).click()
    // Settle: MediaSettings reads settings.json + polls capabilities async on mount
    // (useCapabilities) — wait for the format select to reflect the loaded value (its
    // placeholder differs from any real option) so we don't shoot a pre-hydration frame.
    // This screen has no content-list/dashboard dependency, so it's immune to any other
    // spec's concurrent activity too.
    await expect(page.getByLabel('Image format')).toBeVisible()
    await expect(page.getByRole('button', { name: /Reprocess all images/ })).toBeVisible()

    await expect(page.getByRole('main')).toHaveScreenshot('settings-media.png')
  })
})
