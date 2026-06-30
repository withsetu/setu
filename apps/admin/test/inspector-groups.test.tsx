import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BlockInspector } from '../src/editor/BlockInspector'

/**
 * Task 6: Grouping — inspector renders Content/Layout/Style sections
 *
 * The hero block declares groups: Content, Layout, Style.
 * The inspector must render each as a <section> with an uppercase muted <h3> header
 * when the group has at least one visible control.
 *
 * Style group contains overlayColor + parallax, both gated to layout==='background'.
 * When layout != 'background', both are hidden — so the Style section must not render.
 */
describe('inspector groups', () => {
  it('renders Content and Layout section headers for hero (centered)', () => {
    render(
      <BlockInspector
        tag="hero"
        mdAttrs={{ headline: 'Hi', layout: 'centered' }}
        onChange={() => {}}
        apiBase=""
      />
    )
    // Content and Layout group HEADERS should be visible. Target headings specifically:
    // a field label (e.g. the "Layout" select) can share text with a group header.
    expect(screen.getByRole('heading', { level: 3, name: 'Content' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Layout' })).toBeInTheDocument()
    // Style is visible because Text Color is ungated; but its gated controls
    // (overlayColor, parallax) are hidden when layout != background.
    expect(screen.getByRole('heading', { level: 3, name: 'Style' })).toBeInTheDocument()
    expect(screen.getByLabelText('textColor')).toBeInTheDocument()
    expect(screen.queryByLabelText('parallax')).toBeNull()
  })

  it('renders all three groups (Content / Layout / Style) when layout is background', () => {
    render(
      <BlockInspector
        tag="hero"
        mdAttrs={{ headline: 'Hi', layout: 'background' }}
        onChange={() => {}}
        apiBase=""
      />
    )
    expect(screen.getByRole('heading', { level: 3, name: 'Content' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Layout' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Style' })).toBeInTheDocument()
  })

  it('falls back to a flat single section (no header) when block has no groups', () => {
    // Use a block that has no declared groups — the callout block
    // (it has controls but no groups array in its contract).
    // The inspector must still render controls without crashing.
    render(
      <BlockInspector
        tag="callout"
        mdAttrs={{ type: 'info', text: 'Note' }}
        onChange={() => {}}
        apiBase=""
      />
    )
    // No group headers should appear (no groups declared)
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
    // But controls should still render (at least one label present)
    expect(document.querySelectorAll('label').length).toBeGreaterThan(0)
  })
})
