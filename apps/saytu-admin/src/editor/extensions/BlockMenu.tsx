import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../ui/Icon'
import type { IconName } from '../../ui/Icon'
import { useDismiss } from '../../ui/useDismiss'

export interface BlockMenuActions {
  moveUp: () => void
  moveDown: () => void
  duplicate: () => void
  remove: () => void
}

interface Item {
  key: keyof BlockMenuActions
  label: string
  icon: IconName
  disabled?: boolean
}

export function BlockMenu({
  actions,
  canMoveUp,
  canMoveDown,
  onClose,
}: {
  actions: BlockMenuActions
  canMoveUp: boolean
  canMoveDown: boolean
  onClose: () => void
}) {
  const items: Item[] = [
    { key: 'moveUp', label: 'Move up', icon: 'chevUp', disabled: !canMoveUp },
    { key: 'moveDown', label: 'Move down', icon: 'chevDown', disabled: !canMoveDown },
    { key: 'duplicate', label: 'Duplicate', icon: 'copy' },
    { key: 'remove', label: 'Delete', icon: 'trash' },
  ]
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const run = (item: Item) => {
    if (item.disabled) return
    actions[item.key]()
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i + items.length - 1) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[active]
      if (item) run(item)
    }
  }

  return (
    <div ref={ref} className="blk-menu" role="menu" aria-label="Block actions" tabIndex={-1} onKeyDown={onKeyDown}>
      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={`blk-menu-item${i === active ? ' sel' : ''}`}
          onMouseEnter={() => setActive(i)}
          onClick={() => run(item)}
        >
          <Icon name={item.icon} size={15} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}
