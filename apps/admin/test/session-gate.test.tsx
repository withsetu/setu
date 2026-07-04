import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SessionGate } from '../src/auth/SessionGate'
import { useActor } from '../src/auth/actor'
import { authClient } from '../src/auth/auth-client'

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    useSession: vi.fn(),
    signOut: vi.fn(),
  },
}))

const mockUseSession = vi.mocked(authClient.useSession)

function ActorProbe() {
  const actor = useActor()
  return <div data-testid="actor">{actor.id}:{actor.role}</div>
}

function stubCapabilities(auth: {
  enabled: boolean
  providers: ('github' | 'google')[]
  captcha: { provider: 'turnstile' | 'recaptcha'; siteKey: string } | null
  needsSetup: boolean
}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/capabilities')) {
      return new Response(JSON.stringify({
        capabilities: { imageProcessing: false, writableMediaStore: true, backgroundJobs: true },
        auth,
      }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }))
}

const ENABLED_NO_SETUP = { enabled: true, providers: [] as ('github' | 'google')[], captcha: null, needsSetup: false }

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
    mockUseSession.mockReturnValue({ data: null, isPending: true, isRefetching: false, error: null, refetch: vi.fn() } as never)

    render(<SessionGate><div>App</div></SessionGate>)

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
      refetch: vi.fn(),
    } as never)

    render(<SessionGate><ActorProbe /></SessionGate>)

    await waitFor(() => expect(screen.getByTestId('actor')).toHaveTextContent('u1:editor'))
  })

  it('defaults an unknown/missing role to viewer', async () => {
    stubCapabilities(ENABLED_NO_SETUP)
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u2', role: undefined } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    } as never)

    render(<SessionGate><ActorProbe /></SessionGate>)

    await waitFor(() => expect(screen.getByTestId('actor')).toHaveTextContent('u2:viewer'))
  })

  it('with a #setu-token in the hash: exchanges it, scrubs the hash before the response resolves, then renders children after session', async () => {
    stubCapabilities(ENABLED_NO_SETUP)
    window.location.hash = '#setu-token=abc123'

    let resolveExchange!: (v: Response) => void
    const exchangeFetch = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>((resolve) => { resolveExchange = resolve }))
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/capabilities')) {
        return new Response(JSON.stringify({
          capabilities: { imageProcessing: false, writableMediaStore: true, backgroundJobs: true },
          auth: ENABLED_NO_SETUP,
        }), { status: 200 })
      }
      if (String(url).includes('/local/exchange')) {
        return exchangeFetch(url, init)
      }
      return new Response('{}', { status: 200 })
    }))

    // No session until after the exchange completes.
    mockUseSession.mockReturnValue({ data: null, isPending: false, isRefetching: false, error: null, refetch: vi.fn() } as never)

    render(<SessionGate><ActorProbe /></SessionGate>)

    // The hash must be scrubbed BEFORE the exchange response resolves.
    await waitFor(() => expect(exchangeFetch).toHaveBeenCalled())
    expect(window.location.hash).toBe('')

    const [, exchangeInit] = exchangeFetch.mock.calls[0]!
    expect(exchangeInit).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ token: 'abc123' }),
    })

    // Resolve the exchange, then flip useSession to reflect the new session (mimics a refetch).
    resolveExchange(new Response(JSON.stringify({ status: true }), { status: 200 }))
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u3', role: 'admin' } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    } as never)

    await waitFor(() => expect(screen.getByTestId('actor')).toHaveTextContent('u3:admin'))
  })

  it('no session + auth disabled: renders the honest not-configured state, not a login form', async () => {
    stubCapabilities({ enabled: false, providers: [], captcha: null, needsSetup: false })
    mockUseSession.mockReturnValue({ data: null, isPending: false, isRefetching: false, error: null, refetch: vi.fn() } as never)

    render(<SessionGate><div>App</div></SessionGate>)

    expect(await screen.findByText(/auth (is )?not configured/i)).toBeInTheDocument()
    expect(screen.getByText(/SETU_AUTH_SECRET/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })

  it('no session + needsSetup: renders SetupScreen (#248 Task 7)', async () => {
    stubCapabilities({ enabled: true, providers: [], captcha: null, needsSetup: true })
    mockUseSession.mockReturnValue({ data: null, isPending: false, isRefetching: false, error: null, refetch: vi.fn() } as never)

    render(<SessionGate><div>App</div></SessionGate>)

    expect(await screen.findByRole('button', { name: /create admin account/i })).toBeInTheDocument()
  })

  it('no session, auth enabled, no setup needed: renders LoginScreen', async () => {
    stubCapabilities(ENABLED_NO_SETUP)
    mockUseSession.mockReturnValue({ data: null, isPending: false, isRefetching: false, error: null, refetch: vi.fn() } as never)

    render(<SessionGate><div>App</div></SessionGate>)

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })
})
