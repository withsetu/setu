import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NotificationProvider } from '../src/ui/notify'
import { SessionGate } from '../src/auth/SessionGate'
import { useActor } from '../src/auth/actor'
import { authClient } from '../src/auth/auth-client'

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    useSession: vi.fn(),
    signOut: vi.fn()
  }
}))

const mockUseSession = vi.mocked(authClient.useSession)

function ActorProbe() {
  const actor = useActor()
  return (
    <div data-testid="actor">
      {actor.id}:{actor.role}
    </div>
  )
}

function stubCapabilities(
  auth: {
    enabled: boolean
    providers: ('github' | 'google')[]
    captcha: { provider: 'turnstile' | 'recaptcha'; siteKey: string } | null
    needsSetup: boolean
  },
  mode?: string
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/capabilities')) {
        return new Response(
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
      }
      return new Response('{}', { status: 200 })
    })
  )
}

const ENABLED_NO_SETUP = {
  enabled: true,
  providers: [] as ('github' | 'google')[],
  captcha: null,
  needsSetup: false
}

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => {
  vi.restoreAllMocks()
  window.location.hash = ''
})

describe('SessionGate', () => {
  it('shows a centered loading state while capabilities/session are resolving (no app flash)', () => {
    stubCapabilities(ENABLED_NO_SETUP)
    mockUseSession.mockReturnValue({
      data: null,
      isPending: true,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    })

    render(
      <MemoryRouter>
        <SessionGate>
          <div>App</div>
        </SessionGate>
      </MemoryRouter>
    )

    expect(screen.queryByText('App')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders children with the real actor in context when a session exists', async () => {
    stubCapabilities(ENABLED_NO_SETUP)
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'editor' } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    } as never)

    render(
      <MemoryRouter>
        <SessionGate>
          <ActorProbe />
        </SessionGate>
      </MemoryRouter>
    )

    await waitFor(() =>
      expect(screen.getByTestId('actor')).toHaveTextContent('u1:editor')
    )
  })

  it('defaults an unknown/missing role to author (#379: least-privileged staff role)', async () => {
    stubCapabilities(ENABLED_NO_SETUP)
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u2', role: undefined } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    } as never)

    render(
      <MemoryRouter>
        <SessionGate>
          <ActorProbe />
        </SessionGate>
      </MemoryRouter>
    )

    await waitFor(() =>
      expect(screen.getByTestId('actor')).toHaveTextContent('u2:author')
    )
  })

  it('with a #setu-token in the hash: exchanges it, scrubs the hash before the response resolves, then renders children after session', async () => {
    stubCapabilities(ENABLED_NO_SETUP)
    window.location.hash = '#setu-token=abc123'

    let resolveExchange!: (v: Response) => void
    const exchangeFetch = vi.fn(
      (_url: string, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          resolveExchange = resolve
        })
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/api/capabilities')) {
          return new Response(
            JSON.stringify({
              capabilities: {
                imageProcessing: false,
                writableMediaStore: true,
                backgroundJobs: true
              },
              auth: ENABLED_NO_SETUP
            }),
            { status: 200 }
          )
        }
        if (String(url).includes('/local/exchange')) {
          return exchangeFetch(url, init)
        }
        return new Response('{}', { status: 200 })
      })
    )

    // No session until after the exchange completes.
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    })

    render(
      <MemoryRouter>
        <SessionGate>
          <ActorProbe />
        </SessionGate>
      </MemoryRouter>
    )

    // The hash must be scrubbed BEFORE the exchange response resolves.
    await waitFor(() => expect(exchangeFetch).toHaveBeenCalled())
    expect(window.location.hash).toBe('')

    const [, exchangeInit] = exchangeFetch.mock.calls[0]!
    expect(exchangeInit).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ token: 'abc123' })
    })

    // Resolve the exchange, then flip useSession to reflect the new session (mimics a refetch).
    resolveExchange(
      new Response(JSON.stringify({ status: true }), { status: 200 })
    )
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u3', role: 'admin' } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    } as never)

    await waitFor(() =>
      expect(screen.getByTestId('actor')).toHaveTextContent('u3:admin')
    )
  })

  it('no session + auth disabled: renders the honest not-configured state, not a login form', async () => {
    stubCapabilities({
      enabled: false,
      providers: [],
      captcha: null,
      needsSetup: false
    })
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    })

    render(
      <MemoryRouter>
        <SessionGate>
          <div>App</div>
        </SessionGate>
      </MemoryRouter>
    )

    expect(
      await screen.findByText(/auth (is )?not configured/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/SETU_AUTH_SECRET/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })

  it('no session + needsSetup: renders SetupScreen (#248 Task 7)', async () => {
    stubCapabilities({
      enabled: true,
      providers: [],
      captcha: null,
      needsSetup: true
    })
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    })

    render(
      <MemoryRouter>
        <SessionGate>
          <div>App</div>
        </SessionGate>
      </MemoryRouter>
    )

    expect(
      await screen.findByRole('button', { name: /create admin account/i })
    ).toBeInTheDocument()
  })

  it('no session, auth enabled, no setup needed: renders LoginScreen', async () => {
    stubCapabilities(ENABLED_NO_SETUP)
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    })

    render(
      <MemoryRouter>
        <SessionGate>
          <div>App</div>
        </SessionGate>
      </MemoryRouter>
    )

    expect(
      await screen.findByRole('button', { name: /sign in/i })
    ).toBeInTheDocument()
  })

  // UAT 2026-07-05: in local mode /api/auth/setup is never mounted (no setup token), so the SetupScreen
  // can only 404 on submit. A signed-out local admin must land on the LoginScreen even if needsSetup is
  // (stale) true.
  it('local mode never routes to SetupScreen — shows LoginScreen even when needsSetup is true', async () => {
    stubCapabilities(
      { enabled: true, providers: [], captcha: null, needsSetup: true },
      'local'
    )
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    })

    render(
      <MemoryRouter>
        <SessionGate>
          <div>App</div>
        </SessionGate>
      </MemoryRouter>
    )

    expect(
      await screen.findByRole('button', { name: /sign in/i })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /create admin account/i })
    ).not.toBeInTheDocument()
  })

  // #453: a SIGNED-IN user visiting /reset-password bare (no token, no error) used to unmount the
  // whole app shell and show the reset screen — redirect them into the app instead.
  it('redirects a signed-in visitor at a bare /reset-password to the dashboard instead of unmounting the shell', async () => {
    stubCapabilities(ENABLED_NO_SETUP)
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'admin' } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    } as never)

    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <SessionGate>
          <div>App</div>
        </SessionGate>
      </MemoryRouter>
    )

    expect(await screen.findByText('App')).toBeInTheDocument()
    expect(screen.queryByText(/reset your password/i)).not.toBeInTheDocument()
  })

  // #453: but a signed-in user who CLICKED an emailed reset link (token present) is completing a
  // legitimate flow — e.g. a passwordless maintainer emailing themselves a reset link from the
  // Users screen — and must still get the reset form, not a redirect that eats the token.
  it('still renders the reset screen for a signed-in visitor whose URL carries a token', async () => {
    stubCapabilities(ENABLED_NO_SETUP)
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'maintainer' } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    } as never)

    render(
      <MemoryRouter initialEntries={['/reset-password?token=tok-1']}>
        {/* NotificationProvider mirrors main.tsx's real nesting — ResetPasswordScreen calls
            useNotify, which throws outside the provider. */}
        <NotificationProvider>
          <SessionGate>
            <div>App</div>
          </SessionGate>
        </NotificationProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText(/reset your password/i)).toBeInTheDocument()
    expect(screen.queryByText('App')).not.toBeInTheDocument()
  })

  it('renders the reset screen for a signed-out visitor at /reset-password (the #364 flow, unchanged)', async () => {
    stubCapabilities(ENABLED_NO_SETUP)
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    })

    render(
      <MemoryRouter initialEntries={['/reset-password?token=tok-1']}>
        <NotificationProvider>
          <SessionGate>
            <div>App</div>
          </SessionGate>
        </NotificationProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText(/reset your password/i)).toBeInTheDocument()
  })

  // UAT 2026-07-05: the instance booted at 0 users → capabilities cached needsSetup:true. After the
  // admin creates users and signs out (no page reload), the gate must RE-FETCH capabilities, not reuse
  // the stale flag — otherwise it strands the admin on the SetupScreen instead of the LoginScreen.
  it('re-fetches capabilities on sign-out so a stale needsSetup:true does not strand the admin on SetupScreen', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/capabilities')) {
          calls++
          // Boot-time fetch reports needsSetup:true (0 users); the post-signout refetch reports false.
          const needsSetup = calls === 1
          return new Response(
            JSON.stringify({
              capabilities: {
                imageProcessing: false,
                writableMediaStore: true,
                backgroundJobs: true
              },
              auth: { enabled: true, providers: [], captcha: null, needsSetup },
              mode: 'self-hosted'
            }),
            { status: 200 }
          )
        }
        return new Response('{}', { status: 200 })
      })
    )

    // Signed in first, so the gate observes a live session…
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', role: 'admin' } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    } as never)
    const { rerender } = render(
      <MemoryRouter>
        <SessionGate>
          <div>App</div>
        </SessionGate>
      </MemoryRouter>
    )
    await screen.findByText('App')

    // …then sign out. The gate must refetch and land on LoginScreen, not SetupScreen.
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    })
    rerender(
      <MemoryRouter>
        <SessionGate>
          <div>App</div>
        </SessionGate>
      </MemoryRouter>
    )

    expect(
      await screen.findByRole('button', { name: /sign in/i })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /create admin account/i })
    ).not.toBeInTheDocument()
    expect(calls).toBeGreaterThanOrEqual(2)
  })
})
