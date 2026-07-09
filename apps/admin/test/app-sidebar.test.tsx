import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SidebarProvider } from '@/components/ui/sidebar'
import { ActorProvider } from '../src/auth/actor'
import { NotificationProvider } from '../src/ui/notify'
import { AppSidebar } from '../src/shell/AppSidebar'

vi.mock('../src/deploy/deploy', () => ({
  useDeploy: () => ({
    status: null,
    deployInfo: () => ({ deployedSha: null, changed: [] }),
    refresh: () => Promise.resolve(),
    rebuild: () => Promise.resolve()
  })
}))

const wrap = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <ActorProvider>
        <NotificationProvider>
          <SidebarProvider>
            <AppSidebar />
          </SidebarProvider>
        </NotificationProvider>
      </ActorProvider>
    </MemoryRouter>
  )

describe('AppSidebar', () => {
  it('renders the nav with correct routes', () => {
    wrap()
    expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute(
      'href',
      '/dashboard'
    )
    expect(screen.getByRole('link', { name: /Posts/ })).toHaveAttribute(
      'href',
      '/posts'
    )
    expect(screen.getByRole('link', { name: /Appearance/ })).toHaveAttribute(
      'href',
      '/appearance'
    )
  })
  it('renders the Users nav item (admin has users.view by default) linking to /users', () => {
    wrap()
    expect(screen.getByRole('link', { name: /^Users$/ })).toHaveAttribute(
      'href',
      '/users'
    )
  })
  it('renders the workspace name and footer actions', () => {
    wrap()
    expect(screen.getByText('Setu')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View site/ })).toBeInTheDocument()
  })
})
