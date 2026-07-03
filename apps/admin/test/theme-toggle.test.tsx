import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { ThemeToggle } from '../src/shell/ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    localStorage.clear()
  })
  it('flips and persists the theme', () => {
    render(
      <SidebarProvider>
        <ThemeToggle />
      </SidebarProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('setu-theme')).toBe('dark')
  })
})
