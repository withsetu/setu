import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { NotificationProvider } from '../src/ui/notify'
import { ResetPasswordScreen } from '../src/auth/ResetPasswordScreen'
import { authClient } from '../src/auth/auth-client'

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    resetPassword: vi.fn(),
    useSession: vi.fn()
  }
}))

const mockResetPassword = vi.mocked(authClient.resetPassword)
const mockUseSession = vi.mocked(authClient.useSession)

function stubSession(user: { id: string } | null) {
  mockUseSession.mockReturnValue({
    data: user ? { user } : null,
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn()
  } as never)
}

beforeEach(() => {
  // Default: the signed-OUT visitor the #364 flow was built for; #453's signed-in tests override.
  stubSession(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderScreen(path = '/reset-password?token=good-token') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordScreen />} />
          <Route path="/" element={<div>Login placeholder</div>} />
        </Routes>
      </NotificationProvider>
    </MemoryRouter>
  )
}

async function fillForm(password = 'a-very-long-password', confirm = password) {
  fireEvent.change(screen.getByLabelText(/^new password$/i), {
    target: { value: password }
  })
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: confirm }
  })
  fireEvent.click(screen.getByRole('button', { name: /reset password/i }))
}

describe('ResetPasswordScreen', () => {
  it('resets the password on a valid token, notifies the SIGNED-OUT copy, and navigates to login', async () => {
    mockResetPassword.mockResolvedValue({ data: { status: true }, error: null })

    renderScreen()
    await fillForm()

    await waitFor(() =>
      expect(mockResetPassword).toHaveBeenCalledWith({
        newPassword: 'a-very-long-password',
        token: 'good-token'
      })
    )
    expect(
      await screen.findByText(/sign in with your new password/i)
    ).toBeInTheDocument()
    // SessionGate isn't mounted in this test — the stand-in "/" route proves navigate('/') fired,
    // which is what routes a signed-out visitor to LoginScreen in the real app.
    expect(await screen.findByText(/login placeholder/i)).toBeInTheDocument()
  })

  // #453 (second clause): Setu does not revoke sessions on reset, so a SIGNED-IN visitor
  // completing an emailed reset (the passwordless-maintainer recovery path) stays signed in —
  // telling them to "sign in with your new password" is a lie. They get success copy without the
  // sign-in instruction, and the same navigate('/') lands them on the dashboard (SessionGate
  // renders the app for a live session).
  it('signed-in visitor: success copy says the password was updated — NOT "sign in" — and navigates home', async () => {
    stubSession({ id: 'maint-1' })
    mockResetPassword.mockResolvedValue({ data: { status: true }, error: null })

    renderScreen()
    await fillForm()

    expect(await screen.findByText(/password updated/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/sign in with your new password/i)
    ).not.toBeInTheDocument()
    expect(await screen.findByText(/login placeholder/i)).toBeInTheDocument()
  })

  it('shows a field error and does not call resetPassword when confirm does not match', async () => {
    renderScreen()
    await fillForm('a-very-long-password', 'a-different-password')

    expect(await screen.findByText(/don't match/i)).toBeInTheDocument()
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('shows an honest message when the token is invalid/expired (INVALID_TOKEN)', async () => {
    mockResetPassword.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_TOKEN', message: 'Invalid token' }
    })

    renderScreen()
    await fillForm()

    expect(
      await screen.findByText(
        /this reset link has expired or was already used/i
      )
    ).toBeInTheDocument()
  })

  it('renders no form and an honest message when the URL carries no token', () => {
    renderScreen('/reset-password')

    expect(
      screen.getByText(/this reset link is missing its token/i)
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument()
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  // #453: better-auth's /reset-password/:token callback 302s expired/used links to
  // /reset-password?error=INVALID_TOKEN (no token param) — that is an expired-link landing, not a
  // malformed one, and must say so instead of the missing-token copy.
  it('shows the expired-or-used message (not the missing-token copy) when landing with ?error=INVALID_TOKEN', () => {
    renderScreen('/reset-password?error=INVALID_TOKEN')

    expect(screen.getByText(/expired or was already used/i)).toBeInTheDocument()
    expect(screen.queryByText(/missing its token/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /back to sign in/i })
    ).toBeInTheDocument()
    expect(mockResetPassword).not.toHaveBeenCalled()
  })
})
