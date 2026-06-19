import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CountsTiles } from '../src/dashboard/widgets/CountsTiles'

describe('CountsTiles', () => {
  it('renders counts and an em dash for unavailable media', () => {
    render(<CountsTiles posts={2} pages={1} drafts={3} media={null} />)
    expect(screen.getByText('Posts').previousSibling).toHaveTextContent('2')
    expect(screen.getByText('Media').previousSibling).toHaveTextContent('—')
  })
})
