import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Combobox } from '../src/ui/Combobox'

function setup(over: Partial<Parameters<typeof Combobox>[0]> = {}) {
  const onSubmit = vi.fn()
  const onChange = vi.fn()
  render(
    <Combobox
      value={over.value ?? 're'}
      onChange={onChange}
      onSubmit={onSubmit}
      items={over.items ?? [{ value: 'react' }, { value: 'redux' }]}
      allowFreeText={over.allowFreeText}
      ariaLabel="Test combo"
    />
  )
  return { onSubmit, onChange }
}

describe('Combobox', () => {
  it('Arrow-down highlights and Enter commits the highlighted item', () => {
    const { onSubmit } = setup()
    const input = screen.getByLabelText('Test combo')
    fireEvent.keyDown(input, { key: 'ArrowDown' }) // highlight index 0 → react
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('react')
  })

  it('Enter with no highlight commits typed text when allowFreeText', () => {
    const { onSubmit } = setup({
      value: 'brandnew',
      items: [],
      allowFreeText: true
    })
    fireEvent.keyDown(screen.getByLabelText('Test combo'), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('brandnew')
  })

  it('Enter with no highlight commits the top match when NOT allowFreeText', () => {
    const { onSubmit } = setup({
      value: 'gu',
      items: [{ value: 'guides' }],
      allowFreeText: false
    })
    fireEvent.keyDown(screen.getByLabelText('Test combo'), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('guides')
  })

  it('clicking an option commits its value', () => {
    const { onSubmit } = setup()
    fireEvent.focus(screen.getByLabelText('Test combo'))
    fireEvent.mouseDown(screen.getByText('redux'))
    expect(onSubmit).toHaveBeenCalledWith('redux')
  })

  it('renders item.label but commits item.value', () => {
    const { onSubmit } = setup({
      items: [{ value: 'tut', label: '  Tutorials' }]
    })
    fireEvent.focus(screen.getByLabelText('Test combo'))
    fireEvent.mouseDown(screen.getByText('Tutorials'))
    expect(onSubmit).toHaveBeenCalledWith('tut')
  })

  // #914: the live region used to be MOUNTED together with its text. Screen readers
  // announce changes to a region that was already in the accessibility tree; a region
  // that appears with its content in the same paint is unreliably announced — so the
  // one message the hint exists to deliver ("suggestions are unavailable") was the one
  // most likely to be missed.
  describe('the hint live region', () => {
    // Queried by class, not `getByRole('status')`: the region is a persistent
    // `aria-live="polite"` element rather than a status ROLE, so that every screen
    // holding a picker does not gain a spurious status node (see Combobox.tsx).
    const liveRegion = () => {
      const el = document.querySelector<HTMLElement>('.combo-hint')
      if (el === null) throw new Error('no live region rendered')
      expect(el.getAttribute('aria-live')).toBe('polite')
      return el
    }

    const rerenderable = (hint?: string) => (
      <Combobox
        value="re"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        items={[]}
        ariaLabel="Test combo"
        hint={hint}
      />
    )

    it('is in the DOM, and empty, before there is anything to say', () => {
      render(rerenderable())
      const region = liveRegion()
      expect(region.textContent).toBe('')
    })

    it('keeps the same region element when the hint appears', () => {
      const { rerender } = render(rerenderable())
      const before = liveRegion()
      rerender(rerenderable('Couldn’t load tag suggestions.'))
      const after = liveRegion()
      expect(after).toBe(before)
      expect(after.textContent).toContain('Couldn’t load tag suggestions.')
    })

    it('empties the region rather than unmounting it when the hint clears', () => {
      const { rerender } = render(
        rerenderable('Couldn’t load tag suggestions.')
      )
      const before = liveRegion()
      rerender(rerenderable())
      expect(liveRegion()).toBe(before)
      expect(before.textContent).toBe('')
    })

    it('describes the input only while there is a hint', () => {
      const { rerender } = render(rerenderable())
      const input = screen.getByLabelText('Test combo')
      expect(input.getAttribute('aria-describedby')).toBeNull()
      rerender(rerenderable('Couldn’t load tag suggestions.'))
      expect(input.getAttribute('aria-describedby')).toBe(liveRegion().id)
    })
  })
})
