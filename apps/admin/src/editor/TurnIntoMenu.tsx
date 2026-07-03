import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useDismiss } from '../ui/useDismiss'
import {
  TURN_INTO_GROUPS,
  currentBlockType,
  groupContaining
} from './block-types'
import type { BlockType } from './block-types'
import { registerBubblePopup } from './bubble-popup'
import { formatKeys, detectMac } from './shortcuts'

type Row =
  | { kind: 'leaf'; type: BlockType }
  | {
      kind: 'group'
      id: string
      label: string
      icon: IconName
      expanded: boolean
    }
  | { kind: 'item'; type: BlockType }

/** The bubble's block-type switcher. Categorized: Heading/List are groups that expand
 *  inline to their options; Text/Quote/Code apply directly. Keyboard: ↑/↓ over visible
 *  rows, Enter expands a group / applies a leaf-or-item, Esc closes (the popup guard
 *  keeps the bubble selection intact). Click-outside closes via useDismiss. */
export function TurnIntoMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const current = currentBlockType(editor)
  const mac = detectMac()

  useDismiss(panelRef, () => setOpen(false), open)
  useEffect(() => {
    if (!open) return
    return registerBubblePopup()
  }, [open])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const e of TURN_INTO_GROUPS) {
      if (e.kind === 'leaf') {
        out.push({ kind: 'leaf', type: e.type })
      } else {
        const isExp = expanded.has(e.id)
        out.push({
          kind: 'group',
          id: e.id,
          label: e.label,
          icon: e.icon,
          expanded: isExp
        })
        if (isExp)
          for (const it of e.items) out.push({ kind: 'item', type: it })
      }
    }
    return out
  }, [expanded])

  const openMenu = () => {
    const g = groupContaining(editor)
    setExpanded(new Set(g ? [g] : []))
    setOpen(true)
  }

  // On open (after the seeded render commits), focus the active row, else the first.
  useEffect(() => {
    if (!open) return
    const idx = rows.findIndex(
      (r) => r.kind !== 'group' && r.type.isActive(editor)
    )
    rowRefs.current[idx >= 0 ? idx : 0]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const apply = (b: BlockType) => {
    b.setOn(editor.chain().focus()).run()
    setOpen(false)
  }
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const activate = (row: Row) => {
    if (row.kind === 'group') toggle(row.id)
    else apply(row.type)
  }

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const n = rows.length
    if (n === 0) return
    const cur = rowRefs.current.findIndex((el) => el === document.activeElement)
    const at = cur < 0 ? 0 : cur
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      rowRefs.current[(at + 1) % n]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      rowRefs.current[(at - 1 + n) % n]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div className="ti-wrap">
      <button
        ref={triggerRef}
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
        <Icon name={current.icon} size={15} />
        <span className="ti-label">{current.label}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          className="ti-menu"
          role="menu"
          aria-label="Turn into"
          onKeyDown={onMenuKeyDown}
        >
          {rows.map((row, i) => {
            const refFn = (el: HTMLButtonElement | null) => {
              rowRefs.current[i] = el
            }
            if (row.kind === 'group') {
              return (
                <button
                  key={`g:${row.id}`}
                  ref={refFn}
                  type="button"
                  role="menuitem"
                  aria-expanded={row.expanded}
                  className={`ti-item ti-group${row.expanded ? ' open' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => activate(row)}
                >
                  <Icon name={row.icon} size={15} />
                  <span>{row.label}</span>
                  <span className="ti-chev" aria-hidden>
                    ▾
                  </span>
                </button>
              )
            }
            const active = row.type.isActive(editor)
            return (
              <button
                key={
                  row.kind === 'item' ? `i:${row.type.id}` : `l:${row.type.id}`
                }
                ref={refFn}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`ti-item${row.kind === 'item' ? ' ti-sub' : ''}${active ? ' on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => activate(row)}
              >
                <Icon name={row.type.icon} size={15} />
                <span>{row.type.label}</span>
                <span className="ti-keys">
                  {formatKeys(row.type.keys, mac)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
