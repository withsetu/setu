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
  /**
   * Task 7: Rail shell polish — inspector header
   *
   * The inspector must render a header "Block · <LABEL>" as the first child of the
   * outer container. For the hero block, label is "Hero" (block.editor.label).
   */
  it('renders a "Block · Hero" rail header for the hero block', () => {
    render(
      <BlockInspector
        tag="hero"
        mdAttrs={{ headline: 'Hi', layout: 'centered' }}
        onChange={() => {}}
        apiBase=""
      />
    )
    // The header text should contain the block label (case-insensitive match for "hero")
    const header = screen.getByRole('heading', { level: 2 })
    expect(header).toBeInTheDocument()
    expect(header.textContent).toMatch(/hero/i)
  })

  it('renders Content and Layout section headers for hero (centered)', () => {
    render(
      <BlockInspector
        tag="hero"
        mdAttrs={{ headline: 'Hi', layout: 'centered' }}
        onChange={() => {}}
        apiBase=""
      />
    )
    // Content and Layout groups should be visible
    expect(screen.getByText('Content')).toBeInTheDocument()
    expect(screen.getByText('Layout')).toBeInTheDocument()
    // Style group controls (overlayColor, parallax) are gated to layout=background,
    // so the Style section header must NOT appear when layout is 'centered'
    expect(screen.queryByText('Style')).toBeNull()
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
    expect(screen.getByText('Content')).toBeInTheDocument()
    expect(screen.getByText('Layout')).toBeInTheDocument()
    expect(screen.getByText('Style')).toBeInTheDocument()
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
