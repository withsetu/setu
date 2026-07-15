import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { SidebarProvider } from '@/components/ui/sidebar'
import { NotificationProvider } from '../src/ui/notify'
import { UserMenu } from '../src/shell/UserMenu'
import { authClient } from '../src/auth/auth-client'
import { resetHasPasswordStoreForTests } from '../src/auth/use-has-password'

// Radix DropdownMenu calls scrollIntoView when it opens — stub it for jsdom.
beforeAll(() => {
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.scrollIntoView
  ) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
})

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    useSession: vi.fn(),
    signOut: vi.fn(),
    updateUser: vi.fn(),
    listAccounts: vi.fn()
  }
}))

const mockUseSession = vi.mocked(authClient.useSession)
const mockSignOut = vi.mocked(authClient.signOut)
const mockUpdateUser = vi.mocked(authClient.updateUser)
const mockListAccounts = vi.mocked(authClient.listAccounts)

/** Exposes the router's current pathname so "Set password navigates to /users" is assertable. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

const renderMenu = () =>
  render(
    <MemoryRouter>
      <NotificationProvider>
        <SidebarProvider>
          <UserMenu />
        </SidebarProvider>
        <LocationProbe />
      </NotificationProvider>
    </MemoryRouter>
  )

afterEach(() => {
  vi.restoreAllMocks()
  // useHasPassword caches across instances by design — reset so each test's mocked
  // listAccounts answer is actually consulted.
  resetHasPasswordStoreForTests()
})

describe('UserMenu', () => {
  it('renders nothing when there is no real session (no-API local-owner mode)', () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    })
    renderMenu()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the user name/email and a sign-out action when a session exists', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'u1',
          name: 'Ada Lovelace',
          email: 'ada@setu.dev',
          role: 'admin'
        }
      },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    })

    renderMenu()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()

    // Radix DropdownMenu opens on Enter keydown (avoids PointerEvent jsdom issues — matches the
    // pattern already used by PublishMenu's tests).
    fireEvent.keyDown(screen.getByRole('button', { name: /Ada Lovelace/i }), {
      key: 'Enter'
    })
    const signOutItem = await screen.findByRole('menuitem', {
      name: /sign out/i
    })
    fireEvent.click(signOutItem)

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled())
  })

  it('falls back to email initial when name is absent', () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { id: 'u2', name: '', email: 'author@setu.dev', role: 'author' }
      },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    })

    renderMenu()
    expect(screen.getByText('author@setu.dev')).toBeInTheDocument()
  })

  describe('Your profile (#410 self-profile display name)', () => {
    /** Simulates better-auth's actual behavior after a real `updateUser` call: the client's
     *  `$sessionSignal` broadcast makes every `useSession()` subscriber refetch and see the new
     *  user (see auth-client.ts's `updateUser` citation) — here that's modeled by a mutable
     *  session object the mocked hook reads fresh on every call, so a re-render after the dialog
     *  closes picks up the updated name exactly like the real client would. */
    function mockAuthorSession(initialName: string) {
      const user = {
        id: 'u3',
        name: initialName,
        email: 'author@setu.dev',
        role: 'author'
      }
      mockUseSession.mockImplementation(() => ({
        data: { user: { ...user } },
        isPending: false,
        isRefetching: false,
        error: null,
        refetch: vi.fn()
      }))
      return user
    }

    async function openProfileDialog(triggerName: RegExp) {
      fireEvent.keyDown(screen.getByRole('button', { name: triggerName }), {
        key: 'Enter'
      })
      const item = await screen.findByRole('menuitem', {
        name: /your profile/i
      })
      fireEvent.click(item)
      return screen.findByRole('dialog', { name: /your profile/i })
    }

    it('is reachable for an author actor and shows the Display name field', async () => {
      mockAuthorSession('Grace Author')
      renderMenu()

      const dialog = await openProfileDialog(/Grace Author/i)
      expect(dialog).toBeInTheDocument()
      expect(screen.getByLabelText(/display name/i)).toHaveValue('Grace Author')
      expect(
        screen.getByRole('button', { name: /^save$/i })
      ).toBeInTheDocument()
    })

    it('saves a trimmed name, notifies success, and updates the visible name', async () => {
      const user = mockAuthorSession('Grace Author')
      mockUpdateUser.mockImplementation(async ({ name }) => {
        user.name = name ?? user.name
        return { data: { status: true }, error: null }
      })
      renderMenu()

      await openProfileDialog(/Grace Author/i)
      const input = screen.getByLabelText(/display name/i)
      fireEvent.change(input, { target: { value: '  Grace A. Hopper  ' } })
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

      await waitFor(() =>
        expect(mockUpdateUser).toHaveBeenCalledWith({
          name: 'Grace A. Hopper'
        })
      )
      expect(await screen.findByText('Name updated')).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByText('Grace A. Hopper')).toBeInTheDocument()
      )
    })

    it('rejects an empty/whitespace name with a field error and makes no call', async () => {
      mockAuthorSession('Grace Author')
      renderMenu()

      await openProfileDialog(/Grace Author/i)
      const input = screen.getByLabelText(/display name/i)
      fireEvent.change(input, { target: { value: '   ' } })
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

      expect(
        await screen.findByText(/display name is required/i)
      ).toBeInTheDocument()
      expect(mockUpdateUser).not.toHaveBeenCalled()
    })

    it('rejects a name over 100 characters with a field error and makes no call', async () => {
      mockAuthorSession('Grace Author')
      renderMenu()

      await openProfileDialog(/Grace Author/i)
      const input = screen.getByLabelText(/display name/i)
      fireEvent.change(input, { target: { value: 'x'.repeat(101) } })
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

      expect(
        await screen.findByText(/100 characters or fewer/i)
      ).toBeInTheDocument()
      expect(mockUpdateUser).not.toHaveBeenCalled()
    })
  })

  describe('Logout guard (#386 admin lockout recovery)', () => {
    function mockSignedInSession() {
      mockUseSession.mockReturnValue({
        data: {
          user: {
            id: 'u1',
            name: 'Ada Lovelace',
            email: 'ada@setu.dev',
            role: 'admin'
          }
        },
        isPending: false,
        isRefetching: false,
        error: null,
        refetch: vi.fn()
      })
    }

    async function openMenuAndClickSignOut() {
      fireEvent.keyDown(screen.getByRole('button', { name: /Ada Lovelace/i }), {
        key: 'Enter'
      })
      const signOutItem = await screen.findByRole('menuitem', {
        name: /sign out/i
      })
      fireEvent.click(signOutItem)
      return signOutItem
    }

    it('a user WITH a password signs out immediately — no dialog', async () => {
      mockSignedInSession()
      mockListAccounts.mockResolvedValue({
        data: [{ id: 'a1', providerId: 'credential' }],
        error: null
      })
      renderMenu()

      await openMenuAndClickSignOut()

      await waitFor(() => expect(mockSignOut).toHaveBeenCalled())
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('a passwordless user gets the guard dialog with all three actions instead of signing out', async () => {
      mockSignedInSession()
      mockListAccounts.mockResolvedValue({
        data: [{ id: 'a1', providerId: 'github' }],
        error: null
      })
      renderMenu()

      await openMenuAndClickSignOut()

      const dialog = await screen.findByRole('alertdialog', {
        name: /set a password before signing out\?/i
      })
      expect(dialog).toBeInTheDocument()
      expect(
        screen.getByText(/you'll need a fresh sign-in link/i)
      ).toBeInTheDocument()
      expect(screen.getByText(/pnpm auth:login-link/)).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /^cancel$/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /^set password$/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /sign out anyway/i })
      ).toBeInTheDocument()
      expect(mockSignOut).not.toHaveBeenCalled()
    })

    it('"Sign out anyway" calls signOut', async () => {
      mockSignedInSession()
      mockListAccounts.mockResolvedValue({ data: [], error: null })
      renderMenu()

      await openMenuAndClickSignOut()
      await screen.findByRole('alertdialog')

      fireEvent.click(screen.getByRole('button', { name: /sign out anyway/i }))
      await waitFor(() => expect(mockSignOut).toHaveBeenCalled())
    })

    it('"Set password" navigates to the Users screen and does not sign out', async () => {
      mockSignedInSession()
      mockListAccounts.mockResolvedValue({ data: [], error: null })
      renderMenu()

      await openMenuAndClickSignOut()
      await screen.findByRole('alertdialog')

      fireEvent.click(screen.getByRole('button', { name: /^set password$/i }))
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/users')
      )
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(mockSignOut).not.toHaveBeenCalled()
    })

    it('Cancel closes the dialog and keeps the session', async () => {
      mockSignedInSession()
      mockListAccounts.mockResolvedValue({ data: [], error: null })
      renderMenu()

      await openMenuAndClickSignOut()
      await screen.findByRole('alertdialog')

      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      )
      expect(mockSignOut).not.toHaveBeenCalled()
    })

    it('still-unknown after one refresh attempt signs out normally — never traps the user', async () => {
      mockSignedInSession()
      mockListAccounts.mockRejectedValue(new Error('api unreachable'))
      renderMenu()

      await openMenuAndClickSignOut()

      await waitFor(() => expect(mockSignOut).toHaveBeenCalled())
      expect(mockListAccounts).toHaveBeenCalled()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('shows a brief pending state on the menu item while the one refresh attempt is in flight', async () => {
      mockSignedInSession()
      let resolveAccounts!: (v: {
        data: { id: string; providerId: string }[]
        error: null
      }) => void
      mockListAccounts.mockReturnValue(
        new Promise((resolve) => {
          resolveAccounts = resolve
        })
      )
      renderMenu()

      const item = await openMenuAndClickSignOut()
      await waitFor(() => expect(item).toHaveTextContent(/signing out/i))

      resolveAccounts({
        data: [{ id: 'a1', providerId: 'credential' }],
        error: null
      })
      await waitFor(() => expect(mockSignOut).toHaveBeenCalled())
    })
  })
})
