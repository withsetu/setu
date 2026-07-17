import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeAll,
  beforeEach
} from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { UsersScreen } from '../src/screens/users/UsersScreen'
import { authClient } from '../src/auth/auth-client'
import { resetHasPasswordStoreForTests } from '../src/auth/use-has-password'

// Radix Select/DropdownMenu/Tooltip call scrollIntoView / use PointerEvent APIs jsdom lacks.
beforeAll(() => {
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.scrollIntoView
  ) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.hasPointerCapture
  ) {
    window.HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (
    typeof window !== 'undefined' &&
    !window.HTMLElement.prototype.releasePointerCapture
  ) {
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
      setUserPassword: vi.fn()
    },
    changePassword: vi.fn(),
    listAccounts: vi.fn(),
    requestPasswordReset: vi.fn()
  }
}))

const mockListUsers = vi.mocked(authClient.admin.listUsers)
const mockCreateUser = vi.mocked(authClient.admin.createUser)
const mockSetRole = vi.mocked(authClient.admin.setRole)
const mockBanUser = vi.mocked(authClient.admin.banUser)
const mockSetUserPassword = vi.mocked(authClient.admin.setUserPassword)
const mockChangePassword = vi.mocked(authClient.changePassword)
const mockListAccounts = vi.mocked(authClient.listAccounts)
const mockRequestPasswordReset = vi.mocked(authClient.requestPasswordReset)

const now = new Date('2026-01-01T00:00:00Z')

const OWNER = {
  id: 'owner-1',
  email: 'owner@setu.dev',
  name: 'Ada Owner',
  emailVerified: true,
  createdAt: now,
  updatedAt: now,
  role: 'admin',
  banned: false
}
const EDITOR = {
  id: 'editor-1',
  email: 'editor@setu.dev',
  name: 'Eve Editor',
  emailVerified: true,
  createdAt: now,
  updatedAt: now,
  role: 'editor',
  banned: false
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
  banned: true
}
// #364: a maintainer fixture — used to exercise "maintainer does not outrank a peer maintainer",
// same rank ladder invariant the admin-vs-admin case would hit (neither is reachable via
// `outranks`, which is strict).
const MAINTAINER_USER = {
  id: 'maint-2',
  email: 'maintainer@setu.dev',
  name: 'Mo Maintainer',
  emailVerified: true,
  createdAt: now,
  updatedAt: now,
  role: 'maintainer',
  banned: false
}
// #364 review fix: a row whose role is an unrecognized string (a legacy/garbage value in the DB —
// 'viewer' was a real role removed in #379, so it's the realistic case). The server's rank guard
// fails closed on this target for any NON-admin actor (packages/auth/src/rank-guard.ts's
// rankGuardUpdateHook: targetRank <= 0 -> forbidden) but exempts admin BEFORE that check
// (`if (actorRole === 'admin') return`), so the UI must show the row read-only to a maintainer
// while leaving it manageable by an admin (the repair path).
const UNKNOWN_ROLE_USER = {
  id: 'legacy-1',
  email: 'legacy@setu.dev',
  name: 'Lena Legacy',
  emailVerified: true,
  createdAt: now,
  updatedAt: now,
  role: 'viewer',
  banned: false
}

function renderAsActor(
  role: 'admin' | 'maintainer' | 'editor' | 'author',
  id = 'owner-1'
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NotificationProvider>
      <ActorProvider actor={{ id, role }}>{children}</ActorProvider>
    </NotificationProvider>
  )
  return render(<UsersScreen />, { wrapper })
}

/** Stubs the global `fetch` (apiFetch's underlying primitive) for the three GETs UsersScreen makes:
 *  - `/api/users/credential-status` → the "No password" row status (#248 Task 8, Finding 2). Defaults
 *    to "everyone has a password" (empty map means the opposite — absence is the passwordless signal).
 *  - `/api/users` → the roster. Since #2 (UAT 2026-07-05) the list loads from Setu's own route, not
 *    better-auth's admin `listUsers`; this stub SOURCES the roster from the still-mocked
 *    `authClient.admin.listUsers` so every test keeps configuring fixtures + asserting call counts /
 *    resolved-value sequences via `mockListUsers`, exactly as before.
 *  - `/api/capabilities` (#364) → the same route `useCapabilities()` reads; `emailCaps` controls
 *    whether UserRowActions' "Send password reset email" item is enabled or disabled-with-tooltip
 *    (see UsersScreen.tsx's `resetGuard`). Defaults to a deliverable transport so every test that
 *    doesn't care about this capability sees the item enabled. */
function stubCredentialStatus(
  status: Record<string, boolean> = {},
  emailCaps: { transport: string; deliverable: boolean } = {
    transport: 'console',
    deliverable: true
  }
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/users/credential-status')) {
        return new Response(JSON.stringify(status), { status: 200 })
      }
      if (u.includes('/api/capabilities')) {
        return new Response(JSON.stringify({ email: emailCaps }), {
          status: 200
        })
      }
      if (u.includes('/api/users')) {
        const { data, error } = await authClient.admin.listUsers({
          query: { sortBy: 'createdAt', sortDirection: 'asc' }
        } as never)
        if (error || !data)
          return new Response(JSON.stringify({ error: 'forbidden' }), {
            status: 403
          })
        return new Response(JSON.stringify({ users: data.users }), {
          status: 200
        })
      }
      return new Response('not found', { status: 404 })
    })
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
  // useHasPassword caches across instances by design — reset so each test's mocked
  // listAccounts answer is actually consulted.
  resetHasPasswordStoreForTests()
})

describe('UsersScreen', () => {
  it('renders the user list with role badges, status, and created date', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [OWNER, EDITOR, DISABLED_AUTHOR], total: 3 },
      error: null
    })
    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a1', providerId: 'credential' }],
      error: null
    })

    renderAsActor('admin')

    expect(await screen.findByText('Ada Owner')).toBeInTheDocument()
    expect(screen.getByText('Eve Editor')).toBeInTheDocument()
    expect(screen.getByText('Al Author')).toBeInTheDocument()
    expect(screen.getByText('editor@setu.dev')).toBeInTheDocument()
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
  })

  // #554: user names/emails are free text — a very long value must truncate inside its cell
  // (full value on hover) instead of stretching the table past the viewport.
  it('truncates long user names and emails with the full value on hover (#554)', async () => {
    const LONG_NAME = 'Adelaide '.repeat(31).concat('Adelaide').slice(0, 285)
    const LONG_EMAIL = `${'adelaide.'.repeat(20)}adelaide@example.test`
    mockListUsers.mockResolvedValue({
      data: {
        users: [
          OWNER,
          { ...EDITOR, id: 'long-1', name: LONG_NAME, email: LONG_EMAIL }
        ],
        total: 2
      },
      error: null
    })
    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a1', providerId: 'credential' }],
      error: null
    })

    renderAsActor('admin')

    const name = await screen.findByTitle(LONG_NAME)
    expect(name).toHaveTextContent(LONG_NAME)
    expect(name.className).toContain('truncate')
    const email = screen.getByTitle(LONG_EMAIL)
    expect(email).toHaveTextContent(LONG_EMAIL)
    expect(email.className).toContain('truncate')
  })

  // #364: a maintainer holds `users.invite`/`users.setRole`/`users.disable`, but only for users
  // STRICTLY BELOW their own rank (packages/auth/src/rank-guard.ts enforces this server-side; this
  // UI mirrors it so a maintainer never sees a control that would 403). admin/maintainer rows stay
  // read-only; editor/author rows get the full role-Select + actions menu; the invite dialog only
  // offers roles below maintainer's own rank.
  it('maintainer manages below-rank rows only (author/editor actionable; maintainer/admin read-only; invite offers editor/author only)', async () => {
    mockListUsers.mockResolvedValue({
      data: {
        users: [OWNER, MAINTAINER_USER, EDITOR, DISABLED_AUTHOR],
        total: 4
      },
      error: null
    })
    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a1', providerId: 'credential' }],
      error: null
    })
    stubCredentialStatus({
      'owner-1': true,
      'maint-2': true,
      'editor-1': true,
      'author-1': true
    })

    renderAsActor('maintainer', 'maint-1')
    await screen.findByText('Ada Owner')

    // Read-only: admin and (peer) maintainer rows have no per-row Select/actions menu — a
    // maintainer never outranks another maintainer or an admin.
    expect(
      screen.queryByRole('combobox', { name: /change role for ada owner/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /more actions for ada owner/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', {
        name: /change role for mo maintainer/i
      })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /more actions for mo maintainer/i
      })
    ).not.toBeInTheDocument()

    // Actionable: editor and author rows (strictly below maintainer's rank) get real controls.
    expect(
      screen.getByRole('combobox', { name: /change role for eve editor/i })
    ).toBeInTheDocument()
    const editorActions = screen.getByRole('button', {
      name: /more actions for eve editor/i
    })
    expect(editorActions).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: /change role for al author/i })
    ).toBeInTheDocument()

    // No delete action exists anywhere in this UI, for any actor — the dropdown's only
    // destructive item is disable/enable.
    fireEvent.keyDown(editorActions, { key: 'Enter' })
    expect(
      await screen.findByRole('menuitem', { name: /disable user/i })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: /delete/i })
    ).not.toBeInTheDocument()
    fireEvent.keyDown(editorActions, { key: 'Escape' })

    // Maintainer holds users.invite -> "Add user" IS offered (unlike the old admin-only gate),
    // and its role options are capped strictly below maintainer's own rank.
    fireEvent.click(screen.getByRole('button', { name: /add user/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('combobox', { name: /role/i }))
    expect(
      await screen.findByRole('option', { name: /editor/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /author/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: /maintainer/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: /^admin/i })
    ).not.toBeInTheDocument()
  })

  it('shows a loading skeleton before users resolve', () => {
    mockListUsers.mockReturnValue(new Promise(() => {}) as never)
    mockListAccounts.mockReturnValue(new Promise(() => {}) as never)

    renderAsActor('admin')

    expect(screen.queryByText('Ada Owner')).not.toBeInTheDocument()
  })

  it('invite dialog validates fields and calls createUser, then refreshes the list', async () => {
    mockListUsers
      .mockResolvedValueOnce({
        data: { users: [OWNER], total: 1 },
        error: null
      })
      .mockResolvedValueOnce({
        data: { users: [OWNER, EDITOR], total: 2 },
        error: null
      })
    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a1', providerId: 'credential' }],
      error: null
    })
    mockCreateUser.mockResolvedValue({
      data: { user: EDITOR },
      error: null
    })

    renderAsActor('admin')
    await screen.findByText('Ada Owner')

    fireEvent.click(screen.getByRole('button', { name: /add user/i }))

    // Submitting empty should surface validation errors, not call createUser.
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^add user$/i }))
    expect(
      await within(dialog).findByText(/name is required/i)
    ).toBeInTheDocument()
    expect(mockCreateUser).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText(/^name$/i), {
      target: { value: 'Eve Editor' }
    })
    fireEvent.change(within(dialog).getByLabelText(/^email$/i), {
      target: { value: 'editor@setu.dev' }
    })
    fireEvent.change(within(dialog).getByLabelText(/temporary password/i), {
      target: { value: 'a-very-long-password' }
    })

    // Choose a role via the Select.
    fireEvent.click(within(dialog).getByRole('combobox', { name: /role/i }))
    fireEvent.click(await screen.findByRole('option', { name: /editor/i }))

    fireEvent.click(within(dialog).getByRole('button', { name: /^add user$/i }))

    await waitFor(() =>
      expect(mockCreateUser).toHaveBeenCalledWith({
        name: 'Eve Editor',
        email: 'editor@setu.dev',
        password: 'a-very-long-password',
        role: 'editor'
      })
    )
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(2))
  })

  it('changes a user role via setRole', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [OWNER, EDITOR], total: 2 },
      error: null
    })
    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a1', providerId: 'credential' }],
      error: null
    })
    mockSetRole.mockResolvedValue({
      data: { user: { ...EDITOR, role: 'author' } },
      error: null
    })

    renderAsActor('admin')
    await screen.findByText('Eve Editor')

    const editorRoleSelect = screen.getByRole('combobox', {
      name: /change role for eve editor/i
    })
    fireEvent.click(editorRoleSelect)
    fireEvent.click(await screen.findByRole('option', { name: /^author$/i }))

    await waitFor(() =>
      expect(mockSetRole).toHaveBeenCalledWith({
        userId: 'editor-1',
        role: 'author'
      })
    )
  })

  it('disables the role-change control for your own row (cannot change your own role)', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [OWNER, EDITOR], total: 2 },
      error: null
    })
    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a1', providerId: 'credential' }],
      error: null
    })

    renderAsActor('admin', 'owner-1')
    await screen.findByText('Ada Owner')

    const ownRoleSelect = screen.getByRole('combobox', {
      name: /change role for ada owner/i
    })
    expect(ownRoleSelect).toBeDisabled()
  })

  // (Removed 2026-07-05) The old "last admin guarded regardless of viewer" test rendered the screen
  // as an editor — but management controls are now admin-only (#2), so a non-admin viewer has no
  // controls to guard, and the scenario is unreachable in a valid state anyway (a sole admin can only
  // be viewed by a non-admin). The sole admin's own-row self-guards (below) plus the server-side
  // last-owner-guard (packages/auth last-owner-guard.test.ts) are the real coverage.

  it('disable user: confirms via alert-dialog, then calls banUser and refreshes', async () => {
    mockListUsers
      .mockResolvedValueOnce({
        data: { users: [OWNER, EDITOR], total: 2 },
        error: null
      })
      .mockResolvedValueOnce({
        data: { users: [OWNER, { ...EDITOR, banned: true }], total: 2 },
        error: null
      })
    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a1', providerId: 'credential' }],
      error: null
    })
    mockBanUser.mockResolvedValue({
      data: { user: { ...EDITOR, banned: true } },
      error: null
    })

    renderAsActor('admin')
    await screen.findByText('Eve Editor')

    // Radix DropdownMenu opens on Enter keydown (avoids PointerEvent jsdom issues — matches the
    // pattern already used by UserMenu's/PublishMenu's tests).
    fireEvent.keyDown(
      screen.getByRole('button', { name: /more actions for eve editor/i }),
      { key: 'Enter' }
    )
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /disable user/i })
    )

    const confirmDialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(confirmDialog).getByRole('button', { name: /^disable$/i })
    )

    await waitFor(() =>
      expect(mockBanUser).toHaveBeenCalledWith({ userId: 'editor-1' })
    )
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(2))
  })

  it('cannot disable yourself: the disable action is guarded on your own row', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [OWNER, EDITOR], total: 2 },
      error: null
    })
    mockListAccounts.mockResolvedValue({
      data: [{ id: 'a1', providerId: 'credential' }],
      error: null
    })

    renderAsActor('admin', 'owner-1')
    await screen.findByText('Ada Owner')

    fireEvent.keyDown(
      screen.getByRole('button', { name: /more actions for ada owner/i }),
      { key: 'Enter' }
    )
    const disableItem = await screen.findByRole('menuitem', {
      name: /disable user/i
    })
    expect(disableItem).toHaveAttribute('aria-disabled', 'true')
  })

  describe('owner password / remote access', () => {
    it('shows "Set password" when the current user has no credential account', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER], total: 1 },
        error: null
      })
      mockListAccounts.mockResolvedValue({ data: [], error: null })

      renderAsActor('admin')

      expect(
        await screen.findByRole('button', { name: /^set password$/i })
      ).toBeInTheDocument()
      expect(
        screen.queryByLabelText(/current password/i)
      ).not.toBeInTheDocument()
    })

    it('shows "Change password" (with current-password field) when a credential account exists', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER], total: 1 },
        error: null
      })
      mockListAccounts.mockResolvedValue({
        data: [{ id: 'a1', providerId: 'credential' }],
        error: null
      })

      renderAsActor('admin')

      expect(
        await screen.findByRole('button', { name: /^change password$/i })
      ).toBeInTheDocument()
      expect(screen.getByLabelText(/current password/i)).toBeInTheDocument()
    })

    it('validates password length + confirmation match before calling setUserPassword', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER], total: 1 },
        error: null
      })
      mockListAccounts.mockResolvedValue({ data: [], error: null })

      renderAsActor('admin')
      const submit = await screen.findByRole('button', {
        name: /^set password$/i
      })

      fireEvent.change(screen.getByLabelText(/^password$/i), {
        target: { value: 'short' }
      })
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'short' }
      })
      fireEvent.click(submit)

      expect(
        await screen.findByText(/at least 12 characters/i)
      ).toBeInTheDocument()
      expect(mockSetUserPassword).not.toHaveBeenCalled()
    })

    it('sets the owner password via admin.setUserPassword and shows the success toast', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER], total: 1 },
        error: null
      })
      mockListAccounts.mockResolvedValue({ data: [], error: null })
      mockSetUserPassword.mockResolvedValue({
        data: { status: true },
        error: null
      })

      renderAsActor('admin', 'owner-1')
      await screen.findByRole('button', { name: /^set password$/i })

      fireEvent.change(screen.getByLabelText(/^password$/i), {
        target: { value: 'a-very-long-password' }
      })
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'a-very-long-password' }
      })
      fireEvent.click(screen.getByRole('button', { name: /^set password$/i }))

      await waitFor(() =>
        expect(mockSetUserPassword).toHaveBeenCalledWith({
          userId: 'owner-1',
          newPassword: 'a-very-long-password'
        })
      )
      expect(
        await screen.findByText(/remote access enabled/i)
      ).toBeInTheDocument()
    })

    it('changes an existing password via authClient.changePassword', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER], total: 1 },
        error: null
      })
      mockListAccounts.mockResolvedValue({
        data: [{ id: 'a1', providerId: 'credential' }],
        error: null
      })
      mockChangePassword.mockResolvedValue({
        data: { token: null },
        error: null
      })

      renderAsActor('admin')
      await screen.findByRole('button', { name: /^change password$/i })

      fireEvent.change(screen.getByLabelText(/current password/i), {
        target: { value: 'old-password-123' }
      })
      fireEvent.change(screen.getByLabelText(/new password/i), {
        target: { value: 'a-new-long-password' }
      })
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'a-new-long-password' }
      })
      fireEvent.click(
        screen.getByRole('button', { name: /^change password$/i })
      )

      await waitFor(() =>
        expect(mockChangePassword).toHaveBeenCalledWith({
          newPassword: 'a-new-long-password',
          currentPassword: 'old-password-123'
        })
      )
    })
  })

  describe('credential status ("No password" row status)', () => {
    it('shows a "No password" badge on a row for a user with no credential account', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER, EDITOR], total: 2 },
        error: null
      })
      mockListAccounts.mockResolvedValue({
        data: [{ id: 'a1', providerId: 'credential' }],
        error: null
      })
      // Only the owner has a credential account; editor is absent from the map -> passwordless.
      stubCredentialStatus({ 'owner-1': true })

      renderAsActor('admin')
      await screen.findByText('Eve Editor')

      const editorRow = screen.getByText('Eve Editor').closest('tr')
      expect(editorRow).not.toBeNull()
      expect(
        within(editorRow as HTMLElement).getByText(/no password/i)
      ).toBeInTheDocument()

      const ownerRow = screen.getByText('Ada Owner').closest('tr')
      expect(ownerRow).not.toBeNull()
      expect(
        within(ownerRow as HTMLElement).queryByText(/no password/i)
      ).not.toBeInTheDocument()
    })

    it('shows "No password" on the CURRENT user\'s own row too, consistent with the OwnerPasswordCard state', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER], total: 1 },
        error: null
      })
      mockListAccounts.mockResolvedValue({ data: [], error: null })
      stubCredentialStatus({}) // owner-1 absent -> passwordless

      renderAsActor('admin', 'owner-1')
      await screen.findByText('Ada Owner')

      const ownerRow = screen.getByText('Ada Owner').closest('tr')
      expect(
        within(ownerRow as HTMLElement).getByText(/no password/i)
      ).toBeInTheDocument()
    })

    it('flips from "No password" to no badge after the credential-status map updates (e.g. after a password is set)', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER], total: 1 },
        error: null
      })
      mockListAccounts.mockResolvedValue({ data: [], error: null })
      stubCredentialStatus({})

      renderAsActor('admin', 'owner-1')
      const ownerRow = await screen
        .findByText('Ada Owner')
        .then((el) => el.closest('tr') as HTMLElement)
      expect(within(ownerRow).getByText(/no password/i)).toBeInTheDocument()

      // Simulate the status flipping server-side (e.g. after OwnerPasswordCard's setUserPassword
      // succeeds) and the list being refreshed.
      stubCredentialStatus({ 'owner-1': true })
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER], total: 1 },
        error: null
      })
      mockSetUserPassword.mockResolvedValue({
        data: { status: true },
        error: null
      })

      fireEvent.change(screen.getByLabelText(/^password$/i), {
        target: { value: 'a-very-long-password' }
      })
      fireEvent.change(screen.getByLabelText(/confirm password/i), {
        target: { value: 'a-very-long-password' }
      })
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
        .mockResolvedValueOnce({
          data: { users: [OWNER], total: 1 },
          error: null
        })
        .mockResolvedValueOnce({
          data: { users: [OWNER, EDITOR], total: 2 },
          error: null
        })
      mockListAccounts.mockResolvedValue({
        data: [{ id: 'a1', providerId: 'credential' }],
        error: null
      })
      mockCreateUser.mockResolvedValue({
        data: { user: EDITOR },
        error: null
      })

      renderAsActor('admin')
      await screen.findByText('Ada Owner')

      fireEvent.click(screen.getByRole('button', { name: /add user/i }))
      const dialog = await screen.findByRole('dialog')

      fireEvent.change(within(dialog).getByLabelText(/^name$/i), {
        target: { value: 'Eve Editor' }
      })
      fireEvent.change(within(dialog).getByLabelText(/^email$/i), {
        target: { value: 'editor@setu.dev' }
      })
      fireEvent.change(within(dialog).getByLabelText(/temporary password/i), {
        target: { value: 'a-very-long-password' }
      })
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
          role: 'editor'
        })
      )
    })
  })

  // #364: the row-action trigger for "Send password reset email" — gated on the target being
  // outranked, having a credential account (nothing to reset otherwise), and the workspace's email
  // transport actually being able to deliver (apps/api/src/capabilities.ts's `email.deliverable`).
  describe('reset password email action', () => {
    it('sends a reset email for an outranked row with a credential account, when email is deliverable', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER, EDITOR], total: 2 },
        error: null
      })
      mockListAccounts.mockResolvedValue({
        data: [{ id: 'a1', providerId: 'credential' }],
        error: null
      })
      stubCredentialStatus(
        { 'owner-1': true, 'editor-1': true },
        { transport: 'console', deliverable: true }
      )
      mockRequestPasswordReset.mockResolvedValue({
        data: { status: true, message: '' },
        error: null
      })

      renderAsActor('admin', 'owner-1')
      await screen.findByText('Eve Editor')

      fireEvent.keyDown(
        screen.getByRole('button', { name: /more actions for eve editor/i }),
        { key: 'Enter' }
      )
      fireEvent.click(
        await screen.findByRole('menuitem', {
          name: /send password reset email/i
        })
      )

      await waitFor(() =>
        expect(mockRequestPasswordReset).toHaveBeenCalledWith({
          email: 'editor@setu.dev',
          redirectTo: `${window.location.origin}/reset-password`
        })
      )
      expect(
        await screen.findByText(
          /password reset email sent to editor@setu\.dev/i
        )
      ).toBeInTheDocument()
    })

    it('renders the reset item disabled with the honest capability tooltip when email is not deliverable', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER, EDITOR], total: 2 },
        error: null
      })
      mockListAccounts.mockResolvedValue({
        data: [{ id: 'a1', providerId: 'credential' }],
        error: null
      })
      stubCredentialStatus(
        { 'owner-1': true, 'editor-1': true },
        { transport: 'console', deliverable: false }
      )

      renderAsActor('admin', 'owner-1')
      await screen.findByText('Eve Editor')

      fireEvent.keyDown(
        screen.getByRole('button', { name: /more actions for eve editor/i }),
        { key: 'Enter' }
      )
      const item = await screen.findByRole('menuitem', {
        name: /send password reset email/i
      })
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(mockRequestPasswordReset).not.toHaveBeenCalled()
    })

    it('hides the reset item entirely for a row with no credential account', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER, EDITOR], total: 2 },
        error: null
      })
      mockListAccounts.mockResolvedValue({
        data: [{ id: 'a1', providerId: 'credential' }],
        error: null
      })
      // Only the owner has a credential account; editor is absent -> passwordless, nothing to reset.
      stubCredentialStatus({ 'owner-1': true })

      renderAsActor('admin', 'owner-1')
      await screen.findByText('Eve Editor')

      fireEvent.keyDown(
        screen.getByRole('button', { name: /more actions for eve editor/i }),
        { key: 'Enter' }
      )
      expect(
        screen.queryByRole('menuitem', { name: /send password reset email/i })
      ).not.toBeInTheDocument()
    })

    it('is never offered on a row with an unrecognized role, even for an admin (fail-closed on unknown targets)', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER, UNKNOWN_ROLE_USER], total: 2 },
        error: null
      })
      mockListAccounts.mockResolvedValue({
        data: [{ id: 'a1', providerId: 'credential' }],
        error: null
      })
      stubCredentialStatus({ 'owner-1': true, 'legacy-1': true })

      renderAsActor('admin', 'owner-1')
      await screen.findByText('Lena Legacy')

      // Admin still gets the row's actions menu (repair path — see the rank-parity tests below),
      // but the reset item is hidden: `outranks` would treat the unknown role as rank 0 ("always
      // outranked"), so it is additionally gated on the role being a KNOWN one.
      fireEvent.keyDown(
        screen.getByRole('button', { name: /more actions for lena legacy/i }),
        { key: 'Enter' }
      )
      expect(
        await screen.findByRole('menuitem', { name: /disable user/i })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: /send password reset email/i })
      ).not.toBeInTheDocument()
    })

    it('is never offered on a row the actor does not outrank (maintainer viewing a peer maintainer)', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [MAINTAINER_USER], total: 1 },
        error: null
      })
      mockListAccounts.mockResolvedValue({ data: [], error: null })
      stubCredentialStatus({ 'maint-2': true })

      renderAsActor('maintainer', 'maint-1')
      await screen.findByText('Mo Maintainer')

      // The whole row is read-only for a non-outranked target — no actions menu at all, so the
      // reset item can't appear either.
      expect(
        screen.queryByRole('button', {
          name: /more actions for mo maintainer/i
        })
      ).not.toBeInTheDocument()
    })
  })

  // #364 review fix: UI↔server parity for rows with an unrecognized role string. The server's
  // rank guard (packages/auth/src/rank-guard.ts, rankGuardUpdateHook) forbids a NON-admin actor
  // from touching an unknown-role target (`targetRank <= 0` -> forbidden) but returns early for an
  // admin actor BEFORE that check — admin can act on such rows (that's the only way to repair a
  // legacy role). The UI must mirror both halves so a maintainer never sees a control that 403s.
  describe('unknown-role rows (fail-closed parity with the server rank guard)', () => {
    it('maintainer sees an unknown-role row read-only (no role select, no actions menu)', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [EDITOR, UNKNOWN_ROLE_USER], total: 2 },
        error: null
      })
      mockListAccounts.mockResolvedValue({ data: [], error: null })
      stubCredentialStatus({ 'editor-1': true, 'legacy-1': true })

      renderAsActor('maintainer', 'maint-1')
      await screen.findByText('Lena Legacy')

      expect(
        screen.queryByRole('combobox', { name: /change role for lena legacy/i })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /more actions for lena legacy/i })
      ).not.toBeInTheDocument()
      // Sanity: the below-rank editor row on the same roster IS actionable, so the read-only
      // rendering above is the unknown-role gate, not a broken roster.
      expect(
        screen.getByRole('combobox', { name: /change role for eve editor/i })
      ).toBeInTheDocument()
    })

    it('admin can manage an unknown-role row (the repair path the server allows)', async () => {
      mockListUsers.mockResolvedValue({
        data: { users: [OWNER, UNKNOWN_ROLE_USER], total: 2 },
        error: null
      })
      mockListAccounts.mockResolvedValue({
        data: [{ id: 'a1', providerId: 'credential' }],
        error: null
      })
      stubCredentialStatus({ 'owner-1': true, 'legacy-1': true })
      mockSetRole.mockResolvedValue({
        data: { user: { ...UNKNOWN_ROLE_USER, role: 'author' } },
        error: null
      })

      renderAsActor('admin', 'owner-1')
      await screen.findByText('Lena Legacy')

      // The role Select is ENABLED (unknown current role is repairable), offering the below-rank
      // options; picking one calls setRole — the exact server route admin is exempted on.
      const legacySelect = screen.getByRole('combobox', {
        name: /change role for lena legacy/i
      })
      expect(legacySelect).not.toBeDisabled()
      fireEvent.click(legacySelect)
      fireEvent.click(await screen.findByRole('option', { name: /^author$/i }))

      await waitFor(() =>
        expect(mockSetRole).toHaveBeenCalledWith({
          userId: 'legacy-1',
          role: 'author'
        })
      )
    })
  })
})
