import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../src/app'

describe('App', () => {
  it('renders the shell without crashing', () => {
    render(
      <MemoryRouter initialEntries={['/posts']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByText('Saytu')).toBeInTheDocument()
  })

  it('redirects / to /posts', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Posts' })).toBeInTheDocument()
  })
})
