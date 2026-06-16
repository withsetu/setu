import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Icon } from '../ui/Icon'
import { useDismiss } from '../ui/useDismiss'
import { BLOCK_TYPES, currentBlockType } from './block-types'

/** The bubble's block-type switcher: a button labelled with the current block type
 *  that opens a role=menu of the registry. Picking an item transforms the selected
 *  block. Keyboard: Enter/↓ opens; ↑/↓ move; Enter picks; Esc closes the menu only
 *  (stopPropagation so it doesn't also collapse the selection). Click-outside closes
 *  via useDismiss. The trigger participates in the toolbar roving (data-toolbar-item). */
export function TurnIntoMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const current = currentBlockType(editor)

  useDismiss(panelRef, () => setOpen(false), open)

  const openMenu = () => {
    setOpen(true)
    queueMicrotask(() => {
      const activeIdx = Math.max(0, BLOCK_TYPES.findIndex((b) => b.isActive(editor)))
      itemRefs.current[activeIdx]?.focus()
    })
  }

  const pick = (index: number) => {
    const b = BLOCK_TYPES[index]
    if (!b) return
    b.setOn(editor.chain().focus()).run()
    setOpen(false)
  }

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const count = BLOCK_TYPES.length
    const cur = itemRefs.current.findIndex((el) => el === document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      itemRefs.current[(cur + 1 + count) % count]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      itemRefs.current[(cur - 1 + count) % count]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className="ti-wrap">
      <button
        type="button"
        data-toolbar-item
        className="fmt-btn ti-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Turn into"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter') {
            e.preventDefault()
            openMenu()
          }
        }}
      >
        <span className="ti-label">{current.label}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div ref={panelRef} className="ti-menu" role="menu" aria-label="Turn into" onKeyDown={onMenuKeyDown}>
          {BLOCK_TYPES.map((b, i) => (
            <button
              key={b.id}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              type="button"
              role="menuitemradio"
              aria-checked={b.isActive(editor)}
              className={`ti-item${b.isActive(editor) ? ' on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              <Icon name={b.icon} size={15} />
              <span>{b.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
