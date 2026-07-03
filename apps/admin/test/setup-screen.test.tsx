import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SetupScreen } from '../src/auth/SetupScreen'
import { authClient } from '../src/auth/auth-client'

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    useSession: vi.fn(),
  },
}))

const mockUseSession = vi.mocked(authClient.useSession)

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => handler(url, init)))
}

async function fillForm(overrides: Partial<{ name: string; email: string; password: string; confirm: string; token: string }> = {}) {
  const values = {
    name: 'Ada Lovelace',
    email: 'ada@setu.dev',
    password: 'a-strong-password-12',
    confirm: 'a-strong-password-12',
    token: 'setup-token-abc',
    ...overrides,
  }
  fireEvent.change(await screen.findByLabelText(/^name$/i), { target: { value: values.name } })
  fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: values.email } })
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: values.password } })
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: values.confirm } })
  fireEvent.change(screen.getByLabelText(/setup token/i), { target: { value: values.token } })
}

beforeEach(() => {
  mockUseSession.mockReturnValue({ data: null, isPending: false, isRefetching: false, error: null, refetch: vi.fn() } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SetupScreen', () => {
  it('renders name, email, password, confirm-password, and setup-token fields with a primary submit button', async () => {
    stubFetch(async () => new Response('{}', { status: 200 }))
    render(<SetupScreen />)

    expect(await screen.findByLabelText(/^name$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/setup token/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create owner account|complete setup/i })).toBeInTheDocument()
  })

  it('shows the "printed in your server logs at boot" helper text under the setup-token field', async () => {
    render(<SetupScreen />)
    expect(await screen.findByText(/printed in your server logs at boot/i)).toBeInTheDocument()
  })

  it('client-side validates password length (min 12) before submitting', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    stubFetch(fetchSpy)
    render(<SetupScreen />)

    await fillForm({ password: 'short', confirm: 'short' })
    fireEvent.click(screen.getByRole('button', { name: /create owner account|complete setup/i }))

    expect(await screen.findByText(/at least 12 characters/i)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('client-side validates that password and confirm match before submitting', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    stubFetch(fetchSpy)
    render(<SetupScreen />)

    await fillForm({ password: 'a-strong-password-12', confirm: 'a-different-password' })
    fireEvent.click(screen.getByRole('button', { name: /create owner account|complete setup/i }))

    expect(await screen.findByText(/passwords (do not|don't) match/i)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('submits to POST /api/auth/setup with credentials included, and Enter submits the form', async () => {
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit) => new Response(JSON.stringify({ status: true }), { status: 200 }))
    stubFetch(fetchSpy)
    render(<SetupScreen />)

    await fillForm()
    fireEvent.submit(screen.getByRole('button', { name: /create owner account|complete setup/i }).closest('form')!)

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toMatch(/\/api\/auth\/setup$/)
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({
        name: 'Ada Lovelace',
        email: 'ada@setu.dev',
        password: 'a-strong-password-12',
        token: 'setup-token-abc',
      }),
    })
  })

  it('shows a loading state and disables submit while the request is in flight', async () => {
    let resolveFetch!: (v: Response) => void
    stubFetch(() => new Promise((resolve) => { resolveFetch = resolve }))
    render(<SetupScreen />)

    await fillForm()
    const button = screen.getByRole('button', { name: /create owner account|complete setup/i })
    fireEvent.click(button)

    await waitFor(() => expect(button).toBeDisabled())
    resolveFetch(new Response(JSON.stringify({ status: true }), { status: 200 }))
  })

  it('maps a bad-token 401 to the honest "check your server logs" message', async () => {
    stubFetch(async () => new Response(JSON.stringify({ message: 'invalid setup token' }), { status: 401 }))
    render(<SetupScreen />)

    await fillForm()
    fireEvent.click(screen.getByRole('button', { name: /create owner account|complete setup/i }))

    expect(await screen.findByText(/setup token doesn't match.*server logs/i)).toBeInTheDocument()
  })

  it('maps a 403 "setup already completed" to a toast/notice routing back to login', async () => {
    stubFetch(async () => new Response(JSON.stringify({ message: 'setup already completed' }), { status: 403 }))
    render(<SetupScreen />)

    await fillForm()
    fireEvent.click(screen.getByRole('button', { name: /create owner account|complete setup/i }))

    expect(await screen.findByText(/setup.*already.*complet/i)).toBeInTheDocument()
  })

  it('on success, refetches the session so SessionGate can re-resolve into the app', async () => {
    stubFetch(async () => new Response(JSON.stringify({ status: true }), { status: 200 }))
    const refetch = vi.fn()
    mockUseSession.mockReturnValue({ data: null, isPending: false, isRefetching: false, error: null, refetch } as never)

    render(<SetupScreen />)
    await fillForm()
    fireEvent.click(screen.getByRole('button', { name: /create owner account|complete setup/i }))

    await waitFor(() => expect(refetch).toHaveBeenCalled())
  })
})
