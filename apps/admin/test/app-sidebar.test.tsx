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

const wrap = (actor?: { id: string; role: 'admin' | 'author' }) =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <ActorProvider {...(actor ? { actor } : {})}>
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
  // #513: the Demo Data item is DEV-only (vitest runs with DEV=true) and
  // additionally gated on users.delete — admin sees it, author does not.
  it('shows the Developer > Demo Data item to an admin (DEV builds)', () => {
    wrap()
    expect(screen.getByRole('link', { name: /Demo Data/ })).toHaveAttribute(
      'href',
      '/demo-data'
    )
  })
  it('hides Demo Data (and the whole Developer group) from an author', () => {
    wrap({ id: 'a', role: 'author' })
    expect(screen.queryByRole('link', { name: /Demo Data/ })).toBeNull()
    expect(screen.queryByText('Developer')).toBeNull()
  })
})
