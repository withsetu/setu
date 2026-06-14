import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../src/app'

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />)
    expect(screen.getByText('Saytu Admin')).toBeInTheDocument()
  })
})
