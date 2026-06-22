import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '../src/shell/AppSidebar'

const wrap = () => render(
  <MemoryRouter initialEntries={['/dashboard']}>
    <SidebarProvider><AppSidebar /></SidebarProvider>
  </MemoryRouter>,
)

describe('AppSidebar', () => {
  it('renders the nav with correct routes', () => {
    wrap()
    expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('link', { name: /Posts/ })).toHaveAttribute('href', '/posts')
    expect(screen.getByRole('link', { name: /Appearance/ })).toHaveAttribute('href', '/appearance')
  })
  it('renders the workspace name and footer actions', () => {
    wrap()
    expect(screen.getByText('Setu')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View site/ })).toBeInTheDocument()
  })
})
