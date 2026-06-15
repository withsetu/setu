import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ActorProvider } from '../src/auth/actor'
import { ServicesProvider, createServices } from '../src/data/store'
import { DeployProvider } from '../src/deploy/deploy'
import { Sidebar } from '../src/shell/Sidebar'

const renderSidebar = () =>
  render(
    <MemoryRouter>
      <ActorProvider>
        <ServicesProvider services={createServices()}>
          <DeployProvider>
            <Sidebar />
          </DeployProvider>
        </ServicesProvider>
      </ActorProvider>
    </MemoryRouter>,
  )

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  vi.restoreAllMocks()
})

describe('Sidebar', () => {
  it('renders the admin navigation (PRD §24 IA)', () => {
    renderSidebar()
    for (const label of ['Dashboard', 'Posts', 'Pages', 'Media', 'Forms', 'Site', 'Settings']) {
      expect(screen.getByRole('link', { name: new RegExp(label, 'i') })).toBeInTheDocument()
    }
  })

  it('theme toggle flips data-theme and persists to localStorage', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    const setSpy = vi.spyOn(Storage.prototype, 'setItem')
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(setSpy).toHaveBeenCalledWith('saytu-theme', 'dark')
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('renders an icon for every nav item', () => {
    renderSidebar()
    for (const label of ['Dashboard', 'Posts', 'Pages', 'Media', 'Forms', 'Site', 'Settings']) {
      const link = screen.getByRole('link', { name: new RegExp(label, 'i') })
      expect(link.querySelector('svg')).not.toBeNull()
    }
  })

  it('shows the workspace name', () => {
    renderSidebar()
    expect(screen.getByText('Saytu')).toBeInTheDocument()
  })
})
