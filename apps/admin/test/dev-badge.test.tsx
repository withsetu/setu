import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DevBadge } from '../src/shell/DevBadge'

// #779: several identical `localhost:*` admin tabs are indistinguishable, so a dev-only badge
// names the branch and port the tab is actually serving. Dev-only: the production build never
// contains it (proved by a `dist` grep, not by a test — DCE is a build-time property).
describe('DevBadge', () => {
  it('shows the branch and port it was built from', () => {
    render(<DevBadge branch="editor-focus-757-778" port="5183" />)
    expect(screen.getByText(/editor-focus-757-778/)).toBeInTheDocument()
    expect(screen.getByText(/:5183/)).toBeInTheDocument()
  })

  it('labels itself as a dev-only marker for screen readers', () => {
    render(<DevBadge branch="main" port="5173" />)
    expect(screen.getByLabelText(/dev build/i)).toBeInTheDocument()
  })

  it('renders the branch alone when the port is the protocol default', () => {
    render(<DevBadge branch="main" port="" />)
    expect(screen.getByLabelText(/dev build/i)).toHaveTextContent('main')
    expect(screen.queryByText(/:\d/)).not.toBeInTheDocument()
  })

  it('renders nothing when the branch could not be resolved at build time', () => {
    const { container } = render(<DevBadge branch="" port="" />)
    expect(container).toBeEmptyDOMElement()
  })
})
