import { useId, useState } from 'react'
import type { ReactNode } from 'react'

export interface ComboItem {
  value: string
  label?: ReactNode
}

export function Combobox({
  value,
  onChange,
  onSubmit,
  items,
  allowFreeText = true,
  placeholder,
  ariaLabel,
  id,
  disabled = false,
  className = '',
  hint
}: {
  value: string
  onChange: (text: string) => void
  onSubmit: (text: string) => void
  items: ComboItem[]
  allowFreeText?: boolean
  placeholder?: string
  ariaLabel: string
  /** Associates a visible `<label htmlFor>` with the combobox input (so clicking the
   *  label focuses it). Optional — most call sites rely on `ariaLabel` alone. */
  id?: string
  disabled?: boolean
  className?: string
  /** Inline status line under the input, announced politely and wired up as the
   *  input's `aria-describedby`. Intended for the "suggestions are unavailable"
   *  case (#905), where an empty list would otherwise read as "no matches" — the
   *  list itself keeps its own empty rendering.
   *
   *  The region that carries it is rendered unconditionally (see below), so passing
   *  a hint changes only its TEXT. Covered by the 'the hint live region' cases in
   *  apps/admin/test/combobox.test.tsx. */
  hint?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const hintId = useId()
  const show = open && items.length > 0

  const close = () => {
    setOpen(false)
    setActive(-1)
  }
  const commit = (text: string) => {
    onSubmit(text)
    close()
  }
  const onEnter = () => {
    if (active >= 0 && active < items.length) commit(items[active]!.value)
    else if (allowFreeText) commit(value)
    else if (items.length > 0) commit(items[0]!.value)
  }

  return (
    <div className={`combo ${className}`.trim()}>
      {/* The dropdown is positioned against THIS box, not `.combo`, so the hint line
          below can never push it down (#914). Pinned by
          apps/admin/test-browser/combobox-hint-layout.test.tsx, which measures the real
          gap in chromium — jsdom has no layout and reports zeros. */}
      <div className="combo-field">
        <input
          type="text"
          id={id}
          className="combo-input"
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-activedescendant={
            active >= 0 ? `${listId}-${active}` : undefined
          }
          aria-label={ariaLabel}
          aria-describedby={hint ? hintId : undefined}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onBlur={close}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((i) => Math.min(i + 1, items.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(i - 1, -1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              onEnter()
            } else if (e.key === 'Escape') {
              close()
            }
          }}
        />
        {show && (
          <ul className="combo-list" role="listbox" id={listId}>
            {items.map((item, i) => (
              <li
                key={item.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`combo-option${i === active ? ' active' : ''}`}
                // mousedown fires before the input's blur, so the click registers
                onMouseDown={(e) => {
                  e.preventDefault()
                  commit(item.value)
                }}
              >
                {item.label ?? item.value}
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* Rendered whether or not there is a hint: a live region announces CHANGES to
          text inside it, so one that arrives already populated is announced
          unreliably — which is the whole job of this element (#914). It costs no height
          while empty; that is asserted in real chromium by
          apps/admin/test-browser/combobox-hint-layout.test.tsx.
          `aria-live`/`aria-atomic` rather than `role="status"`, which they are the
          expansion of: a persistent status ROLE on every combobox puts an extra status
          node in the accessibility tree of every screen with a picker — enough to break
          #382's "exactly one status banner" assertions in
          apps/admin/test/editor-screen.test.tsx, which is the a11y tree telling us the
          role was a lie. The announcement behaviour is identical. */}
      <p
        className="combo-hint"
        id={hintId}
        aria-live="polite"
        aria-atomic="true"
      >
        {hint}
      </p>
    </div>
  )
}
