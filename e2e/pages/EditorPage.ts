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

  /** The slash-command menu — CommandList in SlashCommand.tsx: `role="listbox"
   *  aria-label="Insert block"`, options are `role="option"`. Rendered into a tippy
   *  popup appended to `document.body`, not inside `.body`, so it's queried page-wide. */
  get slashMenu() {
    return this.page.getByRole('listbox', { name: 'Insert block' })
  }

  /** A slash-menu option by its visible block title (e.g. "Callout"). Each option's
   *  accessible name is its title + subtitle text concatenated (`.slash-label` +
   *  `.slash-desc`, e.g. "Callout\nInsert a callout block") — anchor on the title as
   *  a name prefix rather than `exact: true`, which would never match. */
  slashOption(blockTitle: string) {
    return this.slashMenu.getByRole('option', { name: new RegExp(`^${blockTitle}\\b`) })
  }

  /** An inserted Callout block in the canvas — Callout.tsx's shared core renders
   *  `<aside aria-label="Callout block">`, used by both the editor node view and the
   *  site render. */
  get calloutBlock() {
    return this.body.getByLabel('Callout block')
  }

  /** The Callout's editable body — `NodeViewContent` in Callout.tsx (the extension)
   *  renders `aria-label="Callout text"`, giving the contenteditable region an
   *  accessible handle instead of a `.callout-body` CSS selector. */
  get calloutBody() {
    return this.calloutBlock.getByLabel('Callout text')
  }

  async setTitle(title: string) {
    await this.titleInput.fill(title)
  }

  async typeInBody(text: string) {
    await this.body.click()
    await this.body.pressSequentially(text)
  }

  /** Click into the canvas and type `/` to open the slash menu. */
  async openSlashMenu() {
    await this.body.click()
    await this.body.pressSequentially('/')
    await expect(this.slashMenu).toBeVisible()
  }

  /** Filter the already-open slash menu to `blockTitle`, then pick it via keyboard
   *  (Down + Enter) — exercises the same arrow-key selection path a real user takes,
   *  per T3's requirement to select via keyboard at least once. */
  async insertBlock(blockTitle: string) {
    await this.page.keyboard.type(blockTitle)
    await expect(this.slashOption(blockTitle)).toBeVisible()
    await this.page.keyboard.press('ArrowDown')
    await this.page.keyboard.press('Enter')
    await expect(this.slashMenu).toBeHidden()
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
