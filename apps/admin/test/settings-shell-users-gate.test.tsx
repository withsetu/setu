import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { IndexProvider } from '../src/data/index-store'
import { Settings } from '../src/screens/settings/Settings'

// Settings.tsx renders whichever group tab is active; only the 'general' tab is active on mount
// (the default), so that's the only settings screen whose own dependencies need to be live here.
vi.mock('../src/auth/auth-client', () => ({
  authClient: {
    admin: {
      listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      createUser: vi.fn(),
      setRole: vi.fn(),
      banUser: vi.fn(),
      unbanUser: vi.fn(),
      setUserPassword: vi.fn(),
    },
    changePassword: vi.fn(),
    listAccounts: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}))

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function renderSettings(role: 'owner' | 'editor' | 'viewer') {
  const git = createMemoryGitPort([])
  const services = servicesFor(createMemoryDataPort([]), git)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NotificationProvider>
      <ActorProvider actor={{ id: 'u1', role }}>
        <ServicesProvider services={services}>
          <DeployProvider>
            <IndexProvider>{children}</IndexProvider>
          </DeployProvider>
        </ServicesProvider>
      </ActorProvider>
    </NotificationProvider>
  )
  return render(<Settings />, { wrapper })
}

describe('Settings shell — Users & Roles gating', () => {
  it('shows the Users & Roles nav item for an owner (users.manage) and can navigate to it', async () => {
    renderSettings('owner')
    // Let GeneralSettings' own async settings.json read resolve before switching tabs, so its
    // state update lands before this test unmounts (avoids an unrelated act() warning).
    await screen.findByLabelText(/site title/i)
    const navItem = screen.getByRole('button', { name: /users & roles/i })
    expect(navItem).toBeInTheDocument()
    fireEvent.click(navItem)
    expect(await screen.findByText(/who can sign in and what they can do/i)).toBeInTheDocument()
  })

  it('hides the Users & Roles group entirely for an actor without users.manage', async () => {
    renderSettings('editor')
    await screen.findByLabelText(/site title/i)
    expect(screen.queryByRole('button', { name: /users & roles/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/who can sign in and what they can do/i)).not.toBeInTheDocument()
  })

  it('hides it for a viewer too', async () => {
    renderSettings('viewer')
    await screen.findByLabelText(/site title/i)
    expect(screen.queryByRole('button', { name: /users & roles/i })).not.toBeInTheDocument()
  })
})
