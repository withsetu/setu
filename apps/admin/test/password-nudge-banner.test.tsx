import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Role } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { PasswordNudgeBanner } from '../src/auth/PasswordNudgeBanner'
import { authClient } from '../src/auth/auth-client'

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    listAccounts: vi.fn()
  }
}))

const mockListAccounts = vi.mocked(authClient.listAccounts)

const STORAGE_KEY = 'setu.password-nudge-dismissed'
const BANNER_TEXT = /you haven't set a password/i

function stubCapabilities(mode: string) {
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
            auth: {
              enabled: true,
              providers: [],
              captcha: null,
              needsSetup: false
            },
            mode
          }),
          { status: 200 }
        )
    )
  )
}

function renderBanner(role: Role = 'admin') {
  return render(
    <MemoryRouter>
      <ActorProvider actor={{ id: 'u1', role }}>
        <PasswordNudgeBanner />
      </ActorProvider>
    </MemoryRouter>
  )
}

const NO_CREDENTIAL = {
  data: [{ id: 'a1', providerId: 'github' }],
  error: null
}
const WITH_CREDENTIAL = {
  data: [{ id: 'a1', providerId: 'credential' }],
  error: null
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => vi.restoreAllMocks())

describe('PasswordNudgeBanner (#386)', () => {
  it('shows for a passwordless local admin: copy, Set-a-password link to /users, dismiss control', async () => {
    stubCapabilities('local')
    mockListAccounts.mockResolvedValue(NO_CREDENTIAL)
    renderBanner('admin')

    expect(await screen.findByText(BANNER_TEXT)).toBeInTheDocument()
    expect(
      screen.getByText(/signing out will lock you out of this browser/i)
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /set a password/i })
    expect(link).toHaveAttribute('href', '/users')
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument()
  })

  it('does not show outside local mode — and never even asks about accounts', async () => {
    stubCapabilities('self-hosted')
    mockListAccounts.mockResolvedValue(NO_CREDENTIAL)
    renderBanner('admin')

    // Give the capabilities fetch time to land before asserting absence.
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument()
    expect(mockListAccounts).not.toHaveBeenCalled()
  })

  it('does not show for a non-admin actor, even passwordless in local mode', async () => {
    stubCapabilities('local')
    mockListAccounts.mockResolvedValue(NO_CREDENTIAL)
    renderBanner('editor')

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument()
    expect(mockListAccounts).not.toHaveBeenCalled()
  })

  it('does not show once a credential account (password) exists', async () => {
    stubCapabilities('local')
    mockListAccounts.mockResolvedValue(WITH_CREDENTIAL)
    renderBanner('admin')

    await waitFor(() => expect(mockListAccounts).toHaveBeenCalled())
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument()
  })

  it('does not show while password state is unknown (fetch error → fail quiet, not alarmist)', async () => {
    stubCapabilities('local')
    mockListAccounts.mockResolvedValue({
      data: null,
      error: { status: 500, message: 'boom' }
    })
    renderBanner('admin')

    await waitFor(() => expect(mockListAccounts).toHaveBeenCalled())
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument()
  })

  it('stays hidden when previously dismissed on this machine, without refetching accounts', async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    stubCapabilities('local')
    mockListAccounts.mockResolvedValue(NO_CREDENTIAL)
    renderBanner('admin')

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument()
    expect(mockListAccounts).not.toHaveBeenCalled()
  })

  it('dismiss hides the banner and persists the machine-scoped flag', async () => {
    stubCapabilities('local')
    mockListAccounts.mockResolvedValue(NO_CREDENTIAL)
    renderBanner('admin')

    await screen.findByText(BANNER_TEXT)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })
})
