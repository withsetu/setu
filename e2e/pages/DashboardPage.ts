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

  /** An AppSidebar nav link by its exact label (`label` in apps/admin/src/shell/AppSidebar.tsx).
   *  `exact` so 'Users' cannot also match some other link that merely contains the word. Role-gate
   *  specs use this ONE locator for both the `toBeHidden` check (wrong role) and its positive
   *  control (a role that should see the link), so a label rename turns the positive control red
   *  instead of letting the hidden check pass vacuously (#1201) — the controls are in
   *  e2e/specs/auth-role-gate.spec.ts and e2e/specs/auth-editor-rung.spec.ts. */
  navLink(label: string) {
    return this.page.getByRole('link', { name: label, exact: true })
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
