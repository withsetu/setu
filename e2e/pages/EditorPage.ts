import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { ContentListPage } from './ContentListPage'

/** The post/page editor at `/edit/:collection/:locale/:slug` — EditorScreen.tsx.
 *  Autosave (per-browser IndexedDB, no team visibility) runs continuously: typing
 *  schedules a debounced save and `SaveIndicator` renders "Saving…" then "Backed up
 *  on this device". Committing to Git is a separate, explicit action (Save draft /
 *  Publish, #382). */
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

  /** SaveIndicator's "Backed up on this device" text — the only visible autosave
   *  affordance (autosave, no button). Per-browser IndexedDB only, not Git/team-visible. */
  get savedIndicator() {
    return this.page.getByText('Backed up on this device', { exact: true })
  }

  get backToListLink() {
    return this.page.getByRole('link', { name: 'Back to list' })
  }

  /** PublishMenu's primary action — `<Button>Publish</Button>` (EditorScreen.tsx),
   *  only rendered once composing a new entry has minted a slug (canPublish requires
   *  `phase === 'ready' && !composing`, i.e. after the first autosave). */
  get publishButton() {
    return this.page.getByRole('button', { name: 'Publish', exact: true })
  }

  /** The success toast pushed by `notify.success` on publish — a `role="status"` div
   *  inside the `region "Notifications"` live region (ui/notify.tsx), with a `.notify-msg`
   *  span reading `Published · <sha7>`. Match by text within the region rather than the
   *  status role's computed accessible name — the region also carries a sibling "Dismiss"
   *  button whose own accessible name can otherwise get folded into the name computation.
   *  Auto-dismisses after 4s, so callers must assert this right after the triggering
   *  click, not after other slow awaits. */
  get publishedToast() {
    return this.page
      .getByRole('region', { name: 'Notifications', exact: true })
      .getByText(/^Published ·/)
  }

  /** StripStatus lifecycle badge in the editor header — a plain `<span>` (Badge has no
   *  ARIA role), so match by visible text. `deriveLifecycle` (packages/core/src/lifecycle)
   *  yields "Staged" for a freshly-published entry that has never been deployed: committed
   *  to Git but not yet in the deploy snapshot. This badge is the accurate saved≠live signal
   *  in the editor header for this journey. Finding (see publish.spec.ts + task-4-report.md):
   *  the header's "View this page on the live site" external-link button is a DECOY here —
   *  its disabled/enabled toggle is gated on `lifecycle.state === 'staged' || 'live'`, so it
   *  flips to enabled and live-looking immediately on this first-ever publish even though
   *  nothing has actually deployed (the e2e harness never boots the site). Don't assert on
   *  it as an honesty surface; the dashboard's SiteDeployCard "Not deployed yet" text
   *  (DashboardPage.notDeployedYetText) is the surface that stays honest. */
  get stagedStatus() {
    return this.page.getByText('Staged', { exact: true })
  }

  /** Invoke the real publish affordance and wait for the success toast. */
  async publish() {
    await this.publishButton.click()
    await expect(this.publishedToast).toBeVisible()
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
    return this.slashMenu.getByRole('option', {
      name: new RegExp(`^${blockTitle}\\b`)
    })
  }

  /** An inserted Callout block in the canvas — Callout.tsx's shared core renders
   *  `<aside aria-label="Callout block">`, used by both the editor node view and the
   *  site render. */
  get calloutBlock() {
    return this.body.getByLabel('Callout block')
  }

  /** Top-level block elements in document order — Canvas.tsx renders each ProseMirror
   *  top-level child as a direct child of `.setu-prose` (editor.css:22's comment
   *  confirms this is the render contract both the drag handle and `block-reorder.ts`'s
   *  index math rely on), so `.setu-prose > *` is exactly `doc.child(i)` for every `i`. */
  get blocks() {
    return this.body.locator('> *')
  }

  /** Visible text of each top-level block, in order — the order-assertion primitive
   *  for reorder specs. Reads the accessible/visible DOM (not Tiptap's JSON model), per
   *  the brief: a real user only ever sees text, never the document model. */
  async blockTexts(): Promise<string[]> {
    return this.blocks.allTextContents()
  }

  /** The drag-handle grip — DragHandle.tsx's single `<button aria-label="Block
   *  actions" draggable>` that follows whichever block the pointer is over (it is NOT
   *  one handle per block; hovering a block first is what makes the grip represent
   *  it). `getByRole('button', ...)` disambiguates from BlockMenu.tsx's
   *  `role="menu" aria-label="Block actions"` popup, which shares the same accessible
   *  name but a different role. Finding: the shared label describes the menu the grip
   *  opens on click, not its drag affordance — a more specific label (e.g. "Drag to
   *  reorder block") would be clearer, but role disambiguation is sufficient to
   *  automate today; not changing product code for this, see task-6-report.md. */
  get dragHandle() {
    return this.page.getByRole('button', { name: 'Block actions' })
  }

  /** Click into the block whose visible text starts with `text`, placing the caret
   *  inside it — the precondition `Alt-Shift-ArrowUp`/`Down` need, since BlockActions.ts
   *  moves whichever top-level block contains the current selection. */
  async clickBlock(text: string) {
    await this.blocks.filter({ hasText: text }).first().click()
  }

  /** Move the block containing `text` one slot up via the real keyboard shortcut —
   *  `Alt-Shift-ArrowUp` (BlockActions.ts / shortcuts.ts's `moveUp`). `Alt` is the
   *  literal modifier ProseMirror's keymap parses (unlike `Mod`, it is NOT translated
   *  to Cmd/Option per platform), so the same chord fires on chromium and webkit. */
  async moveBlockUpByKeyboard(text: string) {
    await this.clickBlock(text)
    await this.page.keyboard.press('Alt+Shift+ArrowUp')
  }

  /** Move the block containing `text` one slot down via `Alt-Shift-ArrowDown`. */
  async moveBlockDownByKeyboard(text: string) {
    await this.clickBlock(text)
    await this.page.keyboard.press('Alt+Shift+ArrowDown')
  }

  /** Drag the block whose visible text starts with `fromText` and drop it relative to
   *  the block whose visible text starts with `toText` — `position: 'before'`
   *  (default) or `'after'` — via the real grip (DragHandle.tsx). Manual hover ->
   *  dragstart -> dragover -> drop rather than `locator.dragTo`: the grip is a single
   *  shared element repositioned on `mousemove` (not a per-block handle), so the
   *  source block must be hovered FIRST to make the grip represent it, and the
   *  handler is native HTML5 DnD (`dragstart`/`dragover`/`drop` with `dataTransfer`),
   *  which `dragTo`'s mouse-event simulation does not dispatch — Playwright's
   *  `dispatchEvent` with a real `DataTransfer` is the documented pattern for HTML5
   *  DnD (see Playwright's drag-and-drop docs, "programmatic" example).
   *
   *  Drop coordinate: `dropTargetIndex` (DragHandle.tsx) treats a block's TOP half as
   *  "drop before it" and its BOTTOM half as "drop after it" — dropping at the exact
   *  vertical center is the boundary between those two halves and resolves by
   *  floating-point comparison, so it is not a reliable signal either way. A point a
   *  few pixels inside the relevant half is unambiguous. */
  async dragBlock(
    fromText: string,
    toText: string,
    position: 'before' | 'after' = 'before'
  ) {
    const source = this.blocks.filter({ hasText: fromText }).first()
    const target = this.blocks.filter({ hasText: toText }).first()

    // Hover the source block so DragHandle's `mousemove` handler sets `hoverIndex`
    // and positions the grip over it (see DragHandle.tsx's `handleDOMEvents.mousemove`).
    await source.hover()
    await expect(this.dragHandle).toBeVisible()

    const targetBox = await target.boundingBox()
    if (!targetBox)
      throw new Error(`dragBlock: target block "${toText}" has no bounding box`)
    const edge = Math.min(4, targetBox.height / 4)
    const dropY =
      position === 'before'
        ? targetBox.y + edge
        : targetBox.y + targetBox.height - edge

    // Native HTML5 DnD: DragHandle.tsx's `dragstart` listener reads `hoverIndex`
    // (set by the hover above) and registers document-level `dragover`/`drop`
    // listeners; the `drop` handler derives the target index purely from
    // `event.clientY` (dropToIndex in DragHandle.tsx), so only the Y coordinate of
    // the dispatched events matters, not the exact target element.
    const dataTransfer = await this.page.evaluateHandle(
      () => new DataTransfer()
    )
    await this.dragHandle.dispatchEvent('dragstart', { dataTransfer })
    await this.page.dispatchEvent('body', 'dragover', {
      dataTransfer,
      clientY: dropY
    })
    await this.page.dispatchEvent('body', 'drop', {
      dataTransfer,
      clientY: dropY
    })
    await this.page.dispatchEvent('body', 'dragend', { dataTransfer })
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

  /** Wait for autosave to settle: SaveIndicator flips through "Saving…" to
   *  "Backed up on this device". */
  async save() {
    await expect(this.savedIndicator).toBeVisible({ timeout: 10_000 })
  }

  async backToList(): Promise<ContentListPage> {
    await this.backToListLink.click()
    return new ContentListPage(this.page)
  }
}
