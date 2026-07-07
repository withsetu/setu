import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StatTiles } from '../src/dashboard/widgets/StatTiles'

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('StatTiles', () => {
  it('renders the four counts', () => {
    wrap(<StatTiles posts={128} pages={14} published={9} drafts={5} />)
    expect(screen.getByText('Posts').previousSibling).toHaveTextContent('128')
    expect(screen.getByText('Published').previousSibling).toHaveTextContent('9')
  })
  it('links Drafts to the filtered list', () => {
    wrap(<StatTiles posts={1} pages={1} published={1} drafts={5} />)
    expect(screen.getByRole('link', { name: /Drafts/ })).toHaveAttribute(
      'href',
      '/posts?status=draft'
    )
  })
})
