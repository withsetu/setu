import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SiteDeployCard } from '../src/dashboard/widgets/SiteDeployCard'

describe('SiteDeployCard', () => {
  it('shows the url and deployed sha', () => {
    render(
      <SiteDeployCard url="https://maya.setu.site" deployedSha="a1b2c3d4e5" />
    )
    expect(screen.getByText('maya.setu.site')).toBeInTheDocument()
    expect(screen.getByText(/a1b2c3d/)).toBeInTheDocument()
  })
  it('says not deployed when there is no sha', () => {
    render(<SiteDeployCard url="https://maya.setu.site" deployedSha={null} />)
    expect(screen.getByText(/Not deployed/)).toBeInTheDocument()
  })
  it('links View site to the url', () => {
    render(<SiteDeployCard url="https://maya.setu.site" deployedSha={null} />)
    expect(screen.getByRole('link', { name: /View site/ })).toHaveAttribute(
      'href',
      'https://maya.setu.site'
    )
  })
})
