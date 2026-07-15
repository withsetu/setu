import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

const renderSidebar = () =>
  render(
    <MemoryRouter>
      <ActorProvider>
        <NotificationProvider>
          <SidebarProvider>
            <AppSidebar />
          </SidebarProvider>
        </NotificationProvider>
      </ActorProvider>
    </MemoryRouter>
  )

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  vi.restoreAllMocks()
})

describe('AppSidebar (nav coverage)', () => {
  it('renders the admin navigation (PRD §24 IA)', () => {
    renderSidebar()
    for (const label of [
      'Dashboard',
      'Posts',
      'Pages',
      'Media',
      'Forms',
      'Appearance',
      'Settings'
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('theme toggle flips data-theme and persists to localStorage', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    const setSpy = vi.spyOn(Storage.prototype, 'setItem')
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(setSpy).toHaveBeenCalledWith('setu-theme', 'dark')
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('renders an icon for every nav item', () => {
    renderSidebar()
    for (const label of [
      'Dashboard',
      'Posts',
      'Pages',
      'Media',
      'Forms',
      'Appearance',
      'Settings'
    ]) {
      const link = screen.getByRole('link', { name: label })
      expect(link.querySelector('svg')).not.toBeNull()
    }
  })

  it('shows the workspace name', () => {
    renderSidebar()
    expect(screen.getByText('Setu')).toBeInTheDocument()
  })

  it('has a "View site" link to the site base, opening in a new tab', () => {
    renderSidebar()
    const link = screen.getByRole('link', { name: /view site/i })
    expect(link).toHaveAttribute('href', 'http://localhost:4321')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
