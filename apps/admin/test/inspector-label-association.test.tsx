import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NotificationProvider } from '../src/ui/notify'
import { BlockInspector } from '../src/editor/BlockInspector'

// #760 (2)+(3): every inspector control's visible <Label> must actually associate
// with its control — either via `htmlFor` → a real control `id` (single inputs:
// color/media/tag), or via the control's `aria-labelledby` → the Label's `id`
// (radio/toggle groups: align, segmented select, position9). Before the fix the
// Label pointed at a non-existent `bi-<name>` id AND the control announced the raw
// camelCase prop name, so clicking a label focused nothing and the accessible name
// mismatched the visible one (WCAG 2.5.3).

function renderHero() {
  // layout='background' reveals every group, including the gated color controls.
  return render(
    <NotificationProvider>
      <BlockInspector
        tag="hero"
        mdAttrs={{ headline: 'Hi', layout: 'background' }}
        onChange={() => {}}
        apiBase=""
      />
    </NotificationProvider>
  )
}

describe('BlockInspector — label ↔ control association (#760)', () => {
  it('every rendered control label resolves to a real control', () => {
    const { container } = renderHero()
    const labels = container.querySelectorAll('label[for]')
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      const htmlFor = label.getAttribute('for')!
      const byId = container.querySelector(`#${CSS.escape(htmlFor)}`)
      const byLabelledBy = label.id
        ? container.querySelector(`[aria-labelledby~="${label.id}"]`)
        : null
      expect(
        byId ?? byLabelledBy,
        `label "${label.textContent}" (for="${htmlFor}") associates with no control`
      ).not.toBeNull()
    }
  })

  it('the accessible name is the humanized visible label, not the camelCase prop', () => {
    renderHero()
    // color control — associated by htmlFor → the swatch input id
    expect(screen.getByLabelText('Text Color')).toBeInTheDocument()
    // align + position9 groups — associated by aria-labelledby → the Label id
    expect(screen.getByLabelText('Width')).toBeInTheDocument()
    expect(screen.getByLabelText('Text Position')).toBeInTheDocument()
    // the old camelCase names must no longer name any control
    expect(screen.queryByLabelText('textColor')).toBeNull()
    expect(screen.queryByLabelText('width')).toBeNull()
    expect(screen.queryByLabelText('textPosition')).toBeNull()
  })
})
