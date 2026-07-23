import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LoginScreen } from '../src/auth/LoginScreen'
import { authClient } from '../src/auth/auth-client'

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn(), social: vi.fn() },
    requestPasswordReset: vi.fn()
  }
}))

const mockSignInEmail = vi.mocked(authClient.signIn.email)
const mockSignInSocial = vi.mocked(authClient.signIn.social)
const mockRequestPasswordReset = vi.mocked(authClient.requestPasswordReset)

interface AuthCaps {
  enabled: boolean
  providers: ('github' | 'google')[]
  captcha: { provider: 'turnstile' | 'recaptcha'; siteKey: string } | null
  needsSetup: boolean
}

interface EmailCaps {
  transport: string
  deliverable: boolean
}

const NO_PROVIDERS_NO_CAPTCHA: AuthCaps = {
  enabled: true,
  providers: [],
  captcha: null,
  needsSetup: false
}

const DELIVERABLE: EmailCaps = { transport: 'resend', deliverable: true }
const UNDELIVERABLE: EmailCaps = { transport: 'console', deliverable: false }

function stubCapabilities(auth: AuthCaps, mode?: string, email?: EmailCaps) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            capabilities: {
              imageProcessing: false,
              writableMediaStore: true,
              backgroundJobs: true
            },
            auth,
            ...(mode ? { mode } : {}),
            ...(email ? { email } : {})
          }),
          { status: 200 }
        )
    )
  )
}

beforeEach(() => {
  stubCapabilities(NO_PROVIDERS_NO_CAPTCHA)
  mockSignInEmail.mockResolvedValue({ data: {}, error: null })
})

afterEach(() => vi.restoreAllMocks())

async function fillForm(email = 'ada@setu.dev', password = 'hunter2') {
  fireEvent.change(await screen.findByLabelText(/email/i), {
    target: { value: email }
  })
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: password }
  })
}

describe('LoginScreen', () => {
  it('renders email + password inputs with labels and a primary submit button', async () => {
    render(<LoginScreen />)
    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('submits on Enter inside the password field', async () => {
    render(<LoginScreen />)
    await fillForm()
    fireEvent.submit(
      screen.getByRole('button', { name: /sign in/i }).closest('form')!
    )
    await waitFor(() =>
      expect(mockSignInEmail).toHaveBeenCalledWith(
        { email: 'ada@setu.dev', password: 'hunter2' },
        undefined
      )
    )
  })

  it('disables the submit button and shows a spinner while signing in', async () => {
    let resolveSignIn!: (v: { data: unknown; error: null }) => void
    mockSignInEmail.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve
      })
    )

    render(<LoginScreen />)
    await fillForm()
    const button = screen.getByRole('button', { name: /sign in/i })
    fireEvent.click(button)

    await waitFor(() => expect(button).toBeDisabled())

    resolveSignIn({ data: {}, error: null })
  })

  it('maps invalid credentials to a friendly field/form error', async () => {
    mockSignInEmail.mockResolvedValue({
      data: null,
      error: {
        status: 401,
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password'
      }
    })

    render(<LoginScreen />)
    await fillForm()
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(
      await screen.findByText(/email or password is incorrect/i)
    ).toBeInTheDocument()
  })

  it('maps a 429 rate-limit error to a wait-a-moment message', async () => {
    mockSignInEmail.mockResolvedValue({
      data: null,
      error: { status: 429, message: 'Too many requests' }
    })

    render(<LoginScreen />)
    await fillForm()
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(
      await screen.findByText(/too many attempts.*wait a moment/i)
    ).toBeInTheDocument()
  })

  it("a passwordless-owner sign-in attempt gets the same generic invalid-credentials message as a wrong password (#248 Task 7: better-auth 1.6.23 does not distinguish the two — see mapSignInError's comment)", async () => {
    // better-auth's real /sign-in/email throws INVALID_EMAIL_OR_PASSWORD for "no credential
    // account" exactly as it does for "wrong password" — there is no distinct code to map here.
    mockSignInEmail.mockResolvedValue({
      data: null,
      error: {
        status: 401,
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password'
      }
    })

    render(<LoginScreen />)
    await fillForm()
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(
      await screen.findByText(/email or password is incorrect/i)
    ).toBeInTheDocument()
  })

  it('shows a generic error for an unrecognized failure', async () => {
    mockSignInEmail.mockResolvedValue({
      data: null,
      error: { status: 500, message: 'boom' }
    })

    render(<LoginScreen />)
    await fillForm()
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
  })

  it('renders no social buttons when capabilities.auth.providers is empty', async () => {
    render(<LoginScreen />)
    await screen.findByLabelText(/email/i)
    expect(
      screen.queryByRole('button', { name: /continue with github/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /continue with google/i })
    ).not.toBeInTheDocument()
  })

  it('renders only the enabled social provider buttons and calls signIn.social', async () => {
    stubCapabilities({
      enabled: true,
      providers: ['github'],
      captcha: null,
      needsSetup: false
    })
    render(<LoginScreen />)

    const githubBtn = await screen.findByRole('button', {
      name: /continue with github/i
    })
    expect(
      screen.queryByRole('button', { name: /continue with google/i })
    ).not.toBeInTheDocument()

    fireEvent.click(githubBtn)
    await waitFor(() =>
      expect(mockSignInSocial).toHaveBeenCalledWith({ provider: 'github' })
    )
  })

  it('keeps submit disabled with a hint when captcha is configured but no token yet', async () => {
    stubCapabilities({
      enabled: true,
      providers: [],
      captcha: { provider: 'turnstile', siteKey: 'site-key-1' },
      needsSetup: false
    })
    render(<LoginScreen />)

    await fillForm()
    const button = await screen.findByRole('button', { name: /sign in/i })
    expect(button).toBeDisabled()
    expect(screen.getByText(/complete the challenge/i)).toBeInTheDocument()
  })

  it('threads the captcha token as x-captcha-response once the widget resolves one', async () => {
    stubCapabilities({
      enabled: true,
      providers: [],
      captcha: { provider: 'turnstile', siteKey: 'site-key-1' },
      needsSetup: false
    })
    // Stub the global widget API the mount-captcha helper looks for, and have render()
    // synchronously invoke the callback with a token (simulating a solved challenge).
    ;(window as unknown as { turnstile: unknown }).turnstile = {
      render: (_el: HTMLElement, opts: { callback: (t: string) => void }) => {
        opts.callback('captcha-token-xyz')
        return 'widget-1'
      },
      reset: vi.fn()
    }

    render(<LoginScreen />)
    await fillForm()

    const button = await screen.findByRole('button', { name: /sign in/i })
    await waitFor(() => expect(button).not.toBeDisabled())

    fireEvent.click(button)
    await waitFor(() =>
      expect(mockSignInEmail).toHaveBeenCalledWith(
        { email: 'ada@setu.dev', password: 'hunter2' },
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-captcha-response': 'captcha-token-xyz'
          })
        })
      )
    )

    delete (window as unknown as { turnstile?: unknown }).turnstile
  })

  // #386 follow-up (owner UAT 2026-07-15): the login screen carries NO recovery hint in any
  // mode — the login-link recovery path is documented and mentioned in the logout guard
  // dialog instead, keeping the sign-in card clean.
  it('never shows a login-link hint, in local mode included', async () => {
    stubCapabilities(NO_PROVIDERS_NO_CAPTCHA, 'local')
    render(<LoginScreen />)

    await screen.findByLabelText(/email/i)
    expect(
      screen.queryByText(/on the machine running setu\?/i)
    ).not.toBeInTheDocument()
    expect(screen.queryByText('pnpm auth:login-link')).not.toBeInTheDocument()
  })
})

// #500: capability-aware self-service password reset entry on the login card.
describe('LoginScreen — forgot password (#500)', () => {
  async function openForgot() {
    render(<LoginScreen />)
    fireEvent.click(
      await screen.findByRole('button', { name: /forgot password\?/i })
    )
  }

  it('deliverable email: the link opens an email-entry step that sends the reset request with the admin-origin redirect', async () => {
    stubCapabilities(NO_PROVIDERS_NO_CAPTCHA, undefined, DELIVERABLE)
    mockRequestPasswordReset.mockResolvedValue({
      data: { status: true, message: 'ok' },
      error: null
    })

    await openForgot()

    const emailInput = await screen.findByLabelText(/email/i)
    fireEvent.change(emailInput, { target: { value: 'ada@setu.dev' } })
    fireEvent.submit(emailInput.closest('form')!)

    await waitFor(() =>
      expect(mockRequestPasswordReset).toHaveBeenCalledWith({
        email: 'ada@setu.dev',
        redirectTo: `${window.location.origin}/reset-password`
      })
    )
    // Enumeration-safe uniform copy: the SAME message whether or not the account exists (the
    // server already answers uniformly — better-auth 1.6.23 request-password-reset).
    expect(
      await screen.findByText(/if an account exists for that email/i)
    ).toBeInTheDocument()
  })

  it('prefills the forgot step with whatever email was already typed on the sign-in form', async () => {
    stubCapabilities(NO_PROVIDERS_NO_CAPTCHA, undefined, DELIVERABLE)
    render(<LoginScreen />)

    fireEvent.change(await screen.findByLabelText(/email/i), {
      target: { value: 'typed@setu.dev' }
    })
    fireEvent.click(
      screen.getByRole('button', { name: /forgot password\?/i })
    )

    expect(await screen.findByLabelText(/email/i)).toHaveValue(
      'typed@setu.dev'
    )
  })

  it('rejects an invalid email with a field error and never calls the API', async () => {
    stubCapabilities(NO_PROVIDERS_NO_CAPTCHA, undefined, DELIVERABLE)
    await openForgot()

    const emailInput = await screen.findByLabelText(/email/i)
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } })
    fireEvent.submit(emailInput.closest('form')!)

    expect(await screen.findByText(/enter a valid email/i)).toBeInTheDocument()
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it('a failed request surfaces a visible error DISTINCT from the sent copy (silent-async rule: uniform copy is for account existence, never for transport failure)', async () => {
    stubCapabilities(NO_PROVIDERS_NO_CAPTCHA, undefined, DELIVERABLE)
    mockRequestPasswordReset.mockResolvedValue({
      data: null,
      error: { status: 500, message: 'boom' }
    })

    await openForgot()
    const emailInput = await screen.findByLabelText(/email/i)
    fireEvent.change(emailInput, { target: { value: 'ada@setu.dev' } })
    fireEvent.submit(emailInput.closest('form')!)

    expect(
      await screen.findByText(/couldn't send the reset email/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/if an account exists for that email/i)
    ).not.toBeInTheDocument()
  })

  it('a thrown (network-level) failure also surfaces the visible error, not the sent copy', async () => {
    stubCapabilities(NO_PROVIDERS_NO_CAPTCHA, undefined, DELIVERABLE)
    mockRequestPasswordReset.mockRejectedValue(new Error('network down'))

    await openForgot()
    const emailInput = await screen.findByLabelText(/email/i)
    fireEvent.change(emailInput, { target: { value: 'ada@setu.dev' } })
    fireEvent.submit(emailInput.closest('form')!)

    expect(
      await screen.findByText(/couldn't send the reset email/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/if an account exists for that email/i)
    ).not.toBeInTheDocument()
  })

  it('maps a 429 to the wait-a-moment message', async () => {
    stubCapabilities(NO_PROVIDERS_NO_CAPTCHA, undefined, DELIVERABLE)
    mockRequestPasswordReset.mockResolvedValue({
      data: null,
      error: { status: 429, message: 'Too many requests' }
    })

    await openForgot()
    const emailInput = await screen.findByLabelText(/email/i)
    fireEvent.change(emailInput, { target: { value: 'ada@setu.dev' } })
    fireEvent.submit(emailInput.closest('form')!)

    expect(
      await screen.findByText(/too many attempts.*wait a moment/i)
    ).toBeInTheDocument()
  })

  it('undeliverable email: the link shows honest not-configured copy instead of an email form — never a dead button', async () => {
    stubCapabilities(NO_PROVIDERS_NO_CAPTCHA, undefined, UNDELIVERABLE)
    await openForgot()

    expect(
      await screen.findByText(/password reset isn[’']t configured for this site/i)
    ).toBeInTheDocument()
    // No email-entry form on this path.
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /send reset link/i })
    ).not.toBeInTheDocument()
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it('missing email capability block (fetch failed / older api): fails closed to the honest copy', async () => {
    stubCapabilities(NO_PROVIDERS_NO_CAPTCHA) // no email block at all
    await openForgot()

    expect(
      await screen.findByText(/password reset isn[’']t configured for this site/i)
    ).toBeInTheDocument()
  })

  it('back to sign in returns to the sign-in form', async () => {
    stubCapabilities(NO_PROVIDERS_NO_CAPTCHA, undefined, DELIVERABLE)
    await openForgot()

    fireEvent.click(
      await screen.findByRole('button', { name: /back to sign in/i })
    )
    expect(
      await screen.findByRole('button', { name: /^sign in$/i })
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })
})
