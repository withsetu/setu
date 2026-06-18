import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { useToolbarRoving } from '../src/editor/useToolbarRoving'

afterEach(cleanup)

function Bar() {
  const { ref, onKeyDown } = useToolbarRoving()
  return (
    <div role="toolbar" ref={ref} onKeyDown={onKeyDown}>
      <button data-toolbar-item>a</button>
      <button data-toolbar-item>b</button>
      <button data-toolbar-item>c</button>
    </div>
  )
}

describe('useToolbarRoving', () => {
  it('makes exactly one item tabbable initially (roving tabindex)', () => {
    const { getByText } = render(<Bar />)
    expect(getByText('a').tabIndex).toBe(0)
    expect(getByText('b').tabIndex).toBe(-1)
    expect(getByText('c').tabIndex).toBe(-1)
  })
  it('ArrowRight/ArrowLeft move the tabbable item (wrapping)', () => {
    const { getByText, getByRole } = render(<Bar />)
    const bar = getByRole('toolbar')
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(getByText('b').tabIndex).toBe(0)
    expect(document.activeElement).toBe(getByText('b'))
    fireEvent.keyDown(bar, { key: 'ArrowLeft' })
    expect(getByText('a').tabIndex).toBe(0)
    fireEvent.keyDown(bar, { key: 'ArrowLeft' }) // wraps to last
    expect(getByText('c').tabIndex).toBe(0)
  })
  it('Home/End jump to first/last', () => {
    const { getByText, getByRole } = render(<Bar />)
    const bar = getByRole('toolbar')
    fireEvent.keyDown(bar, { key: 'End' })
    expect(getByText('c').tabIndex).toBe(0)
    fireEvent.keyDown(bar, { key: 'Home' })
    expect(getByText('a').tabIndex).toBe(0)
  })
})
