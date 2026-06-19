// apps/admin/test/quick-actions.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QuickActions } from '../src/dashboard/widgets/QuickActions'

describe('QuickActions', () => {
  it('links to the new-post and new-page editor routes', () => {
    render(<MemoryRouter><QuickActions /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /new post/i })).toHaveAttribute('href', '/edit/post/en/new')
    expect(screen.getByRole('link', { name: /new page/i })).toHaveAttribute('href', '/edit/page/en/new')
  })
})
