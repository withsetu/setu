import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { themeOptions } from '@setu/theme-default/options'
import { Appearance } from '../src/screens/Appearance'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('Appearance (Customizer)', () => {
  it('renders one control per manifest knob, plus a live preview', () => {
    render(<Appearance />)
    for (const opt of themeOptions) {
      expect(screen.getByText(opt.label)).toBeInTheDocument()
    }
    expect(screen.getByTestId('cz-preview')).toBeInTheDocument()
  })

  it('selecting a different width updates the preview token (--measure-page)', () => {
    render(<Appearance />)
    const preview = screen.getByTestId('cz-preview')
    expect(preview.style.getPropertyValue('--measure-page')).toBe('64rem') // default "Normal"
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    expect(preview.style.getPropertyValue('--measure-page')).toBe('78rem')
  })

  it('a valid accent hex flows into the preview; an invalid one is ignored', () => {
    render(<Appearance />)
    const preview = screen.getByTestId('cz-preview')
    const hex = screen.getByLabelText('Hex value') as HTMLInputElement
    fireEvent.change(hex, { target: { value: '#0ea5e9' } })
    expect(preview.style.getPropertyValue('--accent')).toBe('#0ea5e9')
    fireEvent.change(hex, { target: { value: 'nonsense' } })
    // committed value unchanged (resolver never sees garbage)
    expect(preview.style.getPropertyValue('--accent')).toBe('#0ea5e9')
  })

  it('per-knob reset restores the default and hides the reset affordance', () => {
    render(<Appearance />)
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    const widthField = screen.getByText('Content width').closest('.cz-field') as HTMLElement
    fireEvent.click(within(widthField).getByRole('button', { name: 'Reset' }))
    expect(screen.getByTestId('cz-preview').style.getPropertyValue('--measure-page')).toBe('64rem')
    expect(within(widthField).queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
  })

  it('"Reset all" returns every knob to its default', () => {
    render(<Appearance />)
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sharp' }))
    fireEvent.click(screen.getByRole('button', { name: /reset all/i }))
    const preview = screen.getByTestId('cz-preview')
    expect(preview.style.getPropertyValue('--measure-page')).toBe('64rem')
    expect(preview.style.getPropertyValue('--radius-base')).toBe('10px')
  })

  it('remembers choices across remount (localStorage)', () => {
    const { unmount } = render(<Appearance />)
    fireEvent.click(screen.getByRole('button', { name: 'Wide' }))
    unmount()
    render(<Appearance />)
    expect(screen.getByTestId('cz-preview').style.getPropertyValue('--measure-page')).toBe('78rem')
  })
})
