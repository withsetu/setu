import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { DeployStatus } from '@setu/core'
import { SiteDeployCard } from '../src/dashboard/widgets/SiteDeployCard'

const statusOf = (over: Partial<DeployStatus> = {}): DeployStatus => ({
  deployedSha: null,
  deployedAt: null,
  headSha: 'head',
  pending: true,
  changedPaths: [],
  job: null,
  canRebuild: true,
  ...over
})

describe('SiteDeployCard (#208)', () => {
  it('shows the url and deployed sha', () => {
    render(
      <SiteDeployCard
        url="https://maya.setu.site"
        status={statusOf({ deployedSha: 'a1b2c3d4e5', pending: false })}
      />
    )
    expect(screen.getByText('maya.setu.site')).toBeInTheDocument()
    expect(screen.getByText(/a1b2c3d/)).toBeInTheDocument()
  })

  it('says not deployed when there is no deploy yet', () => {
    render(<SiteDeployCard url="https://maya.setu.site" status={statusOf()} />)
    expect(screen.getByText(/Not deployed/)).toBeInTheDocument()
    expect(screen.getByText(/not live yet/i)).toBeInTheDocument()
  })

  it('shows the honest pending count when changes are saved but not live', () => {
    render(
      <SiteDeployCard
        url="https://maya.setu.site"
        status={statusOf({
          deployedSha: 'a1b2c3d4e5',
          pending: true,
          changedPaths: [
            { path: 'content/post/en/a.mdoc', added: false },
            { path: 'content/post/en/b.mdoc', added: true },
            { path: 'settings.json', added: false }
          ]
        })}
      />
    )
    expect(
      screen.getByText(/3 changes pending — not yet live/i)
    ).toBeInTheDocument()
  })

  it('links View site to the url', () => {
    render(<SiteDeployCard url="https://maya.setu.site" status={null} />)
    expect(screen.getByRole('link', { name: /View site/ })).toHaveAttribute(
      'href',
      'https://maya.setu.site'
    )
  })

  // #572: while the dashboard loads, the card shell paints with skeleton lines — no
  // premature "Not deployed yet" flash.
  it('renders skeleton placeholders while loading (#572)', () => {
    const { container } = render(
      <SiteDeployCard loading url="https://maya.setu.site" status={null} />
    )
    expect(screen.getByText(/Site & deploy/)).toBeInTheDocument()
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/Not deployed/)).toBeNull()
  })
})
