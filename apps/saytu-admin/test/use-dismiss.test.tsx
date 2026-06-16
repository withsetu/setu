import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { useDismiss } from '../src/ui/useDismiss'

afterEach(cleanup)

function Harness({ onClose, active = true }: { onClose: () => void; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose, active)
  return (
    <div>
      <div ref={ref} data-testid="panel">panel</div>
      <button data-testid="outside">outside</button>
    </div>
  )
}

describe('useDismiss', () => {
  it('calls onClose on Escape (regardless of focus)', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('calls onClose on a pointerdown outside the ref', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(<Harness onClose={onClose} />)
    fireEvent.pointerDown(getByTestId('outside'))
    expect(onClose).toHaveBeenCalledOnce()
  })
  it('does NOT call onClose on a pointerdown inside the ref', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(<Harness onClose={onClose} />)
    fireEvent.pointerDown(getByTestId('panel'))
    expect(onClose).not.toHaveBeenCalled()
  })
  it('does nothing when inactive', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} active={false} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.pointerDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })
})
