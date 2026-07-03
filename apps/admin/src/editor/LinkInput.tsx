import { useEffect, useRef, useState } from 'react'

/** Shared URL field for creating/editing a link. Enter applies a non-empty URL,
 *  Escape cancels; Remove shows only when editing an existing link. */
export function LinkInput({
  initial,
  onApply,
  onCancel,
  onRemove
}: {
  initial: string
  onApply: (href: string) => void
  onCancel: () => void
  onRemove: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const apply = () => {
    const href = value.trim()
    if (href.length === 0) return
    onApply(href)
  }

  return (
    <div className="link-input" role="group" aria-label="Link URL">
      <input
        ref={ref}
        type="url"
        className="link-input-field"
        aria-label="URL"
        placeholder="https://…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          } else {
            e.stopPropagation()
          }
        }}
      />
      <button
        type="button"
        className="link-input-apply"
        aria-label="Apply link"
        onMouseDown={(e) => e.preventDefault()}
        onClick={apply}
      >
        <span aria-hidden>↵</span>
      </button>
      {initial.length > 0 && (
        <button
          type="button"
          className="link-input-remove"
          aria-label="Remove link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onRemove}
        >
          Remove
        </button>
      )}
    </div>
  )
}
