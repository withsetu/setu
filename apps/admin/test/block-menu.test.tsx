import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { BlockMenu } from '../src/editor/extensions/BlockMenu'

afterEach(cleanup)

const actions = () => ({
  moveUp: vi.fn(),
  moveDown: vi.fn(),
  duplicate: vi.fn(),
  remove: vi.fn()
})

describe('BlockMenu', () => {
  it('renders the four actions as a role=menu', () => {
    render(
      <BlockMenu actions={actions()} canMoveUp canMoveDown onClose={vi.fn()} />
    )
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: /move up/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: /move down/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: /duplicate/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: /delete/i })
    ).toBeInTheDocument()
  })

  it('invokes the action and closes on click', () => {
    const a = actions()
    const onClose = vi.fn()
    render(<BlockMenu actions={a} canMoveUp canMoveDown onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/i }))
    expect(a.duplicate).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('disables Move up at the first block and Move down at the last', () => {
    const a = actions()
    render(
      <BlockMenu actions={a} canMoveUp={false} canMoveDown onClose={vi.fn()} />
    )
    expect(screen.getByRole('menuitem', { name: /move up/i })).toBeDisabled()
    expect(
      screen.getByRole('menuitem', { name: /move down/i })
    ).not.toBeDisabled()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <BlockMenu actions={actions()} canMoveUp canMoveDown onClose={onClose} />
    )
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on a pointerdown outside the menu', () => {
    const onClose = vi.fn()
    render(
      <BlockMenu actions={actions()} canMoveUp canMoveDown onClose={onClose} />
    )
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('runs the active item on Enter after arrow navigation', () => {
    const a = actions()
    const onClose = vi.fn()
    render(<BlockMenu actions={a} canMoveUp canMoveDown onClose={onClose} />)
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' }) // 0 -> 1 (Move down)
    fireEvent.keyDown(menu, { key: 'ArrowDown' }) // 1 -> 2 (Duplicate)
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(a.duplicate).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders a non-empty shortcut kbd for each of the four menu items', () => {
    render(
      <BlockMenu actions={actions()} canMoveUp canMoveDown onClose={vi.fn()} />
    )
    const kbds = document.querySelectorAll('.blk-menu-key')
    expect(kbds).toHaveLength(4)
    kbds.forEach((kbd) => {
      expect(kbd.textContent?.trim().length).toBeGreaterThan(0)
    })
  })

  it('shows duplicate and delete shortcut text in menu items', () => {
    render(
      <BlockMenu actions={actions()} canMoveUp canMoveDown onClose={vi.fn()} />
    )
    const kbds = Array.from(document.querySelectorAll('.blk-menu-key'))
    // duplicate is 3rd item (index 2), delete is 4th (index 3)
    // On non-Mac (jsdom) we expect PC label format
    expect(kbds[2]?.textContent).toMatch(/Alt/) // duplicate: Alt+Shift+D
    expect(kbds[3]?.textContent).toMatch(/Alt/) // delete: Alt+Shift+Backspace
  })
})
