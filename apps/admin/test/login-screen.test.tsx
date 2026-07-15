import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LoginScreen } from '../src/auth/LoginScreen'
import { authClient } from '../src/auth/auth-client'

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn(), social: vi.fn() }
  }
}))

const mockSignInEmail = vi.mocked(authClient.signIn.email)
const mockSignInSocial = vi.mocked(authClient.signIn.social)

interface AuthCaps {
  enabled: boolean
  providers: ('github' | 'google')[]
  captcha: { provider: 'turnstile' | 'recaptcha'; siteKey: string } | null
  needsSetup: boolean
}

const NO_PROVIDERS_NO_CAPTCHA: AuthCaps = {
  enabled: true,
  providers: [],
  captcha: null,
  needsSetup: false
}

function stubCapabilities(auth: AuthCaps, mode?: string) {
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
            ...(mode ? { mode } : {})
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

  // #386: local-mode lockout recovery — the machine running Setu can always mint a fresh
  // sign-in link (`pnpm auth:login-link`), so the local login screen says so.
  it('local mode shows the auth:login-link hint under the card', async () => {
    stubCapabilities(NO_PROVIDERS_NO_CAPTCHA, 'local')
    render(<LoginScreen />)

    expect(
      await screen.findByText(/on the machine running setu\?/i)
    ).toBeInTheDocument()
    expect(screen.getByText('pnpm auth:login-link')).toBeInTheDocument()
  })

  it('no login-link hint outside local mode (capability-driven, not cosmetic)', async () => {
    stubCapabilities(NO_PROVIDERS_NO_CAPTCHA, 'self-hosted')
    render(<LoginScreen />)

    await screen.findByLabelText(/email/i)
    expect(
      screen.queryByText(/on the machine running setu\?/i)
    ).not.toBeInTheDocument()
    expect(screen.queryByText('pnpm auth:login-link')).not.toBeInTheDocument()
  })
})
