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
  className = ''
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
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
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
      <input
        type="text"
        id={id}
        className="combo-input"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
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
  )
}
