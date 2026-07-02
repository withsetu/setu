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

  /** SiteDeployCard's deploy-state line (dashboard/widgets/SiteDeployCard.tsx) — reads
   *  "Not deployed yet" until something calls `useDeploy().deploy()`. Nothing in the app
   *  currently calls it (there is no wired deploy button), so this text never changes on
   *  its own; it's still the clearest saved≠live honesty surface Setu ships today —
   *  publishing a post (a Git commit) never flips it to "Deployed". See publish.spec.ts. */
  get notDeployedYetText() {
    return this.page.getByText('Not deployed yet', { exact: true })
  }
}
