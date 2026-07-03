import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GettingStarted } from '../src/dashboard/widgets/GettingStarted'

describe('GettingStarted', () => {
  it('renders the checklist on a fresh site', () => {
    render(
      <GettingStarted hasSiteUrl={false} hasPost={false} hasDeployed={false} />
    )
    expect(screen.getByText('Getting started')).toBeInTheDocument()
    expect(screen.getByText('Create your first post')).toBeInTheDocument()
  })
  it('renders nothing once everything is done', () => {
    const { container } = render(
      <GettingStarted hasSiteUrl hasPost hasDeployed />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
