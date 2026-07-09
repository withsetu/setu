import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { NotificationProvider } from '../src/ui/notify'
import { ResetPasswordScreen } from '../src/auth/ResetPasswordScreen'
import { authClient } from '../src/auth/auth-client'

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    resetPassword: vi.fn()
  }
}))

const mockResetPassword = vi.mocked(authClient.resetPassword)

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
  it('resets the password on a valid token, notifies success, and navigates to login', async () => {
    mockResetPassword.mockResolvedValue({ data: { status: true }, error: null })

    renderScreen()
    await fillForm()

    await waitFor(() =>
      expect(mockResetPassword).toHaveBeenCalledWith({
        newPassword: 'a-very-long-password',
        token: 'good-token'
      })
    )
    // SessionGate isn't mounted in this test — the stand-in "/" route proves navigate('/') fired,
    // which is what routes a signed-out visitor to LoginScreen in the real app.
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
})
