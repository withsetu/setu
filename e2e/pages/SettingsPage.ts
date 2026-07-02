import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** The `/settings` shell — Settings.tsx. A single route; groups (General, Media, …) are
 *  a client-side tab (`useState<GroupId>`), not nested routes, so switching groups never
 *  changes the URL — see screens.visual.spec.ts's "settings — media" test, which this
 *  page object mirrors. */
export class SettingsPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/settings')
  }

  get heading() {
    return this.page.getByRole('heading', { level: 1, name: 'Settings' })
  }

  /** The left sub-nav's group tabs — plain `<button>` elements inside
   *  `<nav aria-label="Settings sections">` (Settings.tsx), not links. */
  get sectionsNav() {
    return this.page.getByRole('navigation', { name: 'Settings sections' })
  }

  groupTab(label: string) {
    return this.sectionsNav.getByRole('button', { name: label })
  }

  /** Switch to the Media group and wait for it to settle — MediaSettings.tsx reads
   *  settings.json + polls capabilities async on mount (useCapabilities); the format
   *  select becoming visible is the same settle signal the visual spec uses. */
  async openMedia() {
    await this.groupTab('Media').click()
    await expect(this.imageFormatSelect).toBeVisible()
    await expect(this.reprocessButton).toBeVisible()
  }

  /** MediaSettings' image-format `<Select>` trigger — `<Label htmlFor="med-format">
   *  Image format</Label>`. */
  get imageFormatSelect() {
    return this.page.getByLabel('Image format')
  }

  get reprocessButton() {
    return this.page.getByRole('button', { name: /Reprocess all images/ })
  }
}
