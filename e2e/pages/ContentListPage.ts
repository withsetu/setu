import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { EditorPage } from './EditorPage'

/** The `/posts` (or `/pages`) content list — ContentList.tsx. */
export class ContentListPage {
  constructor(private readonly page: Page) {}

  async gotoPosts() {
    await this.page.goto('/posts')
  }

  /** PageHeader action: `<Link to="/edit/:collection/en/new">` — visible text "New {noun}". */
  get newPostLink() {
    return this.page.getByRole('link', { name: 'New post' })
  }

  /** ContentTable row title link for a given post title. */
  rowLink(title: string) {
    return this.page.getByRole('link', { name: title, exact: true })
  }

  /** Click "New post" and land on the compose route, wrapped as an EditorPage. */
  async createPost(): Promise<EditorPage> {
    await this.newPostLink.click()
    await this.page.waitForURL('**/edit/post/en/new')
    return new EditorPage(this.page)
  }

  /** Assert a title is listed (and open it), returning an EditorPage. */
  async openPost(title: string): Promise<EditorPage> {
    await this.rowLink(title).click()
    return new EditorPage(this.page)
  }

  async expectListed(title: string) {
    await expect(this.rowLink(title)).toBeVisible()
  }
}
