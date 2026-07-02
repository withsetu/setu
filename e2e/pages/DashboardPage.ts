import type { Page } from '@playwright/test'

/** The admin dashboard at `/dashboard` (also served at `/`). */
export class DashboardPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/dashboard')
  }

  get heading() {
    return this.page.getByRole('heading', { level: 1, name: 'Dashboard' })
  }

  /** AppSidebar nav link into the Posts content list. */
  get postsNavLink() {
    return this.page.getByRole('link', { name: 'Posts' })
  }
}
