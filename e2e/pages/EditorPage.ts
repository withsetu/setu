import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { ContentListPage } from './ContentListPage'

/** The post/page editor at `/edit/:collection/:locale/:slug` — EditorScreen.tsx.
 *  Persistence is autosave-only (no explicit Save button): typing schedules a
 *  debounced save and `SaveIndicator` renders "Saving…" then "Saved". */
export class EditorPage {
  constructor(private readonly page: Page) {}

  /** `<input aria-label="Title">` — EditorScreen.tsx. `exact` avoids matching the
   *  MetaPanel's "SEO title" field, whose accessible name contains "Title". */
  get titleInput() {
    return this.page.getByRole('textbox', { name: 'Title', exact: true })
  }

  /** Tiptap `EditorContent` — a `contenteditable` div with `aria-label="Content editor"`
   *  and no explicit `role`, so most browsers' accessibility trees expose it as `generic`
   *  rather than `textbox`; match by label instead of role (finding: the canvas itself has
   *  no accessible `textbox` role — worth a follow-up a11y fix, not blocking here). */
  get body() {
    return this.page.getByLabel('Content editor')
  }

  /** SaveIndicator's "Saved" text — the only visible save affordance (autosave, no button). */
  get savedIndicator() {
    return this.page.getByText('Saved', { exact: true })
  }

  get backToListLink() {
    return this.page.getByRole('link', { name: 'Back to list' })
  }

  async setTitle(title: string) {
    await this.titleInput.fill(title)
  }

  async typeInBody(text: string) {
    await this.body.click()
    await this.body.pressSequentially(text)
  }

  /** Wait for autosave to settle: SaveIndicator flips through "Saving…" to "Saved". */
  async save() {
    await expect(this.savedIndicator).toBeVisible({ timeout: 10_000 })
  }

  async backToList(): Promise<ContentListPage> {
    await this.backToListLink.click()
    return new ContentListPage(this.page)
  }
}
