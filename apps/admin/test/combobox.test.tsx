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
})
