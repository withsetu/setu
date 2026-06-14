import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '../src/shell/Sidebar'

const renderSidebar = () =>
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  )

describe('Sidebar', () => {
  it('renders the admin navigation (PRD §24 IA)', () => {
    renderSidebar()
    for (const label of ['Dashboard', 'Posts', 'Pages', 'Media', 'Forms', 'Site', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('theme toggle flips data-theme on the document element', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
