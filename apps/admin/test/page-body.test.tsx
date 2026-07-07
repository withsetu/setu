import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PageBody } from '../src/shell/PageBody'

describe('PageBody', () => {
  it('renders children inside a gutter container', () => {
    const { getByText, container } = render(
      <PageBody>
        <p>hi</p>
      </PageBody>
    )
    expect(getByText('hi')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('px-[30px]')
  })
  it('merges a passthrough className', () => {
    const { container } = render(
      <PageBody className="pb-20">
        <span />
      </PageBody>
    )
    expect(container.firstChild).toHaveClass('pb-20')
  })
})
