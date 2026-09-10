import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ResolvedControl } from '@setu/core'
import { NotificationProvider } from '../src/ui/notify'
import { CollectionFields } from '../src/editor/CollectionFields'

/**
 * #963: the entry form for a declared collection, generated from the schema #1125 now serves.
 *
 * The #962 spike measured what this closes: an editor creating a `product` got a 422 naming seven
 * required fields, and the admin rendered a control for none of them — so the rejection was correct
 * and unactionable. These tests assert the three things that makes it actionable: every declared
 * field gets a control, an enum gets a real picker rather than a raw text box (DoD #4), and a
 * schema the server could not describe says so instead of rendering as "no fields" (§4 #22).
 */
const FIELDS: ResolvedControl[] = [
  { name: 'sku', control: 'text', required: true },
  {
    name: 'stock',
    control: 'select',
    required: true,
    options: ['in-stock', 'made-to-order', 'discontinued']
  },
  { name: 'priceUsd', control: 'number', required: true },
  { name: 'featured', control: 'switch', required: false, default: false },
  { name: 'internalNote', control: 'text', required: false }
]

function setup(props?: Partial<React.ComponentProps<typeof CollectionFields>>) {
  const onChange = vi.fn()
  // MediaPickerModal (reused from the block inspector) calls useNotify, so the provider is part
  // of this component's real environment rather than test scaffolding.
  render(
    <NotificationProvider>
      <CollectionFields
        fields={FIELDS}
        metadata={{ sku: 'HD-1001', stock: 'in-stock', priceUsd: 4200 }}
        editable
        apiBase="http://localhost:4444"
        onChange={onChange}
        {...props}
      />
    </NotificationProvider>
  )
  return { onChange }
}

describe('CollectionFields', () => {
  it('renders one labelled control per declared field', () => {
    setup()
    // Visible labels are humanized; the controls' own `aria-label` is the raw field name (the
    // shared control contract in controls/types.ts), so both are asserted rather than assumed.
    expect(screen.getByText('Sku')).toBeInTheDocument()
    expect(screen.getByText('Price Usd')).toBeInTheDocument()
    expect(screen.getByText('Internal Note')).toBeInTheDocument()
    expect(screen.getByLabelText('sku')).toBeInTheDocument()
    expect(screen.getByLabelText('priceUsd')).toBeInTheDocument()
  })

  it('marks required fields, and does not mark optional ones', () => {
    setup()
    const required = screen.getByText('Sku').closest('label')
    expect(required?.textContent).toMatch(/\*/)
    const optional = screen.getByText('Internal Note').closest('label')
    expect(optional?.textContent).not.toMatch(/\*/)
  })

  it('shows the current frontmatter value', () => {
    setup()
    expect(screen.getByLabelText('sku')).toHaveValue('HD-1001')
  })

  it('writes an edit back into the metadata map, preserving unmanaged keys', () => {
    const { onChange } = setup({
      metadata: { sku: 'HD-1001', title: 'Steel Packer', legacyKey: 'keep me' }
    })
    fireEvent.change(screen.getByLabelText('sku'), {
      target: { value: 'HD-2002' }
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sku: 'HD-2002',
        title: 'Steel Packer',
        legacyKey: 'keep me'
      })
    )
  })

  it('renders an enum as a picker of its declared options, never a raw text box', () => {
    setup()
    // DoD #4 / §4 #15: the system knows the values, so the editor must not be asked to type one.
    // SegmentedSelect de-slugs for display, which is the point — the editor sees "made to order",
    // never `made-to-order`.
    for (const opt of ['in stock', 'made to order', 'discontinued']) {
      expect(screen.getByText(opt)).toBeInTheDocument()
    }
    // and the group is labelled by THIS panel's label, not the block inspector's same-named one.
    // Both panels are on screen together in the editor, so a shared `bi-label-<name>` target would
    // point a collection field's control at a block prop's label.
    expect(
      document.querySelector('[aria-labelledby="cf-label-stock"]')
    ).not.toBeNull()
    expect(document.getElementById('cf-label-stock')).not.toBeNull()
  })

  it('a schema the server could not describe reports that, and is NOT rendered as "no fields"', () => {
    setup({ fields: undefined, fieldsError: 'array prop "specs" needs a hint' })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/specs/)
  })

  it('renders nothing at all when the collection declares no fields', () => {
    const { container } = render(
      <NotificationProvider>
        <CollectionFields
          metadata={{}}
          editable
          apiBase="http://x"
          onChange={vi.fn()}
        />
      </NotificationProvider>
    )
    expect(container.querySelector('label')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
