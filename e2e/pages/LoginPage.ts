import type { Page } from '@playwright/test'

/** The Better Auth sign-in screen — apps/admin/src/auth/LoginScreen.tsx (shadcn `login-01`). */
export class LoginPage {
  constructor(private readonly page: Page) {}

  /** CardTitle copy — the stable "you are held at the login wall" signal. */
  get heading() {
    return this.page.getByText('Sign in to Setu')
  }

  /** #812: label-based, not `#login-email`/`#login-password`. This is the screen `auth.setup.ts`
   *  drives for EVERY role before EVERY project, and it was the one place the harness opted out of
   *  its own a11y forcing function (CLAUDE.md §5): selecting by raw CSS id keeps passing after the
   *  `<Label htmlFor>` association breaks — label detached, `htmlFor` dropped, `<Input>` swapped
   *  for a custom component — so an accessible-name regression on the login form would ship green.
   *  LoginScreen.tsx renders `<Label htmlFor="login-email">Email</Label>` +
   *  `<Label htmlFor="login-password">Password</Label>`, so these resolve through the real
   *  accessibility tree, and a broken association is now a hard setup-project failure.
   *  (`MediaPage.ts`'s `data-testid` remains the genuine last-resort case; this was not one.) */
  get emailInput() {
    return this.page.getByLabel('Email')
  }

  get passwordInput() {
    return this.page.getByLabel('Password')
  }

  get submit() {
    return this.page.getByRole('button', { name: 'Sign in' })
  }

  /** Fill + submit the real form — issues the cross-origin `POST /api/auth/sign-in/email`
   *  (admin :5175 → api :4446) that exercises the CORS preflight + `Set-Cookie` session path no
   *  unit test covers. */
  async signIn(email: string, password: string) {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.submit.click()
  }
}
