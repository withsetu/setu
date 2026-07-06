import type { Page } from '@playwright/test'

/** The Better Auth sign-in screen — apps/admin/src/auth/LoginScreen.tsx (shadcn `login-01`). */
export class LoginPage {
  constructor(private readonly page: Page) {}

  /** CardTitle copy — the stable "you are held at the login wall" signal. */
  get heading() {
    return this.page.getByText('Sign in to Setu')
  }

  get emailInput() {
    return this.page.locator('#login-email')
  }

  get passwordInput() {
    return this.page.locator('#login-password')
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
