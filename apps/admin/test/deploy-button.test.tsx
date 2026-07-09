import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Actor } from '@setu/core'
import { ActorProvider } from '../src/auth/actor'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '../src/shell/AppSidebar'

// Default: no sha yet, deploy resolves immediately
const mockDeploy = vi.fn(() => Promise.resolve())
vi.mock('../src/deploy/deploy', () => ({
  useDeploy: () => ({ deployedAt: () => null, sha: null, deploy: mockDeploy })
}))

function wrap(actor?: Actor) {
  return render(
    <MemoryRouter>
      <ActorProvider {...(actor ? { actor } : {})}>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </ActorProvider>
    </MemoryRouter>
  )
}

describe('DeployFooterButton (via AppSidebar)', () => {
  it('renders a Deploy control for an owner and clicking does not crash', async () => {
    wrap()
    const btn = screen.getByRole('button', { name: /deploy site/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    // The deploy runs without crashing; label remains a deploy control.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /deploy/i })
      ).toBeInTheDocument()
    )
  })

  it('renders nothing for an author (no site.deploy permission)', () => {
    // #379: author is the lowest staff role and lacks site.deploy (Maintainer+ only).
    wrap({ id: 'a', role: 'author' })
    expect(
      screen.queryByRole('button', { name: /deploy/i })
    ).not.toBeInTheDocument()
  })
})
