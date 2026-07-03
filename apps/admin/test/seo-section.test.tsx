import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SeoSection } from '../src/editor/SeoSection'

function renderSeo(metadata: Record<string, unknown> = { title: 'My Post' }) {
  const onChange = vi.fn()
  render(
    <SeoSection
      metadata={metadata}
      slug="my-post"
      editable
      onChange={onChange}
      apiBase=""
    />
  )
  return { onChange }
}

describe('SeoSection', () => {
  it('writes the SEO title override under metadata.seo', () => {
    const { onChange } = renderSeo()
    fireEvent.change(screen.getByLabelText('SEO title'), {
      target: { value: 'Custom SEO Title' }
    })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'My Post',
        seo: { title: 'Custom SEO Title' }
      })
    )
  })

  it('writes the meta description override', () => {
    const { onChange } = renderSeo()
    fireEvent.change(screen.getByLabelText('Meta description'), {
      target: { value: 'A custom description.' }
    })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ seo: { description: 'A custom description.' } })
    )
  })

  it('clearing the only override field removes the seo block entirely', () => {
    const { onChange } = renderSeo({ title: 'My Post', seo: { title: 'X' } })
    fireEvent.change(screen.getByLabelText('SEO title'), {
      target: { value: '' }
    })
    const last = onChange.mock.calls.at(-1)![0]
    expect(last).not.toHaveProperty('seo')
  })

  it('noindex toggle (under Advanced) sets seo.noindex true', () => {
    const { onChange } = renderSeo()
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }))
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ seo: { noindex: true } })
    )
  })

  it('renders a live snippet preview reflecting the doc title', () => {
    renderSeo({ title: 'My Post' })
    // resolveSeo applies the title template → the preview shows the resolved title.
    expect(screen.getByText(/My Post/)).toBeInTheDocument()
  })
})
