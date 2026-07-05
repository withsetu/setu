import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { ServicesProvider, servicesFor } from '../src/data/store'
import { Settings } from '../src/screens/settings/Settings'

// #371 UAT follow-up: Settings is visible to `settings.view` (maintainer+) but only editable by
// `settings.manage` (admin). The server already 403s a maintainer's settings write (the settings-
// aware git gate); this asserts the client presents the surface READ-ONLY so a maintainer never
// triggers that error — the matching UI half of the enforcement.

vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })))

afterEach(() => vi.clearAllMocks())

function renderSettings(role: 'admin' | 'maintainer') {
  const services = servicesFor(createMemoryDataPort([]), createMemoryGitPort([]))
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <NotificationProvider>
        <ActorProvider actor={{ id: 'u1', role }}>
          <ServicesProvider services={services}>
            <SidebarProvider>{children}</SidebarProvider>
          </ServicesProvider>
        </ActorProvider>
      </NotificationProvider>
    </MemoryRouter>
  )
  return render(<Settings />, { wrapper })
}

describe('Settings — settings.manage gate (view-only for maintainer)', () => {
  it('locks the whole settings surface for a maintainer (settings.view, no settings.manage)', () => {
    const { container } = renderSettings('maintainer')
    expect(screen.getByText(/view-only access to settings/i)).toBeInTheDocument()
    const fieldset = container.querySelector('fieldset')
    expect(fieldset).not.toBeNull()
    expect(fieldset).toBeDisabled()
  })

  it('leaves settings editable for an admin (settings.manage)', () => {
    const { container } = renderSettings('admin')
    expect(screen.queryByText(/view-only access to settings/i)).not.toBeInTheDocument()
    const fieldset = container.querySelector('fieldset')
    expect(fieldset).not.toBeNull()
    expect(fieldset).not.toBeDisabled()
  })
})
