import { useEffect, useRef } from 'react'
import { SHORTCUTS, formatKeys, detectMac } from './shortcuts'
import type { ShortcutGroup } from './shortcuts'
import { BLOCK_TYPES } from './block-types'

const GROUP_ORDER: ShortcutGroup[] = ['Formatting', 'Links', 'Blocks', 'Help']

/** The keyboard-shortcuts cheat sheet (modal). Lists the registry grouped; closes
 *  on Esc, backdrop click, or the close button. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const mac = detectMac()

  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sc-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="sc-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sc-head">
          <h2 className="sc-title">Keyboard shortcuts</h2>
          <button type="button" className="sc-close" aria-label="Close" onClick={onClose}>
            <span aria-hidden>✕</span>
          </button>
        </div>
        {GROUP_ORDER.map((group) => {
          const items = SHORTCUTS.filter((s) => s.group === group)
          if (items.length === 0) return null
          return (
            <section key={group} className="sc-group">
              <h3 className="sc-group-title">{group}</h3>
              {items.map((s) => (
                <div key={s.id} className="sc-row">
                  <span className="sc-label">{s.label}</span>
                  <kbd className="sc-keys">{formatKeys(s.keys, mac)}</kbd>
                </div>
              ))}
            </section>
          )
        })}
        <section className="sc-group">
          <h3 className="sc-group-title">Turn a block into</h3>
          {BLOCK_TYPES.map((b) => (
            <div key={b.id} className="sc-row">
              <span className="sc-label">{b.label}</span>
              <kbd className="sc-keys">{formatKeys(b.keys, mac)}</kbd>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
