import { useRef, useState } from 'react'
import { useDismiss } from '../ui/useDismiss'

export function PublishMenu({
  canPublish,
  canUnpublish,
  isUnpublished,
  onPublish,
  onUnpublish,
  onRepublish,
}: {
  canPublish: boolean
  canUnpublish: boolean
  isUnpublished: boolean
  onPublish: () => void
  onUnpublish: () => void
  onRepublish: () => void
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useDismiss(menuRef, () => setOpen(false), open)
  if (!canPublish && !canUnpublish) return null
  const items: Array<{ key: string; label: string; run: () => void; show: boolean }> = [
    { key: 'unpublish', label: 'Unpublish', run: onUnpublish, show: canUnpublish && !isUnpublished },
    { key: 'republish', label: 'Re-publish', run: onRepublish, show: canPublish && isUnpublished },
  ]
  const menuItems = items.filter((i) => i.show)
  return (
    <div className="publish-menu" ref={menuRef}>
      {canPublish && (
        <button type="button" className="btn btn-primary btn-md" onClick={onPublish}>Publish</button>
      )}
      {menuItems.length > 0 && (
        <>
          <button type="button" className="publish-menu-toggle btn btn-md" aria-haspopup="menu" aria-expanded={open} aria-label="More publish actions" onClick={() => setOpen((o) => !o)}>▾</button>
          {open && (
            <div className="publish-menu-list" role="menu">
              {menuItems.map((i) => (
                <button key={i.key} type="button" role="menuitem" className="publish-menu-item" onClick={() => { setOpen(false); i.run() }}>{i.label}</button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
