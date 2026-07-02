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

  /** The status Badge cell in the same row as `title` — ContentTable.tsx renders one
   *  `<tr>` per entry with the title link and status badge as sibling cells; scope
   *  from the row link's ancestor `<tr>` up to `<table>` (Playwright's default table
   *  cell/row semantics) so this reads the right row's badge, not just any "Staged"
   *  text on the page. */
  rowStatus(title: string) {
    return this.page.getByRole('row', { name: new RegExp(title) }).getByText(/^(Draft|Staged|Live|Unpublished)$/)
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
