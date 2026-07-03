import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { UserMenu } from '../src/shell/UserMenu'
import { authClient } from '../src/auth/auth-client'

// Radix DropdownMenu calls scrollIntoView when it opens — stub it for jsdom.
beforeAll(() => {
  if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    useSession: vi.fn(),
    signOut: vi.fn(),
  },
}))

const mockUseSession = vi.mocked(authClient.useSession)
const mockSignOut = vi.mocked(authClient.signOut)

const renderMenu = () => render(<SidebarProvider><UserMenu /></SidebarProvider>)

afterEach(() => vi.restoreAllMocks())

describe('UserMenu', () => {
  it('renders nothing when there is no real session (no-API local-owner mode)', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false, isRefetching: false, error: null, refetch: vi.fn() } as never)
    renderMenu()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the user name/email and a sign-out action when a session exists', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@setu.dev', role: 'owner' } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    } as never)

    renderMenu()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()

    // Radix DropdownMenu opens on Enter keydown (avoids PointerEvent jsdom issues — matches the
    // pattern already used by PublishMenu's tests).
    fireEvent.keyDown(screen.getByRole('button', { name: /Ada Lovelace/i }), { key: 'Enter' })
    const signOutItem = await screen.findByRole('menuitem', { name: /sign out/i })
    fireEvent.click(signOutItem)

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled())
  })

  it('falls back to email initial when name is absent', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u2', name: '', email: 'viewer@setu.dev', role: 'viewer' } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    } as never)

    renderMenu()
    expect(screen.getByText('viewer@setu.dev')).toBeInTheDocument()
  })
})
