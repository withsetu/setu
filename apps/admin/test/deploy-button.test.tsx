import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Actor, DeployStatus } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '../src/shell/AppSidebar'

// Server truth stub (#208): 2 pending changes, rebuild available. mutable per-test.
const state: { status: DeployStatus | null } = {
  status: {
    deployedSha: 'abc1234def',
    deployedAt: '2026-07-09T00:00:00Z',
    headSha: 'head',
    pending: true,
    changedPaths: [
      { path: 'content/post/en/a.mdoc', added: false },
      { path: 'settings.json', added: false }
    ],
    job: null,
    canRebuild: true
  }
}
const mockRebuild = vi.fn(() => Promise.resolve())
vi.mock('../src/deploy/deploy', () => ({
  useDeploy: () => ({
    status: state.status,
    deployInfo: () => ({ deployedSha: null, changed: [] }),
    refresh: () => Promise.resolve(),
    rebuild: mockRebuild
  })
}))

function wrap(actor?: Actor) {
  return render(
    <MemoryRouter>
      <ActorProvider {...(actor ? { actor } : {})}>
        <NotificationProvider>
          <SidebarProvider>
            <AppSidebar />
          </SidebarProvider>
        </NotificationProvider>
      </ActorProvider>
    </MemoryRouter>
  )
}

describe('DeployFooterButton (via AppSidebar, #208/#209)', () => {
  it('shows the honest pending count and triggers a rebuild on click', async () => {
    wrap()
    const btn = screen.getByRole('button', { name: /publish site/i })
    expect(btn).toHaveTextContent('Publish · 2 pending')
    fireEvent.click(btn)
    await waitFor(() => expect(mockRebuild).toHaveBeenCalledOnce())
  })

  it('shows up-to-date with the deployed sha when nothing is pending', () => {
    state.status = {
      ...state.status!,
      pending: false,
      changedPaths: []
    }
    wrap()
    expect(
      screen.getByRole('button', { name: /publish site/i })
    ).toHaveTextContent('Up to date · abc1234')
    state.status = { ...state.status, pending: true } // restore
  })

  it('disables the control where the topology cannot rebuild (honest degrade)', () => {
    state.status = { ...state.status!, canRebuild: false }
    wrap()
    const btn = screen.getByRole('button', { name: /publish site/i })
    expect(btn).toBeDisabled()
    state.status = { ...state.status, canRebuild: true } // restore
  })

  it('renders nothing for an author (no site.deploy permission)', () => {
    // #379: author is the lowest staff role and lacks site.deploy (Maintainer+ only).
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
})
