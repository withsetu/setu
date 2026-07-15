import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** The `/media` screen — screens/Media.tsx, composed from media/MediaBrowser.tsx:
 *  a drag-drop MediaDropzone on top, a search/sort/type toolbar, then MediaGrid. */
export class MediaPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/media')
  }

  /** react-dropzone's `<input type=file>` inside the dropzone (MediaDropzone.tsx).
   *  data-testid is a justified last resort here (per the e2e selector policy):
   *  the input is visually hidden with no role/label in the accessibility tree —
   *  the dropzone's user-facing affordance is the click/drag surface — but
   *  Playwright's `setInputFiles` must target the real file input element, which
   *  no role/label selector can reach. The testid ships in MediaDropzone.tsx. */
  get uploadInput() {
    return this.page.getByTestId('media-dropzone-input')
  }

  /** Upload in-memory bytes through the real dropzone input, exactly as a user's
   *  file-picker selection would deliver them (react-dropzone onDrop → uploadFile
   *  → POST /media). The caller supplies a unique `name` — the media key derives
   *  from the filename, and the e2e sandbox media store is shared across projects. */
  async upload(payload: { name: string; mimeType: string; buffer: Buffer }) {
    await this.uploadInput.setInputFiles(payload)
  }

  /** The `notify.success('Uploaded <filename>')` toast (screens/Media.tsx
   *  onUploaded) — same Notifications-region pattern as EditorPage's toasts. */
  uploadedToast(filename: string) {
    return this.page
      .getByRole('region', { name: 'Notifications', exact: true })
      .getByText(`Uploaded ${filename}`, { exact: true })
  }

  /** A media grid tile — MediaGrid.tsx renders each asset as
   *  `<button aria-label={row.filename}>`. */
  tile(filename: string) {
    return this.page.getByRole('button', { name: filename, exact: true })
  }

  async expectInGrid(filename: string) {
    await expect(this.tile(filename)).toBeVisible()
  }
}
