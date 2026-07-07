import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider, useCan } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { AppSidebar } from '../src/shell/AppSidebar'
import { UsersScreen } from '../src/screens/users/UsersScreen'

// #248: Users & Roles was promoted out of Settings to a first-class top-level screen/route
// (/users). This replaces the old settings-shell-users-gate.test.tsx, which asserted the
// (now-removed) Users group inside the Settings tabs. It now covers the two gate points that
// matter for a top-level destination: the sidebar nav item (AppSidebar) and the route itself
// (app.tsx's UsersRoute re-check) — mirroring the same "actor without users.view never sees it
// at all" contract the old Settings-embedded gate had.

vi.mock('../src/deploy/deploy', () => ({
  useDeploy: () => ({
    deployedAt: () => null,
    sha: null,
    deploy: () => Promise.resolve()
  })
}))

vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    // AppSidebar renders UserMenu in its footer, which calls useSession() unconditionally — mock
    // it to "no real session" (the no-API local-owner shape) so mounting the sidebar in isolation
    // doesn't blow up; these tests aren't about UserMenu.
    useSession: vi.fn().mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn()
    }),
    admin: {
      listUsers: vi
        .fn()
        .mockResolvedValue({ data: { users: [] }, error: null }),
      createUser: vi.fn(),
      setRole: vi.fn(),
      banUser: vi.fn(),
      unbanUser: vi.fn(),
      setUserPassword: vi.fn()
    },
    changePassword: vi.fn(),
    listAccounts: vi.fn().mockResolvedValue({ data: [], error: null })
  }
}))

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
)

afterEach(() => {
  // clearAllMocks (not restoreAllMocks): the auth-client mock's default return values
  // (mockResolvedValue/mockReturnValue above) are set once at module-mock time via the vi.mock
  // factory, not per-test — restoreAllMocks would wipe them back to bare vi.fn()s with no
  // implementation, breaking every subsequent test in this file.
  vi.clearAllMocks()
})

function renderSidebar(role: 'admin' | 'editor' | 'author') {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <ActorProvider actor={{ id: 'u1', role }}>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </ActorProvider>
    </MemoryRouter>
  )
}

describe('AppSidebar — Users nav item gating', () => {
  it('shows "Users" for an admin (has users.view)', () => {
    renderSidebar('admin')
    expect(screen.getByRole('link', { name: /^Users$/ })).toHaveAttribute(
      'href',
      '/users'
    )
  })

  it('hides "Users" for an editor (no users.view)', () => {
    renderSidebar('editor')
    expect(
      screen.queryByRole('link', { name: /^Users$/ })
    ).not.toBeInTheDocument()
  })

  it('hides "Users" for an author (no users.view)', () => {
    renderSidebar('author')
    expect(
      screen.queryByRole('link', { name: /^Users$/ })
    ).not.toBeInTheDocument()
  })
})

/** Minimal stand-in for app.tsx's UsersRoute + fallback, so this test exercises the exact
 *  render-time re-check without needing to mount the whole App/AppShell tree. */
function UsersRoute() {
  const can = useCan()
  if (!can('users.view')) return <Navigate to="/dashboard" replace />
  return <UsersScreen />
}

function renderUsersRoute(role: 'admin' | 'editor' | 'author') {
  const services = servicesFor(
    createMemoryDataPort([]),
    createMemoryGitPort([])
  )
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NotificationProvider>
      <ActorProvider actor={{ id: 'u1', role }}>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
  return render(
    <MemoryRouter initialEntries={['/users']}>
      <Routes>
        <Route path="/users" element={<UsersRoute />} />
        <Route path="/dashboard" element={<div>Dashboard fallback</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper }
  )
}

describe('/users route — defense-in-depth gate', () => {
  it('renders the Users screen for an admin', async () => {
    renderUsersRoute('admin')
    expect(
      await screen.findByRole('heading', { name: /users & roles/i })
    ).toBeInTheDocument()
  })

  it('redirects a non-permitted actor (editor) to the dashboard instead of rendering the screen', () => {
    renderUsersRoute('editor')
    expect(screen.getByText(/dashboard fallback/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /users & roles/i })
    ).not.toBeInTheDocument()
  })

  it('redirects an author too', () => {
    renderUsersRoute('author')
    expect(screen.getByText(/dashboard fallback/i)).toBeInTheDocument()
  })
})
