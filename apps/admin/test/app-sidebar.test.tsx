import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SidebarProvider } from '@/components/ui/sidebar'
import { ActorProvider } from '../src/auth/actor'
import { AppSidebar } from '../src/shell/AppSidebar'

vi.mock('../src/deploy/deploy', () => ({
  useDeploy: () => ({ deployedAt: () => null, sha: null, deploy: () => Promise.resolve() }),
}))

const wrap = () => render(
  <MemoryRouter initialEntries={['/dashboard']}>
    <ActorProvider>
      <SidebarProvider><AppSidebar /></SidebarProvider>
    </ActorProvider>
  </MemoryRouter>,
)

describe('AppSidebar', () => {
  it('renders the nav with correct routes', () => {
    wrap()
    expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('link', { name: /Posts/ })).toHaveAttribute('href', '/posts')
    expect(screen.getByRole('link', { name: /Appearance/ })).toHaveAttribute('href', '/appearance')
  })
  it('renders the Users nav item (admin has users.view by default) linking to /users', () => {
    wrap()
    expect(screen.getByRole('link', { name: /^Users$/ })).toHaveAttribute('href', '/users')
  })
  it('renders the workspace name and footer actions', () => {
    wrap()
    expect(screen.getByText('Setu')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View site/ })).toBeInTheDocument()
  })
})
