import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ColumnsMenu } from '../src/screens/content-list/ColumnsMenu'

// jsdom does not implement PointerEvent; stub it so Radix DropdownMenu trigger works.
beforeAll(() => {
  if (typeof window !== 'undefined' && !window.PointerEvent) {
    class PointerEventStub extends MouseEvent {
      pointerId: number
      isPrimary: boolean
      constructor(type: string, init?: PointerEventInit) {
        super(type, init)
        this.pointerId = init?.pointerId ?? 0
        this.isPrimary = init?.isPrimary ?? true
      }
    }
    Object.defineProperty(window, 'PointerEvent', {
      value: PointerEventStub,
      writable: true
    })
  }
})

const visible = {
  status: true,
  tags: true,
  categories: true,
  updated: true,
  locale: false
}

function openMenu() {
  const trigger = screen.getByRole('button', { name: /columns/i })
  // Radix DropdownMenu also opens on Enter keydown (avoids PointerEvent jsdom issues)
  fireEvent.keyDown(trigger, { key: 'Enter' })
}

describe('ColumnsMenu', () => {
  it('opens and toggles a column', () => {
    const toggle = vi.fn()
    render(<ColumnsMenu visible={visible} toggle={toggle} showLocale={false} />)
    openMenu()
    fireEvent.click(screen.getByText('Tags'))
    expect(toggle).toHaveBeenCalledWith('tags')
  })
  it('hides the Locale item when showLocale is false', () => {
    render(
      <ColumnsMenu visible={visible} toggle={() => {}} showLocale={false} />
    )
    openMenu()
    expect(screen.queryByText('Locale')).toBeNull()
  })
})
