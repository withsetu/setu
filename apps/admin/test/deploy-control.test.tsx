import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { Actor, DeployStatus } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { SidebarProvider } from '@/components/ui/sidebar'
import { DeployControl } from '../src/deploy/DeployControl'

// Provider stub (#571): DeployControl is a pure consumer of useDeploy() — the provider's own
// polling/state is covered in deploy.test.tsx. Everything here is mutable per test.
const state: {
  status: DeployStatus | null
  running: boolean
  startedAt: number | null
  confirmOpen: boolean
} = {
  status: null,
  running: false,
  startedAt: null,
  confirmOpen: false
}
const mockRebuild = vi.fn(() => Promise.resolve())
const mockRefresh = vi.fn(() => Promise.resolve())
const mockRequestRebuild = vi.fn(() => {
  state.confirmOpen = true
})
const mockCloseConfirm = vi.fn(() => {
  state.confirmOpen = false
})

vi.mock('../src/deploy/deploy', () => ({
  useDeploy: () => ({
    status: state.status,
    deployInfo: () => ({ deployedSha: null, changed: [] }),
    refresh: mockRefresh,
    rebuild: mockRebuild,
    running: state.running,
    startedAt: state.startedAt,
    confirmOpen: state.confirmOpen,
    requestRebuild: mockRequestRebuild,
    closeConfirm: mockCloseConfirm
  })
}))

const baseStatus: DeployStatus = {
  deployedSha: 'abc1234def',
  deployedAt: '2026-07-09T00:00:00.000Z',
  headSha: 'head',
  pending: true,
  changedPaths: [
    { path: 'content/post/en/a.mdoc', added: false },
    { path: 'settings.json', added: false }
  ],
  job: null,
  canRebuild: true
}

function wrap(actor?: Actor) {
  return render(
    <ActorProvider {...(actor ? { actor } : {})}>
      <NotificationProvider>
        <SidebarProvider>
          <DeployControl />
        </SidebarProvider>
      </NotificationProvider>
    </ActorProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  state.status = { ...baseStatus }
  state.running = false
  state.startedAt = null
  state.confirmOpen = false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DeployControl — gating (#571)', () => {
  it('renders nothing for an author (no site.deploy permission)', () => {
    wrap({ id: 'a', role: 'author' })
    expect(
      screen.queryByRole('button', { name: /publish site/i })
    ).not.toBeInTheDocument()
  })

  it('renders nothing when server status is unavailable (fail closed)', () => {
    state.status = null
    wrap()
    expect(
      screen.queryByRole('button', { name: /publish site/i })
    ).not.toBeInTheDocument()
  })

  it('disables the control where the topology cannot rebuild', () => {
    state.status = { ...baseStatus, canRebuild: false }
    wrap()
    expect(screen.getByRole('button', { name: /publish site/i })).toBeDisabled()
  })
})

describe('DeployControl — confirmation before deploy (#571)', () => {
  it('does not deploy on click; it asks for confirmation first', async () => {
    wrap()
    fireEvent.click(screen.getByRole('button', { name: /publish site/i }))
    expect(mockRequestRebuild).toHaveBeenCalledOnce()
    expect(mockRebuild).not.toHaveBeenCalled()
    await Promise.resolve()
  })

  it('shows an honest confirmation dialog when the provider opens it', () => {
    state.confirmOpen = true
    wrap()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent(/publish site\?/i)
    // Saved ≠ live (CLAUDE.md card #7): the copy must not imply saving made it live.
    expect(dialog).toHaveTextContent(
      /saving to git does not update the live site/i
    )
    expect(dialog).toHaveTextContent(/until this build finishes/i)
    expect(dialog).toHaveTextContent(/2 saved changes/i)
  })

  it('cancelling closes the dialog without deploying', () => {
    state.confirmOpen = true
    wrap()
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(mockRebuild).not.toHaveBeenCalled()
    expect(mockCloseConfirm).toHaveBeenCalled()
  })

  it('confirming starts the rebuild', async () => {
    state.confirmOpen = true
    wrap()
    fireEvent.click(screen.getByRole('button', { name: /^publish now$/i }))
    await waitFor(() => expect(mockRebuild).toHaveBeenCalledOnce())
  })
})

describe('DeployControl — live progress (#571)', () => {
  it('turns the button into a progress bar with elapsed time while running', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    state.running = true
    state.startedAt = 1_000_000 - 12_000
    state.status = { ...baseStatus, job: null }
    wrap()
    const btn = screen.getByRole('button', { name: /publish site/i })
    expect(btn).toHaveTextContent(/building…/i)
    expect(btn).toHaveTextContent('12s')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(
      btn.querySelector('[data-slot="deploy-progress"]')
    ).toBeInTheDocument()
    // The elapsed readout ticks.
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(btn).toHaveTextContent('15s')
  })

  it('cannot be double-fired while a build is running', () => {
    state.running = true
    state.startedAt = Date.now()
    wrap()
    const btn = screen.getByRole('button', { name: /publish site/i })
    fireEvent.click(btn)
    expect(mockRequestRebuild).not.toHaveBeenCalled()
  })

  it('shows no progress bar when idle', () => {
    wrap()
    const btn = screen.getByRole('button', { name: /publish site/i })
    expect(btn.querySelector('[data-slot="deploy-progress"]')).toBeNull()
    expect(btn).toHaveTextContent('Publish · 2 pending')
  })
})

describe('DeployControl — honest outcome feedback (#571)', () => {
  it('reports success with the run duration', async () => {
    state.confirmOpen = true
    wrap()
    fireEvent.click(screen.getByRole('button', { name: /^publish now$/i }))
    await waitFor(() =>
      expect(screen.getByText(/site rebuilt in \d+s/i)).toBeInTheDocument()
    )
    expect(screen.getByText(/changes are live/i)).toBeInTheDocument()
  })

  it('reports a failed build as a failure — never a success toast', async () => {
    mockRebuild.mockRejectedValueOnce(new Error('astro build exited 1'))
    state.confirmOpen = true
    wrap()
    fireEvent.click(screen.getByRole('button', { name: /^publish now$/i }))
    await waitFor(() =>
      expect(screen.getByText(/rebuild failed/i)).toBeInTheDocument()
    )
    expect(screen.getByText(/astro build exited 1/i)).toBeInTheDocument()
    expect(screen.queryByText(/changes are live/i)).not.toBeInTheDocument()
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
  })
})

describe('DeployControl — last-built timestamp (#571)', () => {
  it('shows when the site was last built', () => {
    const at = new Date(Date.now() - 5 * 60_000).toISOString()
    state.status = { ...baseStatus, deployedAt: at }
    wrap()
    expect(screen.getByText(/last built 5m ago/i)).toBeInTheDocument()
  })

  it('is honest when the site has never been built', () => {
    state.status = { ...baseStatus, deployedSha: null, deployedAt: null }
    wrap()
    expect(screen.getByText(/never built/i)).toBeInTheDocument()
  })
})
