import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { UsersScreen } from '../src/screens/users/UsersScreen'
import { authClient } from '../src/auth/auth-client'

// Radix Select/DropdownMenu/Tooltip call scrollIntoView / use PointerEvent APIs jsdom lacks.
beforeAll(() => {
  if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
  if (typeof window !== 'undefined' && !window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (typeof window !== 'undefined' && !window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = () => {}
  }
})

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    admin: {
      listUsers: vi.fn(),
      createUser: vi.fn(),
      setRole: vi.fn(),
      banUser: vi.fn(),
      unbanUser: vi.fn(),
      setUserPassword: vi.fn(),
    },
    changePassword: vi.fn(),
    listAccounts: vi.fn(),
  },
}))

const mockListUsers = vi.mocked(authClient.admin.listUsers)
const mockCreateUser = vi.mocked(authClient.admin.createUser)
const mockSetRole = vi.mocked(authClient.admin.setRole)
const mockBanUser = vi.mocked(authClient.admin.banUser)
const mockUnbanUser = vi.mocked(authClient.admin.unbanUser)
const mockSetUserPassword = vi.mocked(authClient.admin.setUserPassword)
const mockChangePassword = vi.mocked(authClient.changePassword)
const mockListAccounts = vi.mocked(authClient.listAccounts)

const now = new Date('2026-01-01T00:00:00Z')

const OWNER = {
  id: 'owner-1',
  email: 'owner@setu.dev',
  name: 'Ada Owner',
  emailVerified: true,
  createdAt: now,
  updatedAt: now,
  role: 'admin',
  banned: false,
}
const EDITOR = {
  id: 'editor-1',
  email: 'editor@setu.dev',
  name: 'Eve Editor',
  emailVerified: true,
  createdAt: now,
  updatedAt: now,
  role: 'editor',
  banned: false,
}
// #379: a disabled author fixture (viewer role removed) — exercises the "Disabled" row badge with
// a real staff role.
const DISABLED_AUTHOR = {
  id: 'author-1',
  email: 'author@setu.dev',
  name: 'Al Author',
  emailVerified: true,
  createdAt: now,
  updatedAt: now,
  role: 'author',
  banned: true,
}

function renderAsActor(role: 'admin' | 'editor' | 'author', id = 'owner-1') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NotificationProvider>
      <ActorProvider actor={{ id, role }}>{children}</ActorProvider>
    </NotificationProvider>
  )
  return render(<UsersScreen />, { wrapper })
}

/** Stubs the global `fetch` (apiFetch's underlying primitive) for GET /api/users/credential-status
 *  — the endpoint UsersScreen fetches alongside listUsers to render the "No password" row status
 *  (#248 Task 8 review, Finding 2). Defaults to "everyone has a password" (empty map would mean the
 *  opposite — absence is the passwordless signal) unless a test overrides it. */
function stubCredentialStatus(status: Record<string, boolean> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/users/credential-status')) {
        return new Response(JSON.stringify(status), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }),
  )
}

beforeEach(() => {
  // Default: OWNER/EDITOR/DISABLED_AUTHOR (the fixtures below) all have credential accounts, matching
  // the existing tests' assumption that nothing about password state was previously being asserted.
  stubCredentialStatus({ 'owner-1': true, 'editor-1': true, 'author-1': true })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('UsersScreen', () => {
  it('renders the user list with role badges, status, and created date', async () => {
    mockListUsers.mockResolvedValue({ data: { users: [OWNER, EDITOR, DISABLED_AUTHOR], total: 3 }, error: null } as never)
    mockListAccounts.mockResolvedValue({ data: [{ id: 'a1', providerId: 'credential' }], error: null } as never)

    renderAsActor('admin')

    expect(await screen.findByText('Ada Owner')).toBeInTheDocument()
    expect(screen.getByText('Eve Editor')).toBeInTheDocument()
    expect(screen.getByText('Al Author')).toBeInTheDocument()
    expect(screen.getByText('editor@setu.dev')).toBeInTheDocument()
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
  })

  it('shows a loading skeleton before users resolve', () => {
    mockListUsers.mockReturnValue(new Promise(() => {}) as never)
    mockListAccounts.mockReturnValue(new Promise(() => {}) as never)

    renderAsActor('admin')

    expect(screen.queryByText('Ada Owner')).not.toBeInTheDocument()
  })

  it('invite dialog validates fields and calls createUser, then refreshes the list', async () => {
    mockListUsers
      .mockResolvedValueOnce({ data: { users: [OWNER], total: 1 }, error: null } as never)
      .mockResolvedValueOnce({ data: { users: [OWNER, EDITOR], total: 2 }, error: null } as never)
    mockListAccounts.mockResolvedValue({ data: [{ id: 'a1', providerId: 'credential' }], error: null } as never)
    mockCreateUser.mockResolvedValue({ data: { user: EDITOR }, error: null } as never)

    renderAsActor('admin')
    await screen.findByText('Ada Owner')

    fireEvent.click(screen.getByRole('button', { name: /add user/i }))

    // Submitting empty should surface validation errors, not call createUser.
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^add user$/i }))
    expect(await within(dialog).findByText(/name is required/i)).toBeInTheDocument()
    expect(mockCreateUser).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: 'Eve Editor' } })
    fireEvent.change(within(dialog).getByLabelText(/^email$/i), { target: { value: 'editor@setu.dev' } })
    fireEvent.change(within(dialog).getByLabelText(/temporary password/i), { target: { value: 'a-very-long-password' } })

    // Choose a role via the Select.
    fireEvent.click(within(dialog).getByRole('combobox', { name: /role/i }))
    fireEvent.click(await screen.findByRole('option', { name: /editor/i }))

    fireEvent.click(within(dialog).getByRole('button', { name: /^add user$/i }))

    await waitFor(() =>
      expect(mockCreateUser).toHaveBeenCalledWith({
        name: 'Eve Editor',
        email: 'editor@setu.dev',
        password: 'a-very-long-password',
        role: 'editor',
      }),
    )
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(2))
  })

  it('changes a user role via setRole', async () => {
    mockListUsers.mockResolvedValue({ data: { users: [OWNER, EDITOR], total: 2 }, error: null } as never)
    mockListAccounts.mockResolvedValue({ data: [{ id: 'a1', providerId: 'credential' }], error: null } as never)
    mockSetRole.mockResolvedValue({ data: { user: { ...EDITOR, role: 'author' } }, error: null } as never)

    renderAsActor('admin')
    await screen.findByText('Eve Editor')

    const editorRoleSelect = screen.getByRole('combobox', { name: /change role for eve editor/i })
    fireEvent.click(editorRoleSelect)
    fireEvent.click(await screen.findByRole('option', { name: /^author$/i }))

    await waitFor(() => expect(mockSetRole).toHaveBeenCalledWith({ userId: 'editor-1', role: 'author' }))
  })

  it('disables the role-change control for your own row (cannot change your own role)', async () => {
    mockListUsers.mockResolvedValue({ data: { users: [OWNER, EDITOR], total: 2 }, error: null } as never)
    mockListAccounts.mockResolvedValue({ data: [{ id: 'a1', providerId: 'credential' }], error: null } as never)

    renderAsActor('admin', 'owner-1')
    await screen.findByText('Ada Owner')

    const ownRoleSelect = screen.getByRole('combobox', { name: /change role for ada owner/i })
    expect(ownRoleSelect).toBeDisabled()
  })

  it('disables role-change and disable actions for the last admin', async () => {
    mockListUsers.mockResolvedValue({ data: { users: [OWNER, EDITOR], total: 2 }, error: null } as never)
    mockListAccounts.mockResolvedValue({ data: [{ id: 'a1', providerId: 'credential' }], error: null } as never)

    // Render as the editor so the admin row is "someone else's row" — but the last-admin guard
    // should still apply regardless of who's looking, since demoting/disabling the sole admin
    // would lock everyone out.
    renderAsActor('editor', 'editor-1')
    await screen.findByText('Ada Owner')

    const ownerRoleSelect = screen.getByRole('combobox', { name: /change role for ada owner/i })
    expect(ownerRoleSelect).toBeDisabled()
  })

  it('disable user: confirms via alert-dialog, then calls banUser and refreshes', async () => {
    mockListUsers
      .mockResolvedValueOnce({ data: { users: [OWNER, EDITOR], total: 2 }, error: null } as never)
      .mockResolvedValueOnce({ data: { users: [OWNER, { ...EDITOR, banned: true }], total: 2 }, error: null } as never)
    mockListAccounts.mockResolvedValue({ data: [{ id: 'a1', providerId: 'credential' }], error: null } as never)
    mockBanUser.mockResolvedValue({ data: { user: { ...EDITOR, banned: true } }, error: null } as never)

    renderAsActor('admin')
    await screen.findByText('Eve Editor')

    // Radix DropdownMenu opens on Enter keydown (avoids PointerEvent jsdom issues — matches the
    // pattern already used by UserMenu's/PublishMenu's tests).
    fireEvent.keyDown(screen.getByRole('button', { name: /more actions for eve editor/i }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /disable user/i }))

    const confirmDialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmDialog).getByRole('button', { name: /^disable$/i }))

    await waitFor(() => expect(mockBanUser).toHaveBeenCalledWith({ userId: 'editor-1' }))
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(2))
  })

  it('cannot disable yourself: the disable action is guarded on your own row', async () => {
    mockListUsers.mockResolvedValue({ data: { users: [OWNER, EDITOR], total: 2 }, error: null } as never)
    mockListAccounts.mockResolvedValue({ data: [{ id: 'a1', providerId: 'credential' }], error: null } as never)

    renderAsActor('admin', 'owner-1')
    await screen.findByText('Ada Owner')

    fireEvent.keyDown(screen.getByRole('button', { name: /more actions for ada owner/i }), { key: 'Enter' })
    const disableItem = await screen.findByRole('menuitem', { name: /disable user/i })
    expect(disableItem).toHaveAttribute('aria-disabled', 'true')
  })

  describe('owner password / remote access', () => {
    it('shows "Set password" when the current user has no credential account', async () => {
      mockListUsers.mockResolvedValue({ data: { users: [OWNER], total: 1 }, error: null } as never)
      mockListAccounts.mockResolvedValue({ data: [], error: null } as never)

      renderAsActor('admin')

      expect(await screen.findByRole('button', { name: /^set password$/i })).toBeInTheDocument()
      expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument()
    })

    it('shows "Change password" (with current-password field) when a credential account exists', async () => {
      mockListUsers.mockResolvedValue({ data: { users: [OWNER], total: 1 }, error: null } as never)
      mockListAccounts.mockResolvedValue({ data: [{ id: 'a1', providerId: 'credential' }], error: null } as never)

      renderAsActor('admin')

      expect(await screen.findByRole('button', { name: /^change password$/i })).toBeInTheDocument()
      expect(screen.getByLabelText(/current password/i)).toBeInTheDocument()
    })

    it('validates password length + confirmation match before calling setUserPassword', async () => {
      mockListUsers.mockResolvedValue({ data: { users: [OWNER], total: 1 }, error: null } as never)
      mockListAccounts.mockResolvedValue({ data: [], error: null } as never)

      renderAsActor('admin')
      const submit = await screen.findByRole('button', { name: /^set password$/i })

      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'short' } })
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'short' } })
      fireEvent.click(submit)

      expect(await screen.findByText(/at least 12 characters/i)).toBeInTheDocument()
      expect(mockSetUserPassword).not.toHaveBeenCalled()
    })

    it('sets the owner password via admin.setUserPassword and shows the success toast', async () => {
      mockListUsers.mockResolvedValue({ data: { users: [OWNER], total: 1 }, error: null } as never)
      mockListAccounts.mockResolvedValue({ data: [], error: null } as never)
      mockSetUserPassword.mockResolvedValue({ data: { status: true }, error: null } as never)

      renderAsActor('admin', 'owner-1')
      await screen.findByRole('button', { name: /^set password$/i })

      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'a-very-long-password' } })
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'a-very-long-password' } })
      fireEvent.click(screen.getByRole('button', { name: /^set password$/i }))

      await waitFor(() =>
        expect(mockSetUserPassword).toHaveBeenCalledWith({ userId: 'owner-1', newPassword: 'a-very-long-password' }),
      )
      expect(await screen.findByText(/remote access enabled/i)).toBeInTheDocument()
    })

    it('changes an existing password via authClient.changePassword', async () => {
      mockListUsers.mockResolvedValue({ data: { users: [OWNER], total: 1 }, error: null } as never)
      mockListAccounts.mockResolvedValue({ data: [{ id: 'a1', providerId: 'credential' }], error: null } as never)
      mockChangePassword.mockResolvedValue({ data: { token: null }, error: null } as never)

      renderAsActor('admin')
      await screen.findByRole('button', { name: /^change password$/i })

      fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: 'old-password-123' } })
      fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'a-new-long-password' } })
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'a-new-long-password' } })
      fireEvent.click(screen.getByRole('button', { name: /^change password$/i }))

      await waitFor(() =>
        expect(mockChangePassword).toHaveBeenCalledWith({
          newPassword: 'a-new-long-password',
          currentPassword: 'old-password-123',
        }),
      )
    })
  })

  describe('credential status ("No password" row status)', () => {
    it('shows a "No password" badge on a row for a user with no credential account', async () => {
      mockListUsers.mockResolvedValue({ data: { users: [OWNER, EDITOR], total: 2 }, error: null } as never)
      mockListAccounts.mockResolvedValue({ data: [{ id: 'a1', providerId: 'credential' }], error: null } as never)
      // Only the owner has a credential account; editor is absent from the map -> passwordless.
      stubCredentialStatus({ 'owner-1': true })

      renderAsActor('admin')
      await screen.findByText('Eve Editor')

      const editorRow = screen.getByText('Eve Editor').closest('tr')
      expect(editorRow).not.toBeNull()
      expect(within(editorRow as HTMLElement).getByText(/no password/i)).toBeInTheDocument()

      const ownerRow = screen.getByText('Ada Owner').closest('tr')
      expect(ownerRow).not.toBeNull()
      expect(within(ownerRow as HTMLElement).queryByText(/no password/i)).not.toBeInTheDocument()
    })

    it('shows "No password" on the CURRENT user\'s own row too, consistent with the OwnerPasswordCard state', async () => {
      mockListUsers.mockResolvedValue({ data: { users: [OWNER], total: 1 }, error: null } as never)
      mockListAccounts.mockResolvedValue({ data: [], error: null } as never)
      stubCredentialStatus({}) // owner-1 absent -> passwordless

      renderAsActor('admin', 'owner-1')
      await screen.findByText('Ada Owner')

      const ownerRow = screen.getByText('Ada Owner').closest('tr')
      expect(within(ownerRow as HTMLElement).getByText(/no password/i)).toBeInTheDocument()
    })

    it('flips from "No password" to no badge after the credential-status map updates (e.g. after a password is set)', async () => {
      mockListUsers.mockResolvedValue({ data: { users: [OWNER], total: 1 }, error: null } as never)
      mockListAccounts.mockResolvedValue({ data: [], error: null } as never)
      stubCredentialStatus({})

      renderAsActor('admin', 'owner-1')
      const ownerRow = await screen.findByText('Ada Owner').then((el) => el.closest('tr') as HTMLElement)
      expect(within(ownerRow).getByText(/no password/i)).toBeInTheDocument()

      // Simulate the status flipping server-side (e.g. after OwnerPasswordCard's setUserPassword
      // succeeds) and the list being refreshed.
      stubCredentialStatus({ 'owner-1': true })
      mockListUsers.mockResolvedValue({ data: { users: [OWNER], total: 1 }, error: null } as never)
      mockSetUserPassword.mockResolvedValue({ data: { status: true }, error: null } as never)

      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'a-very-long-password' } })
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'a-very-long-password' } })
      fireEvent.click(screen.getByRole('button', { name: /^set password$/i }))

      await waitFor(() => expect(mockSetUserPassword).toHaveBeenCalled())
      await waitFor(() => {
        const row = screen.getByText('Ada Owner').closest('tr') as HTMLElement
        expect(within(row).queryByText(/no password/i)).not.toBeInTheDocument()
      })
    })
  })

  describe('invite dialog: Enter submits', () => {
    it('submits the invite form on Enter in a text field, same as clicking Add user', async () => {
      mockListUsers
        .mockResolvedValueOnce({ data: { users: [OWNER], total: 1 }, error: null } as never)
        .mockResolvedValueOnce({ data: { users: [OWNER, EDITOR], total: 2 }, error: null } as never)
      mockListAccounts.mockResolvedValue({ data: [{ id: 'a1', providerId: 'credential' }], error: null } as never)
      mockCreateUser.mockResolvedValue({ data: { user: EDITOR }, error: null } as never)

      renderAsActor('admin')
      await screen.findByText('Ada Owner')

      fireEvent.click(screen.getByRole('button', { name: /add user/i }))
      const dialog = await screen.findByRole('dialog')

      fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: 'Eve Editor' } })
      fireEvent.change(within(dialog).getByLabelText(/^email$/i), { target: { value: 'editor@setu.dev' } })
      fireEvent.change(within(dialog).getByLabelText(/temporary password/i), { target: { value: 'a-very-long-password' } })
      fireEvent.click(within(dialog).getByRole('combobox', { name: /role/i }))
      fireEvent.click(await screen.findByRole('option', { name: /editor/i }))

      // Submit via the <form>'s submit event (what a real Enter keypress in a text field
      // triggers natively — jsdom doesn't synthesize that from a raw keydown, so fireEvent.submit
      // on the form itself is the standard RTL way to assert "Enter submits", same mechanism
      // SetupScreen/LoginScreen rely on per Task 7).
      const form = dialog.querySelector('form')
      expect(form).not.toBeNull()
      fireEvent.submit(form as HTMLFormElement)

      await waitFor(() =>
        expect(mockCreateUser).toHaveBeenCalledWith({
          name: 'Eve Editor',
          email: 'editor@setu.dev',
          password: 'a-very-long-password',
          role: 'editor',
        }),
      )
    })
  })
})
