import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'
import { TurnIntoMenu } from '../src/editor/TurnIntoMenu'
import { bubbleEscapeShouldCollapse } from '../src/editor/bubble-popup'

afterEach(cleanup)

function H({ onReady }: { onReady: (e: Editor) => void }) {
  const e = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ link: { openOnClick: false }, underline: false })],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
  })
  if (e) onReady(e)
  return <>{e && <TurnIntoMenu editor={e} />}</>
}

const open = () => fireEvent.click(screen.getByRole('button', { name: /turn into/i }))

describe('TurnIntoMenu (grouped)', () => {
  it('expands the Heading group and turns the block into H4', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /heading/i }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /heading 4/i }))
    expect(editor.isActive('heading', { level: 4 })).toBe(true)
  })

  it('expands the List group and makes a numbered list', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /list/i }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /numbered/i }))
    expect(editor.isActive('orderedList')).toBe(true)
  })

  it('applies a leaf (Quote) directly without expanding', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    open()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /quote/i }))
    expect(editor.isActive('blockquote')).toBe(true)
  })

  it('pre-expands the active group and checks the active item', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).setNode('heading', { level: 3 }).run() })
    open()
    expect(screen.getByRole('menuitemradio', { name: /heading 3/i })).toHaveAttribute('aria-checked', 'true')
  })

  it('Esc closes the menu without collapsing the selection', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    open()
    expect(bubbleEscapeShouldCollapse(editor)).toBe(false)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(bubbleEscapeShouldCollapse(editor)).toBe(true)
  })

  it('shows the block shortcut on a row (Quote)', () => {
    let editor!: Editor
    render(<H onReady={(e) => (editor = e)} />)
    act(() => { editor.chain().setTextSelection({ from: 1, to: 6 }).run() })
    fireEvent.click(screen.getByRole('button', { name: /turn into/i }))
    const quote = screen.getByRole('menuitemradio', { name: /quote/i })
    expect(quote.textContent).toMatch(/⌘⇧B|Ctrl\+Shift\+B/)
  })
})
