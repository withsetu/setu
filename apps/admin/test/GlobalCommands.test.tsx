import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Actor } from '@setu/core'
import {
  CommandRegistryProvider,
  useCommandRegistry
} from '../src/command/registry'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { GlobalCommands } from '../src/command/GlobalCommands'

// Mock useDeploy — the real DeployProvider fetches /api/deploy/status, which doesn't
// exist in jsdom. An active status (canRebuild) so the Publish command is registerable;
// capture rebuild to verify calls if needed.
const mockRebuild = vi.fn(() => Promise.resolve())
vi.mock('../src/deploy/deploy', () => ({
  useDeploy: () => ({
    running: false,
    startedAt: null,
    confirmOpen: false,
    requestRebuild: () => {},
    closeConfirm: () => {},
    status: {
      deployedSha: null,
      deployedAt: null,
      headSha: 'head',
      pending: true,
      changedPaths: [],
      job: null,
      canRebuild: true
    },
    deployInfo: () => ({ deployedSha: null, changed: [] }),
    refresh: () => Promise.resolve(),
    rebuild: mockRebuild
  })
}))

// Probe component — reads commands from registry and exposes them via data attrs.
function CommandProbe() {
  const { commands } = useCommandRegistry()
  return (
    <div data-testid="probe">
      {commands.map((c) => (
        <div
          key={c.id}
          data-testid={`cmd-${c.id}`}
          data-enabled={String(c.enabled?.() ?? true)}
        >
          {c.title}
        </div>
      ))}
    </div>
  )
}

function wrap(actor?: Actor) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <ActorProvider {...(actor ? { actor } : {})}>
        <NotificationProvider>
          <CommandRegistryProvider>
            {children}
            <CommandProbe />
          </CommandRegistryProvider>
        </NotificationProvider>
      </ActorProvider>
    </MemoryRouter>
  )
}

describe('GlobalCommands', () => {
  it('registers "New post" in the command registry', () => {
    const { getByText } = render(<GlobalCommands />, { wrapper: wrap() })
    expect(getByText('New post')).toBeInTheDocument()
  })

  it('registers "Posts" (nav action) in the command registry', () => {
    const { getByText } = render(<GlobalCommands />, { wrapper: wrap() })
    expect(getByText('Posts')).toBeInTheDocument()
  })

  it('registers the publish command in the command registry', () => {
    const { getByText } = render(<GlobalCommands />, { wrapper: wrap() })
    expect(getByText('Publish site (rebuild)')).toBeInTheDocument()
  })

  it('registers "Toggle theme" in the command registry', () => {
    const { getByText } = render(<GlobalCommands />, { wrapper: wrap() })
    expect(getByText('Toggle theme')).toBeInTheDocument()
  })

  it('Deploy site enabled() is true for an owner (default actor)', () => {
    const { getByTestId } = render(<GlobalCommands />, { wrapper: wrap() })
    expect(getByTestId('cmd-site.deploy').getAttribute('data-enabled')).toBe(
      'true'
    )
  })

  it("Publish site enabled() is false when the actor cannot 'site.deploy'", () => {
    // #379: author is the lowest staff role and lacks site.deploy (Maintainer+ only).
    const author: Actor = { id: 'a', role: 'author' }
    const { getByTestId } = render(<GlobalCommands />, {
      wrapper: wrap(author)
    })
    expect(getByTestId('cmd-site.deploy').getAttribute('data-enabled')).toBe(
      'false'
    )
  })

  it('renders null (no DOM output from GlobalCommands itself)', () => {
    const { container } = render(
      <MemoryRouter>
        <ActorProvider>
          <NotificationProvider>
            <CommandRegistryProvider>
              <GlobalCommands />
            </CommandRegistryProvider>
          </NotificationProvider>
        </ActorProvider>
      </MemoryRouter>
    )
    // GlobalCommands should not add any DOM elements beyond what providers add
    // The component itself renders null — the container should have only the notification region
    expect(container.querySelector('[data-testid]')).toBeNull()
  })
})
