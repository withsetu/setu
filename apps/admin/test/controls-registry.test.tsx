import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { controlRegistry } from '../src/editor/controls/registry'

const meta = (over = {}) => ({ name: 'headline', apiBase: '', onPickMedia: vi.fn(), ...over })

describe('controlRegistry', () => {
  it('has a component for every control type', () => {
    for (const t of ['text','textarea','number','switch','select','media','url','color','position9','align'] as const) {
      expect(controlRegistry[t]).toBeTypeOf('function')
    }
  })

  it('text control emits onChange with the typed string', () => {
    const onChange = vi.fn()
    const C = controlRegistry.text
    render(<C value="" onChange={onChange} meta={meta()} />)
    fireEvent.change(screen.getByLabelText('headline'), { target: { value: 'Hi' } })
    expect(onChange).toHaveBeenCalledWith('Hi')
  })

  it('switch control emits boolean', () => {
    const onChange = vi.fn()
    const C = controlRegistry.switch
    render(<C value={false} onChange={onChange} meta={meta({ name: 'parallax' })} />)
    fireEvent.click(screen.getByLabelText('parallax'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
