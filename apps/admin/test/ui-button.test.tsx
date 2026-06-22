import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

describe('shadcn primitives', () => {
  it('renders a Button with text', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
  it('renders the custom success Badge variant', () => {
    render(<Badge variant="success">Published</Badge>)
    const el = screen.getByText('Published')
    expect(el.className).toContain('bg-success')
  })
})
